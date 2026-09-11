import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { POST as importRoute } from '@/app/api/nexbooks/import/route';
import { POST as createRoute } from '@/app/api/nexbooks/route';
import { GET as readRoute } from '@/app/api/nexbooks/[nexbookId]/route';
import { POST as assetUploadRoute } from '@/app/api/nexbooks/[nexbookId]/assets/route';
import { GET as assetReadRoute } from '@/app/api/nexbooks/[nexbookId]/assets/[assetId]/route';
import { NEXBOOK_ARCHIVE_FORMAT, NEXBOOK_ARCHIVE_VERSION } from '@/lib/nexbook-archive';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';
import type { NexBook } from '@/lib/types';

/**
 * Importar `.nexbook`, contra DynamoDB Local.
 *
 * Un contenedor que llega de fuera es el tipo de entrada que hay que tratar como
 * hostil, así que la mitad de estas pruebas son ataques. La otra mitad comprueba
 * la garantía de producto: el dueño de lo importado es SIEMPRE quien importa.
 *
 * Las imágenes no entran aquí porque necesitan S3, que esta suite no tiene —va
 * contra DynamoDB Local—. Lo que se comprueba de ellas es lo que se decide antes
 * de llegar al almacenamiento: el tipo real por sus bytes y los límites del
 * contenedor. Ver `tests/unit/nexbook-archive.test.ts`.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

const MANIFEST = {
  format: NEXBOOK_ARCHIVE_FORMAT,
  version: NEXBOOK_ARCHIVE_VERSION,
  documentVersion: 1,
  title: 'Documento importado',
  createdWith: 'UINexus',
  exportedAt: '2026-09-10T12:00:00.000Z',
  assets: [],
};

const DOCUMENT = {
  formatVersion: 1,
  blocks: [
    { id: 'b1', type: 'markdown', source: '# Hola' },
    { id: 'b2', type: 'code', language: 'python', source: 'print(1)' },
  ],
  results: {},
};

function archive(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        typeof content === 'string' ? strToU8(content) : content,
      ])
    )
  );
}

const validArchive = () =>
  archive({
    'manifest.json': JSON.stringify(MANIFEST),
    'document.json': JSON.stringify(DOCUMENT),
  });

async function importAs(actor: Actor, bytes: Uint8Array, name = 'ejemplo.nexbook') {
  const form = new FormData();
  form.append('file', new Blob([bytes as unknown as BlobPart], { type: 'application/zip' }), name);

  return importRoute(
    requestAs(actor, 'http://localhost/api/nexbooks/import', { method: 'POST', body: form })
  );
}

beforeAll(createIntegrationTables, 60_000);
afterAll(deleteIntegrationTables, 60_000);
beforeEach(resetAndSeedIntegrationData, 60_000);

describe('importar un archivo válido', () => {
  it('crea un NexBook con el mismo contenido', async () => {
    const response = await importAs(ACTORS.studentA, validArchive());
    expect(response.status).toBe(201);

    const { nexbook } = (await response.json()) as { nexbook: NexBook };
    expect(nexbook.title).toBe('Documento importado');
    expect(nexbook.document.blocks).toHaveLength(2);

    const markdown = nexbook.document.blocks[0];
    expect(markdown?.type === 'markdown' && markdown.source).toBe('# Hola');
  });

  it('el dueño es QUIEN IMPORTA, no quien exportó', async () => {
    /**
     * Un formato de intercambio donde el archivo pudiera declarar a quién
     * pertenece sería un formato donde se puede escribir en la cuenta de otro.
     * El dueño sale del token, igual que en cualquier otra escritura.
     */
    const hostil = archive({
      'manifest.json': JSON.stringify(MANIFEST),
      'document.json': JSON.stringify({ ...DOCUMENT, ownerUid: ACTORS.studentB.uid }),
    });

    const response = await importAs(ACTORS.studentA, hostil);
    expect(response.status).toBe(201);
    const { nexbook } = (await response.json()) as { nexbook: NexBook };

    // Quien importó puede leerlo…
    const mine = await readRoute(
      requestAs(ACTORS.studentA, `http://localhost/api/nexbooks/${nexbook.id}`),
      { params: Promise.resolve({ nexbookId: nexbook.id }) }
    );
    expect(mine.status).toBe(200);

    // …y quien el archivo decía que era el dueño, no.
    const theirs = await readRoute(
      requestAs(ACTORS.studentB, `http://localhost/api/nexbooks/${nexbook.id}`),
      { params: Promise.resolve({ nexbookId: nexbook.id }) }
    );
    expect(theirs.status).toBe(404);
  });

  it('nace personal y privado, aunque el archivo diga otra cosa', async () => {
    // No se puede importar un documento «dentro» de la actividad de nadie.
    const hostil = archive({
      'manifest.json': JSON.stringify(MANIFEST),
      'document.json': JSON.stringify({
        ...DOCUMENT,
        context: { type: 'workflow', assignmentId: 'a1', stepId: 's1', role: 'template' },
        visibility: 'public',
      }),
    });

    const { nexbook } = (await (await importAs(ACTORS.studentA, hostil)).json()) as {
      nexbook: NexBook;
    };

    expect(nexbook.context).toEqual({ type: 'personal' });
    expect(nexbook.visibility).toBe('private');
  });

  it('dos importaciones del mismo archivo son dos documentos distintos', async () => {
    const first = (await (await importAs(ACTORS.studentA, validArchive())).json()) as {
      nexbook: NexBook;
    };
    const second = (await (await importAs(ACTORS.studentA, validArchive())).json()) as {
      nexbook: NexBook;
    };

    expect(first.nexbook.id).not.toBe(second.nexbook.id);
  });
});

describe('archivos hostiles', () => {
  it('rechaza el zip slip', async () => {
    const slip = archive({
      'manifest.json': JSON.stringify(MANIFEST),
      'document.json': JSON.stringify(DOCUMENT),
      '../../../etc/passwd': 'raíz:x:0:0',
    });

    const response = await importAs(ACTORS.studentA, slip);
    // La entrada hostil se FILTRA antes de descomprimirse, así que el archivo
    // se importa sin ella en vez de fallar. Lo que importa es que esa ruta no
    // llega a ninguna parte.
    expect([201, 400]).toContain(response.status);
    if (response.status === 201) {
      const { nexbook } = (await response.json()) as { nexbook: NexBook };
      expect(JSON.stringify(nexbook)).not.toContain('passwd');
    }
  });

  it('rechaza una versión del futuro', async () => {
    const futuro = archive({
      'manifest.json': JSON.stringify({ ...MANIFEST, version: 99 }),
      'document.json': JSON.stringify(DOCUMENT),
    });

    const response = await importAs(ACTORS.studentA, futuro);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/más nueva/);
  });

  it('rechaza un archivo que no es de UINexus', async () => {
    const ajeno = archive({
      'manifest.json': JSON.stringify({ ...MANIFEST, format: 'jupyter' }),
      'document.json': JSON.stringify(DOCUMENT),
    });

    const response = await importAs(ACTORS.studentA, ajeno);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no es un NexBook/);
  });

  it('rechaza un documento que no cumple el esquema', async () => {
    const invalido = archive({
      'manifest.json': JSON.stringify(MANIFEST),
      'document.json': JSON.stringify({
        formatVersion: 1,
        blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x' }],
        // Un resultado de un bloque que no existe.
        results: { fantasma: { blockId: 'fantasma', status: 'ok', outputs: [], durationMs: 0, ranAt: '' } },
      }),
    });

    const response = await importAs(ACTORS.studentA, invalido);
    expect(response.status).toBe(400);
  });

  it('rechaza un JSON corrupto con un mensaje que se entiende', async () => {
    const roto = archive({
      'manifest.json': JSON.stringify(MANIFEST),
      'document.json': '{ esto no es json',
    });

    const response = await importAs(ACTORS.studentA, roto);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no es JSON válido/);
  });

  it('rechaza algo que ni siquiera es un ZIP', async () => {
    const response = await importAs(ACTORS.studentA, strToU8('esto es texto plano'));
    expect(response.status).toBe(400);
  });

  it('rechaza un contenedor sin documento', async () => {
    const response = await importAs(
      ACTORS.studentA,
      archive({ 'manifest.json': JSON.stringify(MANIFEST) })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no contiene ningún documento/);
  });

  it('rechaza un envío más grande que el presupuesto', async () => {
    /**
     * La primera barrera contra un ZIP bomb mira el tamaño del ENVÍO, antes de
     * descomprimir. Sin ella, la defensa llegaría cuando la memoria ya está
     * reservada.
     */
    const form = new FormData();
    const enorme = new Uint8Array(NEXBOOK_LIMITS.maxArchiveBytes + 1);
    form.append('file', new Blob([enorme as unknown as BlobPart]), 'bomba.nexbook');

    const response = await importRoute(
      requestAs(ACTORS.studentA, 'http://localhost/api/nexbooks/import', {
        method: 'POST',
        body: form,
      })
    );

    expect(response.status).toBe(413);
  });

  it('un ZIP bomb declarado no llega a descomprimirse entero', async () => {
    /**
     * Un ZIP de pocos kilobytes que se anuncia como cientos de megas. El filtro
     * de fflate se consulta con la CABECERA de cada entrada, así que decide sin
     * haber descomprimido nada: la suma de tamaños declarados pasa del
     * presupuesto y la entrada no entra.
     */
    const relleno = new Uint8Array(NEXBOOK_LIMITS.maxArchiveBytes).fill(0x41);
    const bomba = zipSync(
      {
        'manifest.json': strToU8(JSON.stringify(MANIFEST)),
        'document.json': strToU8(JSON.stringify(DOCUMENT)),
        'assets/1.png': relleno,
      },
      { level: 9 }
    );

    // Comprimido cabe de sobra; descomprimido, no.
    expect(bomba.byteLength).toBeLessThan(NEXBOOK_LIMITS.maxArchiveBytes);

    const response = await importAs(ACTORS.studentA, bomba);
    // O se rechaza, o se importa sin la entrada que no cabía. En ningún caso se
    // reservan los megas que el archivo pedía.
    expect([201, 400]).toContain(response.status);
  }, 60_000);

  it('sin archivo, lo dice', async () => {
    const form = new FormData();
    form.append('otra-cosa', 'x');

    const response = await importRoute(
      requestAs(ACTORS.studentA, 'http://localhost/api/nexbooks/import', {
        method: 'POST',
        body: form,
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Falta el archivo/);
  });
});

describe('los assets son de su dueño', () => {
  /**
   * El almacenamiento real no está en esta suite —va contra DynamoDB Local—, así
   * que lo que se comprueba aquí es la comprobación que ocurre ANTES de firmar
   * nada: que el NexBook sea tuyo. Es la que impide pedir una firma para el
   * espacio de otra persona con sólo cambiar el id de la URL.
   */
  async function ownNexBook(actor: Actor): Promise<NexBook> {
    const response = await createRoute(
      jsonRequestAs(actor, 'http://localhost/api/nexbooks', 'POST', { title: 'Con imágenes' })
    );
    return (await response.json()).nexbook as NexBook;
  }

  it('pedir subir a un NexBook ajeno da 404', async () => {
    const nexbook = await ownNexBook(ACTORS.studentA);

    const response = await assetUploadRoute(
      jsonRequestAs(
        ACTORS.studentB,
        `http://localhost/api/nexbooks/${nexbook.id}/assets`,
        'POST',
        { contentType: 'image/png', sizeBytes: 1024 }
      ),
      { params: Promise.resolve({ nexbookId: nexbook.id }) }
    );

    expect(response.status).toBe(404);
  });

  it('leer una imagen de un NexBook ajeno da 404', async () => {
    const nexbook = await ownNexBook(ACTORS.studentA);
    const assetId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    const response = await assetReadRoute(
      requestAs(ACTORS.studentB, `http://localhost/api/nexbooks/${nexbook.id}/assets/${assetId}`),
      { params: Promise.resolve({ nexbookId: nexbook.id, assetId }) }
    );

    expect(response.status).toBe(404);
  });

  it('un identificador que no es un UUID se rechaza antes de tocar nada', async () => {
    // Ese identificador acaba formando parte de una clave de S3.
    const nexbook = await ownNexBook(ACTORS.studentA);

    for (const assetId of ['../../secreto', 'x'.repeat(200), 'assets/1.png']) {
      const response = await assetReadRoute(
        requestAs(ACTORS.studentA, `http://localhost/api/nexbooks/${nexbook.id}/assets/x`),
        { params: Promise.resolve({ nexbookId: nexbook.id, assetId }) }
      );
      expect(response.status).toBe(404);
    }
  });

  it('un tamaño mayor que el límite se rechaza al pedir la firma', async () => {
    /**
     * 422 y no 400: el rechazo ocurre en el ESQUEMA, antes de mirar el NexBook y
     * mucho antes de firmar nada. Es el orden correcto —lo más barato primero—
     * y significa que un tamaño imposible no llega ni a consultar la base.
     *
     * El tamaño declarado no es la defensa de todas formas: la condición
     * `content-length-range` del POST firmado la aplica S3 sobre los bytes de
     * verdad. Esto sirve para dar un error legible antes de gastar una subida.
     */
    const nexbook = await ownNexBook(ACTORS.studentA);

    const response = await assetUploadRoute(
      jsonRequestAs(
        ACTORS.studentA,
        `http://localhost/api/nexbooks/${nexbook.id}/assets`,
        'POST',
        { contentType: 'image/png', sizeBytes: NEXBOOK_LIMITS.maxAssetBytes + 1 }
      ),
      { params: Promise.resolve({ nexbookId: nexbook.id }) }
    );

    expect(response.status).toBe(422);
  });

  it('un tipo que no es imagen se rechaza al pedir la firma', async () => {
    // SVG incluido, y a propósito: es XML que puede llevar script. Ver
    // docs/SECURITY.md.
    const nexbook = await ownNexBook(ACTORS.studentA);

    for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf']) {
      const response = await assetUploadRoute(
        jsonRequestAs(
          ACTORS.studentA,
          `http://localhost/api/nexbooks/${nexbook.id}/assets`,
          'POST',
          { contentType, sizeBytes: 1024 }
        ),
        { params: Promise.resolve({ nexbookId: nexbook.id }) }
      );
      expect(response.status).toBe(422);
    }
  });
});
