import type { CodeEngine } from './engine-contract';
import {
  isCodeWorkerResponse,
  type CodeWorkerRequest,
  type CodeWorkerResponse,
} from '../browser-code-runner-protocol';

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
 */
export function hardenWorkerScope(allowedPrefix?: string): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const refuse = (): never => {
    throw new Error('El acceso de red está deshabilitado durante la ejecución.');
  };

  const realFetch = typeof scope.fetch === 'function' ? (scope.fetch as typeof fetch) : null;

  if (realFetch && allowedPrefix) {
    replace(scope, 'fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!isRuntimeAsset(input, allowedPrefix)) return refuse();
      return realFetch(input, init);
    }) as typeof fetch);
  } else {
    replace(scope, 'fetch', refuse);
  }

  // Lo demás desaparece entero: ningún runtime los necesita después de arrancar.
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
    replace(scope, name, refuse);
  }
  for (const name of ['indexedDB', 'caches']) {
    replace(scope, name, undefined);
  }
}

/**
 * ¿Esta petición es un asset del propio runtime?
 *
 * Se resuelve contra el origen del Worker ANTES de comparar, así que una ruta
 * relativa, una absoluta y una URL completa acaban en la misma cadena. Comparar
 * el texto sin resolver dejaría pasar `https://evil.mx/../runtime/pyodide/x`,
 * que es la forma clásica de burlar una comprobación de prefijo.
 */
function isRuntimeAsset(input: RequestInfo | URL, allowedPrefix: string): boolean {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const base = (globalThis as unknown as { location?: { href: string } }).location?.href;
    const url = new URL(raw, base);
    const allowed = new URL(allowedPrefix, base);

    return url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname);
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
   * El prefijo desde el que ESTE Worker sirve su runtime.
   *
   * Lo pasa el Worker concreto porque es quien sabe de dónde carga: Python desde
   * `/runtime/pyodide/` y R desde `/runtime/webr/`. Sin él, `fetch` desaparece
   * por completo —el comportamiento anterior—, que es lo correcto para un
   * runtime que no descargue nada después de arrancar.
   */
  runtimePrefix?: string
): void {
  let engine: CodeEngine | null = null;
  let hardened = false;

  async function ready(): Promise<CodeEngine> {
    engine ??= createEngine();
    await engine.prepare();
    if (!hardened) {
      hardened = true;
      hardenWorkerScope(runtimePrefix);
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
          message.lab
        );
        post({ type: 'result', id: message.id, ...result });
      } catch (caught) {
        post({ type: 'error', id: message.id, message: describe(caught) });
      }
    })();
  });
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'No se pudo preparar el entorno de ejecución.';
}

export { isCodeWorkerResponse };
