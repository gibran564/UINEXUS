import { randomUUID } from 'node:crypto';
import { workspaceInputSchema } from '@/lib/academic-schemas';
import {
  listWorkspaceSummariesForOwner,
  putWorkspace,
  toWorkspace,
} from '@/lib/data/workspaces';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import type { WorkspaceRecord } from '@/lib/types';

/**
 * MIS prácticas.
 *
 * Plural en la URL, singular en la propiedad: la colección es siempre la de
 * quien pide, y no hay ningún hueco donde escribir de quién. El UID sale del
 * token verificado, así que «listar las prácticas de otro» no es algo que esté
 * prohibido: es algo que no se puede expresar. Es la misma decisión que en
 * `/api/assignments/:id/submission`, y por la misma razón.
 *
 * GET  → mis prácticas, la última tocada primero.
 * POST → crea una práctica y devuelve la ficha completa.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    /**
     * Resúmenes, no documentos.
     *
     * La lista pinta títulos y fechas; mandar el contenido de cada NexBook
     * serían cientos de KB por pantalla. Ver `listWorkspaceSummariesForOwner`.
     */
    const workspaces = await listWorkspaceSummariesForOwner(actor.uid);
    return Response.json({ workspaces });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const input = await readJson(request, workspaceInputSchema);

    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id: randomUUID(),
      ownerUid: actor.uid,
      // Esta ruta crea prácticas de un solo archivo. Los NexBooks tienen la
      // suya (`/api/nexbooks`) porque su cuerpo y sus límites son otros.
      kind: 'code',
      // Hoy sólo existe el personal. No se acepta del cliente: un `context`
      // en el cuerpo sería la forma de colgar una práctica de una actividad
      // ajena. Ver `WorkspaceContext`.
      context: 'personal',
      title: input.title,
      language: input.language,
      code: input.code,
      courseId: input.courseId,
      createdAt: now,
      updatedAt: now,
    };

    await putWorkspace(record);
    return Response.json({ workspace: toWorkspace(record) }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
