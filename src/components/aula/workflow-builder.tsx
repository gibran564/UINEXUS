'use client';

import { useState } from 'react';
import {
  DELIVERABLE_LABEL,
  STEP_ACTIONS,
  TOOL_MODE_LABEL,
  WORKFLOW_LIMITS,
} from '@/lib/constants';
import type {
  DeliverableType,
  ResearchQuestion,
  ResourceRef,
  StepActionType,
  ToolChoiceMode,
  WorkflowStep,
} from '@/lib/types';
import { useApi, type CourseLibrary, type RosterRow } from '@/lib/aula-client';
import { Field, Notice } from './aula-ui';
import { ResourcePicker } from './resource-picker';
import { StepPromptField } from './step-prompt-field';

/**
 * El constructor de pasos (§35, §36).
 *
 * Dos ideas gobiernan esta pantalla:
 *
 *  · **Los atajos son de interfaz, no del modelo.** «+ Usar IA» rellena un paso
 *    con valores razonables —entregable AI Worklog, herramienta a elegir— y a
 *    partir de ahí todo es editable. Añadir un atajo mañana es comodidad, no un
 *    requisito para poder modelar algo: `actionType` es una cadena libre.
 *  · **Lo que no se usa no se pinta.** Los responsables y las dependencias sólo
 *    aparecen si se piden. §51 y §20 son explícitos: crear una tarea sencilla
 *    tiene que seguir costando segundos, y el workflow debe aparecer cuando la
 *    docente lo necesita, no antes.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10);

const DELIVERABLE_OPTIONS: DeliverableType[] = [
  'none',
  'text',
  'url',
  'file',
  'image',
  'video',
  'ai_worklog',
  'structured',
  'project',
  'resource_reference',
];

export function makeStep(preset: (typeof STEP_ACTIONS)[number]): WorkflowStep {
  return {
    id: uid(),
    order: 0,
    title: preset.label,
    description: '',
    instructions: '',
    actionType: preset.value,
    tool: { mode: preset.toolMode, toolIds: [], toolNames: [] },
    resources: [],
    // Sin prompt hasta que se escriba uno. «Escribir aquí» es lo que ofrece la
    // interfaz por defecto, pero un paso vacío no declara un prompt vacío.
    prompt: { mode: 'none', title: '', text: '', resourceId: null },
    deliverables: [{ type: preset.deliverable, required: true, hint: '', questions: [] }],
    required: true,
    assignedTo: null,
    dependsOnStepIds: [],
  };
}

export function WorkflowBuilder({
  courseId,
  steps,
  students,
  assignment,
  onChange,
}: {
  courseId: string;
  steps: WorkflowStep[];
  students: RosterRow[];
  /** Título y objetivo de la actividad: el generador de prompts los reutiliza. */
  assignment: { title: string; description: string };
  onChange: (steps: WorkflowStep[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(steps[0]?.id ?? null);

  const patchStep = (id: string, changes: Partial<WorkflowStep>) =>
    onChange(steps.map((step) => (step.id === id ? { ...step, ...changes } : step)));

  function add(preset: (typeof STEP_ACTIONS)[number]): void {
    const step = makeStep(preset);
    /**
     * El paso nuevo depende del anterior por defecto. Es lo que espera quien
     * escribe «Perplexity → NotebookLM → Miro», y se puede quitar: §22 pide
     * dependencias, no una cadena rígida.
     */
    const previous = steps[steps.length - 1];
    onChange([
      ...steps,
      { ...step, order: steps.length, dependsOnStepIds: previous ? [previous.id] : [] },
    ]);
    setOpenId(step.id);
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next.map((step, position) => ({ ...step, order: position })));
  }

  function remove(id: string): void {
    onChange(
      steps
        .filter((step) => step.id !== id)
        // Una dependencia hacia un paso borrado dejaría el siguiente bloqueado
        // para siempre sin que se vea por qué. Se limpia al borrar.
        .map((step, position) => ({
          ...step,
          order: position,
          dependsOnStepIds: step.dependsOnStepIds.filter((dep) => dep !== id),
        }))
    );
  }

  return (
    <div>
      {steps.length === 0 && (
        <Notice>
          Añade el primer paso. Un paso puede ser una instrucción, usar una herramienta, pedir una
          respuesta o registrar un AI Worklog.
        </Notice>
      )}

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const open = openId === step.id;
          const deliverable = step.deliverables[0];

          return (
            <li key={step.id} className="panel p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                  {index + 1}
                </span>

                <div className="min-w-40 flex-1">
                  <input
                    value={step.title}
                    onChange={(event) => patchStep(step.id, { title: event.target.value })}
                    placeholder="Qué hay que hacer"
                    className="field font-medium"
                  />
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-label text-subtle">
                    <span>{DELIVERABLE_LABEL[deliverable?.type ?? 'none']}</span>
                    {step.tool.mode !== 'none' && <span>· {TOOL_MODE_LABEL[step.tool.mode]}</span>}
                    {!step.required && <span>· Opcional</span>}
                    {step.assignedTo && step.assignedTo.length > 0 && (
                      <span>· {step.assignedTo.length} responsables</span>
                    )}
                  </p>
                </div>

                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Subir el paso ${index + 1}`}
                    className="btn btn-ghost btn-sm"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === steps.length - 1}
                    aria-label={`Bajar el paso ${index + 1}`}
                    className="btn btn-ghost btn-sm"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : step.id)}
                    aria-expanded={open}
                    className="btn btn-secondary btn-sm"
                  >
                    {open ? 'Cerrar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(step.id)}
                    className="btn btn-ghost btn-sm"
                  >
                    Quitar
                  </button>
                </div>
              </div>

              {open && (
                <StepEditor
                  courseId={courseId}
                  assignment={assignment}
                  step={step}
                  index={index}
                  previousSteps={steps.slice(0, index)}
                  students={students}
                  onChange={(changes) => patchStep(step.id, changes)}
                />
              )}
            </li>
          );
        })}
      </ol>

      {steps.length < WORKFLOW_LIMITS.maxSteps && (
        <div className="mt-4 flex flex-wrap gap-2">
          {STEP_ACTIONS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => add(preset)}
              title={preset.helper}
              className="btn btn-secondary btn-sm"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepEditor({
  courseId,
  assignment,
  step,
  index,
  previousSteps,
  students,
  onChange,
}: {
  courseId: string;
  assignment: { title: string; description: string };
  step: WorkflowStep;
  index: number;
  previousSteps: WorkflowStep[];
  students: RosterRow[];
  onChange: (changes: Partial<WorkflowStep>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(
    step.dependsOnStepIds.length > 0 || Boolean(step.assignedTo?.length)
  );

  const deliverable = step.deliverables[0] ?? {
    type: 'none' as DeliverableType,
    required: true,
    hint: '',
    questions: [] as ResearchQuestion[],
  };

  const patchDeliverable = (changes: Partial<typeof deliverable>) =>
    onChange({ deliverables: [{ ...deliverable, ...changes }] });

  return (
    <div className="mt-5 space-y-5 border-t border-line pt-5">
      <Field label="Qué hay que hacer" hint="Las instrucciones concretas del paso.">
        <textarea
          rows={3}
          value={step.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="Busca cinco fuentes relevantes sobre arquitectura de información."
          className="field"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de paso">
          <select
            value={step.actionType}
            onChange={(event) =>
              onChange({ actionType: event.target.value as StepActionType })
            }
            className="field"
          >
            {STEP_ACTIONS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            {/* Un paso guardado con una acción que ya no está en el catálogo
                sigue apareciendo: el modelo es abierto y la interfaz no puede
                perder lo que no reconoce. */}
            {!STEP_ACTIONS.some((preset) => preset.value === step.actionType) && (
              <option value={step.actionType}>{step.actionType}</option>
            )}
          </select>
        </Field>

        <Field label="Qué debe entregar">
          <select
            value={deliverable.type}
            onChange={(event) =>
              patchDeliverable({ type: event.target.value as DeliverableType })
            }
            className="field"
          >
            {DELIVERABLE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {DELIVERABLE_LABEL[type]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {deliverable.type !== 'none' && (
        <Field label="Pista para el entregable" hint="Opcional.">
          <input
            value={deliverable.hint}
            onChange={(event) => patchDeliverable({ hint: event.target.value })}
            placeholder="Pega los cinco enlaces, uno por línea."
            className="field"
          />
        </Field>
      )}

      {deliverable.type === 'structured' && (
        <StepQuestions
          questions={deliverable.questions}
          onChange={(questions) => patchDeliverable({ questions })}
        />
      )}

      <ToolPicker courseId={courseId} tool={step.tool} onChange={(tool) => onChange({ tool })} />

      <StepPromptField
        courseId={courseId}
        prompt={step.prompt}
        context={{
          assignmentTitle: assignment.title,
          assignmentDescription: assignment.description,
          stepTitle: step.title,
          stepInstructions: step.instructions,
          toolNames: step.tool.toolNames,
          deliverableLabel: DELIVERABLE_LABEL[deliverable.type],
        }}
        onChange={(prompt) => onChange({ prompt })}
      />

      <ResourcePicker
        courseId={courseId}
        value={step.resources}
        onChange={(resources: ResourceRef[]) => onChange({ resources })}
        label="Recursos de este paso"
        hint="La Skill o la guía que hacen falta aquí. El prompt se define arriba."
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!step.required}
          onChange={(event) => onChange({ required: !event.target.checked })}
        />
        <span className="text-sm">
          Paso opcional{' '}
          <span className="text-subtle">— no bloquea la entrega si no se hace.</span>
        </span>
      </label>

      {!showAdvanced ? (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="btn btn-ghost btn-sm"
        >
          Responsables y dependencias
        </button>
      ) : (
        <div className="space-y-4 border-t border-line pt-4">
          <fieldset>
            <legend className="label">Quién hace este paso</legend>
            <p className="hint">
              Sin nadie marcado, lo hace quien tenga la tarea. Es el caso normal.
            </p>
            {students.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {students.map((student) => {
                  const active = step.assignedTo?.includes(student.handle) ?? false;
                  return (
                    <button
                      key={student.handle}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const current = step.assignedTo ?? [];
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

          {previousSteps.length > 0 && (
            <fieldset>
              <legend className="label">Depende de</legend>
              <p className="hint">
                El paso queda bloqueado hasta que se completen los marcados.
              </p>
              <div className="mt-2 space-y-1">
                {previousSteps.map((previous, position) => (
                  <label key={previous.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={step.dependsOnStepIds.includes(previous.id)}
                      onChange={(event) =>
                        onChange({
                          dependsOnStepIds: event.target.checked
                            ? [...step.dependsOnStepIds, previous.id]
                            : step.dependsOnStepIds.filter((id) => id !== previous.id),
                        })
                      }
                    />
                    <span>
                      {position + 1}. {previous.title || 'Paso sin título'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <p className="text-label text-subtle">Paso {index + 1}</p>
    </div>
  );
}

/**
 * Elección de herramienta (§24, §37).
 *
 * Las herramientas se escriben por NOMBRE. No hay que darlas de alta en ningún
 * catálogo antes de poder usarlas: §13 y §50 piden justamente eso, que una
 * herramienta nueva no dependa de que alguien toque código ni de un registro
 * previo.
 */
function ToolPicker({
  courseId,
  tool,
  onChange,
}: {
  courseId: string;
  tool: WorkflowStep['tool'];
  onChange: (tool: WorkflowStep['tool']) => void;
}) {
  const [draft, setDraft] = useState('');
  const library = useApi<CourseLibrary>(`/api/courses/${courseId}/library`);

  /** Las herramientas que YA están en la biblioteca de la materia. */
  const catalog = (library.data?.resources ?? []).filter(
    (resource) => resource.type === 'tool' && resource.status === 'approved'
  );

  const modes: ToolChoiceMode[] = ['none', 'required', 'choice', 'free'];

  /**
   * Añadir escribiendo. NO exige que la herramienta esté en el catálogo.
   *
   * §13 y §50: UINexus no debe obligar a dar de alta una plataforma para poder
   * usarla en una tarea. Se guarda sólo el nombre, que es la información humana
   * durable; si mañana alguien registra esa herramienta, el paso sigue igual de
   * legible.
   */
  function addName(): void {
    const name = draft.trim();
    if (!name || tool.toolNames.includes(name)) return;

    // Si resulta que la herramienta SÍ está en el catálogo, se aprovecha el id
    // además del nombre: da ficha y enlace sin coste ninguno.
    const known = catalog.find(
      (resource) => resource.title.toLowerCase() === name.toLowerCase()
    );

    onChange({
      ...tool,
      toolNames: [...tool.toolNames, known?.title ?? name],
      toolIds: known ? [...tool.toolIds, known.id] : tool.toolIds,
    });
    setDraft('');
  }

  /**
   * Añadir desde el catálogo. Guarda id Y nombre.
   *
   * El NOMBRE es lo que hace durable el paso: si el recurso se borra de la
   * biblioteca, la tarea sigue diciendo «Perplexity» en vez de quedarse muda.
   * El id sólo añade ficha y enlace mientras exista.
   */
  function addFromCatalog(resource: { id: string; title: string }): void {
    if (tool.toolNames.includes(resource.title)) return;
    onChange({
      ...tool,
      toolIds: [...tool.toolIds, resource.id],
      toolNames: [...tool.toolNames, resource.title],
    });
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
      <legend className="label">Herramienta</legend>

      <div className="mt-2 flex flex-wrap gap-2">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={tool.mode === mode}
            onClick={() => onChange({ ...tool, mode })}
            className="chip"
          >
            {TOOL_MODE_LABEL[mode]}
          </button>
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
                      onClick={() => addFromCatalog(resource)}
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
                  <button type="button" onClick={() => removeName(name)} className="tag">
                    {name} ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {draft.trim() &&
            !catalog.some(
              (resource) => resource.title.toLowerCase() === draft.trim().toLowerCase()
            ) && (
              <p className="hint">
                «{draft.trim()}» no está en la biblioteca. Puedes usarla igualmente; si quieres,
                añádela después desde Recursos IA.
              </p>
            )}
        </div>
      )}

      {tool.mode === 'free' && (
        <p className="hint">
          El alumnado elige la herramienta y escribe cuál usó. Queda registrado en la evidencia.
        </p>
      )}
    </fieldset>
  );
}

/** Campos de una respuesta estructurada dentro de un paso. */
function StepQuestions({
  questions,
  onChange,
}: {
  questions: ResearchQuestion[];
  onChange: (questions: ResearchQuestion[]) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Campos que hay que rellenar</legend>

      <ul className="mt-2 space-y-2">
        {questions.map((question, index) => (
          <li key={question.id} className="flex flex-wrap items-end gap-2">
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
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          const id = uid();
          onChange([
            ...questions,
            { id, group: null, groupId: id, prompt: '', type: 'long_text', required: false },
          ]);
        }}
        className="btn btn-secondary btn-sm mt-3"
      >
        + Añadir campo
      </button>
    </fieldset>
  );
}
