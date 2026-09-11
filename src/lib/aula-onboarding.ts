import type { CourseRole, UserRole } from './types';

/**
 * Cuándo se le ofrece a alguien crear su primer grupo.
 *
 * Está aquí, en una función pura, porque la regla tiene una trampa que conviene
 * poder probar sin navegador: NO es «no tiene materias». Un profesor puede estar
 * inscrito como participante en la materia de un colega —o cursando otra— y
 * seguir sin haber creado la suya. Si la condición mirara el total de materias,
 * ese profesor no vería nunca la invitación y tendría que descubrir por su
 * cuenta que el botón de crear existe.
 *
 * Lo que decide, entonces, son dos cosas independientes: si el rol permite crear
 * materias, y si YA IMPARTE alguna. Lo que curse no entra en la decisión.
 */
export function shouldOfferFirstCourse(input: {
  /** Rol global del perfil. Sólo `teacher` y `admin` pueden crear materias. */
  role: UserRole | null | undefined;
  /** Las materias de la persona con su papel en cada una. */
  courses: readonly { role: CourseRole }[];
}): boolean {
  if (!canCreateCourses(input.role)) return false;
  return !input.courses.some((card) => card.role === 'teacher');
}

/** El rol global sólo habilita a CREAR materias. Ver `course-access.ts`. */
export function canCreateCourses(role: UserRole | null | undefined): boolean {
  return role === 'teacher' || role === 'admin';
}
