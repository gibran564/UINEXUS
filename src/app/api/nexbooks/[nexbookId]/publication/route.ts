import { z } from 'zod';
import { getOwnNexBook } from '@/lib/data/nexbooks';
import {
  getPublication,
  publicationSlugFor,
  publishNexBook,
  toPublication,
  unpublishNexBook,
} from '@/lib/data/nexbook-publications';
import { publishableDocument } from '@/lib/nexbook-publish';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * Publicar un NexBook, consultarlo o retirarlo.
 *
 * ## Publicar CONGELA
 *
 * `PUT` copia el documento a un registro aparte. A partir de ahí el autor sigue
 * editando y lo publicado no se mueve: hay que volver a pulsar «Actualizar
 * publicación». Un interruptor sobre el documento vivo habría publicado cada
 * pulsación de teclado.
 *
 * ## Sólo se publica lo PERSONAL
 *
 * Un NexBook de una actividad —plantilla o copia— no se publica desde aquí, y
 * no es una restricción burocrática: el documento de un paso puede llevar las
 * instrucciones internas de la materia, los datos que repartió la docente o
 * retroalimentación. Quien quiera enseñar su trabajo crea una copia personal y
 * publica ésa, que es una decisión suya sobre un documento suyo.
 *
 * Ver `lib/nexbook-publish.ts` para lo que se quita del documento al copiarlo.
 */

const publishSchema = z.object({
  /** `private` no cabe: retirar una publicación es `DELETE`, no publicarla en privado. */
  visibility: z.enum(['class', 'link', 'public']),
});

type Params = { params: Promise<{ nexbookId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;

    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Ese NexBook no existe.');

    const publication = await getPublication(publicationSlugFor(actor.uid, nexbookId));
    return Response.json({
      publication: publication ? toPublication(publication) : null,
      /**
       * Si el original avanzó desde que se publicó.
       *
       * Es lo que permite decir «hay cambios sin publicar» en vez de dejar a
       * quien publicó preguntándose si lo que se ve fuera es lo de ahora.
       */
      hasChanges: publication ? publication.sourceRevision !== record.revision : false,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;
    const input = await readJson(request, publishSchema);

    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Ese NexBook no existe.');

    if (record.context.type !== 'personal') {
      throw new HttpError(
        400,
        'Un NexBook de una actividad no se publica directamente. Crea una copia personal y publica esa copia.'
      );
    }

    const publication = await publishNexBook({
      ownerUid: actor.uid,
      nexbookId,
      title: record.title,
      // El nombre para mostrar, NUNCA el uid ni el correo. Es la misma regla que
      // en el resto de Nextudio: el UID no cruza la frontera hacia el navegador.
      authorName: actor.profile.displayName,
      document: publishableDocument(record.document),
      visibility: input.visibility,
      sourceRevision: record.revision,
    });

    return Response.json({ publication: toPublication(publication) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;

    // El documento vivo NO se toca: retirar una publicación es dejar de
    // enseñarla, no borrar el trabajo.
    if (!(await unpublishNexBook(actor.uid, nexbookId))) {
      throw new HttpError(404, 'Ese NexBook no está publicado.');
    }
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
