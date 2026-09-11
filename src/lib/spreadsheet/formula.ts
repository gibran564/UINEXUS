import { cellKey, formatReference, parseRange, parseReference, rawCell } from './cells';
import type { CellAddress } from './cells';
import type { NexBookSheetData } from '../types';

/**
 * El motor de fórmulas de la hoja.
 *
 * ## Por qué un intérprete propio y no `eval`
 *
 * Porque las fórmulas las escribe el alumnado y se guardan en un documento que
 * otra persona puede abrir. Convertir `=A1+B2` en JavaScript y evaluarlo sería
 * ejecutar texto de terceros en la sesión de quien lo lee: exactamente el
 * agujero que el resto de UINexus evita renderizando Markdown sin HTML crudo.
 *
 * Este intérprete sólo sabe hacer aritmética y llamar a las funciones de una
 * lista cerrada. No hay acceso a variables, ni a objetos del navegador, ni forma
 * de escribir una llamada que no esté en `FUNCTIONS`.
 *
 * ## Qué hace y qué no
 *
 * Hace: números, texto, referencias, rangos, `+ - * / ^ %`, paréntesis,
 * comparaciones y una veintena de funciones con nombre en español y en inglés.
 *
 * No hace: referencias entre hojas, matrices, formato condicional, macros. La
 * frontera está donde deja de ser «calcular con los datos que hay delante» y
 * empieza a ser «programar dentro de una celda», que para eso hay bloques de
 * código al lado.
 */

export type CellValue = number | string | boolean | null;

/** Un error de fórmula, con la forma que espera quien ha usado una hoja. */
export type FormulaError = '#REF!' | '#VALOR!' | '#DIV/0!' | '#NOMBRE?' | '#CICLO!';

const ERRORS: readonly string[] = ['#REF!', '#VALOR!', '#DIV/0!', '#NOMBRE?', '#CICLO!'];

export function isFormulaError(value: CellValue): value is FormulaError {
  return typeof value === 'string' && ERRORS.includes(value);
}

/** ¿Lo escrito es una fórmula? */
export function isFormula(input: string): boolean {
  return input.trimStart().startsWith('=');
}

/**
 * El valor de cada celda con contenido de la hoja.
 *
 * Se calcula la hoja ENTERA de una vez y no celda a celda bajo demanda. Con
 * dependencias encadenadas —`C1` usa `B1`, que usa `A1`— resolver por separado
 * repite trabajo exponencialmente; aquí una memoria compartida hace que cada
 * celda se evalúe una sola vez.
 */
export function evaluateSheet(sheet: NexBookSheetData): Map<string, CellValue> {
  const values = new Map<string, CellValue>();
  const visiting = new Set<string>();

  for (const key of Object.keys(sheet.cells)) {
    const [row, column] = key.split(':').map(Number);
    if (row === undefined || column === undefined) continue;
    evaluateCell(sheet, { row, column }, values, visiting);
  }

  return values;
}

/** El valor de UNA celda, resolviendo lo que necesite por el camino. */
export function evaluateCell(
  sheet: NexBookSheetData,
  address: CellAddress,
  values: Map<string, CellValue> = new Map(),
  visiting: Set<string> = new Set()
): CellValue {
  const key = cellKey(address.row, address.column);
  const cached = values.get(key);
  if (cached !== undefined) return cached;

  /**
   * Una referencia circular se corta AQUÍ.
   *
   * `A1 = B1 + 1` y `B1 = A1 + 1` es una recursión infinita, y sin este corte
   * lo que se agota es la pila del navegador de quien abre el documento. Se
   * devuelve `#CICLO!`, que además dice qué pasó.
   */
  if (visiting.has(key)) return '#CICLO!';

  const input = rawCell(sheet, address);
  if (!input) return null;

  if (!isFormula(input)) {
    /**
     * Los literales TAMBIÉN se guardan en la memoria.
     *
     * No es una optimización: quien lee la hoja entera —el puente, la vista de
     * lectura— recorre el mapa de valores, y una celda que se calcula pero no se
     * guarda sale como vacía. El síntoma era una columna de datos escritos a
     * mano que el puente devolvía llena de `null` mientras las fórmulas de al
     * lado funcionaban.
     */
    const value = literal(input);
    values.set(key, value);
    return value;
  }

  visiting.add(key);
  try {
    const result = new Parser(input.trimStart().slice(1), sheet, values, visiting).evaluate();
    values.set(key, result);
    return result;
  } catch {
    values.set(key, '#VALOR!');
    return '#VALOR!';
  } finally {
    visiting.delete(key);
  }
}

/**
 * Lo escrito, interpretado como dato.
 *
 * Un número escrito se guarda como texto y se lee como número, que es lo que
 * permite sumarlo. `007` se queda en texto a propósito: quien escribe ceros a la
 * izquierda casi siempre está escribiendo un código, no un número.
 */
export function literal(input: string): CellValue {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    if (/^-?0\d/.test(trimmed)) return input;
    return Number(trimmed);
  }
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return Number(trimmed.slice(0, -1)) / 100;
  return input;
}

/** El texto que se enseña en la rejilla. */
export function formatValue(value: CellValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'VERDADERO' : 'FALSO';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#VALOR!';
    // Los decimales se recortan a diez posiciones para que 0.1 + 0.2 no salga
    // como 0.30000000000000004 delante de alguien que está aprendiendo.
    return String(Math.round(value * 1e10) / 1e10);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Intérprete
// ---------------------------------------------------------------------------

/**
 * Descenso recursivo sobre la cadena, sin fase de tokenización aparte.
 *
 * La gramática es pequeña —comparación, suma, producto, potencia, unario,
 * primario— y con ella la precedencia queda expresada por la propia estructura
 * de llamadas en vez de por una tabla que haya que consultar.
 */
class Parser {
  private position = 0;

  constructor(
    private readonly source: string,
    private readonly sheet: NexBookSheetData,
    private readonly values: Map<string, CellValue>,
    private readonly visiting: Set<string>
  ) {}

  evaluate(): CellValue {
    const value = this.comparison();
    this.skipSpaces();
    if (this.position < this.source.length) return '#VALOR!';
    return value;
  }

  private comparison(): CellValue {
    let left = this.sum();

    for (;;) {
      this.skipSpaces();
      const operator = ['<=', '>=', '<>', '=', '<', '>'].find((candidate) =>
        this.source.startsWith(candidate, this.position)
      );
      if (!operator) return left;

      this.position += operator.length;
      const right = this.sum();
      if (isFormulaError(left)) return left;
      if (isFormulaError(right)) return right;
      left = compare(operator, left, right);
    }
  }

  private sum(): CellValue {
    let left = this.product();

    for (;;) {
      this.skipSpaces();
      const operator = this.source[this.position];
      if (operator !== '+' && operator !== '-' && operator !== '&') return left;

      this.position += 1;
      const right = this.product();
      if (isFormulaError(left)) return left;
      if (isFormulaError(right)) return right;

      if (operator === '&') {
        left = `${formatValue(left)}${formatValue(right)}`;
        continue;
      }
      const a = toNumber(left);
      const b = toNumber(right);
      if (a === null || b === null) return '#VALOR!';
      left = operator === '+' ? a + b : a - b;
    }
  }

  private product(): CellValue {
    let left = this.power();

    for (;;) {
      this.skipSpaces();
      const operator = this.source[this.position];
      if (operator !== '*' && operator !== '/') return left;

      this.position += 1;
      const right = this.power();
      if (isFormulaError(left)) return left;
      if (isFormulaError(right)) return right;

      const a = toNumber(left);
      const b = toNumber(right);
      if (a === null || b === null) return '#VALOR!';
      if (operator === '/' && b === 0) return '#DIV/0!';
      left = operator === '*' ? a * b : a / b;
    }
  }

  private power(): CellValue {
    const left = this.unary();
    this.skipSpaces();
    if (this.source[this.position] !== '^') return left;

    this.position += 1;
    const right = this.power();
    if (isFormulaError(left)) return left;
    if (isFormulaError(right)) return right;

    const a = toNumber(left);
    const b = toNumber(right);
    if (a === null || b === null) return '#VALOR!';
    return a ** b;
  }

  private unary(): CellValue {
    this.skipSpaces();
    const sign = this.source[this.position];
    if (sign === '-' || sign === '+') {
      this.position += 1;
      const value = this.unary();
      if (isFormulaError(value)) return value;
      const number = toNumber(value);
      if (number === null) return '#VALOR!';
      return sign === '-' ? -number : number;
    }
    return this.primary();
  }

  private primary(): CellValue {
    this.skipSpaces();

    if (this.source[this.position] === '(') {
      this.position += 1;
      const value = this.comparison();
      this.skipSpaces();
      if (this.source[this.position] !== ')') return '#VALOR!';
      this.position += 1;
      return value;
    }

    if (this.source[this.position] === '"') return this.text();

    const number = /^\d+(\.\d+)?/.exec(this.source.slice(this.position));
    if (number) {
      this.position += number[0].length;
      if (this.source[this.position] === '%') {
        this.position += 1;
        return Number(number[0]) / 100;
      }
      return Number(number[0]);
    }

    return this.nameOrReference();
  }

  private text(): CellValue {
    this.position += 1;
    let value = '';
    while (this.position < this.source.length) {
      const character = this.source[this.position]!;
      this.position += 1;
      // Dos comillas seguidas dentro del texto son una comilla literal, como en
      // cualquier hoja de cálculo.
      if (character === '"') {
        if (this.source[this.position] === '"') {
          value += '"';
          this.position += 1;
          continue;
        }
        return value;
      }
      value += character;
    }
    return '#VALOR!';
  }

  private nameOrReference(): CellValue {
    const match = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(this.source.slice(this.position));
    if (!match) return '#VALOR!';

    const name = match[0];
    this.position += name.length;
    this.skipSpaces();

    if (this.source[this.position] === '(') return this.call(name);

    // ¿Un rango, `A1:B4`?
    if (this.source[this.position] === ':') {
      const rest = /^:\$?[A-Za-z]{1,3}\$?\d{1,5}/.exec(this.source.slice(this.position));
      if (rest) {
        this.position += rest[0].length;
        const addresses = parseRange(`${name}${rest[0]}`);
        if (!addresses) return '#REF!';
        // Un rango fuera de una función no es un valor: `=A1:B2 + 1` no
        // significa nada, y decirlo es mejor que sumar la primera celda en
        // silencio.
        return addresses.length === 1 ? this.cell(addresses[0]!) : '#VALOR!';
      }
    }

    const upper = name.toUpperCase();
    if (upper === 'VERDADERO' || upper === 'TRUE') return true;
    if (upper === 'FALSO' || upper === 'FALSE') return false;

    const address = parseReference(name);
    if (!address) return '#NOMBRE?';
    return this.cell(address);
  }

  private cell(address: CellAddress): CellValue {
    if (address.row >= this.sheet.rows || address.column >= this.sheet.columns) return '#REF!';
    return evaluateCell(this.sheet, address, this.values, this.visiting);
  }

  /** Una llamada a función. Los argumentos pueden ser rangos. */
  private call(name: string): CellValue {
    this.position += 1;
    const fn = FUNCTIONS[name.toUpperCase()];
    const args: CellValue[][] = [];

    this.skipSpaces();
    if (this.source[this.position] === ')') {
      this.position += 1;
    } else {
      for (;;) {
        args.push(this.argument());
        this.skipSpaces();
        const next = this.source[this.position];
        this.position += 1;
        if (next === ')') break;
        if (next !== ';' && next !== ',') return '#VALOR!';
      }
    }

    // La función desconocida se comprueba DESPUÉS de consumir los argumentos:
    // así la posición queda coherente y el error es `#NOMBRE?` y no un
    // `#VALOR!` por texto sobrante.
    if (!fn) return '#NOMBRE?';
    return fn(args);
  }

  /** Un argumento: o un rango, que se expande, o un valor suelto. */
  private argument(): CellValue[] {
    this.skipSpaces();
    const range = /^\$?[A-Za-z]{1,3}\$?\d{1,5}:\$?[A-Za-z]{1,3}\$?\d{1,5}/.exec(
      this.source.slice(this.position)
    );

    if (range) {
      this.position += range[0].length;
      const addresses = parseRange(range[0]);
      if (!addresses) return ['#REF!'];
      return addresses.map((address) => this.cell(address));
    }

    return [this.comparison()];
  }

  private skipSpaces(): void {
    while (this.source[this.position] === ' ') this.position += 1;
  }
}

function compare(operator: string, left: CellValue, right: CellValue): boolean {
  const a = toNumber(left);
  const b = toNumber(right);
  const comparable = a !== null && b !== null;
  const x: number | string = comparable ? a : formatValue(left);
  const y: number | string = comparable ? b! : formatValue(right);

  switch (operator) {
    case '=':
      return x === y;
    case '<>':
      return x !== y;
    case '<':
      return x < y;
    case '>':
      return x > y;
    case '<=':
      return x <= y;
    default:
      return x >= y;
  }
}

/** Un valor como número, o `null` si no lo es. Las celdas vacías son cero. */
function toNumber(value: CellValue): number | null {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (isFormulaError(value)) return null;

  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Sólo lo numérico de una lista. Es lo que ignoran SUMA y PROMEDIO del texto. */
function numbers(args: CellValue[][]): number[] | FormulaError {
  const found: number[] = [];
  for (const group of args) {
    for (const value of group) {
      if (isFormulaError(value)) return value;
      if (value === null || value === '') continue;
      if (typeof value === 'string' && Number.isNaN(Number(value.trim()))) continue;
      const parsed = toNumber(value);
      if (parsed !== null) found.push(parsed);
    }
  }
  return found;
}

function first(args: CellValue[][], index: number): CellValue {
  return args[index]?.[0] ?? null;
}

/**
 * Las funciones disponibles.
 *
 * Con nombre en español Y en inglés apuntando a la misma implementación: quien
 * ha usado Excel en español escribe `SUMA` y quien siguió un tutorial escribe
 * `SUM`, y hacer que una de las dos falle sólo enseña a desconfiar de la
 * herramienta.
 */
const FUNCTIONS: Record<string, (args: CellValue[][]) => CellValue> = {};

function define(names: string[], fn: (args: CellValue[][]) => CellValue): void {
  for (const name of names) FUNCTIONS[name] = fn;
}

define(['SUMA', 'SUM'], (args) => {
  const values = numbers(args);
  return Array.isArray(values) ? values.reduce((total, value) => total + value, 0) : values;
});

define(['PROMEDIO', 'AVERAGE', 'MEDIA'], (args) => {
  const values = numbers(args);
  if (!Array.isArray(values)) return values;
  if (values.length === 0) return '#DIV/0!';
  return values.reduce((total, value) => total + value, 0) / values.length;
});

define(['MIN'], (args) => {
  const values = numbers(args);
  if (!Array.isArray(values)) return values;
  return values.length === 0 ? 0 : Math.min(...values);
});

define(['MAX'], (args) => {
  const values = numbers(args);
  if (!Array.isArray(values)) return values;
  return values.length === 0 ? 0 : Math.max(...values);
});

define(['CONTAR', 'COUNT'], (args) => {
  const values = numbers(args);
  return Array.isArray(values) ? values.length : values;
});

define(['CONTARA', 'COUNTA'], (args) =>
  args.reduce(
    (total, group) => total + group.filter((value) => value !== null && value !== '').length,
    0
  )
);

define(['SI', 'IF'], (args) => {
  const condition = first(args, 0);
  if (isFormulaError(condition)) return condition;
  const truthy =
    typeof condition === 'boolean' ? condition : condition !== null && toNumber(condition) !== 0;
  const branch = truthy ? first(args, 1) : first(args, 2);
  return branch ?? (truthy ? true : false);
});

define(['REDONDEAR', 'ROUND'], (args) => {
  const value = toNumber(first(args, 0));
  const digits = toNumber(first(args, 1)) ?? 0;
  if (value === null) return '#VALOR!';
  const factor = 10 ** Math.trunc(digits);
  return Math.round(value * factor) / factor;
});

define(['ABS'], (args) => {
  const value = toNumber(first(args, 0));
  return value === null ? '#VALOR!' : Math.abs(value);
});

define(['RAIZ', 'SQRT'], (args) => {
  const value = toNumber(first(args, 0));
  if (value === null) return '#VALOR!';
  return value < 0 ? '#VALOR!' : Math.sqrt(value);
});

define(['POTENCIA', 'POWER'], (args) => {
  const base = toNumber(first(args, 0));
  const exponent = toNumber(first(args, 1));
  if (base === null || exponent === null) return '#VALOR!';
  return base ** exponent;
});

define(['ENTERO', 'INT'], (args) => {
  const value = toNumber(first(args, 0));
  return value === null ? '#VALOR!' : Math.floor(value);
});

define(['CONCATENAR', 'CONCAT'], (args) =>
  args.map((group) => group.map(formatValue).join('')).join('')
);

define(['LARGO', 'LEN'], (args) => formatValue(first(args, 0)).length);

define(['MAYUSC', 'UPPER'], (args) => formatValue(first(args, 0)).toUpperCase());

define(['MINUSC', 'LOWER'], (args) => formatValue(first(args, 0)).toLowerCase());

define(['MEDIANA', 'MEDIAN'], (args) => {
  const values = numbers(args);
  if (!Array.isArray(values)) return values;
  if (values.length === 0) return '#DIV/0!';
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
});

define(['DESVEST', 'STDEV'], (args) => {
  const values = numbers(args);
  if (!Array.isArray(values)) return values;
  if (values.length < 2) return '#DIV/0!';
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
});

/** Los nombres que la interfaz puede ofrecer como ayuda. */
export const FORMULA_NAMES: readonly string[] = Object.keys(FUNCTIONS).sort();

export { formatReference };
