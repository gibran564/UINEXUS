import { NEXBOOK_FORMAT_VERSION } from './types';
import type { NexBookBlock, NexBookDocument, NexBookImageMimeType } from './types';

/**
 * Operaciones sobre un documento, sin servidor y sin React.
 *
 * Vive aparte porque las mismas preguntas se hacen en sitios muy distintos: el
 * navegador necesita saber qué assets usa un documento para pintarlo, el
 * exportador para meterlos en el ZIP, la ruta de contenido para decidir si
 * alguien puede leer una imagen, y el importador para comprobar que no sobra
 * ninguno. Cuatro implementaciones de «qué imágenes tiene esto» acabarían
 * discrepando, y la que decide permisos no puede ser la que se quede corta.
 */

/**
 * Los assets que el documento referencia, sin repetir.
 *
 * Es la base de la AUTORIZACIÓN de lectura: un asset se puede leer si el
 * documento que lo menciona se puede leer. Por eso recorre TODO —bloques y
 * resultados—: si se olvidara de los outputs, las gráficas de una publicación
 * darían 404 y nadie sabría por qué.
 */
export function collectAssetIds(document: NexBookDocument): string[] {
  const found = new Set<string>();

  for (const block of document.blocks) {
    if (block.type === 'image' && block.assetId) found.add(block.assetId);
    /**
     * Las capturas de un registro de IA cuentan igual que cualquier otra imagen.
     *
     * Olvidarlas aquí no sería un fallo cosmético: esta función es la que
     * AUTORIZA la lectura de un asset y la que decide qué entra en el ZIP al
     * exportar. Una captura fuera de esta lista daría 404 en la publicación y se
     * perdería al exportar, y nadie sabría por qué.
     */
    if (block.type === 'ai_worklog') {
      for (const image of block.responseImages ?? []) {
        if (image.assetId) found.add(image.assetId);
      }
    }
  }

  for (const result of Object.values(document.results)) {
    for (const output of result.outputs) {
      if (output.stream === 'image' && output.assetId) found.add(output.assetId);
    }
  }

  return [...found];
}

/** ¿Este documento usa este asset? La pregunta que hace la ruta de contenido. */
export function referencesAsset(document: NexBookDocument, assetId: string): boolean {
  return collectAssetIds(document).includes(assetId);
}

/**
 * El tipo de imagen que el DOCUMENTO declara para ese asset.
 *
 * Devolver `null` cuando el documento no lo menciona es a la vez la respuesta y
 * la comprobación de pertenencia: un asset huérfano —su bloque se borró— deja de
 * poder leerse por las rutas que dependen de esto, aunque sus bytes sigan en el
 * bucket hasta que alguien los barra.
 *
 * Se lee del documento y no de la petición porque es el documento lo que el
 * servidor validó al guardarlo.
 */
export function imageMimeTypeFor(
  document: NexBookDocument,
  assetId: string
): NexBookImageMimeType | null {
  for (const block of document.blocks) {
    if (block.type === 'image' && block.assetId === assetId) return block.mimeType;
    if (block.type === 'ai_worklog') {
      const image = (block.responseImages ?? []).find((item) => item.assetId === assetId);
      if (image) return image.mimeType;
    }
  }
  for (const result of Object.values(document.results)) {
    for (const output of result.outputs) {
      if (output.stream === 'image' && output.assetId === assetId) return output.mimeType;
    }
  }
  return null;
}

/**
 * El documento sin resultados.
 *
 * Se usa al crear la copia de una plantilla —el alumnado empieza con el código,
 * no con las salidas de su docente— y detrás del botón de limpiar. Los bloques
 * no se tocan: borrar salidas nunca puede borrar lo que alguien escribió.
 */
export function withoutResults(document: NexBookDocument): NexBookDocument {
  return { ...document, results: {} };
}

/** El documento sin el resultado de UNA celda. */
export function withoutResult(document: NexBookDocument, blockId: string): NexBookDocument {
  if (!document.results[blockId]) return document;
  const results = { ...document.results };
  delete results[blockId];
  return { ...document, results };
}

/**
 * Quita los resultados que ya no tienen bloque.
 *
 * El esquema RECHAZA un documento con resultados huérfanos, así que esto no es
 * una limpieza cosmética: es lo que hace que borrar un bloque desde cualquier
 * camino —la interfaz, una importación, una plantilla que perdió una celda—
 * produzca un documento que se puede guardar.
 */
export function pruneOrphanResults(document: NexBookDocument): NexBookDocument {
  const ids = new Set(document.blocks.map((block) => block.id));
  const entries = Object.entries(document.results).filter(([blockId]) => ids.has(blockId));

  if (entries.length === Object.keys(document.results).length) return document;
  return { ...document, results: Object.fromEntries(entries) };
}

/** Un documento vacío y VÁLIDO. */
export function emptyDocument(blocks: NexBookBlock[] = []): NexBookDocument {
  return { formatVersion: NEXBOOK_FORMAT_VERSION, blocks, results: {} };
}

/** Lo que va a medir DynamoDB, medido igual: sobre el JSON en UTF-8. */
export function documentBytes(document: NexBookDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).length;
}
