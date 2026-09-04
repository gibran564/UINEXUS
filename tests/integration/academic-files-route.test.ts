import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import {
  GET as downloadAcademicFileRoute,
  POST as uploadAcademicFileRoute,
} from '@/app/api/assignments/[assignmentId]/files/route';
import { PUT as saveSubmissionRoute } from '@/app/api/assignments/[assignmentId]/submission/route';
import { submissionIdFor } from '@/lib/data/academic';
import type { Assignment } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedSubmission,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

const maxDocumentBytes = 25 * 1024 * 1024;

async function createFileAssignment(): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      'http://localhost/api/courses/course-a/assignments',
      'POST',
      {
        title: 'Entrega de documento',
        type: 'workflow',
        status: 'published',
        workflow: [
          {
            id: 'document',
            title: 'Subir informe',
            assignedHandles: ['student-a'],
            deliverables: [{ type: 'file', required: true }],
          },
        ],
      }
    ),
    { params: Promise.resolve({ courseId: 'course-a' }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()).assignment as Assignment;
}

function uploadRequest(
  assignmentId: string,
  actor: (typeof ACTORS)[keyof typeof ACTORS],
  overrides: Record<string, unknown> = {}
): Promise<Response> {
  return uploadAcademicFileRoute(
    jsonRequestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/files`,
      'POST',
      {
        stepId: 'document',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        fileName: 'informe.pdf',
        ...overrides,
      }
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

function downloadRequest(
  assignmentId: string,
  actor: (typeof ACTORS)[keyof typeof ACTORS],
  storageKey: string
): Promise<Response> {
  return downloadAcademicFileRoute(
    requestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/files?key=${encodeURIComponent(storageKey)}`
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

async function citeFile(assignmentId: string, storageKey: string): Promise<Response> {
  return saveSubmissionRoute(
    jsonRequestAs(
      ACTORS.studentA,
      `http://localhost/api/assignments/${assignmentId}/submission`,
      'PUT',
      {
        intent: 'submit',
        steps: [
          {
            stepId: 'document',
            data: {
              storageKey,
              fileName: 'informe.pdf',
              kind: 'file',
              note: '',
              url: '',
            },
          },
        ],
      }
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('ruta de archivos académicos con firmas offline y DynamoDB Local', () => {
  it('emite un POST firmado acotado a la ruta, MIME y límite del entregable', async () => {
    const assignment = await createFileAssignment();
    const response = await uploadRequest(assignment.id, ACTORS.studentA);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.storageKey).toMatch(
      new RegExp(`^academic/course-a/${ACTORS.studentA.uid}/${assignment.id}/document/[\\w-]+\\.pdf$`)
    );
    expect(body.fileName).toBe('informe.pdf');
    expect(body.upload.url).toContain('uinexus-integration-files');
    expect(body.upload.fields['Content-Type']).toBe('application/pdf');
    expect(body.upload.fields.key).toBe(body.storageKey);

    const policy = JSON.parse(Buffer.from(body.upload.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 0, maxDocumentBytes]);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'application/pdf']);
  });

  it('devuelve 422 para MIME no admitido y tamaño superior al límite', async () => {
    const assignment = await createFileAssignment();
    const invalidMime = await uploadRequest(assignment.id, ACTORS.studentA, {
      contentType: 'text/html',
    });
    expect(invalidMime.status).toBe(422);
    expect((await invalidMime.json()).error).toContain('no se admite');

    const oversized = await uploadRequest(assignment.id, ACTORS.studentA, {
      sizeBytes: maxDocumentBytes + 1,
    });
    expect(oversized.status).toBe(422);
    expect((await oversized.json()).error).toContain('25 MB');
  });

  it('impide solicitar permisos al docente y a un estudiante ajeno', async () => {
    const assignment = await createFileAssignment();
    expect((await uploadRequest(assignment.id, ACTORS.teacherA)).status).toBe(403);
    expect((await uploadRequest(assignment.id, ACTORS.studentB)).status).toBe(403);
    expect((await uploadRequest(assignment.id, ACTORS.outsiderStudent)).status).toBe(404);
  });

  it('firma lectura sólo después de citar la clave propia y rechaza apropiarse de otra', async () => {
    const assignment = await createFileAssignment();
    const upload = await uploadRequest(assignment.id, ACTORS.studentA);
    const { storageKey } = await upload.json();

    expect((await downloadRequest(assignment.id, ACTORS.studentA, storageKey)).status).toBe(404);
    expect((await citeFile(assignment.id, storageKey)).status).toBe(200);

    for (const actor of [ACTORS.studentA, ACTORS.teacherA]) {
      const response = await downloadRequest(assignment.id, actor, storageKey);
      expect(response.status).toBe(200);
      const signed = new URL((await response.json()).url);
      expect(signed.protocol).toBe('https:');
      expect(signed.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(signed.searchParams.has('X-Amz-Signature')).toBe(true);
    }
    expect((await downloadRequest(assignment.id, ACTORS.studentB, storageKey)).status).toBe(404);
    expect((await downloadRequest(assignment.id, ACTORS.outsiderStudent, storageKey)).status).toBe(
      404
    );

    const stolenKey = `academic/course-a/${ACTORS.studentB.uid}/${assignment.id}/document/stolen.pdf`;
    const rejected = await citeFile(assignment.id, stolenKey);
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toEqual({
      error: 'La referencia del archivo no pertenece a esta entrega.',
    });

    const submissionId = submissionIdFor(assignment.id, ACTORS.studentA.uid);
    const persisted = await getPersistedSubmission(submissionId);
    expect(persisted?.stepEvidence.document?.data).toMatchObject({ storageKey });
  });
});
