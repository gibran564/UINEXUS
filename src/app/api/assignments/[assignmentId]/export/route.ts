import { listSubmissionsByAssignment } from '@/lib/data/academic';
import { toAssignment, toSubmissions } from '@/lib/data/academic-mappers';
import { buildExport, type ExportFormat } from '@/lib/export/submissions';
import { errorResponse, requireWriter } from '@/lib/server/session';
import { requireAssignmentTeacher } from '@/lib/server/course-access';

/**
 * Exportación de resultados de una tarea (§10 y §11).
 *
 * Sólo docente de ESTA materia: exportar es la operación que más datos junta de
 * una vez, así que es la que menos margen tiene. Un estudiante no puede llegar
 * aquí ni con el id correcto.
 *
 * Parámetros:
 *   format=json|csv|md      qué formato
 *   scope=all|worklogs      todo, o sólo los AI Worklogs
 *   students=ana,christian  handles separados por comas; ausente = todos
 *
 * Se filtra por handle y no por id de entrega porque el handle ya está acotado
 * a la materia: un handle de fuera no resuelve, y por tanto no se exporta. Con
 * ids de entrega habría que comprobar uno a uno que pertenecen a esta tarea, y
 * ese es justo el tipo de comprobación que se olvida.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course } = await requireAssignmentTeacher(actor, assignmentId);

    const url = new URL(request.url);
    const format = (url.searchParams.get('format') ?? 'md') as ExportFormat;
    const scope = url.searchParams.get('scope') === 'worklogs' ? 'worklogs' : 'all';
    const requested = (url.searchParams.get('students') ?? '')
      .split(',')
      .map((handle) => handle.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);

    if (!['json', 'csv', 'md'].includes(format)) {
      return Response.json({ error: 'Formato no admitido.' }, { status: 422 });
    }

    const records = await listSubmissionsByAssignment(assignmentId);
    const selected = new Set(requested);

    const submissions = toSubmissions(records)
      .filter((submission) => selected.size === 0 || selected.has(submission.student.handle))
      // Un borrador no es una entrega: incluirlo en un análisis compararía
      // trabajo terminado con trabajo a medias sin decirlo.
      .filter((submission) => submission.status !== 'draft')
      .sort((a, b) => a.student.displayName.localeCompare(b.student.displayName, 'es'));

    const delivered = new Set(submissions.map((submission) => submission.student.handle));
    const audience =
      assignment.assignedTo === null
        ? course.students
        : course.students.filter((member) => assignment.assignedTo?.includes(member.uid));

    const missing = audience
      .filter(
        (member) =>
          !delivered.has(member.handle) && (selected.size === 0 || selected.has(member.handle))
      )
      .map((member) => ({ handle: member.handle, displayName: member.displayName }));

    const result = buildExport(
      {
        assignment: toAssignment(assignment, { viewerRole: 'teacher', roster: course.students }),
        courseName: course.name,
        submissions,
        missing,
      },
      format,
      scope
    );

    return new Response(result.body, {
      headers: {
        'Content-Type': result.contentType,
        // `inline` y no `attachment`: la docente casi siempre quiere VER el
        // Markdown para copiarlo a una IA, no guardarlo en Descargas. La
        // interfaz ofrece descargar aparte, con el nombre que va aquí.
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
