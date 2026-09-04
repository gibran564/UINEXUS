import { errorResponse, requireWriter } from '@/lib/server/session';
import { requireCourseTeacher, resolveMember } from '@/lib/server/course-access';
import { buildStudentInCourse } from '@/lib/server/academic-views';

/**
 * Ficha académica de una persona DENTRO de una materia (§14).
 *
 * La ruta lleva el `courseId` delante por una razón que no es estética: el
 * `handle` se resuelve contra la lista de ESA materia, así que sólo se puede
 * consultar a quien está inscrito en ella, y lo que se devuelve está filtrado
 * por esa misma materia. No hay forma de pedir «todo lo de esta persona».
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string; handle: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId, handle } = await params;
    const { course } = await requireCourseTeacher(actor, courseId);

    const member = resolveMember(course, decodeURIComponent(handle).replace(/^@/, ''));
    return Response.json(await buildStudentInCourse(course, member));
  } catch (caught) {
    return errorResponse(caught);
  }
}
