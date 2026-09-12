import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { GET as stepNexBookRoute } from '@/app/api/assignments/[assignmentId]/steps/[stepId]/nexbook/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { POST as createNexBookRoute } from '@/app/api/nexbooks/route';
import { PATCH as patchNexBookRoute } from '@/app/api/nexbooks/[nexbookId]/route';
import { PUT as publishRoute } from '@/app/api/nexbooks/[nexbookId]/publication/route';
import { GET as publicReadRoute } from '@/app/api/nexbooks/published/[slug]/route';
import { GET as listWorkspacesRoute } from '@/app/api/workspaces/route';
import { nexiaPresetDocument } from '@/lib/nexia-preset';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';
import type {
  Assignment,
  NexBook,
  NexBookPublication,
  WorkspaceSummary,
} from '@/lib/types';

/**
 * NexIA de extremo a extremo, contra DynamoDB Local.
 *
 * Lo que las pruebas unitarias no pueden demostrar es que las RUTAS reales se
 * comporten así: que el servidor acepte guardar el bloque, que la publicación
 * salga sin ids internos, que la obligatoriedad de la conclusión se aplique al
 * ENTREGAR y no antes, y que el preset produzca un espacio como cualquier otro.
 *
 * Las imágenes no entran aquí: sus bytes necesitan S3, que esta suite no tiene.
 * Lo que se puede comprobar sin S3 —que la referencia sobrevive a publicar y que
 * el documento la valida— está en `tests/unit/nexia.test.ts`.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const params = (nexbookId: string) => ({ params: Promise.resolve({ nexbookId }) });

const WORKLOG = {
  provider: 'ChatGPT',
  model: 'GPT-5',
  conversationUrl: 'https://chatgpt.com/share/abc',
  objective: 'Entender la degeneración del simplex',
  prompt: '¿Por qué una base degenerada puede ciclar?',
  result: { content: '## Degeneración\n\nOcurre cuando…', format: 'markdown' },
  studentAnalysis: 'Le faltaba el ejemplo de Beale.',
  whatWasUsed: 'La condición de ciclado.',
  whatWasChanged: 'Reescribí el ejemplo con nuestros datos.',
  whatWasDiscarded: 'La demostración larga.',
};

const worklogBlock = (overrides: Record<string, unknown> = {}) => ({
  id: 'registro',
  type: 'ai_worklog',
  worklog: { ...WORKLOG },
  ...overrides,
});

async function createNexBook(
  actor: Actor,
  title: string,
  document: unknown
): Promise<NexBook> {
  const response = await createNexBookRoute(
    jsonRequestAs(actor, 'http://localhost/api/nexbooks', 'POST', { title, document })
  );
  expect(response.status).toBe(201);
  return (await response.json()).nexbook as NexBook;
}

beforeAll(createIntegrationTables, 60_000);
afterAll(deleteIntegrationTables, 60_000);
beforeEach(resetAndSeedIntegrationData, 60_000);

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

describe('guardar un registro de uso de IA', () => {
  it('el servidor acepta el bloque y lo devuelve entero', async () => {
    const nexbook = await createNexBook(ACTORS.studentA, 'Mi registro', {
      blocks: [
        { id: 'intro', type: 'markdown', source: '# Registro' },
        worklogBlock({ conclusionMode: 'optional' }),
      ],
    });

    const saved = nexbook.document.blocks[1];
    expect(saved?.type).toBe('ai_worklog');
    if (saved?.type !== 'ai_worklog') return;

    expect(saved.worklog.prompt).toContain('ciclar');
    expect(saved.worklog.result?.format).toBe('markdown');
    expect(saved.conclusionMode).toBe('optional');
  });

  it('se puede autoguardar un registro a medias, aunque pida conclusión obligatoria', async () => {
    /**
     * La obligatoriedad es académica y no estructural. Si el esquema la
     * exigiera, el autoguardado fallaría exactamente mientras alguien escribe.
     */
    const nexbook = await createNexBook(ACTORS.studentA, 'A medias', {
      blocks: [
        worklogBlock({
          conclusionMode: 'required',
          worklog: { ...WORKLOG, studentAnalysis: '' },
        }),
      ],
    });

    const response = await patchNexBookRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}`,
        'PATCH',
        {
          revision: nexbook.revision,
          document: {
            blocks: [
              worklogBlock({
                conclusionMode: 'required',
                worklog: { ...WORKLOG, studentAnalysis: '', prompt: 'Voy escribiendo…' },
              }),
            ],
            results: {},
          },
        }
      ),
      params(nexbook.id)
    );

    expect(response.status).toBe(200);
  });

  it('un NexBook ajeno con registro de IA sigue siendo invisible', async () => {
    const nexbook = await createNexBook(ACTORS.studentA, 'Privado', {
      blocks: [worklogBlock()],
    });

    const response = await patchNexBookRoute(
      jsonRequestAs(
        ACTORS.studentB,
        `http://localhost/api/nexbooks/${nexbook.id}`,
        'PATCH',
        { revision: nexbook.revision, title: 'Secuestrado' }
      ),
      params(nexbook.id)
    );

    // 404 indistinguible: «no existe» y «no es tuyo» se responden igual.
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Publicación
// ---------------------------------------------------------------------------

describe('publicar un NexBook con registro de uso de IA', () => {
  it('el registro se lee entero desde el enlace público', async () => {
    const nexbook = await createNexBook(ACTORS.studentA, 'Cómo usé IA', {
      blocks: [worklogBlock({ conclusionMode: 'required' })],
    });

    const published = await publishRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}/publication`,
        'PUT',
        { visibility: 'public' }
      ),
      params(nexbook.id)
    );
    expect(published.status).toBe(200);
    const { publication } = (await published.json()) as { publication: NexBookPublication };

    // Sin sesión: es un enlace que abre cualquiera.
    const response = await publicReadRoute(
      new Request(`http://localhost/api/nexbooks/published/${publication.slug}`),
      { params: Promise.resolve({ slug: publication.slug }) }
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { publication: NexBookPublication };
    const block = body.publication.document.blocks[0];
    if (block?.type !== 'ai_worklog') throw new Error('El registro no se publicó.');

    expect(block.worklog.provider).toBe('ChatGPT');
    expect(block.worklog.objective).toContain('degeneración');
    expect(block.worklog.prompt).toContain('ciclar');
    expect(block.worklog.result?.content).toContain('Degeneración');
    expect(block.worklog.whatWasUsed).toContain('ciclado');
    expect(block.worklog.whatWasChanged).toContain('Reescribí');
    expect(block.worklog.whatWasDiscarded).toContain('demostración');
    expect(block.worklog.studentAnalysis).toContain('Beale');
    expect(block.worklog.conversationUrl).toBe('https://chatgpt.com/share/abc');
    expect(block.conclusionMode).toBe('required');
  });

  it('`resourcesUsed` NO sale, y nada humano se pierde con él', async () => {
    const nexbook = await createNexBook(ACTORS.studentA, 'Con recursos', {
      blocks: [
        worklogBlock({
          worklog: {
            ...WORKLOG,
            resourcesUsed: [
              { kind: 'skill', id: 'skill-interna-de-la-materia' },
              { kind: 'prompt', id: 'prompt-privado-del-docente' },
            ],
          },
        }),
      ],
    });

    const published = await publishRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}/publication`,
        'PUT',
        { visibility: 'public' }
      ),
      params(nexbook.id)
    );
    const { publication } = (await published.json()) as { publication: NexBookPublication };

    const response = await publicReadRoute(
      new Request(`http://localhost/api/nexbooks/published/${publication.slug}`),
      { params: Promise.resolve({ slug: publication.slug }) }
    );
    const raw = await response.text();

    expect(raw).not.toContain('skill-interna-de-la-materia');
    expect(raw).not.toContain('prompt-privado-del-docente');
    // Y lo humano sigue estando: quitar los ids no puede llevarse el registro.
    expect(raw).toContain('Beale');
    expect(raw).toContain('ciclar');
  });

  it('ni el UID de quien publica ni ningún identificador interno viajan', async () => {
    const nexbook = await createNexBook(ACTORS.studentA, 'Sin secretos', {
      blocks: [worklogBlock()],
    });

    const published = await publishRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}/publication`,
        'PUT',
        { visibility: 'public' }
      ),
      params(nexbook.id)
    );
    const { publication } = (await published.json()) as { publication: NexBookPublication };

    const response = await publicReadRoute(
      new Request(`http://localhost/api/nexbooks/published/${publication.slug}`),
      { params: Promise.resolve({ slug: publication.slug }) }
    );
    const raw = await response.text();

    expect(raw).not.toContain(ACTORS.studentA.uid);
    expect(raw).not.toContain(nexbook.id);
    expect(raw).not.toContain('ownerUid');
    expect(raw).not.toContain('X-Amz-Signature');
    expect(raw).not.toContain('sourceNexbookId');
  });

  it('un campo inyectado en el bloque no llega a la publicación', async () => {
    /**
     * El cliente manda basura junto al bloque. El esquema la descarta al
     * guardar y la lista blanca la descartaría igual al publicar: son dos
     * defensas, y esta prueba recorre las dos de verdad.
     */
    const nexbook = await createNexBook(ACTORS.studentA, 'Hostil', {
      blocks: [
        {
          ...worklogBlock(),
          ownerUid: 'uid-inyectado',
          firebaseToken: 'eyJhbGciOiJSUzI1NiJ9.inyectado.firma',
          worklog: { ...WORKLOG, internalCourseId: 'course-privado' },
        },
      ],
    });

    const published = await publishRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}/publication`,
        'PUT',
        { visibility: 'public' }
      ),
      params(nexbook.id)
    );
    const { publication } = (await published.json()) as { publication: NexBookPublication };

    const response = await publicReadRoute(
      new Request(`http://localhost/api/nexbooks/published/${publication.slug}`),
      { params: Promise.resolve({ slug: publication.slug }) }
    );
    const raw = await response.text();

    for (const secret of ['uid-inyectado', 'eyJhbGciOiJSUzI1NiJ9', 'course-privado']) {
      expect(raw, secret).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Conclusión obligatoria
// ---------------------------------------------------------------------------

/**
 * Una actividad de un paso que pide un NexBook.
 *
 * Se prepara la plantilla como lo haría la docente: abre el paso, el servidor
 * crea la plantilla, y ella escribe el bloque de registro con la conclusión
 * marcada como obligatoria.
 */
async function assignmentWithRequiredConclusion(): Promise<{ assignment: Assignment }> {
  const created = await createAssignmentRoute(
    jsonRequestAs(ACTORS.teacherA, 'http://localhost/api/courses/course-a/assignments', 'POST', {
      title: 'Laboratorio con registro de IA',
      type: 'workflow',
      status: 'published',
      workflow: [
        {
          id: 'lab',
          title: 'Tu laboratorio',
          required: true,
          deliverables: [{ type: 'nexbook', required: true }],
        },
      ],
    }),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(created.status).toBe(201);
  const assignment = (await created.json()).assignment as Assignment;

  const opened = await stepNexBookRoute(
    requestAs(
      ACTORS.teacherA,
      `http://localhost/api/assignments/${assignment.id}/steps/lab/nexbook`
    ),
    { params: Promise.resolve({ assignmentId: assignment.id, stepId: 'lab' }) }
  );
  expect(opened.status).toBe(200);
  const template = (await opened.json()).nexbook as NexBook;

  const prepared = await patchNexBookRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      `http://localhost/api/nexbooks/${template.id}`,
      'PATCH',
      {
        revision: template.revision,
        document: {
          blocks: [
            {
              id: 'instrucciones',
              type: 'markdown',
              source: '# Registra cómo usaste IA',
              editableByStudent: false,
            },
            worklogBlock({
              conclusionMode: 'required',
              worklog: { ...WORKLOG, studentAnalysis: '' },
            }),
          ],
          results: {},
        },
      }
    ),
    params(template.id)
  );
  expect(prepared.status).toBe(200);

  return { assignment };
}

const submit = (assignmentId: string, actor: Actor, body: unknown) =>
  saveSubmissionRoute(
    jsonRequestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/submission`,
      'PUT',
      body
    ),
    { params: Promise.resolve({ assignmentId }) }
  );

function snapshotWith(analysis: string) {
  return {
    nexbookId: 'nb-instancia',
    revision: 2,
    title: 'Tu laboratorio',
    submittedAt: '2026-09-11T10:00:00.000Z',
    snapshot: {
      blocks: [
        { id: 'instrucciones', type: 'markdown', source: '# Registra cómo usaste IA' },
        worklogBlock({
          conclusionMode: 'required',
          worklog: { ...WORKLOG, studentAnalysis: analysis },
        }),
      ],
      results: {},
    },
  };
}

describe('la conclusión obligatoria se aplica al ENTREGAR', () => {
  it('un borrador sin análisis se guarda sin protestar', async () => {
    const { assignment } = await assignmentWithRequiredConclusion();

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'draft',
      steps: [{ stepId: 'lab', data: snapshotWith('') }],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).submission.status).toBe('draft');
  });

  it('entregar sin análisis se rechaza, y se dice en qué paso falta', async () => {
    const { assignment } = await assignmentWithRequiredConclusion();

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [{ stepId: 'lab', data: snapshotWith('') }],
    });

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('Tu laboratorio');
    expect(error).toContain('análisis');
  });

  it('con el análisis escrito, la entrega pasa', async () => {
    const { assignment } = await assignmentWithRequiredConclusion();

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [{ stepId: 'lab', data: snapshotWith('Comprobé el ciclado con nuestros datos.') }],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).submission.status).toBe('submitted');
  });

  it('bajar `conclusionMode` a `none` desde el navegador NO salta la regla', async () => {
    /**
     * Quien decide si la reflexión es obligatoria es el profesorado, y el
     * servidor lo lee de la PLANTILLA. Si lo leyera del cuerpo, bastaría con
     * mandar `none` —que es un valor legítimo en un documento— para saltárselo.
     */
    const { assignment } = await assignmentWithRequiredConclusion();

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [
        {
          stepId: 'lab',
          data: {
            ...snapshotWith(''),
            snapshot: {
              blocks: [worklogBlock({ conclusionMode: 'none', worklog: { ...WORKLOG, studentAnalysis: '' } })],
              results: {},
            },
          },
        },
      ],
    });

    expect(response.status).toBe(409);
  });

  it('borrar el bloque tampoco es la forma de no contestarlo', async () => {
    const { assignment } = await assignmentWithRequiredConclusion();

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [
        {
          stepId: 'lab',
          data: {
            ...snapshotWith(''),
            snapshot: {
              blocks: [{ id: 'otro', type: 'markdown', source: 'Ya está.' }],
              results: {},
            },
          },
        },
      ],
    });

    expect(response.status).toBe(409);
  });

  it('una actividad SIN conclusión obligatoria se entrega igual que siempre', async () => {
    // La comprobación nueva no puede costar nada a las actividades existentes.
    const created = await createAssignmentRoute(
      jsonRequestAs(ACTORS.teacherA, 'http://localhost/api/courses/course-a/assignments', 'POST', {
        title: 'Laboratorio sin IA',
        type: 'workflow',
        status: 'published',
        workflow: [
          {
            id: 'lab',
            title: 'Tu laboratorio',
            required: true,
            deliverables: [{ type: 'nexbook', required: true }],
          },
        ],
      }),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    const assignment = (await created.json()).assignment as Assignment;

    const response = await submit(assignment.id, ACTORS.studentA, {
      intent: 'submit',
      steps: [
        {
          stepId: 'lab',
          data: {
            nexbookId: 'nb-1',
            revision: 1,
            title: 'Tu laboratorio',
            submittedAt: '2026-09-11T10:00:00.000Z',
            snapshot: {
              blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'print(1)' }],
              results: {},
            },
          },
        },
      ],
    });

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// El preset
// ---------------------------------------------------------------------------

describe('el preset NexIA', () => {
  it('crea un NexBook privado y personal, no una entidad nueva', async () => {
    const nexbook = await createNexBook(
      ACTORS.studentA,
      'Registro de uso de IA',
      nexiaPresetDocument()
    );

    expect(nexbook.visibility).toBe('private');
    expect(nexbook.context).toEqual({ type: 'personal' });
    expect(nexbook.document.blocks.map((block) => block.type)).toEqual([
      'markdown',
      'ai_worklog',
    ]);
  });

  it('aparece en Espacios como un NexLab más', async () => {
    await createNexBook(ACTORS.studentA, 'Registro de uso de IA', nexiaPresetDocument());

    const response = await listWorkspacesRoute(
      requestAs(ACTORS.studentA, 'http://localhost/api/workspaces')
    );
    expect(response.status).toBe(200);

    const { workspaces } = (await response.json()) as { workspaces: WorkspaceSummary[] };
    const created = workspaces.find((item) => item.title === 'Registro de uso de IA');

    // `kind: 'nexbook'`. No hay `kind: 'nexia'` que la lista tuviera que saber
    // pintar, y por eso los filtros de la Fase 2 siguen funcionando sin tocarlos.
    expect(created?.kind).toBe('nexbook');
    expect(created?.blockCount).toBe(2);
  });

  it('sólo lo ve quien lo creó', async () => {
    await createNexBook(ACTORS.studentA, 'Registro de uso de IA', nexiaPresetDocument());

    const response = await listWorkspacesRoute(
      requestAs(ACTORS.studentB, 'http://localhost/api/workspaces')
    );
    const { workspaces } = (await response.json()) as { workspaces: WorkspaceSummary[] };
    expect(workspaces).toEqual([]);
  });
});
