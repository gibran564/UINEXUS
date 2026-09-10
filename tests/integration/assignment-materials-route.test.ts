import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { GET as readAssignmentRoute } from '@/app/api/assignments/[assignmentId]/route';
import {
  DELETE as deleteMaterialRoute,
  GET as readMaterialsRoute,
  PATCH as patchMaterialRoute,
  POST as requestMaterialUploadRoute,
  PUT as confirmMaterialRoute,
} from '@/app/api/assignments/[assignmentId]/materials/route';
import { ACADEMIC_FILE_LIMITS } from '@/lib/constants';
import type { Assignment, AssignmentMaterial } from '@/lib/types';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  INTEGRATION_TABLES,
  createIntegrationTables,
  deleteIntegrationTables,
  getPersistedAssignment,
  putIntegrationItems,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * Los archivos que el profesorado reparte con la tarea.
 *
 * Las dos preguntas de autorización son OPUESTAS a las de una entrega y por eso
 * la ruta es otra: escribir es sólo del profesorado de la materia; leer, de
 * cualquiera que tenga la tarea. Lo que se prueba aquí es que ninguna de las dos
 * se puede saltar, y que la clave que se registra tiene que ser una que este
 * servidor emitió para ESTA tarea.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

async function createAssignment(): Promise<Assignment> {
  const response = await createAssignmentRoute(
    jsonRequestAs(
      ACTORS.teacherA,
      'http://localhost/api/courses/course-a/assignments',
      'POST',
      {
        title: 'Programación lineal / Simplex',
        type: 'workflow',
        status: 'published',
        workflow: [
          {
            id: 'desarrollo',
            title: 'Desarrollo',
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

function requestUpload(
  assignmentId: string,
  actor: Actor,
  overrides: Record<string, unknown> = {}
): Promise<Response> {
  return requestMaterialUploadRoute(
    jsonRequestAs(
      actor,
      `http://localhost/api/assignments/${assignmentId}/materials`,
      'POST',
      { fileName: 'Datos del problema.xlsx', contentType: '', sizeBytes: 4096, ...overrides }
    ),
    { params: Promise.resolve({ assignmentId }) }
  );
}

function confirm(
  assignmentId: string,
  actor: Actor,
  body: Record<string, unknown>
): Promise<Response> {
  return confirmMaterialRoute(
    jsonRequestAs(actor, `http://localhost/api/assignments/${assignmentId}/materials`, 'PUT', body),
    { params: Promise.resolve({ assignmentId }) }
  );
}

/** Sube y registra un material, devolviendo el que quedó guardado. */
async function attach(
  assignmentId: string,
  overrides: Record<string, unknown> = {}
): Promise<AssignmentMaterial> {
  const upload = await requestUpload(assignmentId, ACTORS.teacherA, overrides);
  expect(upload.status).toBe(200);
  const { storageKey } = await upload.json();

  const confirmed = await confirm(assignmentId, ACTORS.teacherA, {
    storageKey,
    fileName: (overrides.fileName as string) ?? 'Datos del problema.xlsx',
    displayName: 'Datos del problema',
    kind: 'resource',
    sizeBytes: 4096,
  });
  expect(confirmed.status).toBe(201);

  const { materials } = (await confirmed.json()) as { materials: AssignmentMaterial[] };
  return materials.at(-1)!;
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('subir un material', () => {
  it('el docente de la materia obtiene un POST firmado acotado a la tarea', async () => {
    const assignment = await createAssignment();
    const response = await requestUpload(assignment.id, ACTORS.teacherA);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.storageKey).toMatch(
      new RegExp(`^academic/materials/course-a/${assignment.id}/[\\w-]+\\.xlsx$`)
    );
    expect(body.upload.fields.key).toBe(body.storageKey);
    expect(body.upload.fields['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const policy = JSON.parse(Buffer.from(body.upload.fields.Policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual([
      'content-length-range',
      0,
      ACADEMIC_FILE_LIMITS.material,
    ]);
  });

  it('admite un ejemplo en R aunque el navegador no diga qué tipo es', async () => {
    const assignment = await createAssignment();
    const response = await requestUpload(assignment.id, ACTORS.teacherA, {
      fileName: 'ejemplo.R',
      contentType: 'application/octet-stream',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.storageKey).toMatch(/\.r$/);
    expect(body.contentType).toBe('text/plain');
  });

  it('el alumnado NO puede crear materiales del profesorado', async () => {
    const assignment = await createAssignment();
    expect((await requestUpload(assignment.id, ACTORS.studentA)).status).toBe(404);
    expect((await requestUpload(assignment.id, ACTORS.studentB)).status).toBe(404);
  });

  it('un docente de OTRA materia tampoco', async () => {
    const assignment = await createAssignment();
    expect((await requestUpload(assignment.id, ACTORS.teacherB)).status).toBe(404);
  });

  it('rechaza tipos no admitidos y tamaños fuera de límite', async () => {
    const assignment = await createAssignment();

    const executable = await requestUpload(assignment.id, ACTORS.teacherA, {
      fileName: 'instalador.exe',
    });
    expect(executable.status).toBe(422);
    expect((await executable.json()).error).toContain('no se admite');

    const activeContent = await requestUpload(assignment.id, ACTORS.teacherA, {
      fileName: 'pagina.html',
      contentType: 'text/html',
    });
    expect(activeContent.status).toBe(422);

    const oversized = await requestUpload(assignment.id, ACTORS.teacherA, {
      sizeBytes: ACADEMIC_FILE_LIMITS.material + 1,
    });
    expect(oversized.status).toBe(422);
    expect((await oversized.json()).error).toContain('25 MB');
  });
});

describe('registrar el archivo subido', () => {
  it('queda en la tarea con su clase y su nombre visible', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    expect(material).toMatchObject({
      kind: 'resource',
      displayName: 'Datos del problema',
      fileName: 'Datos del problema.xlsx',
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.materials).toHaveLength(1);
    // El UID de quien lo subió se guarda, pero no sale en la respuesta.
    expect(persisted?.materials[0]?.uploadedBy).toBe(ACTORS.teacherA.uid);
    expect(JSON.stringify(material)).not.toContain(ACTORS.teacherA.uid);
  });

  it('NO acepta una clave arbitraria', async () => {
    const assignment = await createAssignment();

    // De otra tarea, de otra materia, del espacio de entregas y de fuera.
    const foreign = [
      `academic/materials/course-a/otra-tarea/robado.pdf`,
      `academic/materials/course-b/${assignment.id}/robado.pdf`,
      `academic/course-a/${ACTORS.studentA.uid}/${assignment.id}/desarrollo/entrega.pdf`,
      'projects/otro/uid/v1/index.html',
    ];

    for (const storageKey of foreign) {
      const response = await confirm(assignment.id, ACTORS.teacherA, {
        storageKey,
        fileName: 'robado.pdf',
      });
      expect([422], storageKey).toContain(response.status);
    }

    expect((await getPersistedAssignment(assignment.id))?.materials).toEqual([]);
  });

  it('el alumnado no puede registrar nada', async () => {
    const assignment = await createAssignment();
    const upload = await requestUpload(assignment.id, ACTORS.teacherA);
    const { storageKey } = await upload.json();

    const response = await confirm(assignment.id, ACTORS.studentA, {
      storageKey,
      fileName: 'Datos.xlsx',
    });
    expect(response.status).toBe(404);
  });

  it('no se registra dos veces el mismo archivo', async () => {
    const assignment = await createAssignment();
    const upload = await requestUpload(assignment.id, ACTORS.teacherA);
    const { storageKey } = await upload.json();

    const body = { storageKey, fileName: 'Datos.xlsx', sizeBytes: 4096 };
    expect((await confirm(assignment.id, ACTORS.teacherA, body)).status).toBe(201);
    expect((await confirm(assignment.id, ACTORS.teacherA, body)).status).toBe(409);
  });

  it('el tamaño declarado se acota al límite de la clase', async () => {
    const assignment = await createAssignment();
    const upload = await requestUpload(assignment.id, ACTORS.teacherA);
    const { storageKey } = await upload.json();

    await confirm(assignment.id, ACTORS.teacherA, {
      storageKey,
      fileName: 'Datos.xlsx',
      sizeBytes: 999_999_999,
    });

    const persisted = await getPersistedAssignment(assignment.id);
    expect(persisted?.materials[0]?.sizeBytes).toBe(ACADEMIC_FILE_LIMITS.material);
  });
});

describe('descargar un material', () => {
  it('el alumnado matriculado obtiene una URL firmada de corta duración', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    for (const actor of [ACTORS.studentA, ACTORS.studentB, ACTORS.teacherA]) {
      const response = await readMaterialsRoute(
        requestAs(
          actor,
          `http://localhost/api/assignments/${assignment.id}/materials?id=${material.id}`
        ),
        { params: Promise.resolve({ assignmentId: assignment.id }) }
      );

      expect(response.status, actor.token).toBe(200);
      const signed = new URL((await response.json()).url);
      expect(signed.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(signed.searchParams.has('X-Amz-Signature')).toBe(true);
    }
  });

  it('alguien ajeno a la materia NO puede descargarlo', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    for (const actor of [ACTORS.outsiderStudent, ACTORS.teacherB]) {
      const response = await readMaterialsRoute(
        requestAs(
          actor,
          `http://localhost/api/assignments/${assignment.id}/materials?id=${material.id}`
        ),
        { params: Promise.resolve({ assignmentId: assignment.id }) }
      );
      expect(response.status, actor.token).toBe(404);
    }
  });

  it('un identificador que no está en la tarea no firma nada', async () => {
    const assignment = await createAssignment();
    await attach(assignment.id);

    const response = await readMaterialsRoute(
      requestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/materials?id=inventado`
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(response.status).toBe(404);
  });
});

describe('editar y quitar materiales', () => {
  it('el docente renombra y cambia la clase sin tocar el archivo', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    const response = await patchMaterialRoute(
      jsonRequestAs(
        ACTORS.teacherA,
        `http://localhost/api/assignments/${assignment.id}/materials`,
        'PATCH',
        { id: material.id, displayName: 'Plantilla del reporte', kind: 'template' }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(200);
    const { materials } = await response.json();
    expect(materials[0]).toMatchObject({
      displayName: 'Plantilla del reporte',
      kind: 'template',
      storageKey: material.storageKey,
    });
  });

  it('el alumnado no puede renombrar ni eliminar', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    const renamed = await patchMaterialRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/materials`,
        'PATCH',
        { id: material.id, displayName: 'Mío' }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(renamed.status).toBe(404);

    const removed = await deleteMaterialRoute(
      requestAs(
        ACTORS.studentA,
        `http://localhost/api/assignments/${assignment.id}/materials?id=${material.id}`
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );
    expect(removed.status).toBe(404);

    expect((await getPersistedAssignment(assignment.id))?.materials).toHaveLength(1);
  });

  it('el docente lo quita de la tarea', async () => {
    const assignment = await createAssignment();
    const material = await attach(assignment.id);

    const response = await deleteMaterialRoute(
      requestAs(
        ACTORS.teacherA,
        `http://localhost/api/assignments/${assignment.id}/materials?id=${material.id}`
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).materials).toEqual([]);
    expect((await getPersistedAssignment(assignment.id))?.materials).toEqual([]);
  });
});

describe('compatibilidad con lo que ya estaba guardado', () => {
  it('una tarea SIN el campo `materials` se lee y se usa con normalidad', async () => {
    /**
     * Es el caso de todas las tareas creadas antes de esta iteración. Se
     * escribe el registro a mano, sin el campo, que es exactamente como están
     * en producción.
     */
    await putIntegrationItems(INTEGRATION_TABLES.assignments, [
      {
        id: 'legacy-1',
        courseId: 'course-a',
        title: 'Tarea de antes',
        description: '',
        instructions: '',
        type: 'freeform',
        resourceLinks: [],
        researchQuestions: [],
        dueDate: null,
        assignedTo: null,
        status: 'published',
        createdBy: ACTORS.teacherA.uid,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    const read = await readAssignmentRoute(
      requestAs(ACTORS.studentA, 'http://localhost/api/assignments/legacy-1'),
      { params: Promise.resolve({ assignmentId: 'legacy-1' }) }
    );

    expect(read.status).toBe(200);
    expect((await read.json()).assignment.materials).toEqual([]);

    // Y se le puede adjuntar uno sin migrar nada.
    const material = await attach('legacy-1');
    expect(material.displayName).toBe('Datos del problema');
  });

  it('editar la tarea NO borra sus materiales', async () => {
    // Los materiales no viajan en el cuerpo de la tarea: se escriben aparte,
    // así que cambiar el enunciado no puede llevárselos por delante.
    const assignment = await createAssignment();
    await attach(assignment.id);

    const { PATCH: updateAssignmentRoute } = await import(
      '@/app/api/assignments/[assignmentId]/route'
    );

    const updated = await updateAssignmentRoute(
      jsonRequestAs(
        ACTORS.teacherA,
        `http://localhost/api/assignments/${assignment.id}`,
        'PATCH',
        {
          title: 'Programación lineal (corregida)',
          type: 'workflow',
          status: 'published',
          workflow: [
            { id: 'desarrollo', title: 'Desarrollo', deliverables: [{ type: 'file' }] },
          ],
        }
      ),
      { params: Promise.resolve({ assignmentId: assignment.id }) }
    );

    expect(updated.status).toBe(200);
    expect((await updated.json()).assignment.materials).toHaveLength(1);
    expect((await getPersistedAssignment(assignment.id))?.materials).toHaveLength(1);
  });
});
