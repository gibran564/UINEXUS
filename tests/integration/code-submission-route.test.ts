import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { GET as readAssignmentRoute } from '@/app/api/assignments/[assignmentId]/route';
import { GET as readSubmissionsRoute } from '@/app/api/assignments/[assignmentId]/submissions/route';
import {
  GET as downloadAcademicFileRoute,
  POST as uploadAcademicFileRoute,
} from '@/app/api/assignments/[assignmentId]/files/route';
import {
  GET as readOwnSubmissionRoute,
  PUT as saveSubmissionRoute,
} from '@/app/api/assignments/[assignmentId]/submission/route';
import { submissionIdFor } from '@/lib/data/academic';
import type { Assignment, CodeData, MediaData } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedSubmission,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * Una actividad con DOS pasos que piden archivo: uno de documento y uno de
 * código en R.
 *
 * Dos cosas se comprueban a la vez, y las dos importan:
 *
 *  1. Que una tarea puede declarar «resuélvelo en R» y entregarse sin que exista
 *     ningún ejecutor. La ejecución nunca es requisito para entregar.
 *  2. Que la evidencia de cada paso queda SEPARADA. Con dos pasos que piden
 *     archivo, mezclarlos significaría que el reporte aparece como si fuera el
 *     código y viceversa.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

async function createCodeAssignment(language: 'r' | 'python' = 'r'): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      'http://localhost/api/courses/course-a/assignments',
      'POST',
      {
        title: 'Caso práctico con software',
        type: 'workflow',
        status: 'published',
        workflow: [
          {
            id: 'reporte',
            title: 'Reporte del caso',
            deliverables: [{ type: 'file', required: true }],
          },
          {
            id: 'codigo',
            title: `Desarrolla la solución en ${language === 'r' ? 'R' : 'Python'}`,
            actionType: 'code',
            deliverables: [
              {
                type: 'code',
                required: true,
                language,
                codeMode: 'editor',
                starterCode: language === 'r' ? 'datos <- c(10, 20, 30)\n' : 'data = [10, 20, 30]\n',
                executionEnabled: true,
              },
            ],
            dependsOnStepIds: ['reporte'],
          },
        ],
      }
    ),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );

  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

function presign(
  assignmentId: string,
  actor: Actor,
  body: Record<string, unknown>
): Promise<Response> {
  return uploadAcademicFileRoute(
    jsonRequestAs(actor, `http://localhost/api/assignments/${assignmentId}/files`, 'POST', body),
    { params: Promise.resolve({ assignmentId }) }
  );
}

function download(assignmentId: string, actor: Actor, key: string): Promise<Response> {
  return downloadAcademicFileRoute(
    requestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/files?key=${encodeURIComponent(key)}`
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('una tarea que se resuelve en R', () => {
  it('el paso declara el lenguaje y llega así al alumnado', async () => {
    const assignment = await createCodeAssignment();

    const read = await readAssignmentRoute(
      requestAs(ACTORS.studentA, `http://localhost/api/assignments/${assignment.id}`),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(read.status).toBe(200);
    const body = await read.json();
    const step = (body.assignment.workflow as Assignment['workflow']).find(
      (item) => item.id === 'codigo'
    );
    expect(step?.deliverables[0]).toMatchObject({
      type: 'code',
      language: 'r',
      codeMode: 'editor',
      starterCode: 'datos <- c(10, 20, 30)\n',
      executionEnabled: true,
    });
  });

  it('se entrega con el código pegado, sin ningún ejecutor de por medio', async () => {
    const assignment = await createCodeAssignment();

    const response = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [
            { stepId: 'reporte', data: { url: 'https://drive.google.com/file/d/abc' } },
            {
              stepId: 'codigo',
              data: {
                language: 'r',
                code: 'library(lpSolve)\nlp("max", c(3, 5), matrix(c(1, 0), 1), "<=", 4)',
                explanation: 'Modelo del ejercicio 4.',
              },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(200);

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );
    const code = persisted?.stepEvidence.codigo?.data as CodeData;
    expect(code.language).toBe('r');
    expect(code.code).toContain('lpSolve');
  });

  it('el lenguaje persistido lo dicta el step y no el cuerpo del alumno', async () => {
    const assignment = await createCodeAssignment('r');

    const response = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'draft',
          steps: [
            {
              stepId: 'codigo',
              data: { language: 'python', code: 'print(2 + 2)' },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(200);
    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );
    expect((persisted?.stepEvidence.codigo?.data as CodeData).language).toBe('r');
  });

  it('acepta el `.R` adjunto aunque el navegador no diga qué tipo es', async () => {
    const assignment = await createCodeAssignment();

    const response = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'codigo',
      contentType: '',
      sizeBytes: 512,
      fileName: 'modelo.R',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.storageKey).toMatch(
      new RegExp(`^academic/course-a/${ACTORS.studentA.uid}/${assignment.id}/codigo/[\\w-]+\\.r$`)
    );
    // Se guarda como texto plano: nunca como algo que pueda ejecutarse.
    expect(body.upload.fields['Content-Type']).toBe('text/plain');
  });

  it('un paso de código NO admite un ejecutable', async () => {
    const assignment = await createCodeAssignment();

    const response = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'codigo',
      contentType: 'application/octet-stream',
      sizeBytes: 512,
      fileName: 'modelo.exe',
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain('no se admite');
  });

  it('Python llega al alumnado y admite un `.py` como texto plano', async () => {
    const assignment = await createCodeAssignment('python');
    const read = await readAssignmentRoute(
      requestAs(ACTORS.studentA, `http://localhost/api/assignments/${assignment.id}`),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    const body = await read.json();
    const step = (body.assignment.workflow as Assignment['workflow']).find(
      (item) => item.id === 'codigo'
    );
    expect(step?.deliverables[0]).toMatchObject({
      language: 'python',
      codeMode: 'editor',
      executionEnabled: true,
    });

    const upload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'codigo',
      contentType: 'application/octet-stream',
      sizeBytes: 512,
      fileName: 'solucion.py',
    });
    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    expect(uploadBody.storageKey).toMatch(/\/codigo\/[\w-]+\.py$/);
    expect(uploadBody.upload.fields['Content-Type']).toBe('text/plain');
  });
});

describe('la evidencia de cada paso queda separada', () => {
  it('el archivo de un paso no puede citarse desde el otro', async () => {
    const assignment = await createCodeAssignment();

    const reportUpload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'reporte',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      fileName: 'reporte.pdf',
    });
    const { storageKey: reportKey } = await reportUpload.json();

    // La clave se emitió para «reporte»; citarla en «codigo» se rechaza porque
    // la ruta del objeto lleva dentro el paso al que pertenece.
    const crossed = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'draft',
          steps: [
            { stepId: 'codigo', data: { language: 'r', code: '', storageKey: reportKey } },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(crossed.status).toBe(422);
    await expect(crossed.json()).resolves.toEqual({
      error: 'La referencia del archivo no pertenece a esta entrega.',
    });
  });

  it('cada paso conserva SU archivo, y no se mezclan', async () => {
    const assignment = await createCodeAssignment();

    const reportUpload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'reporte',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      fileName: 'reporte.pdf',
    });
    const { storageKey: reportKey } = await reportUpload.json();

    const codeUpload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'codigo',
      contentType: '',
      sizeBytes: 512,
      fileName: 'modelo.R',
    });
    const { storageKey: codeKey } = await codeUpload.json();

    const saved = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'submit',
          steps: [
            {
              stepId: 'reporte',
              data: { storageKey: reportKey, fileName: 'reporte.pdf', kind: 'file' },
            },
            {
              stepId: 'codigo',
              data: { language: 'r', code: 'x <- 1', storageKey: codeKey, fileName: 'modelo.R' },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(saved.status).toBe(200);

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );

    expect((persisted?.stepEvidence.reporte?.data as MediaData).storageKey).toBe(reportKey);
    expect((persisted?.stepEvidence.codigo?.data as CodeData).storageKey).toBe(codeKey);
    expect(reportKey).not.toBe(codeKey);
  });
});

describe('quién puede leer el archivo entregado', () => {
  async function submitWithFile(): Promise<{ assignmentId: string; key: string }> {
    const assignment = await createCodeAssignment();

    const upload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'codigo',
      contentType: '',
      sizeBytes: 512,
      fileName: 'modelo.R',
    });
    const { storageKey } = await upload.json();

    const saved = await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'draft',
          steps: [
            {
              stepId: 'codigo',
              data: { language: 'r', code: 'x <- 1', storageKey, fileName: 'modelo.R' },
            },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(saved.status).toBe(200);

    return { assignmentId: assignment.id, key: storageKey };
  }

  it('quien lo entregó y el profesorado de la materia', async () => {
    const { assignmentId, key } = await submitWithFile();

    for (const actor of [ACTORS.studentA, ACTORS.teacherA]) {
      const response = await download(assignmentId, actor, key);
      expect(response.status, actor.token).toBe(200);
    }
  });

  it('otro estudiante del grupo NO puede leerlo', async () => {
    const { assignmentId, key } = await submitWithFile();
    expect((await download(assignmentId, ACTORS.studentB, key)).status).toBe(404);
  });

  it('alguien ajeno a la materia tampoco', async () => {
    const { assignmentId, key } = await submitWithFile();
    expect((await download(assignmentId, ACTORS.outsiderStudent, key)).status).toBe(404);
    expect((await download(assignmentId, ACTORS.teacherB, key)).status).toBe(404);
  });

  it('el profesorado ve el código pegado sin descargar nada', async () => {
    const { assignmentId } = await submitWithFile();

    const response = await readSubmissionsRoute(
      requestAs(ACTORS.teacherA, `http://localhost/api/assignments/${assignmentId}/submissions`),
      { params: Promise.resolve({ assignmentId }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const evidence = body.submissions[0].stepEvidence.codigo.data as CodeData;
    expect(evidence.code).toBe('x <- 1');
  });
});

/**
 * El autoguardado del editor, visto desde el servidor.
 *
 * El editor no manda la entrega entera cada vez que alguien escribe: manda EL
 * PASO que cambió. Lo que hace que eso sea seguro es que la ruta fusiona por
 * paso sobre lo ya guardado. Si en vez de fusionar reemplazara, escribir en el
 * paso 2 borraría el paso 1 —y la pérdida sería silenciosa, que es la peor
 * clase—.
 */
describe('guardar un solo paso no borra los demás', () => {
  async function createTwoCodeSteps(): Promise<Assignment> {
    const response = await createAssignmentRoute(
      jsonRequestAs(
        ACTORS.teacherA,
        'http://localhost/api/courses/course-a/assignments',
        'POST',
        {
          title: 'Dos programas',
          type: 'workflow',
          status: 'published',
          workflow: [
            {
              id: 'modelo',
              title: 'Modelo en Python',
              actionType: 'code',
              deliverables: [
                { type: 'code', required: true, language: 'python', codeMode: 'editor' },
              ],
            },
            {
              id: 'validacion',
              title: 'Validación en Python',
              actionType: 'code',
              required: false,
              deliverables: [
                { type: 'code', required: false, language: 'python', codeMode: 'editor' },
              ],
              dependsOnStepIds: [],
            },
          ],
        }
      ),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );
    expect(response.status).toBe(201);
    return (await response.json()).assignment as Assignment;
  }

  const autosave = (assignmentId: string, stepId: string, code: string) =>
    saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignmentId}/submission`,
        'PUT',
        { intent: 'draft', steps: [{ stepId, data: { code } }] }
      ),
      { params: Promise.resolve({ assignmentId }) }
    );

  it('dos pasos de código conservan cada uno su programa', async () => {
    const assignment = await createTwoCodeSteps();

    expect((await autosave(assignment.id, 'modelo', 'print("modelo")')).status).toBe(200);
    expect((await autosave(assignment.id, 'validacion', 'print("validacion")')).status).toBe(200);
    // Y volver al primero tampoco pisa el segundo.
    expect((await autosave(assignment.id, 'modelo', 'print("modelo v2")')).status).toBe(200);

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );

    expect((persisted?.stepEvidence.modelo?.data as CodeData).code).toBe('print("modelo v2")');
    expect((persisted?.stepEvidence.validacion?.data as CodeData).code).toBe('print("validacion")');
  });

  it('guardar el código no borra el archivo de otro paso', async () => {
    const assignment = await createCodeAssignment();

    const upload = await presign(assignment.id, ACTORS.studentA, {
      stepId: 'reporte',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      fileName: 'reporte.pdf',
    });
    const { storageKey } = await upload.json();

    await saveSubmissionRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`,
        'PUT',
        {
          intent: 'draft',
          steps: [
            { stepId: 'reporte', data: { storageKey, fileName: 'reporte.pdf', kind: 'file' } },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    await autosave(assignment.id, 'codigo', 'x <- 1');

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );

    expect((persisted?.stepEvidence.reporte?.data as MediaData).storageKey).toBe(storageKey);
    expect((persisted?.stepEvidence.codigo?.data as CodeData).code).toBe('x <- 1');
  });

  it('lo autoguardado se recupera tal cual al reabrir el formulario', async () => {
    // Es la promesa que ve el alumnado: recargar la página no pierde nada. La
    // sangría entra en el trato; sin ella un programa de Python vuelve roto.
    const assignment = await createTwoCodeSteps();
    const source = 'def resolver(x):\n    if x > 0:\n        return x\n    return 0\n';

    await autosave(assignment.id, 'modelo', source);

    const reopened = await readOwnSubmissionRoute(
      requestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/submission`
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(reopened.status).toBe(200);
    const body = await reopened.json();
    expect((body.submission.stepEvidence.modelo.data as CodeData).code).toBe(source);
  });

  it('un autoguardado deja la entrega en borrador, nunca la entrega sola', async () => {
    const assignment = await createTwoCodeSteps();
    await autosave(assignment.id, 'modelo', 'print(1)');

    const persisted = await getPersistedSubmission(
      submissionIdFor(assignment.id, ACTORS.studentA.uid)
    );
    expect(persisted?.status).toBe('draft');
  });
});
