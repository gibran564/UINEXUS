/// <reference lib="webworker" />

import { createJavaEngine } from '@/lib/code-engines/java-engine';
import { JAVA_NETWORK_ALLOWLIST } from '@/lib/code-engines/java-toolchain';
import { serveCodeEngine } from '@/lib/code-engines/worker-bridge';

/**
 * El Worker que ejecuta Java. CLÁSICO, y es la única excepción del proyecto.
 *
 * Python y R se cargan como Workers de MÓDULO porque Pyodide y webR necesitan
 * `import()` dinámico. Éste no puede: `loader.js` de CheerpJ 4.3 es un script
 * clásico y Chromium prohíbe `importScripts()` dentro de un Worker de módulo. La
 * excepción está declarada en `CODE_WORKER_TYPES` y el empaquetado la respeta
 * emitiendo este archivo como IIFE en vez de ESM (ver
 * `scripts/copy-code-runtimes.mjs`).
 *
 * Lo que este archivo garantiza por existir es lo mismo que garantizan los otros
 * dos: el código del alumnado corre en un hilo propio, terminable desde fuera,
 * sin `window`, sin `document` y sin una sola referencia a la sesión de quien lo
 * escribió. Lo que añade es la captura de consola, y eso necesita explicación.
 *
 * ## Por qué hay que parchear la consola
 *
 * CheerpJ entrega `System.out` y `System.err` de Java llamando a `console.log`.
 * No hay opción de `cheerpjInit` que lo cambie. El registro que el harness emite
 * al final de cada ejecución —con los canales y el orden reales— viaja por ese
 * mismo camino, así que alguien tiene que leerlo.
 *
 * Se parchea AQUÍ y no en el motor por la misma razón por la que el
 * endurecimiento de red vive aquí: el motor también se ejecuta en las pruebas de
 * Node, y envenenar la consola del proceso de pruebas para demostrar algo sería
 * absurdo. El motor pide las líneas (`drainConsole`) y no sabe de dónde salen.
 *
 * El buffer tiene tope. Un programa que imprime sin parar produce líneas de
 * consola sin parar, y guardarlas todas para luego tirarlas sería llenar la
 * memoria por el camino contrario al que el harness ya cierra.
 */

/** Suficiente para el registro troceado del harness, no para un bucle infinito. */
const MAX_CONSOLE_LINES = 4_000;

const captured: string[] = [];

function record(args: unknown[]): void {
  if (captured.length >= MAX_CONSOLE_LINES) {
    // Se descarta el más viejo: lo que interesa es el registro, que el harness
    // emite al FINAL. Tirar el principio conserva justo lo que hace falta.
    captured.shift();
  }
  captured.push(
    args
      .map((value) => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(' ')
  );
}

for (const level of ['log', 'error', 'warn', 'info'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    record(args);
    original(...args);
  };
}

function drainConsole(): string[] {
  return captured.splice(0, captured.length);
}

serveCodeEngine(
  self as unknown as DedicatedWorkerGlobalScope,
  () => createJavaEngine({ drainConsole }),
  /**
   * Tras arrancar, este Worker sólo puede pedir estas dos cosas.
   *
   * Dos prefijos exactos: el CDN de CheerpJ CON su versión y `/runtime/java/`
   * del propio origen. `/api/*` no está, ningún otro origen está, y ninguna otra
   * versión de CheerpJ está. Ver `hardenWorkerScope` y `java-toolchain.ts`.
   */
  JAVA_NETWORK_ALLOWLIST,
  /**
   * `/files` de CheerpJ vive en IndexedDB, y ahí se compilan las clases de cada
   * ejecución. Quitarlo dejaría al compilador sin dónde escribir. Ver
   * `WorkerHardeningOptions`.
   */
  { keepPersistentStorage: true }
);

export {};
