import { nexBookAssetIdSchema, nexBookImageMimeSchema } from '@/lib/academic-schemas';
import { getOwnNexBook } from '@/lib/data/nexbooks';
import { imageMimeTypeFor } from '@/lib/nexbook-document';
import { nexBookAssetKey, nexBookImageExtension, presignNexBookAssetDownload } from '@/lib/aws/s3';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';

/**
 * Leer una imagen de un NexBook propio.
 *
 * ## Una URL estable delante de un permiso temporal
 *
 * La página pinta `<img src="/api/nexbooks/:id/assets/:assetId">` y esta ruta
 * redirige a una URL firmada que caduca en cinco minutos. Los dos lados importan:
 *
 *  · La URL del `<img>` es ESTABLE, así que el documento puede guardar la
 *    referencia y seguir sirviendo la imagen dentro de un año.
 *  · Lo que llega a S3 es un permiso que caduca, y el permiso se decide en CADA
 *    petición. Guardar una URL firmada en el documento habría convertido un
 *    permiso de cinco minutos en uno permanente, y además habría viajado dentro
 *    de cada exportación.
 *
 * ## El id del NexBook está en la ruta y NO en la clave
 *
 * Sirve para autorizar —hay que poder abrir ese documento— pero la clave del
 * objeto cuelga de la persona (ver `nexBookAssetKey`). Es lo que permite que una
 * copia, una publicación o una entrega sigan viendo la misma imagen sin duplicar
 * los bytes.
 *
 * ## El tipo: primero el documento, y si no, una pista
 *
 * La clave lleva extensión y hay que saber cuál. Lo normal es leerla del
 * documento, que es donde el servidor ya la validó al guardar. Una imagen recién
 * subida todavía no está en el documento guardado —se sube, se inserta el bloque
 * y el autoguardado llega 800 ms después—, así que se admite una pista en la
 * consulta. No es una decisión de seguridad: la clave sigue construyéndose con
 * el uid del token, de modo que la pista sólo puede apuntar a un objeto de la
 * propia persona, y si no existe, no existe.
 */

type Params = { params: Promise<{ nexbookId: string; assetId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId, assetId } = await params;

    const parsed = nexBookAssetIdSchema.safeParse(assetId);
    if (!parsed.success) throw new HttpError(404, 'Esa imagen no existe.');

    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Esa imagen no existe.');

    const hint = nexBookImageMimeSchema.safeParse(new URL(request.url).searchParams.get('type'));
    const mimeType =
      imageMimeTypeFor(record.document, parsed.data) ?? (hint.success ? hint.data : null);
    if (!mimeType) throw new HttpError(404, 'Esa imagen no existe.');

    const extension = nexBookImageExtension(mimeType);
    if (!extension) throw new HttpError(404, 'Esa imagen no existe.');

    const url = await presignNexBookAssetDownload(
      nexBookAssetKey({ ownerUid: actor.uid, assetId: parsed.data, extension })
    );

    /**
     * 302 con `Cache-Control: private`.
     *
     * Privada porque la respuesta depende de quién pregunta: una caché
     * compartida que guardara esta redirección serviría el permiso de una
     * persona a otra. El `max-age` corto evita pedir la firma en cada repintado
     * sin llegar a sobrevivir a la URL firmada, que dura cinco minutos.
     */
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'private, max-age=60' },
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
