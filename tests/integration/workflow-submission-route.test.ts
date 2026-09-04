import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { submissionIdFor } from '@/lib/data/academic';
import type { Assignment } from '@/lib/types';
import { ACTORS, jsonRequestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedSubmission,
  listPersistedSubmissions,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

function workflowInput() {
  return {
    title: 'Proceso con IA',
    type: 'workflow',
    status: 'published',
    workflow: [
      {
        id: 'research',
        title: 'Investigar',
        required: true,
        deliverables: [{ type: 'text', required: true }],
      },
      {
        id: 'synthesis',
        title: 'Sintetizar con IA',
        required: true,
        dependsOnStepIds: ['research'],
        deliverables: [{ type: 'ai_worklog', required: true }],
      },
      {
        id: 'only-a',
        title: 'Aporte exclusivo de A',
        required: false,
        assignedHandles: ['student-a'],
        deliverables: [{ type: 'text', required: false }],
      },
    ],
  };
}

async function createWorkflow(): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      'http://localhost/api/courses/course-a/assignments',
      'POST',
      workflowInput()
    ),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

async function save(
  assignmentId: string,
  actor: (typeof ACTORS)[keyof typeof ACTORS],
  body: unknown
): Promise<Response> {
  return saveSubmissionRoute(
    jsonRequestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/submission`,
      'PUT',
      body
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('ruta de submission de workflow con DynamoDB Local', () => {
  it('guarda evidencia válida y descarta un stepId que no pertenece a la tarea', async () => {
    const assignment = await createWorkflow();
    const response = await save(assignment.id, ACTORS.studentB, {
      intent: 'draft',
      steps: [
        { stepId: 'research', data: { text: 'Tres fuentes verificadas.', links: [] } },
        { stepId: 'only-a', data: { text: 'No le corresponde a B.', links: [] } },
        { stepId: 'foreign-step', data: { text: 'No debe persistir.', links: [] } },
      ],
    });

    expect(response.status).toBe(200);
    const id = submissionIdFor(assignment.id, ACTORS.studentB.uid);
    const persisted = await getPersistedSubmission(id);
    expect(persisted?.studentId).toBe(ACTORS.studentB.uid);
    expect(persisted?.status).toBe('draft');
    expect(persisted?.stepEvidence.research?.data).toEqual({
      text: 'Tres fuentes verificadas.',
      links: [],
    });
    expect(persisted?.stepEvidence['only-a']).toBeUndefined();
    expect(persisted?.stepEvidence['foreign-step']).toBeUndefined();
  });

  it('formaliza dependencias: permite borrador posterior, pero bloquea submit si falta el requerido previo', async () => {
    const assignment = await createWorkflow();
    const draft = await save(assignment.id, ACTORS.studentA, {
      intent: 'draft',
      steps: [
        {
          stepId: 'synthesis',
          data: {
            provider: 'Claude',
            result: { content: '# Borrador\n\n- idea' },
          },
        },
      ],
    });
    expect(draft.status).toBe(200);

    const submit = await save(assignment.id, ACTORS.studentA, { intent: 'submit', steps: [] });
    expect(submit.status).toBe(409);
    await expect(submit.json()).resolves.toEqual({ error: 'Todavía te falta: Investigar.' });

    const id = submissionIdFor(assignment.id, ACTORS.studentA.uid);
    const persisted = await getPersistedSubmission(id);
    expect(persisted?.status).toBe('draft');
    expect(persisted?.stepEvidence.synthesis).toBeDefined();
    expect(persisted?.stepEvidence.research).toBeUndefined();
  });

  it('persiste y devuelve el Markdown de AI Worklog exactamente, con formato detectado', async () => {
    const assignment = await createWorkflow();
    const markdown = [
      '# Hallazgos',
      '',
      '| Hallazgo | Prioridad |',
      '|---|---|',
      '| Navegación | Alta |',
      '',
      '```typescript',
      'const preserved = true;',
      '```',
    ].join('\n');
    const response = await save(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [
        { stepId: 'research', data: { text: 'Fuentes listas.', links: [] } },
        {
          stepId: 'synthesis',
          toolName: 'Claude',
          data: {
            provider: 'Claude',
            model: 'Sonnet',
            objective: 'Sintetizar hallazgos',
            result: { content: markdown },
          },
        },
      ],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submission.status).toBe('submitted');
    expect(body.submission.stepEvidence.synthesis.data.result).toEqual({
      content: markdown,
      format: 'markdown',
    });

    const id = submissionIdFor(assignment.id, ACTORS.studentA.uid);
    const persisted = await getPersistedSubmission(id);
    expect(persisted?.stepEvidence.synthesis?.data).toMatchObject({
      result: { content: markdown, format: 'markdown' },
    });
    await expect(listPersistedSubmissions(assignment.id)).resolves.toHaveLength(1);
  });

  it('impide al docente entregar su tarea y no crea registros', async () => {
    const assignment = await createWorkflow();
    const response = await save(assignment.id, ACTORS.teacherA, {
      intent: 'draft',
      steps: [],
    });
    expect(response.status).toBe(403);
    await expect(listPersistedSubmissions(assignment.id)).resolves.toEqual([]);
  });

  it('oculta la tarea a un estudiante ajeno y no crea registros', async () => {
    const assignment = await createWorkflow();
    const response = await save(assignment.id, ACTORS.outsiderStudent, {
      intent: 'draft',
      steps: [{ stepId: 'research', data: { text: 'Intrusión', links: [] } }],
    });
    expect(response.status).toBe(404);
    await expect(listPersistedSubmissions(assignment.id)).resolves.toEqual([]);
  });
});
