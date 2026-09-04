'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DELIVERABLE_LABEL, stepActionLabel } from '@/lib/constants';
import { saveWorkflowSubmission, type AssignmentDetail } from '@/lib/aula-client';
import {
  availableDependencyResults,
  hasContent,
  normalizeEvidence,
  primaryDeliverable,
  stepState,
  workflowProgress,
} from '@/lib/workflow';
import type {
  AIWorklogData,
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
  FreeformFields,
  LinkFields,
  MediaFields,
  ProjectFields,
  ResearchFields,
  WorklogFields,
} from './deliverable-fields';
import { CopyButton } from './copy-button';
import { MarkdownContent } from './markdown-content';

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
export function WorkflowRunner({
  data,
  courseId,
  assignmentId,
  onSaved,
}: {
  data: AssignmentDetail;
  courseId: string;
  assignmentId: string;
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

  // El borrador se carga UNA vez: sin la guarda, cada recarga pisaría lo que la
  // persona lleva escrito sin guardar.
  useEffect(() => {
    if (hydrated) return;
    setEvidence(data.submission?.stepEvidence ?? {});
    setHydrated(true);
  }, [data.submission, hydrated]);

  const active = steps.find((step) => step.id === activeId) ?? steps[0];
  const progress = workflowProgress(steps, evidence);

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
                  onClick={() => setActiveId(step.id)}
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
          onPatchEvidence={(changes) => patchEvidence(active.id, changes)}
          onPatchData={(changes) => patchData(active.id, changes)}
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
          disabled={busy || missing.length > 0}
          onClick={() => void save('submit')}
          className="btn btn-primary"
        >
          {busy ? 'Guardando…' : 'Entregar'}
        </button>
        <button
          type="button"
          disabled={busy}
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
  onPatchEvidence,
  onPatchData,
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
  onPatchEvidence: (changes: Partial<StepEvidence>) => void;
  onPatchData: (changes: Record<string, unknown>) => void;
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
