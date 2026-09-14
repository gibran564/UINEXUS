import { ACADEMIC_LIMITS, PROGRAMMING_LANGUAGES, WORKSPACE_LIMITS } from './constants';
import type { BrowserRichOutput } from './browser-code-runner-protocol';
import type { ProgrammingLanguage } from './types';
import { normalizeWorkspacePath } from './workspace-files';

export type CodeRunStatus = 'ok' | 'failed' | 'timeout' | 'rejected' | 'stopped';

export interface CodeRunRequest {
  language: ProgrammingLanguage;
  source: string;
  /** El proyecto completo, cuando la ejecución es multiarchivo. Ausente = legacy. */
  files?: Record<string, string>;
  /** Cuál de `files` es el punto de entrada. Obligatorio si viene `files`. */
  entryFile?: string;
  /** Standard input is optional and never contains identity or session data. */
  stdin?: string;
}

export interface CodeProject {
  files: Record<string, string>;
  entryFile: string;
}

export interface CodeRunResult {
  status: CodeRunStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  /**
   * La salida ORDENADA y con tipos ricos, cuando el ejecutor sabe darla.
   *
   * Opcional porque `CodeRunner` es un contrato más viejo y más amplio que un
   * NexBook: el adaptador de servidor y las pruebas que devuelven resultados a
   * mano siguen siendo válidos sin esto. Quien la necesita —el kernel— comprueba
   * si está; quien no —la consola de una actividad— sigue leyendo las dos
   * cadenas.
   */
  outputs?: BrowserRichOutput[];
}

export interface CodeRunner {
  readonly name: string;
  supports(language: ProgrammingLanguage): boolean;
  run(request: CodeRunRequest): Promise<CodeRunResult>;
  interrupt?(): Promise<void>;
  dispose?(): Promise<void>;
}

/** Limits enforced before dispatch and again at the browser runtime boundary. */
export const CODE_RUN_LIMITS = {
  timeoutMs: 10_000,
  bootstrapTimeoutMs: 120_000,
  maxOutputChars: 20_000,
  maxSourceChars: ACADEMIC_LIMITS.codeMax,
} as const;

/**
 * Para qué existe un Worker de verdad en `src/workers/`.
 *
 * Java entró aquí en J1 y NO se puede ejecutar: la segunda condición de
 * `isBrowserExecutableLanguage` —lo que el catálogo promete— sigue diciendo que
 * no. Ver la nota de esa función.
 */
const BROWSER_RUNTIME_LANGUAGES = new Set<ProgrammingLanguage>(['r', 'python', 'java']);

/**
 * Sólo lo que de verdad tiene un runtime en el navegador llega a un Worker.
 *
 * Dos condiciones, y las dos hacen falta. El catálogo dice qué PROMETE la
 * interfaz (`browserExecution`); el conjunto de arriba dice para qué existe
 * código de verdad en `src/workers/`. Fiarse sólo del catálogo convertiría un
 * error de configuración —marcar Java como ejecutable— en un Worker que se
 * arranca para nada; fiarse sólo del conjunto dejaría que la promesa de la
 * interfaz y la realidad se separaran sin que nadie lo notara.
 *
 * Desde J1 esa distinción tiene un caso REAL, y no es un ejemplo: Java está en
 * el conjunto —su motor y su Worker existen y están probados— y el catálogo dice
 * `browserExecution: false`, así que esta función devuelve `false` y ni el botón
 * de ejecutar ni el selector de NexBook lo ofrecen. Activar Java es cambiar UNA
 * línea del catálogo cuando la fase de activación lo autorice, no tocar esto.
 */
export function isBrowserExecutableLanguage(
  language: ProgrammingLanguage
): language is 'r' | 'python' | 'java' {
  return (
    BROWSER_RUNTIME_LANGUAGES.has(language) &&
    PROGRAMMING_LANGUAGES.some(
      (option) => option.value === language && option.capabilities.browserExecution
    )
  );
}

export function validateCodeRunRequest(
  request: CodeRunRequest,
  supports: (language: ProgrammingLanguage) => boolean
): CodeRunResult | null {
  if (!supports(request.language)) {
    return rejectedCodeRun('Ese lenguaje no se puede ejecutar todavía.');
  }
  if (!request.source.trim()) {
    return rejectedCodeRun('Escribe código antes de ejecutarlo.');
  }
  if (request.source.length > CODE_RUN_LIMITS.maxSourceChars) {
    return rejectedCodeRun('El código es demasiado largo para ejecutarlo.');
  }
  const hasFiles = request.files !== undefined;
  const hasEntryFile = request.entryFile !== undefined;
  if (hasFiles !== hasEntryFile) {
    return rejectedCodeRun('Los archivos del proyecto y su archivo principal deben enviarse juntos.');
  }
  if (!request.files || request.entryFile === undefined) return null;

  const paths = Object.keys(request.files);
  if (paths.length === 0) {
    return rejectedCodeRun('El proyecto debe contener al menos un archivo.');
  }
  if (paths.length > WORKSPACE_LIMITS.maxFiles) {
    return rejectedCodeRun(`El proyecto admite como máximo ${WORKSPACE_LIMITS.maxFiles} archivos.`);
  }
  const totalChars = Object.values(request.files).reduce((total, file) => total + file.length, 0);
  if (totalChars > WORKSPACE_LIMITS.maxTotalWorkspaceChars) {
    return rejectedCodeRun('El contenido total del proyecto es demasiado grande.');
  }
  if (paths.some((path) => normalizeWorkspacePath(path) !== path)) {
    return rejectedCodeRun('El proyecto contiene una ruta de archivo no válida.');
  }
  if (!Object.prototype.hasOwnProperty.call(request.files, request.entryFile)) {
    return rejectedCodeRun('El archivo principal no existe en el proyecto.');
  }
  return null;
}

export function rejectedCodeRun(message: string, durationMs = 0): CodeRunResult {
  return {
    status: 'rejected',
    stdout: '',
    stderr: message,
    exitCode: null,
    durationMs,
    truncated: false,
  };
}

export function clampCodeOutput(value: string): { text: string; truncated: boolean } {
  if (value.length <= CODE_RUN_LIMITS.maxOutputChars) {
    return { text: value, truncated: false };
  }
  return {
    text: value.slice(0, CODE_RUN_LIMITS.maxOutputChars),
    truncated: true,
  };
}

export function clampCodeRunResult(result: CodeRunResult): CodeRunResult {
  const stdout = clampCodeOutput(result.stdout);
  const stderr = clampCodeOutput(result.stderr);
  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
  };
}
