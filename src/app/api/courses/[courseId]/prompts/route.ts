import { promptTemplateInputSchema } from '@/lib/academic-schemas';
import { listPromptTemplates } from '@/lib/data/academic';
import { toPromptTemplate } from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext } from '@/lib/server/course-access';
import { createPromptTemplate } from '@/lib/server/academic-writes';

/**
 * Biblioteca de prompts de una materia.
 *
 * §21 pedía dejar preparado el modelo sin sacrificar lo principal, y eso es
 * exactamente lo que hay: guardar, listar y borrar. Sin versiones, sin
 * comparación con el prompt del alumnado, sin categorías. Esas son iteración 3,
 * y la tabla ya está para recibirlas.
 *
 * Lo lee toda la clase —un prompt propuesto por la docente no tiene sentido si
 * el alumnado no puede verlo— y lo escribe sólo el profesorado.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    await requireCourseContext(actor, courseId);

    const templates = await listPromptTemplates(courseId);
    return Response.json({ prompts: templates.map(toPromptTemplate) });
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

    /**
     * Desde la iteración 4 lo puede crear cualquiera de la materia (§7). La
     * diferencia no está en quién escribe, sino en dónde acaba: el profesorado
     * crea aprobado y el alumnado propone. Lo decide el ROL, no el cuerpo.
     */
    const { role } = await requireCourseContext(actor, courseId);

    const input = await readJson(request, promptTemplateInputSchema);
    const created = await createPromptTemplate(actor, courseId, input, role === 'teacher');

    return Response.json({ prompt: toPromptTemplate(created) }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
