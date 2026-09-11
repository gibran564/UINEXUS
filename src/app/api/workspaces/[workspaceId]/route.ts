import { workspacePatchSchema } from '@/lib/academic-schemas';
import {
  deleteOwnWorkspace,
  getOwnWorkspace,
  toWorkspace,
  updateOwnWorkspace,
} from '@/lib/data/workspaces';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * UNA de mis prácticas.
 *
 * Las tres operaciones piden `ownerUid` a la capa de datos, y las tres tratan
 * «no existe» y «no es tuya» como la misma respuesta: 404. Distinguirlas
 * convertiría la ruta en un oráculo —probando ids se sabría qué prácticas
 * existen— y no aportaría nada a quien sí es el dueño.
 *
 * GET    → la práctica, para abrir el editor donde se quedó.
 * PATCH  → guarda lo que cambió. Es lo que usa el autoguardado.
 * DELETE → la borra.
 */

type Params = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { workspaceId } = await params;

    const record = await getOwnWorkspace(workspaceId, actor.uid);
    if (!record) throw new HttpError(404, 'Esa práctica no existe.');

    return Response.json({ workspace: toWorkspace(record) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { workspaceId } = await params;
    const changes = await readJson(request, workspacePatchSchema);

    /**
     * Se escribe SÓLO lo que vino.
     *
     * El autoguardado manda el código y nada más; reenviar la práctica entera
     * en cada pulsación haría que un título a medio escribir en otra pestaña
     * pisara el guardado bueno.
     */
    const record = await updateOwnWorkspace(workspaceId, actor.uid, changes);
    if (!record) throw new HttpError(404, 'Esa práctica no existe.');

    return Response.json({ workspace: toWorkspace(record) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { workspaceId } = await params;

    const removed = await deleteOwnWorkspace(workspaceId, actor.uid);
    if (!removed) throw new HttpError(404, 'Esa práctica no existe.');

    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
