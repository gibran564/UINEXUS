import { z } from 'zod';
import { LIMITS } from '@/lib/constants';
import { visibilitySchema } from '@/lib/schemas';
import {
  errorResponse,
  readJson,
  requireWritableProject,
  requireWriter,
} from '@/lib/server/session';
import { discardVersionFiles, finalizeProjectVersion } from '@/lib/server/writes';

/**
 * Publica una versión ya subida.
 *
 * Se llama DESPUÉS de que todos los archivos hayan llegado a S3. Sólo entonces
 * se mueve el puntero `version`: si la subida se interrumpe a medias, la
 * versión anterior sigue publicada y nadie ve un sitio roto. Los archivos
 * huérfanos de la versión fallida se limpian con DELETE sobre esta misma ruta.
 */

const finalizeSchema = z.object({
  version: z.number().int().min(1),
  entryFile: z.string().min(1).max(300),
  fileCount: z.number().int().min(1).max(LIMITS.maxFiles),
  totalBytes: z.number().int().min(0).max(LIMITS.maxProjectBytes),
  status: visibilitySchema,
  cover: z
    .object({
      url: z.string().url().max(2048),
      alt: z.string().max(200),
    })
    .nullish(),
});

const discardSchema = z.object({ version: z.number().int().min(1) });

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const actor = await requireWriter(request);
    const project = await requireWritableProject(actor, projectId);
    const input = await readJson(request, finalizeSchema);

    const updated = await finalizeProjectVersion(project, {
      version: input.version,
      entryFile: input.entryFile,
      fileCount: input.fileCount,
      totalBytes: input.totalBytes,
      status: input.status,
      cover: input.cover ?? null,
    });

    return Response.json({
      version: updated.version,
      status: updated.status,
      handle: updated.ownerHandle,
      slug: updated.slug,
      publishedAt: updated.publishedAt,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

/** Limpia los archivos de una versión que no llegó a publicarse. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const actor = await requireWriter(request);
    const project = await requireWritableProject(actor, projectId);
    const input = await readJson(request, discardSchema);

    // Nunca se borra la versión viva, sólo una posterior y abandonada.
    if (input.version <= project.version) {
      return Response.json({ deleted: 0 });
    }

    const deleted = await discardVersionFiles(project.ownerId, project.id, input.version);
    return Response.json({ deleted });
  } catch (caught) {
    return errorResponse(caught);
  }
}
