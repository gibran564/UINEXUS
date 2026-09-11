import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonEngine } from '../../src/lib/code-engines/python-engine';
import { createREngine } from '../../src/lib/code-engines/r-engine';
import { requiredPythonPackages } from '../../src/lib/code-engines/python-packages';
import { serveCodeEngine } from '../../src/lib/code-engines/worker-bridge';
import type { CodeEngine } from '../../src/lib/code-engines/engine-contract';
import type {
  CodeWorkerRequest,
  CodeWorkerResponse,
} from '../../src/lib/browser-code-runner-protocol';

/**
 * Los motores de verdad.
 *
 * Python se ejecuta AQUÍ, de verdad: `print(2 + 2)` imprime `4` o esta prueba
 * falla. Pyodide funciona igual en Node que en el navegador, así que no hay
 * ninguna razón para conformarse con un doble.
 *
 * R no puede: webR arranca su Worker pasándole una ruta de Windows a
 * `new Worker`, que Node rechaza (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). Es un
 * fallo de webR en esta plataforma, no del proyecto, y no se puede rodear desde
 * aquí. Lo que se hace en consecuencia está explicado en el bloque de R más
 * abajo y anotado en docs/LIMITATIONS.md: no hay ninguna prueba silenciada.
 */

const LIMIT = { maxOutputChars: 20_000 };

// Bajo Vitest, la resolución automática de Pyodide apunta a una ruta del
// sourcemap que no existe. En Node hay que decirle dónde está su paquete.
const PYODIDE_DIR = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));

const python = createPythonEngine({ indexURL: PYODIDE_DIR, loadPyodide });

describe('Python se ejecuta de verdad', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('print(2 + 2) escribe 4', async () => {
    const result = await python.run('print(2 + 2)', LIMIT);

    expect(result.status).toBe('ok');
    expect(result.stdout).toBe('4\n');
    expect(result.stderr).toBe('');
  });

  it('un error de sintaxis se cuenta como fallo del programa', async () => {
    const result = await python.run('def f(:\n  pass', LIMIT);

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('SyntaxError');
    // El traceback no arrastra el andamiaje de Pyodide: lo que se lee apunta al
    // código de quien programa.
    expect(result.stderr).not.toContain('pyodide');
  });

  it('un error en ejecución llega con su mensaje', async () => {
    const result = await python.run('raise ValueError("modelo no factible")', LIMIT);

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('ValueError');
    expect(result.stderr).toContain('modelo no factible');
  });

  it('lo impreso ANTES del error no se pierde', async () => {
    // Es justo lo que se necesita para depurar: saber hasta dónde llegó.
    const result = await python.run('print("antes")\nraise RuntimeError("aquí")', LIMIT);

    expect(result.stdout).toBe('antes\n');
    expect(result.stderr).toContain('RuntimeError');
  });

  it('stderr propio del programa se separa de stdout', async () => {
    const result = await python.run(
      'import sys\nprint("salida")\nsys.stderr.write("aviso\\n")',
      LIMIT
    );

    expect(result.status).toBe('ok');
    expect(result.stdout).toBe('salida\n');
    expect(result.stderr).toContain('aviso');
  });

  it('un programa que imprime sin parar se corta en el límite', async () => {
    const result = await python.run('for i in range(5000): print("x" * 50)', { maxOutputChars: 500 });

    expect(result.stdout.length).toBeLessThanOrEqual(500);
    expect(result.truncated).toBe(true);
  });

  it('cada ejecución empieza con los globales limpios', async () => {
    // Sin esto, un `resultado = 42` de hace tres intentos haría pasar por bueno
    // un programa que ya no lo calcula.
    await python.run('secreto = 42', LIMIT);
    const result = await python.run('print(secreto)', LIMIT);

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('NameError');
  });
});

/**
 * La sesión persistente, ejecutando Python de verdad.
 *
 * Es LA prueba de que un NexBook es un NexBook: definir algo en una celda y
 * usarlo en la siguiente. Si esto falla, el documento computacional no existe.
 */
describe('una sesión de Python conserva el estado entre celdas', () => {
  it('lo definido en una celda se ve en la siguiente', async () => {
    await python.resetSession();

    const first = await python.run('x = 10', LIMIT, 'session');
    expect(first.status).toBe('ok');

    const second = await python.run('print(x * 2)', LIMIT, 'session');
    expect(second.status).toBe('ok');
    expect(second.stdout).toBe('20\n');
  });

  it('también conserva funciones, imports y clases', async () => {
    await python.resetSession();

    await python.run('import math\ndef area(r):\n    return math.pi * r * r', LIMIT, 'session');
    const result = await python.run('print(round(area(2), 2))', LIMIT, 'session');

    expect(result.stdout).toBe('12.57\n');
  });

  it('reiniciar el kernel borra el estado y NO tira el runtime', async () => {
    await python.resetSession();
    await python.run('x = 10', LIMIT, 'session');

    await python.resetSession();
    const afterReset = await python.run('print(x)', LIMIT, 'session');

    expect(afterReset.status).toBe('failed');
    expect(afterReset.stderr).toContain('NameError');

    // Y sigue usable inmediatamente: no hubo que volver a arrancar Pyodide.
    const stillWorks = await python.run('print(1 + 1)', LIMIT, 'session');
    expect(stillWorks.stdout).toBe('2\n');
  });

  it('una ejecución aislada no ve estado previo ni deja residuo', async () => {
    /**
     * Lo que este motor garantiza, y lo que NO.
     *
     * Garantiza que una ejecución aislada empieza con el espacio de nombres
     * vacío y lo deja vacío: ni hereda ni contamina. Eso es lo que hace que un
     * paso de actividad entregue un programa que funciona por sí solo.
     *
     * NO garantiza que una sesión sobreviva a una ejecución aislada en el MISMO
     * motor, porque las dos comparten el `__main__` de Pyodide y aislar de
     * verdad exige vaciarlo. En producción da igual: el editor de actividades y
     * el kernel de un NexBook crean cada uno su propio Worker, con su propio
     * Pyodide (ver `browser-code-runner.ts`), así que nunca comparten espacio.
     */
    await python.resetSession();
    await python.run('compartido = "de la sesión"', LIMIT, 'session');

    const isolated = await python.run('print(compartido)', LIMIT, 'isolated');
    expect(isolated.status).toBe('failed');
    expect(isolated.stderr).toContain('NameError');

    await python.run('intruso = 1', LIMIT, 'isolated');
    const afterIsolated = await python.run('print(intruso)', LIMIT, 'session');
    expect(afterIsolated.status).toBe('failed');
    expect(afterIsolated.stderr).toContain('NameError');
  });

  it('un error en una celda no destruye el estado anterior', async () => {
    // Es lo que se espera de un notebook: equivocarse en la celda 3 no puede
    // obligar a volver a ejecutar la 1 y la 2.
    await python.resetSession();
    await python.run('datos = [1, 2, 3]', LIMIT, 'session');

    const failing = await python.run('datos[99]', LIMIT, 'session');
    expect(failing.status).toBe('failed');

    const after = await python.run('print(len(datos))', LIMIT, 'session');
    expect(after.stdout).toBe('3\n');
  });
});

describe('el código del alumnado no llega a la red', () => {
  it('`import js` no trae fetch, ni XHR, ni WebSocket, ni EventSource', async () => {
    for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
      const result = await python.run(`import js\nprint(js.${api})`, LIMIT);

      expect(result.status, api).toBe('failed');
      expect(result.stderr, api).toContain('AttributeError');
    }
  }, 60_000);

  it('urllib tampoco encuentra por dónde salir', async () => {
    // `urllib` y `requests` en Pyodide van contra `js.fetch`. Sin el puente, no
    // es que estén prohibidos: es que no tienen transporte.
    const result = await python.run(
      'import urllib.request\nurllib.request.urlopen("https://example.com")',
      LIMIT
    );

    expect(result.status).toBe('failed');
  }, 60_000);

  it('no hay forma de instalar paquetes', async () => {
    // Ni `micropip` ni `pip`: lo disponible es la biblioteca estándar.
    const result = await python.run('import micropip', LIMIT);

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('ModuleNotFoundError');
  });
});

/**
 * R.
 *
 * `createREngine` se prueba contra un webR falso porque el de verdad no arranca
 * en Node sobre Windows. Lo que se comprueba es TODO lo que este proyecto
 * escribió: el canal elegido, el prólogo que bloquea la instalación de
 * paquetes, la traducción de la salida de `captureR` a stdout y stderr, el
 * refugio que se purga siempre y el cierre en `dispose`. Lo que no se comprueba
 * aquí es que webR sepa sumar, que es responsabilidad de webR.
 *
 * La ejecución real de R está verificada en navegador y anotada como
 * limitación de la suite en docs/LIMITATIONS.md.
 */
describe('el motor de R', () => {
  interface FakeState {
    options: Record<string, unknown>;
    captureOptions: Record<string, unknown>;
    evaluated: string[];
    captured: string[];
    purges: number;
    closed: boolean;
  }

  function fakeWebR(output: { type: string; data: unknown }[] | (() => never)) {
    const state: FakeState = {
      options: {},
      captureOptions: {},
      evaluated: [],
      captured: [],
      purges: 0,
      closed: false,
    };

    class FakeWebR {
      Shelter: new () => Promise<unknown>;

      constructor(options: Record<string, unknown>) {
        state.options = options;
        const shelter = {
          captureR: async (code: string, captureOptions: Record<string, unknown>) => {
            state.captured.push(code);
            state.captureOptions = captureOptions;
            if (typeof output === 'function') output();
            return { result: {}, output, images: [] };
          },
          purge: async () => {
            state.purges += 1;
          },
        };
        this.Shelter = class {
          constructor() {
            return Promise.resolve(shelter) as never;
          }
        } as never;
      }

      async init(): Promise<void> {}
      async evalRVoid(code: string): Promise<void> {
        state.evaluated.push(code);
      }
      close(): void {
        state.closed = true;
      }
    }

    const engine = createREngine({
      baseUrl: '/runtime/webr/',
      WebRClass: FakeWebR as never,
    });
    return { engine, state };
  }

  it('arranca sin canales que UINexus no puede ofrecer', async () => {
    const { engine, state } = fakeWebR([]);
    await engine.prepare();

    // `Automatic` prefiere SharedArrayBuffer (exige COOP/COEP) y si no cae a un
    // canal con Service Worker. Ninguno de los dos existe aquí, y descubrirlo
    // en tiempo de ejecución sería descubrirlo en clase.
    expect(state.options.channelType).toBe(3);
    expect(state.options.baseUrl).toBe('/runtime/webr/');
    // Sin `interactive: false`, un `readline()` deja R esperando para siempre.
    expect(state.options.interactive).toBe(false);
  });

  it('bloquea la instalación de paquetes antes de la primera línea del alumnado', async () => {
    const { engine, state } = fakeWebR([]);
    await engine.prepare();

    const prologue = state.evaluated.join('\n');
    for (const blocked of ['install.packages', 'download.file', 'url']) {
      expect(prologue, blocked).toContain(blocked);
    }
    expect(state.evaluated).toHaveLength(1);
  });

  it('recorre la ruta de búsqueda entera, no sólo `base`', async () => {
    // La primera versión enmascaraba sólo en `package:base` y dejaba intactas
    // `install.packages` y `download.file`, que viven en `utils`. Se descubrió
    // en el navegador: `download.file` llegó a intentar salir a la red.
    const { engine, state } = fakeWebR([]);
    await engine.prepare();
    const prologue = state.evaluated.join('\n');

    expect(prologue).toContain('search()');
    expect(prologue).toContain('asNamespace');
    // `webr::install` se lee del espacio de nombres: la ruta de búsqueda no la
    // alcanza.
    expect(prologue).toContain('"webr"');
    // Enmascarar en el entorno global las dejaría a un `rm()` de distancia.
    expect(prologue).not.toContain('globalenv()');
  });

  it('el prólogo corre una vez, no en cada ejecución', async () => {
    const { engine, state } = fakeWebR([]);
    await engine.run('cat(1)', LIMIT);
    await engine.run('cat(2)', LIMIT);

    // Arrancar webR cuesta cuarenta y seis megas: el prólogo que bloquea la red
    // se aplica al arrancar, no en cada celda.
    expect(state.evaluated.filter((code) => code.includes('install.packages'))).toHaveLength(1);
    expect(state.captured).toEqual(['cat(1)', 'cat(2)']);
  });

  it('en modo aislado limpia el entorno global ANTES de cada ejecución', async () => {
    // Es lo contrario que en Python: en R hay que trabajar para NO conservar el
    // estado, porque `captureR` evalúa en el global. Sin esto, un objeto de hace
    // tres intentos haría pasar por bueno un programa que ya no lo calcula.
    const { engine, state } = fakeWebR([]);
    await engine.run('cat(1)', LIMIT, 'isolated');
    await engine.run('cat(2)', LIMIT, 'isolated');

    const clears = state.evaluated.filter((code) => code.includes('rm(list'));
    expect(clears).toHaveLength(2);
    // Con `all.names`: sin eso quedarían vivos los objetos que empiezan por
    // punto, que `ls()` esconde y que sí afectan a la ejecución siguiente.
    expect(clears[0]).toContain('all.names = TRUE');
  });

  it('en modo sesión NO limpia nada: es lo que hace que una celda vea la anterior', async () => {
    const { engine, state } = fakeWebR([]);
    await engine.run('x <- 10', LIMIT, 'session');
    await engine.run('cat(x * 2)', LIMIT, 'session');

    expect(state.evaluated.filter((code) => code.includes('rm(list'))).toHaveLength(0);
    expect(state.captured).toEqual(['x <- 10', 'cat(x * 2)']);
  });

  it('reiniciar el kernel vacía el entorno sin cerrar webR', async () => {
    // Reiniciar un kernel en mitad de una clase tiene que costar milisegundos,
    // no otra descarga del runtime.
    const { engine, state } = fakeWebR([]);
    await engine.run('x <- 10', LIMIT, 'session');
    await engine.resetSession();

    expect(state.evaluated.filter((code) => code.includes('rm(list'))).toHaveLength(1);
    expect(state.closed).toBe(false);
  });

  it('captura las condiciones para que un error de R sea un fallo de verdad', async () => {
    // Con `captureConditions: false`, un `print(no_existe)` terminaba como
    // «Finalizado» con el error escondido en stderr. Con `true`, webR lanza.
    const { engine, state } = fakeWebR([]);
    await engine.run('cat(1)', LIMIT);

    expect(state.captureOptions).toMatchObject({
      captureConditions: true,
      captureStreams: true,
      withAutoprint: true,
    });
  });

  it('separa stdout de stderr y no pierde los avisos', async () => {
    const { engine } = fakeWebR([
      { type: 'stdout', data: '4' },
      { type: 'stderr', data: 'texto en stderr' },
      { type: 'warning', data: { message: 'NaNs produced' } },
      { type: 'message', data: { message: 'cargando paquete' } },
    ]);
    const result = await engine.run('cat(2 + 2)', LIMIT);

    expect(result.status).toBe('ok');
    expect(result.stdout).toBe('4\n');
    // Con las condiciones capturadas, los avisos dejan de pasar por stderr;
    // descartarlos dejaría a alguien sin ver «NaNs produced».
    expect(result.stderr).toContain('texto en stderr');
    expect(result.stderr).toContain('Warning: NaNs produced');
    expect(result.stderr).toContain('cargando paquete');
  });

  it('acota la salida igual que Python', async () => {
    const { engine } = fakeWebR(
      Array.from({ length: 200 }, () => ({ type: 'stdout', data: 'x'.repeat(50) }))
    );
    const result = await engine.run('for (i in 1:200) cat(1)', { maxOutputChars: 300 });

    expect(result.stdout).toHaveLength(300);
    expect(result.truncated).toBe(true);
  });

  it('un error de R llega como fallo, sin el andamiaje de webR delante', async () => {
    // webR enmarca la excepción con la llamada donde ocurrió, y desde
    // `captureR` esa llamada es siempre su propio `eval(ei, envir)` o un
    // «unknown source». Ninguna le dice nada a quien programa, y las dos
    // empujan el mensaje útil fuera de la primera línea.
    const cases = [
      ['Error in `eval(ei, envir)`: object ‘no_existe’ not found', 'no_existe'],
      ['Error in unknown source: install.packages() no está disponible.', 'install.packages'],
      ['Error in webR: algo se rompió', 'algo se rompió'],
    ] as const;

    for (const [thrown, expected] of cases) {
      const { engine } = fakeWebR(() => {
        throw new Error(thrown);
      });
      const result = await engine.run('print(x)', LIMIT);

      expect(result.status, thrown).toBe('failed');
      expect(result.stderr, thrown).toContain(expected);
      expect(result.stderr, thrown).not.toContain('eval(ei, envir)');
      expect(result.stderr, thrown).not.toContain('unknown source');
      expect(result.stderr, thrown).not.toContain('Error in webR:');
    }
  });

  it('una llamada del alumnado SÍ se conserva en el error', async () => {
    // Aquí la llamada es informativa: dice en qué función suya falló.
    const { engine } = fakeWebR(() => {
      throw new Error('Error in miFuncion(x): argumento no numérico');
    });
    const result = await engine.run('miFuncion("a")', LIMIT);

    expect(result.stderr).toContain('miFuncion(x)');
  });

  it('el refugio se purga aunque la ejecución falle', async () => {
    // Sin esto, veinte intentos fallidos seguidos dejan veinte montones de
    // objetos vivos y el runtime se queda sin memoria.
    const { engine, state } = fakeWebR(() => {
      throw new Error('boom');
    });
    await engine.run('stop("boom")', LIMIT);

    expect(state.purges).toBe(1);
  });

  it('cerrar el motor cierra webR', async () => {
    const { engine, state } = fakeWebR([]);
    await engine.prepare();
    await engine.dispose();

    expect(state.closed).toBe(true);
  });
});

/**
 * El puente entre el Worker y su motor.
 *
 * Poco código y una responsabilidad que sí importa: que un Worker no ejecute el
 * fuente de un lenguaje que no es el suyo.
 */
describe('el puente del Worker', () => {
  function bridgeWith(engine: CodeEngine) {
    const sent: CodeWorkerResponse[] = [];
    let handler: ((event: { data: unknown }) => void) | null = null;

    serveCodeEngine(
      {
        postMessage: (message) => sent.push(message as CodeWorkerResponse),
        addEventListener: (_type, listener) => {
          handler = listener;
        },
      },
      () => engine
    );

    return {
      sent,
      async send(message: CodeWorkerRequest): Promise<void> {
        handler?.({ data: message });
        // Se deja correr la microcola: el puente responde de forma asíncrona.
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  const stub = (language: 'r' | 'python'): CodeEngine => ({
    language,
    prepare: async () => {},
    run: async () => ({
      status: 'ok' as const,
      stdout: 'listo\n',
      stderr: '',
      truncated: false,
      outputs: [{ seq: 0, stream: 'stdout' as const, text: 'listo\n' }],
    }),
    resetSession: async () => {},
    dispose: async () => {},
  });

  it('responde a prepare y ejecuta su propio lenguaje', async () => {
    const bridge = bridgeWith(stub('python'));

    await bridge.send({ type: 'prepare', id: 1 });
    expect(bridge.sent[0]).toEqual({ type: 'ready', id: 1 });

    await bridge.send({
      type: 'run',
      id: 2,
      language: 'python',
      source: 'print(1)',
      executionOptions: LIMIT,
    });
    expect(bridge.sent[1]).toMatchObject({ type: 'result', id: 2, status: 'ok', stdout: 'listo\n' });
  });

  it('rechaza el fuente de otro lenguaje en vez de dárselo al intérprete', async () => {
    // El servidor ya impone el lenguaje del paso; esto cierra la misma puerta
    // en el navegador, donde el mensaje podría fabricarse desde la consola.
    const bridge = bridgeWith(stub('r'));

    await bridge.send({
      type: 'run',
      id: 1,
      language: 'python',
      source: 'print(1)',
      executionOptions: LIMIT,
    });

    expect(bridge.sent[0]).toMatchObject({ type: 'result', status: 'rejected' });
  });

  it('un runtime que no arranca se informa como error, no se traga', async () => {
    const broken: CodeEngine = {
      ...stub('python'),
      prepare: async () => {
        throw new Error('No se pudo descargar el runtime.');
      },
    };
    const bridge = bridgeWith(broken);

    await bridge.send({ type: 'prepare', id: 1 });

    expect(bridge.sent[0]).toMatchObject({
      type: 'error',
      id: 1,
      message: 'No se pudo descargar el runtime.',
    });
  });

  it('ignora mensajes que no tienen forma de petición', async () => {
    const bridge = bridgeWith(stub('python'));

    await bridge.send({ type: 'run' } as unknown as CodeWorkerRequest);
    await bridge.send(null as unknown as CodeWorkerRequest);

    expect(bridge.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Salidas ricas (iteración 9)
// ---------------------------------------------------------------------------

describe('Python produce salidas ricas', () => {
  beforeAll(async () => {
    await python.prepare();
  }, 120_000);

  it('el orden entre stdout y stderr es el REAL', async () => {
    /**
     * Hasta la iteración 8 esto no se podía comprobar: el motor devolvía dos
     * cadenas y el orden entre ellas se inventaba al pintarlas. Pyodide llama a
     * `stdout` y `stderr` según el programa escribe, así que la información
     * estaba ahí y se tiraba.
     */
    const result = await python.run(
      'import sys\nprint("uno")\nsys.stderr.write("dos\\n")\nprint("tres")',
      LIMIT
    );

    expect(result.status).toBe('ok');
    expect(result.outputs.map((output) => output.stream)).toEqual(['stdout', 'stderr', 'stdout']);
    expect(result.outputs.map((output) => 'text' in output && output.text)).toEqual([
      'uno\n',
      'dos\n',
      'tres\n',
    ]);
  });

  it('una lista de diccionarios se convierte en tabla SIN instalar nada', async () => {
    /**
     * Es el caso que importa de verdad: una tabla rica no debería exigir pandas
     * para existir. Esto es lo que devuelve un `csv.DictReader`.
     */
    const result = await python.run(
      '[{"ciudad": "Durango", "hab": 654876}, {"ciudad": "Lerdo", "hab": 79669}]',
      LIMIT
    );

    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table).toBeDefined();
    if (table?.stream === 'table') {
      expect(table.columns).toEqual(['ciudad', 'hab']);
      expect(table.rows).toEqual([
        ['Durango', 654876],
        ['Lerdo', 79669],
      ]);
      expect(table.totalRows).toBe(2);
    }
  });

  it('un diccionario de listas también', async () => {
    const result = await python.run('{"a": [1, 2], "b": [3, 4]}', LIMIT);

    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table?.stream === 'table' && table.columns).toEqual(['a', 'b']);
    expect(table?.stream === 'table' && table.rows).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it('recorta las filas y DICE cuántas había', async () => {
    // Enseñar 50 de 500 sin decirlo es una mentira sobre los datos.
    const result = await python.run('[{"n": i} for i in range(500)]', LIMIT);

    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table?.stream === 'table' && table.rows.length).toBe(50);
    expect(table?.stream === 'table' && table.totalRows).toBe(500);
  });

  it('un valor que no es tabular no produce tabla', async () => {
    // No se fuerza una representación: `42` ya se entiende como está.
    const result = await python.run('42', LIMIT);
    expect(result.outputs.some((output) => output.stream === 'table')).toBe(false);
  });

  it('un entero enorme se manda como texto, no como número que miente', async () => {
    /**
     * Fuera del rango seguro de JavaScript un entero pierde precisión al
     * convertirse en double. Mandarlo como texto es exacto; mandarlo como número
     * sería enseñar un dato distinto del que calculó Python.
     */
    const result = await python.run('[{"n": 9007199254740993}]', LIMIT);

    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table?.stream === 'table' && table.rows[0]?.[0]).toBe('9007199254740993');
  });

  it('un fallo al describir el valor no convierte la ejecución en error', async () => {
    // La salida rica es un añadido. Un objeto raro no puede hacer que un
    // programa correcto se cuente como fallido.
    const result = await python.run(
      'class Raro:\n    @property\n    def columns(self):\n        raise RuntimeError("no")\n    def __len__(self):\n        return 1\n    iloc = None\nprint("hecho")\nRaro()',
      LIMIT
    );

    expect(result.status).toBe('ok');
    expect(result.stdout).toBe('hecho\n');
  });

  it('el ayudante de salidas ricas sobrevive a la limpieza del espacio', async () => {
    /**
     * Vive en `sys.modules` y no en `__main__` justamente por esto: el
     * aislamiento vacía `__main__` alrededor de cada ejecución, así que un
     * ayudante que viviera ahí desaparecería en cuanto se usara una vez.
     */
    await python.run('x = 1', LIMIT);
    const result = await python.run('[{"a": 1}]', LIMIT);

    expect(result.outputs.some((output) => output.stream === 'table')).toBe(true);
  });
});

/**
 * Los paquetes científicos, con las ruedas publicadas.
 *
 * Se ejecutan contra `public/runtime/pyodide/`, que es EXACTAMENTE el directorio
 * que sirve el navegador: las mismas ruedas, el mismo lockfile recortado. No hay
 * ningún doble.
 *
 * Las ruedas las trae `npm run runtimes:python`, que es opcional a propósito
 * —un `npm run build` sin red tiene que seguir funcionando—. Cuando no están, en
 * vez de saltarse las pruebas se comprueba LO OTRO que tiene que ser cierto: que
 * la ausencia se note como un error explicado y no como una ejecución a medias.
 */
describe('los paquetes de Python publicados', () => {
  const PUBLISHED = fileURLToPath(new URL('../../public/runtime/pyodide/', import.meta.url));
  const vendored = existsSync(PUBLISHED) &&
    readdirSync(PUBLISHED).some((name) => name.startsWith('pandas') && name.endsWith('.whl'));

  const engine = createPythonEngine({ indexURL: PUBLISHED, loadPyodide });

  beforeAll(async () => {
    if (existsSync(PUBLISHED)) await engine.prepare();
  }, 180_000);

  it.runIf(vendored)('pandas produce una tabla ESTRUCTURADA, no HTML', async () => {
    /**
     * Lo que se guarda son columnas y filas, no el HTML que sabe generar pandas.
     * Renderizar marcado que produce el código del alumnado es justo lo que
     * `MarkdownContent` lleva todo el proyecto evitando.
     */
    const result = await engine.run(
      'import pandas as pd\npd.DataFrame({"ciudad": ["Durango", "Lerdo"], "hab": [654876, 79669]})',
      LIMIT
    );

    expect(result.status).toBe('ok');
    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table).toBeDefined();
    if (table?.stream === 'table') {
      expect(table.columns).toEqual(['ciudad', 'hab']);
      expect(table.rows).toEqual([
        ['Durango', 654876],
        ['Lerdo', 79669],
      ]);
    }
  }, 180_000);

  it.runIf(vendored)('`df.head()` de un DataFrame grande dice cuántas filas hay', async () => {
    const result = await engine.run(
      'import pandas as pd\ndf = pd.DataFrame({"n": range(1000)})\ndf',
      LIMIT
    );

    const table = result.outputs.find((output) => output.stream === 'table');
    expect(table?.stream === 'table' && table.rows.length).toBe(50);
    expect(table?.stream === 'table' && table.totalRows).toBe(1000);
  }, 180_000);

  it.runIf(vendored)('matplotlib produce una imagen PNG de verdad', async () => {
    /**
     * `plt.show()` no abre nada: el backend es Agg y se dibuja en memoria. La
     * figura se captura después de ejecutar y se convierte en PNG, que es lo que
     * acaba siendo un asset.
     */
    const result = await engine.run(
      'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [2, 4, 3])\nplt.title("prueba")\nplt.show()',
      LIMIT
    );

    expect(result.status).toBe('ok');
    const image = result.outputs.find((output) => output.stream === 'image');
    expect(image).toBeDefined();
    if (image?.stream === 'image') {
      expect(image.mimeType).toBe('image/png');
      // Los bytes son un PNG de verdad: la firma del formato está ahí.
      const bytes = Buffer.from(image.base64, 'base64');
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  }, 180_000);

  it.runIf(vendored)('las figuras se CIERRAN: la celda siguiente no repite la gráfica', async () => {
    /**
     * Sin cerrarlas, en una sesión persistente cada celda volvería a emitir
     * todas las figuras abiertas y cinco celdas producirían quince imágenes.
     */
    await engine.run('import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()', LIMIT, 'session');
    const second = await engine.run('print("sin gráficas")', LIMIT, 'session');

    expect(second.outputs.some((output) => output.stream === 'image')).toBe(false);
  }, 180_000);

  it.runIf(!vendored)('sin ruedas publicadas, el fallo se EXPLICA', async () => {
    // La ausencia no puede parecer «pandas no existe»: se dice que no se pudo
    // cargar y el programa falla después con su propio ImportError.
    const result = await engine.run('import pandas as pd\nprint(pd.__version__)', LIMIT);

    expect(result.status).toBe('failed');
    expect(result.stderr).toMatch(/No se pudieron cargar los paquetes|ModuleNotFoundError/);
  }, 180_000);

  it('el analizador de imports sólo reconoce la lista blanca', () => {
    /**
     * La diferencia entre una lista blanca y un catálogo abierto:
     * `loadPackagesFromImports` de Pyodide cargaría cualquiera de los 356
     * paquetes del lockfile original. Aquí sólo salen los declarados.
     */
    expect(requiredPythonPackages('import pandas as pd')).toEqual(['pandas']);
    expect(requiredPythonPackages('from matplotlib.pyplot import plot')).toEqual(['matplotlib']);
    expect(requiredPythonPackages('import numpy, pandas')).toEqual(
      expect.arrayContaining(['numpy', 'pandas'])
    );

    // Nada de esto está en la lista, así que no se carga nada.
    expect(requiredPythonPackages('import scipy')).toEqual([]);
    expect(requiredPythonPackages('import micropip')).toEqual([]);
    expect(requiredPythonPackages('import os, sys, json')).toEqual([]);
    // Y una mención dentro de una cadena no es un import.
    expect(requiredPythonPackages('print("import pandas")')).toEqual([]);
  });
});
