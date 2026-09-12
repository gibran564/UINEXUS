import {
  isAssignedTo,
  listAssignmentsByCourse,
  listCourseResources,
  listCoursesForUser,
  listPromptTemplates,
  listSkills,
} from '@/lib/data/academic';
import {
  toCourseResource,
  toPromptTemplate,
  toSkillResource,
} from '@/lib/data/academic-mappers';
import { listProjectsByOwner } from '@/lib/data/repository';
import { errorResponse, requireWriter } from '@/lib/server/session';
import { resourceVisibleTo } from '@/lib/server/resource-visibility';
import {
  SEARCH,
  capResults,
  matchesQuery,
  rankResults,
  searchTerms,
  type SearchResult,
} from '@/lib/search';
import { publicProjectPath } from '@/lib/urls';

/**
 * Búsqueda global — el nivel que sólo puede hacer el servidor.
 *
 * ## Qué cubre, y qué NO cubre a propósito
 *
 * Cubre lo que está REPARTIDO: las actividades de las materias de quien busca,
 * los archivos que reparte el profesorado, los prompts, las Skills y los
 * recursos de la biblioteca, más sus propios proyectos.
 *
 * **No** cubre los espacios personales —NexLab y NexCode—, y eso no es un
 * olvido. El navegador ya tiene esa lista entera: `/api/workspaces` devuelve un
 * resumen por espacio y la pantalla de Espacios la pide igualmente. Duplicarla
 * aquí sería pedir dos veces lo mismo y arriesgarse a que las dos mitades de una
 * misma lista dijeran cosas distintas. La paleta filtra esa parte en memoria,
 * instantáneamente, y pregunta aquí sólo por el resto. Ver `docs/NEXTUDIO-ROADMAP.md` §D8.
 *
 * ## La autorización no se reimplementa aquí
 *
 * Ésta es la regla que sostiene toda la ruta y conviene decirla entera: **no hay
 * ni una sola comprobación de permisos escrita en este archivo**. Cada fuente se
 * filtra con la MISMA función que ya decide quién la ve en su pantalla:
 *
 * ```
 * materias   →  listCoursesForUser(uid)     sólo las suyas, con su rol
 * tareas     →  isAssignedTo()              la regla de requireAssignmentAccess
 * biblioteca →  resourceVisibleTo()         la regla de /api/courses/:id/library
 * proyectos  →  listProjectsByOwner(uid)    la firma no admite pedir los de otro
 * ```
 *
 * Una búsqueda que decidiera por su cuenta qué puede verse sería un segundo
 * sistema de permisos, y el segundo sistema es siempre el que se queda atrás.
 *
 * ## Coste, y dónde está el techo
 *
 * Un `Scan` de materias —el mismo que ya hace `/aula`— más dos a cuatro
 * consultas por materia. Con seis materias son unas veinte consultas, y por eso
 * el navegador espera 250 ms y exige dos caracteres antes de preguntar. El
 * umbral a partir del cual haría falta una proyección de metadatos está escrito
 * en el roadmap; hasta entonces, **no hay tabla nueva, ni índice nuevo, ni nada
 * que sincronizar**.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);

    const raw = new URL(request.url).searchParams.get('q') ?? '';
    const terms = searchTerms(raw);
    const length = terms.join('').length;

    // Menos de dos caracteres útiles no es una búsqueda: es cada pulsación
    // convertida en un abanico de consultas. Se responde vacío, no con un error:
    // el campo todavía se está escribiendo y no ha pasado nada malo.
    if (terms.length === 0 || length < SEARCH.minChars) {
      return Response.json({ results: [], truncated: false });
    }

    const found: SearchResult[] = [];

    // -- Proyectos propios ---------------------------------------------------
    //
    // `listProjectsByOwner` recibe el uid del token verificado. No existe
    // ninguna firma que permita pedir los de otra persona.
    const projects = await listProjectsByOwner(actor.uid);
    for (const project of projects) {
      if (!matchesQuery(terms, project.title, project.description, ...project.tags)) continue;
      found.push({
        key: `project:${project.id}`,
        kind: 'project',
        title: project.title,
        context: project.courseName ?? 'Mis proyectos',
        author: null,
        updatedAt: project.updatedAt,
        privacy: project.status === 'published' ? 'public' : 'private',
        href:
          project.status === 'published'
            ? publicProjectPath({ handle: project.ownerHandle, slug: project.slug })
            : `/dashboard/${project.id}/edit`,
      });
    }

    // -- Lo que vive dentro de una materia -----------------------------------
    const enrolled = (await listCoursesForUser(actor.uid)).slice(0, SEARCH.maxCourses);

    await Promise.all(
      enrolled.map(async ({ course, role }) => {
        const [assignments, prompts, skills, resources] = await Promise.all([
          listAssignmentsByCourse(course.id),
          listPromptTemplates(course.id),
          listSkills(course.id),
          listCourseResources(course.id),
        ]);

        /**
         * Exactamente la misma condición que `requireAssignmentAccess`: el
         * profesorado ve las suyas incluidos los borradores, el alumnado sólo
         * las publicadas que le tocan. Un borrador ajeno no aparece aquí por la
         * misma razón por la que responde 404 al abrirlo.
         */
        const visibleAssignments = assignments.filter(
          (assignment) => role === 'teacher' || isAssignedTo(assignment, actor.uid)
        );

        for (const assignment of visibleAssignments) {
          if (matchesQuery(terms, assignment.title, assignment.description, assignment.instructions)) {
            found.push({
              key: `assignment:${assignment.id}`,
              kind: 'assignment',
              title: assignment.title,
              context: course.name,
              author: null,
              updatedAt: assignment.updatedAt,
              privacy: 'course',
              href: `/aula/${course.id}/tareas/${assignment.id}`,
            });
          }

          /**
           * Los materiales no cuestan una consulta: viajan dentro de la tarea.
           * Sólo se miran los de las tareas que esa persona ya podía abrir, así
           * que no hay ninguna puerta nueva hacia un archivo de clase.
           */
          for (const material of assignment.materials) {
            if (!matchesQuery(terms, material.displayName, material.fileName)) continue;
            found.push({
              key: `material:${assignment.id}:${material.id}`,
              kind: 'material',
              title: material.displayName || material.fileName,
              context: `${course.name} · ${assignment.title}`,
              author: material.uploadedByName || null,
              updatedAt: material.createdAt,
              privacy: 'course',
              href: `/aula/${course.id}/tareas/${assignment.id}`,
            });
          }
        }

        const visible = resourceVisibleTo(role, actor.profile.handle);

        for (const prompt of prompts.map(toPromptTemplate).filter(visible)) {
          if (!matchesQuery(terms, prompt.title, prompt.description, prompt.prompt)) continue;
          found.push({
            key: `prompt:${prompt.id}`,
            kind: 'prompt',
            title: prompt.title,
            context: course.name,
            author: prompt.author?.displayName ?? null,
            updatedAt: prompt.updatedAt,
            privacy: 'course',
            href: `/aula/${course.id}?tab=resources`,
          });
        }

        for (const skill of skills.map(toSkillResource).filter(visible)) {
          if (!matchesQuery(terms, skill.title, skill.description, ...skill.tags)) continue;
          found.push({
            key: `skill:${skill.id}`,
            kind: 'skill',
            title: skill.title,
            context: course.name,
            author: skill.author?.displayName ?? null,
            updatedAt: skill.updatedAt,
            privacy: 'course',
            href: `/aula/${course.id}/recursos/skills/${skill.id}`,
          });
        }

        for (const resource of resources.map(toCourseResource).filter(visible)) {
          if (!matchesQuery(terms, resource.title, resource.description, ...resource.tags)) continue;
          found.push({
            key: `resource:${resource.id}`,
            kind: 'resource',
            title: resource.title,
            context: course.name,
            author: resource.author?.displayName ?? null,
            updatedAt: resource.updatedAt,
            privacy: 'course',
            href: `/aula/${course.id}?tab=resources`,
          });
        }
      })
    );

    const ranked = rankResults(terms, found);
    const results = capResults(ranked);

    return Response.json({ results, truncated: results.length < ranked.length });
  } catch (caught) {
    return errorResponse(caught);
  }
}
