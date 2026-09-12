import type { ProgrammingLanguage } from '../types';

/**
 * Qué recursos del NexBook pide UNA celda de código.
 *
 * ## Por qué se lee el fuente en vez de mandarlo todo
 *
 * Porque mandarlo todo no es aceptable. Un NexBook puede llevar cien imágenes de
 * cuatro megas y varias hojas de dos mil celdas; serializar eso hacia el Worker
 * en cada ejecución duplicaría decenas de megabytes en memoria para que el
 * programa leyera una sola hoja. La regla de la Fase 3.5 es explícita: los datos
 * se transfieren **bajo demanda**.
 *
 * Para saber qué hace falta ANTES de ejecutar hay dos caminos. El otro —que el
 * Worker pida los datos a mitad de ejecución— exige comunicación síncrona con el
 * hilo principal, y eso en la práctica significa `SharedArrayBuffer` y
 * `Atomics.wait`, que a su vez exigen aislamiento por origen (COOP/COEP) que
 * Nextudio no tiene. Este camino es el que funciona sin cambiar la arquitectura.
 *
 * ## La consecuencia, dicha en voz alta
 *
 * Sólo se resuelven referencias **literales**. Esto funciona:
 *
 * ```python
 * ventas = nex.sheet("Ventas")
 * ```
 *
 * y esto NO:
 *
 * ```python
 * nombre = "Ventas"
 * ventas = nex.sheet(nombre)      # el escáner no puede saber qué vale `nombre`
 * ```
 *
 * El segundo caso no devuelve datos equivocados: devuelve un error que dice
 * exactamente esto y nombra las hojas disponibles. Un fallo explicado es
 * aceptable; uno silencioso que devuelve una hoja vacía, no.
 *
 * ## Qué NO es este módulo
 *
 * No es un analizador de Python ni de R. Es un buscador de llamadas literales, y
 * por eso puede equivocarse en la dirección SEGURA: si encuentra `nex.sheet("X")`
 * dentro de un comentario o de una cadena, prepara una hoja que nadie va a usar.
 * Eso cuesta unos kilobytes. Lo contrario —no encontrar una llamada que sí se
 * ejecuta— produce un error, no un dato falso.
 */

/** Los recursos que una ejecución dice necesitar, por nombre o por id. */
export interface LabReferences {
  sheets: string[];
  images: string[];
  outputs: string[];
  /**
   * El fuente menciona la API con un argumento que no es una cadena literal.
   *
   * Se registra para poder explicarlo: sin esto, el programa fallaría con
   * «hoja no encontrada» y quien lo escribió buscaría un error en el nombre.
   */
  dynamic: boolean;
}

export const EMPTY_REFERENCES: LabReferences = {
  sheets: [],
  images: [],
  outputs: [],
  dynamic: false,
};

/**
 * Los nombres de la API, por lenguaje.
 *
 * Python usa un objeto (`nex.sheet`) y R funciones sueltas (`nex_sheet`) porque
 * es lo natural en cada uno: en R no hay un objeto global con métodos que se
 * lea bien, y forzar `nex$sheet()` sería escribir Python con sintaxis de R.
 * Lo que sí es igual en los dos es el vocabulario —sheet, image, output— y que
 * exista una variante `_by_id`.
 */
const API = {
  python: { prefix: 'nex\\.', sheet: 'sheet', image: 'image', output: 'output' },
  r: { prefix: 'nex_', sheet: 'sheet', image: 'image', output: 'output' },
} as const;

/** El separador de la API para este lenguaje, o `null` si no tiene runtime. */
export function labApiFlavor(language: ProgrammingLanguage): 'python' | 'r' | null {
  if (language === 'python') return 'python';
  if (language === 'r') return 'r';
  return null;
}

/**
 * Busca las llamadas de un tipo y devuelve sus argumentos literales.
 *
 * Acepta `"..."` y `'...'`, con o sin espacios alrededor del paréntesis, y la
 * variante `_by_id`. Devuelve además si vio una llamada cuyo argumento no es un
 * literal.
 */
function collect(
  source: string,
  prefix: string,
  verb: string
): { literals: string[]; dynamic: boolean } {
  const literals: string[] = [];
  let dynamic = false;

  // `(?:_by_id)?` cubre las dos formas con la misma pasada: lo que cambia entre
  // ellas es cómo se RESUELVE el argumento, no cómo se encuentra.
  const call = new RegExp(`${prefix}${verb}(?:_by_id)?\\s*\\(\\s*([^)]*?)\\s*\\)`, 'g');

  for (const match of source.matchAll(call)) {
    const argument = (match[1] ?? '').trim();
    const literal = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1$/.exec(argument);
    if (literal) {
      // Se deshacen sólo los escapes que una persona escribe de verdad en un
      // nombre de hoja. No es un analizador de literales: es un nombre.
      literals.push((literal[2] ?? '').replace(/\\(["'\\])/g, '$1'));
    } else if (argument) {
      dynamic = true;
    }
  }

  return { literals, dynamic };
}

/** Lo que esta celda pide, sin ejecutarla. */
export function scanLabReferences(
  source: string,
  language: ProgrammingLanguage
): LabReferences {
  const flavor = labApiFlavor(language);
  if (!flavor || !source) return EMPTY_REFERENCES;

  const { prefix } = API[flavor];
  const sheets = collect(source, prefix, API[flavor].sheet);
  const images = collect(source, prefix, API[flavor].image);
  const outputs = collect(source, prefix, API[flavor].output);

  return {
    sheets: unique(sheets.literals),
    images: unique(images.literals),
    outputs: unique(outputs.literals),
    dynamic: sheets.dynamic || images.dynamic || outputs.dynamic,
  };
}

/** ¿Esta celda menciona la API del laboratorio para algo? */
export function usesLabApi(references: LabReferences): boolean {
  return (
    references.dynamic ||
    references.sheets.length > 0 ||
    references.images.length > 0 ||
    references.outputs.length > 0
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
