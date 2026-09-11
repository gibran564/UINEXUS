import { describe, expect, it } from 'vitest';
import { nexBookDocumentSchema } from '../../src/lib/academic-schemas';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import { NEXBOOK_FORMAT_VERSION } from '../../src/lib/types';
import {
  collectAssetIds,
  imageMimeTypeFor,
  pruneOrphanResults,
  withoutResult,
  withoutResults,
} from '../../src/lib/nexbook-document';
import { publishableDocument } from '../../src/lib/nexbook-publish';
import type { NexBookDocument } from '../../src/lib/types';

/**
 * Las salidas ricas.
 *
 * La decisión que estas pruebas protegen es que los tipos nuevos entraron como
 * valores NUEVOS de `stream`, y no como una forma distinta de output. Eso es lo
 * que permite que un documento guardado en la iteración 8 se siga leyendo sin
 * migración y que `NEXBOOK_FORMAT_VERSION` siga siendo 1.
 */

const ASSET = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_ASSET = '0b1d4c3a-1111-4222-8333-444455556666';

function documentWith(outputs: unknown[]): unknown {
  return {
    blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x' }],
    results: {
      b1: { blockId: 'b1', status: 'ok', outputs, durationMs: 3, ranAt: '' },
    },
  };
}

describe('compatibilidad con los documentos de la iteración 8', () => {
  it('un documento con sólo stdout y stderr sigue validando sin tocar nada', () => {
    /**
     * Ésta es LA prueba de compatibilidad de la iteración.
     *
     * Si cambiar el modelo de outputs hubiera exigido un discriminante nuevo,
     * cada `results` almacenado, cada snapshot de entrega y cada export habría
     * necesitado migración. Extender `stream` en vez de sustituirlo es lo que
     * hace que este documento —escrito con el modelo viejo— siga siendo válido.
     */
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([
        { seq: 0, stream: 'stdout', text: 'hola\n' },
        { seq: 1, stream: 'stderr', text: 'aviso\n' },
        { seq: 2, stream: 'error', text: 'NameError\n' },
      ])
    );

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.results.b1?.outputs).toHaveLength(3);
  });

  it('la versión del formato NO sube por añadir tipos de salida', () => {
    // Un número de versión que sube sin que cambie nada obliga a escribir una
    // migración vacía y a mantenerla para siempre.
    expect(NEXBOOK_FORMAT_VERSION).toBe(1);
  });
});

describe('los tipos de salida nuevos', () => {
  it('acepta una tabla estructurada', () => {
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([
        {
          seq: 0,
          stream: 'table',
          columns: ['ciudad', 'habitantes'],
          rows: [
            ['Durango', 654_876],
            ['Gómez Palacio', 387_000],
          ],
          totalRows: 2,
        },
      ])
    );

    expect(parsed.success).toBe(true);
  });

  it('una tabla dice cuántas filas había, aunque enseñe menos', () => {
    // Enseñar 50 de 10 000 sin decirlo es una mentira sobre los datos.
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([
        { seq: 0, stream: 'table', columns: ['n'], rows: [[1]], totalRows: 10_000, truncated: true },
      ])
    );

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const output = parsed.data.results.b1?.outputs[0];
      expect(output?.stream === 'table' && output.totalRows).toBe(10_000);
    }
  });

  it('rechaza una tabla con más filas de las que se guardan', () => {
    const rows = Array.from({ length: NEXBOOK_LIMITS.maxTableRows + 1 }, (_, index) => [index]);
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([{ seq: 0, stream: 'table', columns: ['n'], rows, totalRows: rows.length }])
    );

    expect(parsed.success).toBe(false);
  });

  it('una imagen viaja por REFERENCIA y nunca como Base64', () => {
    /**
     * Es la decisión que protege el presupuesto del documento. Una gráfica de
     * 30 KB en Base64 son 40 KB de los 300 KB del item: tres gráficas y el
     * documento deja de poder guardarse.
     */
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([{ seq: 0, stream: 'image', assetId: ASSET, mimeType: 'image/png' }])
    );

    expect(parsed.success).toBe(true);
  });

  it('rechaza una imagen cuyo identificador no es un UUID del servidor', () => {
    // Ese identificador acaba formando parte de una clave de S3. Una cadena
    // libre del cliente dentro de una ruta es la forma clásica de escribir
    // donde no se debe.
    for (const assetId of ['../../secreto', 'assets/1.png', '', 'a'.repeat(64)]) {
      const parsed = nexBookDocumentSchema.safeParse(
        documentWith([{ seq: 0, stream: 'image', assetId, mimeType: 'image/png' }])
      );
      expect(parsed.success).toBe(false);
    }
  });

  it('rechaza un tipo de imagen que no está en la lista blanca', () => {
    // SVG queda fuera a propósito: es XML que puede llevar script. Ver
    // docs/SECURITY.md.
    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([{ seq: 0, stream: 'image', assetId: ASSET, mimeType: 'image/svg+xml' }])
    );

    expect(parsed.success).toBe(false);
  });

  it('un valor JSON con demasiada profundidad no pasa', () => {
    // Sin tope, quien se queda sin pila no es quien escribió la estructura sino
    // el servidor que la valida.
    let deep: unknown = 'fondo';
    for (let level = 0; level < 12; level += 1) deep = { nivel: deep };

    const parsed = nexBookDocumentSchema.safeParse(
      documentWith([{ seq: 0, stream: 'json', value: deep }])
    );

    expect(parsed.success).toBe(false);
  });
});

describe('los assets que un documento referencia', () => {
  const document: NexBookDocument = {
    formatVersion: 1,
    blocks: [
      { id: 'b1', type: 'image', assetId: ASSET, mimeType: 'image/webp', alt: 'un mapa' },
      { id: 'b2', type: 'code', language: 'python', source: 'plot()' },
    ],
    results: {
      b2: {
        blockId: 'b2',
        status: 'ok',
        outputs: [{ seq: 0, stream: 'image', assetId: OTHER_ASSET, mimeType: 'image/png' }],
        durationMs: 1,
        ranAt: '',
      },
    },
  };

  it('recorre bloques Y resultados', () => {
    /**
     * Es la base de la autorización de lectura, así que quedarse corta tiene
     * consecuencias: si olvidara los outputs, las gráficas de una publicación
     * darían 404 y nadie sabría por qué.
     */
    expect(collectAssetIds(document).sort()).toEqual([OTHER_ASSET, ASSET].sort());
  });

  it('el tipo de una imagen sale del DOCUMENTO, no de quien pregunta', () => {
    expect(imageMimeTypeFor(document, ASSET)).toBe('image/webp');
    expect(imageMimeTypeFor(document, OTHER_ASSET)).toBe('image/png');
  });

  it('un asset que el documento ya no menciona deja de resolverse', () => {
    // Es la comprobación de pertenencia: un asset huérfano no lo lee nadie,
    // aunque sus bytes sigan en el bucket.
    expect(imageMimeTypeFor(document, '11111111-2222-4333-8444-555555555555')).toBeNull();
  });
});

describe('limpiar salidas', () => {
  const document: NexBookDocument = {
    formatVersion: 1,
    blocks: [
      { id: 'b1', type: 'code', language: 'python', source: 'print(1)' },
      { id: 'b2', type: 'code', language: 'python', source: 'print(2)' },
    ],
    results: {
      b1: { blockId: 'b1', status: 'ok', outputs: [], durationMs: 1, ranAt: '' },
      b2: { blockId: 'b2', status: 'ok', outputs: [], durationMs: 1, ranAt: '' },
    },
  };

  it('borrar una salida no toca el código', () => {
    const next = withoutResult(document, 'b1');

    expect(Object.keys(next.results)).toEqual(['b2']);
    expect(next.blocks).toHaveLength(2);
  });

  it('borrarlas todas deja los bloques intactos', () => {
    const next = withoutResults(document);

    expect(next.results).toEqual({});
    expect(next.blocks).toEqual(document.blocks);
  });

  it('los resultados huérfanos se podan, porque el esquema los rechaza', () => {
    /**
     * No es limpieza cosmética: `nexBookDocumentSchema` rechaza un documento con
     * resultados sin bloque, así que sin esto un documento que perdiera una
     * celda por cualquier camino dejaría de poder guardarse.
     */
    const roto = { ...document, blocks: [document.blocks[0]!] };
    const parsedRoto = nexBookDocumentSchema.safeParse(roto);
    expect(parsedRoto.success).toBe(false);

    const parsedLimpio = nexBookDocumentSchema.safeParse(pruneOrphanResults(roto));
    expect(parsedLimpio.success).toBe(true);
  });
});

describe('lo que sale de la plataforma', () => {
  /**
   * `publishableDocument` reconstruye el documento campo a campo. Estas pruebas
   * comprueban lo que eso significa: que un campo que nadie añadió a la lista
   * blanca NO sale, aunque esté en el objeto.
   */
  it('descarta cualquier campo que no esté en la lista blanca', () => {
    const contaminado = {
      formatVersion: 1,
      ownerUid: 'uid-de-quien-escribe',
      revision: 41,
      context: { type: 'workflow', assignmentId: 'a1', stepId: 's1', role: 'instance' },
      blocks: [
        {
          id: 'b1',
          type: 'markdown',
          source: '# Hola',
          // Campos que alguien podría añadir al modelo en el futuro.
          lastEditorUid: 'uid-ajeno',
          storageKey: 'academic/materia/uid/tarea/paso/archivo.csv',
        },
      ],
      results: {},
    } as unknown as NexBookDocument;

    const clean = publishableDocument(contaminado);
    const serialized = JSON.stringify(clean);

    expect(serialized).not.toContain('ownerUid');
    expect(serialized).not.toContain('uid-de-quien-escribe');
    expect(serialized).not.toContain('lastEditorUid');
    expect(serialized).not.toContain('uid-ajeno');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('academic/');
    expect(serialized).not.toContain('assignmentId');
    expect(serialized).not.toContain('revision');
  });

  it('no deja pasar secretos escondidos en un output', () => {
    /**
     * El caso que preocupa de verdad: un output que alguien construyó a mano
     * —o una versión futura del modelo— llevando campos con credenciales.
     */
    const contaminado = {
      formatVersion: 1,
      blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x' }],
      results: {
        b1: {
          blockId: 'b1',
          status: 'ok',
          durationMs: 1,
          ranAt: '',
          signedUrl: 'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=deadbeef',
          outputs: [
            {
              seq: 0,
              stream: 'stdout',
              text: 'resultado',
              apiKey: 'sk-secreta',
              authorization: 'Bearer token',
              cookie: 'session=abc',
            },
          ],
        },
      },
    } as unknown as NexBookDocument;

    const serialized = JSON.stringify(publishableDocument(contaminado));

    for (const secret of [
      'apiKey',
      'sk-secreta',
      'authorization',
      'Bearer',
      'cookie',
      'session=abc',
      'signedUrl',
      'X-Amz-Signature',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Y lo que SÍ debe salir, sale.
    expect(serialized).toContain('resultado');
  });

  it('conserva lo que forma parte del documento', () => {
    // `editableByStudent` dice qué escribió el profesorado: quitarlo haría
    // ilegible una copia de una plantilla.
    const document: NexBookDocument = {
      formatVersion: 1,
      blocks: [
        { id: 'b1', type: 'markdown', source: 'instrucciones', editableByStudent: false },
        {
          id: 'b2',
          type: 'image',
          assetId: ASSET,
          mimeType: 'image/png',
          alt: 'diagrama',
          caption: 'Figura 1',
        },
      ],
      results: {},
    };

    const clean = publishableDocument(document);
    const [markdown, image] = clean.blocks;

    expect(markdown?.type === 'markdown' && markdown.editableByStudent).toBe(false);
    expect(image?.type === 'image' && image.alt).toBe('diagrama');
    expect(image?.type === 'image' && image.caption).toBe('Figura 1');
    expect(image?.type === 'image' && image.assetId).toBe(ASSET);
  });
});
