import { skillInputSchema } from '@/lib/academic-schemas';
import { ACADEMIC_LIMITS } from '@/lib/constants';
import { listSkills } from '@/lib/data/academic';
import { toSkillResource } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext } from '@/lib/server/course-access';
import { createSkill } from '@/lib/server/academic-writes';

/**
 * Skills de una materia.
 *
 * Una Skill es una FICHA que explica una habilidad de IA: qué hace, con qué
 * herramientas funciona, cómo se instala y cómo se usa. UINexus no ejecuta
 * nada de lo que aquí se guarda —los comandos son texto que se muestra y se
 * copia— y esa es una propiedad de la arquitectura, no una configuración: no
 * existe ninguna ruta, función ni cola que ejecute nada de esto.
 *
 * GET  → la lista. La ve toda la clase.
 * POST → crear. Sólo docente de ESTA materia.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    await requireCourseContext(actor, courseId);

    const skills = await listSkills(courseId);
    return Response.json({ skills: skills.map(toSkillResource) });
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

    /** Cualquiera de la materia puede proponer una Skill (§7). Ver el POST de
     *  prompts: el rol decide si nace aprobada o propuesta, no el cuerpo. */
    const { role } = await requireCourseContext(actor, courseId);

    const existing = await listSkills(courseId);
    if (existing.length >= ACADEMIC_LIMITS.maxSkillsPerCourse) {
      throw new HttpError(409, 'Esta materia llegó al límite de Skills.');
    }

    const input = await readJson(request, skillInputSchema);
    const skill = await createSkill(actor, courseId, input, role === 'teacher');

    return Response.json({ skill: toSkillResource(skill) }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
