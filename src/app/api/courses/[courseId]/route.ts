import { courseInputSchema } from '@/lib/academic-schemas';
import { toCourseDetail } from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext, requireCourseTeacher } from '@/lib/server/course-access';
import { buildCourseOverview } from '@/lib/server/academic-views';
import { updateCourse } from '@/lib/server/academic-writes';

/**
 * Una materia.
 *
 * GET   → el panel completo: la materia, sus tareas y el avance. Lo que se
 *         devuelve depende del ROL dentro de la materia, no de lo que pida el
 *         cliente: el alumnado no recibe borradores ni tareas ajenas, y no hay
 *         parámetro con el que solicitarlos.
 * PATCH → editar la materia. Sólo docente de ESTA materia.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const context = await requireCourseContext(actor, courseId);

    return Response.json(await buildCourseOverview(context, actor.uid));
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { course } = await requireCourseTeacher(actor, courseId);

    const input = await readJson(request, courseInputSchema.partial());
    const updated = await updateCourse(course, input);

    return Response.json({ course: toCourseDetail(updated, 'teacher') });
  } catch (caught) {
    return errorResponse(caught);
  }
}
