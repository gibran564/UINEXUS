import { listSubmissionsByAssignment } from '@/lib/data/academic';
import { buildWorkflowGroupView } from '@/lib/collaborative';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';
import { requireAssignmentTeacher } from '@/lib/server/course-access';
import { stepActionLabel } from '@/lib/constants';

/**
 * Avance paso a paso de una actividad (§34).
 *
 * Sólo docente de ESTA materia. Devuelve, por cada paso, cuántas personas de su
 * audiencia real lo completaron y quién es cada una, para poder entrar a ver la
 * evidencia.
 *
 * «Audiencia real» importa: si el paso 2 es sólo de Pedro, el marcador es
 * «1 de 1» y no «1 de 31». Decir lo contrario haría que el panel pareciera
 * atrasado cuando está al día, que es justo el dato que se usa para decidir a
 * quién hay que recordarle algo.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course } = await requireAssignmentTeacher(actor, assignmentId);

    if (assignment.workflow.length <= 1) {
      throw new HttpError(409, 'Esta actividad no tiene varios pasos.');
    }

    const submissions = await listSubmissionsByAssignment(assignmentId);
    const groupView = buildWorkflowGroupView(assignment, course, submissions);
    const steps = groupView.steps.map((step) => {
      return {
        stepId: step.id,
        title: step.title,
        actionLabel: stepActionLabel(step.actionType),
        required: step.required,
        toolNames: step.toolNames,
        deliverableType: step.deliverables[0]?.type ?? 'none',
        assigned: step.expectedParticipants,
        done: step.withEvidence,
        people: step.contributions.map((contribution) => ({
          ...contribution.author,
          done: contribution.state !== 'missing',
          /** La herramienta declarada es trazabilidad, no verificación. */
          toolName: contribution.evidence?.toolName ?? '',
          completedAt: contribution.evidence?.completedAt ?? null,
        })),
      };
    });

    return Response.json({ title: assignment.title, steps, groupView });
  } catch (caught) {
    return errorResponse(caught);
  }
}
