import { courseResourceInputSchema } from '@/lib/academic-schemas';
import { listCourseResources, listPromptTemplates, listSkills } from '@/lib/data/academic';
import {
  toCourseResource,
  toPromptTemplate,
  toSkillResource,
} from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireCourseContext } from '@/lib/server/course-access';
import { createCourseResource } from '@/lib/server/academic-writes';
import type { ResourceStatus } from '@/lib/types';

/**
 * La biblioteca de la materia, entera (§6, §41).
 *
 * Prompts, Skills y recursos generales en una sola respuesta, porque la
 * pregunta que se hace quien entra es una sola —«¿con qué me ayudo?»— y
 * repartirla en tres peticiones pintaría la pantalla a saltos. Siguen siendo
 * tres tablas: se juntan aquí, no en el almacenamiento.
 *
 * ## Qué ve cada quien
 *
 * El profesorado ve TODO, incluidas las propuestas pendientes: sin eso no
 * podría moderarlas.
 *
 * El alumnado ve lo aprobado, más LO SUYO en cualquier estado. Lo segundo
 * importa tanto como lo primero: quien propone algo tiene derecho a ver qué
 * pasó con su propuesta, y una que desaparece sin dejar rastro sólo produce la
 * misma propuesta otra vez la semana siguiente.
 *
 * El filtrado ocurre aquí, antes de serializar. Lo que alguien no puede ver no
 * llega a su navegador.
 */

function visibleTo(
  role: 'teacher' | 'student',
  handle: string
): (item: { status: ResourceStatus; author: { handle: string } | null }) => boolean {
  if (role === 'teacher') return () => true;
  return (item) => item.status === 'approved' || item.author?.handle === handle;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { role } = await requireCourseContext(actor, courseId);

    const [prompts, skills, resources] = await Promise.all([
      listPromptTemplates(courseId),
      listSkills(courseId),
      listCourseResources(courseId),
    ]);

    const visible = visibleTo(role, actor.profile.handle);

    const promptDtos = prompts.map(toPromptTemplate).filter(visible);
    const skillDtos = skills.map(toSkillResource).filter(visible);
    const resourceDtos = resources.map(toCourseResource).filter(visible);

    return Response.json({
      prompts: promptDtos,
      skills: skillDtos,
      resources: resourceDtos,
      viewerRole: role,
      /**
       * Cuántas propuestas esperan revisión. Sólo tiene sentido para el
       * profesorado, así que para el alumnado va en cero en vez de contar
       * cosas que no puede ver.
       */
      pendingReview:
        role === 'teacher'
          ? [...promptDtos, ...skillDtos, ...resourceDtos].filter(
              (item) => item.status === 'proposed'
            ).length
          : 0,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

/**
 * Proponer o crear un recurso general (§7, §40).
 *
 * Lo puede hacer CUALQUIERA que participe en la materia. La diferencia no está
 * en quién puede escribir, sino en dónde acaba: el profesorado crea aprobado y
 * el alumnado propone. Eso lo decide `initialAuthorship` a partir del rol, no
 * el cuerpo de la petición.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { courseId } = await params;
    const { role } = await requireCourseContext(actor, courseId);

    const input = await readJson(request, courseResourceInputSchema);
    const created = await createCourseResource(actor, courseId, input, role === 'teacher');

    return Response.json({ resource: toCourseResource(created) }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
