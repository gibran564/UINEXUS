import { reviewInputSchema } from '@/lib/academic-schemas';
import { getSubmissionById } from '@/lib/data/academic';
import { toSubmission } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext } from '@/lib/server/course-access';
import { reviewSubmission } from '@/lib/server/academic-writes';

/**
 * Una entrega concreta.
 *
 * GET   → el detalle. El profesorado de la materia, o su propio autor.
 * PATCH → revisión. Sólo el profesorado, y sólo el estado y la nota: el
 *         contenido de la entrega no lo puede tocar nadie más que quien la
 *         escribió.
 *
 * El permiso se resuelve SIEMPRE por la materia de la entrega, nunca por el rol
 * global: un docente de otra materia recibe el mismo 404 que un desconocido.
 */

async function loadAuthorized(request: Request, submissionId: string) {
  const actor = await requireWriter(request);
  const submission = await getSubmissionById(submissionId);
  if (!submission) throw new HttpError(404, 'Esa entrega no existe.');

  const context = await requireCourseContext(actor, submission.courseId);

  const isOwner = submission.studentId === actor.uid;
  if (context.role !== 'teacher' && !isOwner) {
    throw new HttpError(404, 'Esa entrega no existe.');
  }

  return { actor, submission, context };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
): Promise<Response> {
  try {
    const { submissionId } = await params;
    const { submission, context } = await loadAuthorized(request, submissionId);

    return Response.json({
      submission: toSubmission(submission),
      courseName: context.course.name,
      viewerRole: context.role,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
): Promise<Response> {
  try {
    const { submissionId } = await params;
    const { actor, submission, context } = await loadAuthorized(request, submissionId);

    if (context.role !== 'teacher') {
      throw new HttpError(403, 'Sólo el profesorado revisa entregas.');
    }

    const input = await readJson(request, reviewInputSchema);
    const updated = await reviewSubmission(actor, submission, input);

    return Response.json({ submission: toSubmission(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}
