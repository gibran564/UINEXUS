import { describe, expect, it } from 'vitest';
import { isAssignedTo, submissionIdFor } from '../../src/lib/data/academic';
import {
  toAssignment,
  toCourseDetail,
  toSubmission,
} from '../../src/lib/data/academic-mappers';
import { resolveMembers } from '../../src/lib/server/course-access';
import { progressOf } from '../../src/lib/server/academic-views';
import { assignment, course, submission, UID } from './academic-fixtures';

/**
 * Lo que se prueba aquí son las reglas de acceso del aula, no la interfaz.
 *
 * §24 pide comprobar que un estudiante no ve lo que no le toca y que el UID no
 * se escapa. Ambas cosas viven en funciones puras —`isAssignedTo`, los mappers,
 * `resolveMembers`—, así que se pueden comprobar sin nube. Lo que NO cubre esto
 * es la autorización de extremo a extremo de cada ruta de API, que necesita
 * DynamoDB Local; queda anotado en CHECKPOINTS.md.
 */

describe('visibilidad de una tarea para el alumnado', () => {
  it('una tarea publicada para todo el grupo le toca a cualquiera', () => {
    const item = assignment({ assignedTo: null, status: 'published' });
    expect(isAssignedTo(item, UID.christian)).toBe(true);
    expect(isAssignedTo(item, UID.ana)).toBe(true);
  });

  it('un borrador no le toca a nadie del alumnado, ni siquiera si está asignado', () => {
    const item = assignment({ status: 'draft', assignedTo: [UID.christian] });
    expect(isAssignedTo(item, UID.christian)).toBe(false);
  });

  it('una tarea asignada a algunos NO la ve quien no está en la lista', () => {
    const item = assignment({ assignedTo: [UID.ana], status: 'published' });
    expect(isAssignedTo(item, UID.ana)).toBe(true);
    expect(isAssignedTo(item, UID.christian)).toBe(false);
  });

  it('una tarea cerrada se sigue viendo: cerrada no es borrada', () => {
    const item = assignment({ status: 'closed', assignedTo: null });
    expect(isAssignedTo(item, UID.christian)).toBe(true);
  });
});

describe('el UID nunca cruza al navegador', () => {
  it('el id de una entrega no contiene el UID de quien la escribió', () => {
    const id = submissionIdFor('assignment-1', UID.christian);
    expect(id).not.toContain(UID.christian);
    expect(id).toHaveLength(32);
  });

  it('el id de una entrega es determinista y distinto por persona y por tarea', () => {
    expect(submissionIdFor('a', UID.ana)).toBe(submissionIdFor('a', UID.ana));
    expect(submissionIdFor('a', UID.ana)).not.toBe(submissionIdFor('a', UID.christian));
    expect(submissionIdFor('a', UID.ana)).not.toBe(submissionIdFor('b', UID.ana));
  });

  it('el DTO de una entrega no lleva studentId ni reviewedBy', () => {
    const dto = toSubmission(submission({ reviewedBy: UID.luz }));
    expect(JSON.stringify(dto)).not.toContain(UID.christian);
    expect(JSON.stringify(dto)).not.toContain(UID.luz);
    expect(dto.student.handle).toBe('christian');
  });

  it('el DTO de una tarea traduce los asignados a handles para el profesorado', () => {
    const dto = toAssignment(assignment({ assignedTo: [UID.ana] }), {
      viewerRole: 'teacher',
      roster: course().students,
    });
    expect(dto.assignedTo).toEqual(['ana']);
    expect(dto.assignedToAll).toBe(false);
  });

  it('un UID sin handle en la lista se omite en vez de devolverse tal cual', () => {
    const dto = toAssignment(assignment({ assignedTo: [UID.ana, 'uid-que-ya-no-esta'] }), {
      viewerRole: 'teacher',
      roster: course().students,
    });
    expect(dto.assignedTo).toEqual(['ana']);
  });

  it('al alumnado no se le dice a qué compañeros más se asignó la tarea', () => {
    const dto = toAssignment(assignment({ assignedTo: [UID.ana, UID.christian] }), {
      viewerRole: 'student',
      roster: course().students,
    });
    expect(dto.assignedTo).toBeNull();
    expect(dto.assignedToAll).toBe(false);
  });
});

describe('la lista de la materia', () => {
  it('el profesorado recibe la lista de estudiantes', () => {
    const detail = toCourseDetail(course(), 'teacher');
    expect(detail.students).toHaveLength(2);
    expect(JSON.stringify(detail)).not.toContain(UID.christian);
  });

  it('el alumnado NO recibe la lista de sus compañeros', () => {
    const detail = toCourseDetail(course(), 'student');
    expect(detail.students).toEqual([]);
    expect(detail.viewerRole).toBe('student');
  });

  it('studentCount se recalcula de la lista real', () => {
    const detail = toCourseDetail(course({ studentCount: 99 }), 'teacher');
    expect(detail.studentCount).toBe(2);
  });
});

describe('resolución de handles contra la materia', () => {
  it('traduce a UID sólo a quien está inscrito', () => {
    const resolved = resolveMembers(course(), ['ana', 'christian']);
    expect(resolved.map((member) => member.uid)).toEqual([UID.ana, UID.christian]);
  });

  it('rechaza un handle que no está en la materia', () => {
    expect(() => resolveMembers(course(), ['ana', 'pedro'])).toThrow(/pedro/);
  });

  it('rechaza al propio profesorado como destinatario de una tarea', () => {
    // La lista de asignables son los ESTUDIANTES. Un docente no se asigna
    // tareas a sí mismo, y colarlo dejaría entregas que nadie sabría revisar.
    expect(() => resolveMembers(course(), ['profesora-luz'])).toThrow();
  });
});

describe('avance de una tarea', () => {
  it('cuenta entregas sólo de quien está asignado', () => {
    const item = assignment({ assignedTo: [UID.christian] });
    const progress = progressOf(course(), item, [
      submission({ studentId: UID.christian, status: 'submitted' }),
      // Ana entregó y luego se le quitó la asignación: su entrega existe pero
      // no debe desvirtuar el "1 de 1".
      submission({ id: 'x', studentId: UID.ana, status: 'submitted' }),
    ]);
    expect(progress).toEqual({ assigned: 1, submitted: 1, reviewed: 0, pending: 0 });
  });

  it('un borrador no cuenta como entrega', () => {
    const progress = progressOf(course(), assignment(), [
      submission({ studentId: UID.christian, status: 'draft' }),
    ]);
    expect(progress.submitted).toBe(0);
    expect(progress.pending).toBe(2);
  });

  it('«requiere cambios» sigue contando como entregado, y como no revisado', () => {
    const progress = progressOf(course(), assignment(), [
      submission({ studentId: UID.christian, status: 'needs_changes' }),
      submission({ id: 'y', studentId: UID.ana, status: 'reviewed' }),
    ]);
    expect(progress.submitted).toBe(2);
    expect(progress.reviewed).toBe(1);
    expect(progress.pending).toBe(0);
  });
});
