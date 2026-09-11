import { describe, expect, it } from 'vitest';
import { canCreateCourses, shouldOfferFirstCourse } from '../../src/lib/aula-onboarding';

/**
 * Cuándo se invita a alguien a crear su primer grupo.
 *
 * La prueba que justifica que esto sea una función y no un `&&` suelto es la
 * tercera: un profesor inscrito como participante en la materia de un colega
 * TIENE materias y sigue sin impartir ninguna. Con la comprobación ingenua
 * —`courses.length === 0`— ese profesor no vería nunca la invitación.
 */

const teaching = { role: 'teacher' as const };
const studying = { role: 'student' as const };

describe('la llamada a crear el primer grupo', () => {
  it('un docente con CERO grupos impartidos la ve', () => {
    expect(shouldOfferFirstCourse({ role: 'teacher', courses: [] })).toBe(true);
  });

  it('un docente que ya imparte un grupo NO la ve', () => {
    expect(shouldOfferFirstCourse({ role: 'teacher', courses: [teaching] })).toBe(false);
  });

  it('un docente inscrito como alumno en otras materias SIGUE viéndola', () => {
    // Éste es el caso que la comprobación ingenua se comía: tiene materias,
    // pero ninguna suya.
    expect(shouldOfferFirstCourse({ role: 'teacher', courses: [studying, studying] })).toBe(true);
  });

  it('un docente que imparte una y cursa otra NO la ve', () => {
    expect(shouldOfferFirstCourse({ role: 'teacher', courses: [studying, teaching] })).toBe(false);
  });

  it('un estudiante NUNCA la ve', () => {
    expect(shouldOfferFirstCourse({ role: 'student', courses: [] })).toBe(false);
    expect(shouldOfferFirstCourse({ role: 'student', courses: [studying] })).toBe(false);
  });

  it('un administrador puede crear materias, así que también la ve', () => {
    expect(shouldOfferFirstCourse({ role: 'admin', courses: [] })).toBe(true);
    expect(shouldOfferFirstCourse({ role: 'admin', courses: [teaching] })).toBe(false);
  });

  it('sin rol todavía cargado no se enseña nada', () => {
    // Enseñar la bienvenida mientras la pantalla carga produciría un parpadeo
    // que aparece y desaparece sin que nadie sepa qué era.
    expect(shouldOfferFirstCourse({ role: null, courses: [] })).toBe(false);
    expect(shouldOfferFirstCourse({ role: undefined, courses: [] })).toBe(false);
  });
});

describe('quién puede crear materias', () => {
  it('el rol global sólo habilita a CREAR, y sólo a docentes y administración', () => {
    expect(canCreateCourses('teacher')).toBe(true);
    expect(canCreateCourses('admin')).toBe(true);
    expect(canCreateCourses('student')).toBe(false);
    expect(canCreateCourses(null)).toBe(false);
  });
});
