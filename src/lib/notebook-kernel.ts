import {
  CODE_RUN_LIMITS,
  clampCodeOutput,
  isBrowserExecutableLanguage,
  type CodeRunResult,
} from './code-runner-contract';
import type { BrowserRichOutput } from './browser-code-runner-protocol';
import {
  getBrowserCodeRunner,
  type BrowserCodeRunner,
  type BrowserCodeRunnerStatus,
} from './browser-code-runner';
import { NEXBOOK_LIMITS } from './constants';
import type { LabDataset } from './lab/dataset';
import type { NexBookCellResult, NexBookOutput, ProgrammingLanguage } from './types';

/**
 * El kernel de un NexBook.
 *
 * ## `CodeRunner` y `NotebookKernel` no compiten
 *
 * ```
 * CodeRunner      una ejecución aislada. Cada `run` empieza con el estado
 *                 limpio. Es lo correcto para un paso de actividad, donde lo
 *                 que se entrega tiene que funcionar por sí solo.
 *
 * NotebookKernel  una SESIÓN. `x = 10` en una celda se ve en la siguiente.
 *                 Es lo que hace que un NexBook sea un documento y no una lista
 *                 de programas sueltos.
 * ```
 *
 * El kernel NO es un motor nuevo: envuelve al mismo `BrowserCodeRunner`, que
 * habla con el mismo Worker, que sirve al mismo Pyodide. Lo único que cambia es
 * el `mode` del mensaje. Duplicar el runner habría significado dos Pyodide en
 * memoria para la misma pestaña.
 *
 * ## Un kernel por lenguaje, y perezoso
 *
 * Un documento con celdas de Python y de R no arranca los dos runtimes al
 * abrirse: arranca el que haga falta cuando se ejecute la primera celda de ese
 * lenguaje. Son 13 MB y 46 MB; cargarlos «por si acaso» sería inaceptable en la
 * red de un aula.
 *
 * ## Qué pasa tras un tiempo excedido
 *
 * El Worker se termina —es la única forma fiable de recuperar un bucle
 * infinito—, y eso se lleva la sesión por delante. No se finge lo contrario: el
 * kernel se marca como perdido y la interfaz dice «Kernel reiniciado». Conservar
 * la ilusión de una sesión cuyo estado ya no existe sería peor que perderla,
 * porque la celda siguiente fallaría con un `NameError` inexplicable.
 */

export type KernelStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'running'
  | 'restarting'
  | 'error'
  /** La sesión se perdió al terminar el Worker. La siguiente ejecución rearranca. */
  | 'lost';

/**
 * Una imagen recién producida, con los bytes todavía en memoria.
 *
 * Viaja SEPARADA del resultado porque su destino es otro: el resultado va al
 * documento y la imagen va al almacén de assets. Meter el Base64 dentro del
 * output habría significado guardar 40 KB de imagen dentro de los 300 KB del
 * documento, que es exactamente lo que el modelo de assets evita.
 *
 * `seq` dice a qué output de `result.outputs` corresponde, para poder rellenar
 * su `assetId` cuando la subida termine.
 */
export interface KernelImage {
  seq: number;
  base64: string;
  mimeType: 'image/png';
  width?: number;
  height?: number;
}

export interface KernelCellRun {
  result: NexBookCellResult;
  /** El estado de la sesión se perdió durante ESTA ejecución. */
  sessionLost: boolean;
  /** Imágenes que hay que convertir en assets antes de guardar el documento. */
  images: KernelImage[];
}

export interface NotebookKernelOptions {
  onStatusChange?: (language: ProgrammingLanguage, status: KernelStatus) => void;
  /** Inyectable para las pruebas. */
  createRunner?: typeof getBrowserCodeRunner;
}

export interface NotebookKernel {
  executeCell(
    blockId: string,
    language: ProgrammingLanguage,
    source: string,
    /**
     * Los datos del NexBook que esta celda pidió (iteración 13).
     *
     * Los resuelve quien llama —Studio, que es el único que tiene el documento
     * y la sesión— y no el kernel: el kernel ejecuta, no sabe de qué documento
     * viene la celda ni tiene forma de pedir un asset. Es la misma separación
     * por la que las imágenes de salida se suben fuera de aquí.
     */
    lab?: LabDataset
  ): Promise<KernelCellRun>;
  /** Termina lo que esté corriendo. Se lleva la sesión: es lo único que funciona. */
  interrupt(language: ProgrammingLanguage): Promise<void>;
  /** Vacía el estado sin volver a descargar el runtime, cuando se puede. */
  restart(language: ProgrammingLanguage): Promise<void>;
  statusOf(language: ProgrammingLanguage): KernelStatus;
  /** Los lenguajes con un runtime vivo ahora mismo. */
  activeLanguages(): ProgrammingLanguage[];
  dispose(): Promise<void>;
}

interface Session {
  runner: BrowserCodeRunner;
  status: KernelStatus;
}

export function createNotebookKernel(options: NotebookKernelOptions = {}): NotebookKernel {
  const sessions = new Map<ProgrammingLanguage, Session>();
  const createRunner = options.createRunner ?? getBrowserCodeRunner;

  function setStatus(language: ProgrammingLanguage, status: KernelStatus): void {
    const session = sessions.get(language);
    if (session) session.status = status;
    options.onStatusChange?.(language, status);
  }

  function sessionFor(language: ProgrammingLanguage): Session | null {
    const existing = sessions.get(language);
    if (existing) return existing;

    const runner = createRunner(language, {
      // El estado del runner se traduce al del kernel. `idle` tras una
      // ejecución significa que el Worker murió: ver `run` más abajo.
      onStatusChange: (status: BrowserCodeRunnerStatus) => {
        const mapped: KernelStatus =
          status === 'preparing'
            ? 'preparing'
            : status === 'running'
              ? 'running'
              : status === 'ready'
                ? 'ready'
                : status === 'error'
                  ? 'error'
                  : 'idle';
        options.onStatusChange?.(language, mapped);
        const current = sessions.get(language);
        if (current) current.status = mapped;
      },
      executionMode: 'session',
    });
    if (!runner) return null;

    const session: Session = { runner, status: 'idle' };
    sessions.set(language, session);
    return session;
  }

  return {
    async executeCell(blockId, language, source, lab): Promise<KernelCellRun> {
      const ranAt = new Date().toISOString();

      if (!isBrowserExecutableLanguage(language)) {
        return {
          result: rejected(blockId, 'Este lenguaje no se puede ejecutar en Nextudio.', ranAt),
          sessionLost: false,
          images: [],
        };
      }

      const session = sessionFor(language);
      if (!session) {
        return {
          result: rejected(blockId, 'No hay ejecutor para ese lenguaje.', ranAt),
          sessionLost: false,
          images: [],
        };
      }

      const run = await session.runner.run({ language, source }, lab);

      /**
       * Terminar el Worker es lo que aplica el tiempo límite, y se lleva la
       * sesión. Detectarlo aquí —y no dejar que la celda siguiente se estrelle
       * con un `NameError` que nadie entiende— es la diferencia entre un fallo
       * explicado y uno misterioso.
       */
      const sessionLost = run.status === 'timeout' || run.status === 'stopped';
      if (sessionLost) setStatus(language, 'lost');

      const images: KernelImage[] = [];

      return {
        result: {
          blockId,
          status: run.status,
          outputs: toOutputs(run, images),
          durationMs: run.durationMs,
          ranAt,
        },
        sessionLost,
        images,
      };
    },

    async interrupt(language): Promise<void> {
      await sessions.get(language)?.runner.interrupt();
    },

    async restart(language): Promise<void> {
      const session = sessions.get(language);
      if (!session) return;

      setStatus(language, 'restarting');
      await session.runner.resetSession();
      setStatus(language, session.status === 'lost' ? 'idle' : 'ready');
    },

    statusOf(language): KernelStatus {
      return sessions.get(language)?.status ?? 'idle';
    },

    activeLanguages(): ProgrammingLanguage[] {
      return [...sessions.keys()];
    },

    async dispose(): Promise<void> {
      // Salir del documento libera los runtimes. Dejar 46 MB de webR vivos
      // porque alguien pasó por un NexBook no es aceptable.
      await Promise.all([...sessions.values()].map((session) => session.runner.dispose()));
      sessions.clear();
    },
  };
}

/**
 * La salida de una ejecución, como la guarda el documento.
 *
 * Desde la iteración 9 el orden es REAL: el motor entrega la secuencia tal y
 * como ocurrió (ver `code-engines/output-recorder.ts`) y aquí sólo se recorta y
 * se traduce al modelo del documento. La reconstrucción «primero stdout, luego
 * stderr» que hacía antes esta función era una aproximación, y se ha ido.
 *
 * El camino viejo se conserva para un ejecutor que no sepa dar la secuencia
 * —el adaptador de servidor, o una prueba que devuelva un resultado a mano—.
 * Sin ese respaldo, un runner perfectamente válido produciría celdas mudas.
 */
function toOutputs(run: CodeRunResult, images: KernelImage[]): NexBookOutput[] {
  if (run.outputs?.length) return fromSequence(run.outputs, images);
  return fromStreams(run.stdout, run.stderr, run.status);
}

function fromSequence(outputs: BrowserRichOutput[], images: KernelImage[]): NexBookOutput[] {
  const result: NexBookOutput[] = [];

  for (const output of outputs.slice(0, NEXBOOK_LIMITS.maxOutputsPerCell)) {
    // `seq` se reasigna al índice del array: un motor podría dejar huecos al
    // descartar trozos vacíos, y el orden es lo que importa, no el número.
    const seq = result.length;

    if (output.stream === 'table') {
      result.push({
        seq,
        stream: 'table',
        columns: output.columns,
        rows: output.rows,
        totalRows: output.totalRows,
        ...(output.truncated ? { truncated: true } : {}),
      });
      continue;
    }

    if (output.stream === 'image') {
      /**
       * Aquí NO se crea el asset.
       *
       * El kernel no sabe a qué NexBook pertenece la celda ni tiene por qué
       * hablar con la red: es el ejecutor de un documento, no su capa de
       * persistencia. Los bytes salen aparte, en `images`, y Studio los sube y
       * rellena `assetId`. Ver `components/studio/nexbook-studio.tsx`.
       */
      result.push({
        seq,
        stream: 'image',
        assetId: '',
        mimeType: output.mimeType,
        ...(output.width ? { width: output.width } : {}),
        ...(output.height ? { height: output.height } : {}),
      });
      images.push({
        seq,
        base64: output.base64,
        mimeType: output.mimeType,
        ...(output.width ? { width: output.width } : {}),
        ...(output.height ? { height: output.height } : {}),
      });
      continue;
    }

    if (!output.text) continue;
    const clamped = clampToCell(output.text);
    result.push({
      seq,
      stream: output.stream,
      text: clamped.text,
      ...(clamped.truncated ? { truncated: true } : {}),
    });
  }

  return result;
}

/** El camino de compatibilidad: dos cadenas, sin orden real entre ellas. */
function fromStreams(stdout: string, stderr: string, status: string): NexBookOutput[] {
  const outputs: NexBookOutput[] = [];
  let seq = 0;

  const push = (stream: 'stdout' | 'stderr' | 'error', text: string): void => {
    if (!text) return;
    // Lo que se GUARDA con la celda es más pequeño que lo que se puede ver al
    // ejecutar: un documento con cien celdas no puede llevar cien salidas
    // enormes dentro del mismo item de DynamoDB.
    const clamped = clampToCell(text);
    outputs.push({
      seq: seq++,
      stream,
      text: clamped.text,
      ...(clamped.truncated ? { truncated: true } : {}),
    });
  };

  push('stdout', stdout);
  push(status === 'failed' || status === 'rejected' ? 'error' : 'stderr', stderr);

  return outputs;
}

function clampToCell(text: string): { text: string; truncated: boolean } {
  if (text.length <= NEXBOOK_LIMITS.maxOutputChars) return { text, truncated: false };
  return { text: text.slice(0, NEXBOOK_LIMITS.maxOutputChars), truncated: true };
}

function rejected(blockId: string, message: string, ranAt: string): NexBookCellResult {
  return {
    blockId,
    status: 'rejected',
    outputs: [{ seq: 0, stream: 'error', text: clampCodeOutput(message).text }],
    durationMs: 0,
    ranAt,
  };
}

export { CODE_RUN_LIMITS };
