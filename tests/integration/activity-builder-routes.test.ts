import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import {
  GET as readAssignmentRoute,
  PATCH as updateAssignmentRoute,
} from '@/app/api/assignments/[assignmentId]/route';
import { GET as stepNexBookRoute } from '@/app/api/assignments/[assignmentId]/steps/[stepId]/nexbook/route';
import { PATCH as patchNexBookRoute } from '@/app/api/nexbooks/[nexbookId]/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import {
  deriveActivity,
  makePart,
  partsFromAssignment,
  type ActivityActionId,
} from '@/lib/activity-builder';
import type { Assignment, NexBook, WorkflowStep } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedAssignment,
  putIntegrationItems,
  resetAndSeedIntegrationData,
  INTEGRATION_TABLES,
} from './helpers/dynamodb';

/**
 * El constructor docente rediseñado, contra DynamoDB Local.
 *
 * Lo que se comprueba aquí NO es la pantalla: es que la traducción que hace
 * `lib/activity-builder` produce cuerpos que las rutas de siempre aceptan, que
 * lo guardado se vuelve a leer igual, y que una actividad creada con la pantalla
 * ANTERIOR sigue abriendo y guardándose sin perder nada.
 *
 * Es la prueba de la promesa de la fase: cambia la interfaz, no el motor.
 */

const courseUrl = 'http://localhost/api/courses/course-a/assignments';

let counter = 0;
const nextId = (): string => `p${++counter}`;

function part(action: ActivityActionId, variant?: string, title = ''): WorkflowStep {
  return { ...makePart({ action, variant, id: nextId(), order: 0 }), title };
}

/** Lo que el editor manda: lo básico más lo que derive el traductor. */
function activityBody(
  parts: WorkflowStep[],
  overrides: Record<string, unknown> = {},
  wasWorkflow = false
) {
  const derived = deriveActivity({ parts, wasWorkflow, researchQuestions: [] });
  return {
    title: 'Análisis de ventas',
    description: '',
    instructions: '',
    type: derived.type,
    researchQuestions: derived.researchQuestions,
    status: 'published',
    workflow: derived.workflow.map((item) => ({ ...item, assignedHandles: item.assignedTo })),
    ...overrides,
  };
}

async function create(body: unknown, actor = ACTORS.teacherA): Promise<Response> {
  return createAssignmentRoute(jsonRequestAs(actor, courseUrl, 'POST', body), {
    params: Promise.resolve({ courseId: 'course-a' }),
  });
}

async function createOk(body: unknown): Promise<Assignment> {
  const response = await create(body);
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

async function patch(
  assignmentId: string,
  body: unknown,
  actor: (typeof ACTORS)[keyof typeof ACTORS] = ACTORS.teacherA
): Promise<Response> {
  return updateAssignmentRoute(
    jsonRequestAs(actor, `http://localhost/api/assignments/${assignmentId}`, 'PATCH', body),
    { params: Promise.resolve({ assignmentId }) }
  );
}

async function read(
  assignmentId: string,
  actor: (typeof ACTORS)[keyof typeof ACTORS] = ACTORS.teacherA
): Promise<Assignment> {
  const response = await readAssignmentRoute(
    requestAs(actor, `http://localhost/api/assignments/${assignmentId}`),
    { params: Promise.resolve({ assignmentId }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()).assignment as Assignment;
}

async function stepNexBook(
  assignmentId: string,
  stepId: string,
  actor: (typeof ACTORS)[keyof typeof ACTORS]
): Promise<{ status: number; nexbook?: NexBook; role?: string }> {
  const response = await stepNexBookRoute(
    requestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/steps/${stepId}/nexbook`
    ),
    { params: Promise.resolve({ assignmentId, stepId }) }
  );
  if (response.status !== 200) return { status: response.status };
  const body = await response.json();
  return { status: 200, nexbook: body.nexbook as NexBook, role: body.role as string };
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('actividad de una sola Parte', () => {
  it('se guarda en su forma sencilla de siempre y se relee igual', async () => {
    const created = await createOk(activityBody([part('respond', 'text')]));

    // El servidor la guarda como lo que era antes de que existieran las partes.
    expect(created.type).toBe('freeform');
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.workflow).toEqual([]);

    // Y al leerla vuelve con su paso sintetizado, como siempre.
    const reopened = await read(created.id);
    expect(reopened.workflow).toHaveLength(1);
    expect(reopened.workflow[0]!.deliverables[0]!.type).toBe('text');
  });

  it('editar el título no la convierte en un proceso', async () => {
    const created = await createOk(activityBody([part('respond', 'text')]));
    const reopened = await read(created.id);

    // El editor reabre la actividad exactamente como lo haría la pantalla.
    const parts = partsFromAssignment(reopened, nextId);
    const response = await patch(
      created.id,
      activityBody(parts, { title: 'Análisis de ventas (rev. 2)' })
    );

    expect(response.status).toBe(200);
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.type).toBe('freeform');
    expect(persisted?.workflow).toEqual([]);
    expect(persisted?.title).toBe('Análisis de ventas (rev. 2)');
  });

  it('un laboratorio no cabe en la forma antigua y se guarda como proceso de una parte', async () => {
    const created = await createOk(activityBody([part('lab', undefined, 'Laboratorio')]));

    expect(created.type).toBe('workflow');
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.workflow).toHaveLength(1);
    expect(persisted?.workflow[0]!.deliverables[0]!.type).toBe('nexbook');
  });

  /**
   * El estudiante tiene que poder ENTREGARLA.
   *
   * Una actividad por partes con una sola parte se lee con `type: 'workflow'`, y
   * ése es el dato del que depende la pantalla del estudiante para elegir el
   * recorrido por partes. Si se leyera «como antigua» —o si la pantalla contara
   * pasos en vez de mirar el tipo—, una actividad de una parte que pide un
   * laboratorio o código se quedaría sin formulario que rellenar.
   */
  it.each(['lab', 'code', 'instruction', 'evidence'] as const)(
    'una actividad de una parte «%s» se lee como actividad por partes',
    async (action) => {
      const created = await createOk(
        activityBody([part(action, action === 'evidence' ? 'file' : undefined, 'Única parte')], {
          assignedHandles: ['student-a'],
        })
      );

      const asStudent = await read(created.id, ACTORS.studentA);
      expect(asStudent.type).toBe('workflow');
      expect(asStudent.workflow).toHaveLength(1);
      expect(asStudent.workflow[0]!.title).toBe('Única parte');
    }
  );

  it('una actividad de una parte con entregable antiguo SÍ se lee como antigua', async () => {
    const created = await createOk(
      activityBody([part('respond', 'text')], { assignedHandles: ['student-a'] })
    );

    const asStudent = await read(created.id, ACTORS.studentA);
    expect(asStudent.type).toBe('freeform');
    // La lectura sintetiza su paso, como siempre.
    expect(asStudent.workflow).toHaveLength(1);
    expect(asStudent.workflow[0]!.id).toBe('main');
  });
});

describe('actividad de varias Partes', () => {
  const threeParts = (): WorkflowStep[] => {
    const first = part('respond', 'text', 'Lee el material');
    const second = { ...part('code', undefined, 'Resuelve el modelo'), dependsOnStepIds: [first.id] };
    const third = { ...part('instruction', undefined, 'Cierra el proceso'), required: false };
    return [first, second, third];
  };

  it('se guarda como proceso conservando orden, dependencias y opcionalidad', async () => {
    const parts = threeParts();
    const created = await createOk(activityBody(parts));

    expect(created.type).toBe('workflow');
    expect(created.workflow).toHaveLength(3);
    expect(created.workflow.map((step) => step.title)).toEqual([
      'Lee el material',
      'Resuelve el modelo',
      'Cierra el proceso',
    ]);
    expect(created.workflow[1]!.dependsOnStepIds).toEqual([parts[0]!.id]);
    expect(created.workflow[2]!.required).toBe(false);
    expect(created.workflow[1]!.deliverables[0]!.type).toBe('code');
    expect(created.workflow[2]!.deliverables[0]!.type).toBe('none');
  });

  it('reabrir, reordenar y guardar conserva los ids de las partes', async () => {
    const created = await createOk(activityBody(threeParts()));
    const reopened = await read(created.id);
    const ids = reopened.workflow.map((step) => step.id);

    // Se mueve la tercera al principio, como haría «Mover arriba» dos veces.
    const reordered = [reopened.workflow[2]!, reopened.workflow[0]!, reopened.workflow[1]!];
    const response = await patch(created.id, activityBody(reordered, {}, true));
    expect(response.status).toBe(200);

    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.workflow.map((step) => step.id)).toEqual([ids[2], ids[0], ids[1]]);
    // Los ids son los mismos: la evidencia ya entregada se sigue encontrando.
    expect(new Set(persisted?.workflow.map((step) => step.id))).toEqual(new Set(ids));
  });

  it('un proceso no se degrada aunque se quede con una sola parte', async () => {
    const created = await createOk(activityBody(threeParts()));
    const reopened = await read(created.id);

    const response = await patch(
      created.id,
      activityBody([{ ...reopened.workflow[0]!, dependsOnStepIds: [] }], {}, true)
    );
    expect(response.status).toBe(200);

    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.type).toBe('workflow');
    expect(persisted?.workflow).toHaveLength(1);
  });
});

describe('NexLab preparado desde el constructor', () => {
  async function labActivity(): Promise<{ assignment: Assignment; stepId: string }> {
    const created = await createOk(
      activityBody([part('lab', undefined, 'Laboratorio')], { status: 'draft' })
    );
    return { assignment: created, stepId: created.workflow[0]!.id };
  }

  it('la docente abre la plantilla desde un BORRADOR, sin publicar nada', async () => {
    const { assignment, stepId } = await labActivity();
    expect(assignment.status).toBe('draft');

    const opened = await stepNexBook(assignment.id, stepId, ACTORS.teacherA);
    expect(opened.status).toBe(200);
    expect(opened.role).toBe('template');
    expect(opened.nexbook!.context).toMatchObject({
      type: 'workflow',
      assignmentId: assignment.id,
      stepId,
      role: 'template',
    });
  });

  it('la plantilla guardada se recupera y llega al estudiante como punto de partida', async () => {
    const { assignment, stepId } = await labActivity();
    const template = (await stepNexBook(assignment.id, stepId, ACTORS.teacherA)).nexbook!;

    const saved = await patchNexBookRoute(
      jsonRequestAs(
        ACTORS.teacherA,
        `http://localhost/api/nexbooks/${template.id}`,
        'PATCH',
        {
          revision: template.revision,
          document: {
            formatVersion: 1,
            blocks: [
              {
                id: 'instrucciones',
                type: 'markdown',
                source: '# Analiza el archivo',
                editableByStudent: false,
              },
              { id: 'analisis', type: 'code', language: 'python', source: '# completa aquí' },
            ],
            results: {},
          },
        }
      ),
      { params: Promise.resolve({ nexbookId: template.id }) }
    );
    expect(saved.status).toBe(200);

    // La docente la vuelve a abrir: es la misma plantilla, no una nueva.
    const reopened = await stepNexBook(assignment.id, stepId, ACTORS.teacherA);
    expect(reopened.nexbook!.id).toBe(template.id);
    expect(reopened.nexbook!.document.blocks.map((block) => block.id)).toEqual([
      'instrucciones',
      'analisis',
    ]);

    // El estudiante recibe SU copia, con los mismos bloques y los mismos ids.
    const reloaded = await read(assignment.id);
    const published = await patch(
      assignment.id,
      activityBody(reloaded.workflow, { status: 'published' }, true)
    );
    expect(published.status).toBe(200);
    const student = await stepNexBook(assignment.id, stepId, ACTORS.studentA);
    expect(student.role).toBe('instance');
    expect(student.nexbook!.id).not.toBe(template.id);
    expect(student.nexbook!.document.blocks.map((block) => block.id)).toEqual([
      'instrucciones',
      'analisis',
    ]);
    // Los bloqueos de la docente viajan con la copia.
    expect(student.nexbook!.document.blocks[0]).toMatchObject({ editableByStudent: false });
  });

  it('preparar la plantilla no crea ninguna entrega', async () => {
    const { assignment, stepId } = await labActivity();
    await stepNexBook(assignment.id, stepId, ACTORS.teacherA);

    const { listPersistedSubmissions } = await import('./helpers/dynamodb');
    await expect(listPersistedSubmissions(assignment.id)).resolves.toEqual([]);
  });
});

describe('NexIA como entregable de una Parte', () => {
  function aiPart(mode: 'none' | 'optional' | 'required'): WorkflowStep {
    const base = part('ai', undefined, 'Registra tu uso de IA');
    return {
      ...base,
      deliverables: [{ ...base.deliverables[0]!, conclusionMode: mode }],
    };
  }

  it('la política de conclusión se guarda y se relee', async () => {
    const created = await createOk(activityBody([aiPart('required'), part('respond', 'text', 'Cierre')]));
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.workflow[0]!.deliverables[0]!.conclusionMode).toBe('required');

    const reopened = await read(created.id);
    expect(reopened.workflow[0]!.deliverables[0]!.conclusionMode).toBe('required');
  });

  it('una parte que no es un registro de IA no guarda ninguna política', async () => {
    const created = await createOk(
      activityBody([part('respond', 'text', 'Uno'), part('code', undefined, 'Dos')])
    );
    const persisted = await getPersistedAssignment(created.id);
    for (const step of persisted!.workflow) {
      expect(step.deliverables[0]!.conclusionMode).toBeNull();
    }
  });

  it('con la conclusión obligatoria no se puede entregar sin escribirla', async () => {
    const created = await createOk(
      activityBody([aiPart('required')], { assignedHandles: ['student-a'] })
    );
    const stepId = created.workflow[0]!.id;

    const worklog = {
      objective: 'Explorar el modelo',
      provider: 'ChatGPT',
      model: 'GPT-5',
      prompt: 'Explica la dualidad en programación lineal.',
      responseSummary: 'Resumió la relación primal-dual.',
      studentAnalysis: '',
      resourcesUsed: [],
    };

    const blocked = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${created.id}/submission`,
        'PUT',
        { intent: 'submit', steps: [{ stepId, data: worklog }] }
      ),
      { params: Promise.resolve({ assignmentId: created.id }) }
    );

    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: expect.stringContaining('análisis'),
    });

    // Con la conclusión escrita, entrega.
    const ok = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${created.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [{ stepId, data: { ...worklog, studentAnalysis: 'Verifiqué el resultado a mano.' } }],
        }
      ),
      { params: Promise.resolve({ assignmentId: created.id }) }
    );
    expect(ok.status).toBe(200);
  });

  it('con la conclusión opcional se entrega sin escribirla', async () => {
    const created = await createOk(
      activityBody([aiPart('optional')], { assignedHandles: ['student-a'] })
    );
    const stepId = created.workflow[0]!.id;

    const response = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${created.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [
            {
              stepId,
              data: {
                objective: 'Explorar',
                provider: 'Claude',
                model: 'Opus',
                prompt: 'Explica la dualidad.',
                responseSummary: 'Lo explicó.',
                studentAnalysis: '',
                resourcesUsed: [],
              },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: created.id }) }
    );

    expect(response.status).toBe(200);
  });
});

describe('actividades creadas con la pantalla anterior', () => {
  /**
   * Una actividad guardada ANTES de esta fase, escrita directamente en la tabla
   * con la forma que tenía entonces: sin `conclusionMode`, con un entregable que
   * el catálogo de hoy ya no ofrece y con campos de investigación en la tarea.
   */
  const legacyRecord = {
    id: 'legacy-1',
    courseId: 'course-a',
    title: 'Glosario de conceptos',
    description: 'El de siempre',
    instructions: 'Rellena los tres campos de cada concepto.',
    type: 'research',
    status: 'published',
    dueDate: null,
    dueAt: null,
    resourceLinks: [],
    researchQuestions: [
      {
        id: 'q1',
        group: 'Card sorting',
        groupId: 'g1',
        prompt: 'Definición',
        type: 'long_text',
        required: true,
      },
    ],
    assignedTo: null,
    assignedToAll: true,
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    groupAssignments: [],
    resources: [],
    materials: [],
    workflow: [],
    createdBy: 'uid-teacher-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const legacyWorkflowRecord = {
    ...legacyRecord,
    id: 'legacy-2',
    title: 'Proceso con recursos de la materia',
    type: 'workflow',
    researchQuestions: [],
    workflow: [
      {
        id: 'elige',
        order: 0,
        title: 'Elige recursos',
        description: '',
        instructions: '',
        actionType: 'external_resource',
        tool: { mode: 'none', toolIds: [], toolNames: [] },
        resources: [],
        prompt: { mode: 'none', title: '', text: '', resourceId: null },
        deliverables: [
          { type: 'resource_reference', required: true, hint: 'Elige dos', questions: [] },
        ],
        required: true,
        assignedTo: null,
        dependsOnStepIds: [],
      },
      {
        id: 'comenta',
        order: 1,
        title: 'Comenta tu elección',
        description: '',
        instructions: '',
        actionType: 'reflection',
        tool: { mode: 'free', toolIds: [], toolNames: ['NotebookLM'] },
        resources: [{ kind: 'skill', id: 'skill-1' }],
        prompt: { mode: 'inline', title: 'Guía', text: 'Explica por qué.', resourceId: null },
        deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
        required: false,
        assignedTo: ['uid-student-a'],
        dependsOnStepIds: ['elige'],
      },
    ],
  };

  beforeEach(async () => {
    await putIntegrationItems(INTEGRATION_TABLES.assignments, [
      legacyRecord,
      legacyWorkflowRecord,
    ]);
  });

  it('una investigación antigua se abre, se edita el título y sigue siendo una investigación', async () => {
    const loaded = await read('legacy-1');
    expect(loaded.type).toBe('research');

    const parts = partsFromAssignment(loaded, nextId);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.deliverables[0]!.questions).toHaveLength(1);

    const derived = deriveActivity({
      parts,
      wasWorkflow: false,
      researchQuestions: loaded.researchQuestions,
    });
    expect(derived.type).toBe('research');

    const response = await patch('legacy-1', {
      title: 'Glosario de conceptos (2026)',
      description: loaded.description,
      instructions: loaded.instructions,
      type: derived.type,
      researchQuestions: derived.researchQuestions,
      workflow: derived.workflow,
      status: 'published',
    });
    expect(response.status).toBe(200);

    const persisted = await getPersistedAssignment('legacy-1');
    expect(persisted?.type).toBe('research');
    expect(persisted?.workflow).toEqual([]);
    expect(persisted?.researchQuestions).toHaveLength(1);
    expect(persisted?.researchQuestions[0]!.groupId).toBe('g1');
    expect(persisted?.title).toBe('Glosario de conceptos (2026)');
  });

  it('un proceso antiguo con un entregable retirado se guarda sin perderlo', async () => {
    const loaded = await read('legacy-2');
    const parts = partsFromAssignment(loaded, nextId);
    const derived = deriveActivity({ parts, wasWorkflow: true, researchQuestions: [] });

    const response = await patch('legacy-2', {
      title: 'Proceso con recursos de la materia',
      type: derived.type,
      researchQuestions: [],
      status: 'published',
      workflow: derived.workflow.map((item) => ({ ...item, assignedHandles: item.assignedTo })),
    });
    expect(response.status).toBe(200);

    const persisted = await getPersistedAssignment('legacy-2');
    expect(persisted?.workflow).toHaveLength(2);

    const [first, second] = persisted!.workflow;
    // El entregable que el catálogo ya no ofrece sigue ahí, con su acción.
    expect(first!.id).toBe('elige');
    expect(first!.actionType).toBe('external_resource');
    expect(first!.deliverables[0]!.type).toBe('resource_reference');
    expect(first!.deliverables[0]!.hint).toBe('Elige dos');

    // Y lo demás tampoco se toca.
    expect(second!.prompt).toMatchObject({ mode: 'inline', text: 'Explica por qué.' });
    expect(second!.tool).toMatchObject({ mode: 'free', toolNames: ['NotebookLM'] });
    expect(second!.resources).toEqual([{ kind: 'skill', id: 'skill-1' }]);
    expect(second!.dependsOnStepIds).toEqual(['elige']);
    expect(second!.required).toBe(false);
    expect(second!.assignedTo).toEqual(['uid-student-a']);
  });

  it('un registro de IA guardado sin política se lee como «opcional» y no bloquea la entrega', async () => {
    const loaded = await read('legacy-2');
    // La normalización decide la política de un entregable que no la traía.
    expect(loaded.workflow[1]!.deliverables[0]!.conclusionMode).toBeNull();

    const withAi = {
      ...legacyWorkflowRecord,
      id: 'legacy-3',
      workflow: [
        {
          ...legacyWorkflowRecord.workflow[0],
          id: 'ia',
          title: 'Registra la IA',
          actionType: 'ai_interaction',
          deliverables: [{ type: 'ai_worklog', required: true, hint: '', questions: [] }],
          dependsOnStepIds: [],
        },
      ],
    };
    await putIntegrationItems(INTEGRATION_TABLES.assignments, [withAi]);

    const read3 = await read('legacy-3');
    expect(read3.workflow[0]!.deliverables[0]!.conclusionMode).toBe('optional');

    const response = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        'http://localhost/api/assignments/legacy-3/submission',
        'PUT',
        {
          intent: 'submit',
          steps: [
            {
              stepId: 'ia',
              data: {
                objective: 'Explorar',
                provider: 'ChatGPT',
                model: 'GPT-5',
                prompt: 'Explica.',
                responseSummary: 'Explicó.',
                studentAnalysis: '',
                resourcesUsed: [],
              },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: 'legacy-3' }) }
    );

    expect(response.status).toBe(200);
  });
});

describe('permisos', () => {
  it('la docente de otra materia no puede modificar una actividad ajena', async () => {
    const created = await createOk(activityBody([part('respond', 'text')]));
    const response = await patch(created.id, activityBody([part('code')]), ACTORS.teacherB);

    expect([403, 404]).toContain(response.status);
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.type).toBe('freeform');
  });

  it('un estudiante no puede modificar la definición docente', async () => {
    const created = await createOk(activityBody([part('respond', 'text')]));
    const response = await patch(created.id, activityBody([part('code')]), ACTORS.studentA);

    expect([403, 404]).toContain(response.status);
    const persisted = await getPersistedAssignment(created.id);
    expect(persisted?.workflow).toEqual([]);
  });

  it('un estudiante no recibe la plantilla del laboratorio aunque pida la misma URL', async () => {
    const created = await createOk(activityBody([part('lab', undefined, 'Laboratorio')]));
    const stepId = created.workflow[0]!.id;

    // La plantilla existe porque la docente la abrió primero.
    const template = (await stepNexBook(created.id, stepId, ACTORS.teacherA)).nexbook!;
    const student = await stepNexBook(created.id, stepId, ACTORS.studentA);

    expect(student.role).toBe('instance');
    expect(student.nexbook!.id).not.toBe(template.id);
  });

  it('alguien de fuera de la materia no abre el laboratorio', async () => {
    const created = await createOk(activityBody([part('lab', undefined, 'Laboratorio')]));
    const stepId = created.workflow[0]!.id;

    const outsider = await stepNexBook(created.id, stepId, ACTORS.outsiderStudent);
    expect([403, 404]).toContain(outsider.status);
  });
});
