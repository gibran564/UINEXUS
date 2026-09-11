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
  languageExecutionNote,
  programmingLanguageLabel,
} from '@/lib/constants';
import type { CodeRunResult } from '@/lib/code-runner-contract';
import {
  canRunInBrowser,
  getBrowserCodeRunner,
  type BrowserCodeRunner,
  type BrowserCodeRunnerStatus,
} from '@/lib/browser-code-runner';
import type { ProgrammingLanguage } from '@/lib/types';

/**
 * El editor de código, uno solo para todos los lenguajes.
 *
 * No hay `REditor` ni `PythonEditor`, y no los habrá: el lenguaje es un
 * PARÁMETRO. Duplicar el componente por lenguaje habría duplicado también el
 * autoguardado, el tema, la consola y el atajo de ejecutar, y habría que
 * arreglar cada fallo dos veces. Lo que cambia entre R y Python cabe en
 * `PROGRAMMING_LANGUAGES`.
 *
 * Monaco entra por `next/dynamic` sin SSR porque necesita `window` y porque no
 * tiene sentido enviarlo en el HTML de una actividad que quizá no pida código.
 *
 * Si Monaco no carga —una red mala, un navegador viejo, un bloqueador— queda un
 * `<textarea>` con el mismo valor y el mismo `onChange`. Entregar la tarea
 * nunca puede depender de que un editor de 3 MB llegue entero.
 */

const MonacoEditor = dynamic(
  async () => {
    /**
     * La ruta importa. `import('monaco-editor')` a secas acaba resolviendo el
     * paquete AMD de `min/`, que webpack no sabe empaquetar. `editor/editor.main`
     * es la entrada ESM —a través del mapa de `exports`, no por `esm/vs/…`, que
     * el propio mapa duplicaría— y trae lo que este editor promete: búsqueda,
     * deshacer, emparejado de llaves y el resaltado de R y de Python.
     */
    const [{ default: Editor, loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor/editor/editor.main.js'),
    ]);

    /**
     * Monaco se apunta al paquete instalado, NO a un CDN.
     *
     * Por defecto `@monaco-editor/react` inyecta un `<script>` de jsdelivr. Eso
     * significaría abrir `script-src` de toda la plataforma a un tercero para
     * pintar un editor, y que una clase dependa de que ese CDN esté vivo.
     */
    if (typeof self !== 'undefined') {
      const scope = self as typeof self & {
        MonacoEnvironment?: { getWorker: (_id: string, _label: string) => Worker };
      };
      scope.MonacoEnvironment = {
        getWorker: () =>
          new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
            type: 'module',
          }),
      };
    }

    loader.config({ monaco });
    return Editor;
  },
  { ssr: false, loading: () => null }
);

/** Si Monaco no ha montado para entonces, se asume que no va a montar. */
const MONACO_GIVE_UP_MS = 10_000;

/** Lenguajes cuya convención es sangrar con cuatro espacios. */
const INDENT_FOUR = new Set<ProgrammingLanguage>(['python', 'java', 'c', 'cpp']);

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

class MonacoBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface CodeEditorProps {
  language: ProgrammingLanguage;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** El programa inicial de la docente, si lo hay. Habilita «Restablecer». */
  starterCode?: string;
  executionEnabled?: boolean;
  /** Persiste el fuente antes de entregárselo a un ejecutor aislado. */
  beforeExecute?: () => Promise<void>;
  height?: number;
  ariaLabel?: string;
  /** Se pinta encima de la consola: estado de guardado, avisos del paso… */
  toolbar?: ReactNode;
}

export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  starterCode = '',
  executionEnabled = false,
  beforeExecute,
  height = 420,
  ariaLabel,
  toolbar,
}: CodeEditorProps) {
  const [theme, setTheme] = useState<EditorTheme>('vs');
  const [mounted, setMounted] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<BrowserCodeRunnerStatus>('idle');
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const runnerRef = useRef<BrowserCodeRunner | null>(null);
  const executeRef = useRef<() => void>(() => undefined);
  const label = programmingLanguageLabel(language);

  /**
   * Tres estados, no dos.
   *
   * `runnable` es «hay botón y funciona». `unavailable` es «la actividad pide
   * ejecución pero este lenguaje no la tiene»: Java y C se escriben aquí, no se
   * compilan aquí, y callarlo dejaría a alguien buscando un botón que no
   * existe. El tercero —la actividad no pide ejecutar— no muestra nada.
   */
  const runnable = executionEnabled && canRunInBrowser(language);
  const unavailable = executionEnabled && !runnable;
  const executionNote = languageExecutionNote(language);

  useEffect(() => {
    setTheme(currentEditorTheme());
    const observer = new MutationObserver(() => setTheme(currentEditorTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Monaco que no monta en diez segundos es Monaco que no va a montar. Mejor un
  // `<textarea>` a tiempo que un hueco gris indefinido.
  useEffect(() => {
    if (mounted || fallback) return;
    const timer = setTimeout(() => setFallback(true), MONACO_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [mounted, fallback]);

  // Cambiar de lenguaje invalida el runtime: el de Python no ejecuta R.
  useEffect(() => {
    const previous = runnerRef.current;
    runnerRef.current = null;
    setRuntimeStatus('idle');
    setResult(null);
    return () => {
      void previous?.dispose();
    };
  }, [language]);

  useEffect(
    () => () => {
      const runner = runnerRef.current;
      runnerRef.current = null;
      void runner?.dispose();
    },
    []
  );

  const execute = useCallback(async (): Promise<void> => {
    if (!runnable || runtimeStatus === 'running' || runtimeStatus === 'preparing') return;

    setResult(null);
    try {
      // Ejecutar sin haber guardado deja al alumnado mirando la salida de un
      // código que la entrega no tiene. Se guarda primero, siempre.
      await beforeExecute?.();
    } catch (caught) {
      setResult(
        rejectedResult(
          caught instanceof Error ? caught.message : 'No se pudo guardar el código antes de ejecutarlo.'
        )
      );
      return;
    }

    let runner = runnerRef.current;
    if (!runner) {
      // El runtime se arranca AQUÍ, en la primera ejecución. Abrir una tarea de
      // programación no puede costar 13 MB de WebAssembly que nadie pidió.
      runner = getBrowserCodeRunner(language, { onStatusChange: setRuntimeStatus });
      runnerRef.current = runner;
    }
    if (!runner) {
      setResult(rejectedResult(`La ejecución de ${label} no está disponible en este navegador.`));
      return;
    }

    setResult(await runner.run({ language, source: value }));
  }, [beforeExecute, label, language, runnable, runtimeStatus, value]);

  executeRef.current = () => void execute();

  const handleMount: OnMount = (editor, monaco) => {
    setMounted(true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => executeRef.current());
  };

  async function stop(): Promise<void> {
    await runnerRef.current?.interrupt();
  }

  function resetToStarter(): void {
    setConfirmingReset(false);
    onChange?.(starterCode);
  }

  const busy = runtimeStatus === 'running' || runtimeStatus === 'preparing';
  const editorLabel = ariaLabel ?? `Editor de código ${label}`;
  const canReset = !readOnly && Boolean(starterCode) && Boolean(onChange);
  const resetWouldDiscard = value.trim().length > 0 && value !== starterCode;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border border-line-strong bg-sunken">
        {fallback ? (
          <textarea
            aria-label={editorLabel}
            spellCheck={false}
            readOnly={readOnly}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                executeRef.current();
              }
            }}
            style={{ minHeight: height }}
            className="field resize-y rounded-none border-0 font-mono text-sm"
          />
        ) : (
          <MonacoBoundary onError={() => setFallback(true)}>
            <MonacoEditor
              height={height}
              language={monacoLanguageFor(language)}
              value={value}
              theme={theme}
              onChange={(next) => onChange?.(next ?? '')}
              onMount={handleMount}
              options={{
                readOnly,
                // Sin esto el textarea oculto de Monaco sigue siendo editable
                // con el teclado: la vista docente dejaría de ser de sólo
                // lectura para quien navegue con tabulador.
                domReadOnly: readOnly,
                minimap: { enabled: false },
                lineNumbers: 'on',
                automaticLayout: true,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                bracketPairColorization: { enabled: true },
                matchBrackets: 'always',
                find: { addExtraSpaceOnTop: false },
                padding: { top: 12, bottom: 12 },
                fontSize: 14,
                // La sangría de Python es sintaxis, y cuatro espacios es lo que
                // pide PEP 8. Java, C y C++ comparten esa convención; R y el
                // ecosistema web usan dos.
                tabSize: INDENT_FOUR.has(language) ? 4 : 2,
                insertSpaces: true,
                ariaLabel: editorLabel,
              }}
            />
          </MonacoBoundary>
        )}
      </div>

      {!mounted && !fallback && (
        <p className="text-sm text-muted" role="status">
          Preparando el editor…
        </p>
      )}
      {fallback && (
        <p className="hint" role="status">
          Editor simplificado. Puedes escribir, guardar y entregar con normalidad.
        </p>
      )}

      {(toolbar || canReset) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{toolbar}</div>
          {canReset && (
            <div className="flex flex-wrap items-center gap-2">
              {confirmingReset ? (
                <>
                  <span className="text-sm text-muted">¿Descartar tu código y volver al inicial?</span>
                  <button type="button" onClick={resetToStarter} className="btn btn-secondary btn-sm">
                    Sí, restablecer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="btn btn-ghost btn-sm"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  // Sólo se pregunta cuando hay algo que perder. Confirmar para
                  // reemplazar un editor vacío es ruido.
                  onClick={() => (resetWouldDiscard ? setConfirmingReset(true) : resetToStarter())}
                  className="btn btn-ghost btn-sm"
                >
                  Restablecer código inicial
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {unavailable && (
        <section
          className="rounded-sm border border-line bg-sunken px-3 py-3"
          aria-label={`Ejecución de ${label}`}
        >
          <p className="text-sm font-medium">Ejecución no disponible</p>
          <p className="mt-1 text-sm text-muted">
            {executionNote ?? `UINexus todavía no puede ejecutar ${label}.`} Guardar y entregar
            funciona con normalidad.
          </p>
        </section>
      )}

      {runnable && (
        <section className="rounded-sm border border-line bg-sunken" aria-label={`Ejecución de ${label}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className="text-sm font-medium" role="status">
              {executionStatusLabel(runtimeStatus, result, label)}
            </p>
            <div className="flex flex-wrap gap-2">
              {busy && (
                <button type="button" onClick={() => void stop()} className="btn btn-secondary btn-sm">
                  Detener
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void execute()}
                className="btn btn-primary btn-sm"
                title="Ctrl + Enter"
              >
                ▶ Ejecutar
              </button>
            </div>
          </div>

          {busy ? (
            <p className="px-3 py-3 text-sm text-muted">
              {runtimeStatus === 'preparing'
                ? `Preparando ${label}… la primera vez tarda unos segundos.`
                : 'Ejecutando…'}
            </p>
          ) : result ? (
            <ExecutionResult result={result} />
          ) : (
            <p className="px-3 py-3 text-sm text-subtle">
              Ejecuta con el botón o con Ctrl + Enter. Tu código no sale de este navegador.
            </p>
          )}
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

export function executionStatusLabel(
  runtimeStatus: BrowserCodeRunnerStatus,
  result: CodeRunResult | null,
  languageLabel: string
): string {
  if (runtimeStatus === 'preparing') return `Preparando ${languageLabel}…`;
  if (runtimeStatus === 'running') return 'Ejecutando…';
  if (!result) return runtimeStatus === 'ready' ? `${languageLabel} listo` : 'Listo';
  if (result.status === 'ok') return 'Finalizado';
  if (result.status === 'timeout') return 'Tiempo excedido';
  if (result.status === 'stopped') return 'Detenido';
  return 'Error';
}

function ExecutionResult({ result }: { result: CodeRunResult }) {
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-label text-subtle">
        <span>Duración: {result.durationMs} ms</span>
        {result.truncated && <span>La salida se truncó al llegar al límite.</span>}
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

      {!result.stdout && !result.stderr && (
        <p className="text-subtle">El programa terminó sin escribir nada.</p>
      )}
    </div>
  );
}
