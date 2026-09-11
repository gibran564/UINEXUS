'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LEGACY_CODE_LANGUAGE,
  DELIVERABLE_LABEL,
  programmingLanguageLabel,
  stepActionLabel,
} from '@/lib/constants';
import { saveWorkflowSubmission, type AssignmentDetail } from '@/lib/aula-client';
import {
  availableDependencyResults,
  hasContent,
  normalizeEvidence,
  normalizeStepPrompt,
  primaryDeliverable,
  stepState,
  workflowProgress,
} from '@/lib/workflow';
import type {
  AIWorklogData,
  CodeData,
  ExternalLinkData,
  FreeformData,
  MediaData,
  ResearchData,
  StepEvidence,
  WebProjectData,
  WorkflowStep,
} from '@/lib/types';
import { Field, Notice } from './aula-ui';
import {
  CodeFields,
  type CodeSaveState,
  FreeformFields,
  LinkFields,
  MediaFields,
  ProjectFields,
  ResearchFields,
  WorklogFields,
} from './deliverable-fields';
import { CopyButton } from './copy-button';
import { MarkdownContent } from './markdown-content';
import { NexBookStep } from '@/components/studio/nexbook-step';

/**
 * La ejecución de una actividad de varios pasos (§21, §22).
 *
 * La pantalla responde a una sola pregunta —«¿qué me toca ahora?»— y por eso el
 * índice de pasos va arriba con su estado a la vista: ✓ hecho, ● en curso, ○
 * pendiente, y bloqueado cuando falta una dependencia. Quien entra sabe dónde
 * está sin leer nada.
 *
 * Los pasos que no le corresponden a esta persona NO se pintan. `myStepIds` lo
 * calcula el servidor, que además descarta al guardar cualquier evidencia de un
 * paso ajeno: esto es comodidad, la garantía está en la API.
 *
 * Cada paso se guarda por separado. No hay un botón «guardar todo» que pueda
 * perder cuatro pasos por un error en el quinto.
 */

/**
 * Lo que se espera tras la última pulsación antes de guardar.
 *
 * Menos convertiría cada tecla en una petición; más deja demasiado trabajo sólo
 * en memoria. Además se guarda SIEMPRE antes de ejecutar, de cambiar de paso y
 * de entregar, así que este número decide la frecuencia, no si se pierde algo.
 */
const AUTOSAVE_DELAY_MS = 800;

function withState<T>(current: Record<string, T>, stepIds: string[], value: T): Record<string, T> {
  const next = { ...current };
  for (const stepId of stepIds) next[stepId] = value;
  return next;
}

export function WorkflowRunner({
  data,
  courseId,
  assignmentId,
  closed = false,
  onSaved,
}: {
  data: AssignmentDetail;
  courseId: string;
  assignmentId: string;
  /** La fecha límite ya pasó: se puede leer, no escribir. */
  closed?: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { assignment } = data;

  const mine = new Set(data.myStepIds);
  const steps = assignment.workflow.filter((step) => mine.has(step.id));

  const [evidence, setEvidence] = useState<Record<string, StepEvidence>>({});
  const [activeId, setActiveId] = useState<string | null>(steps[0]?.id ?? null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<Record<string, CodeSaveState>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * El estado más reciente, legible desde un temporizador.
   *
   * El autoguardado dispara fuera del render, así que leer `evidence` de la
   * clausura le daría el valor de hace 800 ms: justo las últimas pulsaciones
   * que hacían falta.
   */
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;

  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // El borrador se carga UNA vez: sin la guarda, cada recarga pisaría lo que la
  // persona lleva escrito sin guardar.
  useEffect(() => {
    if (hydrated) return;
    setEvidence(data.submission?.stepEvidence ?? {});
    setHydrated(true);
  }, [data.submission, hydrated]);

  const active = steps.find((step) => step.id === activeId) ?? steps[0];
  const progress = workflowProgress(steps, evidence);

  /**
   * Guarda AHORA lo que esté pendiente, y nada más.
   *
   * Manda sólo los pasos en cola, no la entrega entera. La ruta fusiona por
   * paso sobre lo ya guardado (ver `saveSteppedSubmission`), así que dos pasos
   * de código no pueden pisarse aunque se escriban casi a la vez, y un
   * autoguardado no puede revertir lo que otro paso acababa de escribir.
   */
  const flushAutosave = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Una escritura en vuelo se espera antes de empezar otra: el orden de las
    // versiones guardadas tiene que ser el orden en que se escribieron.
    if (inFlightRef.current) await inFlightRef.current;

    const stepIds = [...pendingRef.current];
    if (stepIds.length === 0 || closed) {
      pendingRef.current.clear();
      return;
    }
    pendingRef.current.clear();

    const payload = stepIds.flatMap((stepId) => {
      const entry = evidenceRef.current[stepId];
      return entry
        ? [
            {
              stepId,
              toolId: entry.toolId,
              toolName: entry.toolName,
              note: entry.note,
              data: entry.data as unknown as Record<string, unknown>,
            },
          ]
        : [];
    });
    if (payload.length === 0) return;

    setSaveState((current) => withState(current, stepIds, 'saving'));
    setSaveError(null);

    const request = (async () => {
      try {
        await saveWorkflowSubmission(assignmentId, 'draft', payload);
        setSaveState((current) => withState(current, stepIds, 'saved'));
      } catch (caught) {
        // Se devuelven a la cola: el siguiente intento —o «Guardar borrador»—
        // los reintenta en vez de darlos por perdidos.
        for (const stepId of stepIds) pendingRef.current.add(stepId);
        setSaveState((current) => withState(current, stepIds, 'error'));
        setSaveError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [assignmentId, closed]);

  /** Encola un paso y reinicia la espera. Escribir seguido no dispara ráfagas. */
  const queueAutosave = useCallback(
    (stepId: string): void => {
      if (closed) return;
      pendingRef.current.add(stepId);
      setSaveState((current) => withState(current, [stepId], 'saving'));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flushAutosave(), AUTOSAVE_DELAY_MS);
    },
    [closed, flushAutosave]
  );

  // Salir de la pantalla con un temporizador vivo dejaría una escritura
  // programada contra un componente que ya no existe.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function goToStep(stepId: string): void {
    // Cambiar de paso guarda lo pendiente del anterior. Volver y encontrarse el
    // editor vacío sería indistinguible de haber perdido el trabajo.
    void flushAutosave();
    setActiveId(stepId);
  }

  function patchEvidence(stepId: string, changes: Partial<StepEvidence>): void {
    setEvidence((current) => ({
      ...current,
      [stepId]: normalizeEvidence({ ...current[stepId], ...changes, stepId }, stepId),
    }));
  }

  function patchData(stepId: string, changes: Record<string, unknown>): void {
    setEvidence((current) => {
      const previous = current[stepId];
      return {
        ...current,
        [stepId]: normalizeEvidence(
          {
            ...previous,
            stepId,
            // El formulario trata la evidencia como un saco de campos; el
            // servidor la valida contra el entregable que pide el paso, que es
            // donde importa.
            data: {
              ...((previous?.data ?? {}) as unknown as Record<string, unknown>),
              ...changes,
            } as unknown as StepEvidence['data'],
          },
          stepId
        ),
      };
    });
  }

  async function save(intent: 'draft' | 'submit'): Promise<void> {
    // Un autoguardado en vuelo escribiría DESPUÉS de la entrega y la devolvería
    // a borrador. Se vacía la cola —el envío de abajo ya lleva todo— antes de
    // tocar nada.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;
    pendingRef.current.clear();

    setBusy(true);
    setMessage(null);
    try {
      await saveWorkflowSubmission(
        assignmentId,
        intent,
        Object.values(evidence).map((entry) => ({
          stepId: entry.stepId,
          toolId: entry.toolId,
          toolName: entry.toolName,
          note: entry.note,
          data: entry.data as unknown as Record<string, unknown>,
        }))
      );

      setSaveState({});
      setSaveError(null);

      if (intent === 'submit') {
        router.push(`/aula/${courseId}/tareas/${assignmentId}`);
        return;
      }
      setMessage({ tone: 'success', text: 'Guardado. Puedes seguir en otro momento.' });
      onSaved();
    } catch (caught) {
      setMessage({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'No se pudo guardar.',
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * `steps` ya está filtrado a los pasos de esta persona, así que lo que falta
   * se calcula sobre esa lista. Volver a filtrar por uid aquí daría siempre
   * vacío y el botón de entregar se habilitaría sin haber hecho nada.
   */
  const missing = steps.filter((step) => step.required && !hasContent(evidence[step.id]));

  if (steps.length === 0) {
    return (
      <Notice>
        No tienes pasos asignados en esta actividad. Habla con tu docente si crees que es un
        error.
      </Notice>
    );
  }

  return (
    <div>
      <nav aria-label="Pasos de la actividad" className="panel p-4">
        <p className="text-sm text-muted tabular-nums">
          {progress.done} de {progress.total} pasos completados
        </p>

        <ol className="mt-3 space-y-1">
          {steps.map((step, index) => {
            const state = stepState(step, evidence);
            const current = step.id === active?.id;

            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => goToStep(step.id)}
                  aria-current={current ? 'step' : undefined}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm ${
                    current ? 'bg-accent-soft text-accent' : 'hover:bg-sunken'
                  }`}
                >
                  <StepMark state={state} current={current} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {index + 1}. {step.title}
                    </span>
                    <span className="block text-label text-subtle">
                      {stepActionLabel(step.actionType)}
                      {!step.required && ' · opcional'}
                      {state === 'locked' && ' · bloqueado'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {active && (
        <StepPanel
          key={active.id}
          step={active}
          index={steps.findIndex((step) => step.id === active.id)}
          state={stepState(active, evidence)}
          assignmentId={assignmentId}
          evidence={evidence[active.id]}
          resources={data.resources}
          stepTools={data.stepTools}
          workflow={assignment.workflow}
          evidenceByStep={evidence}
          closed={closed}
          saveState={saveState[active.id] ?? 'idle'}
          saveError={saveError ?? undefined}
          onPatchEvidence={(changes) => patchEvidence(active.id, changes)}
          onPatchData={(changes) => patchData(active.id, changes)}
          onCodeEdited={() => queueAutosave(active.id)}
          beforeExecute={flushAutosave}
        />
      )}

      {message && (
        <div className="mt-6">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          Para entregar te falta: {missing.map((step) => step.title).join(', ')}.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-6">
        <button
          type="button"
          disabled={busy || closed || missing.length > 0}
          onClick={() => void save('submit')}
          className="btn btn-primary"
        >
          {closed ? 'Entrega cerrada' : busy ? 'Guardando…' : 'Entregar'}
        </button>
        <button
          type="button"
          disabled={busy || closed}
          onClick={() => void save('draft')}
          className="btn btn-secondary"
        >
          Guardar borrador
        </button>
        <Link href={`/aula/${courseId}/tareas/${assignmentId}`} className="btn btn-ghost">
          Volver a la actividad
        </Link>
      </div>
    </div>
  );
}

/** El estado nunca se dice sólo con color: la marca va con su texto al lado. */
function StepMark({ state, current }: { state: string; current: boolean }) {
  const mark = state === 'done' ? '✓' : state === 'locked' ? '○' : current ? '●' : '○';
  const tone =
    state === 'done' ? 'text-success' : state === 'locked' ? 'text-subtle' : 'text-muted';

  return (
    <span className={`w-4 shrink-0 text-center ${tone}`} aria-hidden="true">
      {mark}
    </span>
  );
}

function StepPanel({
  step,
  index,
  state,
  assignmentId,
  evidence,
  resources,
  stepTools,
  workflow,
  evidenceByStep,
  closed,
  saveState,
  saveError,
  onPatchEvidence,
  onPatchData,
  onCodeEdited,
  beforeExecute,
}: {
  step: WorkflowStep;
  index: number;
  state: string;
  assignmentId: string;
  evidence: StepEvidence | undefined;
  resources: AssignmentDetail['resources'];
  stepTools: AssignmentDetail['stepTools'];
  workflow: WorkflowStep[];
  evidenceByStep: Record<string, StepEvidence>;
  closed: boolean;
  saveState: CodeSaveState;
  saveError?: string;
  onPatchEvidence: (changes: Partial<StepEvidence>) => void;
  onPatchData: (changes: Record<string, unknown>) => void;
  onCodeEdited: () => void;
  beforeExecute: () => Promise<void>;
}) {
  const deliverable = primaryDeliverable(step);
  const payload = (evidence?.data ?? {}) as Record<string, unknown>;
  const inputs = availableDependencyResults(workflow, step, evidenceByStep);

  if (state === 'locked') {
    return (
      <div className="mt-6">
        <Notice>
          Este paso se desbloquea cuando completes los anteriores de los que depende.
        </Notice>
      </div>
    );
  }

  return (
    <section aria-labelledby="paso-activo" className="mt-6">
      <header className="border-b border-line pb-4">
        <p className="meta">
          Paso {index + 1} · {stepActionLabel(step.actionType)}
          {!step.required && ' · opcional'}
        </p>
        <h2 id="paso-activo" className="mt-2 font-display text-h2">
          {step.title}
        </h2>
        {step.instructions && (
          <p className="prose-block mt-3 max-w-prose whitespace-pre-line text-muted">
            {step.instructions}
          </p>
        )}
      </header>

      {inputs.length > 0 && (
        <section className="mt-5 rounded-sm border border-line bg-sunken p-4" aria-labelledby="entradas-disponibles">
          <h3 id="entradas-disponibles" className="font-display text-h3">
            Entradas disponibles
          </h3>
          <p className="hint">Resultados de pasos previos. Tú decides cuál ver o copiar.</p>
          <ul className="mt-3 space-y-3">
            {inputs.map((input) => (
              <li key={input.stepId} className="rounded-sm border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{input.title}</p>
                  <CopyButton
                    value={input.content}
                    label={input.format === 'markdown' ? 'Copiar Markdown' : 'Copiar'}
                    variant="ghost"
                  />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-accent">Ver resultado</summary>
                  <div className="mt-3 border-t border-line pt-3">
                    <MarkdownContent content={input.content} format={input.format} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      <StepPromptCard step={step} resources={resources} />

      <ToolField
        step={step}
        evidence={evidence}
        stepTools={stepTools}
        onChange={onPatchEvidence}
      />

      <div className="mt-6">
        {deliverable.type === 'none' ? (
          <Notice>
            Este paso no pide entrega. Márcalo como hecho con una nota si quieres dejar
            constancia.
          </Notice>
        ) : (
          <p className="meta mb-3">
            Entrega: {DELIVERABLE_LABEL[deliverable.type]}
            {deliverable.type === 'code' &&
              ` · ${programmingLanguageLabel(deliverable.language ?? LEGACY_CODE_LANGUAGE)}`}
            {deliverable.hint && ` — ${deliverable.hint}`}
          </p>
        )}

        {deliverable.type === 'structured' && (
          <ResearchFields
            questions={deliverable.questions}
            only={null}
            data={payload as unknown as ResearchData}
            onChange={(answers) => onPatchData({ answers })}
          />
        )}

        {deliverable.type === 'ai_worklog' && (
          <WorklogFields
            data={payload as unknown as AIWorklogData}
            onChange={onPatchData}
            resources={resources}
          />
        )}

        {deliverable.type === 'url' && (
          <LinkFields data={payload as unknown as ExternalLinkData} onChange={onPatchData} />
        )}

        {deliverable.type === 'project' && (
          <ProjectFields data={payload as unknown as WebProjectData} onChange={onPatchData} />
        )}

        {(deliverable.type === 'file' ||
          deliverable.type === 'image' ||
          deliverable.type === 'video') && (
          <MediaFields
            data={payload as unknown as MediaData}
            onChange={onPatchData}
            kind={deliverable.type}
            hint={deliverable.hint}
            assignmentId={assignmentId}
            stepId={step.id}
          />
        )}

        {deliverable.type === 'code' && (
          <CodeFields
            data={payload as unknown as CodeData}
            onChange={onPatchData}
            // El lenguaje lo dicta el PASO. Si el paso no lo trae —un registro
            // antiguo— se cae al valor por defecto en vez de dejar el
            // formulario sin saber qué pedir.
            language={deliverable.language ?? LEGACY_CODE_LANGUAGE}
            codeMode={deliverable.codeMode}
            starterCode={deliverable.starterCode ?? ''}
            executionEnabled={deliverable.executionEnabled ?? false}
            hint={deliverable.hint}
            assignmentId={assignmentId}
            stepId={step.id}
            readOnly={closed}
            onCodeEdited={onCodeEdited}
            beforeExecute={beforeExecute}
            saveState={saveState}
            saveError={saveError}
          />
        )}

        {deliverable.type === 'nexbook' && (
          <NexBookStep
            assignmentId={assignmentId}
            stepId={step.id}
            readOnly={closed}
            /*
              La evidencia del paso es una COPIA del documento, no su id. Es lo
              que hace que entregar congele el trabajo: seguir editando después
              cambia el NexBook, no la entrega. Ver `NexBookSubmissionData`.
            */
            onSnapshot={(snapshot) =>
              onPatchData({ ...snapshot, submittedAt: new Date().toISOString() })
            }
          />
        )}

        {(deliverable.type === 'text' || deliverable.type === 'resource_reference') && (
          <FreeformFields data={payload as unknown as FreeformData} onChange={onPatchData} />
        )}
      </div>

      <div className="mt-6">
        <Field label="Nota sobre este paso" hint="Opcional.">
          <textarea
            rows={2}
            value={evidence?.note ?? ''}
            onChange={(event) => onPatchEvidence({ note: event.target.value })}
            className="field"
          />
        </Field>
      </div>

      {hasContent(evidence) && (
        <p className="mt-3 text-sm text-success">Este paso ya tiene contenido.</p>
      )}
    </section>
  );
}

/**
 * Qué herramienta se usó (§24, §47).
 *
 * Con `required` sólo hay una y se rellena sola. Con `choice` se elige entre
 * las que propuso la docente. Con `free` se escribe: es trazabilidad académica,
 * no vigilancia —UINexus no comprueba, ni puede comprobar, que alguien abriera
 * de verdad esa web—.
 */
function ToolField({
  step,
  evidence,
  stepTools,
  onChange,
}: {
  step: WorkflowStep;
  evidence: StepEvidence | undefined;
  stepTools: AssignmentDetail['stepTools'];
  onChange: (changes: Partial<StepEvidence>) => void;
}) {
  const { mode, toolNames } = step.tool;
  if (mode === 'none') return null;

  /**
   * Las fichas del catálogo que siguen existiendo. El NOMBRE se lee del paso,
   * no de aquí: si la docente borró la herramienta de la biblioteca, el paso
   * sigue diciendo «usa Perplexity» y sólo se pierde el enlace.
   */
  const cards = step.tool.toolIds.flatMap((id) => (stepTools[id] ? [stepTools[id]] : []));

  if (mode === 'required') {
    const only = toolNames[0];
    return (
      <div className="mt-5 space-y-3">
        <Notice>
          Herramienta de este paso: <strong>{only ?? 'la que indique tu docente'}</strong>.
        </Notice>
        <ToolCards cards={cards} />
      </div>
    );
  }

  return (
    <div className="mt-5">
      <Field
        label="¿Qué herramienta usaste?"
        hint={
          mode === 'choice'
            ? 'Elige la que hayas usado de verdad.'
            : 'Escribe cuál usaste. Cualquiera vale.'
        }
      >
        {mode === 'choice' && toolNames.length > 0 ? (
          <select
            value={evidence?.toolName ?? ''}
            onChange={(event) => onChange({ toolName: event.target.value })}
            className="field"
          >
            <option value="">— Elige —</option>
            {toolNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            list={`tools-${step.id}`}
            value={evidence?.toolName ?? ''}
            onChange={(event) => onChange({ toolName: event.target.value })}
            placeholder="Perplexity, NotebookLM, Napkin…"
            className="field"
          />
        )}
        <datalist id={`tools-${step.id}`}>
          {toolNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>
      <ToolCards cards={cards} />
    </div>
  );
}

/** Enlace y descripción de las herramientas que están en la biblioteca. */
function ToolCards({
  cards,
}: {
  cards: { id: string; title: string; url: string | null; description: string }[];
}) {
  if (cards.length === 0) return null;

  return (
    <ul className="mt-3 space-y-2">
      {cards.map((card) => (
        <li key={card.id} className="panel flex flex-wrap items-center gap-3 p-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{card.title}</span>
            {card.description && (
              <span className="block text-label text-subtle">{card.description}</span>
            )}
          </span>
          {card.url && (
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Abrir ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * El prompt del paso, listo para copiar.
 *
 * Da igual de dónde venga: escrito dentro de la actividad o elegido de la
 * biblioteca, aquí se ve igual. El alumnado no tiene por qué saber cuál de las
 * dos cosas hizo su docente.
 *
 * El de biblioteca se resuelve CONTRA EL RECURSO VIGENTE —el servidor lo manda
 * ya resuelto en `resources`—, así que corregir el prompt lo corrige aquí. Si
 * el recurso desapareció queda el título, que es mejor que un hueco mudo.
 */
function StepPromptCard({
  step,
  resources,
}: {
  step: WorkflowStep;
  resources: AssignmentDetail['resources'];
}) {
  const prompt = normalizeStepPrompt(step.prompt);
  if (prompt.mode === 'none') return null;

  const fromLibrary =
    prompt.mode === 'library'
      ? resources.prompts.find((item) => item.id === prompt.resourceId)
      : undefined;

  const text = fromLibrary?.prompt ?? (prompt.mode === 'inline' ? prompt.text : '');
  const title = fromLibrary?.title || prompt.title;

  return (
    <section className="mt-5 rounded-sm border border-line bg-sunken p-4" aria-labelledby="prompt-paso">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="prompt-paso" className="font-display text-h3">
          Prompt{title ? `: ${title}` : ''}
        </h3>
        {text && <CopyButton value={text} label="Copiar prompt" variant="ghost" />}
      </div>

      {text ? (
        <pre className="mt-3 whitespace-pre-wrap font-mono text-sm">{text}</pre>
      ) : (
        <p className="hint mt-2">
          El prompt de este paso ya no está disponible. Pregúntale a tu docente.
        </p>
      )}
    </section>
  );
}
