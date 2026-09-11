import { NEXBOOK_LIMITS } from '../constants';
import type { NexBookSheetData } from '../types';

/**
 * Direcciones de celda: `A1` por fuera, `{ row, column }` por dentro.
 *
 * Las dos representaciones hacen falta y no son intercambiables. `A1` es lo que
 * escribe una persona en una fórmula y lo que espera ver; los índices son lo que
 * usa la rejilla. Convertir en el borde —aquí— y no en cada sitio que lo
 * necesite es lo que evita que la columna 27 sea `AA` en un archivo y `BA` en
 * otro.
 */

export interface CellAddress {
  row: number;
  column: number;
}

/** `"2:3"`, la clave con la que se guarda una celda. */
export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function parseCellKey(key: string): CellAddress | null {
  const [row, column] = key.split(':');
  const parsed = { row: Number(row), column: Number(column) };
  if (!Number.isInteger(parsed.row) || !Number.isInteger(parsed.column)) return null;
  if (parsed.row < 0 || parsed.column < 0) return null;
  return parsed;
}

/**
 * El nombre de una columna: 0 → `A`, 25 → `Z`, 26 → `AA`.
 *
 * Es biyectivo en base 26 y NO base 26 normal: no hay dígito cero, así que tras
 * `Z` viene `AA` y no `BA`. Escribirlo con un `%` sin el `- 1` es el error
 * clásico y produce columnas duplicadas a partir de la 27.
 */
export function columnName(index: number): string {
  let name = '';
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

export function columnIndex(name: string): number {
  let index = 0;
  for (const character of name.toUpperCase()) {
    const digit = character.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return -1;
    index = index * 26 + digit;
  }
  return index - 1;
}

/** `"B3"` → `{ row: 2, column: 1 }`. Las filas se escriben desde 1. */
export function parseReference(reference: string): CellAddress | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(reference.trim());
  if (!match) return null;

  const column = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  if (column < 0 || row < 0) return null;
  return { row, column };
}

export function formatReference(address: CellAddress): string {
  return `${columnName(address.column)}${address.row + 1}`;
}

/** `"A1:B4"` → todas las direcciones del rectángulo, en orden de lectura. */
export function parseRange(range: string): CellAddress[] | null {
  const [from, to] = range.split(':');
  if (!from || !to) return null;

  const start = parseReference(from);
  const end = parseReference(to);
  if (!start || !end) return null;

  const addresses: CellAddress[] = [];
  const rowStart = Math.min(start.row, end.row);
  const rowEnd = Math.max(start.row, end.row);
  const columnStart = Math.min(start.column, end.column);
  const columnEnd = Math.max(start.column, end.column);

  // Un rango puede pedir más celdas de las que admite una hoja entera —`A1:ZZ99999`—
  // y expandirlo sería construir el array que tumba la pestaña.
  const size = (rowEnd - rowStart + 1) * (columnEnd - columnStart + 1);
  if (size > NEXBOOK_LIMITS.maxSheetRows * NEXBOOK_LIMITS.maxSheetColumns) return null;

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      addresses.push({ row, column });
    }
  }
  return addresses;
}

/** Una hoja vacía del tamaño de partida. */
export function emptySheet(rows = 8, columns = 5): NexBookSheetData {
  return { rows, columns, cells: {} };
}

/** Lo que hay escrito en una celda, o cadena vacía. */
export function rawCell(sheet: NexBookSheetData, address: CellAddress): string {
  return sheet.cells[cellKey(address.row, address.column)]?.input ?? '';
}
