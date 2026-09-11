import { describe, expect, it } from 'vitest';
import {
  emptyNexBookDocument,
  nexBookDocumentBytes,
  nexBookDocumentSchema,
  nexBookPatchSchema,
  nexBookSubmissionDataSchema,
  deliverableSchemaFor,
} from '../../src/lib/academic-schemas';
import {
  instanceNexBookIdFor,
  normalizeNexBook,
  templateNexBookIdFor,
  toNexBook,
} from '../../src/lib/data/nexbooks';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import { NEXBOOK_FORMAT_VERSION } from '../../src/lib/types';
import type { NexBookBlock, NexBookRecord } from '../../src/lib/types';

/**
 * El modelo de un NexBook.
 *
 * Lo que se prueba aquí son las cuatro promesas del documento: que un output no
 * es un bloque, que los límites impiden reventar el item de DynamoDB, que la
 * copia de un estudiante es suya y sólo suya, y que una entrega es inmutable.
 */

const record = (overrides: Partial<NexBookRecord> = {}): NexBookRecord => ({
  id: 'nb-1',
  ownerUid: 'uid-christian',
  title: 'Método simplex',
  context: { type: 'personal' },
  visibility: 'private',
  document: emptyNexBookDocument([
    { id: 'b1', type: 'markdown', source: '# Hola' },
    { id: 'b2', type: 'code', language: 'python', source: 'print(1)' },
  ]),
  revision: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T11:00:00.000Z',
  ...overrides,
});

describe('los bloques', () => {
  it('markdown y código conviven en la misma lista ordenada', () => {
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        { id: 'b1', type: 'markdown', source: '# Título' },
        { id: 'b2', type: 'code', language: 'r', source: 'cat(1)' },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // El orden del array ES el orden del documento. No hay campo `order` que
      // pueda desincronizarse con la lista.
      expect(parsed.data.blocks.map((block) => block.id)).toEqual(['b1', 'b2']);
      expect(parsed.data.formatVersion).toBe(NEXBOOK_FORMAT_VERSION);
    }
  });

  it('el lenguaje es una propiedad del bloque, no un tipo de bloque', () => {
    // Por eso no hay `PythonBlock` ni `RBlock`: un documento puede mezclar.
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        { id: 'b1', type: 'code', language: 'python', source: 'x = 1' },
        { id: 'b2', type: 'code', language: 'r', source: 'x <- 1' },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.blocks.map((b) => (b.type === 'code' ? b.language : null))).toEqual([
        'python',
        'r',
      ]);
    }
  });

  it('un bloque de código sin lenguaje nace en Python', () => {
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'code', source: 'print(1)' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.blocks[0]?.type === 'code') {
      expect(parsed.data.blocks[0].language).toBe('python');
    }
  });

  it('rechaza un tipo de bloque que todavía no existe', () => {
    // Aceptar `spreadsheet` antes de que alguna pantalla sepa pintarlo crearía
    // documentos que nadie puede abrir.
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [{ id: 'b1', type: 'spreadsheet', source: '' }],
      }).success
    ).toBe(false);
  });

  it('rechaza dos bloques con el mismo identificador', () => {
    /**
     * No es quisquillosidad: `results` se indexa por `blockId`, así que dos
     * bloques con el mismo id compartirían su salida y mover uno movería la del
     * otro. Es el tipo de fallo que se nota tres semanas después.
     */
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [
          { id: 'b1', type: 'markdown', source: 'a' },
          { id: 'b1', type: 'markdown', source: 'b' },
        ],
      }).success
    ).toBe(false);
  });

  it('conserva el Markdown sin recortar: los saltos son significativos', () => {
    const source = '# Título\n\n- uno\n- dos\n\n    sangrado\n';
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'markdown', source }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const block = parsed.data.blocks[0];
      expect(block?.type === 'markdown' && block.source).toBe(source);
    }
  });

  it('`editableByStudent` es opcional y ausente significa editable', () => {
    // Los bloques de un laboratorio personal son todos suyos: sólo una plantilla
    // docente tiene razones para bloquear alguno.
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        { id: 'b1', type: 'markdown', source: 'libre' },
        { id: 'b2', type: 'markdown', source: 'instrucciones', editableByStudent: false },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const [free, locked] = parsed.data.blocks;
      expect(free?.type === 'markdown' && free.editableByStudent).toBeUndefined();
      expect(locked?.type === 'markdown' && locked.editableByStudent).toBe(false);
    }
  });
});

describe('los outputs no son bloques', () => {
  it('viven en `results`, indexados por bloque', () => {
    /**
     * Es la distinción que separa a NexBook de un notebook cualquiera: lo que
     * escribió una persona y lo que contestó la máquina son cosas distintas. Si
     * una gráfica se convirtiera en un bloque editable, al revisar sería
     * imposible saber qué había escrito quien entrega.
     */
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'print(1)' }],
      results: {
        b1: {
          blockId: 'b1',
          status: 'ok',
          outputs: [{ seq: 0, stream: 'stdout', text: '1\n' }],
          durationMs: 12,
          ranAt: '2026-09-01T10:00:00.000Z',
        },
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const output = parsed.data.results.b1?.outputs[0];
      expect(output?.stream === 'stdout' && output.text).toBe('1\n');
    }
  });

  it('conserva el ORDEN de la salida con `seq`', () => {
    // Un programa que imprime, falla y vuelve a imprimir cuenta una historia que
    // se pierde si stdout y stderr se guardan en dos montones separados.
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x' }],
      results: {
        b1: {
          blockId: 'b1',
          status: 'failed',
          outputs: [
            { seq: 0, stream: 'stdout', text: 'antes\n' },
            { seq: 1, stream: 'error', text: 'NameError\n' },
          ],
          durationMs: 5,
          ranAt: '',
        },
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.results.b1?.outputs.map((o) => o.seq)).toEqual([0, 1]);
    }
  });

  it('rechaza resultados de un bloque que ya no existe', () => {
    // Limpiarlos en silencio dejaría outputs huérfanos creciendo en el item para
    // siempre, y significaría que se perdió la correspondencia código/salida.
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [{ id: 'b1', type: 'markdown', source: 'a' }],
        results: {
          fantasma: { blockId: 'fantasma', status: 'ok', outputs: [], durationMs: 0, ranAt: '' },
        },
      }).success
    ).toBe(false);
  });

  it('admite los flujos de V1 y rechaza uno inventado', () => {
    const withStream = (stream: string) =>
      nexBookDocumentSchema.safeParse({
        blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x' }],
        results: {
          b1: {
            blockId: 'b1',
            status: 'ok',
            outputs: [{ seq: 0, stream, text: 'x' }],
            durationMs: 0,
            ranAt: '',
          },
        },
      }).success;

    for (const stream of ['stdout', 'stderr', 'error']) {
      expect(withStream(stream), stream).toBe(true);
    }
    // `image` y `table` llegarán como valores nuevos de este campo; aceptarlos
    // antes de poder pintarlos daría documentos que no se pueden abrir.
    expect(withStream('image')).toBe(false);
  });
});

describe('los límites que impiden reventar el item de DynamoDB', () => {
  it('acota el número de bloques', () => {
    const blocks = (count: number): NexBookBlock[] =>
      Array.from({ length: count }, (_unused, index) => ({
        id: `b${index}`,
        type: 'markdown' as const,
        source: 'x',
      }));

    expect(nexBookDocumentSchema.safeParse({ blocks: blocks(NEXBOOK_LIMITS.maxBlocks) }).success).toBe(
      true
    );
    expect(
      nexBookDocumentSchema.safeParse({ blocks: blocks(NEXBOOK_LIMITS.maxBlocks + 1) }).success
    ).toBe(false);
  });

  it('acota cada bloque por separado', () => {
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'x'.repeat(NEXBOOK_LIMITS.maxCodeChars + 1) }],
      }).success
    ).toBe(false);
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [{ id: 'b1', type: 'markdown', source: 'x'.repeat(NEXBOOK_LIMITS.maxMarkdownChars + 1) }],
      }).success
    ).toBe(false);
  });

  it('acota el documento COMPLETO, no sólo sus piezas', () => {
    /**
     * Ésta es la que de verdad protege el item: cien bloques de 40 KB pasan cada
     * uno su límite individual y suman cuatro megas. Se mide sobre el JSON ya
     * serializado porque es lo único que se corresponde con lo que DynamoDB va a
     * medir.
     */
    const blocks: NexBookBlock[] = Array.from({ length: 20 }, (_unused, index) => ({
      id: `b${index}`,
      type: 'markdown' as const,
      source: 'x'.repeat(30_000),
    }));

    const parsed = nexBookDocumentSchema.safeParse({ blocks });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('demasiado grande'))).toBe(
        true
      );
    }
  });

  it('el presupuesto deja margen de sobra bajo el tope de DynamoDB', () => {
    // 400 KB es el límite duro del item; el documento no es lo único que va
    // dentro (id, título, contexto, fechas, y la sobrecarga de la codificación).
    expect(NEXBOOK_LIMITS.documentBytes).toBeLessThan(400_000 * 0.8);
  });

  it('mide en bytes UTF-8 y no en caracteres', () => {
    // «á» ocupa dos bytes. Contar caracteres subestimaría un documento en
    // español justo en el caso que importa.
    const ascii = emptyNexBookDocument([{ id: 'b1', type: 'markdown', source: 'aaa' }]);
    const acentos = emptyNexBookDocument([{ id: 'b1', type: 'markdown', source: 'ááá' }]);

    expect(nexBookDocumentBytes(acentos)).toBeGreaterThan(nexBookDocumentBytes(ascii));
  });
});

describe('guardar con concurrencia optimista', () => {
  it('la revisión es obligatoria', () => {
    /**
     * Sin ella no hay concurrencia optimista, hay «gana el último en llegar».
     * Dos pestañas abiertas en el mismo documento es un caso normal —el portátil
     * y el equipo del laboratorio— y ahí se pierde media hora de trabajo.
     */
    expect(nexBookPatchSchema.safeParse({ title: 'Sin revisión' }).success).toBe(false);
    expect(nexBookPatchSchema.safeParse({ revision: 0, title: 'Con revisión' }).success).toBe(true);
  });

  it('acepta guardar sólo el título o sólo el documento', () => {
    expect(nexBookPatchSchema.safeParse({ revision: 1, title: 'Otro' }).success).toBe(true);
    expect(
      nexBookPatchSchema.safeParse({ revision: 1, document: { blocks: [] } }).success
    ).toBe(true);
  });

  it('rechaza un cuerpo que no cambia nada', () => {
    expect(nexBookPatchSchema.safeParse({ revision: 1 }).success).toBe(false);
  });

  it('el cuerpo NO puede decidir el dueño, el id ni el contexto', () => {
    const parsed = nexBookPatchSchema.safeParse({
      revision: 1,
      title: 'Intento',
      ownerUid: 'uid-ajeno',
      id: 'nb-robado',
      context: { type: 'personal' },
      visibility: 'public',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(['revision', 'title']);
  });
});

describe('la identidad de las plantillas y las copias', () => {
  it('una plantilla por paso, derivada de (actividad, paso)', () => {
    const first = templateNexBookIdFor('a1', 'paso1');
    expect(templateNexBookIdFor('a1', 'paso1')).toBe(first);
    expect(templateNexBookIdFor('a1', 'paso2')).not.toBe(first);
    expect(templateNexBookIdFor('a2', 'paso1')).not.toBe(first);
  });

  it('una copia por persona y paso, derivada de (actividad, paso, uid)', () => {
    // Que sea aritmético y no una consulta previa más una escritura es lo que
    // hace imposible acabar con dos copias por una carrera entre dos pestañas.
    const ana = instanceNexBookIdFor('a1', 'paso1', 'uid-ana');
    expect(instanceNexBookIdFor('a1', 'paso1', 'uid-ana')).toBe(ana);
    expect(instanceNexBookIdFor('a1', 'paso1', 'uid-pedro')).not.toBe(ana);
    expect(instanceNexBookIdFor('a1', 'paso2', 'uid-ana')).not.toBe(ana);
  });

  it('el id NO contiene el uid: viaja en la URL', () => {
    /**
     * Es un hash por la misma razón que `submissionIdFor`: pegar el UID de
     * Firebase en la dirección de un documento sería exactamente la fuga que el
     * resto del proyecto evita.
     */
    const id = instanceNexBookIdFor('a1', 'paso1', 'uid-christian');
    expect(id).not.toContain('uid-christian');
    expect(id).not.toContain('a1');
    expect(id).not.toContain('paso1');
  });

  it('una plantilla y una copia del mismo paso NUNCA coinciden', () => {
    // Si coincidieran, la primera persona que abriera el paso escribiría encima
    // de la plantilla de la docente.
    expect(templateNexBookIdFor('a1', 'p1')).not.toBe(instanceNexBookIdFor('a1', 'p1', 'uid-ana'));
  });
});

describe('leer un registro guardado', () => {
  it('un registro incompleto no rompe la pantalla', () => {
    expect(normalizeNexBook({ id: 'nb-9' })).toMatchObject({
      title: 'NexBook sin título',
      context: { type: 'personal' },
      revision: 0,
    });
  });

  it('sin visibilidad se lee como PRIVADO, no como lo más útil', () => {
    // Un documento cuyo estado de visibilidad se perdió no puede leerse como
    // público: el error se descubriría por el lado malo.
    expect(normalizeNexBook({ id: 'nb-9' }).visibility).toBe('private');
  });

  it('el DTO no lleva el uid del dueño', () => {
    const dto = toNexBook(record());
    expect('ownerUid' in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('uid-christian');
  });
});

describe('la entrega de un NexBook es inmutable', () => {
  it('la evidencia lleva una COPIA, no una referencia', () => {
    /**
     * Es la diferencia entre calificar lo que alguien entregó y calificar lo que
     * tenga ahora mismo. Si la evidencia guardara sólo el id, seguir trabajando
     * después de entregar cambiaría lo que la docente ve.
     */
    const parsed = nexBookSubmissionDataSchema.safeParse({
      nexbookId: 'nb-1',
      revision: 4,
      title: 'Método simplex',
      snapshot: {
        blocks: [{ id: 'b1', type: 'code', language: 'python', source: 'print(1)' }],
      },
      submittedAt: '2026-09-10T12:00:00.000Z',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.snapshot.blocks).toHaveLength(1);
      expect(parsed.data.revision).toBe(4);
    }
  });

  it('editar el documento vivo NO cambia la copia entregada', () => {
    const live = emptyNexBookDocument([
      { id: 'b1', type: 'code', language: 'python', source: 'original' },
    ]);

    const submitted = nexBookSubmissionDataSchema.parse({
      nexbookId: 'nb-1',
      revision: 1,
      title: 'Entrega',
      snapshot: live,
      submittedAt: '2026-09-10T12:00:00.000Z',
    });

    // Se edita el documento vivo después de entregar.
    live.blocks[0] = { id: 'b1', type: 'code', language: 'python', source: 'modificado' };

    const block = submitted.snapshot.blocks[0];
    expect(block?.type === 'code' ? block.source : '').toBe('original');
  });

  it('el validador lo elige el ENTREGABLE del paso', () => {
    expect(deliverableSchemaFor('nexbook')).toBe(nexBookSubmissionDataSchema);
  });

  it('una entrega sin snapshot no es válida', () => {
    // Entregar «el documento de allí» sin traerlo es exactamente lo que hace
    // imposible saber después qué se entregó.
    expect(nexBookSubmissionDataSchema.safeParse({ nexbookId: 'nb-1', revision: 1 }).success).toBe(
      false
    );
  });

  it('el snapshot respeta los mismos límites que el documento vivo', () => {
    expect(
      nexBookSubmissionDataSchema.safeParse({
        nexbookId: 'nb-1',
        revision: 1,
        snapshot: {
          blocks: [
            { id: 'b1', type: 'markdown', source: 'x'.repeat(NEXBOOK_LIMITS.maxMarkdownChars + 1) },
          ],
        },
      }).success
    ).toBe(false);
  });
});
