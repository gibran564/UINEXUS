import { z } from 'zod';
import { projectMetadataSchema, visibilitySchema } from '@/lib/schemas';
import {
  errorResponse,
  readJson,
  requireWritableProject,
  requireWriter,
} from '@/lib/server/session';
import { deleteProject, updateProjectMetadata } from '@/lib/server/writes';

/**
 * Un proyecto concreto.
 *
 * PATCH  → metadata y visibilidad.
 * DELETE → borra registro y archivos.
 *
 * `requireWritableProject` responde 404 —no 403— cuando el proyecto no es del
 * actor: confirmar que existe un borrador ajeno ya sería filtrar información.
 */

const patchSchema = z
  .object({
    metadata: projectMetadataSchema.optional(),
    status: visibilitySchema.optional(),
  })
  .refine((value) => value.metadata || value.status, {
    message: 'No hay nada que actualizar.',
  });

type Context = { params: Promise<{ projectId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const actor = await requireWriter(request);
    const project = await requireWritableProject(actor, projectId);
    const input = await readJson(request, patchSchema);

    const updated = await updateProjectMetadata(actor, project, input);
    return Response.json({
      status: updated.status,
      updatedAt: updated.updatedAt,
      publishedAt: updated.publishedAt,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const actor = await requireWriter(request);
    const project = await requireWritableProject(actor, projectId);
    await deleteProject(project);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
