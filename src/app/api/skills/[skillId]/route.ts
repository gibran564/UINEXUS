import { moderationInputSchema, skillInputSchema } from '@/lib/academic-schemas';
import { getSkill } from '@/lib/data/academic';
import { toSkillResource } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext, requireCourseTeacher } from '@/lib/server/course-access';
import {
  applyModeration,
  deleteSkill,
  updateSkill,
  writeSkillRaw,
} from '@/lib/server/academic-writes';

/**
 * Una Skill concreta.
 *
 * El permiso se resuelve SIEMPRE por la materia a la que pertenece, nunca por
 * el rol global: un docente de otra materia recibe el mismo 404 que alguien de
 * fuera. Es la misma regla que ya rige tareas y entregas
 * (`lib/server/course-access.ts`).
 */

async function load(request: Request, skillId: string) {
  const actor = await requireWriter(request);
  const skill = await getSkill(skillId);
  if (!skill) throw new HttpError(404, 'Esa Skill no existe.');
  return { actor, skill };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> }
): Promise<Response> {
  try {
    const { skillId } = await params;
    const { actor, skill } = await load(request, skillId);
    // Basta con participar en la materia: el alumnado necesita leerla para
    // seguir las instrucciones de instalación.
    await requireCourseContext(actor, skill.courseId);
    return Response.json({ skill: toSkillResource(skill) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> }
): Promise<Response> {
  try {
    const { skillId } = await params;
    const { actor, skill } = await load(request, skillId);

    /**
     * PATCH sirve para dos cosas y se distinguen por el cuerpo: `{ action }` es
     * una decisión de moderación —sólo profesorado de ESTA materia— y el resto
     * es una edición del contenido.
     */
    const body: unknown = await request.clone().json().catch(() => null);

    if (body && typeof body === 'object' && 'action' in body) {
      await requireCourseTeacher(actor, skill.courseId);
      const decision = await readJson(request, moderationInputSchema);
      const next = {
        ...skill,
        ...applyModeration(actor, skill, decision.action),
        updatedAt: new Date().toISOString(),
      };
      await writeSkillRaw(next);
      return Response.json({ skill: toSkillResource(next) });
    }

    // Misma regla que en los prompts: el profesorado siempre, y quien la
    // propuso mientras siga pendiente.
    if (skill.status === 'approved' || skill.createdBy !== actor.uid) {
      await requireCourseTeacher(actor, skill.courseId);
    }

    const input = await readJson(request, skillInputSchema);
    const updated = await updateSkill(skill, input);

    return Response.json({ skill: toSkillResource(updated) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> }
): Promise<Response> {
  try {
    const { skillId } = await params;
    const { actor, skill } = await load(request, skillId);
    await requireCourseTeacher(actor, skill.courseId);

    /**
     * Borrar la Skill deja colgando las referencias de las tareas que la
     * recomendaban. Es intencionado y simétrico con lo que ya pasa al borrar
     * una tarea con entregas: no hay cascada destructiva. Las vistas resuelven
     * los recursos que existen y omiten los que no, así que una referencia
     * huérfana no rompe nada: sólo deja de aparecer.
     */
    await deleteSkill(skillId);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
