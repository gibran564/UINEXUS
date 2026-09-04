import { buildCollaborativeView } from '@/lib/collaborative';
import {
  canAnswerGroup,
  isAssignedTo,
  listAssignmentsByCourse,
  listCoursesForUser,
  listSubmissionsByAssignment,
  listSubmissionsByStudent,
} from '@/lib/data/academic';
import { toAssignment, toCourseDetail } from '@/lib/data/academic-mappers';
import { errorResponse, requireWriter } from '@/lib/server/session';
import type { Assignment, CourseDetail, CourseRole, SubmissionStatus } from '@/lib/types';

/**
 * Portada del aula: lo primero que ve cualquiera al entrar.
 *
 * Es un solo endpoint y no uno por materia por una razón concreta: la portada
 * del alumnado necesita cruzar TODAS sus materias para responder «¿qué me toca
 * ahora?», y hacerlo con una petición por materia convierte una pantalla en una
 * cascada de peticiones que se pinta a trompicones.
 *
 * Lo que devuelve depende del rol EN CADA materia, no de un rol global: se
 * puede ser docente de una y estudiante de otra, y la portada lo refleja.
 */

export interface AulaCourseCard {
  course: CourseDetail;
  role: CourseRole;
  assignments: number;
  /** Docente: entregas sin revisar. Alumnado: tareas que le faltan. */
  attention: number;
  /**
   * La actividad colaborativa más reciente de la materia, con su avance (§36).
   * Es UNA sola: el panel dice cómo va lo que está en marcha, no lleva la
   * contabilidad de todo el semestre.
   */
  collaborative: { assignmentId: string; title: string; done: number; total: number } | null;
}

export interface AulaPendingItem {
  assignment: Assignment;
  courseId: string;
  courseName: string;
  status: SubmissionStatus | null;
  /** Cuántos conceptos le tocan, si es una actividad colaborativa (§37). */
  myConcepts: number | null;
  /** Cuántos prompts y Skills lleva asociados, para anunciarlo en la tarjeta. */
  resources: { prompts: number; skills: number };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const memberships = await listCoursesForUser(actor.uid);

    const cards: AulaCourseCard[] = [];
    const pending: AulaPendingItem[] = [];

    for (const { course, role } of memberships) {
      const all = await listAssignmentsByCourse(course.id);

      if (role === 'teacher') {
        let unreviewed = 0;
        for (const assignment of all) {
          if (assignment.status === 'draft') continue;
          const submissions = await listSubmissionsByAssignment(assignment.id);
          unreviewed += submissions.filter((s) => s.status === 'submitted').length;
        }

        // `all` viene ordenado por `createdAt` descendente desde el índice, así
        // que la primera colaborativa publicada es la más reciente.
        const latestShared = all.find(
          (assignment) =>
            assignment.collaborationMode === 'shared' && assignment.status === 'published'
        );

        let collaborative: AulaCourseCard['collaborative'] = null;
        if (latestShared) {
          const view = buildCollaborativeView({
            assignment: latestShared,
            course,
            submissions: await listSubmissionsByAssignment(latestShared.id),
            viewerRole: 'teacher',
            viewerUid: actor.uid,
          });
          collaborative = {
            assignmentId: latestShared.id,
            title: latestShared.title,
            done: view.progress.done,
            total: view.progress.total,
          };
        }

        cards.push({
          course: toCourseDetail(course, role),
          role,
          assignments: all.length,
          attention: unreviewed,
          collaborative,
        });
        continue;
      }

      const mine = all.filter((assignment) => isAssignedTo(assignment, actor.uid));
      const submissions = await listSubmissionsByStudent(actor.uid, course.id);
      const byAssignment = new Map(submissions.map((s) => [s.assignmentId, s.status]));

      let outstanding = 0;
      for (const assignment of mine) {
        const status = byAssignment.get(assignment.id) ?? null;
        // Un borrador sigue siendo algo que hacer; una entrega revisada no.
        const done = status === 'submitted' || status === 'reviewed';
        if (!done && assignment.status === 'published') {
          outstanding += 1;
          pending.push({
            assignment: toAssignment(assignment, { viewerRole: 'student' }),
            courseId: course.id,
            courseName: course.name,
            status,
            // Cuántos conceptos le tocan. Es la primera pregunta que se hace
            // quien abre una actividad colaborativa, así que se responde ya en
            // la tarjeta y no una pantalla más adentro.
            myConcepts:
              assignment.collaborationMode === 'shared'
                ? [...new Set(assignment.researchQuestions.map((q) => q.groupId))].filter(
                    (groupId) => canAnswerGroup(assignment, groupId, actor.uid)
                  ).length
                : null,
            resources: {
              prompts: assignment.resources.filter((ref) => ref.kind === 'prompt').length,
              skills: assignment.resources.filter((ref) => ref.kind === 'skill').length,
            },
          });
        }
      }

      cards.push({
        course: toCourseDetail(course, role),
        role,
        assignments: mine.length,
        attention: outstanding,
        collaborative: null,
      });
    }

    /**
     * Lo que vence antes va primero, y lo que no tiene fecha va al final: una
     * tarea sin fecha límite nunca debe empujar hacia abajo a una que vence
     * mañana.
     */
    pending.sort((a, b) => {
      const left = a.assignment.dueDate ?? '9999-12-31';
      const right = b.assignment.dueDate ?? '9999-12-31';
      return left.localeCompare(right);
    });

    return Response.json({
      role: actor.profile.role,
      displayName: actor.profile.displayName,
      courses: cards,
      pending: pending.slice(0, 12),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
