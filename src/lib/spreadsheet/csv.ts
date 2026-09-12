import { NEXBOOK_LIMITS } from '../constants';
import { cellKey } from './cells';
import type { NexBookSheetData } from '../types';

/**
 * Importar CSV a una hoja.
 *
 * ## Qué es y qué no es
 *
 * Es un lector de CSV correcto: comillas, comillas escapadas por duplicación,
 * saltos de línea DENTRO de un campo, `\r\n` y `\n`, BOM de UTF-8 y delimitador
 * detectado. **No es un ETL**: no infiere esquemas, no convierte fechas, no
 * normaliza cabeceras, no descarta duplicados y no adivina codificaciones
 * distintas de UTF-8.
 *
 * ## El delimitador se detecta, no se pregunta
 *
 * Un CSV exportado por Excel en español usa `;` porque la coma es el separador
 * decimal; uno exportado por casi todo lo demás usa `,`. Preguntarlo sería pedir
 * a alguien que abra el archivo en un editor de texto para poder importarlo. Se
 * cuenta cuál aparece más en la PRIMERA línea —fuera de comillas— y se puede
 * forzar si la detección se equivoca.
 *
 * ## Lo que se guarda es TEXTO
 *
 * El valor de cada celda entra como el texto que traía. No se convierte a
 * número aquí: `NexBookSheetCell.input` guarda lo ESCRITO, y quien decide si
 * «1.234» es un número es el motor de fórmulas al evaluar, igual que si alguien
 * lo hubiera tecleado. Convertir en la importación produciría hojas donde el
 * mismo valor se comporta distinto según por dónde entró.
 *
 * Con una excepción deliberada: un texto que EMPIEZA por `=` se escaparía como
 * fórmula. Un CSV no trae fórmulas de Nextudio, así que se antepone una comilla
 * simple, que es lo que hace cualquier hoja de cálculo para decir «esto es
 * texto». Sin eso, importar un archivo ajeno podría inyectar fórmulas en la hoja
 * de quien lo importa.
 */

export class CsvRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvRejected';
  }
}

export interface CsvParseOptions {
  /** Si se omite, se detecta a partir de la primera línea. */
  delimiter?: string;
  /** La primera fila son encabezados. Por defecto se deduce. */
  headers?: boolean;
}

export interface CsvImportResult {
  sheet: NexBookSheetData;
  /** Filas que traía el archivo, aunque se hayan recortado. */
  totalRows: number;
  /** Avisos para quien importa. Nunca se corrige en silencio. */
  warnings: string[];
  delimiter: string;
}

const CANDIDATES = [',', ';', '\t', '|'] as const;

/**
 * El delimitador más probable.
 *
 * Se cuenta sólo FUERA de comillas: un campo como `"Durango, Dgo."` tiene una
 * coma que no separa nada, y contarla haría elegir la coma en un archivo de
 * punto y coma. Se mira la primera línea lógica, que es donde están los
 * encabezados.
 */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(CANDIDATES.map((candidate) => [candidate, 0]));
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (character === '"') {
      // Dos comillas seguidas dentro de un campo son una comilla escapada.
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) break;
    if (!quoted && counts.has(character)) counts.set(character, counts.get(character)! + 1);
  }

  let best = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * CSV a filas, respetando comillas.
 *
 * Un autómata de dos estados y no `split(delimiter)`: partir por el delimitador
 * rompe cualquier campo entrecomillado que lo contenga, que en datos reales es
 * el caso normal —direcciones, cifras con separador de miles, texto libre—.
 */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // El BOM de UTF-8 delante del primer encabezado lo convertiría en un nombre
  // de columna que no coincide con nada. Se quita.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === '') {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      endField();
      continue;
    }
    if (character === '\r') {
      // `\r\n` cuenta como UN fin de línea.
      if (source[index + 1] === '\n') index += 1;
      endRow();
      continue;
    }
    if (character === '\n') {
      endRow();
      continue;
    }
    field += character;
  }

  // La última fila sólo cuenta si tiene algo: un archivo que termina en salto de
  // línea no trae una fila vacía al final.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Un texto que empezaría por `=` se marca como texto, no como fórmula. */
function safeInput(value: string): string {
  return /^[=+\-@]/.test(value) && value.length > 1 ? `'${value}` : value;
}

/** Importa un CSV a una hoja lista para guardarse. */
export function csvToSheet(text: string, options: CsvParseOptions = {}): CsvImportResult {
  if (text.length === 0) throw new CsvRejected('Ese archivo está vacío.');

  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter).filter(
    // Una línea totalmente vacía en medio del archivo no es una fila de datos.
    (row) => row.some((value) => value.trim() !== '')
  );

  if (rows.length === 0) throw new CsvRejected('Ese CSV no tiene ninguna fila con datos.');

  const warnings: string[] = [];
  const totalRows = rows.length;

  const width = Math.max(...rows.map((row) => row.length));
  if (width > NEXBOOK_LIMITS.maxSheetColumns) {
    warnings.push(
      `El archivo trae ${width} columnas y una hoja admite ${NEXBOOK_LIMITS.maxSheetColumns}. Se importaron las primeras.`
    );
  }
  const columns = Math.min(width, NEXBOOK_LIMITS.maxSheetColumns);

  let kept = rows;
  if (rows.length > NEXBOOK_LIMITS.maxSheetRows) {
    warnings.push(
      `El archivo trae ${rows.length} filas y una hoja admite ${NEXBOOK_LIMITS.maxSheetRows}. Se importaron las primeras.`
    );
    kept = rows.slice(0, NEXBOOK_LIMITS.maxSheetRows);
  }

  /**
   * ¿La primera fila son encabezados?
   *
   * Si no se dice, se deduce igual que hace `SpreadsheetBridge` al leer una
   * hoja escrita a mano: lo son cuando ninguna de sus celdas parece un número.
   * Es la heurística que ya estaba en el proyecto, y usar otra aquí produciría
   * hojas que se leen distinto según por dónde entraron.
   */
  const first = kept[0] ?? [];
  const headers =
    options.headers ??
    (first.length > 0 && first.every((value) => value.trim() === '' || !isNumeric(value)));

  const cells: NexBookSheetData['cells'] = {};
  let written = 0;

  for (let row = 0; row < kept.length; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = kept[row]?.[column] ?? '';
      if (value === '') continue;
      if (written >= NEXBOOK_LIMITS.maxSheetCells) {
        warnings.push(
          `Se alcanzó el tope de ${NEXBOOK_LIMITS.maxSheetCells} celdas con contenido. El resto no se importó.`
        );
        row = kept.length;
        break;
      }
      cells[cellKey(row, column)] = { input: safeInput(value) };
      written += 1;
    }
  }

  return {
    sheet: {
      rows: Math.max(kept.length, 1),
      columns: Math.max(columns, 1),
      cells,
      ...(headers ? { headers: first.slice(0, columns).map((value) => value.trim()) } : {}),
    },
    totalRows,
    warnings,
    delimiter,
  };
}

/** ¿Este texto se lee como número? Acepta coma decimal y separador de miles. */
function isNumeric(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^-?\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d+)?$/.test(trimmed) || /^-?\d+(?:[.,]\d+)?$/.test(trimmed);
}
