import { z } from 'zod';
import { LIMITS } from '@/lib/constants';
import { UploadRejected, presignImageUpload, presignProjectUpload } from '@/lib/aws/s3';
import {
  HttpError,
  errorResponse,
  readJson,
  requireWritableProject,
  requireWriter,
} from '@/lib/server/session';

/**
 * Permisos de subida.
 *
 * El navegador NO sube a S3 con credenciales propias: pide aquí un permiso
 * acotado por archivo y el servidor decide la ruta (construida con el uid del
 * token), el Content-Type (derivado de la extensión) y el tamaño máximo
 * (condición `content-length-range` del POST firmado, que S3 hace cumplir).
 *
 * Es el equivalente de `storage.rules`, con una diferencia a favor: el cliente
 * ya ni siquiera puede *proponer* una ruta fuera de su carpeta, porque no
 * escribe la ruta.
 */

const uploadsSchema = z.object({
  version: z.number().int().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        size: z.number().int().min(0).max(LIMITS.maxFileBytes),
      })
    )
    .min(1)
    .max(LIMITS.maxFiles),
  cover: z
    .object({
      contentType: z.string().min(1).max(100),
      size: z.number().int().min(1).max(LIMITS.maxCoverBytes),
    })
    .nullish(),
});

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const actor = await requireWriter(request);
    const project = await requireWritableProject(actor, projectId);
    const input = await readJson(request, uploadsSchema);

    const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > LIMITS.maxProjectBytes) {
      throw new HttpError(413, 'El proyecto entero supera el límite de tamaño.');
    }

    // La versión que se firma es siempre la SIGUIENTE. Firmar sobre la versión
    // publicada permitiría reescribir los archivos que ya está viendo la gente.
    if (input.version !== project.version + 1) {
      throw new HttpError(409, 'Esa versión no es la siguiente. Recarga y vuelve a intentarlo.');
    }

    const uploads = await Promise.all(
      input.files.map(async (file) => {
        const signed = await presignProjectUpload({
          // El dueño sale del proyecto verificado, no de la petición. Si el
          // actor es staff moderando, los archivos siguen siendo del autor.
          ownerId: project.ownerId,
          projectId: project.id,
          version: input.version,
          relativePath: file.path,
          sizeBytes: file.size,
        });
        return {
          path: file.path,
          url: signed.post.url,
          fields: signed.post.fields,
          contentType: signed.contentType,
        };
      })
    );

    const cover = input.cover
      ? await presignImageUpload({
          ownerId: project.ownerId,
          kind: 'cover',
          projectId: project.id,
          contentType: input.cover.contentType,
          sizeBytes: input.cover.size,
        })
      : null;

    return Response.json({
      uploads,
      cover: cover ? { url: cover.post.url, fields: cover.post.fields, publicUrl: cover.publicUrl } : null,
    });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}
