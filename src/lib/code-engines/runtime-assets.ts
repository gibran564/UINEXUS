/**
 * Dónde viven los runtimes de Python y R.
 *
 * Se sirven desde el PROPIO ORIGEN, no desde el CDN de Pyodide ni desde
 * `webr.r-wasm.org`. Tres razones, por orden de importancia:
 *
 *  1. La CSP puede quedarse en `'self'`. Abrir `script-src` y `connect-src` a
 *     dos dominios de terceros para toda la plataforma —la misma que firma las
 *     subidas a S3— es un precio desproporcionado.
 *  2. Una clase no depende de que un CDN ajeno esté disponible esa mañana.
 *  3. La versión que se ejecuta es la que fija `package.json`, no la que el CDN
 *     sirva ese día.
 *
 * Los archivos NO están en el repositorio: los copia `scripts/copy-code-runtimes.mjs`
 * desde `node_modules` antes de `dev` y de `build`. Son ~60 MB de WebAssembly y
 * no tienen por qué vivir en el historial de git.
 */

export const RUNTIME_BASE_PATH = '/runtime';

export const PYODIDE_INDEX_URL = `${RUNTIME_BASE_PATH}/pyodide/`;

export const WEBR_BASE_URL = `${RUNTIME_BASE_PATH}/webr/`;

/**
 * Los Workers de ejecución, compilados aparte por el mismo script.
 *
 * No salen de webpack, y no es una preferencia estética. Webpack acepta
 * `new Worker(new URL(…), { type: 'module' })` y luego lo carga como Worker
 * CLÁSICO —emitir módulos exige `output.module` en toda la compilación, que
 * Next no permite—; Pyodide detecta ese caso y se niega a arrancar, con razón:
 * en un Worker clásico no existe el `import()` dinámico con el que se cargan su
 * WebAssembly y el de webR.
 */
export const CODE_WORKER_URLS = {
  python: `${RUNTIME_BASE_PATH}/workers/python-runner.worker.js`,
  r: `${RUNTIME_BASE_PATH}/workers/r-runner.worker.js`,
  java: `${RUNTIME_BASE_PATH}/workers/java-runner.worker.js`,
} as const;

/**
 * Con qué clase de Worker se carga cada runtime.
 *
 * Aquí hay una EXCEPCIÓN y conviene que se vea en una tabla en vez de descubrirla
 * depurando:
 *
 * ```text
 *   python   module    Pyodide carga su WebAssembly con import() dinámico
 *   r        module    webR, igual
 *   java     classic   CheerpJ 4.3 se carga con importScripts(loader.js)
 * ```
 *
 * No es que Java sea especial por gusto: `loader.js` de CheerpJ es un script
 * CLÁSICO, y Chromium prohíbe `importScripts()` dentro de un Worker
 * `{ type: 'module' }`. La alternativa era convertir los tres a clásicos, y eso
 * rompería Pyodide y webR, que necesitan `import()` dinámico y no lo tienen en un
 * Worker clásico.
 *
 * Así que el sistema no finge que todos los runtimes arrancan igual: dice cuál
 * arranca cómo. El precio es una línea de configuración; el precio de lo
 * contrario era la ejecución de Python y R.
 */
export const CODE_WORKER_TYPES = {
  python: 'module',
  r: 'module',
  java: 'classic',
} as const satisfies Record<keyof typeof CODE_WORKER_URLS, WorkerType>;
