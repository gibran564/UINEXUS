import { zipSync } from 'fflate';
import { getOwnNexBook } from '@/lib/data/nexbooks';
import { collectAssetIds, imageMimeTypeFor } from '@/lib/nexbook-document';
import { publishableDocument } from '@/lib/nexbook-publish';
import {
  NEXBOOK_ARCHIVE_FORMAT,
  NEXBOOK_ARCHIVE_VERSION,
  archiveAssetPath,
  archiveFileName,
  toArchiveReferences,
  type NexBookArchiveAsset,
  type NexBookManifest,
} from '@/lib/nexbook-archive';
import { NEXBOOK_FORMAT_VERSION } from '@/lib/types';
import { nexBookAssetKey, nexBookImageExtension, readNexBookAsset } from '@/lib/aws/s3';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';

/**
 * Exportar un NexBook como archivo `.nexbook`.
 *
 * ## El documento pasa por la lista blanca
 *
 * `publishableDocument` lo reconstruye campo a campo, así que lo que entra en el
 * ZIP es sólo lo que alguien decidió que puede salir: ni `ownerUid`, ni el id
 * del NexBook, ni su contexto académico, ni revisiones, ni claves de S3. Ver
 * `lib/nexbook-publish.ts`.
 *
 * ## Las imágenes van DENTRO
 *
 * Y sus referencias se reescriben a rutas del propio archivo. Un `.nexbook` que
 * dependiera de una URL de S3 para poder abrirse no sería un archivo: sería un
 * marcador que deja de funcionar en cuanto caduque el permiso o se borre el
 * objeto.
 *
 * ## Se comprime aquí y no se transmite en trozos
 *
 * El tope del documento es 300 KB y el de sus imágenes está acotado, así que el
 * archivo entero cabe en memoria sin discusión. Un flujo por trozos habría hecho
 * falta con archivos de cientos de megas, que este formato no admite.
 */

type Params = { params: Promise<{ nexbookId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;

    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Ese NexBook no existe.');

    const clean = publishableDocument(record.document);
    const files: Record<string, Uint8Array> = {};
    const assets: NexBookArchiveAsset[] = [];
    const pathByAssetId = new Map<string, string>();

    let index = 1;
    for (const assetId of collectAssetIds(clean)) {
      const mimeType = imageMimeTypeFor(clean, assetId);
      if (!mimeType) continue;

      const extension = nexBookImageExtension(mimeType);
      if (!extension) continue;

      const stored = await readNexBookAsset(
        nexBookAssetKey({ ownerUid: actor.uid, assetId, extension })
      );
      // Un asset que el documento menciona y que ya no está en el bucket se
      // omite: el resto del archivo se genera igual, y su bloque quedará sin
      // imagen en vez de impedir la exportación entera.
      if (!stored) continue;

      const path = archiveAssetPath(index, mimeType);
      files[path] = stored.bytes;
      assets.push({ path, mimeType, bytes: stored.bytes.byteLength });
      pathByAssetId.set(assetId, path);
      index += 1;
    }

    const manifest: NexBookManifest = {
      format: NEXBOOK_ARCHIVE_FORMAT,
      version: NEXBOOK_ARCHIVE_VERSION,
      documentVersion: NEXBOOK_FORMAT_VERSION,
      title: record.title,
      createdWith: 'UINexus',
      exportedAt: new Date().toISOString(),
      assets,
    };

    const encoder = new TextEncoder();
    files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2));
    files['document.json'] = encoder.encode(
      JSON.stringify(toArchiveReferences(clean, pathByAssetId), null, 2)
    );

    /**
     * Nivel 6 y no 9.
     *
     * Lo que pesa en un `.nexbook` son los PNG, que ya están comprimidos y no
     * se encogen más. Apretar al máximo gastaría tiempo de función por unos
     * pocos kilobytes del JSON.
     */
    const archive = zipSync(files, { level: 6 });

    return new Response(archive as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archiveFileName(record.title)}"`,
        // Es el trabajo de una persona: ninguna caché compartida debe guardarlo.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
