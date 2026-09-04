import { z } from 'zod';
import { listProjectsByOwner } from '@/lib/data/repository';
import { projectMetadataSchema, projectTypeSchema, slugSchema } from '@/lib/schemas';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { createProject } from '@/lib/server/writes';

/**
 * Colección de proyectos de la persona autenticada.
 *
 * GET  → sus proyectos, borradores incluidos. Es el panel.
 * POST → crea un proyecto en borrador y devuelve su id para subir archivos.
 *
 * La consulta se hace SIEMPRE por el uid del token, nunca por un parámetro:
 * no existe forma de pedir "los proyectos de otra persona" porque no hay dónde
 * escribirlo.
 */

const createSchema = z.object({
  metadata: projectMetadataSchema,
  slug: slugSchema.optional(),
  projectType: projectTypeSchema,
});

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const projects = await listProjectsByOwner(actor.uid);
    return Response.json({ projects });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const input = await readJson(request, createSchema);

    const project = await createProject(actor, {
      metadata: input.metadata,
      slug: input.slug ?? input.metadata.title,
      projectType: input.projectType,
    });

    return Response.json(
      {
        projectId: project.id,
        slug: project.slug,
        handle: project.ownerHandle,
        version: project.version,
      },
      { status: 201 }
    );
  } catch (caught) {
    return errorResponse(caught);
  }
}
