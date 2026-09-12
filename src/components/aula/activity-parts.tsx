'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_ACTIONS,
  CONCLUSION_MODES,
  actionById,
  actionForPart,
  dependentsOf,
  makePart,
  movePart,
  partActionLabel,
  partDeliverable,
  removePart,
  retypeDeliverable,
  titleForNewPart,
  type ActivityActionId,
} from '@/lib/activity-builder';
import {
  DEFAULT_CODE_MODE,
  DEFAULT_PROGRAMMING_LANGUAGE,
  ENABLED_PROGRAMMING_LANGUAGES,
  languageCapabilities,
  languageExecutionNote,
  programmingLanguageLabel,
  WORKFLOW_LIMITS,
} from '@/lib/constants';
import { useApi, type CourseLibrary, type RosterRow } from '@/lib/aula-client';
import type {
  CodeMode,
  NexBookConclusionMode,
  ResearchQuestion,
  ResourceRef,
  StepToolChoice,
  WorkflowStep,
} from '@/lib/types';
import { Field, Notice } from './aula-ui';
import { CodeEditor } from './code-editor';
import { ResourcePicker } from './resource-picker';
import { StepPromptField } from './step-prompt-field';

/**
 * «Qué hará el estudiante»: las Partes de una actividad.
 *
 * ## Qué cambió respecto al constructor anterior
 *
 * Antes, lo primero que se preguntaba era «¿un paso o varios?», y después había
 * que elegir un `actionType` y un `deliverableType` de dos listas planas con los
 * nombres del modelo. Eso obliga a saber cómo está hecho Nextudio por dentro
 * para poder pedir una tarea.
 *
 * Ahora se pregunta lo único que la docente sí sabe de antemano: qué debe hacer
 * el estudiante. La traducción a `WorkflowStep` la hace `lib/activity-builder`,
 * que es código puro y probado. La forma de la actividad —una parte o varias, y
 * cómo se guarda— se DERIVA; no se pregunta.
 *
 * ## Revelado progresivo
 *
 * Una parte cerrada enseña su nombre y qué pide. Abierta, enseña lo que su
 * intención necesita y nada más: un NexLab no pregunta por el lenguaje, y una
 * respuesta escrita no enseña la modalidad de entrega del código. Lo que el 80%
 * de las actividades no usa —responsables, dependencias— vive en «Opciones
 * avanzadas» y no se abre solo.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10);

const CODE_MODE_OPTIONS: readonly (readonly [CodeMode, string, string])[] = [
  ['editor', 'Escribe aquí', 'Programa dentro de Nextudio.'],
  ['upload', 'Sube el archivo', 'Programa donde quiera y entrega el fuente.'],
  ['either', 'Como prefiera', 'Puede escribir aquí, adjuntar el archivo o ambas cosas.'],
];

const TOOL_CHOICES: readonly (readonly [StepToolChoice['mode'], string, string])[] = [
  ['none', 'No hace falta una herramienta específica', 'Es el caso normal.'],
  ['required', 'Usar una herramienta concreta', 'Tú dices cuál y no hay alternativa.'],
  ['choice', 'Elegir entre varias', 'Tú propones un conjunto y el estudiante escoge.'],
  [
    'free',
    'El estudiante puede elegir otra',
    'Usa la que quiera y escribe cuál usó. Queda en la evidencia.',
  ],
];

export function ActivityParts({
  courseId,
  parts,
  students,
  activity,
  assignmentId,
  onChange,
  onPrepareLab,
}: {
  courseId: string;
  parts: WorkflowStep[];
  students: RosterRow[];
  /** Título y objetivo: el generador de prompts los reutiliza. */
  activity: { title: string; description: string };
  /** `undefined` mientras la actividad no se ha guardado ni una vez. */
  assignmentId?: string;
  onChange: (parts: WorkflowStep[]) => void;
  /** Abre la plantilla del laboratorio de esta parte. */
  onPrepareLab: (part: WorkflowStep) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(parts[0]?.id ?? null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; by: string[] } | null>(null);
  /**
   * El catálogo se muestra SIEMPRE que no hay ninguna parte —no hay nada que
   * enseñar en su lugar— y además cuando alguien pulsa «+ Añadir parte».
   *
   * Se deriva en vez de guardarse porque las partes llegan DESPUÉS del primer
   * render al editar una actividad que ya existe: un estado inicializado con
   * `parts.length === 0` se quedaba abierto encima de una actividad que ya tenía
   * su parte.
   */
  const [pickerRequested, setPickerRequested] = useState(false);
  const picking = parts.length === 0 || pickerRequested;

  /**
   * El foco sigue a la parte que se acaba de crear o de abrir.
   *
   * Sin esto, añadir una parte deja el foco en el botón «+ Añadir parte» y hay
   * que tabular por toda la actividad para llegar a lo que se acaba de crear.
   */
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRef.current) return;
    const node = document.getElementById(`part-${focusRef.current}-title`);
    (node as HTMLElement | null)?.focus();
    focusRef.current = null;
  });

  const patchPart = (id: string, changes: Partial<WorkflowStep>): void =>
    onChange(parts.map((part) => (part.id === id ? { ...part, ...changes } : part)));

  function add(action: ActivityActionId, variant?: string): void {
    const part = makePart({ action, variant, id: uid(), order: parts.length });
    // La parte nueva NO depende de la anterior por defecto. Encadenarlas en
    // silencio convertía cualquier actividad de tres partes en un proceso
    // bloqueado, y quitarlo obligaba a entrar en avanzadas para deshacer algo
    // que nadie había pedido.
    //
    // Los títulos aparecen al pasar de una parte a dos: ver `titleForNewPart`.
    onChange(titleForNewPart(parts, part).parts);
    setOpenId(part.id);
    setPickerRequested(false);
    focusRef.current = part.id;
  }

  function requestRemove(id: string): void {
    const dependents = dependentsOf(parts, id);
    if (dependents.length > 0) {
      setBlocked({ id, by: dependents.map((part) => part.title || 'una parte sin título') });
      return;
    }
    setPendingRemoval(id);
  }

  function confirmRemove(id: string, releaseDependents: boolean): void {
    const result = removePart(parts, id, { releaseDependents });
    if (result.blockedBy.length === 0) {
      onChange(result.parts);
      setPendingRemoval(null);
      setBlocked(null);
      if (openId === id) setOpenId(null);
    }
  }

  return (
    <section aria-labelledby="partes">
      <h2 id="partes" className="section-mark font-display text-h3">
        Qué hará el estudiante
      </h2>
      <p className="mt-1 text-sm text-muted">
        Una actividad puede tener una parte o varias. Cada parte dice qué hay que hacer y qué se
        entrega.
      </p>

      <ol className="mt-4 space-y-3">
        {parts.map((part, index) => {
          const open = openId === part.id;
          return (
            <li key={part.id} className="panel p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                  {index + 1}
                </span>

                <div className="min-w-40 flex-1">
                  <p className="font-medium">
                    {part.title.trim() || (parts.length === 1 ? activity.title || 'Parte 1' : `Parte ${index + 1}`)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-label text-subtle">
                    <span>{partActionLabel(part)}</span>
                    {part.tool.mode !== 'none' && <span>· Herramienta</span>}
                    {!part.required && <span>· Opcional</span>}
                    {part.assignedTo && part.assignedTo.length > 0 && (
                      <span>· {part.assignedTo.length} responsables</span>
                    )}
                    {part.dependsOnStepIds.length > 0 && <span>· Se desbloquea después</span>}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onChange(movePart(parts, index, -1))}
                    disabled={index === 0}
                    aria-label={`Mover arriba la parte ${index + 1}`}
                    className="btn btn-ghost btn-sm"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(movePart(parts, index, 1))}
                    disabled={index === parts.length - 1}
                    aria-label={`Mover abajo la parte ${index + 1}`}
                    className="btn btn-ghost btn-sm"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : part.id)}
                    aria-expanded={open}
                    aria-label={`${open ? 'Cerrar' : 'Editar'} la parte ${index + 1}`}
                    className="btn btn-secondary btn-sm"
                  >
                    {open ? 'Cerrar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestRemove(part.id)}
                    aria-label={`Quitar la parte ${index + 1}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Quitar
                  </button>
                </div>
              </div>

              {pendingRemoval === part.id && (
                <div className="mt-3 rounded-sm border border-line bg-sunken p-3">
                  <p className="text-sm">
                    ¿Quitar esta parte? Se pierde lo que hayas configurado en ella.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmRemove(part.id, false)}
                      className="btn btn-secondary btn-sm"
                    >
                      Sí, quitarla
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemoval(null)}
                      className="btn btn-ghost btn-sm"
                    >
                      Conservarla
                    </button>
                  </div>
                </div>
              )}

              {blocked?.id === part.id && (
                <div className="mt-3">
                  <Notice tone="error">
                    No se puede quitar todavía: {blocked.by.join(', ')} se desbloquea
                    {blocked.by.length === 1 ? '' : 'n'} después de esta parte. Puedes quitarla de
                    todos modos y esa dependencia se eliminará, o cambiarla antes en Opciones
                    avanzadas.
                  </Notice>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmRemove(part.id, true)}
                      className="btn btn-secondary btn-sm"
                    >
                      Quitarla y liberar las que dependían
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlocked(null)}
                      className="btn btn-ghost btn-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {open && (
                <PartEditor
                  courseId={courseId}
                  assignmentId={assignmentId}
                  activity={activity}
                  part={part}
                  index={index}
                  total={parts.length}
                  previousParts={parts.slice(0, index)}
                  students={students}
                  onChange={(changes) => patchPart(part.id, changes)}
                  onPrepareLab={() => onPrepareLab(part)}
                />
              )}
            </li>
          );
        })}
      </ol>

      {parts.length < WORKFLOW_LIMITS.maxSteps && (
        <div className="mt-4">
          {picking ? (
            <ActionPicker
              onPick={add}
              onCancel={parts.length > 0 ? () => setPickerRequested(false) : undefined}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPickerRequested(true)}
              className="btn btn-secondary"
            >
              + Añadir parte
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * El catálogo humano, como tarjetas.
 *
 * Las intenciones con varias formas —«Responder», «Entregar archivo o
 * evidencia»— no abren cuatro tarjetas: se elige primero la intención y después
 * la forma, que es el orden en el que se piensa.
 */
function ActionPicker({
  onPick,
  onCancel,
}: {
  onPick: (action: ActivityActionId, variant?: string) => void;
  onCancel?: () => void;
}) {
  const [expanded, setExpanded] = useState<ActivityActionId | null>(null);

  return (
    <fieldset className="panel p-4">
      <legend className="label">¿Qué debe hacer el estudiante?</legend>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {ACTIVITY_ACTIONS.map((action) => {
          const multiple = action.variants.length > 1;
          const open = expanded === action.id;
          return (
            <li key={action.id}>
              <button
                type="button"
                aria-expanded={multiple ? open : undefined}
                onClick={() => (multiple ? setExpanded(open ? null : action.id) : onPick(action.id))}
                className={`panel w-full p-3 text-left hover:border-accent ${open ? 'border-accent' : ''}`}
              >
                <span className="block font-medium">{action.label}</span>
                <span className="mt-1 block text-sm text-muted">{action.helper}</span>
              </button>

              {multiple && open && (
                <ul className="mt-2 space-y-1 pl-3">
                  {action.variants.map((variant) => (
                    <li key={variant.id}>
                      <button
                        type="button"
                        onClick={() => onPick(action.id, variant.id)}
                        className="btn btn-ghost btn-sm w-full justify-start text-left"
                      >
                        {variant.label}
                        {variant.helper && (
                          <span className="ml-2 text-subtle">— {variant.helper}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {onCancel && (
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm mt-3">
          Cancelar
        </button>
      )}
    </fieldset>
  );
}

function PartEditor({
  courseId,
  assignmentId,
  activity,
  part,
  index,
  total,
  previousParts,
  students,
  onChange,
  onPrepareLab,
}: {
  courseId: string;
  assignmentId?: string;
  activity: { title: string; description: string };
  part: WorkflowStep;
  index: number;
  total: number;
  previousParts: WorkflowStep[];
  students: RosterRow[];
  onChange: (changes: Partial<WorkflowStep>) => void;
  onPrepareLab: () => void;
}) {
  const [advanced, setAdvanced] = useState(
    part.dependsOnStepIds.length > 0 || Boolean(part.assignedTo?.length)
  );
  const deliverable = partDeliverable(part);
  const { action, variant } = actionForPart(part);
  const catalog = actionById(action);

  const patchDeliverable = (changes: Partial<typeof deliverable>): void =>
    onChange({ deliverables: [{ ...deliverable, ...changes }] });

  return (
    <div className="mt-5 space-y-5 border-t border-line pt-5">
      {/*
        Cambiar de intención se hace desde aquí y no obliga a borrar la parte:
        se conserva el título, las instrucciones, el prompt y los recursos, que
        es lo que cuesta escribir. Lo específico del tipo anterior se limpia,
        porque ya no describe nada (ver `retypeDeliverable`).
      */}
      <Field label="¿Qué debe hacer el estudiante?">
        <select
          value={action === 'legacy' ? '' : `${action}:${variant}`}
          onChange={(event) => {
            const [nextAction, nextVariant] = event.target.value.split(':');
            const chosen = actionById(nextAction as ActivityActionId);
            const picked =
              chosen?.variants.find((item) => item.id === nextVariant) ?? chosen?.variants[0];
            if (!chosen || !picked) return;
            onChange({
              actionType: chosen.actionType,
              deliverables: [retypeDeliverable(deliverable, picked.deliverable)],
            });
          }}
          className="field"
        >
          {ACTIVITY_ACTIONS.flatMap((option) =>
            option.variants.map((item) => (
              <option key={`${option.id}:${item.id}`} value={`${option.id}:${item.id}`}>
                {option.variants.length > 1 ? `${option.label} · ${item.label}` : option.label}
              </option>
            ))
          )}
          {/*
            Una parte guardada con algo que el catálogo ya no ofrece sigue
            apareciendo y sigue siendo suya. Elegir otra cosa la cambiaría; no
            elegir nada la deja exactamente como estaba.
          */}
          {action === 'legacy' && <option value="">{partActionLabel(part)} (versión anterior)</option>}
        </select>
      </Field>

      {action === 'legacy' && (
        <Notice>
          Esta parte usa un tipo de entrega de una versión anterior de Nextudio. Sigue funcionando
          y se conserva tal cual al guardar. Si eliges otra cosa arriba, la cambiarás.
        </Notice>
      )}

      <Field
        label="Título de la parte"
        hint={
          total === 1
            ? 'Opcional: con una sola parte, el título de la actividad ya sirve.'
            : 'Es lo que el estudiante ve en la lista.'
        }
      >
        <input
          id={`part-${part.id}-title`}
          value={part.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={total === 1 ? activity.title || 'Análisis de ventas' : `Parte ${index + 1}`}
          className="field"
        />
      </Field>

      <Field label="Instrucciones" hint="Lo concreto que hay que hacer en esta parte.">
        <textarea
          rows={3}
          value={part.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="Importa el archivo de ventas y calcula el promedio por trimestre."
          className="field"
        />
      </Field>

      {action === 'lab' && (
        <LabConfig assignmentId={assignmentId} onPrepare={onPrepareLab} />
      )}

      {action === 'code' && (
        <CodeConfig deliverable={deliverable} onChange={patchDeliverable} />
      )}

      {action === 'ai' && (
        <AiConfig
          value={deliverable.conclusionMode ?? 'optional'}
          onChange={(conclusionMode) => patchDeliverable({ conclusionMode })}
        />
      )}

      {deliverable.type === 'structured' && (
        <PartQuestions
          questions={deliverable.questions}
          onChange={(questions) => patchDeliverable({ questions })}
        />
      )}

      {deliverable.type !== 'none' && (
        <Field label="Pista sobre la entrega" hint="Opcional.">
          <input
            value={deliverable.hint}
            onChange={(event) => patchDeliverable({ hint: event.target.value })}
            placeholder="Pega los cinco enlaces, uno por línea."
            className="field"
          />
        </Field>
      )}

      <ToolChoiceField tool={part.tool} courseId={courseId} onChange={(tool) => onChange({ tool })} />

      <StepPromptField
        courseId={courseId}
        prompt={part.prompt}
        context={{
          assignmentTitle: activity.title,
          assignmentDescription: activity.description,
          stepTitle: part.title,
          stepInstructions: part.instructions,
          toolNames: part.tool.toolNames,
          deliverableLabel: partActionLabel(part),
        }}
        onChange={(prompt) => onChange({ prompt })}
      />

      <ResourcePicker
        courseId={courseId}
        value={part.resources}
        onChange={(resources: ResourceRef[]) => onChange({ resources })}
        label="Recursos de esta parte"
        hint="La guía o la Skill que hacen falta aquí. Los materiales de toda la actividad van más abajo."
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!part.required}
          onChange={(event) => onChange({ required: !event.target.checked })}
        />
        <span className="text-sm">
          Esta parte es opcional{' '}
          <span className="text-subtle">— no impide entregar si no se hace.</span>
        </span>
      </label>

      {!advanced ? (
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          className="btn btn-ghost btn-sm"
          aria-expanded={false}
        >
          Opciones avanzadas
        </button>
      ) : (
        <div className="space-y-4 border-t border-line pt-4">
          <fieldset>
            <legend className="label">¿Quién realiza esta parte?</legend>
            <p className="hint">Sin nadie marcado, la hace quien tenga la actividad. Es lo normal.</p>
            {students.length === 0 ? (
              <p className="hint">Todavía no hay nadie inscrito en la materia.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {students.map((student) => {
                  const active = part.assignedTo?.includes(student.handle) ?? false;
                  return (
                    <button
                      key={student.handle}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const current = part.assignedTo ?? [];
                        const next = active
                          ? current.filter((handle) => handle !== student.handle)
                          : [...current, student.handle];
                        onChange({ assignedTo: next.length > 0 ? next : null });
                      }}
                      className="chip"
                    >
                      {student.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          {previousParts.length > 0 && (
            <fieldset>
              <legend className="label">Esta parte se desbloquea después de…</legend>
              <p className="hint">
                Sin nada marcado se puede hacer desde el principio. Es lo normal.
              </p>
              <div className="mt-2 space-y-1">
                {previousParts.map((previous, position) => (
                  <label key={previous.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={part.dependsOnStepIds.includes(previous.id)}
                      onChange={(event) =>
                        onChange({
                          dependsOnStepIds: event.target.checked
                            ? [...part.dependsOnStepIds, previous.id]
                            : part.dependsOnStepIds.filter((id) => id !== previous.id),
                        })
                      }
                    />
                    <span>
                      {position + 1}. {previous.title || `Parte ${position + 1}`}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <p className="text-label text-subtle">
        {catalog ? `Parte ${index + 1} · ${catalog.label}` : `Parte ${index + 1}`}
      </p>
    </div>
  );
}

/**
 * El laboratorio de la parte.
 *
 * La plantilla cuelga de la actividad y de la parte, así que no existe hasta que
 * la actividad existe. En vez de esconder el botón se dice la verdad y se ofrece
 * el atajo honesto: guardar el borrador —que no publica ni avisa a nadie— y
 * seguir aquí mismo. Es el mismo trato que ya tenían los archivos adjuntos.
 */
function LabConfig({
  assignmentId,
  onPrepare,
}: {
  assignmentId?: string;
  onPrepare: () => void;
}) {
  return (
    <div className="rounded-sm border border-line bg-sunken p-4">
      <p className="text-sm font-medium">Configuración de NexLab</p>
      <p className="mt-1 text-sm text-muted">
        Prepara el documento con el que arranca el estudiante: instrucciones, hojas de datos,
        código para completar, registro de uso de IA, conclusiones. Puedes importar un CSV o un
        Excel desde dentro.
      </p>
      <button type="button" onClick={onPrepare} className="btn btn-secondary btn-sm mt-3">
        Preparar NexLab
      </button>
      {!assignmentId && (
        <p className="hint">
          Se guardará antes un borrador de la actividad: hace falta para que la plantilla tenga
          dónde vivir. No se publica ni se avisa a nadie.
        </p>
      )}
    </div>
  );
}

/** Lo que necesita una parte de programación, y nada más. */
function CodeConfig({
  deliverable,
  onChange,
}: {
  deliverable: ReturnType<typeof partDeliverable>;
  onChange: (changes: Partial<ReturnType<typeof partDeliverable>>) => void;
}) {
  const language = deliverable.language ?? DEFAULT_PROGRAMMING_LANGUAGE;
  const capabilities = languageCapabilities(language);

  return (
    <div className="space-y-5 rounded-sm border border-line bg-sunken p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lenguaje" hint="El estudiante no puede cambiarlo.">
          <select
            value={language}
            onChange={(event) => onChange({ language: event.target.value })}
            className="field"
          >
            {ENABLED_PROGRAMMING_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {/* Un lenguaje guardado que ya no se ofrece sigue apareciendo: el
                modelo lo admite aunque el catálogo de hoy no lo liste. */}
            {!ENABLED_PROGRAMMING_LANGUAGES.some((option) => option.value === language) && (
              <option value={language}>{programmingLanguageLabel(language)}</option>
            )}
          </select>
        </Field>

        <Field label="Cómo lo entrega">
          <select
            value={deliverable.codeMode ?? DEFAULT_CODE_MODE}
            onChange={(event) => onChange({ codeMode: event.target.value as CodeMode })}
            className="field"
          >
            {CODE_MODE_OPTIONS.map(([value, label, helper]) => (
              <option key={value} value={value}>
                {label} — {helper}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/*
        El interruptor no desaparece cuando el lenguaje no se ejecuta: cambiar de
        Python a Java borraría en silencio una decisión ya tomada. Lo que cambia
        es que se dice la verdad sobre lo que hará. La capacidad se lee del
        catálogo real (`languageCapabilities`), no de una lista escrita a mano.
      */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={deliverable.executionEnabled ?? false}
          onChange={(event) => onChange({ executionEnabled: event.target.checked })}
          className="mt-1"
          disabled={!capabilities.execution}
        />
        <span>
          <span className="block text-sm font-medium">Puede ejecutar su programa</span>
          <span className="hint">
            {capabilities.browserExecution
              ? 'Añade un botón para ejecutarlo dentro del navegador, sin salida a internet y sin instalar paquetes. Tú podrás ejecutarlo al revisar en cualquier caso.'
              : `${languageExecutionNote(language) ?? ''} El estudiante verá «Ejecución no disponible» y podrá escribir y entregar con normalidad.`}
          </span>
        </span>
      </label>

      {(deliverable.codeMode ?? DEFAULT_CODE_MODE) !== 'upload' && (
        <div>
          <p className="label">Con qué código empieza (opcional)</p>
          <CodeEditor
            language={language}
            value={deliverable.starterCode ?? ''}
            onChange={(starterCode) => onChange({ starterCode })}
            height={220}
            ariaLabel="Código inicial de la parte"
          />
          <p className="hint">
            Lo que el estudiante encuentra al abrir la parte por primera vez. Cambiarlo después NO
            pisa el trabajo de quien ya empezó.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * El registro de uso de IA como entregable de la parte.
 *
 * Nextudio no ejecuta ninguna IA aquí, y la interfaz no lo insinúa: no hay
 * «enviar prompt» ni «generar». Lo que se configura es qué se le pide al
 * estudiante que deje por escrito.
 */
function AiConfig({
  value,
  onChange,
}: {
  value: NexBookConclusionMode;
  onChange: (mode: NexBookConclusionMode) => void;
}) {
  return (
    <fieldset className="rounded-sm border border-line bg-sunken p-4">
      <legend className="label">Conclusión del estudiante</legend>
      <p className="hint">
        Además del registro —objetivo, herramienta, prompt y resultado—, qué escribió y qué decidió
        con ello.
      </p>
      <div className="mt-3 space-y-2">
        {CONCLUSION_MODES.map((option) => (
          <label key={option.value} className="flex items-start gap-2">
            <input
              type="radio"
              name="conclusion-mode"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-sm text-muted">{option.helper}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="hint">
        Si prefieres que el registro viva dentro de un laboratorio completo, elige «Trabajar en
        laboratorio» y añade allí un bloque de registro de uso de IA.
      </p>
    </fieldset>
  );
}

/**
 * Herramientas permitidas.
 *
 * Las capacidades del modelo son las de siempre —ninguna, obligatoria, elección,
 * libre—; lo que cambia es que se dicen en la frase que describe la decisión en
 * vez de con el nombre interno del modo.
 *
 * Las herramientas se escriben por NOMBRE: no hay que darlas de alta en ningún
 * catálogo antes de poder pedirlas.
 */
function ToolChoiceField({
  courseId,
  tool,
  onChange,
}: {
  courseId: string;
  tool: StepToolChoice;
  onChange: (tool: StepToolChoice) => void;
}) {
  const [draft, setDraft] = useState('');
  const library = useApi<CourseLibrary>(`/api/courses/${courseId}/library`);

  const catalog = (library.data?.resources ?? []).filter(
    (resource) => resource.type === 'tool' && resource.status === 'approved'
  );

  function addName(): void {
    const name = draft.trim();
    if (!name || tool.toolNames.includes(name)) return;
    const known = catalog.find((resource) => resource.title.toLowerCase() === name.toLowerCase());
    onChange({
      ...tool,
      toolNames: [...tool.toolNames, known?.title ?? name],
      toolIds: known ? [...tool.toolIds, known.id] : tool.toolIds,
    });
    setDraft('');
  }

  function removeName(name: string): void {
    const known = catalog.find((resource) => resource.title === name);
    onChange({
      ...tool,
      toolNames: tool.toolNames.filter((item) => item !== name),
      toolIds: known ? tool.toolIds.filter((id) => id !== known.id) : tool.toolIds,
    });
  }

  return (
    <fieldset>
      <legend className="label">Herramientas permitidas</legend>

      <div className="mt-2 space-y-2">
        {TOOL_CHOICES.map(([mode, label, helper]) => (
          <label key={mode} className="flex items-start gap-2">
            <input
              type="radio"
              name={`tool-mode-${courseId}`}
              checked={tool.mode === mode}
              onChange={() => onChange({ ...tool, mode })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-sm text-muted">{helper}</span>
            </span>
          </label>
        ))}
      </div>

      {(tool.mode === 'required' || tool.mode === 'choice') && (
        <div className="mt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className="sr-only">Nombre de la herramienta</span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addName();
                  }
                }}
                placeholder="Perplexity, NotebookLM, Miro…"
                className="field"
              />
            </label>
            <button type="button" onClick={addName} className="btn btn-secondary btn-sm">
              Añadir
            </button>
          </div>

          {catalog.length > 0 && (
            <div className="mt-3">
              <p className="text-label text-subtle">De la biblioteca de la materia</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {catalog
                  .filter((resource) => !tool.toolNames.includes(resource.title))
                  .map((resource) => (
                    <button
                      key={resource.id}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...tool,
                          toolIds: [...tool.toolIds, resource.id],
                          toolNames: [...tool.toolNames, resource.title],
                        })
                      }
                      className="chip"
                    >
                      + {resource.title}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {tool.toolNames.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {tool.toolNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => removeName(name)}
                    className="tag"
                    aria-label={`Quitar ${name}`}
                  >
                    {name} ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Los campos de una respuesta estructurada. */
function PartQuestions({
  questions,
  onChange,
}: {
  questions: ResearchQuestion[];
  onChange: (questions: ResearchQuestion[]) => void;
}) {
  const [concept, setConcept] = useState('');

  /** Un concepto se convierte en sus tres campos habituales. */
  function addConcept(): void {
    const name = concept.trim();
    if (!name) return;
    const groupId = uid();
    onChange([
      ...questions,
      { id: uid(), group: name, groupId, prompt: 'Definición', type: 'long_text', required: true },
      { id: uid(), group: name, groupId, prompt: 'Fuente', type: 'url', required: false },
      { id: uid(), group: name, groupId, prompt: 'Comentario', type: 'long_text', required: false },
    ]);
    setConcept('');
  }

  return (
    <fieldset>
      <legend className="label">Campos que va a rellenar</legend>
      <p className="hint">
        Escribe un concepto y se crean sus tres campos: definición, fuente y comentario. También
        puedes añadir campos sueltos.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="sr-only">Concepto</span>
          <input
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addConcept();
              }
            }}
            placeholder="Card sorting"
            className="field"
          />
        </label>
        <button type="button" onClick={addConcept} className="btn btn-secondary btn-sm">
          Añadir concepto
        </button>
        <button
          type="button"
          onClick={() => {
            const id = uid();
            onChange([
              ...questions,
              { id, group: null, groupId: id, prompt: '', type: 'long_text', required: false },
            ]);
          }}
          className="btn btn-ghost btn-sm"
        >
          Añadir campo suelto
        </button>
      </div>

      {questions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {questions.map((question, index) => (
            <li key={question.id} className="flex flex-wrap items-end gap-2">
              <label className="min-w-32 flex-1">
                <span className="sr-only">Concepto del campo {index + 1}</span>
                <input
                  value={question.group ?? ''}
                  onChange={(event) =>
                    onChange(
                      questions.map((item) =>
                        item.id === question.id
                          ? { ...item, group: event.target.value || null }
                          : item
                      )
                    )
                  }
                  placeholder="(sin agrupar)"
                  className="field"
                />
              </label>
              <label className="min-w-40 flex-1">
                <span className="sr-only">Campo {index + 1}</span>
                <input
                  value={question.prompt}
                  onChange={(event) =>
                    onChange(
                      questions.map((item) =>
                        item.id === question.id ? { ...item, prompt: event.target.value } : item
                      )
                    )
                  }
                  placeholder="Definición"
                  className="field"
                />
              </label>
              <label>
                <span className="sr-only">Tipo del campo {index + 1}</span>
                <select
                  value={question.type}
                  onChange={(event) =>
                    onChange(
                      questions.map((item) =>
                        item.id === question.id
                          ? { ...item, type: event.target.value as ResearchQuestion['type'] }
                          : item
                      )
                    )
                  }
                  className="field w-36"
                >
                  <option value="long_text">Texto largo</option>
                  <option value="short_text">Texto corto</option>
                  <option value="url">Enlace</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => onChange(questions.filter((item) => item.id !== question.id))}
                className="btn btn-ghost btn-sm"
                aria-label={`Quitar el campo ${index + 1}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
