import 'server-only';

import {
  getAssignmentRecord,
  getCourseRecord,
  isAssignedTo,
} from '../data/academic';
import type {
  AssignmentRecord,
  CourseMemberRecord,
  CourseRecord,
  CourseRole,
} from '../types';
import { HttpError, type Actor } from './session';

/**
 * Autorización del aula.
 *
 * Extiende `session.ts` con las preguntas que sólo tienen sentido dentro de una
 * materia, y sigue su misma disciplina: TODO en un único archivo, porque una
 * comprobación repartida por veinte rutas es una comprobación que alguien
 * olvidará en la veintiuna.
 *
 * Las reglas, en una frase cada una:
 *
 *  · Docente de UNA materia ≠ docente de TODAS. Tener `role: 'teacher'` en el
 *    perfil sólo habilita a CREAR materias. Sobre una materia concreta manda
 *    estar en su lista de docentes, y nada más. Es la diferencia entre un rol
 *    global y un permiso por recurso, y es justo lo que pide §15.
 *  · El alumnado ve la materia donde está inscrito, las tareas que se le
 *    asignaron y sus propias entregas. Nada más, y nunca por descubrimiento:
 *    lo que no le corresponde responde 404, no 403.
 *  · `admin` conserva lo que ya tenía. No se le amplía nada aquí.
 *
 * Por qué 404 y no 403: confirmar «esta materia existe pero no es tuya» ya
 * permite enumerar materias y tareas ajenas. Es el mismo criterio que aplica
 * `requireWritableProject()` en `session.ts` con los borradores.
 */

export interface CourseContext {
  course: CourseRecord;
  role: CourseRole;
  /** La ficha del actor dentro de la materia, con su UID. Sólo servidor. */
  member: CourseMemberRecord | null;
}

/**
 * Declaración de función, no arrow: sólo así TypeScript entiende que la línea
 * siguiente es inalcanzable y estrecha el tipo de `course` a no-nulo.
 */
function notFound(): never {
  throw new HttpError(404, 'Esa materia no existe o no tienes acceso.');
}

function roleWithin(course: CourseRecord, actor: Actor): CourseRole | null {
  if (course.teachers.some((member) => member.uid === actor.uid)) return 'teacher';
  if (course.students.some((member) => member.uid === actor.uid)) return 'student';
  // Un administrador entra como docente para poder resolver incidencias, que es
  // el permiso que ya tenía sobre proyectos. No se le añade ninguno nuevo.
  if (actor.profile.role === 'admin') return 'teacher';
  return null;
}

/** Contexto de la materia para quien participa en ella. 404 si no participa. */
export async function requireCourseContext(
  actor: Actor,
  courseId: string
): Promise<CourseContext> {
  const course = await getCourseRecord(courseId);
  if (!course) notFound();

  const role = roleWithin(course, actor);
  if (!role) notFound();

  const list = role === 'teacher' ? course.teachers : course.students;
  return {
    course,
    role,
    member: list.find((member) => member.uid === actor.uid) ?? null,
  };
}

/** Igual, pero exige ser docente DE ESTA materia. */
export async function requireCourseTeacher(
  actor: Actor,
  courseId: string
): Promise<CourseContext> {
  const context = await requireCourseContext(actor, courseId);
  if (context.role !== 'teacher') notFound();
  return context;
}

/** Sólo quien puede crear materias. El rol global sí decide esto. */
export function requireCourseCreator(actor: Actor): void {
  if (actor.profile.role !== 'teacher' && actor.profile.role !== 'admin') {
    throw new HttpError(403, 'Sólo el profesorado puede crear materias.');
  }
}

export interface AssignmentContext extends CourseContext {
  assignment: AssignmentRecord;
}

/**
 * Tarea que el actor tiene derecho a ver.
 *
 * Para el profesorado, cualquiera de su materia, borradores incluidos. Para el
 * alumnado, sólo las publicadas y asignadas a él. Un borrador ajeno y una tarea
 * de otro grupo responden lo mismo que una que no existe.
 */
export async function requireAssignmentAccess(
  actor: Actor,
  assignmentId: string
): Promise<AssignmentContext> {
  const assignment = await getAssignmentRecord(assignmentId);
  if (!assignment) throw new HttpError(404, 'Esa tarea no existe.');

  const context = await requireCourseContext(actor, assignment.courseId);

  if (context.role !== 'teacher' && !isAssignedTo(assignment, actor.uid)) {
    throw new HttpError(404, 'Esa tarea no existe.');
  }

  return { ...context, assignment };
}

/** Tarea que el actor puede modificar: sólo docente de la materia. */
export async function requireAssignmentTeacher(
  actor: Actor,
  assignmentId: string
): Promise<AssignmentContext> {
  const context = await requireAssignmentAccess(actor, assignmentId);
  if (context.role !== 'teacher') throw new HttpError(404, 'Esa tarea no existe.');
  return context;
}

/**
 * Traduce handles a miembros reales de la materia.
 *
 * Es el punto donde el UID vuelve a aparecer, y es deliberado que sea el único:
 * un handle que no está inscrito no se resuelve, así que no hay forma de
 * asignar una tarea —ni de exportar una entrega— de alguien ajeno al grupo.
 */
export function resolveMembers(
  course: CourseRecord,
  handles: readonly string[]
): CourseMemberRecord[] {
  const byHandle = new Map(course.students.map((member) => [member.handle, member]));
  const resolved: CourseMemberRecord[] = [];
  const missing: string[] = [];

  for (const handle of handles) {
    const member = byHandle.get(handle.toLowerCase());
    if (member) resolved.push(member);
    else missing.push(handle);
  }

  if (missing.length > 0) {
    throw new HttpError(
      422,
      `No están inscritos en esta materia: ${missing.slice(0, 5).join(', ')}.`
    );
  }

  return resolved;
}

/** Un solo miembro por handle, para las vistas «Materia > Estudiantes > X». */
export function resolveMember(course: CourseRecord, handle: string): CourseMemberRecord {
  const [member] = resolveMembers(course, [handle]);
  // `resolveMembers` lanza 422 antes de llegar aqui si el handle no esta
  // inscrito, asi que la lista nunca vuelve vacia.
  if (!member) throw new HttpError(404, 'Esa persona no esta en la materia.');
  return member;
}
