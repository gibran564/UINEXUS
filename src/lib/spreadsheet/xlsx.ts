import { unzipSync } from 'fflate';
import { NEXBOOK_LIMITS } from '../constants';
import { cellKey } from './cells';
import type { NexBookSheetData } from '../types';

/**
 * Importar `.xlsx` a hojas de NexBook.
 *
 * ## Por qué no se instaló una biblioteca
 *
 * Se auditaron las opciones habituales antes de escribir una línea:
 *
 * | Opción | Por qué se descartó |
 * |---|---|
 * | **SheetJS (`xlsx`)** | El paquete de npm está congelado y la distribución mantenida se sirve desde un CDN propio, fuera del registro. Arrastra ~900 KB, escribe además de leer, y su superficie incluye formatos que aquí no se quieren tocar. Ha tenido CVEs de prototype pollution y ReDoS. |
 * | **ExcelJS** | ~1 MB, orientado a ESCRIBIR libros completos con estilos; trae un parser de XML por streams y dependencias de Node. Para leer valores es una superficie enorme a cambio de nada. |
 * | **`read-excel-file`** | Es la más cercana en espíritu —sólo lectura, MIT, navegador— pero depende de `DOMParser`/`xmldom` y añade otra dependencia por unas trescientas líneas de trabajo. |
 *
 * Lo que decidió fue esto: **`fflate` ya es una dependencia del proyecto** —la
 * usa el importador de `.nexbook`, con sus defensas contra zip slip y ZIP bomb
 * ya escritas y probadas— y un `.xlsx` es un ZIP de XML. Escribir el lector
 * aquí sale más barato en bytes, no añade superficie de suministro, y sobre todo
 * da **control total sobre qué partes del archivo se miran**: las que no se
 * quieren ejecutar no se abren, en vez de confiar en que una biblioteca general
 * no las toque.
 *
 * ## Qué NO se abre, nunca
 *
 * ```
 * xl/vbaProject.bin        macros VBA
 * xl/externalLinks/*       enlaces a otros libros
 * xl/connections.xml       conexiones a bases de datos
 * xl/queryTables/*         Power Query
 * xl/drawings/*            objetos y gráficos embebidos
 * ```
 *
 * No es que se filtren: es que este código sólo lee `workbook.xml`,
 * `sharedStrings.xml`, `styles.xml` y las hojas. Todo lo demás es contenido que
 * nunca se decodifica. Lo que sí se hace es DETECTARLO por el nombre de la
 * entrada, para poder avisar de que el archivo traía cosas que se ignoraron.
 *
 * **Importar un `.xlsx` no genera tráfico de red.** No hay `fetch` en este
 * archivo, ni ninguna URL: las hojas se leen del ZIP que llegó.
 *
 * ## Por qué no hay parser de XML general
 *
 * Porque no hace falta y porque un parser general es justo donde viven las
 * entidades externas (XXE) y la expansión exponencial de entidades. Aquí se
 * recorren estructuras conocidas con expresiones regulares y sólo se decodifican
 * **cinco** entidades más las numéricas. Una declaración `<!ENTITY>` en el
 * archivo es texto que nadie mira: la clase de ataque no tiene dónde ocurrir.
 */

export class XlsxRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxRejected';
  }
}

export interface XlsxSheet {
  name: string;
  sheet: NexBookSheetData;
  /** Filas que traía la hoja original, aunque se hayan recortado. */
  totalRows: number;
}

export interface XlsxImportResult {
  sheets: XlsxSheet[];
  /** Lo que se ignoró, dicho en voz alta. Nunca se corrige en silencio. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// XML mínimo
// ---------------------------------------------------------------------------

/** Las cinco entidades de XML, más las numéricas. Nada más se resuelve. */
function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => safeCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_match, code: string) =>
      safeCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // `&amp;` al final: si fuera primero, `&amp;lt;` acabaría siendo `<`.
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** El valor de un atributo de una etiqueta abierta. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1] ?? '') : null;
}

// ---------------------------------------------------------------------------
// Direcciones
// ---------------------------------------------------------------------------

/** `B12` → `{ row: 11, column: 1 }`, base 0. `null` si no es una referencia. */
export function parseAddress(reference: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(reference.trim().toUpperCase());
  if (!match) return null;

  let column = 0;
  for (const character of match[1]!) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1) return null;

  return { row: row - 1, column: column - 1 };
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** Formatos de fecha que Excel trae de serie. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * El número de serie de Excel a `YYYY-MM-DD`.
 *
 * El día 0 es el 30 de diciembre de 1899 y NO el 1 de enero de 1900, porque
 * Excel arrastra desde Lotus 1-2-3 el bug de considerar 1900 bisiesto. Usar la
 * fecha «correcta» desplazaría un día todas las fechas anteriores a marzo de
 * 1900 y, lo que importa de verdad, ninguna posterior: el desfase se compensa
 * exactamente con el día 29 de febrero que no existió.
 */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_466) return null;

  const days = Math.floor(serial);
  const milliseconds = Math.round((serial - days) * 86_400_000);
  const epoch = Date.UTC(1899, 11, 30) + days * 86_400_000 + milliseconds;
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) return null;

  const iso = date.toISOString();
  // Con parte horaria se conserva; sin ella, sólo la fecha. Un `2026-09-11` es
  // más legible que `2026-09-11T00:00:00.000Z` en una celda.
  return milliseconds === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

/** Los `numFmtId` de cada estilo, y cuáles de ellos son fechas. */
function dateStyles(stylesXml: string | null): Set<number> {
  const dates = new Set<number>();
  if (!stylesXml) return dates;

  // Formatos personalizados cuyo código contiene componentes de fecha u hora.
  const customDateIds = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attribute(match[0], 'numFmtId'));
    const code = attribute(match[0], 'formatCode') ?? '';
    // Se quitan los literales entre comillas antes de buscar letras de fecha:
    // un formato como `0" días"` no es una fecha aunque lleve una `d`.
    const withoutLiterals = code.replace(/"[^"]*"/g, '');
    if (Number.isInteger(id) && /[yYmMdDhHs]/.test(withoutLiterals)) customDateIds.add(id);
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    const numFmtId = Number(attribute(match[0], 'numFmtId') ?? '0');
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || customDateIds.has(numFmtId)) dates.add(index);
    index += 1;
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Las partes del archivo que este lector NO decodifica, con su aviso. */
const IGNORED_PARTS: readonly { match: RegExp; warning: string }[] = [
  { match: /^xl\/vbaProject\.bin$/i, warning: 'El archivo trae macros (VBA). No se importan ni se ejecutan.' },
  { match: /^xl\/externalLinks\//i, warning: 'El archivo enlaza a otros libros. Esos enlaces no se siguen.' },
  { match: /^xl\/connections\.xml$/i, warning: 'El archivo tiene conexiones externas de datos. No se abren.' },
  { match: /^xl\/queryTables\//i, warning: 'El archivo usa Power Query. Se importan los valores, no las consultas.' },
  { match: /^xl\/pivotCache\//i, warning: 'El archivo tiene tablas dinámicas. Se importan los datos, no las tablas.' },
  { match: /^xl\/charts?\//i, warning: 'El archivo tiene gráficas embebidas. No se importan.' },
  { match: /^xl\/drawings\//i, warning: 'El archivo tiene objetos o imágenes. No se importan.' },
];

function readEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  let declared = 0;
  let count = 0;

  try {
    return unzipSync(bytes, {
      /**
       * Se filtra ANTES de descomprimir, igual que el importador de `.nexbook`.
       *
       * El `filter` de fflate recibe la cabecera de cada entrada, así que decide
       * sin haber gastado memoria. Sirve para dos cosas: saltarse lo que no se
       * va a leer —que en un libro con imágenes es casi todo el peso— y sumar
       * los tamaños DECLARADOS para parar un ZIP que se anuncia pequeño y ocupa
       * gigas. Un archivo que mienta declarando poco tampoco funciona: fflate
       * reserva la salida con el tamaño declarado y falla si el flujo produce
       * más.
       */
      filter: (file) => {
        count += 1;
        if (count > NEXBOOK_LIMITS.maxArchiveEntries) return false;
        if (!/^xl\/(workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/|_rels\/)/i.test(file.name)) {
          return false;
        }
        declared += file.originalSize ?? 0;
        return declared <= NEXBOOK_LIMITS.maxImportBytes;
      },
    });
  } catch {
    throw new XlsxRejected('Ese archivo no se pudo abrir: ¿es un .xlsx válido?');
  }
}

/** Los nombres de TODAS las entradas, para poder avisar de lo ignorado. */
function listNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    // Si no se puede ni listar, `readEntries` dará el error con nombre.
  }
  return names;
}

const text = (bytes: Uint8Array | undefined): string | null =>
  bytes ? new TextDecoder().decode(bytes) : null;

/** La tabla de cadenas compartidas, en orden. */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];

  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // Un `<si>` puede llevar varios `<t>` cuando el texto tiene formato mixto:
    // se concatenan, que es lo que Excel enseña en la celda.
    const parts = [...(item[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    strings.push(parts.map((part) => decodeXml(part[1] ?? '')).join(''));
  }

  return strings;
}

/** Los nombres de hoja y su archivo, en el orden del libro. */
function sheetTargets(workbookXml: string, relsXml: string | null): { name: string; target: string }[] {
  const targets = new Map<string, string>();
  for (const match of (relsXml ?? '').matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const sheets: { name: string; target: string }[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attribute(match[0], 'name') ?? '';
    const relationId =
      attribute(match[0], 'r:id') ?? attribute(match[0], 'relationshipId') ?? '';
    const target = targets.get(relationId);
    if (name && target) sheets.push({ name, target });
  }

  return sheets;
}

interface ParsedCell {
  row: number;
  column: number;
  input: string;
  /** La celda traía una fórmula que Nextudio no sabe convertir. */
  unsupportedFormula?: string;
}

/**
 * Las fórmulas de Excel que el motor propio entiende.
 *
 * La lista es corta a propósito: `lib/spreadsheet/formula.ts` implementa
 * aritmética, comparaciones, rangos y una veintena de funciones. Una fórmula que
 * no esté aquí **no se convierte ni se evalúa**: se guarda el VALOR que Excel
 * había calculado y se avisa. Inventar un resultado o intentar evaluar algo que
 * no se entiende son las dos formas de equivocarse en silencio.
 */
const SUPPORTED_FUNCTIONS = new Set([
  'SUM', 'SUMA', 'AVERAGE', 'PROMEDIO', 'MIN', 'MAX', 'COUNT', 'CONTAR',
  'COUNTA', 'CONTARA', 'IF', 'SI', 'ROUND', 'REDONDEAR', 'ABS', 'SQRT', 'RAIZ',
  'POWER', 'POTENCIA', 'MOD', 'RESIDUO', 'CONCATENATE', 'CONCATENAR', 'LEN',
  'LARGO', 'UPPER', 'MAYUSC', 'LOWER', 'MINUSC', 'TRIM', 'ESPACIOS',
]);

/** ¿Esta fórmula usa sólo cosas que el motor propio sabe evaluar? */
export function isConvertibleFormula(formula: string): boolean {
  // Cualquier referencia a otra hoja o a otro libro queda fuera: el motor no
  // tiene el concepto de «hoja Ventas» dentro de una fórmula.
  if (/[![\]]/.test(formula)) return false;
  for (const match of formula.matchAll(/([A-Za-zÁÉÍÓÚÑáéíóúñ_.]+)\s*\(/g)) {
    if (!SUPPORTED_FUNCTIONS.has((match[1] ?? '').toUpperCase())) return false;
  }
  return true;
}

function parseSheet(xml: string, strings: string[], dates: Set<number>): {
  cells: ParsedCell[];
  maxRow: number;
  maxColumn: number;
} {
  const cells: ParsedCell[] = [];
  let maxRow = 0;
  let maxColumn = 0;

  /**
   * La forma AUTOCERRADA va primero, y no es un detalle de estilo.
   *
   * Con la otra alternativa delante, `<c r="A3"/><c r="C3"><v>0</v></c>` se leía
   * como UNA celda: `[^>]*` se comía ` r="A3"/` y el `</c>` que cerraba lo
   * tomaba del cierre de la SEGUNDA, que desaparecía. El síntoma era una celda
   * que no estaba y otra con el valor de su vecina, que es peor que un error.
   */
  for (const match of xml.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
    const attributes = match[1] ?? match[2] ?? '';
    const body = match[3] ?? '';

    const reference = attribute(`<c ${attributes}>`, 'r');
    const address = reference ? parseAddress(reference) : null;
    if (!address) continue;

    const type = attribute(`<c ${attributes}>`, 't') ?? 'n';
    const styleIndex = Number(attribute(`<c ${attributes}>`, 's') ?? '-1');

    const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null;
    const inlineText = [...body.matchAll(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXml(part[1] ?? ''))
      .join('');
    const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? null;

    let input: string | null = null;
    let unsupportedFormula: string | undefined;

    if (formula !== null) {
      const decoded = decodeXml(formula);
      if (isConvertibleFormula(decoded)) {
        input = `=${decoded}`;
      } else {
        /**
         * Fórmula no soportada: se guarda el VALOR CACHEADO.
         *
         * El `.xlsx` distingue claramente las dos cosas —`<f>` es la fórmula y
         * `<v>` el último resultado que Excel calculó—, así que se puede
         * conservar el número sin fingir que Nextudio lo recalculó. Se avisa de
         * que ese valor no se va a actualizar si cambian sus datos.
         */
        unsupportedFormula = decoded;
        input = literalFrom(type, rawValue, inlineText, strings, styleIndex, dates);
      }
    } else {
      input = literalFrom(type, rawValue, inlineText, strings, styleIndex, dates);
    }

    if (input === null || input === '') continue;

    cells.push({ row: address.row, column: address.column, input, unsupportedFormula });
    maxRow = Math.max(maxRow, address.row + 1);
    maxColumn = Math.max(maxColumn, address.column + 1);
  }

  return { cells, maxRow, maxColumn };
}

function literalFrom(
  type: string,
  rawValue: string | null,
  inlineText: string,
  strings: string[],
  styleIndex: number,
  dates: Set<number>
): string | null {
  if (type === 'inlineStr') return inlineText;
  if (rawValue === null) return inlineText || null;

  const decoded = decodeXml(rawValue);

  if (type === 's') {
    const index = Number(decoded);
    return Number.isInteger(index) ? (strings[index] ?? '') : '';
  }
  if (type === 'b') return decoded === '1' ? 'VERDADERO' : 'FALSO';
  if (type === 'e') return decoded; // `#DIV/0!`, `#N/A`… tal cual lo dejó Excel.
  if (type === 'str') return decoded;

  // Numérico. Si su estilo es de fecha, se escribe como fecha legible.
  if (dates.has(styleIndex)) {
    const asDate = excelSerialToDate(Number(decoded));
    if (asDate) return asDate;
  }
  return decoded;
}

/**
 * Lee un `.xlsx` y devuelve una hoja de NexBook por cada hoja del libro.
 *
 * ## Una hoja de Excel → un `SpreadsheetBlock`
 *
 * Es la decisión con menor incompatibilidad, y no es arbitraria: el modelo ya
 * define `SpreadsheetBlock` como **una** rejilla con **un** nombre, y
 * `SpreadsheetBridge` resuelve por ese nombre —que es justo lo que `nex.sheet
 * ("Ventas")` necesita—. Meter varias hojas dentro de un bloque habría obligado
 * a cambiar `NexBookSheetData`, el editor, el renderizador de sólo lectura, la
 * lista blanca de publicación, el formato `.nexbook` y el puente, y a decidir qué
 * significa «el nombre del bloque» cuando dentro hay tres nombres más.
 *
 * Con un bloque por hoja no cambia ningún tipo, `NEXBOOK_FORMAT_VERSION` se
 * queda en 1, los `.nexbook` anteriores siguen valiendo y cada hoja conserva su
 * nombre de Excel, que es por el que la gente la va a buscar desde el código.
 */
export function readXlsx(bytes: Uint8Array): XlsxImportResult {
  if (bytes.byteLength > NEXBOOK_LIMITS.maxImportBytes) {
    throw new XlsxRejected(
      `Ese archivo supera ${Math.round(NEXBOOK_LIMITS.maxImportBytes / (1024 * 1024))} MB.`
    );
  }
  // «PK\x03\x04»: sin esto, un `.xls` antiguo o un CSV renombrado daría un error
  // de descompresión en vez de decir qué formato hace falta.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new XlsxRejected('Ese archivo no es un .xlsx. Si es un .xls antiguo, guárdalo como .xlsx.');
  }

  const names = listNames(bytes);
  const warnings: string[] = [];
  for (const part of IGNORED_PARTS) {
    if (names.some((name) => part.match.test(name))) warnings.push(part.warning);
  }

  const entries = readEntries(bytes);
  const workbookXml = text(entries['xl/workbook.xml']);
  if (!workbookXml) throw new XlsxRejected('Ese .xlsx no tiene libro: puede estar dañado.');

  const strings = sharedStrings(text(entries['xl/sharedStrings.xml']));
  const dates = dateStyles(text(entries['xl/styles.xml']));
  const targets = sheetTargets(workbookXml, text(entries['xl/_rels/workbook.xml.rels']));

  if (targets.length === 0) throw new XlsxRejected('Ese .xlsx no tiene ninguna hoja legible.');

  let kept = targets;
  if (targets.length > NEXBOOK_LIMITS.maxImportSheets) {
    warnings.push(
      `El libro trae ${targets.length} hojas y se importan hasta ${NEXBOOK_LIMITS.maxImportSheets}.`
    );
    kept = targets.slice(0, NEXBOOK_LIMITS.maxImportSheets);
  }

  const sheets: XlsxSheet[] = [];
  const unsupported = new Set<string>();

  for (const target of kept) {
    const sheetXml = text(entries[`xl/${target.target}`]);
    if (!sheetXml) continue;

    const parsed = parseSheet(sheetXml, strings, dates);
    const rows = Math.min(parsed.maxRow, NEXBOOK_LIMITS.maxSheetRows);
    const columns = Math.min(parsed.maxColumn, NEXBOOK_LIMITS.maxSheetColumns);

    if (parsed.maxRow > rows) {
      warnings.push(
        `La hoja "${target.name}" trae ${parsed.maxRow} filas y una hoja admite ${NEXBOOK_LIMITS.maxSheetRows}. Se importaron las primeras.`
      );
    }
    if (parsed.maxColumn > columns) {
      warnings.push(
        `La hoja "${target.name}" trae ${parsed.maxColumn} columnas y una hoja admite ${NEXBOOK_LIMITS.maxSheetColumns}.`
      );
    }

    const cells: NexBookSheetData['cells'] = {};
    let written = 0;

    for (const cell of parsed.cells) {
      if (cell.row >= rows || cell.column >= columns) continue;
      if (written >= NEXBOOK_LIMITS.maxSheetCells) break;
      if (cell.unsupportedFormula) unsupported.add(cell.unsupportedFormula);
      cells[cellKey(cell.row, cell.column)] = { input: cell.input };
      written += 1;
    }

    // El nombre es el del LIBRO («Ventas»), no el del archivo interno
    // («worksheets/sheet1.xml»): es por el que la gente la busca desde el código.
    sheets.push({
      name: target.name,
      sheet: { rows: Math.max(rows, 1), columns: Math.max(columns, 1), cells },
      totalRows: parsed.maxRow,
    });
  }

  if (unsupported.size > 0) {
    const sample = [...unsupported].slice(0, 3).map((formula) => `=${formula}`).join(', ');
    warnings.push(
      `Hay ${unsupported.size} fórmula${unsupported.size === 1 ? '' : 's'} que Nextudio no sabe recalcular (${sample}). ` +
        'Se guardó el último valor que calculó Excel, y NO se actualizará si cambias los datos.'
    );
  }

  if (sheets.length === 0) throw new XlsxRejected('Ese .xlsx no tiene ninguna hoja con datos.');

  return { sheets, warnings };
}
