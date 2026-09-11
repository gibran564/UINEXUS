import { nexBookAssetIdSchema } from '@/lib/academic-schemas';
import { getPublication } from '@/lib/data/nexbook-publications';
import { imageMimeTypeFor } from '@/lib/nexbook-document';
import { nexBookAssetKey, nexBookImageExtension, presignNexBookAssetDownload } from '@/lib/aws/s3';
import { HttpError, errorResponse, requireIdentity } from '@/lib/server/session';

/**
 * Una imagen de un NexBook publicado.
 *
 * ## La autorización la da el DOCUMENTO, no el asset
 *
 * Aquí es donde esa idea hace su trabajo. Quien pide la imagen no es su dueño
 * —los bytes están bajo el prefijo de otra persona— así que no hay ninguna
 * relación de propiedad que consultar. Lo que se comprueba es:
 *
 *  1. que la publicación exista y sea visible para quien pregunta;
 *  2. que el DOCUMENTO PUBLICADO referencie ese asset.
 *
 * El segundo punto es lo que impide que una publicación sirva de llave para
 * leer cualquier imagen de su autor: sólo salen las que forman parte de lo que
 * se publicó. Si el autor quita una imagen y actualiza la publicación, esa
 * imagen deja de poder leerse por aquí aunque siga en el bucket.
 *
 * `ownerUid` sale del registro de la publicación y NUNCA de la petición, que es
 * lo que hace que la clave no se pueda dirigir desde fuera.
 */

type Params = { params: Promise<{ slug: string; assetId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const { slug, assetId } = await params;

    const parsed = nexBookAssetIdSchema.safeParse(assetId);
    if (!parsed.success) throw new HttpError(404, 'Esa imagen no existe.');

    const record = await getPublication(slug);
    if (!record) throw new HttpError(404, 'Esa imagen no existe.');

    if (record.visibility === 'class') {
      try {
        await requireIdentity(request);
      } catch {
        throw new HttpError(404, 'Esa imagen no existe.');
      }
    }

    const mimeType = imageMimeTypeFor(record.document, parsed.data);
    if (!mimeType) throw new HttpError(404, 'Esa imagen no existe.');

    const extension = nexBookImageExtension(mimeType);
    if (!extension) throw new HttpError(404, 'Esa imagen no existe.');

    const url = await presignNexBookAssetDownload(
      nexBookAssetKey({ ownerUid: record.ownerUid, assetId: parsed.data, extension })
    );

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        // Una publicación `class` depende de quién pregunta, así que su
        // redirección no puede guardarse en una caché compartida.
        'Cache-Control': record.visibility === 'class' ? 'private, max-age=60' : 'public, max-age=60',
      },
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
