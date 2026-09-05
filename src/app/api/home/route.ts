import {
  isAssignedTo,
  listAssignmentsByCourse,
  listCourseResources,
  listCoursesForUser,
  listPromptTemplates,
  listSkills,
  listSubmissionsByAssignment,
  listSubmissionsByStudent,
} from '@/lib/data/academic';
import {
  toCourseResource,
  toPromptTemplate,
  toSkillResource,
} from '@/lib/data/academic-mappers';
import { listPublicationsFor } from '@/lib/server/publications';
import type { PublicationDTO } from '@/lib/publications';
import {
  attentionReason,
  filterEventsByCourse,
  sortAttention,
  sortEvents,
  sortTeacherTasks,
  type AttentionItem,
  type AttentionProgress,
  type FeedEvent,
  type TeacherTask,
} from '@/lib/home-feed';
import { isPastDue } from '@/lib/due-date';
import { missingRequiredSteps, workflowProgress } from '@/lib/workflow';
import { errorResponse, HttpError, requireWriter } from '@/lib/server/session';
import type {
  AssignmentRecord,
  CourseMember,
  CourseMemberRecord,
  CourseRecord,
  CourseRole,
  ResourceAuthorship,
  StepEvidence,
  SubmissionRecord,
} from '@/lib/types';
import { normalizeStepEvidence } from '@/lib/workflow';

/**
 * El Inicio autenticado: una sola petición.
 *
 * ## Por qué un endpoint y no diez
 *
 * El Inicio responde cuatro preguntas —qué me toca, qué cambió, qué publicó mi
 * docente y qué está haciendo mi clase— y las cuatro cruzan TODAS las materias
 * de quien pregunta. Resolverlas con una petición por tarjeta convierte la
 * portada en una cascada que se pinta a trompicones y multiplica el coste por
 * el número de elementos, que es justo lo que crece. Aquí se lee cada tabla una
 * vez por materia y se compone en memoria.
 *
 * ## La frontera de privacidad está aquí
 *
 * Lo que alguien no puede ver no llega a su navegador. En concreto:
 *
 *  · Sólo se recorren las materias de las que la persona es miembro
 *    (`listCoursesForUser`). No hay parámetro que permita pedir otra.
 *  · El alumnado sólo ve actividades PUBLICADAS y asignadas a él. Un borrador
 *    de la docente no existe para el muro.
 *  · Sólo se publican recursos APROBADOS. Una propuesta pendiente no puede
 *    aparecer en el muro de nadie: sería publicarla saltándose la moderación.
 *  · De las entregas ajenas no sale NADA: ni estado, ni nota, ni si alguien
 *    entregó. El muro cuenta lo que la gente publica, no cómo le va.
 *  · Los proyectos entran mediante publicaciones aprobadas con audiencia;
 *    publicar una página pública por sí solo no la incorpora al muro.
 */

const FEED_LIMIT = 20;
const ATTENTION_LIMIT = 12;

export interface HomePayload {
  role: 'student' | 'teacher' | 'admin';
  displayName: string;
  handle: string;
  /** En qué materias está y con qué papel en cada una. */
  courses: { id: string; name: string; role: CourseRole; code: string | null }[];
  /** Lo que el ALUMNADO tiene que hacer, ya ordenado. */
  attention: AttentionItem[];
  /** Lo que el PROFESORADO tiene que atender, ya ordenado. */
  teacherTasks: TeacherTask[];
  publications: PublicationDTO[];
  teacherUpdates: FeedEvent[];
  classroomActivity: FeedEvent[];
}

/** Handle → ficha de persona, para poner cara a un evento. */
function memberIndex(courses: readonly CourseRecord[]): Map<string, CourseMember> {
  const index = new Map<string, CourseMember>();
  for (const course of courses) {
    for (const person of [...course.teachers, ...course.students]) {
      index.set(person.handle, {
        handle: person.handle,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
      });
    }
  }
  return index;
}

/** La ficha de quien aportó un recurso, completada con la lista de la materia. */
function actorFor(
  item: ResourceAuthorship,
  people: Map<string, CourseMember>
): CourseMember | null {
  if (!item.author) return null;
  return people.get(item.author.handle) ?? item.author;
}

/** Avance del workflow de MI entrega. Nunca se calcula sobre la de otro. */
function progressFor(
  assignment: AssignmentRecord,
  submission: SubmissionRecord | undefined,
  uid: string
): AttentionProgress | null {
  if (assignment.workflow.length <= 1) return null;

  const evidence: Record<string, StepEvidence> = submission
    ? normalizeStepEvidence(submission)
    : {};
  const progress = workflowProgress(assignment.workflow, evidence, uid);
  const missing = missingRequiredSteps(assignment.workflow, evidence, uid);

  return {
    done: progress.done,
    total: progress.total,
    nextStepTitle: missing[0]?.title ?? null,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const memberships = await listCoursesForUser(actor.uid);
    const filterCourseId = new URL(request.url).searchParams.get('courseId') ?? '';
    if (filterCourseId && !memberships.some(({ course, role }) => course.id === filterCourseId && role === 'teacher')) {
      throw new HttpError(404, 'Ese grupo no está disponible para el filtro.');
    }
    const now = new Date();

    const courses = memberships.map(({ course }) => course);
    const people = memberIndex(courses);
    const teachingIn = new Set(
      memberships.filter(({ role }) => role === 'teacher').map(({ course }) => course.id)
    );

    const attention: AttentionItem[] = [];
    const teacherTasks: TeacherTask[] = [];
    const teacherUpdates: FeedEvent[] = [];
    const classroomActivity: FeedEvent[] = [];

    /**
     * Todas MIS entregas en una sola consulta, no una por materia. El índice
     * `byStudent` ya las trae juntas; repartirlas después es gratis.
     */
    const mySubmissions = await listSubmissionsByStudent(actor.uid);
    const myByAssignment = new Map(mySubmissions.map((item) => [item.assignmentId, item]));

    for (const { course, role } of memberships) {
      const teacherHandles = new Set(course.teachers.map((teacher) => teacher.handle));

      const [assignments, promptRecords, skillRecords, resourceRecords] = await Promise.all([
        listAssignmentsByCourse(course.id),
        listPromptTemplates(course.id),
        listSkills(course.id),
        listCourseResources(course.id),
      ]);

      /**
       * Se pasa por los mismos mapeadores que la biblioteca. No es ceremonia:
       * son la frontera que convierte los UID desnormalizados del registro en
       * personas con handle, y saltársela aquí habría filtrado identificadores
       * internos al muro.
       */
      const prompts = promptRecords.map(toPromptTemplate);
      const skills = skillRecords.map(toSkillResource);
      const resources = resourceRecords.map(toCourseResource);

      const published = assignments.filter((assignment) => assignment.status === 'published');

      // -------------------------------------------------------------------
      // Qué hay que hacer
      // -------------------------------------------------------------------

      if (role === 'student') {
        for (const assignment of published) {
          if (!isAssignedTo(assignment, actor.uid)) continue;

          const submission = myByAssignment.get(assignment.id);
          const reason = attentionReason(
            {
              dueDate: assignment.dueDate,
              dueAt: assignment.dueAt,
              createdAt: assignment.createdAt,
              submissionStatus: submission?.status ?? null,
            },
            now
          );
          if (!reason) continue;

          attention.push({
            assignmentId: assignment.id,
            courseId: course.id,
            courseName: course.name,
            title: assignment.title,
            reason,
            dueDate: assignment.dueDate,
            dueAt: assignment.dueAt,
            submissionStatus: submission?.status ?? null,
            progress: progressFor(assignment, submission, actor.uid),
            createdAt: assignment.createdAt,
          });
        }
      } else {
        teacherTasks.push(...(await teacherTasksFor(course, published, now)));

        /**
         * Las propuestas esperando revisión. Se cuentan de las tres tablas
         * juntas porque la decisión es una sola —«hay algo que aprobar»— y
         * repartirla en tres tarjetas convertiría el Inicio en un panel.
         */
        const proposed = [...prompts, ...skills, ...resources].filter(
          (item) => item.status === 'proposed'
        );
        if (proposed.length > 0) {
          teacherTasks.push({
            kind: 'moderation',
            courseId: course.id,
            courseName: course.name,
            assignmentId: null,
            title: 'Aportaciones por aprobar',
            count: proposed.length,
            submitted: null,
            audience: null,
            dueAt: null,
            dueDate: null,
          });
        }
      }

      // -------------------------------------------------------------------
      // El muro
      // -------------------------------------------------------------------

      const events: FeedEvent[] = [];

      for (const assignment of published) {
        // Una actividad que no es tuya no aparece en tu muro, aunque sea de tu
        // materia: el reparto selectivo dejaría de significar nada.
        if (role === 'student' && !isAssignedTo(assignment, actor.uid)) continue;

        events.push({
          id: `assignment:${assignment.id}`,
          kind: 'assignment',
          courseId: course.id,
          courseName: course.name,
          actor: course.teachers[0] ? people.get(course.teachers[0].handle) ?? null : null,
          title: assignment.title,
          summary: assignment.description,
          at: assignment.createdAt,
          href: `/aula/${course.id}/tareas/${assignment.id}`,
          ctaLabel: 'Ver la actividad',
        });
      }

      for (const prompt of prompts) {
        if (prompt.status !== 'approved') continue;
        events.push({
          id: `prompt:${prompt.id}`,
          kind: 'prompt',
          courseId: course.id,
          courseName: course.name,
          actor: actorFor(prompt, people),
          title: prompt.title,
          summary: prompt.description,
          at: prompt.createdAt,
          href: `/aula/${course.id}?tab=resources`,
          ctaLabel: 'Ver el prompt',
        });
      }

      for (const skill of skills) {
        if (skill.status !== 'approved') continue;
        events.push({
          id: `skill:${skill.id}`,
          kind: 'skill',
          courseId: course.id,
          courseName: course.name,
          actor: actorFor(skill, people),
          title: skill.title,
          summary: skill.description,
          at: skill.createdAt,
          href: `/aula/${course.id}/recursos/skills/${skill.id}`,
          ctaLabel: 'Ver la Skill',
        });
      }

      for (const resource of resources) {
        if (resource.status !== 'approved') continue;
        const isNotice = resource.type === 'announcement';
        events.push({
          id: `resource:${resource.id}`,
          kind: isNotice ? 'announcement' : 'resource',
          courseId: course.id,
          courseName: course.name,
          actor: actorFor(resource, people),
          title: resource.title,
          // Un aviso ES su texto; un recurso se anuncia con su descripción.
          summary: isNotice ? resource.content : resource.description,
          at: resource.createdAt,
          href: `/aula/${course.id}?tab=resources`,
          ctaLabel: isNotice ? 'Ver en la materia' : 'Ver el recurso',
        });
      }

      /**
       * Quién lo publicó decide en qué bloque cae. Una actividad siempre es del
       * profesorado; lo demás depende de quién lo aportó, que es exactamente la
       * distinción que la pantalla hace entre «tu docente» y «tu clase».
       */
      for (const event of events) {
        const fromTeacher =
          event.kind === 'assignment' ||
          (event.actor !== null && teacherHandles.has(event.actor.handle));
        (fromTeacher ? teacherUpdates : classroomActivity).push(event);
      }
    }

    // Compartir un proyecto también exige audiencia y aprobación estudiantil.
    const publications = await listPublicationsFor(actor);
    for (const publication of publications) {
      if (publication.status !== 'approved') continue;
      const audience = courses.filter((course) => publication.audienceCourseIds.includes(course.id));
      const first = audience[0];
      if (!first) continue;
      const event: FeedEvent = {
        id: 'publication:' + publication.id,
        publicationId: publication.id,
        audienceCourseIds: audience.map((course) => course.id),
        kind: publication.kind,
        courseId: first.id,
        courseName: audience.map((course) => course.name).join(' · '),
        actor: publication.author,
        title: publication.title,
        summary: publication.content,
        at: publication.createdAt,
        href: publication.detailHref,
        ctaLabel: publication.kind === 'project' ? 'Ver página / proyecto' : 'Ver contenido',
        approvedByName: publication.approvedBy?.displayName,
      };
      (publication.origin === 'teacher' ? teacherUpdates : classroomActivity).push(event);
    }

    const payload: HomePayload = {
      role: actor.profile.role,
      displayName: actor.profile.displayName,
      handle: actor.profile.handle,
      courses: memberships.map(({ course, role }) => ({
        id: course.id,
        name: course.name,
        role,
        // El código sólo lo necesita quien puede dictarlo en clase.
        code: teachingIn.has(course.id) ? course.code : null,
      })),
      attention: sortAttention(attention).slice(0, ATTENTION_LIMIT),
      teacherTasks: sortTeacherTasks(teacherTasks).slice(0, ATTENTION_LIMIT),
      publications: publications.filter((publication) => publication.status !== 'approved'),
      teacherUpdates: sortEvents(filterEventsByCourse(teacherUpdates, filterCourseId), FEED_LIMIT),
      classroomActivity: sortEvents(filterEventsByCourse(classroomActivity, filterCourseId), FEED_LIMIT),
    };

    return Response.json(payload);
  } catch (caught) {
    return errorResponse(caught);
  }
}

/**
 * Lo que le toca al profesorado en una materia.
 *
 * Se cuenta sobre las entregas reales, no sobre una estimación: «21 de 31» sólo
 * sirve si el 31 es la audiencia de ESA actividad y el 21 son entregas que
 * existen. Nada de esto sale del bloque agregado: los números viajan, las
 * entregas ajenas no.
 */
async function teacherTasksFor(
  course: CourseRecord,
  published: readonly AssignmentRecord[],
  now: Date
): Promise<TeacherTask[]> {
  const tasks: TeacherTask[] = [];

  for (const assignment of published) {
    const submissions = await listSubmissionsByAssignment(assignment.id);
    const audience = audienceOf(assignment, course.students);
    const delivered = submissions.filter(
      (submission) => submission.status === 'submitted' || submission.status === 'reviewed'
    ).length;
    const unreviewed = submissions.filter(
      (submission) => submission.status === 'submitted'
    ).length;

    /**
     * «Cierra hoy» sólo mientras siga abierta. Una vez pasada la hora ya no hay
     * nada que recordar a nadie, y lo que queda es revisar lo que llegó.
     */
    const due = assignment.dueAt ?? assignment.dueDate;
    if (due && !isPastDue(assignment, now)) {
      const left = new Date(assignment.dueAt ?? `${assignment.dueDate}T23:59:59Z`).getTime() -
        now.getTime();
      if (Number.isFinite(left) && left <= 24 * 60 * 60 * 1000 && delivered < audience) {
        tasks.push({
          kind: 'closing',
          courseId: course.id,
          courseName: course.name,
          assignmentId: assignment.id,
          title: assignment.title,
          count: audience - delivered,
          submitted: delivered,
          audience,
          dueAt: assignment.dueAt,
          dueDate: assignment.dueDate,
        });
      }
    }

    if (unreviewed > 0) {
      tasks.push({
        kind: 'review',
        courseId: course.id,
        courseName: course.name,
        assignmentId: assignment.id,
        title: assignment.title,
        count: unreviewed,
        submitted: delivered,
        audience,
        dueAt: assignment.dueAt,
        dueDate: assignment.dueDate,
      });
    }
  }

  return tasks;
}

/** A cuánta gente se asignó realmente la actividad. */
function audienceOf(
  assignment: AssignmentRecord,
  students: readonly CourseMemberRecord[]
): number {
  if (assignment.assignedTo === null) return students.length;
  const enrolled = new Set(students.map((student) => student.uid));
  return assignment.assignedTo.filter((uid) => enrolled.has(uid)).length;
}
