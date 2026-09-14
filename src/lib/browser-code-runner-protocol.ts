import type { CodeProject, CodeRunStatus } from './code-runner-contract';
import type { LabDataset, LabTable } from './lab/dataset';
import { normalizeWorkspacePath } from './workspace-files';

/**
 * El único lenguaje que hablan los Workers de ejecución.
 *
 * Es deliberadamente pobre. Un mensaje lleva el lenguaje, el fuente y los
 * límites: NADA MÁS. No hay hueco para un token de Firebase, una cookie, una
 * credencial de AWS, una variable de entorno ni el perfil de nadie, y no lo hay
 * porque el código que se ejecuta al otro lado lo escribió una persona que está
 * resolviendo una tarea y no tiene por qué merecer confianza.
 *
 * Que el tipo sea cerrado es la mitad del argumento; la otra mitad es
 * `sanitizeWorkerRun`, que construye el mensaje campo a campo en vez de
 * reenviar un objeto que venga de arriba. Un `...spread` descuidado en el
 * futuro es exactamente la forma en que estos contratos se rompen.
 */

/**
 * Los lenguajes que HOY tienen un runtime dentro del navegador.
 *
 * Java está en la lista desde J1 porque el runtime EXISTE —CheerpJ 4.3 y ECJ,
 * ver `code-engines/java-engine.ts`—, y a la vez sigue sin ser ofrecible: su
 * `browserExecution` del catálogo es `false` y `isBrowserExecutableLanguage`
 * exige las dos cosas. Esa separación es deliberada: este tipo dice para qué hay
 * código, el catálogo dice qué promete la interfaz, y en J1 no coinciden a
 * propósito.
 */
export type BrowserRuntimeLanguage = 'r' | 'python' | 'java';

export interface BrowserExecutionOptions {
  maxOutputChars: number;
}

/**
 * Si la ejecución arrastra estado.
 *
 * Viaja en el mensaje, y no en una propiedad del Worker, porque el MISMO Worker
 * sirve a los dos casos: un paso de actividad quiere empezar limpio y una celda
 * de NexBook quiere ver lo que definió la anterior. Dos Workers por lenguaje
 * habrían significado dos veces Pyodide en memoria.
 */
export type BrowserExecutionMode = 'isolated' | 'session';

export type CodeWorkerRequest =
  | { type: 'prepare'; id: number }
  | {
      type: 'run';
      id: number;
      language: BrowserRuntimeLanguage;
      source: string;
      executionOptions: BrowserExecutionOptions;
      /** Ausente significa `isolated`: el comportamiento de siempre. */
      mode?: BrowserExecutionMode;
      /**
       * Los datos del NexBook que ESTA celda pidió (iteración 13).
       *
       * Ausente es el caso normal: una actividad de código, una celda que no
       * menciona la API del laboratorio, cualquier ejecución aislada. Cuando
       * viene, es un `LabDataset` —un tipo CERRADO de tablas, bytes de imagen y
       * mensajes— construido en el hilo principal a partir de lo que el fuente
       * referencia. No hay hueco para una URL firmada, una clave de S3, un uid ni
       * un token: ver `lib/lab/dataset.ts`.
       */
      lab?: LabDataset;
      /** Proyecto multiarchivo ya reducido a rutas seguras para el runtime. */
      project?: CodeProject;
    }
  /** Vacía el estado de la sesión sin tirar el runtime. */
  | { type: 'reset'; id: number };

/** Un valor de celda de tabla, tal y como viaja desde el Worker. */
export type BrowserTableCell = string | number | boolean | null;

/**
 * Un trozo de salida, con su posición en la secuencia.
 *
 * Viaja del Worker HACIA el hilo principal, que es la dirección contraria a la
 * que vigila `sanitizeWorkerRun`. Ahí la regla es la simétrica: lo que sale del
 * Worker es lo que produjo el programa del alumnado y se trata como dato, nunca
 * como instrucciones. Por eso una imagen viaja como Base64 con su tipo MIME
 * declarado —y se valida contra una lista blanca antes de guardarse— y una tabla
 * viaja como columnas y filas, no como HTML que alguien pudiera insertar.
 */
export type BrowserRichOutput =
  | { seq: number; stream: 'stdout' | 'stderr' | 'error'; text: string }
  | {
      seq: number;
      stream: 'table';
      columns: string[];
      rows: BrowserTableCell[][];
      totalRows: number;
      truncated?: boolean;
    }
  | {
      seq: number;
      stream: 'image';
      base64: string;
      mimeType: 'image/png';
      width?: number;
      height?: number;
    };

export type CodeWorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'reset'; id: number }
  | {
      type: 'result';
      id: number;
      status: Extract<CodeRunStatus, 'ok' | 'failed' | 'rejected'>;
      stdout: string;
      stderr: string;
      truncated: boolean;
      /**
       * La secuencia ordenada.
       *
       * Opcional a propósito: `stdout` y `stderr` siguen siendo la respuesta
       * completa para el ejecutor aislado de las actividades, y un Worker viejo
       * —o una prueba que simule uno— sigue siendo válido sin este campo.
       */
      outputs?: BrowserRichOutput[];
    }
  | { type: 'error'; id: number; message: string };

/**
 * El mensaje de ejecución, montado campo a campo.
 *
 * No acepta un objeto y lo reenvía: lee las cuatro cosas que necesita y
 * descarta el resto. Si mañana la evidencia del paso arrastra el uid, la clave
 * del archivo en S3 o el correo de quien entrega, nada de eso puede colarse al
 * Worker por accidente.
 */
export function sanitizeWorkerRun(
  id: number,
  language: BrowserRuntimeLanguage,
  source: string,
  executionOptions: BrowserExecutionOptions,
  mode: BrowserExecutionMode = 'isolated',
  lab?: LabDataset,
  project?: CodeProject
): Extract<CodeWorkerRequest, { type: 'run' }> {
  const safeProject = project ? sanitizeCodeProject(project) : undefined;
  return {
    type: 'run',
    id,
    language,
    source,
    executionOptions: { maxOutputChars: executionOptions.maxOutputChars },
    mode,
    /**
     * El dataset se reconstruye campo a campo, igual que el resto del mensaje.
     *
     * Podría pasarse tal cual —ya viene de `resolveLabDataset`, que lo
     * construye—, y precisamente por eso se vuelve a montar aquí: esta función
     * es la ÚNICA frontera que garantiza qué llega al Worker, y una garantía que
     * depende de que la función de al lado siga comportándose bien no es una
     * garantía. El día que `LabDataset` gane un campo, hay que añadirlo aquí, y
     * añadirlo es el momento de preguntarse si debería cruzar.
     */
    ...(lab ? { lab: sanitizeLabDataset(lab) } : {}),
    ...(safeProject ? { project: safeProject } : {}),
  };
}

/**
 * El proyecto se reconstruye aquí porque ésta es la ÚNICA frontera del Worker.
 * Depender de que una validación vecina siga rechazando rutas inseguras no
 * garantiza qué datos cruzarán si esa validación cambia en el futuro.
 */
function sanitizeCodeProject(project: CodeProject): CodeProject | undefined {
  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(project.files)) {
    if (normalizeWorkspacePath(path) !== path) continue;
    Object.defineProperty(files, path, {
      configurable: true,
      enumerable: true,
      value: source,
      writable: true,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(files, project.entryFile)) return undefined;
  return { files, entryFile: project.entryFile };
}

/** El dataset, campo a campo. Ver la nota de arriba. */
function sanitizeLabDataset(lab: LabDataset): LabDataset {
  const table = (item: LabTable): LabTable => ({
    id: item.id,
    name: item.name,
    columns: [...item.columns],
    rows: item.rows.map((row) => [...row]),
  });

  return {
    catalog: {
      sheets: lab.catalog.sheets.map((entry) => ({
        id: entry.id,
        name: entry.name,
        rows: entry.rows,
        columns: entry.columns,
      })),
      images: lab.catalog.images.map((entry) => ({ id: entry.id, name: entry.name })),
      outputs: lab.catalog.outputs.map((entry) => ({
        id: entry.id,
        name: entry.name,
        rows: entry.rows,
        columns: entry.columns,
      })),
    },
    sheets: lab.sheets.map(table),
    outputs: lab.outputs.map(table),
    images: lab.images.map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      base64: image.base64,
    })),
    problems: lab.problems.map((problem) => ({
      kind: problem.kind,
      reference: problem.reference,
      message: problem.message,
    })),
  };
}

export function isCodeWorkerResponse(value: unknown): value is CodeWorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; id?: unknown };
  return (
    typeof candidate.id === 'number' &&
    (candidate.type === 'ready' ||
      candidate.type === 'reset' ||
      candidate.type === 'result' ||
      candidate.type === 'error')
  );
}
