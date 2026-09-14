import type { CodeEngine } from './engine-contract';
import {
  isCodeWorkerResponse,
  type CodeWorkerRequest,
  type CodeWorkerResponse,
} from '../browser-code-runner-protocol';
import type { CodeProject } from '../code-runner-contract';
import { normalizeWorkspacePath } from '../workspace-files';

/**
 * El bucle de mensajes que comparten los dos Workers de ejecución.
 *
 * Es intencionadamente corto. Todo lo que merece una prueba está en el motor
 * (`code-engines/*-engine.ts`), que sí se ejecuta en Node; lo que queda aquí es
 * traducción de mensajes y el endurecimiento del propio Worker, que sólo tiene
 * sentido dentro de un Worker de verdad.
 *
 * NO hay reloj aquí. Un Worker colgado no puede medirse a sí mismo: el tiempo
 * límite lo lleva `lib/browser-code-runner.ts` desde el hilo principal, y su
 * forma de aplicarlo es terminar este Worker. Por eso tampoco hay estado que
 * valga la pena conservar entre ejecuciones más allá del runtime.
 */

/** Un `self` de Worker, sin obligar a quien llama a traer los tipos DOM. */
interface WorkerScope {
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', handler: (event: { data: unknown }) => void) => void;
}

/**
 * Deja el Worker sin las salidas que el código del alumnado podría usar.
 *
 * Se ejecuta DESPUÉS de que el runtime haya arrancado, porque arrancarlo es
 * justamente lo que necesita `fetch` para traerse su WebAssembly.
 *
 * Es la segunda capa, no la primera. La primera es que ni Python ni R reciben
 * un puente hacia estos objetos (ver `python-engine.ts`), y la de fuera es la
 * CSP. Ésta cubre el hueco intermedio: una biblioteca del runtime que
 * decidiera llamar a `fetch` por su cuenta.
 *
 * ## Por qué `fetch` se ACOTA en vez de desaparecer
 *
 * Hasta la iteración 9 se sustituía por una función que siempre lanzaba, y eso
 * era correcto mientras no quedara ninguna descarga legítima pendiente. Dejó de
 * serlo al añadir los paquetes de Python: `loadPackage` trae la rueda de pandas
 * o de matplotlib DURANTE una ejecución, no al arrancar, porque cuál hace falta
 * depende del código de la celda. Cargarlas todas por si acaso serían dieciséis
 * megas en cada kernel.
 *
 * El resultado se vio en el navegador —y sólo ahí, porque las pruebas del motor
 * no pasan por este endurecimiento—: «El acceso de red está deshabilitado» en
 * mitad de un `import matplotlib`.
 *
 * Así que la regla deja de ser «este Worker no puede pedir nada» y pasa a ser
 * «este Worker sólo puede pedir SUS PROPIOS assets»:
 *
 *   ✓  /runtime/pyodide/pandas-3.0.2-…whl     mismo origen, prefijo del runtime
 *   ✗  https://ejemplo.mx/robar                otro origen
 *   ✗  /api/nexbooks/abc                       mismo origen, fuera del prefijo
 *
 * La garantía que importa se conserva entera: no hay forma de sacar datos ni de
 * alcanzar la API de Nextudio. Y lo que queda alcanzable son archivos estáticos
 * públicos que ese mismo Worker ya descargó para arrancar.
 *
 * ## Por qué la lista es una LISTA
 *
 * Hasta J1 bastaba un prefijo porque Pyodide y webR se sirven del propio origen.
 * Java no: CheerpJ Community Edition no se puede autoalojar, así que su runtime
 * sale del CDN de Leaning Technologies y además pide recursos TARDÍOS —el
 * `rt.jar` del JRE 8, la zona horaria— DURANTE la ejecución, no al arrancar. Eso
 * obliga a permitir dos prefijos a la vez y ni uno más:
 *
 *   ✓  https://cjrtnc.leaningtech.com/4.3/8/jre/lib/rt.jar   con la VERSIÓN dentro
 *   ✓  /runtime/java/ecj-3.13.102.jar                        el compilador
 *   ✗  https://cjrtnc.leaningtech.com/4.4/…                  otra versión
 *   ✗  /api/private/hit                                      mismo origen, API
 *
 * Lo que sigue sin existir es una regla «mismo origen vale»: eso habría dejado
 * `/api/*` al alcance de cualquier `HttpURLConnection` escrito en una tarea, que
 * es el agujero que J0 demostró en su control negativo. Ver
 * `code-engines/java-toolchain.ts`, donde la lista vive fijada y versionada.
 */
export interface WorkerHardeningOptions {
  /**
   * Si `indexedDB` sigue existiendo después de arrancar.
   *
   * Por defecto NO, y así sigue siendo para Python y R: ninguno de los dos
   * guarda nada entre ejecuciones y quitarlo cierra una vía de persistencia.
   *
   * Java lo necesita, y no es un capricho suyo: el sistema de archivos `/files`
   * de CheerpJ —donde se compilan las clases de cada ejecución— está respaldado
   * por IndexedDB, y esas escrituras ocurren DURANTE la ejecución, después del
   * endurecimiento. Quitarlo dejaría al compilador sin dónde escribir.
   *
   * Lo que no cambia es la frontera que importa: el código del alumnado se
   * ejecuta dentro de la JVM de CheerpJ y no tiene ningún puente hacia
   * JavaScript, así que `indexedDB` no está a su alcance ni con el objeto
   * presente. Y el namespace que se escribe ahí se borra al terminar cada
   * ejecución (ver `java-harness.ts`).
   */
  keepPersistentStorage?: boolean;
  /**
   * Dónde se aplica la política. Por defecto, los globales de quien llama.
   *
   * Existe porque este endurecimiento es IRREVERSIBLE a propósito: sustituye cada
   * global con `configurable: false` para que el código del alumnado no pueda
   * devolverlo a su sitio. Eso también significa que aplicarlo sobre el
   * `globalThis` del proceso de pruebas lo rompe para el resto del archivo, y una
   * política de seguridad que no se puede probar es una política en la que hay que
   * creer.
   *
   * Así que la prueba le pasa un objeto y comprueba el resultado; el Worker no le
   * pasa nada y endurece el suyo. La política es la misma en los dos casos, que es
   * justo lo que hace que la prueba valga.
   */
  scope?: Record<string, unknown>;
}

export function hardenWorkerScope(
  allowed?: string | readonly string[],
  options: WorkerHardeningOptions = {}
): void {
  const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>);
  const refuse = (): never => {
    throw new Error('El acceso de red está deshabilitado durante la ejecución.');
  };

  const prefixes = allowed === undefined ? [] : typeof allowed === 'string' ? [allowed] : allowed;
  const base = (scope as { location?: { href?: string } }).location?.href;
  const realFetch = typeof scope.fetch === 'function' ? (scope.fetch as typeof fetch) : null;

  /**
   * Un `fetch` bloqueado devuelve una promesa RECHAZADA, no una excepción.
   *
   * Parece un detalle y no lo es. `fetch` es asíncrono por contrato, y quien lo
   * llama escribe `fetch(url).then(…)` o `await fetch(url)`; una excepción
   * síncrona se escapa por un camino que ese código no vigila. Con CheerpJ el
   * síntoma fue exactamente ése: la capa de red de Java se quedaba a medias y el
   * hilo NO recibía su `IOException`, así que el programa se colgaba hasta el
   * tiempo límite en vez de ver su petición rechazada. Con la promesa rechazada
   * Java recibe el error y sigue su curso, que es lo que tiene que pasar.
   */
  const denyFetch = (): Promise<Response> =>
    Promise.reject(new Error('El acceso de red está deshabilitado durante la ejecución.'));

  if (realFetch && prefixes.length > 0) {
    replace(scope, 'fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!isRuntimeAsset(input, prefixes, base)) return denyFetch();
      return realFetch(input, init);
    }) as typeof fetch);
  } else {
    replace(scope, 'fetch', denyFetch);
  }

  /**
   * `XMLHttpRequest` se ACOTA en vez de desaparecer, por la misma razón.
   *
   * Un `fetch` prohibido es un rechazo limpio; un `XMLHttpRequest` que no existe
   * es un `TypeError` dentro de CheerpJ, y CheerpJ lo usa para leer `/app` y sus
   * recursos tardíos. Se aplica la MISMA lista blanca en `open()`, que es donde
   * se conoce la URL, y así una petición a `/api/*` desde Java falla mientras el
   * runtime sigue pudiendo leer su propio `rt.jar`.
   */
  const RealXHR = scope.XMLHttpRequest;
  if (typeof RealXHR === 'function' && prefixes.length > 0) {
    const Guarded = function (this: unknown): XMLHttpRequest {
      const request = new (RealXHR as new () => XMLHttpRequest)();
      const open = request.open.bind(request) as XMLHttpRequest['open'];
      request.open = ((method: string, url: string | URL, ...rest: unknown[]) => {
        if (!isRuntimeAsset(url, prefixes, base)) refuse();
        return (open as (...args: unknown[]) => void)(method, url, ...rest);
      }) as XMLHttpRequest['open'];
      return request;
    };
    replace(scope, 'XMLHttpRequest', Guarded);
  } else {
    replace(scope, 'XMLHttpRequest', refuse);
  }

  // Lo demás desaparece entero: ningún runtime los necesita después de arrancar.
  for (const name of ['WebSocket', 'EventSource', 'importScripts', 'sendBeacon']) {
    replace(scope, name, refuse);
  }
  const storage = options.keepPersistentStorage ? ['caches'] : ['indexedDB', 'caches'];
  for (const name of storage) {
    replace(scope, name, undefined);
  }
}

/**
 * ¿Esta petición es un asset de un runtime permitido?
 *
 * Se resuelve contra el origen del Worker ANTES de comparar, así que una ruta
 * relativa, una absoluta y una URL completa acaban en la misma cadena. Comparar
 * el texto sin resolver dejaría pasar `https://evil.mx/../runtime/pyodide/x`,
 * que es la forma clásica de burlar una comprobación de prefijo.
 */
function isRuntimeAsset(
  input: RequestInfo | URL,
  prefixes: readonly string[],
  base: string | undefined
): boolean {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const url = new URL(raw, base);

    return prefixes.some((prefix) => {
      const allowed = new URL(prefix, base);
      return url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname);
    });
  } catch {
    return false;
  }
}

function replace(scope: Record<string, unknown>, name: string, value: unknown): void {
  try {
    Object.defineProperty(scope, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value,
    });
  } catch {
    try {
      scope[name] = value;
    } catch {
      // Hay globales que el navegador declara no reconfigurables. Se intenta y
      // se sigue: las otras dos capas no dependen de que esto funcione.
    }
  }
}

export function serveCodeEngine(
  scope: WorkerScope,
  createEngine: () => CodeEngine,
  /**
   * Los prefijos desde los que ESTE Worker sirve su runtime.
   *
   * Los pasa el Worker concreto porque es quien sabe de dónde carga: Python desde
   * `/runtime/pyodide/`, R desde `/runtime/webr/` y Java desde el CDN de CheerpJ
   * más `/runtime/java/`. Sin ellos, `fetch` desaparece por completo —el
   * comportamiento anterior—, que es lo correcto para un runtime que no descargue
   * nada después de arrancar.
   */
  runtimePrefix?: string | readonly string[],
  hardening: WorkerHardeningOptions = {}
): void {
  let engine: CodeEngine | null = null;
  let hardened = false;

  async function ready(): Promise<CodeEngine> {
    engine ??= createEngine();
    await engine.prepare();
    if (!hardened) {
      hardened = true;
      hardenWorkerScope(runtimePrefix, hardening);
    }
    return engine;
  }

  const post = (message: CodeWorkerResponse): void => scope.postMessage(message);

  scope.addEventListener('message', (event) => {
    const message = event.data as CodeWorkerRequest | undefined;
    if (!message || typeof message !== 'object' || typeof message.id !== 'number') return;

    if (message.type === 'reset') {
      void (async () => {
        try {
          // Sólo si YA hay motor: reiniciar un kernel que nunca arrancó no
          // debería arrancarlo, sólo para vaciarlo acto seguido.
          await engine?.resetSession();
          post({ type: 'reset', id: message.id });
        } catch (caught) {
          post({ type: 'error', id: message.id, message: describe(caught) });
        }
      })();
      return;
    }

    if (message.type === 'prepare') {
      void ready().then(
        () => post({ type: 'ready', id: message.id }),
        (caught: unknown) => post({ type: 'error', id: message.id, message: describe(caught) })
      );
      return;
    }

    if (message.type !== 'run' || typeof message.source !== 'string') return;

    void (async () => {
      try {
        /**
         * El proyecto se vuelve a validar AQUÍ dentro.
         *
         * `sanitizeWorkerRun` ya lo reconstruyó campo a campo en el hilo
         * principal, y aun así: éste es el último punto antes de que una ruta se
         * convierta en un `writeFile` dentro de un sistema de archivos virtual, y
         * una garantía que depende de que la función del otro lado del
         * `postMessage` siga comportándose bien no es una garantía. Un mensaje
         * fabricado a mano —o un campo que alguien añada sin pensar— se rechaza
         * en vez de escribirse.
         */
        if (message.project && !isSafeProject(message.project)) {
          post({
            type: 'result',
            id: message.id,
            status: 'rejected',
            stdout: '',
            stderr: 'El proyecto contiene una ruta de archivo no válida.',
            truncated: false,
          });
          return;
        }

        const active = await ready();
        // El lenguaje se comprueba contra el motor que ESTE Worker sirve. Un
        // mensaje que pida Python a un Worker de R se rechaza en vez de correr
        // el fuente contra el intérprete equivocado.
        if (message.language !== active.language) {
          post({
            type: 'result',
            id: message.id,
            status: 'rejected',
            stdout: '',
            stderr: 'Este ejecutor no atiende ese lenguaje.',
            truncated: false,
          });
          return;
        }

        const result = await active.run(
          message.source,
          message.executionOptions,
          message.mode ?? 'isolated',
          message.lab,
          message.project
        );
        post({ type: 'result', id: message.id, ...result });
      } catch (caught) {
        post({ type: 'error', id: message.id, message: describe(caught) });
      }
    })();
  });
}

/** La MISMA autoridad de rutas que usa el resto del proyecto, no otra copia. */
function isSafeProject(project: CodeProject): boolean {
  const paths = Object.keys(project.files);
  return (
    paths.length > 0 &&
    paths.every((path) => normalizeWorkspacePath(path) === path) &&
    Object.prototype.hasOwnProperty.call(project.files, project.entryFile)
  );
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'No se pudo preparar el entorno de ejecución.';
}

export { isCodeWorkerResponse };
