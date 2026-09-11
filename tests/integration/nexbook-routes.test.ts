import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/nexbooks/route';
import {
  DELETE as deleteRoute,
  GET as readRoute,
  PATCH as patchRoute,
} from '@/app/api/nexbooks/[nexbookId]/route';
import { GET as stepNexBookRoute } from '@/app/api/assignments/[assignmentId]/steps/[stepId]/nexbook/route';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { GET as readSubmissionsRoute } from '@/app/api/assignments/[assignmentId]/submissions/route';
import { GET as listWorkspacesRoute } from '@/app/api/workspaces/route';
import { submissionIdFor } from '@/lib/data/academic';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedSubmission,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';
import type {
  Assignment,
  NexBook,
  NexBookSubmissionData,
  WorkspaceSummary,
} from '@/lib/types';

/**
 * NexBooks contra DynamoDB Local.
 *
 * Cuatro garantías se comprueban aquí, y las cuatro son promesas del producto:
 * que un documento es de quien lo escribió, que dos pestañas no se pisan en
 * silencio, que la copia de cada estudiante es SUYA, y que una entrega no cambia
 * cuando el documento sigue.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const params = (nexbookId: string) => ({ params: Promise.resolve({ nexbookId }) });

async function create(actor: Actor, body: Record<string, unknown>): Promise<NexBook> {
  const response = await createRoute(
    jsonRequestAs(actor, 'http://localhost/api/nexbooks', 'POST', body)
  );
  expect(response.status).toBe(201);
  return (await response.json()).nexbook as NexBook;
}

const read = (actor: Actor, id: string) =>
  readRoute(requestAs(actor, `http://localhost/api/nexbooks/${id}`), params(id));

const patch = (actor: Actor, id: string, body: Record<string, unknown>) =>
  patchRoute(jsonRequestAs(actor, `http://localhost/api/nexbooks/${id}`, 'PATCH', body), params(id));

const remove = (actor: Actor, id: string) =>
  deleteRoute(
    requestAs(actor, `http://localhost/api/nexbooks/${id}`, { method: 'DELETE' }),
    params(id)
  );

const stepNexBook = (actor: Actor, assignmentId: string, stepId: string) =>
  stepNexBookRoute(
    requestAs(actor, `http://localhost/api/assignments/${assignmentId}/steps/${stepId}/nexbook`),
    { params: Promise.resolve({ assignmentId, stepId }) }
  );

const doc = (source: string) => ({
  blocks: [{ id: 'b1', type: 'code', language: 'python', source }],
});

async function createNexBookAssignment(): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(ACTORS.teacherA, 'http://localhost/api/courses/course-a/assignments', 'POST', {
      title: 'Laboratorio de simplex',
      type: 'workflow',
      status: 'published',
      workflow: [
        {
          id: 'lab',
          title: 'Resuelve el modelo',
          actionType: 'code',
          deliverables: [{ type: 'nexbook', required: true }],
        },
      ],
    }),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('un NexBook personal', () => {
  it('se crea privado y con revisión 1', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Método simplex' });

    expect(nexbook).toMatchObject({
      title: 'Método simplex',
      visibility: 'private',
      context: { type: 'personal' },
      revision: 1,
    });
    expect(JSON.stringify(nexbook)).not.toContain(ACTORS.studentA.uid);
  });

  it('el cuerpo no puede pedir ser público ni de otra persona', async () => {
    const nexbook = await create(ACTORS.studentA, {
      title: 'Intento',
      visibility: 'public',
      ownerUid: ACTORS.studentB.uid,
      context: { type: 'workflow', assignmentId: 'x', stepId: 'y', role: 'template' },
    });

    expect(nexbook.visibility).toBe('private');
    expect(nexbook.context).toEqual({ type: 'personal' });
    expect((await read(ACTORS.studentB, nexbook.id)).status).toBe(404);
  });

  it('aparece en la lista de prácticas junto a los archivos sueltos', async () => {
    await create(ACTORS.studentA, { title: 'Mi NexBook' });

    const response = await listWorkspacesRoute(requestAs(ACTORS.studentA, 'http://localhost/api/workspaces'));
    const { workspaces } = (await response.json()) as { workspaces: WorkspaceSummary[] };

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ kind: 'nexbook', title: 'Mi NexBook', blockCount: 0 });
  });

  it('conocer el id no sirve para leerlo, escribirlo ni borrarlo', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Privado' });

    for (const actor of [ACTORS.studentB, ACTORS.teacherA, ACTORS.outsiderStudent]) {
      expect((await read(actor, nexbook.id)).status, actor.token).toBe(404);
    }
    expect((await patch(ACTORS.studentB, nexbook.id, { revision: 1, title: 'Robado' })).status).toBe(404);
    expect((await remove(ACTORS.teacherA, nexbook.id)).status).toBe(404);
  });

  it('«no existe» y «no es tuyo» se responden igual', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Privado' });

    const ajeno = await read(ACTORS.studentB, nexbook.id);
    const inexistente = await read(ACTORS.studentB, 'nb-que-no-existe');

    expect(ajeno.status).toBe(inexistente.status);
    await expect(ajeno.json()).resolves.toEqual(await inexistente.json());
  });
});

describe('guardar con concurrencia optimista', () => {
  it('la revisión avanza en cada guardado', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Doc' });

    const first = await patch(ACTORS.studentA, nexbook.id, {
      revision: nexbook.revision,
      document: doc('x = 1'),
    });
    expect(first.status).toBe(200);
    const afterFirst = (await first.json()).nexbook as NexBook;
    expect(afterFirst.revision).toBe(nexbook.revision + 1);

    const second = await patch(ACTORS.studentA, nexbook.id, {
      revision: afterFirst.revision,
      document: doc('x = 2'),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()).nexbook as NexBook).revision).toBe(afterFirst.revision + 1);
  });

  it('una segunda pestaña con revisión vieja recibe 409 y NO sobrescribe', async () => {
    /**
     * Es el caso real: el documento abierto en el portátil y en el equipo del
     * laboratorio. Sin la revisión, la segunda pestaña borraría media hora de la
     * primera y nadie sabría por qué.
     */
    const nexbook = await create(ACTORS.studentA, { title: 'Doc' });
    const stale = nexbook.revision;

    await patch(ACTORS.studentA, nexbook.id, { revision: stale, document: doc('bueno') });

    const conflicted = await patch(ACTORS.studentA, nexbook.id, {
      revision: stale,
      document: doc('pisado'),
    });

    expect(conflicted.status).toBe(409);
    const body = await conflicted.json();
    // El 409 trae el documento que ganó, para que la interfaz pueda decir qué
    // pasó en vez de un «error» a secas.
    const current = body.nexbook as NexBook;
    const block = current.document.blocks[0];
    expect(block?.type === 'code' ? block.source : '').toBe('bueno');

    // Y lo guardado sigue siendo lo bueno.
    const reread = (await (await read(ACTORS.studentA, nexbook.id)).json()).nexbook as NexBook;
    const stored = reread.document.blocks[0];
    expect(stored?.type === 'code' ? stored.source : '').toBe('bueno');
  });

  it('rechaza un documento por encima del presupuesto', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Grande' });

    const response = await patch(ACTORS.studentA, nexbook.id, {
      revision: nexbook.revision,
      document: {
        blocks: Array.from({ length: 20 }, (_unused, index) => ({
          id: `b${index}`,
          type: 'markdown',
          source: 'x'.repeat(30_000),
        })),
      },
    });

    expect(response.status).toBe(422);
  });

  it('`createdAt` no se puede reescribir desde el cliente', async () => {
    const nexbook = await create(ACTORS.studentA, { title: 'Fechas' });

    await patch(ACTORS.studentA, nexbook.id, {
      revision: nexbook.revision,
      title: 'Otro',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    const reread = (await (await read(ACTORS.studentA, nexbook.id)).json()).nexbook as NexBook;
    expect(reread.createdAt).toBe(nexbook.createdAt);
  });
});

describe('plantilla docente e instancia de estudiante', () => {
  it('la docente obtiene la PLANTILLA y el alumnado su propia copia', async () => {
    const assignment = await createNexBookAssignment();

    const teacher = await stepNexBook(ACTORS.teacherA, assignment.id, 'lab');
    expect(teacher.status).toBe(200);
    const teacherBody = await teacher.json();
    expect(teacherBody.role).toBe('template');

    const student = await stepNexBook(ACTORS.studentA, assignment.id, 'lab');
    expect(student.status).toBe(200);
    const studentBody = await student.json();
    expect(studentBody.role).toBe('instance');

    // Misma URL, documentos distintos: escribir en la copia no toca la plantilla.
    expect((studentBody.nexbook as NexBook).id).not.toBe((teacherBody.nexbook as NexBook).id);
  });

  it('la copia se crea la PRIMERA vez y no se vuelve a pisar', async () => {
    /**
     * Instanciación perezosa: publicar para trescientas personas no puede costar
     * trescientas escrituras de un documento que quizá nadie abra. Y volver a
     * copiar la plantilla en cada visita borraría el trabajo.
     */
    const assignment = await createNexBookAssignment();
    await stepNexBook(ACTORS.teacherA, assignment.id, 'lab');

    const first = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    await patch(ACTORS.studentA, first.id, {
      revision: first.revision,
      document: doc('mi trabajo'),
    });

    const reopened = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    expect(reopened.id).toBe(first.id);
    const block = reopened.document.blocks[0];
    expect(block?.type === 'code' ? block.source : '').toBe('mi trabajo');
  });

  it('la copia hereda los bloques de la plantilla, no sus resultados', async () => {
    const assignment = await createNexBookAssignment();

    const template = (await (await stepNexBook(ACTORS.teacherA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    await patch(ACTORS.teacherA, template.id, {
      revision: template.revision,
      document: {
        blocks: [
          { id: 'instrucciones', type: 'markdown', source: '# Haz esto', editableByStudent: false },
          { id: 'trabajo', type: 'code', language: 'python', source: '# escribe aquí' },
        ],
        results: {
          trabajo: {
            blockId: 'trabajo',
            status: 'ok',
            outputs: [{ seq: 0, stream: 'stdout', text: 'salida de la docente\n' }],
            durationMs: 5,
            ranAt: '2026-09-10T10:00:00.000Z',
          },
        },
      },
    });

    const instance = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    expect(instance.document.blocks.map((block) => block.id)).toEqual(['instrucciones', 'trabajo']);
    // Una salida de la docente en la copia de alguien haría parecer ejecutado un
    // código que esa persona no ha ejecutado.
    expect(instance.document.results).toEqual({});
    // Y el bloque bloqueado sigue bloqueado.
    const locked = instance.document.blocks[0];
    expect(locked?.type === 'markdown' && locked.editableByStudent).toBe(false);
  });

  it('cada estudiante trabaja en su propia copia, aislada de la de al lado', async () => {
    const assignment = await createNexBookAssignment();

    const a = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;
    const b = (await (await stepNexBook(ACTORS.studentB, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    expect(a.id).not.toBe(b.id);

    await patch(ACTORS.studentA, a.id, { revision: a.revision, document: doc('de A') });
    await patch(ACTORS.studentB, b.id, { revision: b.revision, document: doc('de B') });

    const rereadA = (await (await read(ACTORS.studentA, a.id)).json()).nexbook as NexBook;
    const rereadB = (await (await read(ACTORS.studentB, b.id)).json()).nexbook as NexBook;
    const blockA = rereadA.document.blocks[0];
    const blockB = rereadB.document.blocks[0];

    expect(blockA?.type === 'code' ? blockA.source : '').toBe('de A');
    expect(blockB?.type === 'code' ? blockB.source : '').toBe('de B');

    // Y no se pueden leer entre ellos, aunque estén en la misma materia.
    expect((await read(ACTORS.studentB, a.id)).status).toBe(404);
  });

  it('alguien ajeno a la materia no obtiene ninguna copia', async () => {
    const assignment = await createNexBookAssignment();
    const response = await stepNexBook(ACTORS.outsiderStudent, assignment.id, 'lab');

    expect(response.status).toBe(404);
  });

  it('un paso que no pide NexBook no lo inventa', async () => {
    const response = await createAssignmentRoute(
      jsonRequestAs(ACTORS.teacherA, 'http://localhost/api/courses/course-a/assignments', 'POST', {
        title: 'Sólo texto',
        type: 'workflow',
        status: 'published',
        workflow: [{ id: 'texto', title: 'Escribe', deliverables: [{ type: 'text' }] }],
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    const assignment = (await response.json()).assignment as Assignment;

    expect((await stepNexBook(ACTORS.studentA, assignment.id, 'texto')).status).toBe(422);
  });
});

describe('la entrega es una instantánea inmutable', () => {
  it('entregar congela el documento, y seguir editándolo no la cambia', async () => {
    const assignment = await createNexBookAssignment();
    const instance = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    await patch(ACTORS.studentA, instance.id, {
      revision: instance.revision,
      document: doc('version entregada'),
    });
    const saved = (await (await read(ACTORS.studentA, instance.id)).json()).nexbook as NexBook;

    const submitted = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [
            {
              stepId: 'lab',
              data: {
                nexbookId: saved.id,
                revision: saved.revision,
                title: saved.title,
                snapshot: saved.document,
                submittedAt: new Date().toISOString(),
              },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(submitted.status).toBe(200);

    // Se sigue trabajando DESPUÉS de entregar.
    await patch(ACTORS.studentA, saved.id, {
      revision: saved.revision,
      document: doc('cambiado despues de entregar'),
    });

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );
    const evidence = persisted?.stepEvidence.lab?.data as NexBookSubmissionData;
    const block = evidence.snapshot.blocks[0];

    expect(block?.type === 'code' ? block.source : '').toBe('version entregada');
    expect(evidence.revision).toBe(saved.revision);
  });

  it('la docente lee exactamente lo que se entregó, sin abrir el documento vivo', async () => {
    const assignment = await createNexBookAssignment();
    const instance = (await (await stepNexBook(ACTORS.studentA, assignment.id, 'lab')).json())
      .nexbook as NexBook;

    await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [
            {
              stepId: 'lab',
              data: {
                nexbookId: instance.id,
                revision: instance.revision,
                title: instance.title,
                snapshot: doc('lo que entregué'),
                submittedAt: new Date().toISOString(),
              },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    const response = await readSubmissionsRoute(
      requestAs(ACTORS.teacherA, `http://localhost/api/assignments/${assignment.id}/submissions`),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const evidence = body.submissions[0].stepEvidence.lab.data as NexBookSubmissionData;
    const block = evidence.snapshot.blocks[0];

    expect(block?.type === 'code' ? block.source : '').toBe('lo que entregué');
    // La docente NO necesita —ni puede— leer el documento vivo del estudiante.
    expect((await read(ACTORS.teacherA, instance.id)).status).toBe(404);
  });

  it('una entrega sin instantánea se rechaza', async () => {
    const assignment = await createNexBookAssignment();

    const response = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        { intent: 'draft', steps: [{ stepId: 'lab', data: { nexbookId: 'nb-1', revision: 1 } }] }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(422);
  });
});
