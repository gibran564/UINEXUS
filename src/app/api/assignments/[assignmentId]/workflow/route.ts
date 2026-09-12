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

    /**
     * Lo decide el TIPO, no cuántas partes hay.
     *
     * Una actividad por partes con una sola sigue siéndolo, y su avance es
     * exactamente igual de útil: quién la hizo y quién no. Contar partes
     * rechazaba con un 409 la pantalla que el profesorado abre por defecto en
     * una actividad de un solo laboratorio —la pestaña se ofrecía y luego
     * fallaba—, y confundía además «una parte» con «ninguna», porque la lectura
     * sintetiza una para las actividades anteriores.
     *
     * Una actividad anterior a los procesos sí se rechaza, y sigue siendo
     * correcto: su única parte es sintética, no la escribió nadie.
     */
    if (assignment.type !== 'workflow') {
      throw new HttpError(409, 'Esta actividad no está organizada por partes.');
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
