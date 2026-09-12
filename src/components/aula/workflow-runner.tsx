'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import {
  LEGACY_CODE_LANGUAGE,
  programmingLanguageLabel,
} from '@/lib/constants';
import { partActionLabel } from '@/lib/activity-builder';
import { saveWorkflowSubmission, type AssignmentDetail } from '@/lib/aula-client';
import {
  REVIEWED_NOTE,
  blockedBy,
  humanizeSubmitError,
  isReviewedNote,
  missingToSubmit,
  partIsComplete,
  partStatus,
  type StudentWork,
} from '@/lib/student-activity';
import {
  availableDependencyResults,
  normalizeEvidence,
  normalizeStepPrompt,
  primaryDeliverable,
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
import { MissingList, PartStatusChip, WorkOverview } from './student-work';
import { NexBookStep } from '@/components/studio/nexbook-step';

/**
 * Hacer la actividad.
 *
 * ## La actividad es el centro
 *
 * NexLab, NexCode y el registro de IA se abren AQUÍ, dentro de la Parte que los
 * pide, y no en una aplicación aparte que expulse a quien la está haciendo. Por
 * eso el índice de Partes con su estado va arriba y sigue visible: se trabaja,
 * se guarda, se vuelve, y el progreso está actualizado sin haber ido a ningún
 * sitio.
 *
 * ## Lo que decide qué se pinta
 *
 * El ENTREGABLE de la Parte, nunca cuántas Partes hay. Una actividad por partes
 * con una sola sigue siendo una actividad por partes, y su Parte puede pedir un
 * laboratorio que el formulario de siempre no sabe pintar. Contar pasos
 * confundía «una parte» con «ninguna»; ver `submission-form.tsx`.
 *
 * ## Guardar no es entregar
 *
 * Se guarda solo mientras se trabaja, se puede guardar a mano, y entregar es un
 * botón distinto que además pide confirmación: la entrega congela una copia y
 * eso conviene decirlo antes y no después.
 */

/**
 * Lo que se espera tras la última pulsación antes de guardar.
 *
 * Menos convertiría cada tecla en una petición; más deja demasiado trabajo sólo
 * en memoria. Además se guarda SIEMPRE antes de ejecutar, de cambiar de Parte y
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
  const [confirming, setConfirming] = useState(false);

  const panelRef = useRef<HTMLElement | null>(null);

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

  /**
   * Lo que hay hecho, mirado desde las dos fuentes que existen.
   *
   * `myLabs` lo manda el servidor y dice qué laboratorios están ya abiertos.
   * Sin él, volver al día siguiente enseñaría «Sin empezar» sobre una hora de
   * trabajo: un NexLab se guarda en su propio documento y la entrega sólo tiene
   * una copia cuando se guarda o se entrega.
   */
  const work: StudentWork = { evidence, labs: new Set(data.myLabs) };

  const active = steps.find((step) => step.id === activeId) ?? steps[0];
  const activeIndex = active ? steps.findIndex((step) => step.id === active.id) : -1;
  const missing = missingToSubmit(steps, work);

  /**
   * Guarda AHORA lo que esté pendiente, y nada más.
   *
   * Manda sólo las Partes en cola, no la entrega entera. La ruta fusiona por
   * Parte sobre lo ya guardado (ver `saveSteppedSubmission`), así que dos
   * Partes de código no pueden pisarse aunque se escriban casi a la vez, y un
   * autoguardado no puede revertir lo que otra Parte acababa de escribir.
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
        // Se devuelven a la cola: el siguiente intento —o «Guardar»— los
        // reintenta en vez de darlos por perdidos.
        for (const stepId of stepIds) pendingRef.current.add(stepId);
        setSaveState((current) => withState(current, stepIds, 'error'));
        setSaveError(
          humanizeSubmitError(caught instanceof Error ? caught.message : 'No se pudo guardar.')
        );
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [assignmentId, closed]);

  /** Encola una Parte y reinicia la espera. Escribir seguido no dispara ráfagas. */
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

  function goToPart(stepId: string): void {
    // Cambiar de Parte guarda lo pendiente de la anterior. Volver y encontrarse
    // el editor vacío sería indistinguible de haber perdido el trabajo.
    void flushAutosave();
    setActiveId(stepId);
    setConfirming(false);
    // El foco sigue a la Parte que se abre: con teclado, quedarse en el índice
    // obliga a recorrer toda la lista otra vez para llegar al formulario.
    requestAnimationFrame(() => panelRef.current?.focus());
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
            // servidor la valida contra el entregable que pide la Parte, que es
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
      setMessage({ tone: 'success', text: 'Guardado. Puedes cerrar y seguir en otro momento.' });
      onSaved();
    } catch (caught) {
      setConfirming(false);
      setMessage({
        tone: 'error',
        text: humanizeSubmitError(
          caught instanceof Error ? caught.message : 'No se pudo guardar.'
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  if (steps.length === 0) {
    return (
      <Notice>
        No tienes partes asignadas en esta actividad. Habla con tu docente si crees que es un
        error.
      </Notice>
    );
  }

  return (
    <div>
      <section aria-label="Tus partes" className="panel p-4 sm:p-5">
        <WorkOverview
          parts={assignment.workflow}
          mine={mine}
          work={work}
          activeId={active?.id ?? null}
          onOpen={goToPart}
        />
      </section>

      {active && (
        <PartPanel
          key={active.id}
          ref={panelRef}
          parts={steps}
          part={active}
          index={activeIndex}
          assignmentId={assignmentId}
          evidence={evidence[active.id]}
          work={work}
          resources={data.resources}
          stepTools={data.stepTools}
          workflow={assignment.workflow}
          closed={closed}
          saveState={saveState[active.id] ?? 'idle'}
          saveError={saveError ?? undefined}
          onPatchEvidence={(changes) => patchEvidence(active.id, changes)}
          onPatchData={(changes) => patchData(active.id, changes)}
          onCodeEdited={() => queueAutosave(active.id)}
          beforeExecute={flushAutosave}
        />
      )}

      {steps.length > 1 && (
        <nav
          aria-label="Moverse entre partes"
          className="mt-6 flex flex-wrap items-center justify-between gap-3"
        >
          <button
            type="button"
            disabled={activeIndex <= 0}
            onClick={() => goToPart(steps[activeIndex - 1]!.id)}
            className="btn btn-ghost"
          >
            ← Parte anterior
          </button>
          <button
            type="button"
            disabled={activeIndex < 0 || activeIndex >= steps.length - 1}
            onClick={() => goToPart(steps[activeIndex + 1]!.id)}
            className="btn btn-ghost"
          >
            Parte siguiente →
          </button>
        </nav>
      )}

      {message && (
        <div className="mt-6">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <section aria-labelledby="entregar" className="mt-8 border-t border-line pt-6">
        <h2 id="entregar" className="font-display text-h3">
          Entregar
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Guardar deja tu trabajo a medias y sólo lo ves tú. Entregar se lo manda a tu docente.
        </p>

        {missing.length > 0 ? (
          <div className="mt-4">
            <MissingList items={missing} onOpen={goToPart} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-success" role="status">
            ✓ Todas tus partes están completas.
          </p>
        )}

        {confirming ? (
          <div className="panel mt-4 p-4">
            <p className="text-sm">
              <strong>¿Entregar esta actividad?</strong> Se guarda una copia de tu trabajo tal y
              como está ahora, y eso es lo que verá tu docente. Puedes seguir trabajando en tus
              laboratorios y en tus copias personales: esa copia entregada no cambia.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save('submit')}
                className="btn btn-primary"
              >
                {busy ? 'Entregando…' : 'Sí, entregar'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="btn btn-ghost"
              >
                Todavía no
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || closed || missing.length > 0}
              onClick={() => setConfirming(true)}
              className="btn btn-primary"
            >
              {closed ? 'Entrega cerrada' : 'Entregar actividad'}
            </button>
            <button
              type="button"
              disabled={busy || closed}
              onClick={() => void save('draft')}
              className="btn btn-secondary"
            >
              {busy ? 'Guardando…' : 'Guardar y seguir después'}
            </button>
            <Link href={`/aula/${courseId}/tareas/${assignmentId}`} className="btn btn-ghost">
              Volver a la actividad
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Una Parte
// ---------------------------------------------------------------------------

function PartPanel({
  ref,
  parts,
  part,
  index,
  assignmentId,
  evidence,
  work,
  resources,
  stepTools,
  workflow,
  closed,
  saveState,
  saveError,
  onPatchEvidence,
  onPatchData,
  onCodeEdited,
  beforeExecute,
}: {
  ref: Ref<HTMLElement>;
  /** Las Partes de esta persona, para explicar qué bloquea a cuál. */
  parts: readonly WorkflowStep[];
  part: WorkflowStep;
  index: number;
  assignmentId: string;
  evidence: StepEvidence | undefined;
  work: StudentWork;
  resources: AssignmentDetail['resources'];
  stepTools: AssignmentDetail['stepTools'];
  workflow: WorkflowStep[];
  closed: boolean;
  saveState: CodeSaveState;
  saveError?: string;
  onPatchEvidence: (changes: Partial<StepEvidence>) => void;
  onPatchData: (changes: Record<string, unknown>) => void;
  onCodeEdited: () => void;
  beforeExecute: () => Promise<void>;
}) {
  const deliverable = primaryDeliverable(part);
  const payload = (evidence?.data ?? {}) as Record<string, unknown>;
  const inputs = availableDependencyResults(workflow, part, work.evidence);
  const status = partStatus(parts, part, work);
  const blockers = blockedBy(parts, part, work);

  /**
   * Una Parte bloqueada se explica; no se deshabilita y ya.
   *
   * Un formulario apagado sin decir por qué es lo mismo que una pantalla rota:
   * quien lo ve no sabe si es su culpa, si falta algo o si Nextudio falló.
   */
  if (status === 'locked') {
    return (
      <section
        ref={ref}
        tabIndex={-1}
        aria-labelledby="parte-activa"
        className="mt-6 outline-none"
      >
        <header className="border-b border-line pb-4">
          <p className="meta">
            Parte {index + 1} · {partActionLabel(part)}
          </p>
          <h2 id="parte-activa" className="mt-2 font-display text-h2">
            {part.title || partActionLabel(part)}
          </h2>
        </header>
        <div className="mt-5 rounded-sm border border-line-strong p-4">
          <p className="text-sm font-medium">Esta parte todavía no se puede hacer</p>
          <p className="mt-1 text-sm text-muted">
            Completa primero{' '}
            {blockers.map((blocker, position) => (
              <span key={blocker.id}>
                {position > 0 && ', '}«{blocker.title || partActionLabel(blocker)}»
              </span>
            ))}
            . En cuanto {blockers.length === 1 ? 'esté hecha' : 'estén hechas'}, esta parte se abre
            sola.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="parte-activa" className="mt-6 outline-none">
      <header className="border-b border-line pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="meta">
            Parte {index + 1} · {partActionLabel(part)}
            {!part.required && ' · opcional'}
          </p>
          <PartStatusChip status={status} />
        </div>
        <h2 id="parte-activa" className="mt-2 font-display text-h2">
          {part.title || partActionLabel(part)}
        </h2>
        {part.instructions && (
          <p className="prose-block mt-3 max-w-prose whitespace-pre-line text-muted">
            {part.instructions}
          </p>
        )}
      </header>

      {inputs.length > 0 && (
        <section
          className="mt-5 rounded-sm border border-line bg-sunken p-4"
          aria-labelledby="resultados-previos"
        >
          <h3 id="resultados-previos" className="font-display text-h3">
            De partes anteriores
          </h3>
          <p className="hint">Lo que ya hiciste y puedes reutilizar aquí. Tú decides qué copias.</p>
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

      <PartResources part={part} resources={resources} />

      <StepPromptCard step={part} resources={resources} />

      <ToolField
        step={part}
        evidence={evidence}
        stepTools={stepTools}
        onChange={onPatchEvidence}
      />

      <div className="mt-6">
        {deliverable.type === 'none' ? (
          <ReviewedCheckbox
            note={evidence?.note ?? ''}
            readOnly={closed}
            onChange={(note) => onPatchEvidence({ note })}
          />
        ) : (
          /*
            La cabecera de la Parte ya dice qué pide. Aquí sólo se añade lo que
            ella no puede decir —el lenguaje, o la indicación que escribió la
            docente—, y si no hay nada de eso no se pone una línea por ponerla.
          */
          (deliverable.type === 'code' || deliverable.hint) && (
            <p className="meta mb-3">
              {deliverable.type === 'code' &&
                `En ${programmingLanguageLabel(deliverable.language ?? LEGACY_CODE_LANGUAGE)}`}
              {deliverable.type === 'code' && deliverable.hint && ' · '}
              {deliverable.hint}
            </p>
          )
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
            // La política de conclusión la pone la docente en la Parte. Aquí
            // sólo se dice; quien la hace cumplir es el servidor al entregar.
            conclusionMode={deliverable.conclusionMode ?? 'optional'}
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
            stepId={part.id}
          />
        )}

        {deliverable.type === 'code' && (
          <CodeFields
            data={payload as unknown as CodeData}
            onChange={onPatchData}
            // El lenguaje lo dicta la Parte. Si no lo trae —un registro
            // antiguo— se cae al valor por defecto en vez de dejar el
            // formulario sin saber qué pedir.
            language={deliverable.language ?? LEGACY_CODE_LANGUAGE}
            codeMode={deliverable.codeMode}
            starterCode={deliverable.starterCode ?? ''}
            executionEnabled={deliverable.executionEnabled ?? false}
            hint={deliverable.hint}
            assignmentId={assignmentId}
            stepId={part.id}
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
            stepId={part.id}
            readOnly={closed}
            partTitle={part.title || partActionLabel(part)}
            /*
              La evidencia de la Parte es una COPIA del documento, no su id. Es
              lo que hace que entregar congele el trabajo: seguir editando
              después cambia el NexBook, no la entrega. Ver
              `NexBookSubmissionData`.
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

      {deliverable.type !== 'none' && (
        <div className="mt-6">
          <Field label="Nota sobre esta parte" hint="Opcional. La lee tu docente junto a tu entrega.">
            <textarea
              rows={2}
              readOnly={closed}
              value={evidence?.note ?? ''}
              onChange={(event) => onPatchEvidence({ note: event.target.value })}
              className="field"
            />
          </Field>
        </div>
      )}

      {partIsComplete(part, work) && (
        <p className="mt-3 text-sm text-success" role="status">
          ✓ Esta parte está completa.
        </p>
      )}
    </section>
  );
}

/**
 * «Marcar como revisada», para una Parte que no pide entrega.
 *
 * Sin esto, una Parte obligatoria sin entregable se quedaría «Sin empezar» para
 * siempre y bloquearía la actividad entera. No se fabrica ninguna entrega: se
 * escribe en `note`, el campo que ya existía para lo que quiera decir quien la
 * hace, y que la entrega ya cuenta como contenido.
 *
 * Si hay una nota escrita a mano, la casilla no la toca: desmarcarla borraría
 * algo que costó escribir.
 */
function ReviewedCheckbox({
  note,
  readOnly,
  onChange,
}: {
  note: string;
  readOnly: boolean;
  onChange: (note: string) => void;
}) {
  const written = note.trim() !== '' && !isReviewedNote(note);

  return (
    <div className="rounded-sm border border-line-strong p-4">
      <p className="text-sm text-muted">
        Esta parte no pide ninguna entrega: es algo que leer o hacer antes de seguir.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          disabled={readOnly || written}
          checked={note.trim() !== ''}
          onChange={(event) => onChange(event.target.checked ? REVIEWED_NOTE : '')}
        />
        <span className="text-sm">Ya la hice</span>
      </label>
      {written && (
        <p className="hint">Escribiste una nota más abajo, así que esta parte ya cuenta como hecha.</p>
      )}
      <div className="mt-4">
        <Field label="Nota sobre esta parte" hint="Opcional.">
          <textarea
            rows={2}
            readOnly={readOnly}
            value={isReviewedNote(note) ? '' : note}
            onChange={(event) => onChange(event.target.value)}
            className="field"
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Los materiales que la docente puso EN ESTA PARTE.
 *
 * Van aquí y no arriba del todo con los de la actividad: tener que subir a
 * buscar qué archivo correspondía a la parte que se está haciendo es
 * exactamente el momento en que se pierde el hilo. Son para consultar; lo que
 * hay que entregar está más abajo, con su propio título.
 */
function PartResources({
  part,
  resources,
}: {
  part: WorkflowStep;
  resources: AssignmentDetail['resources'];
}) {
  const prompts = part.resources.flatMap((ref) =>
    ref.kind === 'prompt' ? resources.prompts.filter((item) => item.id === ref.id) : []
  );
  const skills = part.resources.flatMap((ref) =>
    ref.kind === 'skill' ? resources.skills.filter((item) => item.id === ref.id) : []
  );

  if (prompts.length === 0 && skills.length === 0) return null;

  return (
    <section className="mt-5" aria-labelledby="material-de-la-parte">
      <h3 id="material-de-la-parte" className="font-display text-h3">
        Material para esta parte
      </h3>
      <p className="hint">Para consultar mientras la haces.</p>
      <ul className="mt-3 space-y-2">
        {prompts.map((prompt) => (
          <li key={`prompt-${prompt.id}`} className="panel p-3">
            <p className="meta">Prompt</p>
            <p className="mt-1 text-sm font-medium">{prompt.title}</p>
            <pre className="mt-2 max-h-40 overflow-y-auto rounded-sm border border-line bg-sunken p-3 font-mono text-sm whitespace-pre-wrap">
              {prompt.prompt}
            </pre>
            <div className="mt-2">
              <CopyButton value={prompt.prompt} label="Copiar prompt" variant="ghost" />
            </div>
          </li>
        ))}
        {skills.map((skill) => (
          <li key={`skill-${skill.id}`} className="panel flex flex-wrap items-center gap-3 p-3">
            <span className="min-w-0 flex-1">
              <span className="meta block">Skill</span>
              <span className="mt-1 block text-sm font-medium">{skill.title}</span>
            </span>
            {skill.repositoryUrl && (
              <a
                href={skill.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                Repositorio ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Qué herramienta se usó (§24, §47).
 *
 * Con `required` sólo hay una y se rellena sola. Con `choice` se elige entre
 * las que propuso la docente. Con `free` se escribe: es trazabilidad académica,
 * no vigilancia —Nextudio no comprueba, ni puede comprobar, que alguien abriera
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
   * Las fichas del catálogo que siguen existiendo. El NOMBRE se lee de la
   * Parte, no de aquí: si la docente borró la herramienta de la biblioteca, la
   * Parte sigue diciendo «usa Perplexity» y sólo se pierde el enlace.
   */
  const cards = step.tool.toolIds.flatMap((id) => (stepTools[id] ? [stepTools[id]] : []));

  if (mode === 'required') {
    return (
      <div className="mt-5 space-y-3">
        <Notice>
          Herramienta sugerida: <strong>{toolNames[0] ?? 'la que indique tu docente'}</strong>.
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
            ? 'Puedes elegir entre las que propuso tu docente.'
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
 * El prompt de apoyo de la Parte, listo para copiar.
 *
 * Da igual de dónde venga: escrito dentro de la actividad o elegido de la
 * biblioteca, aquí se ve igual. El alumnado no tiene por qué saber cuál de las
 * dos cosas hizo su docente.
 *
 * Es apoyo y se dice que lo es: no obliga a usarlo, y Nextudio no ejecuta
 * ninguna IA con él.
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
    <section className="mt-5 rounded-sm border border-line bg-sunken p-4" aria-labelledby="prompt-parte">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="prompt-parte" className="font-display text-h3">
          Prompt de apoyo{title ? `: ${title}` : ''}
        </h3>
        {text && <CopyButton value={text} label="Copiar prompt" variant="ghost" />}
      </div>

      {text ? (
        <>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm">{text}</pre>
          <p className="hint">
            Puedes usarlo tal cual o adaptarlo. Nextudio no ejecuta la IA por ti.
          </p>
        </>
      ) : (
        <p className="hint mt-2">
          El prompt de esta parte ya no está disponible. Pregúntale a tu docente.
        </p>
      )}
    </section>
  );
}
