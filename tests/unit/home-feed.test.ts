import { describe, expect, it } from 'vitest';
import {
  attentionCta,
  attentionRank,
  attentionReason,
  compareEvents,
  filterEventsByCourse,
  progressLabel,
  relativeTime,
  sortAttention,
  sortEvents,
  sortTeacherTasks,
  summarizeSince,
  type AttentionItem,
  type FeedEvent,
  type TeacherTask,
} from '@/lib/home-feed';
import { homeViewFor } from '@/components/home/home-gate';

/**
 * El Inicio autenticado.
 *
 * Todo lo que se prueba aquí es determinista y sin reloj real: el «ahora» se
 * inyecta. Lo que se comprueba es la promesa de la pantalla —lo urgente gana
 * espacio a lo social— y no el aspecto de las tarjetas.
 */

const NOW = new Date('2026-09-10T18:00:00.000Z');

function signals(overrides: Partial<Parameters<typeof attentionReason>[0]> = {}) {
  return {
    dueDate: null,
    dueAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    submissionStatus: null,
    ...overrides,
  };
}

describe('a quién se le enseña qué en /', () => {
  it('un visitante ve la portada pública', () => {
    expect(homeViewFor('anonymous')).toBe('landing');
  });

  it('quien tiene sesión ve su Inicio', () => {
    expect(homeViewFor('authenticated')).toBe('home');
  });

  it('mientras se resuelve la sesión no se promete ninguna de las dos', () => {
    expect(homeViewFor('loading')).toBe('pending');
  });
});

describe('por qué una actividad pide atención', () => {
  it('lo devuelto por la docente es lo primero', () => {
    expect(attentionReason(signals({ submissionStatus: 'needs_changes' }), NOW)).toBe(
      'needs_changes'
    );
  });

  it('una actividad entregada deja de pedir atención', () => {
    expect(attentionReason(signals({ submissionStatus: 'submitted' }), NOW)).toBeNull();
    expect(attentionReason(signals({ submissionStatus: 'reviewed' }), NOW)).toBeNull();
  });

  it('usa el instante de dueAt y no sólo el día', () => {
    // Mismo día natural, dos horas distintas: una ya venció y la otra no.
    const closing = signals({ dueDate: '2026-09-10', dueAt: '2026-09-10T23:59:00.000Z' });
    const passed = signals({ dueDate: '2026-09-10', dueAt: '2026-09-10T12:00:00.000Z' });

    expect(attentionReason(closing, NOW)).toBe('due_today');
    expect(attentionReason(passed, NOW)).toBe('closed');
  });

  it('distingue hoy, pronto y programada', () => {
    expect(attentionReason(signals({ dueAt: '2026-09-11T10:00:00.000Z' }), NOW)).toBe('due_today');
    expect(attentionReason(signals({ dueAt: '2026-09-14T10:00:00.000Z' }), NOW)).toBe('due_soon');
    expect(attentionReason(signals({ dueAt: '2026-10-14T10:00:00.000Z' }), NOW)).toBe('upcoming');
  });

  it('un borrador sin prisa está en progreso', () => {
    expect(attentionReason(signals({ submissionStatus: 'draft' }), NOW)).toBe('in_progress');
  });

  it('una actividad reciente sin fecha es nueva; una vieja, sin fecha límite', () => {
    expect(attentionReason(signals({ createdAt: '2026-09-09T00:00:00.000Z' }), NOW)).toBe('new');
    expect(attentionReason(signals({ createdAt: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(
      'no_deadline'
    );
  });

  it('deja de recordar una entrega cerrada hace mucho', () => {
    expect(attentionReason(signals({ dueAt: '2026-09-09T10:00:00.000Z' }), NOW)).toBe('closed');
    expect(attentionReason(signals({ dueAt: '2026-06-01T10:00:00.000Z' }), NOW)).toBeNull();
  });
});

describe('el orden de «Necesita tu atención»', () => {
  const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
    assignmentId: 'a',
    courseId: 'c',
    courseName: 'Materia',
    title: 'Actividad',
    reason: 'no_deadline',
    dueDate: null,
    dueAt: null,
    submissionStatus: null,
    progress: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });

  it('lo urgente va antes que lo tranquilo', () => {
    const sorted = sortAttention([
      item({ assignmentId: 'sin-fecha', reason: 'no_deadline' }),
      item({ assignmentId: 'nueva', reason: 'new' }),
      item({ assignmentId: 'hoy', reason: 'due_today' }),
      item({ assignmentId: 'devuelta', reason: 'needs_changes' }),
      item({ assignmentId: 'vencida', reason: 'overdue' }),
    ]);

    expect(sorted.map((entry) => entry.assignmentId)).toEqual([
      'devuelta',
      'vencida',
      'hoy',
      'nueva',
      'sin-fecha',
    ]);
  });

  it('una entrega cerrada nunca desplaza a una pendiente', () => {
    const sorted = sortAttention([
      item({ assignmentId: 'cerrada', reason: 'closed' }),
      item({ assignmentId: 'pendiente', reason: 'due_soon' }),
    ]);

    expect(sorted[0]!.assignmentId).toBe('pendiente');
    expect(attentionRank('closed')).toBeGreaterThan(attentionRank('due_soon'));
  });

  it('dentro del mismo motivo, lo que vence antes va primero', () => {
    const sorted = sortAttention([
      item({ assignmentId: 'viernes', reason: 'due_soon', dueAt: '2026-09-14T23:59:00.000Z' }),
      item({ assignmentId: 'jueves', reason: 'due_soon', dueAt: '2026-09-13T23:59:00.000Z' }),
    ]);

    expect(sorted.map((entry) => entry.assignmentId)).toEqual(['jueves', 'viernes']);
  });
});

describe('lo que dice el botón', () => {
  it('cambia con el estado y nunca es «Ver actividad»', () => {
    expect(attentionCta({ reason: 'new', submissionStatus: null })).toBe('Comenzar');
    expect(attentionCta({ reason: 'in_progress', submissionStatus: 'draft' })).toBe('Continuar');
    expect(attentionCta({ reason: 'due_soon', submissionStatus: 'submitted' })).toBe(
      'Ver mi entrega'
    );
    expect(attentionCta({ reason: 'due_soon', submissionStatus: 'reviewed' })).toBe(
      'Ver el resultado'
    );
    expect(attentionCta({ reason: 'needs_changes', submissionStatus: 'needs_changes' })).toBe(
      'Corregir y volver a entregar'
    );
  });

  it('una entrega cerrada no ofrece entregar', () => {
    expect(attentionCta({ reason: 'closed', submissionStatus: null })).toBe('Ver la actividad');
  });

  it('dice en qué paso se quedó', () => {
    expect(progressLabel({ done: 1, total: 4, nextStepTitle: 'Continuar con NotebookLM' })).toBe(
      'Paso 2 de 4 · Continuar con NotebookLM'
    );
    // Una actividad de un solo paso no tiene pasos que contar.
    expect(progressLabel({ done: 0, total: 1, nextStepTitle: 'X' })).toBe('');
    expect(progressLabel(null)).toBe('');
  });
});

describe('el orden del Inicio docente', () => {
  const task = (overrides: Partial<TeacherTask>): TeacherTask => ({
    kind: 'review',
    courseId: 'c',
    courseName: 'Materia',
    assignmentId: 'a',
    title: 'Actividad',
    count: 1,
    submitted: null,
    audience: null,
    dueAt: null,
    dueDate: null,
    ...overrides,
  });

  it('lo que cierra hoy va antes que lo que hay que revisar o moderar', () => {
    const sorted = sortTeacherTasks([
      task({ kind: 'moderation', title: 'aportaciones' }),
      task({ kind: 'review', title: 'entregas' }),
      task({ kind: 'closing', title: 'cierra hoy' }),
    ]);

    expect(sorted.map((entry) => entry.title)).toEqual([
      'cierra hoy',
      'entregas',
      'aportaciones',
    ]);
  });
});

  const event = (overrides: Partial<FeedEvent>): FeedEvent => ({
    id: 'e',
    kind: 'prompt',
    courseId: 'c',
    courseName: 'Materia',
    actor: null,
    title: 'Algo',
    summary: '',
    at: '2026-09-10T10:00:00.000Z',
    href: '/',
    ctaLabel: 'Ver',
    ...overrides,
  });

describe('el muro', () => {


  it('se ordena por fecha y por nada más', () => {
    const sorted = [
      event({ id: 'viejo', at: '2026-09-01T10:00:00.000Z' }),
      event({ id: 'nuevo', at: '2026-09-10T10:00:00.000Z' }),
    ].sort(compareEvents);

    expect(sorted.map((entry) => entry.id)).toEqual(['nuevo', 'viejo']);
  });

  it('resume lo publicado desde la última visita', () => {
    const events = [
      event({ id: '1', kind: 'assignment', at: '2026-09-10T10:00:00.000Z' }),
      event({ id: '2', kind: 'prompt', at: '2026-09-10T09:00:00.000Z' }),
      event({ id: '3', kind: 'skill', at: '2026-09-10T08:00:00.000Z' }),
      event({ id: '4', kind: 'project', at: '2026-09-10T07:00:00.000Z' }),
      event({ id: '5', kind: 'project', at: '2026-09-01T07:00:00.000Z' }),
    ];

    expect(summarizeSince(events, '2026-09-05T00:00:00.000Z')).toEqual({
      assignments: 1,
      resources: 2,
      projects: 1,
    });
  });

  it('sin marca de visita no se inventa un resumen', () => {
    expect(summarizeSince([event({})], null)).toBeNull();
  });

  it('sin nada nuevo tampoco se pinta', () => {
    expect(summarizeSince([event({ at: '2026-09-01T00:00:00.000Z' })], '2026-09-05T00:00:00.000Z'))
      .toBeNull();
  });

  it('dice cuándo pasó en lenguaje humano', () => {
    expect(relativeTime('2026-09-10T17:35:00.000Z', NOW)).toBe('hace 25 min');
    expect(relativeTime('2026-09-10T16:00:00.000Z', NOW)).toBe('hace 2 h');
    expect(relativeTime('2026-09-07T18:00:00.000Z', NOW)).toBe('hace 3 días');
  });
});


describe('audiencia del muro', () => {
  const shared = event({ id: 'publication:shared', courseId: 'a', audienceCourseIds: ['a', 'b'] });
  it('un evento multigrupo aparece una sola vez antes de aplicar el límite', () => {
    const other = event({id: 'other'});
    expect(sortEvents([shared, shared, other], 2)).toHaveLength(2);
  });
  it('permite filtrar cualquiera de los grupos y excluye grupos fuera de audiencia', () => {
    expect(filterEventsByCourse([shared], 'a')).toEqual([shared]);
    expect(filterEventsByCourse([shared], 'b')).toEqual([shared]);
    expect(filterEventsByCourse([shared], 'c')).toEqual([]);
    expect(filterEventsByCourse([shared], '')).toEqual([shared]);
  });
  it('conserva el filtro de recursos anteriores sin audiencia explícita', () => {
    const legacy = event({courseId: 'a'});
    expect(filterEventsByCourse([legacy], 'a')).toEqual([legacy]);
    expect(filterEventsByCourse([legacy], 'b')).toEqual([]);
  });
});
