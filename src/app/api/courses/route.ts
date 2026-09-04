import { courseInputSchema } from '@/lib/academic-schemas';
import { listCoursesForUser } from '@/lib/data/academic';
import { toCourseDetail } from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseCreator } from '@/lib/server/course-access';
import { createCourse } from '@/lib/server/academic-writes';

/**
 * Las materias de quien pide.
 *
 * GET  → las materias donde participa, con su rol en cada una.
 * POST → crea una materia. Sólo profesorado y administración.
 *
 * Igual que en `/api/projects`, la consulta se hace SIEMPRE con el uid del
 * token: no hay ningún parámetro con el que pedir «las materias de otro».
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const memberships = await listCoursesForUser(actor.uid);

    return Response.json({
      courses: memberships.map(({ course, role }) => toCourseDetail(course, role)),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    requireCourseCreator(actor);

    const input = await readJson(request, courseInputSchema);
    const course = await createCourse(actor, input);

    return Response.json({ course: toCourseDetail(course, 'teacher') }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
