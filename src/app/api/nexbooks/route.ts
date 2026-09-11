import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  emptyNexBookDocument,
  nexBookDocumentSchema,
  nexBookTitleSchema,
} from '@/lib/academic-schemas';
import { createNexBook, toNexBook } from '@/lib/data/nexbooks';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * Crear un NexBook personal.
 *
 * No hay `GET` aquí: la lista de laboratorios sale de `/api/workspaces`, que
 * devuelve prácticas de código y NexBooks juntos en una sola consulta ordenada
 * por fecha. Duplicar el listado obligaría al navegador a fusionar dos
 * respuestas y reordenarlas, y entonces «lo último que toqué» dejaría de ser
 * cierto en el momento en que hubiera paginación.
 *
 * `context` y `visibility` NO se aceptan del cuerpo. Un NexBook creado aquí es
 * personal y privado; colgarlo de una actividad ajena, o nacer público, no son
 * cosas que el cliente pueda pedir.
 */

const createNexBookSchema = z.object({
  title: nexBookTitleSchema,
  /** Opcional: permite nacer con bloques, p. ej. al clonar una plantilla. */
  document: nexBookDocumentSchema.optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const input = await readJson(request, createNexBookSchema);

    const record = await createNexBook({
      id: randomUUID(),
      ownerUid: actor.uid,
      title: input.title,
      context: { type: 'personal' },
      visibility: 'private',
      document: input.document ?? emptyNexBookDocument(),
    });

    // `null` sólo puede venir de un choque de UUID, que en la práctica no pasa.
    // Se responde igual que cualquier otro fallo de escritura en vez de fingir
    // que se creó.
    if (!record) throw new Error('No se pudo crear el NexBook.');

    return Response.json({ nexbook: toNexBook(record) }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
