import { ACADEMIC_LIMITS, PROGRAMMING_LANGUAGES } from './constants';
import type { BrowserRichOutput } from './browser-code-runner-protocol';
import type { ProgrammingLanguage } from './types';

export type CodeRunStatus = 'ok' | 'failed' | 'timeout' | 'rejected' | 'stopped';

export interface CodeRunRequest {
  language: ProgrammingLanguage;
  source: string;
  /** Standard input is optional and never contains identity or session data. */
  stdin?: string;
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

const BROWSER_RUNTIME_LANGUAGES = new Set<ProgrammingLanguage>(['r', 'python']);

/**
 * Sólo lo que de verdad tiene un runtime en el navegador llega a un Worker.
 *
 * Dos condiciones, y las dos hacen falta. El catálogo dice qué PROMETE la
 * interfaz (`browserExecution`); el conjunto de arriba dice para qué existe
 * código de verdad en `src/workers/`. Fiarse sólo del catálogo convertiría un
 * error de configuración —marcar Java como ejecutable— en un Worker que se
 * arranca para nada; fiarse sólo del conjunto dejaría que la promesa de la
 * interfaz y la realidad se separaran sin que nadie lo notara.
 */
export function isBrowserExecutableLanguage(
  language: ProgrammingLanguage
): language is 'r' | 'python' {
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
