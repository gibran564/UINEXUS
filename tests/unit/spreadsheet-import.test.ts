import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import { CsvRejected, csvToSheet, detectDelimiter, parseCsvRows } from '../../src/lib/spreadsheet/csv';
import {
  XlsxRejected,
  excelSerialToDate,
  isConvertibleFormula,
  parseAddress,
  readXlsx,
} from '../../src/lib/spreadsheet/xlsx';
import { cellKey } from '../../src/lib/spreadsheet/cells';
import { evaluateSheet } from '../../src/lib/spreadsheet/formula';

/**
 * Importar datos a una hoja.
 *
 * Dos mitades, como en el importador de `.nexbook`: que un archivo normal se lea
 * bien, y que uno hostil o roto no consiga nada. La segunda es la que justifica
 * que estos parsers estén escritos aquí en vez de delegados a una biblioteca
 * general: lo que no se quiere ejecutar, sencillamente no se abre.
 */

const at = (sheet: { cells: Record<string, { input: string }> }, row: number, column: number) =>
  sheet.cells[cellKey(row, column)]?.input;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('CSV', () => {
  it('lee encabezados, filas y valores vacíos', () => {
    const result = csvToSheet('producto,unidades,precio\nTornillo,10,2.5\nTuerca,,1.25\n');

    expect(result.delimiter).toBe(',');
    expect(result.sheet.headers).toEqual(['producto', 'unidades', 'precio']);
    expect(at(result.sheet, 1, 0)).toBe('Tornillo');
    expect(at(result.sheet, 1, 1)).toBe('10');
    // Un valor vacío NO se guarda: una hoja donde se borró no pesa más.
    expect(at(result.sheet, 2, 1)).toBeUndefined();
    expect(at(result.sheet, 2, 2)).toBe('1.25');
  });

  it('detecta el punto y coma, que es lo que exporta Excel en español', () => {
    const result = csvToSheet('producto;unidades\nTornillo;10\n');
    expect(result.delimiter).toBe(';');
    expect(at(result.sheet, 1, 1)).toBe('10');
  });

  it('detecta el tabulador', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('NO cuenta los delimitadores que van dentro de comillas', () => {
    // El caso que rompe cualquier `split(',')`: una dirección con comas dentro
    // de un archivo de punto y coma.
    expect(detectDelimiter('nombre;ciudad\n"Ana";"Durango, Dgo."')).toBe(';');
  });

  it('respeta comillas, comillas escapadas y saltos de línea dentro del campo', () => {
    const rows = parseCsvRows('a,"b,c","d""e","f\ng"\n', ',');
    expect(rows[0]).toEqual(['a', 'b,c', 'd"e', 'f\ng']);
  });

  it('acepta CRLF igual que LF', () => {
    const rows = parseCsvRows('a,b\r\n1,2\r\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('conserva la eñe y los acentos', () => {
    const result = csvToSheet('año,región\n2026,Durango\n');
    expect(result.sheet.headers).toEqual(['año', 'región']);
    expect(at(result.sheet, 1, 1)).toBe('Durango');
  });

  it('quita el BOM, que si no se convierte en parte del primer encabezado', () => {
    const result = csvToSheet('﻿producto,precio\nTornillo,2\n');
    expect(result.sheet.headers?.[0]).toBe('producto');
  });

  it('una primera fila numérica NO se toma por encabezados', () => {
    const result = csvToSheet('1,2,3\n4,5,6\n');
    expect(result.sheet.headers).toBeUndefined();
  });

  it('un texto que empieza por `=` se guarda como TEXTO, no como fórmula', () => {
    /**
     * Sin esto, importar un archivo ajeno podría inyectar fórmulas en la hoja de
     * quien lo importa. La comilla inicial es lo que cualquier hoja de cálculo
     * usa para decir «esto es texto».
     */
    const result = csvToSheet('valor\n=SUMA(A1:A9)\n');
    expect(at(result.sheet, 1, 0)).toBe("'=SUMA(A1:A9)");

    const values = evaluateSheet(result.sheet);
    expect(values.get(cellKey(1, 0))).not.toBe(0);
  });

  it('rechaza un archivo vacío y uno sin filas', () => {
    expect(() => csvToSheet('')).toThrow(CsvRejected);
    expect(() => csvToSheet('\n\n\n')).toThrow(CsvRejected);
  });

  it('recorta y AVISA cuando el archivo supera el tamaño de una hoja', () => {
    const rows = ['n'];
    for (let index = 0; index < NEXBOOK_LIMITS.maxSheetRows + 20; index += 1) {
      rows.push(String(index));
    }

    const result = csvToSheet(rows.join('\n'));
    expect(result.sheet.rows).toBe(NEXBOOK_LIMITS.maxSheetRows);
    expect(result.totalRows).toBeGreaterThan(NEXBOOK_LIMITS.maxSheetRows);
    expect(result.warnings.join(' ')).toContain('filas');
  });
});

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Construye un `.xlsx` mínimo pero real: el mismo ZIP de XML que Excel. */
function workbook(options: {
  sheets: { name: string; rows: string }[];
  strings?: string[];
  styles?: string;
  extra?: Record<string, string>;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  files['[Content_Types].xml'] = strToU8('<?xml version="1.0"?><Types/>');

  const sheetTags = options.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0"?><workbook><sheets>${sheetTags}</sheets></workbook>`);

  const rels = options.sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join('');
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships>${rels}</Relationships>`);

  options.sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${sheet.rows}</sheetData></worksheet>`
    );
  });

  if (options.strings) {
    const items = options.strings.map((value) => `<si><t>${value}</t></si>`).join('');
    files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst>${items}</sst>`);
  }
  if (options.styles) files['xl/styles.xml'] = strToU8(options.styles);

  for (const [path, content] of Object.entries(options.extra ?? {})) {
    files[path] = strToU8(content);
  }

  return zipSync(files);
}

describe('direcciones de Excel', () => {
  it('traduce columnas de una y de varias letras', () => {
    expect(parseAddress('A1')).toEqual({ row: 0, column: 0 });
    expect(parseAddress('B12')).toEqual({ row: 11, column: 1 });
    expect(parseAddress('AA1')).toEqual({ row: 0, column: 26 });
    expect(parseAddress('no')).toBeNull();
  });
});

describe('fechas de Excel', () => {
  it('convierte el número de serie a fecha', () => {
    // 45000 → 2023-03-15. El día 0 es el 30/12/1899 por el bug de 1900 que
    // Excel arrastra de Lotus; usar el 1/1/1900 desplazaría todo un día.
    expect(excelSerialToDate(45000)).toBe('2023-03-15');
    expect(excelSerialToDate(1)).toBe('1899-12-31');
  });

  it('rechaza un serial imposible en vez de inventar una fecha', () => {
    expect(excelSerialToDate(-1)).toBeNull();
    expect(excelSerialToDate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('fórmulas de Excel', () => {
  it('reconoce las que el motor propio sabe evaluar', () => {
    expect(isConvertibleFormula('SUMA(A1:A3)')).toBe(true);
    expect(isConvertibleFormula('A1+B2*2')).toBe(true);
    expect(isConvertibleFormula('SI(A1>0,1,0)')).toBe(true);
  });

  it('rechaza las que no, incluidas las que citan otra hoja', () => {
    expect(isConvertibleFormula('VLOOKUP(A1,B:C,2,0)')).toBe(false);
    expect(isConvertibleFormula('SUMA(Ventas!A1:A3)')).toBe(false);
    expect(isConvertibleFormula("'[Otro.xlsx]Hoja1'!A1")).toBe(false);
  });
});

describe('XLSX', () => {
  it('lee texto compartido, números, booleanos y celdas vacías', () => {
    const file = workbook({
      strings: ['Producto', 'Tornillo'],
      sheets: [
        {
          name: 'Ventas',
          rows:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Unidades</t></is></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>10</v></c><c r="C2" t="b"><v>1</v></c></row>' +
            '<row r="3"><c r="A3"/><c r="C3" t="b"><v>0</v></c></row>',
        },
      ],
    });

    const result = readXlsx(file);
    const sheet = result.sheets[0]!;

    expect(sheet.name).toBe('Ventas');
    expect(at(sheet.sheet, 0, 0)).toBe('Producto');
    expect(at(sheet.sheet, 0, 1)).toBe('Unidades');
    expect(at(sheet.sheet, 1, 0)).toBe('Tornillo');
    expect(at(sheet.sheet, 1, 1)).toBe('10');
    expect(at(sheet.sheet, 1, 2)).toBe('VERDADERO');
    expect(at(sheet.sheet, 2, 2)).toBe('FALSO');
    // Una celda sin valor no ocupa sitio.
    expect(at(sheet.sheet, 2, 0)).toBeUndefined();
  });

  it('convierte una fecha cuando su estilo dice que lo es', () => {
    const file = workbook({
      // `cellXfs` índice 0 → numFmtId 14, que es una fecha de serie de Excel.
      styles: '<?xml version="1.0"?><styleSheet><cellXfs><xf numFmtId="14"/><xf numFmtId="0"/></cellXfs></styleSheet>',
      sheets: [
        {
          name: 'Fechas',
          rows: '<row r="1"><c r="A1" s="0"><v>45000</v></c><c r="B1" s="1"><v>45000</v></c></row>',
        },
      ],
    });

    const sheet = readXlsx(file).sheets[0]!.sheet;
    expect(at(sheet, 0, 0)).toBe('2023-03-15');
    // Con estilo numérico sigue siendo el número: no se adivina.
    expect(at(sheet, 0, 1)).toBe('45000');
  });

  it('un formato personalizado con letras de fecha también cuenta', () => {
    const file = workbook({
      styles:
        '<?xml version="1.0"?><styleSheet><numFmts><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
        '<cellXfs><xf numFmtId="165"/></cellXfs></styleSheet>',
      sheets: [{ name: 'F', rows: '<row r="1"><c r="A1" s="0"><v>45000</v></c></row>' }],
    });

    expect(at(readXlsx(file).sheets[0]!.sheet, 0, 0)).toBe('2023-03-15');
  });

  it('un formato con una `d` dentro de un literal NO es una fecha', () => {
    const file = workbook({
      styles:
        '<?xml version="1.0"?><styleSheet><numFmts><numFmt numFmtId="166" formatCode="0&quot; días&quot;"/></numFmts>' +
        '<cellXfs><xf numFmtId="166"/></cellXfs></styleSheet>',
      sheets: [{ name: 'F', rows: '<row r="1"><c r="A1" s="0"><v>30</v></c></row>' }],
    });

    expect(at(readXlsx(file).sheets[0]!.sheet, 0, 0)).toBe('30');
  });

  it('una fórmula soportada se CONVIERTE y se recalcula aquí', () => {
    const file = workbook({
      sheets: [
        {
          name: 'F',
          rows:
            '<row r="1"><c r="A1"><v>2</v></c><c r="A2"><v>3</v></c>' +
            '<c r="A3"><f>SUM(A1:A2)</f><v>5</v></c></row>',
        },
      ],
    });

    const sheet = readXlsx(file).sheets[0]!.sheet;
    expect(at(sheet, 2, 0)).toBe('=SUM(A1:A2)');
    expect(evaluateSheet(sheet).get(cellKey(2, 0))).toBe(5);
  });

  it('una fórmula NO soportada guarda el valor cacheado y AVISA', () => {
    /**
     * Las tres cosas que no se hacen: inventar un resultado, evaluar algo que no
     * se entiende, y callarse. El `.xlsx` separa `<f>` de `<v>`, así que se
     * puede conservar el número sin fingir que Nextudio lo recalculó.
     */
    const file = workbook({
      sheets: [
        {
          name: 'F',
          rows: '<row r="1"><c r="A1"><f>VLOOKUP(B1,C:D,2,0)</f><v>42</v></c></row>',
        },
      ],
    });

    const result = readXlsx(file);
    expect(at(result.sheets[0]!.sheet, 0, 0)).toBe('42');
    expect(result.warnings.join(' ')).toContain('no sabe recalcular');
    expect(result.warnings.join(' ')).toContain('VLOOKUP');
  });

  it('varias hojas producen varias hojas, cada una con su nombre del libro', () => {
    const file = workbook({
      sheets: [
        { name: 'Ventas', rows: '<row r="1"><c r="A1"><v>1</v></c></row>' },
        { name: 'Costos', rows: '<row r="1"><c r="A1"><v>2</v></c></row>' },
      ],
    });

    const result = readXlsx(file);
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(['Ventas', 'Costos']);
    expect(at(result.sheets[1]!.sheet, 0, 0)).toBe('2');
  });

  it('las macros NO se ejecutan, y se dice que estaban', () => {
    const file = workbook({
      sheets: [{ name: 'H', rows: '<row r="1"><c r="A1"><v>1</v></c></row>' }],
      extra: { 'xl/vbaProject.bin': 'CONTENIDO BINARIO DE MACRO' },
    });

    const result = readXlsx(file);
    expect(result.warnings.join(' ')).toContain('macros');
    // Y su contenido no aparece en ninguna celda de ninguna hoja.
    expect(JSON.stringify(result.sheets)).not.toContain('CONTENIDO BINARIO');
  });

  it('los enlaces externos y las conexiones no se siguen, y se avisa', () => {
    const file = workbook({
      sheets: [{ name: 'H', rows: '<row r="1"><c r="A1"><v>1</v></c></row>' }],
      extra: {
        'xl/externalLinks/externalLink1.xml': '<externalLink><externalBook r:id="rId1"/></externalLink>',
        'xl/connections.xml': '<connections><connection odcFile="http://ejemplo/x.odc"/></connections>',
      },
    });

    const result = readXlsx(file);
    const warnings = result.warnings.join(' ');
    expect(warnings).toContain('enlaza a otros libros');
    expect(warnings).toContain('conexiones externas');
    // La URL del ODC nunca se decodifica ni se pide.
    expect(JSON.stringify(result.sheets)).not.toContain('http://ejemplo');
  });

  it('las entidades XML se decodifican, y sólo las cinco conocidas', () => {
    const file = workbook({
      strings: ['Ana &amp; Luis &lt;3', '&#65;&#66;'],
      sheets: [
        {
          name: 'H',
          rows: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
        },
      ],
    });

    const sheet = readXlsx(file).sheets[0]!.sheet;
    expect(at(sheet, 0, 0)).toBe('Ana & Luis <3');
    expect(at(sheet, 0, 1)).toBe('AB');
  });

  it('una declaración de entidad del propio archivo es texto que nadie mira', () => {
    /**
     * XXE y la expansión exponencial de entidades no tienen dónde ocurrir: no
     * hay parser de XML general, así que un `<!ENTITY>` no se resuelve nunca.
     */
    const file = workbook({
      sheets: [
        {
          name: 'H',
          rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row>',
        },
      ],
      extra: {
        'xl/evil.dtd': '<!ENTITY xxe SYSTEM "file:///etc/passwd">',
      },
    });

    const sheet = readXlsx(file).sheets[0]!.sheet;
    // Se queda tal cual: ni se resuelve, ni se lee ningún archivo.
    expect(at(sheet, 0, 0)).toBe('&xxe;');
  });

  it('rechaza lo que no es un .xlsx, con un mensaje que dice qué hacer', () => {
    expect(() => readXlsx(strToU8('producto,precio\n1,2'))).toThrow(XlsxRejected);
    try {
      readXlsx(strToU8('no soy un zip'));
    } catch (caught) {
      expect((caught as Error).message).toContain('.xlsx');
    }
  });

  it('rechaza un ZIP que no es un libro', () => {
    expect(() => readXlsx(zipSync({ 'hola.txt': strToU8('hola') }))).toThrow(XlsxRejected);
  });

  it('rechaza por tamaño antes de descomprimir nada', () => {
    const huge = new Uint8Array(NEXBOOK_LIMITS.maxImportBytes + 1);
    huge[0] = 0x50;
    huge[1] = 0x4b;
    expect(() => readXlsx(huge)).toThrow(XlsxRejected);
  });

  it('recorta el número de hojas y lo dice', () => {
    const many = Array.from({ length: NEXBOOK_LIMITS.maxImportSheets + 3 }, (_value, index) => ({
      name: `H${index}`,
      rows: '<row r="1"><c r="A1"><v>1</v></c></row>',
    }));

    const result = readXlsx(workbook({ sheets: many }));
    expect(result.sheets).toHaveLength(NEXBOOK_LIMITS.maxImportSheets);
    expect(result.warnings.join(' ')).toContain('hojas');
  });

  it('recorta filas y columnas al tamaño de una hoja', () => {
    const rows = Array.from(
      { length: NEXBOOK_LIMITS.maxSheetRows + 5 },
      (_value, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`
    ).join('');

    const result = readXlsx(workbook({ sheets: [{ name: 'Larga', rows }] }));
    expect(result.sheets[0]!.sheet.rows).toBe(NEXBOOK_LIMITS.maxSheetRows);
    expect(result.sheets[0]!.totalRows).toBeGreaterThan(NEXBOOK_LIMITS.maxSheetRows);
    expect(result.warnings.join(' ')).toContain('filas');
  });
});
