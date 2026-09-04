import { listSubmissionsByAssignment } from '@/lib/data/academic';
import { buildCollaborativeView } from '@/lib/collaborative';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';
import { requireAssignmentAccess } from '@/lib/server/course-access';

/**
 * La vista conjunta de una actividad colaborativa (§11).
 *
 * Es el sustituto del documento compartido de Drive, y se COMPONE aquí a partir
 * de la tarea y de las entregas reales. No hay ningún documento guardado que
 * devolver: si lo hubiera, sería una segunda copia del mismo contenido y las
 * dos acabarían diciendo cosas distintas.
 *
 * Lo que devuelve depende de quién pregunta, y lo decide el servidor:
 *
 *  · El profesorado ve todas las aportaciones.
 *  · El alumnado ve lo que permita `contributionVisibility` de la tarea. Con
 *    `own` recibe únicamente la suya —no una lista completa que el navegador
 *    tendría que filtrar—, y con `after_submit` no recibe nada ajeno mientras
 *    no haya entregado.
 *
 * El filtrado ocurre dentro de `buildCollaborativeView`, antes de serializar.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course, role } = await requireAssignmentAccess(actor, assignmentId);

    if (assignment.collaborationMode !== 'shared') {
      throw new HttpError(409, 'Esta tarea no es una actividad colaborativa.');
    }

    const submissions = await listSubmissionsByAssignment(assignmentId);

    return Response.json(
      buildCollaborativeView({
        assignment,
        course,
        submissions,
        viewerRole: role,
        viewerUid: actor.uid,
      })
    );
  } catch (caught) {
    return errorResponse(caught);
  }
}
