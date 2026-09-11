import { nexBookPatchSchema } from '@/lib/academic-schemas';
import { deleteOwnNexBook, getOwnNexBook, saveOwnNexBook, toNexBook } from '@/lib/data/nexbooks';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * UN NexBook propio.
 *
 * GET    → el documento, para abrir Studio donde se quedó.
 * PATCH  → guarda con concurrencia optimista. Es lo que usa el autoguardado.
 * DELETE → lo borra.
 *
 * Las tres tratan «no existe» y «no es tuyo» como la misma respuesta, 404, por
 * la misma razón que en las prácticas: distinguirlas convertiría la ruta en un
 * oráculo de qué documentos existen.
 */

type Params = { params: Promise<{ nexbookId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;

    const record = await getOwnNexBook(nexbookId, actor.uid);
    if (!record) throw new HttpError(404, 'Ese NexBook no existe.');

    return Response.json({ nexbook: toNexBook(record) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;
    const { revision, ...changes } = await readJson(request, nexBookPatchSchema);

    const outcome = await saveOwnNexBook(nexbookId, actor.uid, revision, changes);

    if (!outcome.ok && outcome.reason === 'missing') {
      throw new HttpError(404, 'Ese NexBook no existe.');
    }

    /**
     * 409 con el documento actual dentro.
     *
     * Un 409 a secas dejaría al editor sin saber qué hacer más que perder lo
     * escrito. Devolviendo la versión que ganó, la interfaz puede decir
     * exactamente qué pasó y quien edita decide.
     */
    if (!outcome.ok) {
      return Response.json(
        {
          error: 'Alguien guardó este NexBook desde otro sitio. Recarga para ver la versión actual.',
          nexbook: toNexBook(outcome.current),
        },
        { status: 409 }
      );
    }

    return Response.json({ nexbook: toNexBook(outcome.record) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { nexbookId } = await params;

    if (!(await deleteOwnNexBook(nexbookId, actor.uid))) {
      throw new HttpError(404, 'Ese NexBook no existe.');
    }
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
