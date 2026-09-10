/// <reference lib="webworker" />

import { loadPyodide } from 'pyodide';
import type { PyodideAPI } from 'pyodide';
import type { PythonWorkerRequest, PythonWorkerResponse } from '@/lib/browser-code-runner-protocol';

const PYODIDE_INDEX_URL = '/runtime/pyodide/';
const workerScope = self as DedicatedWorkerGlobalScope;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let activeOutput: LimitedOutput | null = null;

class LimitedOutput {
  stdout = '';
  stderr = '';
  truncated = false;

  constructor(private readonly limit: number) {}

  append(stream: 'stdout' | 'stderr', chunk: string): void {
    const current = this.stdout.length + this.stderr.length;
    const remaining = Math.max(0, this.limit - current);
    if (chunk.length > remaining) this.truncated = true;
    if (remaining === 0) return;
    const next = chunk.slice(0, remaining);
    if (stream === 'stdout') this.stdout += next;
    else this.stderr += next;
  }
}

function post(message: PythonWorkerResponse): void {
  workerScope.postMessage(message);
}

function networkBlocked(): never {
  throw new Error('El acceso de red está deshabilitado durante la ejecución.');
}

function disableUntrustedCapabilities(): void {
  const blockedFunctions = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedWorker',
    'importScripts',
  ];
  const blockedStorage = ['indexedDB', 'caches'];
  const scope = globalThis as unknown as Record<string, unknown>;

  for (const name of blockedFunctions) {
    try {
      Object.defineProperty(scope, name, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: networkBlocked,
      });
    } catch {
      // Some browser globals are non-configurable. The restricted `jsglobals`
      // below remains the primary barrier exposed to Python.
      try {
        scope[name] = networkBlocked;
      } catch {
        // Best effort only; the worker CSP is the outer network boundary.
      }
    }
  }

  for (const name of blockedStorage) {
    try {
      Object.defineProperty(scope, name, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: undefined,
      });
    } catch {
      try {
        scope[name] = undefined;
      } catch {
        // Best effort only; no storage object is deliberately passed to Python.
      }
    }
  }
}

function preparePyodide(): Promise<PyodideAPI> {
  if (pyodidePromise) return pyodidePromise;

  const pythonGlobals = Object.freeze(Object.create(null)) as object;
  pyodidePromise = loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
    jsglobals: pythonGlobals,
    stdout: (line) => activeOutput?.append('stdout', `${line}\n`),
    stderr: (line) => activeOutput?.append('stderr', `${line}\n`),
  }).then((pyodide) => {
    // All runtime assets needed for base Python have loaded. Package loading is
    // intentionally not exposed and network/storage APIs are removed now.
    disableUntrustedCapabilities();
    return pyodide;
  });
  return pyodidePromise;
}

async function runPython(message: Extract<PythonWorkerRequest, { type: 'run' }>): Promise<void> {
  const limit = Math.max(0, message.executionOptions.maxOutputChars);
  const output = new LimitedOutput(limit);
  activeOutput = output;

  try {
    const pyodide = await preparePyodide();
    const globals = pyodide.toPy({ __name__: '__main__' });
    try {
      const result = await pyodide.runPythonAsync(message.source, { globals });
      if (result && typeof result === 'object' && 'destroy' in result) {
        result.destroy();
      }
      post({
        type: 'result',
        id: message.id,
        status: 'ok',
        stdout: output.stdout,
        stderr: output.stderr,
        truncated: output.truncated,
      });
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : String(caught);
      output.append('stderr', messageText);
      post({
        type: 'result',
        id: message.id,
        status: 'failed',
        stdout: output.stdout,
        stderr: output.stderr,
        truncated: output.truncated,
      });
    } finally {
      if (globals && typeof globals === 'object' && 'destroy' in globals) {
        globals.destroy();
      }
    }
  } catch (caught) {
    post({
      type: 'error',
      id: message.id,
      message: caught instanceof Error ? caught.message : 'No se pudo preparar Python.',
    });
  } finally {
    activeOutput = null;
  }
}

workerScope.addEventListener('message', (event: MessageEvent<PythonWorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || typeof message.id !== 'number') return;

  if (message.type === 'prepare') {
    void preparePyodide().then(
      () => post({ type: 'ready', id: message.id }),
      (caught: unknown) =>
        post({
          type: 'error',
          id: message.id,
          message: caught instanceof Error ? caught.message : 'No se pudo preparar Python.',
        })
    );
    return;
  }

  if (message.type === 'run' && message.language === 'python' && typeof message.source === 'string') {
    void runPython(message);
  }
});

export {};
