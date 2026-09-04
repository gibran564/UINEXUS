import { moderationInputSchema, promptTemplateInputSchema } from '@/lib/academic-schemas';
import { getPromptTemplate } from '@/lib/data/academic';
import { toPromptTemplate } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext, requireCourseTeacher } from '@/lib/server/course-access';
import {
  applyModeration,
  deletePromptTemplate,
  updatePromptTemplate,
  writePromptRaw,
} from '@/lib/server/academic-writes';

/**
 * Un prompt de la biblioteca.
 *
 * Lo lee quien participa en la materia —el alumnado tiene que poder copiarlo—
 * y lo escribe sólo el profesorado de ESA materia.
 */

async function load(request: Request, promptId: string) {
  const actor = await requireWriter(request);
  const template = await getPromptTemplate(promptId);
  if (!template) throw new HttpError(404, 'Ese prompt no existe.');
  return { actor, template };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ promptId: string }> }
): Promise<Response> {
  try {
    const { promptId } = await params;
    const { actor, template } = await load(request, promptId);
    await requireCourseContext(actor, template.courseId);
    return Response.json({ prompt: toPromptTemplate(template) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ promptId: string }> }
): Promise<Response> {
  try {
    const { promptId } = await params;
    const { actor, template } = await load(request, promptId);

    /**
     * PATCH sirve para dos cosas y se distinguen por el cuerpo: `{ action }` es
     * una decisión de moderación —sólo profesorado de ESTA materia— y el resto
     * es una edición del contenido.
     */
    const body: unknown = await request.clone().json().catch(() => null);

    if (body && typeof body === 'object' && 'action' in body) {
      await requireCourseTeacher(actor, template.courseId);
      const decision = await readJson(request, moderationInputSchema);
      const next = {
        ...template,
        ...applyModeration(actor, template, decision.action),
        updatedAt: new Date().toISOString(),
      };
      await writePromptRaw(next);
      return Response.json({ prompt: toPromptTemplate(next) });
    }

    /**
     * Editar: el profesorado siempre; quien lo propuso mientras siga pendiente.
     * Una vez aprobado, el contenido pasa a ser de la biblioteca y cambiarlo
     * por debajo dejaría a la docente respaldando algo que ya no leyó.
     */
    if (template.status === 'approved' || template.teacherId !== actor.uid) {
      await requireCourseTeacher(actor, template.courseId);
    }

    const input = await readJson(request, promptTemplateInputSchema);
    const updated = await updatePromptTemplate(template, input);

    return Response.json({ prompt: toPromptTemplate(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ promptId: string }> }
): Promise<Response> {
  try {
    const { promptId } = await params;
    const { actor, template } = await load(request, promptId);
    await requireCourseTeacher(actor, template.courseId);

    await deletePromptTemplate(promptId);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
