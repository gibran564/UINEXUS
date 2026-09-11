import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/workspaces/route';
import {
  DELETE as deleteRoute,
  GET as readRoute,
  PATCH as patchRoute,
} from '@/app/api/workspaces/[workspaceId]/route';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';
import type { Workspace } from '@/lib/types';

/**
 * Prácticas de programación, contra DynamoDB Local.
 *
 * Lo que de verdad importa aquí es UNA cosa: una práctica es de quien la
 * escribió y de nadie más. El esquema ya impide que el dueño viaje en el cuerpo
 * (ver `tests/unit/workspace.test.ts`), pero eso sólo prueba que no se puede
 * PEDIR; esto prueba que tampoco se puede conseguir por otra vía —adivinando el
 * id—, que es la única forma que quedaba.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });

async function create(actor: Actor, body: Record<string, unknown>): Promise<Workspace> {
  const response = await createRoute(
    jsonRequestAs(actor, 'http://localhost/api/workspaces', 'POST', body)
  );
  expect(response.status).toBe(201);
  return (await response.json()).workspace as Workspace;
}

const list = (actor: Actor) => listRoute(requestAs(actor, 'http://localhost/api/workspaces'));

const read = (actor: Actor, id: string) =>
  readRoute(requestAs(actor, `http://localhost/api/workspaces/${id}`), params(id));

const patch = (actor: Actor, id: string, body: Record<string, unknown>) =>
  patchRoute(
    jsonRequestAs(actor, `http://localhost/api/workspaces/${id}`, 'PATCH', body),
    params(id)
  );

const remove = (actor: Actor, id: string) =>
  deleteRoute(
    requestAs(actor, `http://localhost/api/workspaces/${id}`, { method: 'DELETE' }),
    params(id)
  );

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('crear y abrir una práctica', () => {
  it('se crea, se lee y no expone el uid del dueño', async () => {
    const workspace = await create(ACTORS.studentA, {
      title: 'Método simplex',
      language: 'python',
      code: 'print(2 + 2)',
    });

    expect(workspace).toMatchObject({
      title: 'Método simplex',
      language: 'python',
      code: 'print(2 + 2)',
      context: 'personal',
      courseId: null,
    });
    expect(JSON.stringify(workspace)).not.toContain(ACTORS.studentA.uid);

    const reopened = await read(ACTORS.studentA, workspace.id);
    expect(reopened.status).toBe(200);
    expect(((await reopened.json()).workspace as Workspace).code).toBe('print(2 + 2)');
  });

  it('el cuerpo no puede decidir de quién es la práctica', async () => {
    // Se manda el uid de OTRA persona a propósito. Debe ignorarse: el dueño lo
    // decide el token, no el cuerpo.
    const workspace = await create(ACTORS.studentA, {
      title: 'Intento',
      ownerUid: ACTORS.studentB.uid,
      context: 'activity',
    });

    expect(workspace.context).toBe('personal');
    // Y sigue siendo de quien la creó: B no la ve.
    expect((await read(ACTORS.studentB, workspace.id)).status).toBe(404);
    expect((await read(ACTORS.studentA, workspace.id)).status).toBe(200);
  });

  it('un lenguaje sin ejecución también se puede crear y guardar', async () => {
    // Java se escribe aquí aunque no se compile aquí. Impedir crearla sería
    // convertir «no puedo ejecutarlo» en «no puedo practicarlo».
    const workspace = await create(ACTORS.studentA, {
      title: 'Árbol binario',
      language: 'java',
      code: 'class Main {}',
    });

    expect(workspace.language).toBe('java');
    expect((await patch(ACTORS.studentA, workspace.id, { code: 'class Main { }' })).status).toBe(200);
  });

  it('rechaza una práctica sin nombre', async () => {
    const response = await createRoute(
      jsonRequestAs(ACTORS.studentA, 'http://localhost/api/workspaces', 'POST', { title: '  ' })
    );
    expect(response.status).toBe(422);
  });
});

describe('las prácticas son privadas', () => {
  it('la lista sólo trae las propias', async () => {
    await create(ACTORS.studentA, { title: 'De A' });
    await create(ACTORS.studentB, { title: 'De B' });

    const response = await list(ACTORS.studentA);
    expect(response.status).toBe(200);
    const { workspaces } = (await response.json()) as { workspaces: Workspace[] };

    expect(workspaces.map((item) => item.title)).toEqual(['De A']);
  });

  it('conocer el id NO sirve para leer la de otro', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Privada' });

    // Ni un compañero de la misma materia, ni el profesorado, ni alguien de
    // fuera. Una práctica no se revisa: no hay ningún rol que la abra.
    for (const actor of [ACTORS.studentB, ACTORS.teacherA, ACTORS.outsiderStudent]) {
      expect((await read(actor, workspace.id)).status, actor.token).toBe(404);
    }
  });

  it('tampoco sirve para escribirla ni para borrarla', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Privada', code: 'original' });

    expect((await patch(ACTORS.studentB, workspace.id, { code: 'inyectado' })).status).toBe(404);
    expect((await remove(ACTORS.teacherA, workspace.id)).status).toBe(404);

    // Y sigue intacta para su dueño: el intento no dejó rastro.
    const reopened = await read(ACTORS.studentA, workspace.id);
    expect(((await reopened.json()).workspace as Workspace).code).toBe('original');
  });

  it('«no existe» y «no es tuya» se responden igual', async () => {
    // Distinguirlas convertiría la ruta en un oráculo: probando ids se sabría
    // qué prácticas existen aunque no se pudieran leer.
    const workspace = await create(ACTORS.studentA, { title: 'Privada' });

    const ajena = await read(ACTORS.studentB, workspace.id);
    const inexistente = await read(ACTORS.studentB, 'ws-que-no-existe');

    expect(ajena.status).toBe(inexistente.status);
    await expect(ajena.json()).resolves.toEqual(await inexistente.json());
  });

  it('sin sesión no se llega a ninguna parte', async () => {
    const response = await listRoute(new Request('http://localhost/api/workspaces'));
    expect(response.status).toBe(401);
  });
});

describe('guardar mientras se escribe', () => {
  it('el autoguardado manda sólo el código y no borra el resto', async () => {
    const workspace = await create(ACTORS.studentA, {
      title: 'Método simplex',
      language: 'r',
      code: 'cat(1)',
    });

    const response = await patch(ACTORS.studentA, workspace.id, { code: 'cat(2 + 2)' });
    expect(response.status).toBe(200);

    const saved = (await response.json()).workspace as Workspace;
    expect(saved.code).toBe('cat(2 + 2)');
    // Lo que no se mandó no se toca. Un `Put` completo habría borrado las dos.
    expect(saved.title).toBe('Método simplex');
    expect(saved.language).toBe('r');
  });

  it('`createdAt` no se puede reescribir desde el cliente', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Fechas' });

    await patch(ACTORS.studentA, workspace.id, {
      code: 'x',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    const reopened = (await (await read(ACTORS.studentA, workspace.id)).json())
      .workspace as Workspace;
    expect(reopened.createdAt).toBe(workspace.createdAt);
  });

  it('guardar actualiza `updatedAt` y reordena la lista', async () => {
    const first = await create(ACTORS.studentA, { title: 'Primera' });
    const second = await create(ACTORS.studentA, { title: 'Segunda' });

    // Al crearlas, la última es la primera de la lista.
    const initial = (await (await list(ACTORS.studentA)).json()) as { workspaces: Workspace[] };
    expect(initial.workspaces.map((item) => item.title)).toEqual(['Segunda', 'Primera']);

    await patch(ACTORS.studentA, first.id, { code: 'tocada' });

    // Tocar la primera la sube: la lista se lee «lo último que toqué primero».
    const after = (await (await list(ACTORS.studentA)).json()) as { workspaces: Workspace[] };
    expect(after.workspaces.map((item) => item.title)).toEqual(['Primera', 'Segunda']);
    expect(after.workspaces[0]!.updatedAt >= second.updatedAt).toBe(true);
  });

  it('rechaza un cuerpo que no cambia nada', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Nada' });
    expect((await patch(ACTORS.studentA, workspace.id, {})).status).toBe(422);
  });

  it('rechaza un código por encima del límite', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Límite' });
    const response = await patch(ACTORS.studentA, workspace.id, { code: 'x'.repeat(60_001) });

    expect(response.status).toBe(422);
  });
});

describe('borrar una práctica', () => {
  it('la quita de la lista de su dueño', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Temporal' });

    expect((await remove(ACTORS.studentA, workspace.id)).status).toBe(200);
    expect((await read(ACTORS.studentA, workspace.id)).status).toBe(404);

    const { workspaces } = (await (await list(ACTORS.studentA)).json()) as {
      workspaces: Workspace[];
    };
    expect(workspaces).toEqual([]);
  });

  it('borrar dos veces no finge que funcionó', async () => {
    const workspace = await create(ACTORS.studentA, { title: 'Temporal' });

    expect((await remove(ACTORS.studentA, workspace.id)).status).toBe(200);
    expect((await remove(ACTORS.studentA, workspace.id)).status).toBe(404);
  });
});
