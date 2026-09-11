import { NEXBOOK_FORMAT_VERSION } from './types';
import type {
  NexBookBlock,
  NexBookCellResult,
  NexBookDocument,
  NexBookOutput,
} from './types';

/**
 * Lo que sale de la plataforma, campo a campo.
 *
 * ## Lista BLANCA, y por qué no una negra
 *
 * Este módulo reconstruye el documento propiedad a propiedad en vez de copiar el
 * objeto y borrar lo que no debe salir. La diferencia se ve al pensar en el
 * futuro: con una lista negra, el día que alguien añada un campo al modelo —un
 * `lastEditorUid`, una marca de revisión interna, un identificador de la
 * materia— ese campo sale publicado y exportado sin que nadie tenga que hacer
 * nada. Con una lista blanca, un campo nuevo NO sale hasta que alguien lo añada
 * aquí, y añadirlo es el momento de preguntarse si debería.
 *
 * Es la misma decisión que `sanitizeWorkerRun` toma con el mensaje del Worker,
 * por el mismo motivo: un `...spread` descuidado es exactamente la forma en que
 * estos contratos se rompen.
 *
 * ## Lo usan publicar y exportar
 *
 * Los dos sacan el documento fuera de su contexto —uno a una URL que puede ver
 * otra persona, el otro a un archivo que se puede mandar por correo— así que los
 * dos tienen que responder igual a «¿qué puede salir de aquí?». Dos
 * implementaciones habrían acabado discrepando, y la discrepancia se
 * descubriría por el lado malo.
 *
 * ## Lo que NUNCA sale
 *
 * `ownerUid`, `id` del NexBook, `context` —que lleva la actividad y el paso—,
 * `revision`, fechas internas, claves de S3, URLs firmadas, tokens, cookies,
 * identificadores de AWS y comentarios de la revisión docente. Nada de eso
 * aparece en este archivo, que es precisamente la garantía.
 */

/** El documento listo para publicarse o exportarse. */
export function publishableDocument(document: NexBookDocument): NexBookDocument {
  return {
    formatVersion: NEXBOOK_FORMAT_VERSION,
    blocks: document.blocks.map(publishableBlock),
    results: Object.fromEntries(
      Object.entries(document.results).map(([blockId, result]) => [
        blockId,
        publishableResult(result),
      ])
    ),
  };
}

function publishableBlock(block: NexBookBlock): NexBookBlock {
  switch (block.type) {
    case 'markdown':
      return {
        id: block.id,
        type: 'markdown',
        source: block.source,
        /**
         * `editableByStudent` SÍ sale.
         *
         * Dice qué partes escribió el profesorado y cuáles quien resolvió la
         * tarea, que es información del documento y no metadatos de la
         * plataforma. Quitarla haría ilegible una copia de una plantilla.
         */
        ...(block.editableByStudent === false ? { editableByStudent: false } : {}),
      };

    case 'code':
      return {
        id: block.id,
        type: 'code',
        language: block.language,
        source: block.source,
        ...(block.editableByStudent === false ? { editableByStudent: false } : {}),
      };

    case 'image':
      return {
        id: block.id,
        type: 'image',
        // El `assetId` sale y la CLAVE de S3 no: son cosas distintas. El id es
        // opaco y sólo sirve dentro de un documento que alguien pueda abrir; la
        // clave diría en qué bucket y bajo qué uid están los bytes.
        assetId: block.assetId,
        mimeType: block.mimeType,
        alt: block.alt,
        ...(block.caption ? { caption: block.caption } : {}),
        ...(block.width ? { width: block.width } : {}),
        ...(block.height ? { height: block.height } : {}),
      };

    default:
      return {
        id: block.id,
        type: 'spreadsheet',
        name: block.name,
        sheet: {
          rows: block.sheet.rows,
          columns: block.sheet.columns,
          cells: Object.fromEntries(
            Object.entries(block.sheet.cells).map(([key, cell]) => [key, { input: cell.input }])
          ),
          ...(block.sheet.headers ? { headers: [...block.sheet.headers] } : {}),
        },
        ...(block.editableByStudent === false ? { editableByStudent: false } : {}),
      };
  }
}

function publishableResult(result: NexBookCellResult): NexBookCellResult {
  return {
    blockId: result.blockId,
    status: result.status,
    outputs: result.outputs.map(publishableOutput),
    durationMs: result.durationMs,
    ranAt: result.ranAt,
  };
}

function publishableOutput(output: NexBookOutput): NexBookOutput {
  switch (output.stream) {
    case 'table':
      return {
        seq: output.seq,
        stream: 'table',
        columns: [...output.columns],
        rows: output.rows.map((row) => [...row]),
        totalRows: output.totalRows,
        ...(output.truncated ? { truncated: true } : {}),
      };

    case 'image':
      return {
        seq: output.seq,
        stream: 'image',
        assetId: output.assetId,
        mimeType: output.mimeType,
        ...(output.width ? { width: output.width } : {}),
        ...(output.height ? { height: output.height } : {}),
        ...(output.alt ? { alt: output.alt } : {}),
      };

    case 'json':
      return {
        seq: output.seq,
        stream: 'json',
        value: output.value,
        ...(output.truncated ? { truncated: true } : {}),
      };

    default:
      return {
        seq: output.seq,
        stream: output.stream,
        text: output.text,
        ...(output.truncated ? { truncated: true } : {}),
      };
  }
}
