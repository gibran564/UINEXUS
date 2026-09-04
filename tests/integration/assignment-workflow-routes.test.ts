import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { PATCH as updateAssignmentRoute } from '@/app/api/assignments/[assignmentId]/route';
import type { Assignment } from '@/lib/types';
import { ACTORS, jsonRequestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedAssignment,
  listPersistedAssignments,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

const courseUrl = 'http://localhost/api/courses/course-a/assignments';

function step(id: string, dependsOnStepIds: string[] = []) {
  return { id, title: `Paso ${id}`, dependsOnStepIds };
}

function validInput(title = 'Workflow lineal') {
  return {
    title,
    type: 'workflow',
    status: 'published',
    assignedHandles: ['student-a'],
    workflow: [
      {
        id: 'A',
        order: 9,
        title: 'Buscar',
        required: true,
        dependsOnStepIds: [],
        tool: { mode: 'required', toolIds: [], toolNames: ['Perplexity'] },
        deliverables: [{ type: 'text', required: true, hint: 'Fuentes', questions: [] }],
      },
      {
        id: 'B',
        order: 2,
        title: 'Sintetizar',
        required: false,
        assignedHandles: ['student-a'],
        dependsOnStepIds: ['A'],
      },
      { id: 'C', order: 1, title: 'Presentar', required: true, dependsOnStepIds: ['B'] },
    ],
  };
}

async function createAsTeacher(input = validInput()): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(ACTORS.teacherA, courseUrl, 'POST', input),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('rutas de assignments con DynamoDB Local', () => {
  it('rechaza un ciclo directo sin persistir', async () => {
    const response = await createAssignmentRoute(
      jsonRequestAs(ACTORS.teacherA, courseUrl, 'POST', {
        title: 'Workflow cíclico',
        type: 'workflow',
        workflow: [step('A', ['B']), step('B', ['A'])],
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'El workflow contiene dependencias cíclicas.',
    });
    await expect(listPersistedAssignments('course-a')).resolves.toEqual([]);
  });

  it('rechaza un ciclo indirecto sin persistir', async () => {
    const response = await createAssignmentRoute(
      jsonRequestAs(ACTORS.teacherA, courseUrl, 'POST', {
        title: 'Workflow cíclico indirecto',
        type: 'workflow',
        workflow: [step('A', ['C']), step('B', ['A']), step('C', ['B'])],
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );

    expect(response.status).toBe(422);
    await expect(listPersistedAssignments('course-a')).resolves.toEqual([]);
  });

  it('crea un workflow acíclico y persiste orden, dependencias y responsables reales', async () => {
    const assignment = await createAsTeacher();
    const persisted = await getPersistedAssignment(assignment.id);

    expect(JSON.stringify(assignment)).not.toContain(ACTORS.studentA.uid);
    expect(assignment.assignedTo).toEqual(['student-a']);
    expect(assignment.workflow[1]?.assignedTo).toEqual(['student-a']);
    expect(persisted).toMatchObject({
      id: assignment.id,
      courseId: 'course-a',
      createdBy: ACTORS.teacherA.uid,
      assignedTo: [ACTORS.studentA.uid],
      workflow: [
        {
          id: 'A',
          order: 0,
          dependsOnStepIds: [],
          required: true,
          tool: { mode: 'required', toolIds: [], toolNames: ['Perplexity'] },
        },
        {
          id: 'B',
          order: 1,
          dependsOnStepIds: ['A'],
          required: false,
          assignedTo: [ACTORS.studentA.uid],
        },
        { id: 'C', order: 2, dependsOnStepIds: ['B'], required: true },
      ],
    });
    await expect(listPersistedAssignments('course-a')).resolves.toHaveLength(1);
  });

  it('aplica rol y pertenencia reales al crear', async () => {
    for (const actor of [ACTORS.studentA, ACTORS.teacherB, ACTORS.outsiderStudent]) {
      const response = await createAssignmentRoute(
        jsonRequestAs(actor, courseUrl, 'POST', validInput()),
        { params: Promise.resolve({ courseId: 'course-a' }) }
      );
      expect(response.status).toBe(404);
    }
    await expect(listPersistedAssignments('course-a')).resolves.toEqual([]);
  });

  it('rechaza una petición sin identidad antes de leer el workflow', async () => {
    const response = await createAssignmentRoute(
      new Request(courseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validInput()),
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    expect(response.status).toBe(401);
    await expect(listPersistedAssignments('course-a')).resolves.toEqual([]);
  });

  it('rechaza un bearer token inválido sin consultar permisos ni escribir', async () => {
    const response = await createAssignmentRoute(
      new Request(courseUrl, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-desconocido',
          'content-type': 'application/json',
        },
        body: JSON.stringify(validInput()),
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    expect(response.status).toBe(401);
    await expect(listPersistedAssignments('course-a')).resolves.toEqual([]);
  });

  it('rechaza un ciclo al editar y deja el registro completo intacto', async () => {
    const assignment = await createAsTeacher();
    const before = await getPersistedAssignment(assignment.id);
    const response = await updateAssignmentRoute(
      jsonRequestAs(ACTORS.teacherA, `http://localhost/api/assignments/${assignment.id}`, 'PATCH', {
        title: 'Edición cíclica',
        type: 'workflow',
        workflow: [step('A', ['B']), step('B', ['A'])],
      }),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(422);
    expect(await getPersistedAssignment(assignment.id)).toEqual(before);
  });

  it('permite al docente de la materia editar un workflow válido', async () => {
    const assignment = await createAsTeacher();
    const response = await updateAssignmentRoute(
      jsonRequestAs(
        ACTORS.teacherA,
        `http://localhost/api/assignments/${assignment.id}`,
        'PATCH',
        validInput('Workflow actualizado')
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).assignment.title).toBe('Workflow actualizado');
    expect((await getPersistedAssignment(assignment.id))?.title).toBe('Workflow actualizado');
  });

  it('impide editar al estudiante y al docente de otra materia', async () => {
    const assignment = await createAsTeacher();
    const before = await getPersistedAssignment(assignment.id);

    for (const actor of [ACTORS.studentA, ACTORS.teacherB]) {
      const response = await updateAssignmentRoute(
        jsonRequestAs(
          actor,
          `http://localhost/api/assignments/${assignment.id}`,
          'PATCH',
          validInput('Cambio no autorizado')
        ),
        { params: Promise.resolve({ assignmentId: assignment.id }) }
      );
      expect(response.status).toBe(404);
    }
    expect(await getPersistedAssignment(assignment.id)).toEqual(before);
  });
});
