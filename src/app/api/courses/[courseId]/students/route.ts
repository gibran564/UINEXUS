import { z } from 'zod';
import { enrollInputSchema, memberHandleSchema } from '@/lib/academic-schemas';
import { searchPeople } from '@/lib/data/academic';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseTeacher } from '@/lib/server/course-access';
import { buildRoster } from '@/lib/server/academic-views';
import { enrollMembers, removeMember } from '@/lib/server/academic-writes';

/**
 * Las personas de una materia. Sólo para el profesorado de ESA materia.
 *
 * GET    → la lista con sus recuentos dentro de la materia (§4).
 * POST   → inscribe por handle.
 * DELETE → quita a alguien. No borra sus entregas, sólo el acceso.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { course } = await requireCourseTeacher(actor, courseId);

    return Response.json({
      students: await buildRoster(course),
      teachers: course.teachers.map((member) => ({
        handle: member.handle,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl ?? null,
      })),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { course } = await requireCourseTeacher(actor, courseId);

    const input = await readJson(request, enrollInputSchema);

    /**
     * Los handles se resuelven contra la tabla de usuarios, no contra lo que
     * mande el cliente: inscribir a alguien que no existe crearía una plaza
     * fantasma que luego nadie puede ocupar ni quitar.
     */
    const people = [];
    for (const handle of input.handles) {
      const [match] = await searchPeople(handle, 5);
      const exact = match?.handle === handle ? match : null;
      if (!exact) throw new HttpError(422, `No existe nadie con el usuario @${handle}.`);
      people.push(exact);
    }

    const updated = await enrollMembers(course, people, input.role);
    return Response.json({ students: await buildRoster(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

const removeSchema = z.object({
  handle: memberHandleSchema,
  role: z.enum(['student', 'teacher']).default('student'),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { course } = await requireCourseTeacher(actor, courseId);

    const input = await readJson(request, removeSchema);
    const list = input.role === 'teacher' ? course.teachers : course.students;
    const member = list.find((person) => person.handle === input.handle);
    if (!member) throw new HttpError(404, 'Esa persona no está en la materia.');

    const updated = await removeMember(course, member.uid, input.role);
    return Response.json({ students: await buildRoster(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}
