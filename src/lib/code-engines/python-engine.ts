import type { loadPyodide as loadPyodideType } from 'pyodide';
import {
  LimitedOutput,
  type CodeEngine,
  type CodeEngineRun,
  type CodeExecutionMode,
} from './engine-contract';
import { pythonDisplayModule } from './python-display';
import { pythonLabModule } from './python-lab';
import type { LabDataset } from '../lab/dataset';
import { requiredPythonPackages } from './python-packages';
import { NEXBOOK_LIMITS } from '../constants';
import type { BrowserExecutionOptions, BrowserTableCell } from '../browser-code-runner-protocol';

/**
 * Python dentro del navegador, con Pyodide.
 *
 * ## Por qué el código del alumnado no ve la red
 *
 * Pyodide expone JavaScript a Python a través de UN solo objeto: el que se pasa
 * como `jsglobals`, que es lo que Python ve al hacer `import js`. Aquí se pasa
 * un objeto vacío y congelado, así que `js.fetch`, `js.XMLHttpRequest`,
 * `js.WebSocket` y `js.EventSource` sencillamente NO EXISTEN para el programa.
 * No están «bloqueados» con un parche que alguien pueda rodear: no están.
 *
 * Eso arrastra a las bibliotecas estándar que dependen de ellos: `urllib` y
 * `requests` en Pyodide van contra `js.fetch`, y sin `js` no tienen por dónde
 * salir. Es la barrera que se puede PROBAR, y está probada.
 *
 * El endurecimiento de los globales del propio Worker (`self.fetch = …`) es la
 * segunda capa y vive en `workers/python-runner.worker.ts`, no aquí: este
 * módulo también se ejecuta en las pruebas, y envenenar el `globalThis` del
 * proceso de pruebas para demostrar algo sería absurdo.
 *
 * ## Paquetes
 *
 * Desde la iteración 9 sí se llama a `loadPackage`, y SÓLO con nombres de una
 * lista blanca declarada en `python-packages.ts`: numpy, pandas y matplotlib.
 * `micropip` sigue sin instalarse y `pip` sigue sin existir dentro del
 * intérprete, así que lo que alguien escriba en su celda no puede ampliar esa
 * lista.
 *
 * Y no es acceso a la red: las ruedas se sirven desde `indexURL`, que es
 * `/runtime/pyodide/` del PROPIO origen (las publica
 * `scripts/vendor-python-packages.mjs`, verificadas contra el `sha256` del
 * lockfile instalado). El endurecimiento del Worker sigue dejando `fetch`
 * inutilizado tras el arranque y la CSP sigue en `'self'`.
 */

type PyodideAPI = Awaited<ReturnType<typeof loadPyodideType>>;
type LoadPyodide = typeof loadPyodideType;

export interface PythonEngineOptions {
  /** Dónde están los assets del runtime. */
  indexURL: string;
  /**
   * El cargador, inyectable.
   *
   * En el navegador NO se pasa: se toma del propio `indexURL`, y ésa es la
   * decisión importante. Empaquetar `pyodide` con webpack arrastra sus ramas de
   * Node (`node:fs`, `node:path`) al bundle del cliente y obliga a neutralizar
   * media docena de módulos en la configuración de Next para conseguir, con
   * suerte, la misma versión que ya está publicada en `/runtime/pyodide/`.
   * Cargarla de ahí garantiza que el `pyodide.mjs` y el `.wasm` que se ejecutan
   * salieron de la misma copia.
   *
   * Las pruebas sí lo inyectan: en Node no hay servidor del que descargar nada.
   */
  loadPyodide?: LoadPyodide;
}

/** Carga el módulo publicado en `indexURL`, fuera del grafo del empaquetador. */
async function importPyodide(indexURL: string): Promise<LoadPyodide> {
  const runtime = (await import(/* webpackIgnore: true */ `${indexURL}pyodide.mjs`)) as {
    loadPyodide: LoadPyodide;
  };
  return runtime.loadPyodide;
}

export function createPythonEngine(options: PythonEngineOptions): CodeEngine {
  let booting: Promise<PyodideAPI> | null = null;
  let active: LimitedOutput | null = null;

  async function boot(): Promise<PyodideAPI> {
    if (booting) return booting;

    booting = (async () => {
      const load = options.loadPyodide ?? (await importPyodide(options.indexURL));
      const pyodide = await load({
        indexURL: options.indexURL,
        // La ÚNICA ventana de Python hacia JavaScript, y está vacía.
        jsglobals: Object.freeze(Object.create(null)) as object,
        /**
         * Estas dos llamadas son lo que hace posible el ORDEN REAL.
         *
         * Pyodide las invoca según el programa escribe, así que la secuencia
         * llega tal cual ocurrió. Hasta la iteración 8 el acumulador las
         * separaba en dos cadenas y esa información se perdía; ahora el
         * registro conserva el orden. Ver `output-recorder.ts`.
         */
        stdout: (line: string) => active?.line('stdout', line),
        stderr: (line: string) => active?.line('stderr', line),
      });

      await installDisplayHelpers(pyodide);
      return pyodide;
    })();

    try {
      return await booting;
    } catch (caught) {
      // Un arranque fallido no puede quedar cacheado: el siguiente intento
      // tiene que poder volver a probar.
      booting = null;
      throw caught;
    }
  }

  return {
    language: 'python',

    async prepare(): Promise<void> {
      await boot();
    },

    async run(
      source: string,
      runOptions: BrowserExecutionOptions,
      mode: CodeExecutionMode = 'isolated',
      lab?: LabDataset
    ): Promise<CodeEngineRun> {
      const pyodide = await boot();
      const output = new LimitedOutput(runOptions.maxOutputChars);
      active = output;

      /**
       * El aislamiento se consigue LIMPIANDO el espacio de nombres, no pasando
       * uno distinto.
       *
       * La alternativa —pasar un diccionario propio como `globals` a
       * `runPythonAsync`— deja el aislamiento en manos de cómo Pyodide resuelva
       * ese diccionario, que es un detalle interno suyo y no una garantía que
       * este proyecto pueda comprobar. Si algún día cambiara, el síntoma sería
       * que un paso de actividad hereda variables del intento anterior y alguien
       * entrega un programa que sólo funciona en su navegador: un fallo
       * silencioso y difícil de atribuir.
       *
       * Ejecutar siempre contra `__main__` y vaciarlo alrededor es observable
       * desde Python —se puede listar `globals()` y comprobarlo— y queda
       * simétrico con el motor de R, que ya hacía exactamente esto.
       */
      if (mode === 'isolated') await clearNamespace(pyodide);

      try {
        /**
         * Las ruedas se cargan ANTES de ejecutar y sólo las de la lista blanca.
         *
         * Si falta el archivo —porque no se ejecutó `npm run runtimes:python`—
         * esto lanza contra el propio origen y el mensaje lo dice. Es preferible
         * a un `ImportError` seco, que haría pensar que el paquete no existe.
         */
        await loadRequiredPackages(pyodide, source, output);

        /**
         * La API del laboratorio se instala DESPUÉS de limpiar y ANTES del
         * fuente.
         *
         * Después de limpiar, porque en modo aislado `clearNamespace` se lleva
         * todo lo que no empiece por `__` y se llevaría también `nex`. Antes del
         * fuente, porque la celda lo usa en su primera línea.
         *
         * Y sólo cuando hay datos: una celda que no menciona la API no paga ni
         * la serialización ni un nombre más en su espacio global.
         */
        if (lab) await pyodide.runPythonAsync(pythonLabModule(lab));

        const value = await pyodide.runPythonAsync(source);
        emitRichValue(pyodide, value, output);
        destroy(value);
        emitFigures(pyodide, output);
        return output.toRun('ok');
      } catch (caught) {
        // `error` y no `stderr`: un traceback no es un aviso, y la interfaz lo
        // pinta distinto. En la cadena plana sigue cayendo en stderr, así que la
        // consola de una actividad no cambia.
        output.append('error', describePythonError(caught));
        // Una celda que falló a mitad puede haber dibujado algo antes. Emitirlo
        // ayuda a ver DÓNDE falló; no emitirlo deja la figura abierta y saldría
        // en la celda siguiente como si fuera suya.
        emitFigures(pyodide, output);
        return output.toRun('failed');
      } finally {
        /**
         * Aislado limpia ANTES y DESPUÉS.
         *
         * Antes, para no heredar nada; después, para no dejar nada. Sin la
         * segunda mitad, una ejecución aislada dejaría sus variables en el
         * espacio de nombres y la siguiente —de cualquier modo— las vería.
         */
        if (mode === 'isolated') {
          try {
            await clearNamespace(pyodide);
          } catch {
            // Si esto falla, la limpieza de la ejecución siguiente lo cubre.
          }
        }
        active = null;
      }
    },

    async resetSession(): Promise<void> {
      // Vaciar el espacio de nombres, no tirar el runtime: reiniciar un kernel
      // en mitad de una clase tiene que costar milisegundos.
      if (!booting) return;
      await clearNamespace(await boot());
    },

    async dispose(): Promise<void> {
      booting = null;
      active = null;
    },
  };
}

/**
 * El traceback de Pyodide, recortado a lo que le sirve a quien programa.
 *
 * Las primeras líneas son siempre el andamiaje de Pyodide (`runPythonAsync`,
 * `eval_code_async`…) y no dicen nada del programa del alumnado. Se queda la
 * parte que apunta a su código.
 */
function describePythonError(caught: unknown): string {
  const text = caught instanceof Error ? caught.message : String(caught);
  const marker = text.indexOf('File "<exec>"');
  const trimmed = marker > 0 ? `Traceback (most recent call last):\n  ${text.slice(marker)}` : text;
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
}

/** Los objetos de Pyodide se liberan a mano: no los recoge el GC de JS. */
function destroy(value: unknown): void {
  if (value && typeof value === 'object' && 'destroy' in value) {
    try {
      (value as { destroy: () => void }).destroy();
    } catch {
      // Ya liberado. No hay nada que hacer y no cambia el resultado.
    }
  }
}

/**
 * Deja `__main__` como recién arrancado.
 *
 * Se conservan los nombres con doble guión bajo (`__name__`, `__builtins__`…):
 * sin `__builtins__` el intérprete deja de poder llamar a `print`. Todo lo
 * demás —variables, funciones, clases y módulos importados— se va, que es lo que
 * significa «empezar limpio».
 */
/**
 * Una comprensión y no un bucle `for`.
 *
 * Un bucle deja su variable suelta en el propio espacio que acaba de limpiar, y
 * borrarla después con `del` falla cuando la lista estaba vacía —porque entonces
 * nunca se creó—. Las comprensiones tienen su propio ámbito en Python 3, así que
 * `k` no sobrevive y el resultado es idempotente: limpiar un espacio ya limpio
 * no es un error.
 */
const CLEAR_NAMESPACE =
  '[globals().pop(k) for k in [k for k in list(globals()) if not k.startswith("__")]]';

async function clearNamespace(pyodide: PyodideAPI): Promise<void> {
  await pyodide.runPythonAsync(CLEAR_NAMESPACE);
}

// ---------------------------------------------------------------------------
// Salidas ricas (iteración 9)
// ---------------------------------------------------------------------------

/** Nombre del módulo de ayuda. Empieza por `_` para no chocar con nada real. */
const DISPLAY_MODULE = '_uinexus_display';

/**
 * Instala el ayudante de salidas ricas y fija el backend de matplotlib.
 *
 * `MPLBACKEND=AGG` se pone ANTES de que nadie pueda importar matplotlib. El
 * backend por defecto en Pyodide intenta dibujar en un canvas del documento, y
 * dentro de un Worker no hay documento: la figura no aparecería en ningún sitio
 * y `savefig` tendría que pelearse con un backend a medio inicializar. Con Agg
 * se dibuja en memoria, que es exactamente lo que hace falta para convertirla en
 * un PNG.
 */
async function installDisplayHelpers(pyodide: PyodideAPI): Promise<void> {
  const helpers = pythonDisplayModule({
    maxRows: NEXBOOK_LIMITS.maxTableRows,
    maxColumns: NEXBOOK_LIMITS.maxTableColumns,
    maxCellChars: NEXBOOK_LIMITS.maxTableCellChars,
  });

  await pyodide.runPythonAsync(`
import os as _os, sys as _sys, types as _types
_os.environ["MPLBACKEND"] = "AGG"
_mod = _types.ModuleType(${JSON.stringify(DISPLAY_MODULE)})
exec(${JSON.stringify(helpers)}, _mod.__dict__)
_sys.modules[${JSON.stringify(DISPLAY_MODULE)}] = _mod
del _os, _sys, _types, _mod
`);
}

/**
 * Carga las ruedas que pida el fuente, si están en la lista blanca.
 *
 * Un fallo aquí NO tumba la ejecución: se anota en stderr y se sigue. El
 * programa fallará después con su propio `ImportError`, que es donde quien
 * escribe el código espera verlo, y arriba queda la explicación de por qué.
 */
async function loadRequiredPackages(
  pyodide: PyodideAPI,
  source: string,
  output: LimitedOutput
): Promise<void> {
  const packages = requiredPythonPackages(source);
  if (packages.length === 0) return;

  try {
    await pyodide.loadPackage(packages);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    output.line(
      'stderr',
      `No se pudieron cargar los paquetes ${packages.join(', ')}: ${detail}`
    );
  }
}

/**
 * El valor de la última expresión, como salida rica si la tiene.
 *
 * Es SÍNCRONO y con `try` alrededor de todo: lo que se está haciendo es un
 * añadido a la salida, y un fallo aquí no puede convertir una ejecución correcta
 * en un error. Si algo va mal, la celda se queda con el texto que ya imprimió.
 */
function emitRichValue(pyodide: PyodideAPI, value: unknown, output: LimitedOutput): void {
  if (value === undefined || value === null) return;

  let describe: unknown;
  try {
    describe = pyodide.runPython(`__import__(${JSON.stringify(DISPLAY_MODULE)}).describe`);
    if (typeof describe !== 'function') return;

    const json = (describe as (input: unknown) => unknown)(value);
    if (typeof json !== 'string') return;

    const parsed = JSON.parse(json) as {
      kind?: string;
      columns?: unknown;
      rows?: unknown;
      totalRows?: unknown;
    };
    if (parsed.kind !== 'table') return;
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return;

    output.table(
      parsed.columns.map(String),
      parsed.rows.map((row) => (Array.isArray(row) ? (row as BrowserTableCell[]) : [])),
      typeof parsed.totalRows === 'number' ? parsed.totalRows : parsed.rows.length
    );
  } catch {
    // Ni el valor se pudo describir ni hace falta decirlo: la celda ya tiene su
    // salida de texto y ésta era una mejora, no el resultado.
  } finally {
    destroy(describe);
  }
}

/** Las figuras pendientes de matplotlib, como PNG. Nunca lanza. */
function emitFigures(pyodide: PyodideAPI, output: LimitedOutput): void {
  try {
    const json = pyodide.runPython(
      `__import__(${JSON.stringify(DISPLAY_MODULE)}).capture_figures()`
    );
    if (typeof json !== 'string' || json === '[]') return;

    const figures = JSON.parse(json) as { base64?: unknown; width?: unknown; height?: unknown }[];
    for (const figure of figures) {
      if (typeof figure.base64 !== 'string' || !figure.base64) continue;
      output.image(
        figure.base64,
        'image/png',
        typeof figure.width === 'number' ? figure.width : undefined,
        typeof figure.height === 'number' ? figure.height : undefined
      );
    }
  } catch {
    // matplotlib no está, o la figura no se pudo guardar. En los dos casos la
    // celda se queda con su texto, que es mejor que un fallo de ejecución.
  }
}
