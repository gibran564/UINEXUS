import 'server-only';

import { getPromptTemplate, getSkill } from '../data/academic';
import { toPromptTemplate, toSkillResource } from '../data/academic-mappers';
import type { PromptTemplate, ResourceRef, SkillResource, WorkflowStepRecord } from '../types';

/**
 * Resuelve referencias a recursos de la biblioteca de IA.
 *
 * Las tareas y los AI Worklogs guardan `{ kind, id }` y no una copia del
 * recurso (§20 y §27). Eso significa que hay que ir a buscarlos al pintar, y
 * trae dos consecuencias que conviene tener a la vista:
 *
 *  · Un recurso corregido se corrige en todas partes a la vez. Es lo que se
 *    quiere: hay un prompt, no doce copias que envejecen por separado.
 *  · Un recurso BORRADO deja una referencia que no resuelve. Aquí se OMITE en
 *    silencio en vez de fallar: que la docente borre una Skill no puede
 *    convertir en inabrible la tarea que la recomendaba. La referencia
 *    huérfana queda en el registro y simplemente deja de aparecer, igual que
 *    una entrega huérfana tras borrar su tarea.
 */

export interface ResolvedResources {
  prompts: PromptTemplate[];
  skills: SkillResource[];
}

export async function resolveResources(
  refs: readonly ResourceRef[]
): Promise<ResolvedResources> {
  if (refs.length === 0) return { prompts: [], skills: [] };

  const promptIds = [...new Set(refs.filter((r) => r.kind === 'prompt').map((r) => r.id))];
  const skillIds = [...new Set(refs.filter((r) => r.kind === 'skill').map((r) => r.id))];

  const [prompts, skills] = await Promise.all([
    Promise.all(promptIds.map((id) => getPromptTemplate(id))),
    Promise.all(skillIds.map((id) => getSkill(id))),
  ]);

  return {
    prompts: prompts.flatMap((item) => (item ? [toPromptTemplate(item)] : [])),
    skills: skills.flatMap((item) => (item ? [toSkillResource(item)] : [])),
  };
}

/**
 * Igual, pero comprobando que los recursos son de la materia indicada Y están
 * aprobados.
 *
 * Dos garantías en una función:
 *
 *  · Una referencia sólo puede apuntar a un recurso de SU propia materia. Sin
 *    esto, una tarea podría recomendar el prompt de otro grupo con sólo conocer
 *    su id, y la biblioteca de una materia dejaría de ser suya.
 *  · Sólo se puede referenciar lo APROBADO. Recomendar una propuesta pendiente
 *    la publicaría por la puerta de atrás: aparecería en la tarea de todo el
 *    grupo sin haber pasado por revisión, que es exactamente lo que la
 *    moderación viene a impedir.
 *
 * Se aplica al GUARDAR, que es donde se puede rechazar de verdad.
 */
export async function assertResourcesBelongTo(
  courseId: string,
  refs: readonly ResourceRef[]
): Promise<ResourceRef[]> {
  const checked: ResourceRef[] = [];

  for (const ref of refs) {
    const found =
      ref.kind === 'prompt' ? await getPromptTemplate(ref.id) : await getSkill(ref.id);
    // Una referencia a un recurso ajeno, inexistente o sin aprobar no se
    // guarda. No se responde error: el efecto observable —no aparece— es el
    // mismo, y así una tarea no se vuelve inguardable porque alguien borró o
    // archivó un recurso entre que se abrió el formulario y se pulsó guardar.
    if (found && found.courseId === courseId && found.status === 'approved') {
      checked.push(ref);
    }
  }

  return checked;
}

/**
 * Resuelve las herramientas que mencionan los pasos de una tarea.
 *
 * Devuelve sólo las que EXISTEN y están aprobadas, indexadas por id. El
 * consumidor las usa para enriquecer —descripción, enlace, cómo se usa— y
 * NUNCA para decidir qué se muestra: el nombre de la herramienta vive en el
 * propio paso (`tool.toolNames`) y sigue ahí aunque el recurso desaparezca.
 *
 * Es la mitad durable de §50: el catálogo puede vaciarse entero y las tareas
 * seguirán diciendo «usa Perplexity».
 */
export async function resolveStepTools(
  courseId: string,
  steps: readonly { tool: { toolIds: string[] } }[]
): Promise<Record<string, { id: string; title: string; url: string | null; description: string }>> {
  const ids = [...new Set(steps.flatMap((step) => step.tool.toolIds))];
  if (ids.length === 0) return {};

  const { getCourseResource } = await import('../data/academic');
  const found = await Promise.all(ids.map((id) => getCourseResource(id)));

  return Object.fromEntries(
    found
      .filter(
        (resource): resource is NonNullable<typeof resource> =>
          resource !== null && resource.courseId === courseId && resource.status === 'approved'
      )
      .map((resource) => [
        resource.id,
        {
          id: resource.id,
          title: resource.title,
          url: resource.url,
          description: resource.description,
        },
      ])
  );
}

/**
 * Acota a la materia el prompt de biblioteca que cita cada paso.
 *
 * Misma regla que `assertResourcesBelongTo`, y por el mismo motivo: conocer un
 * id no puede bastar para colgar en una actividad el prompt de otro grupo.
 *
 * Un prompt ESCRITO en la actividad (`inline`) no pasa por aquí porque no
 * apunta a nada: vive en la tarea. Eso es justamente lo que se quería —la
 * biblioteca es reutilización, no un requisito—, y por eso el saneado es sólo
 * de la referencia. Si la referencia no resuelve se degrada a `none` en vez de
 * responder error: la tarea no puede volverse inguardable porque alguien
 * archivara un prompt mientras el formulario estaba abierto.
 */
export async function scopeStepPrompts(
  courseId: string,
  steps: readonly WorkflowStepRecord[]
): Promise<WorkflowStepRecord[]> {
  const checked: WorkflowStepRecord[] = [];

  for (const step of steps) {
    if (step.prompt.mode !== 'library' || !step.prompt.resourceId) {
      checked.push(step);
      continue;
    }

    const found = await getPromptTemplate(step.prompt.resourceId);
    const usable = found && found.courseId === courseId && found.status === 'approved';

    checked.push(
      usable
        ? { ...step, prompt: { ...step.prompt, title: step.prompt.title || found.title } }
        : { ...step, prompt: { ...step.prompt, mode: 'none', resourceId: null } }
    );
  }

  return checked;
}
