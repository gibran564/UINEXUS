import { cellKey, parseRange } from './cells';
import { evaluateSheet, formatValue, literal, type CellValue } from './formula';
import type { NexBookBlock, NexBookDocument, NexBookSheetData } from '../types';

/**
 * El puente entre las hojas de un documento y quien quiera leerlas.
 *
 * ## Para qué existe HOY
 *
 * Para que la exportación, la vista pública y la interfaz lean una hoja de una
 * sola forma. Sin él, «el valor de B2» se calcularía en tres sitios y el día que
 * cambie el redondeo cambiarían dos.
 *
 * ## Para qué existe SOBRE TODO
 *
 * Para que el día que Python y R puedan leer una hoja —`sheet("Ventas")`— no
 * tengan que saber nada de cómo está implementada. Esa es la razón de que el
 * contrato hable de nombres, rangos y valores y no de bloques ni de celdas
 * guardadas:
 *
 * ```
 * Python / R  ──▶  SpreadsheetBridge  ──▶  implementación de la hoja
 * ```
 *
 * Si mañana la hoja la dibujara otra biblioteca, lo que cambia es el lado
 * derecho. Atar el motor de Python al formato de almacenamiento de una hoja
 * concreta habría hecho imposible cambiarla sin tocar el intérprete.
 *
 * ## Lo que NO hace todavía
 *
 * No está conectado a los kernels. `sheet("Ventas")` no existe en Python ni en
 * R, y no se anuncia en ninguna parte de la interfaz. Ver `docs/NEXBOOK.md`.
 */

export type { CellValue };

/** Una hoja vista desde fuera: un nombre y una rejilla de valores. */
export interface SpreadsheetSnapshot {
  id: string;
  name: string;
  rows: number;
  columns: number;
  /** Nombres de columna, si la hoja los tiene. */
  headers: string[];
}

export interface SpreadsheetBridge {
  /** Las hojas del documento, en el orden en que aparecen. */
  list(): SpreadsheetSnapshot[];
  /** Una hoja por NOMBRE o por id. El nombre es lo que escribiría una persona. */
  find(nameOrId: string): SpreadsheetSnapshot | null;
  /** Los valores ya calculados de un rango, `"A1:C10"`. */
  getRange(nameOrId: string, range: string): CellValue[][] | null;
  /** La hoja entera como filas de valores, con los encabezados aparte. */
  getValues(nameOrId: string): { headers: string[]; rows: CellValue[][] } | null;
  /**
   * Escribe valores en un rango y devuelve el documento resultante.
   *
   * Devuelve un documento NUEVO en vez de mutar: el documento es el estado de
   * React de Studio, y mutarlo en su sitio no volvería a dibujar nada.
   */
  setRange(nameOrId: string, range: string, values: CellValue[][]): NexBookDocument | null;
}

export function createSpreadsheetBridge(document: NexBookDocument): SpreadsheetBridge {
  const sheets = (): (NexBookBlock & { type: 'spreadsheet' })[] =>
    document.blocks.filter(
      (block): block is NexBookBlock & { type: 'spreadsheet' } => block.type === 'spreadsheet'
    );

  function locate(nameOrId: string) {
    const needle = nameOrId.trim().toLowerCase();
    return (
      sheets().find((block) => block.id === nameOrId) ??
      sheets().find((block) => block.name.trim().toLowerCase() === needle) ??
      null
    );
  }

  function snapshot(block: NexBookBlock & { type: 'spreadsheet' }): SpreadsheetSnapshot {
    return {
      id: block.id,
      name: block.name,
      rows: block.sheet.rows,
      columns: block.sheet.columns,
      headers: headersOf(block.sheet),
    };
  }

  return {
    list: () => sheets().map(snapshot),

    find(nameOrId) {
      const block = locate(nameOrId);
      return block ? snapshot(block) : null;
    },

    getRange(nameOrId, range) {
      const block = locate(nameOrId);
      if (!block) return null;

      const addresses = parseRange(range);
      if (!addresses) return null;

      const values = evaluateSheet(block.sheet);
      const byRow = new Map<number, CellValue[]>();

      for (const address of addresses) {
        const row = byRow.get(address.row) ?? [];
        row.push(values.get(cellKey(address.row, address.column)) ?? null);
        byRow.set(address.row, row);
      }

      return [...byRow.keys()].sort((a, b) => a - b).map((row) => byRow.get(row)!);
    },

    getValues(nameOrId) {
      const block = locate(nameOrId);
      if (!block) return null;

      const values = evaluateSheet(block.sheet);
      const rows: CellValue[][] = [];

      for (let row = 0; row < block.sheet.rows; row += 1) {
        const cells: CellValue[] = [];
        for (let column = 0; column < block.sheet.columns; column += 1) {
          cells.push(values.get(cellKey(row, column)) ?? null);
        }
        // Una fila entera vacía al final de la hoja no es un dato: es el espacio
        // que queda por rellenar.
        if (cells.some((value) => value !== null && value !== '')) rows.push(cells);
      }

      return { headers: headersOf(block.sheet), rows };
    },

    setRange(nameOrId, range, values) {
      const block = locate(nameOrId);
      if (!block) return null;

      const addresses = parseRange(range);
      if (!addresses) return null;

      const cells = { ...block.sheet.cells };
      const width = Math.max(...addresses.map((address) => address.column)) -
        Math.min(...addresses.map((address) => address.column)) +
        1;

      addresses.forEach((address, index) => {
        const value = values[Math.floor(index / width)]?.[index % width];
        const key = cellKey(address.row, address.column);
        if (value === undefined || value === null || value === '') delete cells[key];
        else cells[key] = { input: formatValue(value) };
      });

      const updated: NexBookBlock = { ...block, sheet: { ...block.sheet, cells } };
      return {
        ...document,
        blocks: document.blocks.map((item) => (item.id === block.id ? updated : item)),
      };
    },
  };
}

/**
 * Los encabezados de una hoja.
 *
 * Si no se declararon, se usa la primera fila cuando toda ella es texto: es lo
 * que hace cualquiera al pegar una tabla, y adivinarlo aquí evita pedir un paso
 * de configuración que nadie quiere dar.
 */
function headersOf(sheet: NexBookSheetData): string[] {
  if (sheet.headers?.length) return sheet.headers;

  const firstRow: string[] = [];
  for (let column = 0; column < sheet.columns; column += 1) {
    const input = sheet.cells[cellKey(0, column)]?.input ?? '';
    if (input && typeof literal(input) === 'number') return [];
    firstRow.push(input);
  }

  return firstRow.some((value) => value) ? firstRow : [];
}
