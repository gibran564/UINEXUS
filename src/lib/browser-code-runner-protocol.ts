import type { CodeRunStatus } from './code-runner-contract';

export interface BrowserExecutionOptions {
  maxOutputChars: number;
}

export type PythonWorkerRequest =
  | { type: 'prepare'; id: number }
  | {
      type: 'run';
      id: number;
      language: 'python';
      source: string;
      executionOptions: BrowserExecutionOptions;
    };

export type PythonWorkerResponse =
  | { type: 'ready'; id: number }
  | {
      type: 'result';
      id: number;
      status: Extract<CodeRunStatus, 'ok' | 'failed' | 'rejected'>;
      stdout: string;
      stderr: string;
      truncated: boolean;
    }
  | { type: 'error'; id: number; message: string };

export function isPythonWorkerResponse(value: unknown): value is PythonWorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; id?: unknown };
  return (
    typeof candidate.id === 'number' &&
    (candidate.type === 'ready' || candidate.type === 'result' || candidate.type === 'error')
  );
}
