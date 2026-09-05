import { courseResourceInputSchema, moderationInputSchema } from '@/lib/academic-schemas';
import { getCourseResource } from '@/lib/data/academic';
import { toCourseResource } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext, requireCourseTeacher } from '@/lib/server/course-access';
import {
  applyModeration,
  deleteCourseResource,
  updateCourseResource,
} from '@/lib/server/academic-writes';
import type { Actor } from '@/lib/server/session';
import type { CourseResourceRecord } from '@/lib/types';

/**
 * Un recurso general de la materia.
 *
 * PATCH sirve para dos cosas distintas y se distinguen por el cuerpo: con
 * `{ action }` es una decisión de moderación —sólo profesorado—, y con el resto
 * de campos es una edición del contenido.
 *
 * ## Quién puede editar
 *
 * El profesorado de la materia, y quien lo propuso MIENTRAS siga pendiente. Lo
 * segundo es lo que permite corregir una propuesta tras un comentario sin tener
 * que borrarla y volver a escribirla. Una vez aprobada, el contenido pasa a ser
 * de la biblioteca: cambiarlo por debajo dejaría a la docente respaldando algo
 * que ya no leyó.
 */

async function load(request: Request, resourceId: string) {
  const actor = await requireWriter(request);
  const resource = await getCourseResource(resourceId);
  if (!resource || resource.publication) throw new HttpError(404, 'Ese recurso no existe.');
  return { actor, resource };
}

function canEdit(actor: Actor, resource: CourseResourceRecord, isTeacher: boolean): boolean {
  if (isTeacher) return true;
  return resource.createdBy === actor.uid && resource.status !== 'approved';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> }
): Promise<Response> {
  try {
    const { resourceId } = await params;
    const { actor, resource } = await load(request, resourceId);
    const { role } = await requireCourseContext(actor, resource.courseId);

    // Un recurso que todavía no está aprobado sólo lo ve el profesorado y quien
    // lo propuso. Para el resto no existe.
    if (
      role !== 'teacher' &&
      resource.status !== 'approved' &&
      resource.createdBy !== actor.uid
    ) {
      throw new HttpError(404, 'Ese recurso no existe.');
    }

    return Response.json({ resource: toCourseResource(resource) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> }
): Promise<Response> {
  try {
    const { resourceId } = await params;
    const { actor, resource } = await load(request, resourceId);
    const context = await requireCourseContext(actor, resource.courseId);
    const isTeacher = context.role === 'teacher';

    const body: unknown = await request.clone().json().catch(() => null);
    const isModeration = Boolean(body && typeof body === 'object' && 'action' in body);

    if (isModeration) {
      // Moderar es potestad del profesorado de ESTA materia. Que alguien apruebe
      // su propia propuesta es justo lo que §8 viene a impedir.
      await requireCourseTeacher(actor, resource.courseId);

      const input = await readJson(request, moderationInputSchema);
      const next: CourseResourceRecord = {
        ...resource,
        ...applyModeration(actor, resource, input.action),
        updatedAt: new Date().toISOString(),
      };

      const { updateCourseResourceRaw } = await import('@/lib/server/academic-writes');
      await updateCourseResourceRaw(next);

      return Response.json({ resource: toCourseResource(next) });
    }

    if (!canEdit(actor, resource, isTeacher)) {
      throw new HttpError(403, 'Ya no puedes editar este recurso.');
    }

    const input = await readJson(request, courseResourceInputSchema);
    const updated = await updateCourseResource(resource, input);

    return Response.json({ resource: toCourseResource(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> }
): Promise<Response> {
  try {
    const { resourceId } = await params;
    const { actor, resource } = await load(request, resourceId);
    const context = await requireCourseContext(actor, resource.courseId);

    // Se puede retirar lo propio mientras no esté aprobado; después, sólo el
    // profesorado, porque ya forma parte de la biblioteca de la materia.
    if (!canEdit(actor, resource, context.role === 'teacher')) {
      throw new HttpError(403, 'No puedes borrar este recurso.');
    }

    await deleteCourseResource(resourceId);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
