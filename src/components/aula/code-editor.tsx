'use client';

import dynamic from 'next/dynamic';
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { OnMount } from '@monaco-editor/react';
import {
  PROGRAMMING_LANGUAGES,
  programmingLanguageLabel,
} from '@/lib/constants';
import type { CodeRunResult } from '@/lib/code-runner-contract';
import {
  getBrowserCodeRunner,
  type BrowserCodeRunnerStatus,
} from '@/lib/browser-code-runner';
import type { ProgrammingLanguage } from '@/lib/types';

/**
 * Monaco is part of the client chunk for this component; the loader is pointed
 * at the installed npm package so it never injects scripts from a public CDN.
 */
const MonacoEditor = dynamic(
  async () => {
    const [{ default: Editor, loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
    ]);

    if (typeof self !== 'undefined') {
      const scope = self as typeof self & {
        MonacoEnvironment?: {
          getWorker: (_workerId: string, _label: string) => Worker;
        };
      };
      scope.MonacoEnvironment = {
        getWorker: () =>
          new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {
            type: 'module',
          }),
      };
    }

    loader.config({ monaco });
    return Editor;
  },
  { ssr: false, loading: () => null }
);

const languageOption = (language: ProgrammingLanguage) =>
  PROGRAMMING_LANGUAGES.find((option) => option.value === language);

export function monacoLanguageFor(language: ProgrammingLanguage): string {
  return languageOption(language)?.monacoLanguage ?? String(language);
}

export function sourceFilenameFor(language: ProgrammingLanguage): string {
  const extension = languageOption(language)?.extension ?? 'txt';
  return `solucion.${language === 'r' ? extension.toUpperCase() : extension}`;
}

type EditorTheme = 'vs' | 'vs-dark';

function currentEditorTheme(): EditorTheme {
  if (typeof document === 'undefined') return 'vs';
  return document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs';
}

interface BoundaryProps {
  children: ReactNode;
  onError: () => void;
}

class MonacoBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface CodeEditorProps {
  language: ProgrammingLanguage;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  starterCode?: string;
  executionEnabled?: boolean;
  /** Persist the latest source before handing it to an isolated runner. */
  beforeExecute?: () => Promise<void>;
  height?: number;
  ariaLabel?: string;
}

export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  executionEnabled = false,
  beforeExecute,
  height = 420,
  ariaLabel,
}: CodeEditorProps) {
  const [theme, setTheme] = useState<EditorTheme>('vs');
  const [advancedReady, setAdvancedReady] = useState(false);
  const [advancedFailed, setAdvancedFailed] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<BrowserCodeRunnerStatus>('idle');
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const runnerRef = useRef<ReturnType<typeof getBrowserCodeRunner>>(null);
  const executeRef = useRef<() => void>(() => undefined);
  const label = programmingLanguageLabel(language);

  useEffect(() => {
    setTheme(currentEditorTheme());
    const observer = new MutationObserver(() => setTheme(currentEditorTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const activeRunner = runnerRef.current;
    runnerRef.current = null;
    setRuntimeStatus('idle');
    setResult(null);
    return () => {
      if (activeRunner) void activeRunner.dispose();
    };
  }, [language]);

  useEffect(
    () => () => {
      const runner = runnerRef.current;
      runnerRef.current = null;
      if (runner) void runner.dispose();
    },
    []
  );

  const execute = useCallback(async (): Promise<void> => {
    if (!executionEnabled || !advancedReady || runtimeStatus === 'running') return;

    setResult(null);
    try {
      await beforeExecute?.();
    } catch (caught) {
      setRuntimeStatus('error');
      setResult(rejectedResult(caught instanceof Error ? caught.message : 'No se pudo guardar el código.'));
      return;
    }

    let runner = runnerRef.current;
    if (!runner) {
      runner = getBrowserCodeRunner(language, { onStatusChange: setRuntimeStatus });
      runnerRef.current = runner;
    }
    if (!runner) {
      setRuntimeStatus('error');
      setResult(rejectedResult(`La ejecución de ${label} no está disponible.`));
      return;
    }

    setRuntimeStatus('running');
    try {
      setResult(await runner.run({ language, source: value }));
    } catch (caught) {
      setRuntimeStatus('error');
      setResult(
        rejectedResult(caught instanceof Error ? caught.message : 'No se pudo ejecutar el código.')
      );
    }
  }, [advancedReady, beforeExecute, executionEnabled, label, language, runtimeStatus, value]);

  executeRef.current = () => void execute();

  const handleMount: OnMount = (editor, monaco) => {
    setAdvancedReady(true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => executeRef.current());
  };

  async function stop(): Promise<void> {
    const runner = runnerRef.current;
    if (!runner) return;
    await runner.interrupt();
  }

  const running = runtimeStatus === 'running' || runtimeStatus === 'preparing';
  const editorLabel = ariaLabel ?? `Editor de código ${label}`;

  return (
    <div className="space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-sm border border-line-strong bg-sunken"
        style={{ minHeight: Math.min(height, 240) }}
      >
        {!advancedReady && (
          <textarea
            aria-label={editorLabel}
            spellCheck={false}
            readOnly={readOnly}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            style={{ minHeight: height }}
            className="field resize-y rounded-none border-0 font-mono text-sm"
          />
        )}

        <MonacoBoundary
          onError={() => {
            setAdvancedFailed(true);
            setAdvancedReady(false);
          }}
        >
          <MonacoEditor
            height={height}
            language={monacoLanguageFor(language)}
            value={value}
            theme={theme}
            onChange={(next) => onChange?.(next ?? '')}
            onMount={handleMount}
            options={{
              readOnly,
              domReadOnly: readOnly,
              minimap: { enabled: false },
              lineNumbers: 'on',
              automaticLayout: true,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              bracketPairColorization: { enabled: true },
              padding: { top: 12, bottom: 12 },
              fontSize: 14,
              tabSize: language === 'python' ? 4 : 2,
              insertSpaces: true,
              ariaLabel: editorLabel,
            }}
          />
        </MonacoBoundary>
      </div>

      {!advancedReady && (
        <p className="text-sm text-muted" role="status">
          {advancedFailed
            ? 'El editor avanzado no pudo cargarse. Puedes continuar editando y entregando tu código.'
            : 'Preparando el editor avanzado… Puedes comenzar a escribir mientras carga.'}
        </p>
      )}

      {executionEnabled && (
        <section className="rounded-sm border border-line bg-sunken" aria-label="Ejecución de código">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className="text-sm font-medium">{executionStatusLabel(runtimeStatus, result)}</p>
            <div className="flex flex-wrap gap-2">
              {running && (
                <button type="button" onClick={() => void stop()} className="btn btn-secondary btn-sm">
                  Detener
                </button>
              )}
              <button
                type="button"
                disabled={!advancedReady || running}
                onClick={() => void execute()}
                className="btn btn-primary btn-sm"
              >
                ▶ Ejecutar
              </button>
            </div>
          </div>

          {!advancedReady && (
            <p className="px-3 py-3 text-sm text-muted">
              La ejecución estará disponible cuando cargue el editor avanzado.
            </p>
          )}

          {running && (
            <p className="px-3 py-3 text-sm text-muted" role="status">
              {runtimeStatus === 'preparing' ? `Preparando ${label}…` : 'Ejecutando…'}
            </p>
          )}

          {result && !running && <ExecutionResult result={result} />}
        </section>
      )}
    </div>
  );
}

function rejectedResult(message: string): CodeRunResult {
  return {
    status: 'rejected',
    stdout: '',
    stderr: message,
    exitCode: null,
    durationMs: 0,
    truncated: false,
  };
}

function executionStatusLabel(
  runtimeStatus: BrowserCodeRunnerStatus,
  result: CodeRunResult | null
): string {
  if (runtimeStatus === 'preparing') return 'Preparando…';
  if (runtimeStatus === 'running') return 'Ejecutando…';
  if (!result) return runtimeStatus === 'ready' ? 'Runtime listo' : 'Listo';
  if (result.status === 'ok') return 'Finalizado';
  if (result.status === 'timeout') return 'Tiempo excedido';
  if (result.status === 'stopped') return 'Detenido';
  return 'Error';
}

function ExecutionResult({ result }: { result: CodeRunResult }) {
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-label text-subtle">
        <span>Tiempo de ejecución: {result.durationMs} ms</span>
        {result.truncated && <span>La salida se truncó por seguridad.</span>}
      </div>
      {result.stdout && (
        <div>
          <p className="meta">Salida</p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-fg">
            {result.stdout}
          </pre>
        </div>
      )}
      {result.stderr && (
        <div>
          <p className="meta">Errores</p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-danger">
            {result.stderr}
          </pre>
        </div>
      )}
      {!result.stdout && !result.stderr && <p className="text-subtle">El programa no produjo salida.</p>}
    </div>
  );
}
