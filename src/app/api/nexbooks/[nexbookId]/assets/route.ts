import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nexBookImageMimeSchema } from '@/lib/academic-schemas';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import { getOwnNexBook } from '@/lib/data/nexbooks';
import { presignNexBookAssetUpload, UploadRejected } from '@/lib/aws/s3';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * Pedir permiso para subir una imagen a un NexBook.
 *
 * ## El navegador no elige nada
 *
 * Ni el identificador del asset —lo genera el servidor—, ni la ruta —se
 * construye con el uid del token y el id del documento—, ni el tipo, ni el
 * tamaño máximo. Lo único que manda el cliente son dos datos que el servidor
 * VERIFICA antes de firmar: qué tipo de imagen dice que es y cuánto dice que
 * pesa.
 *
 * El tamaño declarado podría ser mentira, y por eso no es la defensa: la
 * condición `content-length-range` del POST firmado la aplica S3 sobre los bytes
 * de verdad. Lo que se comprueba aquí sirve para dar un error legible antes de
 * gastar una subida.
 *
 * ## Por qué no pasa por aquí el archivo
 *
 * Una imagen de cuatro megas a través de una función serverless es tiempo de
 * cómputo pagado para copiar bytes. El navegador sube DIRECTAMENTE a S3 con un
 * permiso acotado a una ruta, un tipo y un tamaño; es el mismo patrón que usan
 * las entregas y los materiales.
 */

const uploadRequestSchema = z.object({
  contentType: nexBookImageMimeSchema,
  sizeBytes: z.number().int().min(1).max(NEXBOOK_LIMITS.maxAssetBytes),
});

type Params = { params: Promise<{ nexbookId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;
    const input = await readJson(request, uploadRequestSchema);

    /**
     * Se comprueba que el NexBook sea SUYO antes de firmar.
     *
     * Sin esto, cualquiera con una sesión válida podría pedir una firma para el
     * prefijo de otra persona con sólo cambiar el id de la URL. Y como la clave
     * se arma con `actor.uid`, el fallo no sería escribir en el espacio ajeno
     * —eso ya lo impide la ruta— sino crear basura en el propio a nombre de un
     * documento que no existe. «No existe» y «no es tuyo» responden igual.
     */
    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Ese NexBook no existe.');

    const assetId = randomUUID();
    const { post } = await presignNexBookAssetUpload({
      ownerUid: actor.uid,
      assetId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    return Response.json({ assetId, upload: post });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return errorResponse(new HttpError(400, caught.message));
    }
    return errorResponse(caught);
  }
}
