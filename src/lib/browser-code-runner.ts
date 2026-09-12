import {
  CODE_RUN_LIMITS,
  clampCodeRunResult,
  isBrowserExecutableLanguage,
  rejectedCodeRun,
  validateCodeRunRequest,
} from './code-runner-contract';
import type { CodeRunRequest, CodeRunResult, CodeRunner } from './code-runner-contract';
import {
  isCodeWorkerResponse,
  sanitizeWorkerRun,
  type BrowserExecutionMode,
  type BrowserRuntimeLanguage,
  type CodeWorkerResponse,
} from './browser-code-runner-protocol';
import { CODE_WORKER_URLS } from './code-engines/runtime-assets';
import type { LabDataset } from './lab/dataset';
import type { ProgrammingLanguage } from './types';

/**
 * El ejecutor del NAVEGADOR.
 *
 * Es el único sitio de la aplicación que sabe que por debajo hay Pyodide y
 * webR. La interfaz pide `runner.run({ language, source })` y recibe stdout,
 * stderr y una duración; si mañana Python se ejecutara de otra forma, esta
 * clase cambia y ni el editor ni la vista docente se enteran.
 *
 * Convive con `lib/code-runner.ts`, que es el adaptador de SERVIDOR hacia un
 * sandbox externo y hoy no tiene a nadie detrás. No compiten: aquél nunca
 * ejecutó nada en el host de Next.js y éste tampoco, porque éste no se ejecuta
 * en el servidor en absoluto.
 *
 * ## El tiempo límite, y por qué se aplica desde fuera
 *
 * `while (TRUE) {}` no se puede pedir por favor que pare. Un Worker colgado no
 * atiende mensajes, así que no hay ningún «cancelar» cooperativo que funcione
 * en el caso que importa. Lo único que funciona es `terminate()`, que se lleva
 * el hilo y, con él, el runtime entero.
 *
 * Eso tiene un coste que conviene decir en voz alta: tras un tiempo excedido la
 * siguiente ejecución vuelve a arrancar Pyodide o webR desde cero. Es
 * preferible a la alternativa, que es una pestaña congelada en mitad de una
 * clase.
 */

export type BrowserCodeRunnerStatus = 'idle' | 'preparing' | 'ready' | 'running' | 'error';

/** Vaciar un diccionario es inmediato: si tarda esto, el Worker está colgado. */
const RESET_TIMEOUT_MS = 5_000;

export interface BrowserCodeRunnerOptions {
  onStatusChange?: (status: BrowserCodeRunnerStatus) => void;
  /** Inyectable para las pruebas. Por defecto, los Workers reales. */
  createWorker?: (language: BrowserRuntimeLanguage) => Worker;
  timeoutMs?: number;
  bootstrapTimeoutMs?: number;
  /**
   * Si las ejecuciones de ESTE runner arrastran estado.
   *
   * Por defecto `isolated`, que es el comportamiento de siempre y el que quiere
   * un paso de actividad. Un NexBook crea su runner con `session` (ver
   * `notebook-kernel.ts`) sin que eso cambie nada para los demás.
   */
  executionMode?: BrowserExecutionMode;
}

export interface BrowserCodeRunner extends CodeRunner {
  readonly language: BrowserRuntimeLanguage;
  /**
   * `lab` es un parámetro OPCIONAL añadido sobre `CodeRunner.run`.
   *
   * No entra en `CodeRunRequest` a propósito: ese tipo es el contrato genérico
   * de un ejecutor —lo comparte el adaptador hacia un sandbox externo— y un
   * `LabDataset` es un concepto de NexBook. Meterlo ahí habría obligado a
   * cualquier ejecutor futuro a saber qué es una hoja de cálculo.
   */
  run(request: CodeRunRequest, lab?: LabDataset): Promise<CodeRunResult>;
  interrupt(): Promise<void>;
  /** Vacía el estado de la sesión sin volver a descargar el runtime. */
  resetSession(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Los Workers reales.
 *
 * Rutas absolutas del PROPIO ORIGEN, servidas desde `public/runtime/workers/`
 * (los compila `scripts/copy-code-runtimes.mjs`; el porqué está en
 * `code-engines/runtime-assets.ts`). Con `worker-src 'self'` basta y no hay
 * ninguna URL de terceros que autorizar.
 *
 * `type: 'module'` no es opcional: Pyodide y webR cargan su WebAssembly con
 * `import()` dinámico, que en un Worker clásico no existe.
 */
function defaultWorkerFactory(language: BrowserRuntimeLanguage): Worker {
  return new Worker(CODE_WORKER_URLS[language], {
    type: 'module',
    name: `uinexus-${language}`,
  });
}

export function getBrowserCodeRunner(
  language: ProgrammingLanguage,
  options: BrowserCodeRunnerOptions = {}
): BrowserCodeRunner | null {
  if (!isBrowserExecutableLanguage(language)) return null;
  return new WorkerCodeRunner(language, options);
}

/** ¿Se puede ofrecer el botón de ejecutar para este lenguaje? */
export function canRunInBrowser(language: ProgrammingLanguage | null | undefined): boolean {
  return Boolean(language) && isBrowserExecutableLanguage(language as ProgrammingLanguage);
}

interface Pending {
  id: number;
  resolve: (response: CodeWorkerResponse) => void;
  reject: (error: Error) => void;
}

class WorkerCodeRunner implements BrowserCodeRunner {
  readonly name = 'browser';

  private worker: Worker | null = null;
  private prepared = false;
  private nextId = 1;
  private pending: Pending | null = null;
  private status: BrowserCodeRunnerStatus = 'idle';

  constructor(
    readonly language: BrowserRuntimeLanguage,
    private readonly options: BrowserCodeRunnerOptions
  ) {}

  supports(candidate: ProgrammingLanguage): boolean {
    return candidate === this.language;
  }

  async run(request: CodeRunRequest, lab?: LabDataset): Promise<CodeRunResult> {
    const started = Date.now();

    const invalid = validateCodeRunRequest(request, (candidate) => this.supports(candidate));
    if (invalid) {
      // Un rechazo por tamaño o por lenguaje no arranca ningún runtime: no hay
      // razón para gastar 13 MB de WebAssembly en decir que no.
      return { ...invalid, durationMs: Date.now() - started };
    }

    try {
      await this.ensurePrepared();
    } catch (caught) {
      this.setStatus('error');
      return {
        ...rejectedCodeRun(
          caught instanceof Error ? caught.message : 'No se pudo preparar el entorno de ejecución.'
        ),
        durationMs: Date.now() - started,
      };
    }

    this.setStatus('running');
    const runStarted = Date.now();

    try {
      const response = await this.send(
        (id) =>
          sanitizeWorkerRun(
            id,
            this.language,
            request.source,
            { maxOutputChars: CODE_RUN_LIMITS.maxOutputChars },
            this.options.executionMode ?? 'isolated',
            lab
          ),
        this.options.timeoutMs ?? CODE_RUN_LIMITS.timeoutMs
      );

      if (response.type === 'error') {
        this.setStatus('error');
        return {
          ...rejectedCodeRun(response.message),
          durationMs: Date.now() - runStarted,
        };
      }
      if (response.type !== 'result') {
        this.setStatus('error');
        return {
          ...rejectedCodeRun('El ejecutor respondió algo que no se entiende.'),
          durationMs: Date.now() - runStarted,
        };
      }

      this.setStatus('ready');
      return clampCodeRunResult({
        status: response.status,
        stdout: response.stdout,
        stderr: response.stderr,
        exitCode: response.status === 'ok' ? 0 : null,
        durationMs: Date.now() - runStarted,
        truncated: response.truncated,
        /**
         * La secuencia pasa TAL CUAL.
         *
         * `clampCodeRunResult` recorta las dos cadenas planas al tope de la
         * consola; la secuencia ya viene acotada desde el motor, que es donde se
         * sabe qué es texto y qué no. Volver a recortarla aquí cortaría una
         * imagen por la mitad contando sus caracteres de Base64 como si fueran
         * salida de un `print`.
         */
        ...(response.outputs ? { outputs: response.outputs } : {}),
      });
    } catch (caught) {
      // Tiempo excedido o parada manual: en los dos casos el Worker ya está
      // terminado y el runtime asociado, limpio.
      const stopped = caught instanceof RunStopped;
      const timedOut = caught instanceof RunTimeout;
      this.setStatus('idle');

      if (stopped || timedOut) {
        return {
          status: stopped ? 'stopped' : 'timeout',
          stdout: '',
          stderr: stopped
            ? 'Detuviste la ejecución.'
            : 'La ejecución superó el límite de tiempo.',
          exitCode: null,
          durationMs: Date.now() - runStarted,
          truncated: false,
        };
      }

      this.setStatus('error');
      return {
        ...rejectedCodeRun(
          caught instanceof Error ? caught.message : 'No se pudo ejecutar el código.'
        ),
        durationMs: Date.now() - runStarted,
      };
    }
  }

  /** Termina lo que esté corriendo. La siguiente ejecución arranca en limpio. */
  async interrupt(): Promise<void> {
    if (!this.pending) return;
    this.destroyWorker(new RunStopped());
    this.setStatus('idle');
  }

  /**
   * Vacía el estado de la sesión, si hay un Worker vivo al que pedírselo.
   *
   * Cuando no lo hay no se arranca uno para vaciarlo: un kernel que nunca
   * ejecutó nada ya está limpio, y arrancar Pyodide para confirmarlo serían
   * trece megas por un botón que no cambia nada.
   */
  async resetSession(): Promise<void> {
    if (!this.worker || !this.prepared || this.pending) return;
    try {
      await this.send((id) => ({ type: 'reset' as const, id }), RESET_TIMEOUT_MS);
    } catch {
      // El Worker no contestó: se descarta entero. La siguiente ejecución
      // arranca en limpio, que es exactamente lo que se pedía.
      this.destroyWorker(new RunStopped());
    }
  }

  async dispose(): Promise<void> {
    this.destroyWorker(new RunStopped());
    this.setStatus('idle');
  }

  private async ensurePrepared(): Promise<void> {
    if (this.worker && this.prepared) return;

    this.setStatus('preparing');
    this.spawnWorker();

    const response = await this.send(
      (id) => ({ type: 'prepare' as const, id }),
      this.options.bootstrapTimeoutMs ?? CODE_RUN_LIMITS.bootstrapTimeoutMs
    );

    if (response.type === 'error') throw new Error(response.message);
    this.prepared = true;
    this.setStatus('ready');
  }

  private spawnWorker(): void {
    if (this.worker) return;
    const create = this.options.createWorker ?? defaultWorkerFactory;
    const worker = create(this.language);
    this.worker = worker;
    this.prepared = false;

    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isCodeWorkerResponse(event.data)) return;
      const waiting = this.pending;
      if (!waiting || waiting.id !== event.data.id) return;
      this.pending = null;
      waiting.resolve(event.data);
    });

    worker.addEventListener('error', (event: ErrorEvent) => {
      // Un Worker que revienta se lleva su runtime: no se puede reutilizar.
      this.destroyWorker(new Error(event.message || 'El ejecutor falló al arrancar.'));
    });
  }

  /**
   * Una petición cada vez.
   *
   * No hay cola: si ya hay algo corriendo, el botón está deshabilitado y
   * `Detener` es la única salida. Una cola sólo serviría para acumular trabajo
   * detrás de un programa que no va a terminar nunca.
   */
  private send(
    build: (id: number) => { type: string; id: number },
    timeoutMs: number
  ): Promise<CodeWorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('El ejecutor no está disponible.'));
    if (this.pending) return Promise.reject(new Error('Ya hay una ejecución en curso.'));

    const id = this.nextId++;

    return new Promise<CodeWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.destroyWorker(new RunTimeout());
      }, timeoutMs);

      this.pending = {
        id,
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      worker.postMessage(build(id));
    });
  }

  /**
   * Terminar es la única forma fiable de recuperar el control.
   *
   * Se descarta el Worker entero —no sólo la ejecución— porque el runtime que
   * vive dentro quedó en un estado que nadie ha inspeccionado. El siguiente
   * intento paga otro arranque y a cambio empieza en un sitio conocido.
   */
  private destroyWorker(reason: Error): void {
    const waiting = this.pending;
    this.pending = null;
    this.prepared = false;

    const worker = this.worker;
    this.worker = null;
    worker?.terminate();

    waiting?.reject(reason);
  }

  private setStatus(next: BrowserCodeRunnerStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatusChange?.(next);
  }
}

class RunTimeout extends Error {
  constructor() {
    super('La ejecución superó el límite de tiempo.');
    this.name = 'RunTimeout';
  }
}

class RunStopped extends Error {
  constructor() {
    super('Detuviste la ejecución.');
    this.name = 'RunStopped';
  }
}
