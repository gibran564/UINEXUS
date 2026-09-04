import { getCourseResource } from '@/lib/data/academic';
import { cloneWorkflowSteps } from '@/lib/workflow';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';
import { requireCourseTeacher } from '@/lib/server/course-access';

/**
 * Los pasos de una plantilla, listos para una tarea nueva.
 *
 * Devuelve un CLON con identificadores nuevos. La plantilla no se toca: es la
 * fuente, y se puede usar cuantas veces haga falta.
 *
 * ## Por qué el clonado ocurre en el servidor
 *
 * Podría hacerlo el navegador —`cloneWorkflowSteps` es una función pura y está
 * disponible en ambos lados—, pero entonces la garantía de que los ids son
 * nuevos dependería de que el cliente la ejecutara. Aquí es una propiedad de la
 * respuesta: quien pide una plantilla recibe pasos nuevos, siempre.
 *
 * ## Quién puede
 *
 * Sólo docente de la materia: crear tareas es suyo, y esto es el primer paso de
 * crear una. Además la plantilla tiene que estar APROBADA. Una propuesta
 * pendiente —incluso la de un estudiante aplicado— no es todavía material de la
 * materia, y usarla para una tarea la publicaría por la puerta de atrás.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { resourceId } = await params;

    const resource = await getCourseResource(resourceId);
    if (!resource) throw new HttpError(404, 'Esa plantilla no existe.');

    await requireCourseTeacher(actor, resource.courseId);

    if (resource.type !== 'workflow') {
      throw new HttpError(409, 'Ese recurso no es una plantilla de proceso.');
    }
    if (resource.status !== 'approved') {
      throw new HttpError(
        409,
        'Esa plantilla todavía no está aprobada. Apruébala antes de usarla.'
      );
    }
    if (resource.workflowSteps.length === 0) {
      throw new HttpError(409, 'Esa plantilla no tiene pasos.');
    }

    /**
     * Los responsables se pierden en el clon, y es deliberado: una plantilla
     * puede venir de otra materia y esos UID no existirían aquí. Repartir es
     * una decisión de cada tarea.
     */
    const steps = cloneWorkflowSteps(resource.workflowSteps);

    return Response.json({
      title: resource.title,
      description: resource.description,
      /**
       * Los pasos viajan con `assignedHandles: null` porque el editor habla en
       * handles y una plantilla nunca trae responsables.
       */
      workflow: steps.map((step) => ({ ...step, assignedTo: null })),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
