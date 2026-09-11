import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/nexbooks/route';
import { PATCH as patchRoute } from '@/app/api/nexbooks/[nexbookId]/route';
import {
  DELETE as unpublishRoute,
  GET as publicationStatusRoute,
  PUT as publishRoute,
} from '@/app/api/nexbooks/[nexbookId]/publication/route';
import { GET as publicReadRoute } from '@/app/api/nexbooks/published/[slug]/route';
import { GET as listWorkspacesRoute } from '@/app/api/workspaces/route';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';
import type { NexBook, NexBookPublication, WorkspaceSummary } from '@/lib/types';

/**
 * Publicar un NexBook, contra DynamoDB Local.
 *
 * La garantía que se comprueba aquí es la que da sentido a todo el modelo:
 * publicar produce una COPIA CONGELADA. Seguir editando no cambia lo que se ve
 * fuera, y actualizarlo es una decisión explícita.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const params = (nexbookId: string) => ({ params: Promise.resolve({ nexbookId }) });

async function create(actor: Actor, title: string, source: string): Promise<NexBook> {
  const response = await createRoute(
    jsonRequestAs(actor, 'http://localhost/api/nexbooks', 'POST', {
      title,
      document: { blocks: [{ id: 'b1', type: 'code', language: 'python', source }] },
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()).nexbook as NexBook;
}

const publish = (actor: Actor, id: string, visibility: string) =>
  publishRoute(
    jsonRequestAs(actor, `http://localhost/api/nexbooks/${id}/publication`, 'PUT', { visibility }),
    params(id)
  );

const publicationStatus = (actor: Actor, id: string) =>
  publicationStatusRoute(
    requestAs(actor, `http://localhost/api/nexbooks/${id}/publication`),
    params(id)
  );

const unpublish = (actor: Actor, id: string) =>
  unpublishRoute(
    requestAs(actor, `http://localhost/api/nexbooks/${id}/publication`, { method: 'DELETE' }),
    params(id)
  );

/** La lectura pública NO lleva sesión: es un enlace que abre cualquiera. */
const readPublic = (slug: string) =>
  publicReadRoute(new Request(`http://localhost/api/nexbooks/published/${slug}`), {
    params: Promise.resolve({ slug }),
  });

const readPublicAs = (actor: Actor, slug: string) =>
  publicReadRoute(requestAs(actor, `http://localhost/api/nexbooks/published/${slug}`), {
    params: Promise.resolve({ slug }),
  });

beforeAll(createIntegrationTables, 60_000);
afterAll(deleteIntegrationTables, 60_000);
beforeEach(resetAndSeedIntegrationData, 60_000);

describe('publicar congela el documento', () => {
  it('lo publicado NO cambia cuando el original sigue', async () => {
    /**
     * LA prueba de esta iteración.
     *
     * Con un interruptor sobre el documento vivo, cada pulsación de teclado se
     * habría publicado: un experimento a medias o una nota personal quedan
     * expuestos sin que nadie lo decida.
     */
    const nexbook = await create(ACTORS.studentA, 'Regresión', 'print("v1")');

    const published = await publish(ACTORS.studentA, nexbook.id, 'link');
    expect(published.status).toBe(200);
    const { publication } = (await published.json()) as { publication: NexBookPublication };

    // El autor sigue trabajando.
    await patchRoute(
      jsonRequestAs(ACTORS.studentA, `http://localhost/api/nexbooks/${nexbook.id}`, 'PATCH', {
        revision: nexbook.revision,
        document: { blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'print("v2")' }] },
      }),
      params(nexbook.id)
    );

    const read = await readPublic(publication.slug);
    const fresh = (await read.json()).publication as NexBookPublication;
    const block = fresh.document.blocks[0];

    expect(block?.type === 'code' && block.source).toBe('print("v1")');
  });

  it('actualizar la publicación es una decisión EXPLÍCITA', async () => {
    const nexbook = await create(ACTORS.studentA, 'Regresión', 'print("v1")');
    const first = (await (await publish(ACTORS.studentA, nexbook.id, 'link')).json())
      .publication as NexBookPublication;

    await patchRoute(
      jsonRequestAs(ACTORS.studentA, `http://localhost/api/nexbooks/${nexbook.id}`, 'PATCH', {
        revision: nexbook.revision,
        document: { blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'print("v2")' }] },
      }),
      params(nexbook.id)
    );

    // Antes de actualizar, se DICE que hay cambios sin publicar.
    const status = await publicationStatus(ACTORS.studentA, nexbook.id);
    expect((await status.json()).hasChanges).toBe(true);

    await publish(ACTORS.studentA, nexbook.id, 'link');
    const updated = (await (await readPublic(first.slug)).json()).publication as NexBookPublication;
    const block = updated.document.blocks[0];

    expect(block?.type === 'code' && block.source).toBe('print("v2")');
    // La dirección no cambia al actualizar: un enlace repartido sigue sirviendo.
    expect(updated.slug).toBe(first.slug);
    // Y se conserva cuándo se publicó por primera vez.
    expect(updated.publishedAt).toBe(first.publishedAt);
    expect(updated.updatedAt).not.toBe(first.publishedAt);
  });
});

describe('qué sale en una publicación y qué no', () => {
  it('no lleva el uid de quien publica ni el id del documento vivo', async () => {
    /**
     * El segundo importa tanto como el primero: el id del documento vivo es la
     * dirección donde esa persona sigue editando, y publicar no puede filtrarla.
     */
    const nexbook = await create(ACTORS.studentA, 'Mi trabajo', 'print(1)');
    const { publication } = (await (await publish(ACTORS.studentA, nexbook.id, 'public')).json()) as {
      publication: NexBookPublication;
    };

    const serialized = JSON.stringify(publication);

    expect(serialized).not.toContain(ACTORS.studentA.uid);
    expect(serialized).not.toContain(nexbook.id);
    expect(serialized).not.toContain('ownerUid');
    expect(serialized).not.toContain('sourceNexbookId');
  });

  it('el nombre del autor sale, el correo no', async () => {
    const nexbook = await create(ACTORS.studentA, 'Mi trabajo', 'print(1)');
    const { publication } = (await (await publish(ACTORS.studentA, nexbook.id, 'public')).json()) as {
      publication: NexBookPublication;
    };

    expect(publication.authorName).toBeTruthy();
    expect(JSON.stringify(publication)).not.toContain('@');
  });
});

describe('quién puede leer una publicación', () => {
  it('`public` la abre cualquiera, sin sesión', async () => {
    const nexbook = await create(ACTORS.studentA, 'Abierto', 'print(1)');
    const { publication } = (await (await publish(ACTORS.studentA, nexbook.id, 'public')).json()) as {
      publication: NexBookPublication;
    };

    expect((await readPublic(publication.slug)).status).toBe(200);
  });

  it('`class` exige identidad, y sin ella responde 404 y no 401', async () => {
    /**
     * 404 y no 403: distinguir «no existe» de «no puedes verla» convertiría la
     * ruta en un oráculo de qué publicaciones existen. Es la misma regla que
     * rige todo el proyecto.
     */
    const nexbook = await create(ACTORS.studentA, 'De clase', 'print(1)');
    const { publication } = (await (await publish(ACTORS.studentA, nexbook.id, 'class')).json()) as {
      publication: NexBookPublication;
    };

    const anonymous = await readPublic(publication.slug);
    expect(anonymous.status).toBe(404);

    const identified = await readPublicAs(ACTORS.studentB, publication.slug);
    expect(identified.status).toBe(200);
  });

  it('una publicación que no existe da el MISMO 404', async () => {
    const missing = await readPublic('0123456789abcdef01234567');
    expect(missing.status).toBe(404);
  });
});

describe('publicar es del dueño, y sólo de documentos personales', () => {
  it('otra persona no puede publicar un NexBook ajeno', async () => {
    const nexbook = await create(ACTORS.studentA, 'Privado', 'print(1)');

    const response = await publish(ACTORS.studentB, nexbook.id, 'public');
    expect(response.status).toBe(404);
  });

  it('otra persona no puede retirar una publicación ajena', async () => {
    const nexbook = await create(ACTORS.studentA, 'Privado', 'print(1)');
    await publish(ACTORS.studentA, nexbook.id, 'public');

    const response = await unpublish(ACTORS.studentB, nexbook.id);
    expect(response.status).toBe(404);
  });

  it('retirar la publicación NO borra el documento', async () => {
    // Confundir las dos cosas en un botón sería la peor manera de descubrir la
    // diferencia.
    const nexbook = await create(ACTORS.studentA, 'Mi trabajo', 'print(1)');
    const { publication } = (await (await publish(ACTORS.studentA, nexbook.id, 'link')).json()) as {
      publication: NexBookPublication;
    };

    expect((await unpublish(ACTORS.studentA, nexbook.id)).status).toBe(200);
    expect((await readPublic(publication.slug)).status).toBe(404);

    const status = await publicationStatus(ACTORS.studentA, nexbook.id);
    expect(status.status).toBe(200);
    expect((await status.json()).publication).toBeNull();
  });
});

describe('las publicaciones no ensucian la lista de prácticas', () => {
  it('un NexBook publicado aparece UNA vez, no dos', async () => {
    /**
     * Comparten tabla con un `kind` distinto. Sin el filtro, cada documento
     * publicado saldría dos veces en Prácticas y borrar «el segundo» borraría la
     * publicación sin que nadie lo hubiera pedido.
     */
    const nexbook = await create(ACTORS.studentA, 'Único', 'print(1)');
    await publish(ACTORS.studentA, nexbook.id, 'public');

    const response = await listWorkspacesRoute(
      requestAs(ACTORS.studentA, 'http://localhost/api/workspaces')
    );
    const { workspaces } = (await response.json()) as { workspaces: WorkspaceSummary[] };

    expect(workspaces.filter((item) => item.id === nexbook.id)).toHaveLength(1);
    expect(workspaces).toHaveLength(1);
  });
});
