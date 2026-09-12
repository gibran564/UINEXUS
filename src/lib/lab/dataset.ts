import type { NexBookImageMimeType } from '../types';

/**
 * Lo ÚNICO que puede cruzar hacia el Worker desde el NexBook.
 *
 * ## Por qué es un tipo cerrado y pobre
 *
 * Es el mismo argumento que sostiene `CodeWorkerRequest`: el código que corre al
 * otro lado lo escribió una persona que está resolviendo una tarea, y no tiene
 * por qué merecer confianza. Si este tipo admitiera un `Record<string, unknown>`
 * —o un bloque del documento tal cual—, el día que un bloque gane un campo con
 * una clave de S3, un uid o una URL firmada, ese campo viajaría al Worker sin
 * que nadie tuviera que hacer nada.
 *
 * Aquí no hay hueco donde meterlo. Una hoja son columnas y filas de primitivos;
 * una imagen son bytes en Base64 y su tipo; un output son columnas y filas. No
 * hay `assetId`, no hay `blockId` de origen más allá del identificador que el
 * propio código pidió, no hay URL, no hay ruta y no hay token.
 *
 * ## Qué NO viaja, y por qué importa decirlo
 *
 * - **Ninguna URL firmada.** Los bytes de una imagen los descarga el HILO
 *   PRINCIPAL por la ruta autorizada de siempre, y al Worker llega el contenido.
 *   Mandar la URL habría convertido un permiso de cinco minutos en una capacidad
 *   del sandbox, y habría necesitado que el Worker pudiera hacer `fetch`.
 * - **Ninguna clave de S3.** Ver arriba: no existe el campo.
 * - **Nada que no se haya pedido.** El catálogo lleva nombres y dimensiones; los
 *   datos sólo de lo que la celda referencia. Ver `lib/lab/references.ts`.
 */

/** Un valor de celda. Sólo primitivos: una hoja no anida documentos. */
export type LabCell = string | number | boolean | null;

/** Una tabla, sea una hoja o el resultado persistido de una celda. */
export interface LabTable {
  /** El `blockId`, que es la referencia ESTABLE. Mover el bloque no lo cambia. */
  id: string;
  /** El nombre humano, si lo tiene. Puede estar vacío. */
  name: string;
  columns: string[];
  rows: LabCell[][];
}

export interface LabImage {
  id: string;
  name: string;
  mimeType: NexBookImageMimeType;
  /** Los BYTES, en Base64. Nunca una URL. */
  base64: string;
}

/**
 * Qué hay en el documento, sin los datos.
 *
 * Viaja SIEMPRE y es diminuto: nombres, ids y dimensiones. Existe para que
 * `nex.sheets()` pueda listar lo disponible y, sobre todo, para que un error
 * pueda decir «no hay ninguna hoja llamada "Ventas"; las que hay son
 * "ventas 2026" y "Costos"». Un error que no dice las alternativas obliga a
 * adivinar.
 */
export interface LabCatalogEntry {
  id: string;
  name: string;
  rows: number;
  columns: number;
}

export interface LabCatalog {
  sheets: LabCatalogEntry[];
  images: { id: string; name: string }[];
  outputs: { id: string; name: string; rows: number; columns: number }[];
}

/** Lo que se prepara para UNA ejecución. */
export interface LabDataset {
  catalog: LabCatalog;
  sheets: LabTable[];
  images: LabImage[];
  outputs: LabTable[];
  /**
   * Problemas encontrados al resolver, en lenguaje humano.
   *
   * Viajan al Worker y el runtime los convierte en el mensaje de error de la
   * función correspondiente. No se lanza antes de ejecutar porque una celda
   * puede referenciar una hoja dentro de un `if` que no se cumple: abortar la
   * ejecución entera por eso sería equivocarse en la dirección cara.
   */
  problems: LabProblem[];
}

export interface LabProblem {
  kind: 'sheet' | 'image' | 'output';
  /** Lo que pidió el código, tal cual. */
  reference: string;
  message: string;
}

export const EMPTY_LAB_DATASET: LabDataset = {
  catalog: { sheets: [], images: [], outputs: [] },
  sheets: [],
  images: [],
  outputs: [],
  problems: [],
};
