import { listProjects } from '@/lib/data/repository';
import { errorResponse, requireWriter } from '@/lib/server/session';
import { requireCourseContext } from '@/lib/server/course-access';

/**
 * Proyectos publicados asociados a una materia.
 *
 * Se apoya en la galería que ya existe (`listProjects` sobre el índice disperso
 * `byStatus`) en vez de guardar una lista propia: un proyecto entregado como
 * tarea es EL MISMO proyecto que ya se publicó, y §16 pide explícitamente no
 * duplicarlo. Aquí sólo se filtra por materia.
 *
 * Que la lectura sea de la galería pública tiene una consecuencia deseable: un
 * borrador nunca aparece, porque los borradores no están en ese índice.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    await requireCourseContext(actor, courseId);

    const { projects } = await listProjects({ courseId, sort: 'recent' }, 1, 60);
    return Response.json({ projects });
  } catch (caught) {
    return errorResponse(caught);
  }
}
