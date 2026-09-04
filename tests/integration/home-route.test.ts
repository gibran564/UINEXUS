import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as homeRoute, type HomePayload } from '@/app/api/home/route';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { POST as createPromptRoute } from '@/app/api/courses/[courseId]/prompts/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { PATCH as moderatePromptRoute } from '@/app/api/prompts/[promptId]/route';
import type { Assignment, ProjectRecord, PromptTemplate } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  INTEGRATION_TABLES,
  createIntegrationTables,
  deleteIntegrationTables,
  putIntegrationItems,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * El Inicio autenticado, contra DynamoDB Local.
 *
 * Lo que se prueba aquí es lo que NO se puede probar en el navegador: qué deja
 * fuera el servidor. Un muro que se equivoca no enseña una tarjeta de más, sino
 * trabajo de otra persona a quien no le corresponde verlo.
 */

async function home(actor: (typeof ACTORS)[keyof typeof ACTORS]): Promise<HomePayload> {
  const response = await homeRoute(requestAs(actor, 'http://localhost/api/home'));
  expect(response.status).toBe(200);
  return (await response.json()) as HomePayload;
}

async function createAssignment(
  courseId: string,
  teacher: (typeof ACTORS)[keyof typeof ACTORS],
  body: Record<string, unknown>
): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(teacher, `http://localhost/api/courses/${courseId}/assignments`, 'POST', {
      title: 'Actividad',
      type: 'freeform',
      status: 'published',
      ...body,
    }),
    { params: Promise.resolve({ courseId }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

async function createPrompt(
  courseId: string,
  author: (typeof ACTORS)[keyof typeof ACTORS],
  title: string
): Promise<PromptTemplate> {
  const response = await createPromptRoute(
    jsonRequestAs(author, `http://localhost/api/courses/${courseId}/prompts`, 'POST', {
      title,
      prompt: 'Actúa como especialista en UX…',
    }),
    { params: Promise.resolve({ courseId }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).prompt as PromptTemplate;
}

/** Un proyecto en la tabla, con o sin las claves del índice de publicados. */
function projectRow(
  overrides: Partial<ProjectRecord> & { id: string; ownerHandle: string },
  listed: boolean
): Record<string, unknown> {
  const at = '2026-09-05T00:00:00.000Z';
  return {
    id: overrides.id,
    slug: overrides.slug ?? overrides.id,
    title: overrides.title ?? 'Proyecto',
    description: '',
    author: {
      handle: overrides.ownerHandle,
      displayName: overrides.ownerHandle,
      avatarUrl: null,
    },
    courseId: overrides.courseId ?? null,
    courseName: overrides.courseName ?? null,
    term: null,
    group: null,
    tags: [],
    cover: null,
    projectType: 'web',
    status: listed ? 'published' : 'draft',
    brief: {},
    version: 1,
    fileCount: 1,
    totalBytes: 10,
    createdAt: at,
    updatedAt: at,
    publishedAt: listed ? at : null,
    views: 0,
    featured: false,
    ownerId: `uid-${overrides.ownerHandle}`,
    ownerHandle: overrides.ownerHandle,
    entryFile: 'index.html',
    hiddenByAdmin: false,
    reportCount: 0,
    /**
     * El índice `byStatus` es disperso: sin estas dos claves el proyecto
     * simplemente no está en él, que es como se garantiza que un borrador no
     * pueda aparecer en ninguna lista pública.
     */
    ...(listed ? { statusKey: 'published', listedAt: at } : {}),
  };
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('qué le toca al alumnado', () => {
  it('trae la actividad publicada que le corresponde', async () => {
    const assignment = await createAssignment('course-a', ACTORS.teacherA, {
      title: 'Auditoría de accesibilidad',
      dueDate: '2099-09-11',
      dueAt: '2099-09-12T05:59:00.000Z',
    });

    const payload = await home(ACTORS.studentA);
    const item = payload.attention.find((entry) => entry.assignmentId === assignment.id);

    expect(item).toBeDefined();
    expect(item!.title).toBe('Auditoría de accesibilidad');
    expect(item!.dueAt).toBe('2099-09-12T05:59:00.000Z');
    expect(item!.submissionStatus).toBeNull();
  });

  it('una actividad ya entregada deja de pedir atención', async () => {
    const assignment = await createAssignment('course-a', ACTORS.teacherA, {
      title: 'Ya entregada',
    });

    const saved = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        { intent: 'submit', data: { text: 'Listo' } }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(saved.status).toBe(200);

    const payload = await home(ACTORS.studentA);
    expect(payload.attention.map((entry) => entry.assignmentId)).not.toContain(assignment.id);
  });

  it('no ve borradores de su docente', async () => {
    const draft = await createAssignment('course-a', ACTORS.teacherA, {
      title: 'Borrador sin publicar',
      status: 'draft',
    });

    const payload = await home(ACTORS.studentA);
    const body = JSON.stringify(payload);

    expect(payload.attention.map((entry) => entry.assignmentId)).not.toContain(draft.id);
    expect(body).not.toContain('Borrador sin publicar');
  });

  it('no ve nada de una materia en la que no está', async () => {
    await createAssignment('course-b', ACTORS.teacherB, { title: 'Actividad de otra materia' });
    await createPrompt('course-b', ACTORS.teacherB, 'Prompt de otra materia');

    const payload = await home(ACTORS.studentA);
    const body = JSON.stringify(payload);

    expect(payload.courses.map((course) => course.id)).toEqual(['course-a']);
    expect(body).not.toContain('course-b');
    expect(body).not.toContain('otra materia');
  });

  it('no filtra la entrega de otra persona', async () => {
    const assignment = await createAssignment('course-a', ACTORS.teacherA, {
      title: 'Actividad compartida',
    });

    await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentB,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        { intent: 'submit', data: { text: 'Respuesta privada de B' } }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    const payload = await home(ACTORS.studentA);
    const body = JSON.stringify(payload);

    // A sigue teniéndola pendiente y no se entera de nada de lo de B.
    expect(payload.attention.map((entry) => entry.assignmentId)).toContain(assignment.id);
    expect(body).not.toContain('Respuesta privada de B');
    expect(body).not.toContain('uid-student-b');
  });
});

describe('el muro', () => {
  it('separa lo que publica la docente de lo que aporta la clase', async () => {
    await createAssignment('course-a', ACTORS.teacherA, { title: 'Evaluación UX con IA' });
    const teacherPrompt = await createPrompt('course-a', ACTORS.teacherA, 'Heurísticas de Nielsen');

    const payload = await home(ACTORS.studentA);

    expect(payload.teacherUpdates.map((event) => event.title)).toEqual(
      expect.arrayContaining(['Evaluación UX con IA', teacherPrompt.title])
    );
    expect(payload.teacherUpdates.every((event) => event.courseId === 'course-a')).toBe(true);
  });

  it('no publica una aportación que todavía espera aprobación', async () => {
    // El alumnado PROPONE: el recurso nace en `proposed`, no aprobado.
    const proposed = await createPrompt('course-a', ACTORS.studentB, 'Carga cognitiva');
    expect(proposed.status).toBe('proposed');

    const before = await home(ACTORS.studentA);
    expect(JSON.stringify(before)).not.toContain('Carga cognitiva');

    const approved = await moderatePromptRoute(
      jsonRequestAs(ACTORS.teacherA, `http://localhost/api/prompts/${proposed.id}`, 'PATCH', {
        action: 'approve',
      }),
      { params: Promise.resolve({ promptId: proposed.id }) }
    );
    expect(approved.status).toBe(200);

    const after = await home(ACTORS.studentA);
    const event = after.classroomActivity.find((entry) => entry.title === 'Carga cognitiva');

    expect(event).toBeDefined();
    expect(event!.actor?.handle).toBe('student-b');
  });

  it('trae los proyectos publicados de la clase y ninguno más', async () => {
    await putIntegrationItems(INTEGRATION_TABLES.projects, [
      projectRow(
        {
          id: 'p-clase',
          ownerHandle: 'student-b',
          title: 'Mapa de navegación del SIIT',
          courseId: 'course-a',
        },
        true
      ),
      projectRow(
        { id: 'p-borrador', ownerHandle: 'student-b', title: 'Borrador oculto', courseId: 'course-a' },
        false
      ),
      projectRow(
        { id: 'p-ajeno', ownerHandle: 'teacher-b', title: 'Proyecto ajeno', courseId: 'course-b' },
        true
      ),
      projectRow(
        { id: 'p-propio', ownerHandle: 'student-a', title: 'Proyecto propio', courseId: 'course-a' },
        true
      ),
    ]);

    const payload = await home(ACTORS.studentA);
    const titles = payload.classroomActivity.map((event) => event.title);
    const body = JSON.stringify(payload);

    expect(titles).toContain('Mapa de navegación del SIIT');
    expect(body).not.toContain('Borrador oculto');
    expect(body).not.toContain('Proyecto ajeno');
    // Lo propio ya se ve en «Tus proyectos»; el muro es lo que hacen los demás.
    expect(titles).not.toContain('Proyecto propio');
  });
});

describe('el Inicio del profesorado', () => {
  it('cuenta las entregas por revisar de su materia', async () => {
    const assignment = await createAssignment('course-a', ACTORS.teacherA, {
      title: 'Auditoría de accesibilidad',
    });

    for (const student of [ACTORS.studentA, ACTORS.studentB]) {
      await saveSubmissionRoute(
        jsonRequestAs(
          student,
          `http://localhost/api/assignments/${assignment.id}/submission`,
          'PUT',
          { intent: 'submit', data: { text: 'Entregado' } }
        ),
        { params: Promise.resolve({ assignmentId: assignment.id }) }
      );
    }

    const payload = await home(ACTORS.teacherA);
    const review = payload.teacherTasks.find((task) => task.kind === 'review');

    expect(review).toBeDefined();
    expect(review!.count).toBe(2);
    expect(review!.submitted).toBe(2);
    expect(review!.audience).toBe(2);
    // El profesorado no entrega, así que no le toca nada como estudiante.
    expect(payload.attention).toEqual([]);
  });

  it('avisa de las aportaciones que esperan aprobación', async () => {
    await createPrompt('course-a', ACTORS.studentB, 'Carga cognitiva');

    const payload = await home(ACTORS.teacherA);
    const moderation = payload.teacherTasks.find((task) => task.kind === 'moderation');

    expect(moderation?.count).toBe(1);
    expect(moderation?.courseId).toBe('course-a');
  });

  it('sólo ve sus propias materias', async () => {
    await createAssignment('course-b', ACTORS.teacherB, { title: 'Actividad de B' });

    const payload = await home(ACTORS.teacherA);
    expect(payload.courses.map((course) => course.id)).toEqual(['course-a']);
    expect(JSON.stringify(payload)).not.toContain('Actividad de B');
  });
});
