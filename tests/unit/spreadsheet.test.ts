import { describe, expect, it } from 'vitest';
import { nexBookDocumentSchema } from '../../src/lib/academic-schemas';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import { columnIndex, columnName, emptySheet, parseRange, parseReference } from '../../src/lib/spreadsheet/cells';
import { evaluateCell, evaluateSheet, formatValue, literal } from '../../src/lib/spreadsheet/formula';
import { createSpreadsheetBridge } from '../../src/lib/spreadsheet/bridge';
import type { NexBookDocument, NexBookSheetData } from '../../src/lib/types';

/**
 * La hoja de cálculo.
 *
 * El motor de fórmulas es propio, y la razón está en `formula.ts`: las fórmulas
 * las escribe el alumnado y se guardan en un documento que otra persona puede
 * abrir. Convertirlas en JavaScript y evaluarlas sería ejecutar texto de
 * terceros en la sesión de quien lo lee.
 */

function sheetWith(cells: Record<string, string>, rows = 10, columns = 6): NexBookSheetData {
  return {
    rows,
    columns,
    cells: Object.fromEntries(Object.entries(cells).map(([key, input]) => [key, { input }])),
  };
}

/** `"B3"` → la clave con la que se guarda. */
function at(reference: string): string {
  const address = parseReference(reference)!;
  return `${address.row}:${address.column}`;
}

function valueOf(sheet: NexBookSheetData, reference: string) {
  const address = parseReference(reference)!;
  return evaluateCell(sheet, address);
}

describe('direcciones de celda', () => {
  it('las columnas van en base 26 BIYECTIVA: tras Z viene AA', () => {
    // Escribirlo con un `%` sin el `- 1` es el error clásico, y produce columnas
    // duplicadas a partir de la 27.
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
  });

  it('nombre e índice son inversos el uno del otro', () => {
    for (const index of [0, 1, 25, 26, 27, 51, 52, 700]) {
      expect(columnIndex(columnName(index))).toBe(index);
    }
  });

  it('un rango enorme no se expande', () => {
    /**
     * `A1:ZZ99999` pide más celdas de las que admite una hoja entera. Expandirlo
     * sería construir el array que tumba la pestaña de quien abrió el documento.
     */
    expect(parseRange('A1:ZZ99999')).toBeNull();
    expect(parseRange('A1:B2')).toHaveLength(4);
  });
});

describe('qué es un dato y qué es una fórmula', () => {
  it('un número escrito se lee como número', () => {
    expect(literal('42')).toBe(42);
    expect(literal('-3.5')).toBe(-3.5);
    expect(literal('25%')).toBe(0.25);
  });

  it('los ceros a la izquierda se quedan en texto', () => {
    // Quien escribe `007` casi siempre está escribiendo un código, no un número.
    expect(literal('007')).toBe('007');
  });

  it('el decimal no arrastra el error binario a la vista', () => {
    // 0.30000000000000004 delante de alguien que está aprendiendo no ayuda.
    expect(formatValue(0.1 + 0.2)).toBe('0.3');
  });
});

describe('el intérprete de fórmulas', () => {
  it('hace aritmética con la precedencia correcta', () => {
    const sheet = sheetWith({ [at('A1')]: '=2 + 3 * 4', [at('A2')]: '=(2 + 3) * 4', [at('A3')]: '=2^3^2' });

    expect(valueOf(sheet, 'A1')).toBe(14);
    expect(valueOf(sheet, 'A2')).toBe(20);
    // La potencia asocia por la derecha: 2^(3^2) = 512, no (2^3)^2 = 64.
    expect(valueOf(sheet, 'A3')).toBe(512);
  });

  it('resuelve referencias encadenadas', () => {
    const sheet = sheetWith({
      [at('A1')]: '10',
      [at('B1')]: '=A1 * 2',
      [at('C1')]: '=B1 + A1',
    });

    expect(valueOf(sheet, 'C1')).toBe(30);
  });

  it('suma y promedia un rango', () => {
    const sheet = sheetWith({
      [at('A1')]: '1',
      [at('A2')]: '2',
      [at('A3')]: '3',
      [at('B1')]: '=SUMA(A1:A3)',
      [at('B2')]: '=PROMEDIO(A1:A3)',
      [at('B3')]: '=MAX(A1:A3)',
    });

    expect(valueOf(sheet, 'B1')).toBe(6);
    expect(valueOf(sheet, 'B2')).toBe(2);
    expect(valueOf(sheet, 'B3')).toBe(3);
  });

  it('acepta los nombres en inglés y en español', () => {
    // Quien ha usado Excel en español escribe SUMA y quien siguió un tutorial
    // escribe SUM. Hacer fallar a uno de los dos sólo enseña a desconfiar.
    const sheet = sheetWith({ [at('A1')]: '2', [at('A2')]: '3', [at('B1')]: '=SUM(A1:A2)' });
    expect(valueOf(sheet, 'B1')).toBe(5);
  });

  it('SI elige la rama correcta', () => {
    const sheet = sheetWith({
      [at('A1')]: '15',
      [at('B1')]: '=SI(A1>10; "alto"; "bajo")',
      [at('B2')]: '=SI(A1>100; "alto"; "bajo")',
    });

    expect(valueOf(sheet, 'B1')).toBe('alto');
    expect(valueOf(sheet, 'B2')).toBe('bajo');
  });

  it('el texto se concatena con &', () => {
    const sheet = sheetWith({ [at('A1')]: 'Hola', [at('B1')]: '=A1 & " mundo"' });
    expect(valueOf(sheet, 'B1')).toBe('Hola mundo');
  });

  it('una división entre cero se dice, no se calcula', () => {
    const sheet = sheetWith({ [at('A1')]: '=1/0' });
    expect(valueOf(sheet, 'A1')).toBe('#DIV/0!');
  });

  it('una función que no existe da #NOMBRE?', () => {
    const sheet = sheetWith({ [at('A1')]: '=BUSCARV(A2)' });
    expect(valueOf(sheet, 'A1')).toBe('#NOMBRE?');
  });

  it('una referencia fuera de la hoja da #REF!', () => {
    const sheet = sheetWith({ [at('A1')]: '=Z99' }, 5, 3);
    expect(valueOf(sheet, 'A1')).toBe('#REF!');
  });

  it('una referencia circular se corta en vez de agotar la pila', () => {
    /**
     * `A1 = B1 + 1` y `B1 = A1 + 1` es una recursión infinita. Sin el corte, lo
     * que se agota es la pila del navegador de quien abre el documento.
     */
    const sheet = sheetWith({ [at('A1')]: '=B1 + 1', [at('B1')]: '=A1 + 1' });

    expect(valueOf(sheet, 'A1')).toBe('#CICLO!');
    expect(valueOf(sheet, 'B1')).toBe('#CICLO!');
  });

  it('NO evalúa JavaScript', () => {
    /**
     * La prueba de seguridad de la hoja. Las fórmulas las escribe el alumnado y
     * se guardan en un documento que otra persona abre; si esto se evaluara
     * como JavaScript, sería ejecución de código de terceros en su sesión.
     */
    const hostiles = [
      '=globalThis',
      '=constructor',
      '=fetch("https://ejemplo.mx")',
      '=[].constructor.constructor("return 1")()',
      '=process',
      '=require("fs")',
    ];

    for (const formula of hostiles) {
      const sheet = sheetWith({ [at('A1')]: formula });
      const value = valueOf(sheet, 'A1');
      // Da un error de fórmula, que es la respuesta correcta: no existe ese
      // nombre en el lenguaje de la hoja.
      expect(typeof value === 'string' && value.startsWith('#')).toBe(true);
    }
  });

  it('recalcula la hoja entera de una vez', () => {
    const sheet = sheetWith({ [at('A1')]: '5', [at('B1')]: '=A1*2', [at('C1')]: '=B1*2' });
    const values = evaluateSheet(sheet);

    expect(values.get(at('C1'))).toBe(20);
  });
});

describe('los límites de una hoja', () => {
  it('rechaza una celda fuera de la rejilla', () => {
    /**
     * Sin esto, `"999:999"` en una hoja de 10 × 5 se guardaría sin aparecer en
     * ninguna pantalla: espacio ocupado para siempre por algo que nadie puede
     * ver ni borrar, y que reaparecería si la hoja creciera.
     */
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        {
          id: 'b1',
          type: 'spreadsheet',
          name: 'Ventas',
          sheet: { rows: 10, columns: 5, cells: { '999:999': { input: 'oculto' } } },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza una hoja con demasiadas celdas con contenido', () => {
    const cells: Record<string, { input: string }> = {};
    for (let index = 0; index <= NEXBOOK_LIMITS.maxSheetCells; index += 1) {
      cells[`${index % 200}:${Math.floor(index / 200)}`] = { input: 'x' };
    }

    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        {
          id: 'b1',
          type: 'spreadsheet',
          name: 'Grande',
          sheet: { rows: 200, columns: 40, cells },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('una hoja recién creada es válida y está vacía', () => {
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'spreadsheet', name: 'Hoja', sheet: emptySheet() }],
    });

    expect(parsed.success).toBe(true);
  });

  it('se guarda lo ESCRITO, no lo calculado', () => {
    /**
     * Guardar el resultado como si fuera el dato convierte `=SUMA(A1:A3)` en un
     * número suelto la primera vez que alguien reabre el documento, y entonces
     * la hoja deja de recalcular.
     */
    const sheet = sheetWith({ [at('A1')]: '1', [at('A2')]: '2', [at('B1')]: '=SUMA(A1:A2)' });
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'spreadsheet', name: 'Hoja', sheet }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const block = parsed.data.blocks[0];
      expect(block?.type === 'spreadsheet' && block.sheet.cells[at('B1')]?.input).toBe('=SUMA(A1:A2)');
    }
  });
});

describe('el puente hacia las hojas', () => {
  const document: NexBookDocument = {
    formatVersion: 1,
    blocks: [
      {
        id: 'b1',
        type: 'spreadsheet',
        name: 'Ventas',
        sheet: sheetWith({
          [at('A1')]: 'mes',
          [at('B1')]: 'total',
          [at('A2')]: 'enero',
          [at('B2')]: '100',
          [at('A3')]: 'febrero',
          [at('B3')]: '=B2 * 2',
        }),
      },
    ],
    results: {},
  };

  it('encuentra una hoja por su NOMBRE', () => {
    // Es lo que escribiría una persona: `sheet("Ventas")`, no un id opaco.
    const bridge = createSpreadsheetBridge(document);
    expect(bridge.find('Ventas')?.id).toBe('b1');
    expect(bridge.find('ventas')?.id).toBe('b1');
    expect(bridge.find('Compras')).toBeNull();
  });

  it('devuelve valores YA CALCULADOS', () => {
    const bridge = createSpreadsheetBridge(document);
    expect(bridge.getRange('Ventas', 'B2:B3')).toEqual([[100], [200]]);
  });

  it('adivina los encabezados cuando la primera fila es texto', () => {
    const bridge = createSpreadsheetBridge(document);
    expect(bridge.getValues('Ventas')?.headers).toEqual(['mes', 'total', '', '', '', '']);
  });

  it('escribir devuelve un documento NUEVO', () => {
    /**
     * El documento es el estado de React de Studio: mutarlo en su sitio no
     * volvería a dibujar nada, y el fallo sería «escribí en la hoja y no pasó
     * nada».
     */
    const bridge = createSpreadsheetBridge(document);
    const next = bridge.setRange('Ventas', 'C1:C2', [['x'], ['y']]);

    expect(next).not.toBe(document);
    const original = document.blocks[0];
    expect(original?.type === 'spreadsheet' && original.sheet.cells[at('C1')]).toBeUndefined();

    const updated = next?.blocks[0];
    expect(updated?.type === 'spreadsheet' && updated.sheet.cells[at('C1')]?.input).toBe('x');
  });
});
