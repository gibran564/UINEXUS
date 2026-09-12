import { createSpreadsheetBridge } from '../spreadsheet/bridge';
import { normalizeForSearch } from '../search';
import { NEXBOOK_LIMITS } from '../constants';
import type { NexBookDocument, NexBookImageMimeType } from '../types';
import type {
  LabCatalog,
  LabCell,
  LabDataset,
  LabImage,
  LabProblem,
  LabTable,
} from './dataset';
import type { LabReferences } from './references';

/**
 * NexLab Data Bridge: del documento al kernel.
 *
 * ```
 * NexBook
 * ├── SpreadsheetBlock ─┐
 * ├── ImageBlock ───────┤
 * ├── results (outputs) ┤
 * │                     ▼
 * │             NexLab Data Bridge      ← este archivo
 * │                     │
 * │              NotebookKernel
 * │              ├── Python
 * │              └── R
 * └── resultados
 * ```
 *
 * ## Reutiliza `SpreadsheetBridge`, no lo sustituye
 *
 * Las hojas se leen con `createSpreadsheetBridge`, que ya existía y ya estaba
 * probado: sabe evaluar fórmulas, deducir encabezados y devolver valores
 * calculados. Escribir un segundo lector habría significado dos definiciones de
 * «el valor de B2», y el día que cambiara el redondeo cambiaría una.
 *
 * Lo que este módulo AÑADE es lo que faltaba para poder conectarlo a un kernel:
 *
 *  1. **Resolución con identidad estable y duplicados explícitos.** El bridge
 *     resuelve por id o por nombre y, ante dos hojas con el mismo nombre, se
 *     queda con la primera. Para pintar una interfaz da igual; para decidir qué
 *     datos ve un programa, no: elegir en silencio significa que añadir una hoja
 *     cambia el resultado de una celda que nadie tocó. Aquí un nombre ambiguo es
 *     un ERROR con las dos candidatas escritas.
 *  2. **Traducción a un tipo cerrado** (`LabDataset`), que es lo único que puede
 *     cruzar al Worker.
 *  3. **Resolución BAJO DEMANDA**: sólo lo que la celda referencia.
 *
 * ## Identidad: `blockId` manda, el nombre es comodidad
 *
 * Una referencia por `blockId` no se rompe nunca: no depende del orden de los
 * bloques, ni del nombre, ni de que alguien inserte una hoja encima. Mover un
 * bloque dentro del NexBook **no** puede romper `Spreadsheet → Python`, y hay
 * una prueba que lo fija.
 *
 * El nombre existe porque `nex.sheet("Ventas")` es lo que una persona escribe.
 * Se resuelve sin acentos ni mayúsculas —igual que la búsqueda de la Fase 2— y
 * si hay empate, se para.
 */

/** Cuántas filas de una hoja o de un output se entregan al código. */
const MAX_ROWS = NEXBOOK_LIMITS.maxLabRows;

export interface ResolveLabDatasetOptions {
  /**
   * Descarga los bytes de un asset, EN EL HILO PRINCIPAL.
   *
   * El Worker no descarga nada: no tiene `fetch`, y ésa es la barrera. Esta
   * función la proporciona quien tiene sesión —Studio—, usa la ruta autorizada
   * de siempre (`/api/nexbooks/:id/assets/:assetId`, que comprueba que el
   * documento referencia el asset) y devuelve el contenido ya en Base64.
   *
   * Ausente significa «este contexto no puede leer assets»: las imágenes se
   * resuelven entonces como un problema explicado, no como una imagen vacía.
   */
  loadAsset?: (assetId: string, mimeType: NexBookImageMimeType) => Promise<string>;
}

/**
 * Sin acentos y en minúsculas, CONSERVANDO la eñe.
 *
 * Es exactamente `normalizeForSearch`, y se REUTILIZA en vez de copiarse. La
 * eñe se protege antes de descomponer porque NFD la parte en `n` + tilde y el
 * filtro de acentos la aplanaría, convirtiendo «Año» en «ano». Esa regla se
 * decidió en la Fase 2; tener dos copias garantizaría que una se quedara atrás,
 * y aquí la que decide qué datos ve un programa es ésta.
 */
const normalize = normalizeForSearch;

/** El catálogo: nombres y dimensiones, nunca datos. */
export function labCatalog(document: NexBookDocument): LabCatalog {
  const bridge = createSpreadsheetBridge(document);

  return {
    sheets: bridge.list().map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      rows: sheet.rows,
      columns: sheet.columns,
    })),
    images: document.blocks.flatMap((block) =>
      block.type === 'image' && block.assetId
        ? [{ id: block.id, name: block.alt || block.caption || '' }]
        : []
    ),
    outputs: Object.values(document.results).flatMap((result) => {
      const table = firstTable(result.outputs);
      if (!table) return [];
      return [
        {
          id: result.blockId,
          name: blockName(document, result.blockId),
          rows: table.rows.length,
          columns: table.columns.length,
        },
      ];
    }),
  };
}

function firstTable(outputs: NexBookDocument['results'][string]['outputs']) {
  for (const output of outputs) {
    if (output.stream === 'table') return output;
  }
  return null;
}

/** Cómo llamar a un bloque cuando hay que nombrarlo en un mensaje. */
function blockName(document: NexBookDocument, blockId: string): string {
  const block = document.blocks.find((item) => item.id === blockId);
  if (!block) return '';
  if (block.type === 'spreadsheet') return block.name;
  if (block.type === 'image') return block.alt || '';
  return '';
}

/**
 * Resuelve una referencia contra una lista de candidatos.
 *
 * Primero por id EXACTO —que es la referencia estable y nunca es ambigua,
 * porque el esquema ya garantiza ids únicos dentro del documento— y sólo
 * después por nombre normalizado. Dos candidatos con el mismo nombre producen un
 * error que los nombra a los dos.
 */
function resolveOne<T extends { id: string; name: string }>(
  reference: string,
  candidates: readonly T[],
  kind: LabProblem['kind']
): { value: T } | { problem: LabProblem } {
  const byId = candidates.find((candidate) => candidate.id === reference);
  if (byId) return { value: byId };

  const needle = normalize(reference);
  const matches = candidates.filter((candidate) => normalize(candidate.name) === needle);

  if (matches.length === 1) return { value: matches[0]! };

  if (matches.length > 1) {
    return {
      problem: {
        kind,
        reference,
        message:
          `Hay ${matches.length} bloques llamados "${reference}". ` +
          'Los nombres se resuelven sin distinguir mayúsculas ni acentos, así que ' +
          'cambia uno o usa su identificador: ' +
          matches.map((match) => `"${match.id}"`).join(', ') +
          '.',
      },
    };
  }

  const available = candidates
    .map((candidate) => (candidate.name ? `"${candidate.name}"` : `"${candidate.id}"`))
    .join(', ');

  return {
    problem: {
      kind,
      reference,
      message: available
        ? `No hay ningún bloque llamado "${reference}". Disponibles: ${available}.`
        : `No hay ningún bloque de ese tipo en este NexBook, así que "${reference}" no existe.`,
    },
  };
}

/**
 * Los booleanos escritos a mano, inferidos SÓLO al cruzar hacia el código.
 *
 * El motor de fórmulas trata `VERDADERO` como texto: los booleanos aparecen ahí
 * al comparar (`=A1>0`), no al teclear. Eso está bien para la hoja —lo que se
 * escribe es lo que se ve— y es inútil para quien va a hacer
 * `df[df["activo"]]`, sobre todo después de importar un XLSX, donde una celda
 * booleana de Excel se guarda como `VERDADERO`.
 *
 * Así que la inferencia vive AQUÍ y no en `formula.ts`. Es la frontera correcta
 * por dos razones: no cambia cómo se comporta ninguna hoja existente —ni su
 * cálculo, ni su presentación, ni sus pruebas— y es el sitio donde el encargo
 * pide «tipos razonablemente inferidos».
 *
 * El precio, dicho: una celda cuyo texto sea literalmente la palabra
 * «verdadero» llega al código como `True`. Está documentado en
 * `docs/LIMITATIONS.md`.
 */
const BOOLEANS: Readonly<Record<string, boolean>> = {
  verdadero: true,
  falso: false,
  true: true,
  false: false,
};

function inferType(value: LabCell): LabCell {
  if (typeof value !== 'string') return value;
  const candidate = BOOLEANS[value.trim().toLowerCase()];
  return candidate === undefined ? value : candidate;
}

/** Recorta filas y dice cuántas había: una tabla recortada en silencio miente. */
function clampRows(rows: LabCell[][]): { rows: LabCell[][]; truncated: boolean } {
  if (rows.length <= MAX_ROWS) return { rows, truncated: false };
  return { rows: rows.slice(0, MAX_ROWS), truncated: true };
}

/**
 * Los datos que ESTA ejecución necesita.
 *
 * Se recorren las referencias que encontró el escáner, no el documento entero.
 * Un NexBook con cien imágenes y diez hojas que ejecuta una celda que sólo lee
 * `nex.sheet("Ventas")` transfiere UNA hoja.
 */
export async function resolveLabDataset(
  document: NexBookDocument,
  references: LabReferences,
  options: ResolveLabDatasetOptions = {}
): Promise<LabDataset> {
  const catalog = labCatalog(document);
  const problems: LabProblem[] = [];
  const bridge = createSpreadsheetBridge(document);

  if (references.dynamic) {
    problems.push({
      kind: 'sheet',
      reference: '',
      message:
        'Las referencias del laboratorio tienen que ser texto literal: nex.sheet("Ventas"), ' +
        'no nex.sheet(variable). Los datos se preparan ANTES de ejecutar la celda, así que ' +
        'todavía no existe ninguna variable que consultar.',
    });
  }

  // --- Hojas ---------------------------------------------------------------
  const sheets: LabTable[] = [];
  for (const reference of references.sheets) {
    const found = resolveOne(reference, catalog.sheets, 'sheet');
    if ('problem' in found) {
      problems.push(found.problem);
      continue;
    }

    // Se lee por ID, nunca por nombre: la ambigüedad ya se resolvió arriba y
    // volver a pasar el nombre al bridge reintroduciría su «el primero gana».
    const values = bridge.getValues(found.value.id);
    if (!values) {
      problems.push({
        kind: 'sheet',
        reference,
        message: `La hoja "${reference}" ya no está en el documento.`,
      });
      continue;
    }

    const headers = values.headers;
    // Si la primera fila ES la de encabezados, no vuelve a salir como dato.
    const body = headers.length > 0 ? values.rows.slice(1) : values.rows;
    const { rows } = clampRows((body as LabCell[][]).map((row) => row.map(inferType)));

    sheets.push({
      id: found.value.id,
      name: found.value.name,
      columns: headers.length > 0 ? headers : defaultColumns(values.rows[0]?.length ?? 0),
      rows,
    });
  }

  // --- Outputs persistidos -------------------------------------------------
  const outputs: LabTable[] = [];
  for (const reference of references.outputs) {
    const found = resolveOne(reference, catalog.outputs, 'output');
    if ('problem' in found) {
      problems.push(found.problem);
      continue;
    }

    const table = firstTable(document.results[found.value.id]?.outputs ?? []);
    if (!table) {
      problems.push({
        kind: 'output',
        reference,
        message: `El bloque "${reference}" ya no tiene ninguna tabla guardada. Vuelve a ejecutarlo.`,
      });
      continue;
    }

    const { rows } = clampRows(table.rows as LabCell[][]);
    outputs.push({
      id: found.value.id,
      name: found.value.name,
      columns: [...table.columns],
      rows,
    });
  }

  // --- Imágenes ------------------------------------------------------------
  const images: LabImage[] = [];
  for (const reference of references.images) {
    const block = document.blocks.find(
      (item) =>
        item.type === 'image' &&
        (item.id === reference || normalize(item.alt || '') === normalize(reference))
    );

    if (!block || block.type !== 'image' || !block.assetId) {
      const found = resolveOne(reference, catalog.images.map((image) => ({ ...image })), 'image');
      problems.push(
        'problem' in found
          ? found.problem
          : {
              kind: 'image',
              reference,
              message: `La imagen "${reference}" todavía no tiene archivo.`,
            }
      );
      continue;
    }

    if (!options.loadAsset) {
      problems.push({
        kind: 'image',
        reference,
        message:
          `No se pueden leer imágenes en este contexto. ` +
          'Abre el NexLab con tu sesión para que el código pueda usar sus imágenes.',
      });
      continue;
    }

    try {
      const base64 = await options.loadAsset(block.assetId, block.mimeType);
      images.push({
        id: block.id,
        name: block.alt || '',
        mimeType: block.mimeType,
        base64,
      });
    } catch (caught) {
      problems.push({
        kind: 'image',
        reference,
        message:
          caught instanceof Error
            ? `No se pudo leer la imagen "${reference}": ${caught.message}`
            : `No se pudo leer la imagen "${reference}".`,
      });
    }
  }

  return { catalog, sheets, images, outputs, problems };
}

/** `col1`, `col2`… cuando la hoja no declara encabezados y no se pueden deducir. */
function defaultColumns(width: number): string[] {
  return Array.from({ length: width }, (_value, index) => `col${index + 1}`);
}
