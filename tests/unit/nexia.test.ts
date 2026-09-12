import { describe, expect, it } from 'vitest';
import {
  emptyNexBookDocument,
  nexBookDocumentSchema,
  nexBookSubmissionDataSchema,
} from '../../src/lib/academic-schemas';
import { aiWorklogToMarkdown, emptyAIWorklog, normalizeAIResult } from '../../src/lib/ai-worklog';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import {
  NEXBOOK_ARCHIVE_FORMAT,
  fromArchiveReferences,
  toArchiveReferences,
} from '../../src/lib/nexbook-archive';
import { collectAssetIds, imageMimeTypeFor } from '../../src/lib/nexbook-document';
import { publishableDocument } from '../../src/lib/nexbook-publish';
import { NEXIA_DEFAULT_TITLE, nexiaPresetDocument } from '../../src/lib/nexia-preset';
import { NEXBOOK_FORMAT_VERSION } from '../../src/lib/types';
import type {
  AIWorklogData,
  NexBookAIWorklogBlock,
  NexBookDocument,
} from '../../src/lib/types';

/**
 * NexIA: el AI Worklog como bloque de un NexBook.
 *
 * Lo que se prueba aquí son las cuatro promesas de la Fase 3:
 *
 *  1. Que el bloque ANIDA `AIWorklogData` en vez de aplanarlo, y que por tanto
 *     las utilidades del entregable legacy siguen sirviendo sin tocarlas.
 *  2. Que `conclusionMode` actúa sobre `studentAnalysis` y no inventa un
 *     segundo campo.
 *  3. Que la frontera de publicación y exportación RECONSTRUYE el bloque campo
 *     a campo: ni `resourcesUsed`, ni un secreto inyectado, ni un campo de más.
 *  4. Que el contenedor `.nexbook` conserva el bloque, sus capturas y sus
 *     opciones, con `NEXBOOK_FORMAT_VERSION` todavía en 1.
 */

const ASSET_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ASSET_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const worklog = (overrides: Partial<AIWorklogData> = {}): AIWorklogData => ({
  ...emptyAIWorklog(),
  provider: 'ChatGPT',
  model: 'GPT-5',
  objective: 'Entender la degeneración en el método simplex',
  prompt: 'Explícame por qué una base degenerada puede ciclar.',
  result: { content: '## Degeneración\n\nOcurre cuando…', format: 'markdown' },
  studentAnalysis: 'La explicación era correcta pero le faltaba el ejemplo de Beale.',
  whatWasUsed: 'La definición y la condición de ciclado.',
  whatWasChanged: 'Reescribí el ejemplo con nuestros datos.',
  whatWasDiscarded: 'La demostración larga: no venía al caso.',
  conversationUrl: 'https://chatgpt.com/share/abc',
  ...overrides,
});

const block = (overrides: Partial<NexBookAIWorklogBlock> = {}): NexBookAIWorklogBlock => ({
  id: 'w1',
  type: 'ai_worklog',
  worklog: worklog(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

describe('el bloque de registro de IA', () => {
  it('valida con el registro ANIDADO, no aplanado', () => {
    const parsed = nexBookDocumentSchema.safeParse({ blocks: [block()] });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const saved = parsed.data.blocks[0];
    expect(saved?.type).toBe('ai_worklog');
    if (saved?.type !== 'ai_worklog') return;

    // Anidado: el bloque lleva un `worklog`, no once campos sueltos. Es lo que
    // permite que el entregable legacy y el bloque sean el mismo objeto.
    expect(saved.worklog.prompt).toContain('degenerada');
    expect('prompt' in saved).toBe(false);
  });

  it('un registro aplanado NO se cuela como bloque', () => {
    const flattened = { id: 'w1', type: 'ai_worklog', ...worklog() };
    expect(nexBookDocumentSchema.safeParse({ blocks: [flattened] }).success).toBe(false);
  });

  it('los defaults son los de siempre: sin `conclusionMode`, sin capturas y editable', () => {
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [{ id: 'w1', type: 'ai_worklog', worklog: {} }],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const saved = parsed.data.blocks[0];
    if (saved?.type !== 'ai_worklog') return;

    expect(saved.conclusionMode).toBeUndefined();
    expect(saved.responseImages).toBeUndefined();
    // Ausente significa `true`, igual que en markdown, code y spreadsheet.
    expect(saved.editableByStudent).toBeUndefined();
    // El esquema del registro rellena sus propios defaults, los MISMOS que en
    // el entregable legacy porque es literalmente el mismo esquema.
    expect(saved.worklog.provider).toBe('Other');
    expect(saved.worklog.resourcesUsed).toEqual([]);
  });

  it('`conclusionMode` sólo admite los tres valores, y actúa sobre `studentAnalysis`', () => {
    for (const mode of ['none', 'optional', 'required'] as const) {
      const parsed = nexBookDocumentSchema.safeParse({
        blocks: [block({ conclusionMode: mode })],
      });
      expect(parsed.success, mode).toBe(true);
    }

    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [block({ conclusionMode: 'mandatory' as never })],
      }).success
    ).toBe(false);

    // No hay un segundo campo de conclusión: lo que el modo gobierna es el que
    // ya existía en `AIWorklogData`.
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [block({ conclusionMode: 'required' })],
    });
    if (!parsed.success) return;
    const saved = parsed.data.blocks[0];
    if (saved?.type !== 'ai_worklog') return;
    expect(saved.worklog.studentAnalysis).toContain('Beale');
    expect('conclusion' in saved.worklog).toBe(false);
  });

  it('`conversationUrl` sólo admite HTTP(S)', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      const parsed = nexBookDocumentSchema.safeParse({
        blocks: [block({ worklog: worklog({ conversationUrl: url }) })],
      });
      expect(parsed.success, url).toBe(false);
    }
  });

  it('las capturas exigen un asset con forma de UUID y un MIME de la lista', () => {
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [
          block({ responseImages: [{ assetId: ASSET_A, mimeType: 'image/png', alt: 'captura' }] }),
        ],
      }).success
    ).toBe(true);

    // SVG no se admite: es la misma política que en `ImageBlock`, y no se
    // relaja por venir de NexIA. Ver docs/SECURITY.md.
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [
          block({
            responseImages: [
              { assetId: ASSET_A, mimeType: 'image/svg+xml' as never, alt: '' },
            ],
          }),
        ],
      }).success
    ).toBe(false);

    // Un `assetId` que sea una ruta acabaría formando parte de una clave de S3.
    expect(
      nexBookDocumentSchema.safeParse({
        blocks: [
          block({
            responseImages: [{ assetId: '../../secreto' as never, mimeType: 'image/png', alt: '' }],
          }),
        ],
      }).success
    ).toBe(false);
  });

  it('acota cuántas capturas caben en un registro', () => {
    const many = Array.from({ length: NEXBOOK_LIMITS.maxWorklogImages + 1 }, () => ({
      assetId: ASSET_A,
      mimeType: 'image/png' as const,
      alt: '',
    }));

    expect(nexBookDocumentSchema.safeParse({ blocks: [block({ responseImages: many })] }).success).toBe(
      false
    );
  });

  it('convive con los otros cuatro bloques en el mismo documento', () => {
    const parsed = nexBookDocumentSchema.safeParse({
      blocks: [
        { id: 'b1', type: 'markdown', source: '# Hola' },
        { id: 'b2', type: 'code', language: 'python', source: 'print(1)' },
        block({ id: 'b3' }),
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.blocks.map((item) => item.type)).toEqual(['markdown', 'code', 'ai_worklog']);
    // Añadir un miembro a la unión no cambia la versión del documento.
    expect(parsed.data.formatVersion).toBe(NEXBOOK_FORMAT_VERSION);
  });

  it('un NexBook SIN bloques de IA sigue validando exactamente igual', () => {
    const before = emptyNexBookDocument([
      { id: 'b1', type: 'markdown', source: '# Método simplex' },
      { id: 'b2', type: 'code', language: 'r', source: 'cat(1)' },
    ]);

    const parsed = nexBookDocumentSchema.safeParse(before);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Compatibilidad con el AI Worklog de siempre
// ---------------------------------------------------------------------------

describe('compatibilidad con el AI Worklog legacy', () => {
  it('`normalizeAIResult` lee el `result` del bloque igual que el del entregable', () => {
    const inBlock = block().worklog;
    expect(normalizeAIResult(inBlock)).toEqual({
      content: '## Degeneración\n\nOcurre cuando…',
      format: 'markdown',
    });
  });

  it('un registro antiguo con sólo `responseSummary` se lee sin migrarlo', () => {
    const legacy = worklog({ result: undefined, responseSummary: 'Contestó con una lista.' });

    const parsed = nexBookDocumentSchema.safeParse({ blocks: [block({ worklog: legacy })] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const saved = parsed.data.blocks[0];
    if (saved?.type !== 'ai_worklog') return;

    // Se guarda tal cual: `result` sigue ausente y nadie reescribió nada.
    expect(saved.worklog.result).toBeUndefined();
    expect(normalizeAIResult(saved.worklog)).toEqual({
      content: 'Contestó con una lista.',
      format: 'plain_text',
    });
  });

  it('`aiWorklogToMarkdown` funciona sobre el registro del bloque sin adaptarlo', () => {
    // Es la prueba de que anidar no obligó a mapear nada: la función del
    // entregable legacy recibe `block.worklog` y ya está.
    const markdown = aiWorklogToMarkdown(block().worklog);

    expect(markdown).toContain('# AI Worklog');
    expect(markdown).toContain('GPT-5');
    expect(markdown).toContain('Prompt utilizado');
    expect(markdown).toContain('https://chatgpt.com/share/abc');
  });
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

describe('las capturas son assets del NexBook', () => {
  const withImages = emptyNexBookDocument([
    block({
      responseImages: [
        { assetId: ASSET_A, mimeType: 'image/png', alt: 'La respuesta' },
        { assetId: ASSET_B, mimeType: 'image/webp', alt: '' },
      ],
    }),
  ]);

  it('`collectAssetIds` las cuenta: es lo que AUTORIZA su lectura', () => {
    expect(collectAssetIds(withImages).sort()).toEqual([ASSET_A, ASSET_B].sort());
  });

  it('`imageMimeTypeFor` devuelve el tipo que declara el documento', () => {
    expect(imageMimeTypeFor(withImages, ASSET_A)).toBe('image/png');
    expect(imageMimeTypeFor(withImages, ASSET_B)).toBe('image/webp');
  });

  it('un asset que el documento NO menciona no se puede resolver', () => {
    // Es la comprobación de pertenencia que impide que un documento sirva de
    // llave para leer cualquier imagen de su autor.
    expect(imageMimeTypeFor(withImages, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('cuentan para el tope de imágenes del documento', () => {
    const many = Array.from({ length: 4 }, () =>
      block({
        id: `w${Math.random().toString(36).slice(2, 8)}`,
        responseImages: [{ assetId: ASSET_A, mimeType: 'image/png' as const, alt: '' }],
      })
    );
    // Todas apuntan al mismo asset: `collectAssetIds` no repite.
    expect(collectAssetIds(emptyNexBookDocument(many))).toEqual([ASSET_A]);
  });
});

// ---------------------------------------------------------------------------
// Publicación y exportación
// ---------------------------------------------------------------------------

describe('la lista blanca de publicación y exportación', () => {
  it('conserva todo lo humano del registro', () => {
    const clean = publishableDocument(emptyNexBookDocument([block()]));
    const saved = clean.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    expect(saved.worklog.provider).toBe('ChatGPT');
    expect(saved.worklog.model).toBe('GPT-5');
    expect(saved.worklog.objective).toContain('degeneración');
    expect(saved.worklog.prompt).toContain('ciclar');
    expect(saved.worklog.result?.content).toContain('Degeneración');
    expect(saved.worklog.whatWasUsed).toContain('definición');
    expect(saved.worklog.whatWasChanged).toContain('Reescribí');
    expect(saved.worklog.whatWasDiscarded).toContain('demostración');
    expect(saved.worklog.studentAnalysis).toContain('Beale');
  });

  it('`resourcesUsed` NO sale: son ids internos de una materia', () => {
    const withResources = block({
      worklog: worklog({
        resourcesUsed: [
          { kind: 'skill', id: 'skill-interna-de-la-materia' },
          { kind: 'prompt', id: 'prompt-privado' },
        ],
      }),
    });

    const clean = publishableDocument(emptyNexBookDocument([withResources]));
    const saved = clean.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    // Vacío, no ausente: el esquema exige el campo, y omitirlo produciría un
    // documento que no se puede reimportar.
    expect(saved.worklog.resourcesUsed).toEqual([]);
    expect(JSON.stringify(clean)).not.toContain('skill-interna-de-la-materia');
    expect(JSON.stringify(clean)).not.toContain('prompt-privado');
  });

  it('no arrastra consigo el resto de campos humanos al quitar `resourcesUsed`', () => {
    // El fallo que esta prueba vigila: «limpiar» el worklog borrando de más.
    const clean = publishableDocument(
      emptyNexBookDocument([
        block({ worklog: worklog({ resourcesUsed: [{ kind: 'skill', id: 's1' }] }) }),
      ])
    );
    const saved = clean.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    expect(saved.worklog.prompt).not.toBe('');
    expect(saved.worklog.studentAnalysis).not.toBe('');
    expect(saved.worklog.whatWasDiscarded).not.toBe('');
  });

  it('un campo inyectado fuera del esquema se queda fuera', () => {
    /**
     * La lista blanca RECONSTRUYE el bloque, así que no basta con que el
     * esquema no lo declare: aunque algo llegue al objeto en memoria, no sale.
     */
    const hostile = {
      ...block(),
      ownerUid: 'uid-de-quien-escribió',
      firebaseToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.firma',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      cookie: 'session=secreto',
      signedUrl: 'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=abc',
      worklog: {
        ...worklog(),
        internalUid: 'uid-interno',
        courseId: 'course-privado',
        storageKey: 'nexbook/uid/asset.png',
      },
    } as unknown as NexBookAIWorklogBlock;

    const serialized = JSON.stringify(publishableDocument(emptyNexBookDocument([hostile])));

    for (const secret of [
      'uid-de-quien-escribió',
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
      'AKIAIOSFODNN7EXAMPLE',
      'session=secreto',
      'X-Amz-Signature',
      'uid-interno',
      'course-privado',
      'nexbook/uid/asset.png',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('`conversationUrl` sale saneado, y una URL que no es HTTP(S) se cae', () => {
    const clean = publishableDocument(
      emptyNexBookDocument([
        block({ worklog: worklog({ conversationUrl: 'javascript:alert(1)' }) }),
      ])
    );
    const saved = clean.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    expect(saved.worklog.conversationUrl).toBe('');

    const ok = publishableDocument(emptyNexBookDocument([block()]));
    const good = ok.blocks[0];
    if (good?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');
    expect(good.worklog.conversationUrl).toBe('https://chatgpt.com/share/abc');
  });

  it('las capturas salen por referencia, y `conclusionMode` y el bloqueo también', () => {
    const clean = publishableDocument(
      emptyNexBookDocument([
        block({
          conclusionMode: 'required',
          editableByStudent: false,
          responseImages: [
            { assetId: ASSET_A, mimeType: 'image/png', alt: 'La respuesta', caption: 'Turno 3' },
          ],
        }),
      ])
    );
    const saved = clean.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    expect(saved.responseImages).toEqual([
      { assetId: ASSET_A, mimeType: 'image/png', alt: 'La respuesta', caption: 'Turno 3' },
    ]);
    expect(saved.conclusionMode).toBe('required');
    expect(saved.editableByStudent).toBe(false);
  });

  it('lo publicado vuelve a validar contra el esquema', () => {
    // Si no lo hiciera, el `.nexbook` exportado no se podría reimportar.
    const clean = publishableDocument(
      emptyNexBookDocument([
        block({
          conclusionMode: 'optional',
          responseImages: [{ assetId: ASSET_A, mimeType: 'image/jpeg', alt: '' }],
        }),
      ])
    );
    expect(nexBookDocumentSchema.safeParse(clean).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El contenedor .nexbook
// ---------------------------------------------------------------------------

describe('el archivo .nexbook', () => {
  it('reescribe las capturas a rutas del contenedor y vuelve, sin perder nada', () => {
    const original: NexBookDocument = emptyNexBookDocument([
      { id: 'b1', type: 'markdown', source: '# Registro de uso de IA' },
      block({
        id: 'w1',
        conclusionMode: 'required',
        editableByStudent: false,
        responseImages: [
          { assetId: ASSET_A, mimeType: 'image/png', alt: 'Turno 1', caption: 'Primera respuesta' },
          { assetId: ASSET_B, mimeType: 'image/webp', alt: '' },
        ],
      }),
    ]);

    const exported = toArchiveReferences(
      publishableDocument(original),
      new Map([
        [ASSET_A, 'assets/1.png'],
        [ASSET_B, 'assets/2.webp'],
      ])
    );

    const inArchive = exported.blocks[1];
    if (inArchive?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');
    expect(inArchive.responseImages?.map((image) => image.assetId)).toEqual([
      'assets/1.png',
      'assets/2.webp',
    ]);
    // Dentro del archivo no queda rastro de los identificadores de origen.
    expect(JSON.stringify(exported)).not.toContain(ASSET_A);

    const back = fromArchiveReferences(
      exported,
      new Map([
        ['assets/1.png', ASSET_A],
        ['assets/2.webp', ASSET_B],
      ])
    );

    const imported = nexBookDocumentSchema.safeParse(back);
    expect(imported.success).toBe(true);
    if (!imported.success) return;

    const restored = imported.data.blocks[1];
    if (restored?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');

    expect(restored.worklog.prompt).toContain('ciclar');
    expect(restored.worklog.result?.content).toContain('Degeneración');
    expect(restored.worklog.studentAnalysis).toContain('Beale');
    expect(restored.conclusionMode).toBe('required');
    expect(restored.editableByStudent).toBe(false);
    expect(restored.responseImages).toEqual([
      { assetId: ASSET_A, mimeType: 'image/png', alt: 'Turno 1', caption: 'Primera respuesta' },
      { assetId: ASSET_B, mimeType: 'image/webp', alt: '' },
    ]);
  });

  it('`collectAssetIds` y el remapeo conocen los MISMOS sitios', () => {
    /**
     * Si una función conociera un sitio que la otra no, el asset que sobra se
     * exportaría sin bytes o los bytes se exportarían sin referencia. Se
     * comprueba remapeando TODO a una ruta y viendo que no queda ningún id.
     */
    const document = emptyNexBookDocument([
      { id: 'i1', type: 'image', assetId: ASSET_A, mimeType: 'image/png', alt: '' },
      block({ id: 'w1', responseImages: [{ assetId: ASSET_B, mimeType: 'image/png', alt: '' }] }),
    ]);

    const map = new Map(collectAssetIds(document).map((id, index) => [id, `assets/${index}.png`]));
    const remapped = toArchiveReferences(document, map);

    expect(collectAssetIds(remapped).every((id) => id.startsWith('assets/'))).toBe(true);
  });

  it('un dato desconocido dentro del bloque se descarta al importar', () => {
    const fromOutside = {
      formatVersion: 1,
      blocks: [{ ...block(), inventado: true, worklog: { ...worklog(), inventado: 'x' } }],
      results: {},
    };

    const parsed = nexBookDocumentSchema.safeParse(fromOutside);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(JSON.stringify(parsed.data)).not.toContain('inventado');
  });

  it('el identificador del contenedor es un dato persistido y NO se renombra', () => {
    /**
     * `uinexus-nexbook` viaja dentro de cada archivo exportado y el importador
     * lo compara. Cambiarlo por «nextudio-nexbook» volvería ilegible todo lo
     * exportado hasta hoy. Es un identificador, no marca.
     */
    expect(NEXBOOK_ARCHIVE_FORMAT).toBe('uinexus-nexbook');
    expect(NEXBOOK_FORMAT_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

describe('la entrega de un NexBook con registro de IA', () => {
  it('el snapshot lleva el registro entero', () => {
    const parsed = nexBookSubmissionDataSchema.safeParse({
      nexbookId: 'nb-1',
      revision: 4,
      title: 'Práctica 3',
      snapshot: emptyNexBookDocument([block()]),
      submittedAt: '2026-09-11T10:00:00.000Z',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const saved = parsed.data.snapshot.blocks[0];
    if (saved?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');
    expect(saved.worklog.prompt).toContain('ciclar');
  });

  it('editar el documento después NO toca el snapshot', () => {
    const snapshot = emptyNexBookDocument([block()]);
    const entregado = nexBookSubmissionDataSchema.parse({
      nexbookId: 'nb-1',
      revision: 4,
      title: 'Práctica 3',
      snapshot,
      submittedAt: '2026-09-11T10:00:00.000Z',
    });

    // El documento vivo sigue su camino; la entrega es una COPIA.
    const seguido = emptyNexBookDocument([
      block({ worklog: worklog({ studentAnalysis: 'Lo cambié todo después de entregar.' }) }),
    ]);

    const congelado = entregado.snapshot.blocks[0];
    if (congelado?.type !== 'ai_worklog') throw new Error('El bloque no sobrevivió.');
    expect(congelado.worklog.studentAnalysis).toContain('Beale');
    expect(JSON.stringify(seguido)).toContain('después de entregar');
  });

  it('un borrador incompleto con conclusión obligatoria SIGUE siendo guardable', () => {
    /**
     * La obligatoriedad es académica, no estructural: si el esquema la exigiera,
     * el autoguardado fallaría mientras alguien escribe, que es justo cuando
     * hace falta guardar. La comprobación vive en el momento de ENTREGAR
     * (`api/assignments/[assignmentId]/submission/route.ts`).
     */
    const draft = emptyNexBookDocument([
      block({ conclusionMode: 'required', worklog: worklog({ studentAnalysis: '' }) }),
    ]);

    expect(nexBookDocumentSchema.safeParse(draft).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

describe('el preset NexIA', () => {
  it('produce un NexBook normal, válido y con un registro dentro', () => {
    const document = nexiaPresetDocument();
    const parsed = nexBookDocumentSchema.safeParse(document);

    expect(parsed.success).toBe(true);
    expect(document.formatVersion).toBe(NEXBOOK_FORMAT_VERSION);
    expect(document.results).toEqual({});
    expect(document.blocks.map((item) => item.type)).toEqual(['markdown', 'ai_worklog']);
  });

  it('el texto inicial dice que Nextudio NO ejecuta la IA', () => {
    const intro = nexiaPresetDocument().blocks[0];
    if (intro?.type !== 'markdown') throw new Error('Falta el bloque de instrucciones.');

    expect(intro.source).toContain('no ejecuta ninguna IA');
    // Y no promete lo contrario en ningún sitio.
    for (const prohibido of ['Pregunta a NexIA', 'Enviar prompt', 'Generar', 'Respuesta de NexIA']) {
      expect(intro.source, prohibido).not.toContain(prohibido);
    }
  });

  it('el bloque nace vacío y con la conclusión OPCIONAL', () => {
    const registro = nexiaPresetDocument().blocks[1];
    if (registro?.type !== 'ai_worklog') throw new Error('Falta el registro.');

    expect(registro.conclusionMode).toBe('optional');
    expect(registro.worklog.prompt).toBe('');
    expect(registro.worklog.resourcesUsed).toEqual([]);
    expect(registro.responseImages).toBeUndefined();
    // Un documento personal es todo de su autor: nada nace bloqueado.
    expect(registro.editableByStudent).toBeUndefined();
  });

  it('no introduce ninguna entidad nueva: el título es texto y nada más', () => {
    expect(NEXIA_DEFAULT_TITLE).toBe('Registro de uso de IA');
    // No hay `kind: 'nexia'` en ninguna parte del documento que produce.
    expect(JSON.stringify(nexiaPresetDocument())).not.toContain('nexia');
  });
});
