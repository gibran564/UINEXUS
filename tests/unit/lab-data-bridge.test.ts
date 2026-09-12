import { describe, expect, it } from 'vitest';
import { emptyNexBookDocument } from '../../src/lib/academic-schemas';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import { labCatalog, resolveLabDataset } from '../../src/lib/lab/data-bridge';
import { scanLabReferences, usesLabApi } from '../../src/lib/lab/references';
import { pythonLabModule } from '../../src/lib/code-engines/python-lab';
import { rLabPrelude, rString } from '../../src/lib/code-engines/r-lab';
import { sanitizeWorkerRun } from '../../src/lib/browser-code-runner-protocol';
import { cellKey } from '../../src/lib/spreadsheet/cells';
import type { NexBookBlock, NexBookDocument, NexBookSheetData } from '../../src/lib/types';

/**
 * NexLab Data Bridge.
 *
 * Lo que se prueba aquí son las cuatro promesas de la Fase 3.5:
 *
 *  1. Que las referencias son ESTABLES: por `blockId`, y por nombre sólo cuando
 *     no es ambiguo. Mover un bloque no rompe nada; un nombre duplicado para.
 *  2. Que los datos se preparan BAJO DEMANDA: lo que la celda pide y nada más.
 *  3. Que lo que cruza al Worker es un tipo cerrado, sin URLs, claves ni ids
 *     internos.
 *  4. Que un error se explica en vez de devolver datos vacíos.
 */

function sheet(cells: Record<string, string>, rows = 4, columns = 3): NexBookSheetData {
  return {
    rows,
    columns,
    cells: Object.fromEntries(Object.entries(cells).map(([key, input]) => [key, { input }])),
  };
}

/** Una hoja «Ventas» con encabezados y tres filas. */
const VENTAS = sheet({
  [cellKey(0, 0)]: 'Producto',
  [cellKey(0, 1)]: 'Unidades',
  [cellKey(0, 2)]: 'Precio',
  [cellKey(1, 0)]: 'Tornillo',
  [cellKey(1, 1)]: '10',
  [cellKey(1, 2)]: '2.5',
  [cellKey(2, 0)]: 'Tuerca',
  [cellKey(2, 1)]: '4',
  [cellKey(2, 2)]: '1.25',
  // Fórmula: el puente entrega el VALOR calculado, no el texto.
  [cellKey(3, 0)]: 'Total',
  [cellKey(3, 1)]: '=SUMA(B2:B3)',
});

const documentWith = (...blocks: NexBookBlock[]): NexBookDocument => emptyNexBookDocument(blocks);

const ventasDocument = documentWith(
  { id: 'md1', type: 'markdown', source: '# Análisis' },
  { id: 'sheet-ventas', type: 'spreadsheet', name: 'Ventas', sheet: VENTAS }
);

// ---------------------------------------------------------------------------
// El escáner de referencias
// ---------------------------------------------------------------------------

describe('qué pide una celda', () => {
  it('encuentra las llamadas literales de Python', () => {
    const found = scanLabReferences(
      'ventas = nex.sheet("Ventas")\nimg = nex.image(\'Muestra\')\nt = nex.output("limpieza")',
      'python'
    );

    expect(found.sheets).toEqual(['Ventas']);
    expect(found.images).toEqual(['Muestra']);
    expect(found.outputs).toEqual(['limpieza']);
    expect(found.dynamic).toBe(false);
  });

  it('encuentra las de R, con su propio vocabulario', () => {
    const found = scanLabReferences('ventas <- nex_sheet("Ventas")\nx <- nex_output("limpieza")', 'r');

    expect(found.sheets).toEqual(['Ventas']);
    expect(found.outputs).toEqual(['limpieza']);
  });

  it('`_by_id` se encuentra igual: lo que cambia es cómo se resuelve', () => {
    const found = scanLabReferences('nex.sheet_by_id("b12")', 'python');
    expect(found.sheets).toEqual(['b12']);
  });

  it('no repite una hoja pedida dos veces', () => {
    const found = scanLabReferences('a = nex.sheet("Ventas")\nb = nex.sheet("Ventas")', 'python');
    expect(found.sheets).toEqual(['Ventas']);
  });

  it('marca como DINÁMICA una referencia calculada, en vez de ignorarla', () => {
    // Es el caso que no se puede resolver antes de ejecutar. Se registra para
    // poder explicarlo; callarlo produciría un «hoja no encontrada» engañoso.
    const found = scanLabReferences('nombre = "Ventas"\nv = nex.sheet(nombre)', 'python');

    expect(found.sheets).toEqual([]);
    expect(found.dynamic).toBe(true);
    expect(usesLabApi(found)).toBe(true);
  });

  it('una celda que no menciona la API no pide nada', () => {
    const found = scanLabReferences('print(sum([1, 2, 3]))', 'python');
    expect(usesLabApi(found)).toBe(false);
  });

  it('un lenguaje sin runtime no tiene API de laboratorio', () => {
    expect(usesLabApi(scanLabReferences('nex.sheet("Ventas")', 'java'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

describe('resolver una hoja', () => {
  it('entrega columnas, filas y los valores YA CALCULADOS', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex.sheet("Ventas")', 'python')
    );

    expect(dataset.problems).toEqual([]);
    const table = dataset.sheets[0]!;

    expect(table.id).toBe('sheet-ventas');
    expect(table.columns).toEqual(['Producto', 'Unidades', 'Precio']);
    // La fila de encabezados NO vuelve a salir como dato.
    expect(table.rows[0]).toEqual(['Tornillo', 10, 2.5]);
    expect(table.rows[1]).toEqual(['Tuerca', 4, 1.25]);
    // `=SUMA(B2:B3)` llega como 14, no como su texto.
    expect(table.rows[2]).toEqual(['Total', 14, null]);
  });

  it('resuelve por `blockId`, y MOVER el bloque no rompe la referencia', async () => {
    const moved = documentWith(
      { id: 'sheet-ventas', type: 'spreadsheet', name: 'Ventas', sheet: VENTAS },
      { id: 'md1', type: 'markdown', source: '# Análisis' }
    );

    const before = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex.sheet_by_id("sheet-ventas")', 'python')
    );
    const after = await resolveLabDataset(
      moved,
      scanLabReferences('nex.sheet_by_id("sheet-ventas")', 'python')
    );

    expect(before.sheets[0]?.rows).toEqual(after.sheets[0]?.rows);
    expect(after.problems).toEqual([]);
  });

  it('el nombre se resuelve sin acentos ni mayúsculas, conservando la eñe', async () => {
    const document = documentWith({
      id: 's1',
      type: 'spreadsheet',
      name: 'Años de operación',
      sheet: VENTAS,
    });

    const found = await resolveLabDataset(
      document,
      scanLabReferences('nex.sheet("anos de operacion")', 'python')
    );
    // «anos» NO es «años»: la eñe se protege, así que esto no coincide.
    expect(found.sheets).toHaveLength(0);

    const exact = await resolveLabDataset(
      document,
      scanLabReferences('nex.sheet("años de operación")', 'python')
    );
    expect(exact.sheets).toHaveLength(1);

    const insensitive = await resolveLabDataset(
      document,
      scanLabReferences('nex.sheet("AÑOS DE OPERACION")', 'python')
    );
    // Mayúsculas y el acento de «operación» sí se ignoran.
    expect(insensitive.sheets).toHaveLength(1);
  });

  it('un nombre DUPLICADO produce un error que nombra a las dos, no elige', async () => {
    /**
     * Es la diferencia que justifica esta capa. `SpreadsheetBridge` se queda con
     * la primera, que para pintar da igual; para decidir qué datos ve un
     * programa significa que añadir una hoja cambia el resultado de una celda
     * que nadie tocó.
     */
    const document = documentWith(
      { id: 'a', type: 'spreadsheet', name: 'Datos', sheet: VENTAS },
      { id: 'b', type: 'spreadsheet', name: 'datos', sheet: VENTAS }
    );

    const dataset = await resolveLabDataset(
      document,
      scanLabReferences('nex.sheet("Datos")', 'python')
    );

    expect(dataset.sheets).toHaveLength(0);
    const problem = dataset.problems[0]!;
    expect(problem.kind).toBe('sheet');
    expect(problem.message).toContain('2 bloques');
    expect(problem.message).toContain('"a"');
    expect(problem.message).toContain('"b"');
  });

  it('con el nombre duplicado, el ID sigue funcionando', async () => {
    const document = documentWith(
      { id: 'a', type: 'spreadsheet', name: 'Datos', sheet: VENTAS },
      { id: 'b', type: 'spreadsheet', name: 'Datos', sheet: sheet({}) }
    );

    const dataset = await resolveLabDataset(
      document,
      scanLabReferences('nex.sheet_by_id("a")', 'python')
    );

    expect(dataset.problems).toEqual([]);
    expect(dataset.sheets[0]?.id).toBe('a');
  });

  it('una hoja que no existe se explica y dice cuáles hay', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex.sheet("Costos")', 'python')
    );

    expect(dataset.sheets).toHaveLength(0);
    expect(dataset.problems[0]?.message).toContain('"Ventas"');
  });

  it('una referencia calculada se explica en vez de fallar sin motivo', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('v = nex.sheet(nombre)', 'python')
    );

    expect(dataset.problems[0]?.message).toContain('literal');
  });

  it('las celdas vacías llegan como `null`, no como cadena vacía', async () => {
    const disperse = documentWith({
      id: 's1',
      type: 'spreadsheet',
      name: 'Huecos',
      sheet: sheet({
        [cellKey(0, 0)]: 'A',
        [cellKey(0, 1)]: 'B',
        [cellKey(1, 0)]: '1',
        // (1,1) vacía a propósito
        [cellKey(2, 1)]: '9',
      }),
    });

    const dataset = await resolveLabDataset(
      disperse,
      scanLabReferences('nex.sheet("Huecos")', 'python')
    );

    expect(dataset.sheets[0]?.rows).toEqual([
      [1, null, null],
      [null, 9, null],
    ]);
  });

  it('los tipos se conservan: número, texto y booleano', async () => {
    const typed = documentWith({
      id: 's1',
      type: 'spreadsheet',
      name: 'Tipos',
      sheet: sheet({
        [cellKey(0, 0)]: 'texto',
        [cellKey(0, 1)]: 'numero',
        [cellKey(0, 2)]: 'logico',
        [cellKey(1, 0)]: 'hola',
        [cellKey(1, 1)]: '42',
        [cellKey(1, 2)]: 'VERDADERO',
      }),
    });

    const row = (
      await resolveLabDataset(typed, scanLabReferences('nex.sheet("Tipos")', 'python'))
    ).sheets[0]?.rows[0];

    expect(typeof row?.[0]).toBe('string');
    expect(row?.[1]).toBe(42);
    expect(row?.[2]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bajo demanda
// ---------------------------------------------------------------------------

describe('los datos se preparan BAJO DEMANDA', () => {
  const big = documentWith(
    { id: 'a', type: 'spreadsheet', name: 'Ventas', sheet: VENTAS },
    { id: 'b', type: 'spreadsheet', name: 'Costos', sheet: VENTAS },
    { id: 'c', type: 'spreadsheet', name: 'Inventario', sheet: VENTAS }
  );

  it('sólo cruza la hoja que la celda pidió', async () => {
    const dataset = await resolveLabDataset(
      big,
      scanLabReferences('nex.sheet("Ventas")', 'python')
    );

    expect(dataset.sheets.map((table) => table.name)).toEqual(['Ventas']);
    // Pero el CATÁLOGO sí lista las tres: son nombres y tamaños, no datos.
    expect(dataset.catalog.sheets).toHaveLength(3);
    expect(JSON.stringify(dataset.catalog)).not.toContain('Tornillo');
  });

  it('el catálogo no lleva ni una celda', () => {
    const catalog = labCatalog(big);
    expect(catalog.sheets[0]).toEqual({ id: 'a', name: 'Ventas', rows: 4, columns: 3 });
    expect(JSON.stringify(catalog)).not.toContain('Tuerca');
  });

  it('recorta las filas que cruzan y no miente sobre el tope', async () => {
    const cells: Record<string, string> = { [cellKey(0, 0)]: 'n' };
    for (let row = 1; row <= 60; row += 1) cells[cellKey(row, 0)] = String(row);

    const long = documentWith({
      id: 's1',
      type: 'spreadsheet',
      name: 'Larga',
      sheet: sheet(cells, 61, 1),
    });

    const dataset = await resolveLabDataset(
      long,
      scanLabReferences('nex.sheet("Larga")', 'python')
    );

    // 60 filas de datos caben de sobra bajo el tope: se entregan todas.
    expect(dataset.sheets[0]?.rows).toHaveLength(60);
    expect(NEXBOOK_LIMITS.maxLabRows).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------------------
// Outputs persistidos
// ---------------------------------------------------------------------------

describe('outputs persistidos como entrada', () => {
  const withOutput: NexBookDocument = {
    ...documentWith(
      { id: 'py1', type: 'code', language: 'python', source: 'print(1)' },
      { id: 'r1', type: 'code', language: 'r', source: 'cat(1)' }
    ),
    results: {
      py1: {
        blockId: 'py1',
        status: 'ok',
        durationMs: 12,
        ranAt: '2026-09-11T10:00:00.000Z',
        outputs: [
          {
            seq: 0,
            stream: 'table',
            columns: ['producto', 'total'],
            rows: [
              ['Tornillo', 25],
              ['Tuerca', 5],
            ],
            totalRows: 2,
          },
        ],
      },
    },
  };

  it('una tabla que produjo Python la puede leer R', async () => {
    const dataset = await resolveLabDataset(
      withOutput,
      scanLabReferences('nex_output("py1")', 'r')
    );

    expect(dataset.problems).toEqual([]);
    expect(dataset.outputs[0]?.columns).toEqual(['producto', 'total']);
    expect(dataset.outputs[0]?.rows[0]).toEqual(['Tornillo', 25]);
  });

  it('sobrevive a reabrir el documento: sale de `results`, no del kernel', async () => {
    /**
     * Ésta es la diferencia que la fase tenía que dejar clara. Una VARIABLE del
     * kernel (`df = ...`) desaparece al reiniciarlo; un OUTPUT persistido está
     * guardado en el documento. Aquí se resuelve a partir de un documento recién
     * construido, sin ningún kernel de por medio.
     */
    const reopened: NexBookDocument = JSON.parse(JSON.stringify(withOutput)) as NexBookDocument;
    const dataset = await resolveLabDataset(
      reopened,
      scanLabReferences('nex.output("py1")', 'python')
    );

    expect(dataset.outputs[0]?.rows).toHaveLength(2);
  });

  it('un output borrado produce un error comprensible', async () => {
    const cleared: NexBookDocument = { ...withOutput, results: {} };
    const dataset = await resolveLabDataset(
      cleared,
      scanLabReferences('nex.output("py1")', 'python')
    );

    expect(dataset.outputs).toHaveLength(0);
    expect(dataset.problems[0]?.kind).toBe('output');
  });

  it('una imagen de salida NO se confunde con un ImageBlock', async () => {
    // `results` lleva imágenes generadas por código; `nex.image()` sólo mira
    // bloques de imagen, que es contenido que alguien puso a propósito.
    const withImageOutput: NexBookDocument = {
      ...documentWith({ id: 'py1', type: 'code', language: 'python', source: 'plot()' }),
      results: {
        py1: {
          blockId: 'py1',
          status: 'ok',
          durationMs: 1,
          ranAt: '2026-09-11T10:00:00.000Z',
          outputs: [
            {
              seq: 0,
              stream: 'image',
              assetId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
              mimeType: 'image/png',
            },
          ],
        },
      },
    };

    const dataset = await resolveLabDataset(
      withImageOutput,
      scanLabReferences('nex.image("py1")', 'python')
    );

    expect(dataset.images).toHaveLength(0);
    expect(dataset.catalog.images).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

describe('imágenes hacia el código', () => {
  const ASSET = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const withImage = documentWith({
    id: 'img1',
    type: 'image',
    assetId: ASSET,
    mimeType: 'image/png',
    alt: 'Muestra',
  });

  it('entrega BYTES, y los descarga quien tiene sesión', async () => {
    const asked: string[] = [];
    const dataset = await resolveLabDataset(
      withImage,
      scanLabReferences('nex.image("Muestra")', 'python'),
      {
        loadAsset: async (assetId) => {
          asked.push(assetId);
          return 'aGVsbG8=';
        },
      }
    );

    expect(asked).toEqual([ASSET]);
    expect(dataset.images[0]?.base64).toBe('aGVsbG8=');
    expect(dataset.images[0]?.mimeType).toBe('image/png');
  });

  it('NO viaja ninguna URL, ni firmada ni de otro tipo', async () => {
    const dataset = await resolveLabDataset(
      withImage,
      scanLabReferences('nex.image("Muestra")', 'python'),
      { loadAsset: async () => 'aGVsbG8=' }
    );

    const serialized = JSON.stringify(dataset);
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(serialized).not.toContain('s3');
    // Tampoco el `assetId`: al código le llega el contenido, no la referencia
    // con la que se podría volver a pedir.
    expect(serialized).not.toContain(ASSET);
  });

  it('sin forma de leer assets se explica, no se entrega una imagen vacía', async () => {
    const dataset = await resolveLabDataset(
      withImage,
      scanLabReferences('nex.image("Muestra")', 'python')
    );

    expect(dataset.images).toHaveLength(0);
    expect(dataset.problems[0]?.kind).toBe('image');
  });

  it('un fallo de la descarga —asset ajeno o borrado— se convierte en error', async () => {
    const dataset = await resolveLabDataset(
      withImage,
      scanLabReferences('nex.image("Muestra")', 'python'),
      {
        loadAsset: async () => {
          throw new Error('No se pudo leer la imagen.');
        },
      }
    );

    expect(dataset.images).toHaveLength(0);
    expect(dataset.problems[0]?.message).toContain('No se pudo leer');
  });

  it('una imagen que no existe no se inventa', async () => {
    const dataset = await resolveLabDataset(
      withImage,
      scanLabReferences('nex.image("Otra")', 'python'),
      { loadAsset: async () => 'aGVsbG8=' }
    );

    expect(dataset.images).toHaveLength(0);
    expect(dataset.problems[0]?.kind).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// La frontera hacia el Worker
// ---------------------------------------------------------------------------

describe('lo que cruza al Worker', () => {
  it('el mensaje se reconstruye campo a campo y descarta lo inyectado', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex.sheet("Ventas")', 'python')
    );

    const hostile = {
      ...dataset,
      ownerUid: 'uid-de-quien-escribio',
      firebaseToken: 'eyJhbGciOiJSUzI1NiJ9.payload.firma',
      signedUrl: 'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=abc',
      sheets: dataset.sheets.map((table) => ({ ...table, storageKey: 'nexbook/uid/a.png' })),
    } as unknown as typeof dataset;

    const message = sanitizeWorkerRun(
      1,
      'python',
      'nex.sheet("Ventas")',
      { maxOutputChars: 100 },
      'session',
      hostile
    );

    const serialized = JSON.stringify(message);
    for (const secret of [
      'uid-de-quien-escribio',
      'eyJhbGciOiJSUzI1NiJ9',
      'X-Amz-Signature',
      'nexbook/uid/a.png',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
    // Y los datos sí llegan.
    expect(serialized).toContain('Tornillo');
  });

  it('una celda sin API no lleva dataset: el mensaje es el de siempre', () => {
    const message = sanitizeWorkerRun(1, 'python', 'print(1)', { maxOutputChars: 100 }, 'session');
    expect('lab' in message).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lo que se le entrega a cada runtime
// ---------------------------------------------------------------------------

describe('el módulo de Python', () => {
  it('lleva los datos como literal y no toca `js`', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex.sheet("Ventas")', 'python')
    );
    const generated = pythonLabModule(dataset);

    expect(generated).toContain('Tornillo');
    expect(generated).toContain('nex = ');
    /**
     * `js` es la única ventana de Python hacia JavaScript y sigue sin usarse:
     * abrirla para pasar una hoja habría cambiado una garantía comprobable por
     * una conveniencia.
     *
     * El límite de palabra NO es decorativo: el módulo sí hace `import json`,
     * y «import json» contiene «import js» como subcadena.
     */
    expect(generated).not.toMatch(/\bimport js\b/);
    expect(generated).not.toContain('jsglobals');
    expect(generated).not.toContain('js.fetch');
  });

  it('un nombre de hoja con comillas no se escapa del literal', async () => {
    const tricky = documentWith({
      id: 's1',
      type: 'spreadsheet',
      name: 'La "buena"',
      sheet: VENTAS,
    });

    const dataset = await resolveLabDataset(
      tricky,
      scanLabReferences('nex.sheet_by_id("s1")', 'python')
    );
    const generated = pythonLabModule(dataset);

    /**
     * La garantía es el doble `JSON.stringify`: el resultado es a la vez una
     * cadena JSON válida y un literal de Python válido, así que un nombre con
     * comillas no puede salirse del literal. Se comprueba que el módulo lleve
     * EXACTAMENTE eso, en vez de adivinar cuántas barras quedan.
     */
    expect(generated).toContain(JSON.stringify(JSON.stringify(dataset)));
    expect(dataset.sheets[0]?.name).toBe('La "buena"');
  });
});

describe('el prólogo de R', () => {
  it('construye data.frames de verdad', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex_sheet("Ventas")', 'r')
    );
    const prelude = rLabPrelude(dataset);

    expect(prelude).toContain('data.frame(');
    expect(prelude).toContain('stringsAsFactors = FALSE');
    expect(prelude).toContain('nex_sheet <- function');
    expect(prelude).toContain('"Tornillo"');
    // Los huecos son `NA`, que es el vacío de R y no una cadena.
    expect(prelude).toContain('NA');
  });

  it('no depende de ningún paquete que haya que instalar', async () => {
    const dataset = await resolveLabDataset(
      ventasDocument,
      scanLabReferences('nex_sheet("Ventas")', 'r')
    );
    const prelude = rLabPrelude(dataset);

    // Instalar paquetes está enmascarado por el prólogo de seguridad de R, y el
    // repositorio de webR está fuera de `connect-src`. Depender de `jsonlite`
    // habría significado abrir la red para leer una hoja.
    for (const forbidden of ['library(', 'require(', 'install.packages', 'jsonlite::']) {
      expect(prelude, forbidden).not.toContain(forbidden);
    }
  });

  it('escapa comillas y barras en los nombres', () => {
    const prelude = rLabPrelude({
      catalog: { sheets: [], images: [], outputs: [] },
      sheets: [
        {
          id: 's1',
          name: 'Ruta C:\\datos "reales"',
          columns: ['a"b'],
          rows: [['x\\y']],
        },
      ],
      images: [],
      outputs: [],
      problems: [],
    });

    expect(prelude).toContain('\\"reales\\"');
    expect(prelude).toContain('C:\\\\datos');
  });

  it('`rString` produce un literal REVERSIBLE', () => {
    /**
     * La propiedad que de verdad importa: lo que entra vuelve a salir. Contar
     * comillas sueltas sería una heurística frágil —el prólogo lleva también
     * cadenas de R con comillas simples— mientras que el ida y vuelta comprueba
     * exactamente lo que se quiere: que el escape no pierde ni cambia nada.
     */
    const values = [
      'La "buena"',
      'C:\\datos',
      'con\nsalto',
      "apóstrofe '",
      'tab\they',
      'Año 2026',
    ];

    for (const value of values) {
      const literal = rString(value);
      expect(literal.startsWith('"') && literal.endsWith('"'), value).toBe(true);
      expect(unescapeR(literal), value).toBe(value);
    }
  });
});

/**
 * Deshace `rString`.
 *
 * Es el lector que R aplicaría al literal, escrito aquí para poder comprobar el
 * viaje de ida y vuelta sin arrancar webR.
 */
function unescapeR(literal: string): string {
  const body = literal.slice(1, -1);
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t' };
  let out = '';

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '\\') {
      out += body[index];
      continue;
    }

    index += 1;
    const next = body[index] ?? '';
    if (next === 'x') {
      out += String.fromCharCode(Number.parseInt(body.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      out += escapes[next] ?? next;
    }
  }

  return out;
}
