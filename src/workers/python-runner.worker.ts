/// <reference lib="webworker" />

import { createPythonEngine } from '@/lib/code-engines/python-engine';
import { PYODIDE_INDEX_URL } from '@/lib/code-engines/runtime-assets';
import { serveCodeEngine } from '@/lib/code-engines/worker-bridge';

/**
 * El Worker que ejecuta Python.
 *
 * No hace nada más que unir el motor con el bucle de mensajes. Lo que este
 * archivo garantiza por su mera existencia es el aislamiento: el código del
 * alumnado corre en un hilo propio, terminable desde fuera, sin `window`, sin
 * `document` y sin una sola referencia a la sesión de quien lo escribió.
 */

serveCodeEngine(
  self as unknown as DedicatedWorkerGlobalScope,
  () => createPythonEngine({ indexURL: PYODIDE_INDEX_URL }),
  /**
   * Tras arrancar, este Worker sólo puede pedir cosas de aquí.
   *
   * Hace falta porque las ruedas de numpy, pandas y matplotlib se cargan cuando
   * una celda las importa, no al arrancar. Ver `hardenWorkerScope`.
   */
  PYODIDE_INDEX_URL
);

export {};
