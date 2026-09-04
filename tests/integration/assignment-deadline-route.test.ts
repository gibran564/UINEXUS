import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { POST as createPromptRoute } from '@/app/api/courses/[courseId]/prompts/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import type { Assignment, PromptTemplate } from '@/lib/types';
import { ACTORS, jsonRequestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedAssignment,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * La fecha límite y el prompt del paso, contra DynamoDB Local.
 *
 * Las dos cosas que se comprueban aquí no se pueden comprobar en el navegador:
 * que el SERVIDOR rechaza una entrega fuera de plazo con su propio reloj, y que
 * una actividad con un prompt escrito a mano —sin nada en la biblioteca— se
 * guarda y se lee entera.
 */

const HOUR = 60 * 60 * 1000;

async function createAssignment(body: Record<string, unknown>): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      'http://localhost/api/courses/course-a/assignments',
      'POST',
      { title: 'Actividad con fecha', type: 'freeform', status: 'published', ...body }
    ),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

async function submit(assignmentId: string, intent: 'draft' | 'submit'): Promise<Response> {
  return saveSubmissionRoute(
    jsonRequestAs(
      ACTORS.studentA,
      `http://localhost/api/assignments/${assignmentId}/submission`,
      'PUT',
      { intent, data: { text: 'Mi respuesta' } }
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('fecha límite con hora, aplicada en el servidor', () => {
  it('acepta la entrega antes del instante', async () => {
    const assignment = await createAssignment({
      dueDate: '2099-01-01',
      dueAt: new Date(Date.now() + HOUR).toISOString(),
    });

    const response = await submit(assignment.id, 'submit');
    expect(response.status).toBe(200);
  });

  it('rechaza la entrega después del instante', async () => {
    const assignment = await createAssignment({
      dueDate: '2020-01-01',
      dueAt: new Date(Date.now() - HOUR).toISOString(),
    });

    const response = await submit(assignment.id, 'submit');
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('fecha límite');
  });

  it('tampoco deja guardar borrador después del instante', async () => {
    const assignment = await createAssignment({
      dueAt: new Date(Date.now() - HOUR).toISOString(),
    });

    // Un borrador es una modificación de la entrega: pasada la hora, tampoco.
    expect((await submit(assignment.id, 'draft')).status).toBe(409);
  });

  it('sin fecha límite se sigue entregando', async () => {
    const assignment = await createAssignment({});
    expect(assignment.dueAt).toBeNull();
    expect((await submit(assignment.id, 'submit')).status).toBe(200);
  });

  it('una tarea con sólo fecha antigua sigue siendo legible y no cierra antes de tiempo', async () => {
    // Es lo que hay guardado hoy: fecha sin hora. Se acepta y se persiste tal
    // cual, sin inventarle un instante.
    const assignment = await createAssignment({ dueDate: '2099-06-01' });

    expect(assignment.dueDate).toBe('2099-06-01');
    expect(assignment.dueAt).toBeNull();
    expect((await submit(assignment.id, 'submit')).status).toBe(200);
  });

  it('guarda el instante normalizado a UTC', async () => {
    const assignment = await createAssignment({
      dueDate: '2099-09-11',
      dueAt: '2099-09-12T05:59:00.000Z',
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.dueAt).toBe('2099-09-12T05:59:00.000Z');
    expect(persisted?.dueDate).toBe('2099-09-11');
  });
});

describe('el prompt de un paso', () => {
  it('se guarda escrito dentro de la actividad, sin pasar por la biblioteca', async () => {
    const text = 'Analiza esta interfaz utilizando las heurísticas de Nielsen.';
    const assignment = await createAssignment({
      type: 'workflow',
      workflow: [
        {
          id: 'analisis',
          title: 'Analizar',
          prompt: { mode: 'inline', text },
          deliverables: [{ type: 'text', required: true }],
        },
      ],
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.workflow[0]?.prompt).toEqual({
      mode: 'inline',
      title: '',
      text,
      resourceId: null,
    });
  });

  it('acepta un prompt de la biblioteca de ESTA materia', async () => {
    const created = await createPromptRoute(
      jsonRequestAs(ACTORS.teacherA, 'http://localhost/api/courses/course-a/prompts', 'POST', {
        title: 'Evaluación heurística',
        prompt: 'Actúa como especialista en UX…',
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    expect(created.status).toBe(201);
    const prompt = (await created.json()).prompt as PromptTemplate;

    const assignment = await createAssignment({
      type: 'workflow',
      workflow: [
        {
          id: 'analisis',
          title: 'Analizar',
          prompt: { mode: 'library', resourceId: prompt.id },
          deliverables: [{ type: 'text', required: true }],
        },
      ],
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.workflow[0]?.prompt.mode).toBe('library');
    expect(persisted?.workflow[0]?.prompt.resourceId).toBe(prompt.id);
    // El título se rellena con el del recurso: la tarea sigue diciendo cuál es
    // aunque el recurso desaparezca después.
    expect(persisted?.workflow[0]?.prompt.title).toBe('Evaluación heurística');
  });

  it('descarta una referencia a un prompt que no es de la materia', async () => {
    const assignment = await createAssignment({
      type: 'workflow',
      workflow: [
        {
          id: 'analisis',
          title: 'Analizar',
          prompt: { mode: 'library', resourceId: 'prompt-de-otra-materia' },
          deliverables: [{ type: 'text', required: true }],
        },
      ],
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.workflow[0]?.prompt.mode).toBe('none');
    expect(persisted?.workflow[0]?.prompt.resourceId).toBeNull();
  });
});
