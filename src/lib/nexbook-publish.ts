import { safeMarkdownUrl } from './ai-worklog';
import { NEXBOOK_FORMAT_VERSION } from './types';
import type {
  NexBookAIWorklogBlock,
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

    case 'ai_worklog':
      return publishableWorklogBlock(block);

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

/**
 * El registro de uso de IA, reconstruido campo a campo.
 *
 * ## Ni `{ ...block }` ni `{ ...worklog }`
 *
 * Aquí es donde más tentador sería copiar el objeto: `AIWorklogData` tiene once
 * campos y escribirlos uno a uno parece ceremonia. Es justo al revés. El día que
 * alguien añada al registro un `reviewedByUid`, un `courseId` o una marca
 * interna, un `...spread` lo publicaría sin que nadie tuviera que hacer nada.
 * Escrito así, un campo nuevo NO sale hasta que se añada a esta función, y
 * añadirlo es el momento de preguntarse si debería.
 *
 * ## Qué NO sale, y por qué
 *
 * **`resourcesUsed`.** Son ids internos de Skills, prompts y recursos de UNA
 * materia (`ResourceRef`), de la misma familia que `context`. Fuera de esa
 * materia no significan nada, y dentro son un mapa de qué existe en ella. Sale
 * como lista VACÍA, no ausente: el esquema exige el campo, y omitirlo produciría
 * un documento que no se puede reimportar.
 *
 * Lo que sí sale es todo lo humano —objetivo, prompt, respuesta, uso, cambios,
 * descartes y análisis—, que es exactamente lo que hace legible el registro. La
 * limitación real es que **la información semántica de `resourcesUsed` se pierde
 * al exportar**: convertir los ids a nombres legibles exigiría resolverlos
 * contra la materia dentro de la frontera de publicación, y eso es otra decisión
 * —qué se resuelve, con qué permisos, qué pasa con un recurso borrado—. Está
 * documentado en `docs/LIMITATIONS.md` en vez de improvisado aquí.
 *
 * ## `conversationUrl` sí sale, saneado
 *
 * Pasa por `safeMarkdownUrl`, que sólo deja HTTP(S). Lo que NO se hace es
 * inspeccionar los parámetros de un servicio ajeno buscando «secretos»: no se
 * puede saber cuáles lo son, y la persona decidió registrar ese enlace. Una URL
 * firmada de Nextudio no puede llegar aquí porque este campo no lo escribe el
 * servidor: lo escribe quien rellena el formulario, y el esquema exige HTTP(S).
 */
function publishableWorklogBlock(block: NexBookAIWorklogBlock): NexBookAIWorklogBlock {
  const worklog = block.worklog;

  return {
    id: block.id,
    type: 'ai_worklog',
    worklog: {
      provider: worklog.provider,
      model: worklog.model,
      conversationUrl: safeMarkdownUrl(worklog.conversationUrl ?? ''),
      objective: worklog.objective,
      prompt: worklog.prompt,
      ...(worklog.result
        ? { result: { content: worklog.result.content, format: worklog.result.format } }
        : {}),
      responseSummary: worklog.responseSummary,
      studentAnalysis: worklog.studentAnalysis,
      whatWasUsed: worklog.whatWasUsed,
      whatWasChanged: worklog.whatWasChanged,
      whatWasDiscarded: worklog.whatWasDiscarded,
      // Ver la cabecera: ids internos de una materia. Vacío, nunca ausente.
      resourcesUsed: [],
    },
    ...(block.responseImages?.length
      ? {
          responseImages: block.responseImages.map((image) => ({
            assetId: image.assetId,
            mimeType: image.mimeType,
            alt: image.alt,
            ...(image.caption ? { caption: image.caption } : {}),
            ...(image.width ? { width: image.width } : {}),
            ...(image.height ? { height: image.height } : {}),
          })),
        }
      : {}),
    /**
     * `conclusionMode` y `editableByStudent` SÍ salen, por la misma razón que
     * `editableByStudent` sale en los demás bloques: dicen qué pedía la
     * actividad y qué escribió cada quien. Sin ellos, una copia de una plantilla
     * deja de poder explicarse a sí misma.
     */
    ...(block.conclusionMode ? { conclusionMode: block.conclusionMode } : {}),
    ...(block.editableByStudent === false ? { editableByStudent: false } : {}),
  };
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
