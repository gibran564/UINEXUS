import { listSubmissionsByAssignment } from '@/lib/data/academic';
import { toSubmission, toSubmissions } from '@/lib/data/academic-mappers';
import { errorResponse, requireWriter } from '@/lib/server/session';
import { requireAssignmentAccess } from '@/lib/server/course-access';
import { progressOf } from '@/lib/server/academic-views';

/**
 * Entregas de una tarea.
 *
 * Para el profesorado: todas, más quién no ha entregado y el avance del grupo.
 * Para el alumnado: EXCLUSIVAMENTE la suya. No es un filtro sobre la lista
 * completa —eso sería leerla igualmente y confiar en el filtro—: la lista de
 * los demás no llega a leerse.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course, role } = await requireAssignmentAccess(actor, assignmentId);

    if (role !== 'teacher') {
      const { getOwnSubmission } = await import('@/lib/data/academic');
      const own = await getOwnSubmission(assignmentId, actor.uid);
      return Response.json({
        submissions: own ? [toSubmission(own)] : [],
        missing: [],
        progress: null,
      });
    }

    const records = await listSubmissionsByAssignment(assignmentId);
    const withSubmission = new Set(records.map((record) => record.studentId));

    const audience =
      assignment.assignedTo === null
        ? course.students
        : course.students.filter((member) => assignment.assignedTo?.includes(member.uid));

    const missing = audience
      .filter((member) => !withSubmission.has(member.uid))
      .map((member) => ({
        handle: member.handle,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl ?? null,
      }));

    return Response.json({
      submissions: toSubmissions(records).sort((a, b) =>
        a.student.displayName.localeCompare(b.student.displayName, 'es')
      ),
      missing: missing.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')),
      progress: progressOf(course, assignment, records),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
