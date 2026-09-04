import { assignmentInputSchema } from '@/lib/academic-schemas';
import { listAssignmentsByCourse, isAssignedTo } from '@/lib/data/academic';
import { toAssignment } from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import {
  requireCourseContext,
  requireCourseTeacher,
  resolveMembers,
} from '@/lib/server/course-access';
import { buildWorkflowSteps, createAssignment } from '@/lib/server/academic-writes';
import { assertResourcesBelongTo } from '@/lib/server/resources';
import { ACADEMIC_LIMITS } from '@/lib/constants';
import { HttpError } from '@/lib/server/session';

/**
 * Tareas de una materia.
 *
 * GET  → las que corresponden a quien pide. El profesorado ve todas, incluidos
 *        borradores; el alumnado, sólo las publicadas y asignadas a él.
 * POST → crea una tarea. Sólo docente de ESTA materia.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { course, role } = await requireCourseContext(actor, courseId);

    const all = await listAssignmentsByCourse(courseId);
    const visible = role === 'teacher' ? all : all.filter((item) => isAssignedTo(item, actor.uid));

    return Response.json({
      assignments: visible.map((item) =>
        toAssignment(item, { viewerRole: role, roster: course.students })
      ),
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

    const existing = await listAssignmentsByCourse(courseId);
    if (existing.length >= ACADEMIC_LIMITS.maxAssignmentsPerCourse) {
      throw new HttpError(409, 'Esta materia llegó al límite de tareas.');
    }

    const input = await readJson(request, assignmentInputSchema);

    /**
     * `assignedHandles` ausente o nulo significa TODO EL GRUPO, y es el
     * comportamiento por defecto. Una lista se traduce a UID contra la lista de
     * la materia: `resolveMembers` rechaza cualquier handle que no esté
     * inscrito, así que no se puede asignar una tarea a alguien de fuera.
     */
    const assignedUids =
      input.assignedHandles == null ? null : resolveMembers(course, input.assignedHandles).map((m) => m.uid);

    /**
     * El reparto por concepto tambien se traduce de handles a UID contra la
     * lista de la materia. Es la misma defensa que en `assignedHandles`: no se
     * puede repartir trabajo a alguien que no esta inscrito, porque su handle
     * simplemente no resuelve.
     */
    const groupAssignments = input.groupAssignments.map((entry) => ({
      groupId: entry.groupId,
      assignedTo: resolveMembers(course, entry.assignedTo).map((member) => member.uid),
    }));


    // Un recurso recomendado tiene que ser de ESTA materia (ver
    // lib/server/resources.ts): si no, conocer un id bastaria para colgar en la
    // tarea el prompt de otro grupo.
    const resources = await assertResourcesBelongTo(courseId, input.resources);


    /**
     * Los responsables de cada paso se traducen de handles a UID contra la
     * lista de la materia, igual que el resto de asignaciones: un handle que no
     * esta inscrito no resuelve, asi que no se puede repartir un paso a alguien
     * de fuera.
     */
    const workflow = buildWorkflowSteps(input.workflow, (handles) =>
      resolveMembers(course, handles).map((member) => member.uid)
    );

    const assignment = await createAssignment(
      actor,
      courseId,
      { ...input, resources },
      assignedUids,
      groupAssignments,
      workflow
    );

    return Response.json(
      { assignment: toAssignment(assignment, { viewerRole: 'teacher', roster: course.students }) },
      { status: 201 }
    );
  } catch (caught) {
    return errorResponse(caught);
  }
}
