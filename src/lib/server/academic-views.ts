import 'server-only';

import {
  listAssignmentsByCourse,
  listSubmissionsByAssignment,
  listSubmissionsByStudent,
  isAssignedTo,
} from '../data/academic';
import { getUserRecordByUid, listProjectsByOwner } from '../data/repository';
import { buildCollaborativeView } from '../collaborative';
import { toAssignment, toCourseDetail, toSubmission } from '../data/academic-mappers';
import { toPublicProjects } from '../data/mappers';
import type {
  Assignment,
  ContributionState,
  CourseDetail,
  CourseMemberRecord,
  CourseRecord,
  Project,
  StudentProfile,
  Submission,
  SubmissionRecord,
  SubmissionStatus,
} from '../types';
import type { CourseContext } from './course-access';

/**
 * Composición de las vistas del aula.
 *
 * Las rutas de API de este proyecto son delgadas por decisión: comprueban el
 * permiso y devuelven. Todo lo que hay que juntar para pintar una pantalla se
 * arma aquí, en un solo sitio, para que la regla que de verdad importa se
 * pueda leer entera y comprobar de un vistazo:
 *
 *   NADA de lo que sale de este módulo mezcla materias.
 *
 * Es la exigencia explícita de §4 y §14 del encargo, y no es cosmética: el
 * perfil académico de una persona dentro de «Diseño Centrado en el Usuario» no
 * debe filtrar que también entrega en otra materia con otro docente. Por eso
 * cada consulta de entregas lleva `courseId` y cada recuento se calcula sobre
 * la lista ya filtrada.
 */

export interface AssignmentProgress {
  assignmentId: string;
  /** Cuántas personas tienen que entregar esto. */
  assigned: number;
  submitted: number;
  reviewed: number;
  pending: number;
}

/** Cuántas personas de la lista tienen que entregar esta tarea. */
function audienceOf(course: CourseRecord, assignment: { assignedTo: string[] | null }): CourseMemberRecord[] {
  if (assignment.assignedTo === null) return course.students;
  const targeted = new Set(assignment.assignedTo);
  return course.students.filter((member) => targeted.has(member.uid));
}

const COUNTED_AS_SUBMITTED: readonly SubmissionStatus[] = ['submitted', 'reviewed', 'needs_changes'];

export function progressOf(
  course: CourseRecord,
  assignment: { assignedTo: string[] | null },
  submissions: readonly SubmissionRecord[]
): Omit<AssignmentProgress, 'assignmentId'> {
  const audience = audienceOf(course, assignment);
  const audienceIds = new Set(audience.map((member) => member.uid));

  // Sólo cuentan las entregas de quien de verdad está asignado. Si alguien
  // entregó y luego se le quitó la asignación, su entrega existe pero no
  // desvirtúa el «24 de 31».
  const relevant = submissions.filter((submission) => audienceIds.has(submission.studentId));

  const submitted = relevant.filter((s) => COUNTED_AS_SUBMITTED.includes(s.status)).length;
  const reviewed = relevant.filter((s) => s.status === 'reviewed').length;

  return { assigned: audience.length, submitted, reviewed, pending: audience.length - submitted };
}

// ---------------------------------------------------------------------------
// Panel de la materia
// ---------------------------------------------------------------------------

export interface CourseOverview {
  course: CourseDetail;
  assignments: Assignment[];
  /** Sólo para el profesorado: cómo va cada tarea. */
  progress: AssignmentProgress[];
  /** Sólo para el alumnado: el estado de SUS entregas, tarea a tarea. */
  myStatus: { assignmentId: string; status: SubmissionStatus | null }[];
  unreviewed: number;
}

export async function buildCourseOverview(
  context: CourseContext,
  uid: string
): Promise<CourseOverview> {
  const { course, role } = context;
  const all = await listAssignmentsByCourse(course.id);

  // El alumnado no ve borradores ni tareas de otros: se filtra en el SERVIDOR,
  // que es lo único que cuenta. Ocultarlas en el cliente sería decoración.
  const visible = role === 'teacher' ? all : all.filter((item) => isAssignedTo(item, uid));

  const assignments = visible.map((item) =>
    toAssignment(item, { viewerRole: role, roster: course.students })
  );

  if (role !== 'teacher') {
    const mine = await listSubmissionsByStudent(uid, course.id);
    const byAssignment = new Map(mine.map((s) => [s.assignmentId, s.status]));
    return {
      course: toCourseDetail(course, role),
      assignments,
      progress: [],
      myStatus: visible.map((item) => ({
        assignmentId: item.id,
        status: byAssignment.get(item.id) ?? null,
      })),
      unreviewed: 0,
    };
  }

  const progress: AssignmentProgress[] = [];
  let unreviewed = 0;

  for (const assignment of visible) {
    const submissions = await listSubmissionsByAssignment(assignment.id);
    progress.push({ assignmentId: assignment.id, ...progressOf(course, assignment, submissions) });
    unreviewed += submissions.filter((s) => s.status === 'submitted').length;
  }

  return {
    course: toCourseDetail(course, role),
    assignments,
    progress,
    myStatus: [],
    unreviewed,
  };
}

// ---------------------------------------------------------------------------
// Panel de estudiantes de la materia (§4)
// ---------------------------------------------------------------------------

export interface RosterRow {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  assigned: number;
  submitted: number;
  reviewed: number;
  pending: number;
  worklogs: number;
}

/**
 * La lista de estudiantes con sus recuentos DENTRO de esta materia.
 *
 * Se resuelve leyendo las entregas por tarea, no por estudiante: son tantas
 * consultas como tareas (unas pocas por materia) en lugar de tantas como
 * personas (decenas). Con 6 tareas y 31 estudiantes son 6 consultas, no 31.
 */
export async function buildRoster(course: CourseRecord): Promise<RosterRow[]> {
  const assignments = (await listAssignmentsByCourse(course.id)).filter(
    (assignment) => assignment.status !== 'draft'
  );

  const rows = new Map<string, RosterRow>(
    course.students.map((member) => [
      member.uid,
      {
        handle: member.handle,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl ?? null,
        assigned: 0,
        submitted: 0,
        reviewed: 0,
        pending: 0,
        worklogs: 0,
      },
    ])
  );

  for (const assignment of assignments) {
    for (const member of audienceOf(course, assignment)) {
      const row = rows.get(member.uid);
      if (row) row.assigned += 1;
    }

    const submissions = await listSubmissionsByAssignment(assignment.id);
    for (const submission of submissions) {
      const row = rows.get(submission.studentId);
      if (!row) continue;
      if (COUNTED_AS_SUBMITTED.includes(submission.status)) row.submitted += 1;
      if (submission.status === 'reviewed') row.reviewed += 1;
      if (submission.type === 'ai_worklog' && COUNTED_AS_SUBMITTED.includes(submission.status)) {
        row.worklogs += 1;
      }
    }
  }

  return [...rows.values()]
    .map((row) => ({ ...row, pending: Math.max(0, row.assigned - row.submitted) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
}

// ---------------------------------------------------------------------------
// Perfil académico de una persona DENTRO de una materia (§14)
// ---------------------------------------------------------------------------

/** Lo que una persona aporta a UNA actividad colaborativa de esta materia. */
export interface CollaborativeContributionSummary {
  assignmentId: string;
  assignmentTitle: string;
  concepts: { groupId: string; title: string; state: ContributionState }[];
}

export interface StudentInCourse {
  student: { handle: string; displayName: string; avatarUrl: string | null };
  /** Ficha académica, si la ha rellenado. Nunca incluye correo ni UID. */
  academicProfile: StudentProfile | null;
  courseName: string;
  collaborative: CollaborativeContributionSummary[];
  assignments: {
    assignment: Assignment;
    submission: Submission | null;
  }[];
  projects: Project[];
  totals: { assigned: number; submitted: number; pending: number; reviewed: number; worklogs: number };
}

export async function buildStudentInCourse(
  course: CourseRecord,
  member: CourseMemberRecord
): Promise<StudentInCourse> {
  const assignments = (await listAssignmentsByCourse(course.id)).filter(
    (assignment) => assignment.status !== 'draft' && isAssignedTo(assignment, member.uid)
  );

  // El `courseId` no es opcional aquí: es lo que impide que aparezcan entregas
  // de otra materia en la ficha de esta.
  const submissions = await listSubmissionsByStudent(member.uid, course.id);
  const byAssignment = new Map(submissions.map((submission) => [submission.assignmentId, submission]));

  const rows = assignments.map((assignment) => {
    const submission = byAssignment.get(assignment.id) ?? null;
    return {
      assignment: toAssignment(assignment, { viewerRole: 'teacher', roster: course.students }),
      submission: submission ? toSubmission(submission) : null,
    };
  });

  const submitted = rows.filter(
    (row) => row.submission && COUNTED_AS_SUBMITTED.includes(row.submission.status)
  ).length;

  // Los proyectos publicados de esa persona EN ESTA MATERIA. Los de otras
  // materias existen, pero no pintan nada en esta ficha.
  const owned = await listProjectsByOwner(member.uid);
  const projects = toPublicProjects(
    owned.filter(
      (project) => project.courseId === course.id && project.status !== 'draft'
    )
  );

  /**
   * Las aportaciones colaborativas se derivan de la MISMA vista conjunta que ve
   * la clase, filtrada a esta persona. No hay un segundo cálculo del estado de
   * un apartado: si aquí dijera algo distinto de lo que dice el documento, una
   * de las dos cifras estaría mintiendo y no habría forma de saber cuál.
   */
  const collaborative: CollaborativeContributionSummary[] = [];

  for (const assignment of assignments.filter((item) => item.collaborationMode === 'shared')) {
    const all = await listSubmissionsByAssignment(assignment.id);
    const view = buildCollaborativeView({
      assignment,
      course,
      submissions: all,
      viewerRole: 'teacher',
      viewerUid: member.uid,
    });

    const concepts = view.sections
      .filter((section) =>
        section.contributions.some((entry) => entry.author.handle === member.handle) ||
        section.responsibles.some((person) => person.handle === member.handle)
      )
      .map((section) => ({
        groupId: section.groupId,
        title: section.title,
        state:
          section.contributions.find((entry) => entry.author.handle === member.handle)?.state ??
          ('missing' as ContributionState),
      }));

    if (concepts.length > 0) {
      collaborative.push({
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        concepts,
      });
    }
  }

  const profile = await getUserRecordByUid(member.uid);

  return {
    student: {
      handle: member.handle,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl ?? null,
    },
    // Sólo la ficha académica. El registro del perfil trae más cosas (rol,
    // suspensión) que no pintan nada en la vista de una materia.
    academicProfile: profile?.studentProfile ?? null,
    courseName: course.name,
    collaborative,
    assignments: rows,
    projects,
    totals: {
      assigned: rows.length,
      submitted,
      pending: Math.max(0, rows.length - submitted),
      reviewed: rows.filter((row) => row.submission?.status === 'reviewed').length,
      worklogs: rows.filter(
        (row) => row.submission?.type === 'ai_worklog' && row.submission.status !== 'draft'
      ).length,
    },
  };
}
