import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { GET as readAssignmentRoute } from '@/app/api/assignments/[assignmentId]/route';
import { GET as stepNexBookRoute } from '@/app/api/assignments/[assignmentId]/steps/[stepId]/nexbook/route';
import {
  GET as readNexBookRoute,
  PATCH as patchNexBookRoute,
} from '@/app/api/nexbooks/[nexbookId]/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { GET as listSubmissionsRoute } from '@/app/api/assignments/[assignmentId]/submissions/route';
import { GET as workflowProgressRoute } from '@/app/api/assignments/[assignmentId]/workflow/route';
import { submissionIdFor } from '@/lib/data/academic';
import { templateNexBookIdFor } from '@/lib/data/nexbooks';
import {
  canSubmit,
  missingToSubmit,
  partStatus,
  type StudentWork,
} from '@/lib/student-activity';
import type { Assignment, NexBook, Submission } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedSubmission,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * La experiencia del estudiante, contra DynamoDB Local.
 *
 * Lo que se comprueba aquí no es la pantalla: es que lo que la pantalla enseña
 * y lo que el servidor permite son lo mismo. De ahí que varias pruebas calculen
 * el estado con `lib/student-activity` —el mismo código que corre en el
 * navegador— sobre la respuesta REAL de la ruta, en vez de sobre un objeto
 * inventado aquí.
 *
 * Y lo que ninguna pantalla puede garantizar: que la plantilla de la docente no
 * se toca, que el trabajo de otra persona no se ve, que la copia entregada no
 * cambia y que nadie se salta una regla académica mandando otro cuerpo.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const courseUrl = 'http://localhost/api/courses/course-a/assignments';

/** Tres partes: una de texto, una de IA con conclusión obligatoria y un laboratorio. */
function processInput() {
  return {
    title: 'Comparar dos métodos',
    description: 'Prepara, documenta y concluye.',
    instructions: 'Las partes se hacen en orden.',
    type: 'workflow',
    status: 'published',
    workflow: [
      {
        id: 'preparar',
        title: 'Preparar los datos',
        required: true,
        deliverables: [{ type: 'text', required: true }],
      },
      {
        id: 'registro',
        title: 'Registrar uso de IA',
        required: true,
        dependsOnStepIds: ['preparar'],
        deliverables: [{ type: 'ai_worklog', required: true, conclusionMode: 'required' }],
      },
      {
        id: 'laboratorio',
        title: 'Tu laboratorio',
        required: true,
        deliverables: [{ type: 'nexbook', required: true }],
      },
    ],
  };
}

/** Una actividad por partes con UNA sola parte, que pide laboratorio. */
function singleLabInput() {
  return {
    title: 'Análisis de ventas',
    type: 'workflow',
    status: 'published',
    workflow: [
      {
        id: 'laboratorio',
        title: 'Tu laboratorio',
        required: true,
        deliverables: [{ type: 'nexbook', required: true }],
      },
    ],
  };
}

async function createActivity(input: unknown): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(ACTORS.teacherA, courseUrl, 'POST', input),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

interface StudentPayload {
  assignment: Assignment;
  submission: Submission | null;
  myStepIds: string[];
  myLabs: string[];
  teacherName: string;
  courseName: string;
}

async function open(assignmentId: string, actor: Actor): Promise<StudentPayload> {
  const response = await readAssignmentRoute(
    requestAs(actor, `http://localhost/api/assignments/${assignmentId}`),
    { params: Promise.resolve({ assignmentId }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StudentPayload;
}

/** Lo que la pantalla mira para decidir qué enseñar. */
function workOf(payload: StudentPayload): StudentWork {
  return {
    evidence: payload.submission?.stepEvidence ?? {},
    labs: new Set(payload.myLabs),
  };
}

async function save(
  assignmentId: string,
  actor: Actor,
  body: unknown
): Promise<{ status: number; error?: string }> {
  const response = await saveSubmissionRoute(
    jsonRequestAs(actor, `http://localhost/api/assignments/${assignmentId}/submission`, 'PUT', body),
    { params: Promise.resolve({ assignmentId }) }
  );
  if (response.status === 200) return { status: 200 };
  return { status: response.status, error: (await response.json()).error as string };
}

async function openLab(
  assignmentId: string,
  stepId: string,
  actor: Actor
): Promise<{ status: number; nexbook?: NexBook; role?: string }> {
  const response = await stepNexBookRoute(
    requestAs(actor, `http://localhost/api/assignments/${assignmentId}/steps/${stepId}/nexbook`),
    { params: Promise.resolve({ assignmentId, stepId }) }
  );
  if (response.status !== 200) return { status: response.status };
  const body = await response.json();
  return { status: 200, nexbook: body.nexbook as NexBook, role: body.role as string };
}

async function writeInLab(
  nexbook: NexBook,
  actor: Actor,
  text: string
): Promise<{ status: number; nexbook?: NexBook }> {
  const response = await patchNexBookRoute(
    jsonRequestAs(actor, `http://localhost/api/nexbooks/${nexbook.id}`, 'PATCH', {
      revision: nexbook.revision,
      document: {
        formatVersion: nexbook.document.formatVersion,
        blocks: [{ id: 'b-nota', type: 'markdown', source: text }],
        results: {},
      },
    }),
    { params: Promise.resolve({ nexbookId: nexbook.id }) }
  );
  if (response.status !== 200) return { status: response.status };
  return { status: 200, nexbook: (await response.json()).nexbook as NexBook };
}

const answer = (stepId: string, text: string) => ({
  steps: [{ stepId, data: { text, links: [] } }],
  intent: 'draft' as const,
});

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

// ---------------------------------------------------------------------------
// Lo que ve el estudiante al abrir
// ---------------------------------------------------------------------------

describe('abrir una actividad', () => {
  it('trae lo que hace falta para situarse, y ningún UID', async () => {
    const created = await createActivity(processInput());
    const payload = await open(created.id, ACTORS.studentA);

    expect(payload.courseName).toBeTruthy();
    expect(payload.teacherName).toBeTruthy();
    expect(payload.myStepIds).toEqual(['preparar', 'registro', 'laboratorio']);

    // La invariante de siempre: al alumnado no le llega el UID de nadie, ni
    // siquiera el suyo.
    expect(JSON.stringify(payload)).not.toContain('uid-');
  });

  it('las dependencias se derivan de lo guardado, sin ningún campo nuevo', async () => {
    const created = await createActivity(processInput());

    const before = await open(created.id, ACTORS.studentA);
    const parts = before.assignment.workflow;
    expect(partStatus(parts, parts[1]!, workOf(before))).toBe('locked');

    expect((await save(created.id, ACTORS.studentA, answer('preparar', 'Símplex y gráfico.'))).status)
      .toBe(200);

    const after = await open(created.id, ACTORS.studentA);
    expect(partStatus(after.assignment.workflow, after.assignment.workflow[1]!, workOf(after))).toBe(
      'not_started'
    );
  });
});

// ---------------------------------------------------------------------------
// El laboratorio y la reanudación
// ---------------------------------------------------------------------------

describe('un laboratorio empezado', () => {
  it('abrirlo NO lo da por hecho; guardar algo sí', async () => {
    /**
     * La diferencia entre «existe la copia» y «hay trabajo dentro». Abrir la
     * pestaña crea la copia y no dice nada más; lo que cuenta es haber
     * guardado, que es lo que sube la revisión del documento.
     */
    const created = await createActivity(singleLabInput());

    const before = await open(created.id, ACTORS.studentA);
    expect(before.myLabs).toEqual([]);
    expect(partStatus(before.assignment.workflow, before.assignment.workflow[0]!, workOf(before)))
      .toBe('not_started');

    const lab = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    expect(lab.role).toBe('instance');
    expect(await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentA.uid))).toBeUndefined();

    // Abierta y sin tocar: sigue sin contar.
    const opened = await open(created.id, ACTORS.studentA);
    expect(opened.myLabs).toEqual([]);
    expect(partStatus(opened.assignment.workflow, opened.assignment.workflow[0]!, workOf(opened)))
      .toBe('not_started');

    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Mi análisis.');

    const after = await open(created.id, ACTORS.studentA);
    expect(after.myLabs).toEqual(['laboratorio']);
    expect(partStatus(after.assignment.workflow, after.assignment.workflow[0]!, workOf(after))).toBe(
      'done'
    );
  });

  it('abrir el laboratorio y no escribir nada no permite entregar', async () => {
    const created = await createActivity(singleLabInput());
    await openLab(created.id, 'laboratorio', ACTORS.studentA);

    const result = await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' });
    expect(result.status).toBe(409);
    expect(result.error).toContain('Tu laboratorio');
  });

  it('se puede entregar sin haber vuelto a abrir la parte', async () => {
    /**
     * El caso real: se trabaja en el laboratorio, se cierra, se vuelve otro día
     * y se pulsa «Entregar». El navegador no tiene ninguna copia que mandar, y
     * el trabajo está hecho. Antes esto respondía «todavía te falta».
     */
    const created = await createActivity(singleLabInput());
    const lab = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Las ventas suben en el cuarto trimestre.');

    const result = await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' });
    expect(result.status).toBe(200);

    const stored = await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentA.uid));
    expect(stored?.status).toBe('submitted');
    const evidence = stored?.stepEvidence.laboratorio?.data as {
      snapshot?: { blocks: { source?: string }[] };
    };
    expect(evidence.snapshot?.blocks[0]?.source).toContain('cuarto trimestre');
  });

  it('sin laboratorio abierto, entregar sigue diciendo qué falta', async () => {
    const created = await createActivity(singleLabInput());
    const result = await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' });

    expect(result.status).toBe(409);
    expect(result.error).toContain('Tu laboratorio');
  });
});

// ---------------------------------------------------------------------------
// La copia entregada no cambia
// ---------------------------------------------------------------------------

describe('la entrega congela una copia', () => {
  it('seguir trabajando después NO cambia lo que verá la docente', async () => {
    const created = await createActivity(singleLabInput());
    const opened = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    const written = await writeInLab(opened.nexbook!, ACTORS.studentA, 'Versión entregada.');

    expect((await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' })).status).toBe(
      200
    );

    // Se sigue trabajando en el documento vivo, que es lo que se espera poder
    // hacer: la copia personal es suya.
    const again = await writeInLab(
      written.nexbook!,
      ACTORS.studentA,
      'Versión de después, que no se entregó.'
    );
    expect(again.status).toBe(200);

    // Y lo que la docente abre sigue siendo lo que se entregó.
    const response = await listSubmissionsRoute(
      requestAs(ACTORS.teacherA, `http://localhost/api/assignments/${created.id}/submissions`),
      { params: Promise.resolve({ assignmentId: created.id }) }
    );
    expect(response.status).toBe(200);
    const [submission] = (await response.json()).submissions as Submission[];
    const snapshot = submission!.stepEvidence.laboratorio?.data as {
      snapshot: { blocks: { source?: string }[] };
    };
    expect(snapshot.snapshot.blocks[0]?.source).toBe('Versión entregada.');
  });
});

// ---------------------------------------------------------------------------
// Conclusión obligatoria
// ---------------------------------------------------------------------------

describe('la conclusión obligatoria de una parte de NexIA', () => {
  async function upTo(assignmentId: string, analysis: string): Promise<{ status: number; error?: string }> {
    await save(assignmentId, ACTORS.studentA, answer('preparar', 'Símplex y gráfico.'));
    const lab = await openLab(assignmentId, 'laboratorio', ACTORS.studentA);
    expect(lab.status).toBe(200);
    // Abrirlo ya no basta: la Parte se completa cuando se guarda algo.
    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Comparativa en la hoja.');

    return save(assignmentId, ACTORS.studentA, {
      intent: 'submit',
      steps: [
        {
          stepId: 'registro',
          data: {
            provider: 'Claude',
            objective: 'Comparar los dos métodos.',
            prompt: 'Compara símplex y gráfico.',
            responseSummary: 'Los comparó.',
            studentAnalysis: analysis,
            // Rebajar la política desde el navegador no es una opción: el
            // servidor la lee de la definición de la parte.
            conclusionMode: 'none',
          },
        },
      ],
    });
  }

  it('sin conclusión no se entrega, y se dice en qué parte falta', async () => {
    const created = await createActivity(processInput());
    const result = await upTo(created.id, '   ');

    expect(result.status).toBe(409);
    expect(result.error).toContain('Registrar uso de IA');
    expect(result.error).toContain('análisis');
  });

  it('con la conclusión escrita, la entrega pasa', async () => {
    const created = await createActivity(processInput());
    const result = await upTo(created.id, 'El símplex escala mejor; la IA se equivocó en el caso 2.');

    expect(result.status).toBe(200);
    const stored = await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentA.uid));
    expect(stored?.status).toBe('submitted');
  });

  it('la pantalla dice lo mismo que el servidor antes de intentarlo', async () => {
    const created = await createActivity(processInput());
    await save(created.id, ACTORS.studentA, answer('preparar', 'Símplex y gráfico.'));
    const lab = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Comparativa en la hoja.');
    await save(created.id, ACTORS.studentA, {
      intent: 'draft',
      steps: [
        {
          stepId: 'registro',
          data: {
            provider: 'Claude',
            objective: 'Comparar.',
            prompt: 'Compara.',
            responseSummary: 'Comparó.',
            studentAnalysis: '',
          },
        },
      ],
    });

    const payload = await open(created.id, ACTORS.studentA);
    const parts = payload.assignment.workflow;
    const work = workOf(payload);

    expect(canSubmit(parts, work)).toBe(false);
    expect(missingToSubmit(parts, work)).toEqual([
      {
        partId: 'registro',
        title: 'Registrar uso de IA',
        message: 'Falta tu conclusión sobre el uso de IA. Esta actividad la pide.',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

describe('lo que un estudiante no puede hacer', () => {
  it('no puede escribir en la plantilla de la docente', async () => {
    const created = await createActivity(singleLabInput());
    // La plantilla se crea cuando la docente abre el paso.
    const template = await openLab(created.id, 'laboratorio', ACTORS.teacherA);
    expect(template.role).toBe('template');

    const response = await patchNexBookRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${template.nexbook!.id}`,
        'PATCH',
        {
          revision: template.nexbook!.revision,
          document: { formatVersion: 1, blocks: [{ id: 'x', type: 'markdown', source: 'mío' }], results: {} },
        }
      ),
      { params: Promise.resolve({ nexbookId: template.nexbook!.id }) }
    );

    expect([403, 404]).toContain(response.status);
  });

  it('pedir la URL de la plantilla le devuelve SU copia, no la plantilla', async () => {
    const created = await createActivity(singleLabInput());
    const mine = await openLab(created.id, 'laboratorio', ACTORS.studentA);

    expect(mine.role).toBe('instance');
    expect(mine.nexbook!.id).not.toBe(templateNexBookIdFor(created.id, 'laboratorio'));
  });

  it('no puede leer el laboratorio de otra persona', async () => {
    const created = await createActivity(singleLabInput());
    const theirs = await openLab(created.id, 'laboratorio', ACTORS.studentA);

    const response = await readNexBookRoute(
      requestAs(ACTORS.studentB, `http://localhost/api/nexbooks/${theirs.nexbook!.id}`),
      { params: Promise.resolve({ nexbookId: theirs.nexbook!.id }) }
    );

    expect(response.status).toBe(404);
  });

  it('no puede dar por hecha una parte que no le toca', async () => {
    const created = await createActivity({
      title: 'Reparto',
      type: 'workflow',
      status: 'published',
      workflow: [
        {
          id: 'de-a',
          title: 'Parte de A',
          required: true,
          assignedHandles: ['student-a'],
          deliverables: [{ type: 'text', required: true }],
        },
        {
          id: 'de-b',
          title: 'Parte de B',
          required: true,
          assignedHandles: ['student-b'],
          deliverables: [{ type: 'text', required: true }],
        },
      ],
    });

    // B manda evidencia de la parte de A. Se descarta en silencio: la docente
    // puede haber reasignado mientras tenía el formulario abierto, y devolver
    // un error le impediría guardar lo que sí es suyo.
    const result = await save(created.id, ACTORS.studentB, {
      intent: 'draft',
      steps: [{ stepId: 'de-a', data: { text: 'Lo hago yo.', links: [] } }],
    });
    expect(result.status).toBe(200);

    const stored = await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentB.uid));
    expect(stored?.stepEvidence['de-a']).toBeUndefined();

    // Y la parte de A sigue sin estar hecha para quien de verdad la tiene.
    const asA = await open(created.id, ACTORS.studentA);
    expect(asA.myStepIds).toEqual(['de-a']);
    expect(canSubmit(asA.assignment.workflow.filter((step) => asA.myStepIds.includes(step.id)), workOf(asA)))
      .toBe(false);
  });

  it('el laboratorio ajeno tampoco se recoge al entregar', async () => {
    /**
     * La recogida automática de laboratorios sólo puede mirar los de quien
     * entrega. Si mirase por paso sin comprobar responsable, la copia de otra
     * persona acabaría dentro de una entrega ajena.
     */
    const created = await createActivity(singleLabInput());
    await openLab(created.id, 'laboratorio', ACTORS.studentA);

    const result = await save(created.id, ACTORS.studentB, { steps: [], intent: 'submit' });
    expect(result.status).toBe(409);
    expect(await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentB.uid))).toBeUndefined();
  });

  it('alguien de fuera de la materia no ve nada', async () => {
    const created = await createActivity(singleLabInput());

    const response = await readAssignmentRoute(
      requestAs(ACTORS.outsiderStudent, `http://localhost/api/assignments/${created.id}`),
      { params: Promise.resolve({ assignmentId: created.id }) }
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Una parte, un proceso
// ---------------------------------------------------------------------------

describe('el avance por parte que ve el profesorado', () => {
  async function progress(assignmentId: string, actor: Actor) {
    const response = await workflowProgressRoute(
      requestAs(actor, `http://localhost/api/assignments/${assignmentId}/workflow`),
      { params: Promise.resolve({ assignmentId }) }
    );
    return { status: response.status, body: await response.json() };
  }

  it('funciona con UNA sola parte', async () => {
    /**
     * Antes exigía «varios pasos» contando el array, así que respondía 409
     * justo en la pestaña que la pantalla docente abre por defecto para una
     * actividad de un solo laboratorio: se ofrecía y luego fallaba. Lo decide
     * el tipo.
     */
    const created = await createActivity(singleLabInput());
    const result = await progress(created.id, ACTORS.teacherA);

    expect(result.status).toBe(200);
    expect(result.body.steps).toHaveLength(1);
    expect(result.body.steps[0].title).toBe('Tu laboratorio');
  });

  it('y también con varias', async () => {
    const created = await createActivity(processInput());
    const result = await progress(created.id, ACTORS.teacherA);

    expect(result.status).toBe(200);
    expect(result.body.steps.map((step: { stepId: string }) => step.stepId)).toEqual([
      'preparar',
      'registro',
      'laboratorio',
    ]);
  });

  it('una actividad del formato anterior sí se rechaza: su parte es sintética', async () => {
    const created = await createActivity({
      title: 'Glosario del formato anterior',
      type: 'research',
      status: 'published',
      researchQuestions: [
        { id: 'q1', group: 'Símplex', groupId: 'g1', prompt: 'Definición', type: 'long_text' },
      ],
    });

    const result = await progress(created.id, ACTORS.teacherA);
    expect(result.status).toBe(409);
    expect(result.body.error).toContain('por partes');
  });

  it('no se lo enseña a un estudiante', async () => {
    const created = await createActivity(singleLabInput());
    const result = await progress(created.id, ACTORS.studentA);
    expect([403, 404]).toContain(result.status);
  });
});

describe('una actividad por partes con una sola parte', () => {
  it('se abre, se trabaja y se entrega como cualquier otra', async () => {
    const created = await createActivity(singleLabInput());

    const payload = await open(created.id, ACTORS.studentA);
    expect(payload.assignment.type).toBe('workflow');
    expect(payload.assignment.workflow).toHaveLength(1);

    const lab = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Mi análisis.');

    expect((await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' })).status).toBe(
      200
    );

    const after = await open(created.id, ACTORS.studentA);
    expect(after.submission?.status).toBe('submitted');
    expect(after.submission?.submittedAt).toBeTruthy();
  });

  it('se puede volver a entregar, y la revisión anterior se invalida', async () => {
    const created = await createActivity(singleLabInput());
    const lab = await openLab(created.id, 'laboratorio', ACTORS.studentA);
    await writeInLab(lab.nexbook!, ACTORS.studentA, 'Primera versión.');
    await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' });

    const again = await save(created.id, ACTORS.studentA, { steps: [], intent: 'submit' });
    expect(again.status).toBe(200);

    const stored = await getPersistedSubmission(submissionIdFor(created.id, ACTORS.studentA.uid));
    expect(stored?.status).toBe('submitted');
    expect(stored?.reviewedAt).toBeNull();
  });
});
