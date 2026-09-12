import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonEngine } from '../../src/lib/code-engines/python-engine';
import { emptyNexBookDocument } from '../../src/lib/academic-schemas';
import { resolveLabDataset } from '../../src/lib/lab/data-bridge';
import { scanLabReferences } from '../../src/lib/lab/references';
import { cellKey } from '../../src/lib/spreadsheet/cells';
import type { LabDataset } from '../../src/lib/lab/dataset';
import type { NexBookDocument, NexBookSheetData } from '../../src/lib/types';

/**
 * La API del laboratorio, EJECUTANDO Python de verdad.
 *
 * Las pruebas de `lab-data-bridge.test.ts` comprueban qué se prepara; éstas
 * comprueban que el código del alumnado puede USARLO. Es la diferencia entre
 * «el JSON tiene las filas» y «`nex.sheet("Ventas").rows` devuelve las filas»,
 * que es lo único que importa a quien escribe la celda.
 *
 * R no se puede ejecutar aquí: webR arranca su Worker pasándole una ruta de
 * Windows a `new Worker`, que Node rechaza. Es la misma limitación que ya
 * documenta `code-engines.test.ts` y `docs/LIMITATIONS.md`; el prólogo de R se
 * cubre por su forma en `lab-data-bridge.test.ts` y por el navegador.
 */

const LIMIT = { maxOutputChars: 20_000 };
const PYODIDE_DIR = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));
const python = createPythonEngine({ indexURL: PYODIDE_DIR, loadPyodide });

function sheet(cells: Record<string, string>, rows: number, columns: number): NexBookSheetData {
  return {
    rows,
    columns,
    cells: Object.fromEntries(Object.entries(cells).map(([key, input]) => [key, { input }])),
  };
}

const VENTAS: NexBookDocument = emptyNexBookDocument([
  {
    id: 'sheet-ventas',
    type: 'spreadsheet',
    name: 'Ventas',
    sheet: sheet(
      {
        [cellKey(0, 0)]: 'producto',
        [cellKey(0, 1)]: 'unidades',
        [cellKey(0, 2)]: 'precio',
        [cellKey(1, 0)]: 'Tornillo',
        [cellKey(1, 1)]: '10',
        [cellKey(1, 2)]: '2.5',
        [cellKey(2, 0)]: 'Tuerca',
        [cellKey(2, 1)]: '4',
        [cellKey(2, 2)]: '1.25',
        [cellKey(3, 0)]: 'Arandela',
        [cellKey(3, 1)]: '=SUMA(B2:B3)',
        [cellKey(3, 2)]: '0.5',
      },
      4,
      3
    ),
  },
]);

const labFor = (source: string, document = VENTAS): Promise<LabDataset> =>
  resolveLabDataset(document, scanLabReferences(source, 'python'));

describe('Spreadsheet → Python, ejecutando de verdad', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('`nex.sheet("Ventas")` devuelve columnas y filas', async () => {
    const source = [
      'ventas = nex.sheet("Ventas")',
      'print(ventas.columns)',
      'print(len(ventas))',
      'print(ventas.rows[0])',
    ].join('\n');

    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.status).toBe('ok');
    expect(result.stdout).toContain("['producto', 'unidades', 'precio']");
    expect(result.stdout).toContain('3');
    expect(result.stdout).toContain("['Tornillo', 10, 2.5]");
  });

  it('los valores llegan con su TIPO, no como texto', async () => {
    const source = [
      'v = nex.sheet("Ventas")',
      'print(type(v.rows[0][1]).__name__)',
      'print(sum(v.column("unidades")))',
    ].join('\n');

    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.status).toBe('ok');
    // 10 es un número, no la cadena "10": si no, `sum` fallaría.
    expect(result.stdout).toContain('int');
    // 10 + 4 + 14 (la fórmula ya calculada) = 28.
    expect(result.stdout).toContain('28');
  });

  it('una fórmula de la hoja llega YA CALCULADA', async () => {
    const source = 'print(nex.sheet("Ventas").rows[2][1])';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.stdout.trim()).toBe('14');
  });

  it('`to_dicts()` usa los encabezados como claves', async () => {
    const source = 'print(nex.sheet("Ventas").to_dicts()[1]["producto"])';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.stdout.trim()).toBe('Tuerca');
  });

  it('`sheet_by_id` funciona, y MOVER el bloque no lo rompe', async () => {
    const moved = emptyNexBookDocument([
      { id: 'md', type: 'markdown', source: '# Antes no estaba' },
      ...VENTAS.blocks,
    ]);

    const source = 'print(nex.sheet_by_id("sheet-ventas").rows[0][0])';
    const result = await python.run(source, LIMIT, 'session', await labFor(source, moved));

    expect(result.stdout.trim()).toBe('Tornillo');
  });

  it('`nex.sheets()` lista lo disponible sin traer los datos', async () => {
    const source = 'print([s["name"] for s in nex.sheets()])';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.stdout).toContain("['Ventas']");
  });

  it('una hoja que no existe LANZA con un mensaje que dice cuáles hay', async () => {
    const source = 'nex.sheet("Costos")';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('Costos');
    expect(result.stderr).toContain('Ventas');
  });

  it('una columna que no existe también, en vez de devolver vacío', async () => {
    const source = 'nex.sheet("Ventas").column("margen")';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('margen');
    expect(result.stderr).toContain('unidades');
  });

  it('una referencia calculada explica POR QUÉ no se pudo preparar', async () => {
    const source = 'nombre = "Ventas"\nnex.sheet(nombre)';
    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('literal');
  });
});

describe('el sandbox no se abre por tener datos', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('`nex` no expone ninguna puerta hacia JavaScript', async () => {
    const source = [
      'import json',
      'print(json.dumps(sorted(n for n in dir(nex) if not n.startswith("_"))))',
    ].join('\n');

    const result = await python.run(source, LIMIT, 'session', await labFor('nex.sheet("Ventas")'));

    expect(result.status).toBe('ok');
    // La superficie es exactamente ésta: leer hojas, imágenes y outputs.
    expect(JSON.parse(result.stdout.trim())).toEqual([
      'image',
      'image_by_id',
      'images',
      'output',
      'output_by_id',
      'outputs',
      'sheet',
      'sheet_by_id',
      'sheets',
    ]);
  });

  it('con datos preparados, la red SIGUE sin existir', async () => {
    /**
     * La prueba que de verdad importa de esta fase: dar acceso a los datos del
     * NexBook no puede devolver al código la capacidad de salir a internet.
     */
    /**
     * `import js` SÍ funciona, y eso no es un agujero: `jsglobals` es un objeto
     * vacío y congelado, así que el módulo existe y no tiene NADA dentro. La
     * garantía que hay que comprobar no es que el import falle —fallaría por un
     * motivo que podría cambiar— sino que `fetch`, `XMLHttpRequest`, `WebSocket`
     * y `EventSource` no estén, y que una petición real no salga.
     */
    const source = [
      'ventas = nex.sheet("Ventas")',
      'import js',
      'for nombre in ("fetch", "XMLHttpRequest", "WebSocket", "EventSource"):',
      '    print(nombre, hasattr(js, nombre))',
      'try:',
      '    from urllib.request import urlopen',
      '    urlopen("https://example.com")',
      '    print("HAY RED")',
      'except Exception as error:',
      '    print("sin red:", type(error).__name__)',
    ].join('\n');

    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    expect(result.stdout).toContain('fetch False');
    expect(result.stdout).toContain('XMLHttpRequest False');
    expect(result.stdout).toContain('WebSocket False');
    expect(result.stdout).toContain('EventSource False');
    expect(result.stdout).not.toContain('HAY RED');
    expect(result.stdout).toContain('sin red:');
  });

  it('el dataset no lleva credenciales ni identificadores internos', async () => {
    const source = [
      'import json',
      'print(json.dumps(nex.sheets()))',
      'print(json.dumps(nex.images()))',
    ].join('\n');

    const result = await python.run(source, LIMIT, 'session', await labFor(source));

    for (const secret of ['Authorization', 'Bearer', 'X-Amz', 'amazonaws', 'ownerUid', 'uid']) {
      expect(result.stdout, secret).not.toContain(secret);
    }
  });

  it('una celda sin API de laboratorio no define `nex` en absoluto', async () => {
    await python.resetSession();
    // Sin dataset, el módulo no se instala: quien no lo usa no lo paga.
    const result = await python.run('print("nex" in dir())', LIMIT, 'session');

    expect(result.stdout.trim()).toBe('False');
  });
});

describe('outputs persistidos hacia Python', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('una tabla guardada por otra celda se lee como datos', async () => {
    const withOutput: NexBookDocument = {
      ...emptyNexBookDocument([
        { id: 'limpieza', type: 'code', language: 'python', source: '# produjo una tabla' },
      ]),
      results: {
        limpieza: {
          blockId: 'limpieza',
          status: 'ok',
          durationMs: 5,
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

    const source = [
      't = nex.output("limpieza")',
      'print(t.columns)',
      'print(sum(t.column("total")))',
    ].join('\n');

    const result = await python.run(
      source,
      LIMIT,
      'session',
      await resolveLabDataset(withOutput, scanLabReferences(source, 'python'))
    );

    expect(result.status).toBe('ok');
    expect(result.stdout).toContain("['producto', 'total']");
    expect(result.stdout).toContain('30');
  });
});

describe('imágenes hacia Python', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('el código recibe BYTES, no una URL', async () => {
    const document = emptyNexBookDocument([
      {
        id: 'img1',
        type: 'image',
        assetId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        mimeType: 'image/png',
        alt: 'Muestra',
      },
    ]);

    const source = [
      'img = nex.image("Muestra")',
      'print(type(img.bytes).__name__)',
      'print(len(img))',
      'print(img.mime_type)',
      'print(img.bytes[:4])',
    ].join('\n');

    // «hola» en Base64. Los bytes los descarga el hilo principal con sesión.
    const dataset = await resolveLabDataset(document, scanLabReferences(source, 'python'), {
      loadAsset: async () => 'aG9sYQ==',
    });

    const result = await python.run(source, LIMIT, 'session', dataset);

    expect(result.status).toBe('ok');
    expect(result.stdout).toContain('bytes');
    expect(result.stdout).toContain('4');
    expect(result.stdout).toContain('image/png');
    expect(result.stdout).toContain("b'hola'");
    // Y en ningún momento apareció una dirección.
    expect(result.stdout).not.toContain('http');
  });
});
