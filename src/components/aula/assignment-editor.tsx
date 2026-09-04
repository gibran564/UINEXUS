'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ASSIGNMENT_TYPES, DELIVERABLE_LABEL, stepActionLabel } from '@/lib/constants';
import {
  createAssignment,
  updateAssignment,
  useApi,
  type AssignmentDetail,
  type RosterRow,
} from '@/lib/aula-client';
import type {
  AssignmentType,
  CollaborationMode,
  ContributionVisibility,
  GroupAssignment,
  ResearchQuestion,
  ResourceLink,
  ResourceRef,
  WorkflowStep,
} from '@/lib/types';
import { composeDueAt, formatDueLabel, splitDueAt } from '@/lib/due-date';
import { AulaScreen, Crumbs, Field, Notice } from './aula-ui';
import { CollaborationPlanner } from './collaboration-planner';
import { WorkflowBuilder } from './workflow-builder';
import { ResourcePicker } from './resource-picker';

/**
 * Crear y editar una tarea (§5).
 *
 * Decisiones que la pantalla toma por quien la usa, para que no tenga que
 * pensarlas:
 *
 *  · «Asignar a todo el grupo» viene marcado. Es el caso normal y, si se
 *    olvida, el error cae del lado seguro: la tarea la ve todo el mundo, en vez
 *    de no verla nadie y nadie enterarse hasta el día de la entrega.
 *  · Los campos de investigación se generan por CONCEPTO, no uno a uno. Escribir
 *    «Card sorting» produce sus tres campos —definición, fuente y comentario—
 *    porque ése es el formato de la tarea que esto viene a sustituir. Después se
 *    pueden editar o borrar sueltos, que es lo que lo mantiene general.
 *  · Se guarda como borrador o se publica en el mismo formulario. Una tarea a
 *    medio escribir no debería obligar a decidir todavía si el grupo la ve.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10);

const VISIBILITY_OPTIONS: {
  value: ContributionVisibility;
  label: string;
  helper: string;
}[] = [
  {
    value: 'group',
    label: 'Pueden ver las aportaciones del grupo',
    helper: 'Es lo normal en un glosario: leer al resto es parte del ejercicio.',
  },
  {
    value: 'own',
    label: 'Sólo ven su propia aportación',
    helper: 'Para cuando quieres respuestas independientes.',
  },
  {
    value: 'after_submit',
    label: 'Ven las demás sólo después de entregar la suya',
    helper: 'Evita que se copie la respuesta del compañero sin cerrar la lectura después.',
  },
];

interface DraftState {
  title: string;
  description: string;
  instructions: string;
  type: AssignmentType;
  /** Fecha límite en local, «YYYY-MM-DD». Vacío = sin fecha límite. */
  dueDate: string;
  /** Hora límite en local, «HH:MM». Vacío = final del día. */
  dueTime: string;
  resourceLinks: ResourceLink[];
  researchQuestions: ResearchQuestion[];
  assignToAll: boolean;
  assignedHandles: string[];
  collaborationMode: CollaborationMode;
  contributionVisibility: ContributionVisibility;
  groupAssignments: GroupAssignment[];
  resources: ResourceRef[];
  /** Modo del constructor. `multi` habilita los pasos. */
  shape: 'single' | 'multi';
  workflow: WorkflowStep[];
}

const EMPTY: DraftState = {
  title: '',
  description: '',
  instructions: '',
  type: 'research',
  dueDate: '',
  dueTime: '',
  resourceLinks: [],
  researchQuestions: [],
  assignToAll: true,
  assignedHandles: [],
  collaborationMode: 'individual',
  contributionVisibility: 'group',
  groupAssignments: [],
  resources: [],
  shape: 'single',
  workflow: [],
};

/** La fecha límite del borrador, en la forma que leen los ayudantes de fecha. */
function draftDue(draft: DraftState): { dueDate: string | null; dueAt: string | null } {
  return {
    dueDate: draft.dueDate || null,
    dueAt: composeDueAt(draft.dueDate, draft.dueTime),
  };
}

/** Hasta cuándo se reciben entregas, dicho en una frase. */
function dueSummary(draft: DraftState): string {
  if (!draft.dueDate) return 'Sin fecha límite: se aceptarán entregas siempre.';
  return `Se aceptarán entregas hasta el ${formatDueLabel(draftDue(draft))}.`;
}

export function AssignmentEditor({
  courseId,
  assignmentId,
}: {
  courseId: string;
  assignmentId?: string;
}) {
  const router = useRouter();

  /**
   * Estudiantes preseleccionados desde «Materia > Estudiantes» (§17).
   *
   * Llegan por la URL y sólo PRECARGAN el formulario: el resto del flujo es el
   * de siempre y acaba creando el mismo `Assignment`. No hay un segundo camino
   * de creación de tareas, que es justo lo que el encargo pide evitar.
   *
   * Se valida contra la lista real de la materia al guardar (`resolveMembers`),
   * así que escribir handles a mano en la URL no concede nada.
   */
  const params = useSearchParams();
  const preselected = (params.get('students') ?? '')
    .split(',')
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean);

  const [draft, setDraft] = useState<DraftState>(() =>
    preselected.length > 0
      ? { ...EMPTY, assignToAll: false, assignedHandles: preselected }
      : EMPTY
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const roster = useApi<{ students: RosterRow[] }>(`/api/courses/${courseId}/students`);
  const existing = useApi<AssignmentDetail>(
    assignmentId ? `/api/assignments/${assignmentId}` : null
  );

  /**
   * Plantilla de proceso (§28).
   *
   * Se pide al servidor, que devuelve los pasos ya CLONADOS con ids nuevos. No
   * se clonan aquí: si dependiera del navegador, la garantía de que dos tareas
   * no comparten claves de evidencia dependería de que el cliente la aplicara.
   *
   * Sólo al crear: editar una tarea que ya existe no debe pisar sus pasos con
   * los de una plantilla, o se perderían las evidencias ya entregadas.
   */
  const templateId = params.get('template');
  const template = useApi<{
    title: string;
    description: string;
    workflow: WorkflowStep[];
  }>(!assignmentId && templateId ? `/api/resources/${templateId}/instantiate` : null);

  // La plantilla se carga UNA vez, y sólo si la persona no ha escrito nada:
  // sobrescribir lo que lleva tecleado sería peor que no cargarla.
  const [templateApplied, setTemplateApplied] = useState(false);

  useEffect(() => {
    if (templateApplied || !template.data) return;
    setDraft((current) => ({
      ...current,
      title: current.title || template.data!.title,
      description: current.description || template.data!.description,
      shape: 'multi',
      workflow: template.data!.workflow,
    }));
    setTemplateApplied(true);
  }, [template.data, templateApplied]);

  useEffect(() => {
    const loaded = existing.data?.assignment;
    if (!loaded) return;
    setDraft({
      title: loaded.title,
      description: loaded.description,
      instructions: loaded.instructions,
      type: loaded.type,
      // La hora se recupera del instante, en la zona de quien edita. Una tarea
      // antigua sin instante vuelve con la fecha y sin hora, que es lo que es.
      dueDate: splitDueAt(loaded).date,
      dueTime: splitDueAt(loaded).time,
      resourceLinks: loaded.resourceLinks,
      researchQuestions: loaded.researchQuestions,
      assignToAll: loaded.assignedToAll,
      assignedHandles: loaded.assignedTo ?? [],
      collaborationMode: loaded.collaborationMode,
      contributionVisibility: loaded.contributionVisibility,
      groupAssignments: loaded.groupAssignments,
      resources: loaded.resources,
      // Una tarea guardada sin pasos propios se edita como lo que es: sencilla.
      // El paso que el servidor sintetiza al leerla no se pinta en el
      // constructor, porque no es algo que la docente escribiera.
      shape: loaded.type === 'workflow' ? 'multi' : 'single',
      workflow: loaded.type === 'workflow' ? loaded.workflow : [],
    });
  }, [existing.data]);

  const patch = (changes: Partial<DraftState>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const multi = draft.shape === 'multi';

  async function save(status: 'draft' | 'published'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        instructions: draft.instructions,
        // Una actividad de varios pasos se guarda como `workflow`; una de un
        // paso conserva su tipo de siempre para no cambiar cómo se lee.
        type: multi ? 'workflow' : draft.type,
        dueDate: draft.dueDate || null,
        /**
         * El instante se compone AQUÍ, en el navegador, porque es aquí donde se
         * conoce la zona horaria de quien pone la fecha. El servidor guarda el
         * instante que recibe y no intenta adivinar ninguna zona: eso es lo que
         * evita el fallo de «pongo 23:59 y cierra seis horas antes».
         */
        dueAt: composeDueAt(draft.dueDate, draft.dueTime),
        resourceLinks: draft.resourceLinks.filter((link) => link.url.trim()),
        researchQuestions: draft.researchQuestions.filter((question) => question.prompt.trim()),
        assignedHandles: draft.assignToAll ? null : draft.assignedHandles,
        status,
        collaborationMode: draft.collaborationMode,
        contributionVisibility: draft.contributionVisibility,
        // El reparto sólo tiene sentido en una investigación colaborativa. En
        // cualquier otro caso se manda vacío en vez de arrastrar el de una
        // edición anterior, que reaparecería si se volviera a poner en `shared`.
        groupAssignments:
          draft.type === 'research' && draft.collaborationMode === 'shared'
            ? draft.groupAssignments.filter((entry) => entry.assignedTo.length > 0)
            : [],
        resources: draft.resources,
        workflow: multi
          ? draft.workflow.map((step, index) => ({
              ...step,
              order: index,
              // El modelo habla en handles; el estado del formulario también.
              assignedHandles: step.assignedTo,
            }))
          : [],
      };

      if (assignmentId) await updateAssignment(assignmentId, body);
      else await createAssignment(courseId, body);

      router.push(`/aula/${courseId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  const students = roster.data?.students ?? [];
  const state = assignmentId ? existing.state : 'ready';

  return (
    <AulaScreen state={state} error={existing.error} next={`/aula/${courseId}`}>
      <Crumbs
        items={[
          { href: '/aula', label: 'Aula' },
          { href: `/aula/${courseId}`, label: 'Materia' },
          { label: assignmentId ? 'Editar tarea' : 'Nueva tarea' },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-h1">
          {assignmentId ? 'Editar tarea' : 'Nueva tarea'}
        </h1>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="btn btn-secondary btn-sm"
          aria-pressed={preview}
        >
          {preview ? '← Volver al editor' : 'Vista previa'}
        </button>
      </div>

      {preview ? (
        <TeacherPreview draft={draft} students={students} />
      ) : (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save('published');
        }}
        className="mt-8 max-w-3xl space-y-8"
      >
        <section className="space-y-4">
          <Field label="Título">
            <input
              required
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Arquitectura de información"
              className="field"
            />
          </Field>

          <Field
            label="Objetivo"
            hint="Una o dos frases sobre qué se busca con esta tarea."
          >
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Analizar la organización actual del sitio FlyExpress."
              className="field"
            />
          </Field>

          <Field
            label="Instrucciones"
            hint="Los pasos concretos. Es lo que el alumnado va a leer antes de empezar."
          >
            <textarea
              rows={5}
              value={draft.instructions}
              onChange={(event) => patch({ instructions: event.target.value })}
              placeholder={'1. Identifica categorías.\n2. Propón una nueva jerarquía.\n3. Justifica tus cambios.'}
              className="field"
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <Field label="Fecha límite" hint="Opcional.">
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => patch({ dueDate: event.target.value })}
                className="field w-48"
              />
            </Field>

            <Field label="Hora límite" hint="Si la dejas vacía, se cierra al final del día.">
              <input
                type="time"
                value={draft.dueTime}
                disabled={!draft.dueDate}
                onChange={(event) => patch({ dueTime: event.target.value })}
                className="field w-36"
              />
            </Field>
          </div>

          {/*
            La consecuencia, escrita. Una fecha sin hora es ambigua, y lo que
            resuelve la ambigüedad no es un valor por defecto callado sino
            decir en voz alta hasta cuándo se reciben entregas.
          */}
          <p className="text-sm text-muted">{dueSummary(draft)}</p>
        </section>

        <section aria-labelledby="forma">
          <h2 id="forma" className="section-mark font-display text-h3">
            ¿Cómo será esta actividad?
          </h2>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            <li>
              <label
                className={`panel flex h-full cursor-pointer gap-3 p-4 ${
                  !multi ? 'border-accent' : ''
                }`}
              >
                <input
                  type="radio"
                  name="assignment-shape"
                  checked={!multi}
                  onChange={() => patch({ shape: 'single' })}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Un solo paso</span>
                  <span className="mt-1 block text-sm text-muted">
                    Una entrega y ya. Es lo de siempre y se crea en segundos.
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label
                className={`panel flex h-full cursor-pointer gap-3 p-4 ${
                  multi ? 'border-accent' : ''
                }`}
              >
                <input
                  type="radio"
                  name="assignment-shape"
                  checked={multi}
                  onChange={() => patch({ shape: 'multi' })}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Varios pasos</span>
                  <span className="mt-1 block text-sm text-muted">
                    Un proceso: buscar fuentes, procesarlas con IA, hacer un mapa, reflexionar.
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </section>

        {multi && (
          <section aria-labelledby="pasos">
            <h2 id="pasos" className="section-mark font-display text-h3">
              Pasos
            </h2>
            <p className="mt-1 text-sm text-muted">
              Cada paso dice qué hacer, con qué herramienta y qué hay que entregar.
            </p>
            <div className="mt-4">
              <WorkflowBuilder
                courseId={courseId}
                steps={draft.workflow}
                students={students}
                assignment={{ title: draft.title, description: draft.description }}
                onChange={(workflow) => patch({ workflow })}
              />
            </div>
          </section>
        )}

        {!multi && (
        <section aria-labelledby="tipo">
          <h2 id="tipo" className="section-mark font-display text-h3">
            Tipo de entrega
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {ASSIGNMENT_TYPES.map((option) => (
              <li key={option.value}>
                <label
                  className={`panel flex h-full cursor-pointer gap-3 p-4 ${
                    draft.type === option.value ? 'border-accent' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="assignment-type"
                    value={option.value}
                    checked={draft.type === option.value}
                    onChange={() => patch({ type: option.value })}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-sm text-muted">{option.helper}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        )}

        {!multi && draft.type === 'research' && (
          <>
            <section aria-labelledby="modo">
              <h2 id="modo" className="section-mark font-display text-h3">
                Modo de actividad
              </h2>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                <li>
                  <label
                    className={`panel flex h-full cursor-pointer gap-3 p-4 ${
                      draft.collaborationMode === 'individual' ? 'border-accent' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="collaboration-mode"
                      checked={draft.collaborationMode === 'individual'}
                      onChange={() => patch({ collaborationMode: 'individual' })}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium">Individual</span>
                      <span className="mt-1 block text-sm text-muted">
                        Cada estudiante responde toda la actividad por separado.
                      </span>
                    </span>
                  </label>
                </li>
                <li>
                  <label
                    className={`panel flex h-full cursor-pointer gap-3 p-4 ${
                      draft.collaborationMode === 'shared' ? 'border-accent' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="collaboration-mode"
                      checked={draft.collaborationMode === 'shared'}
                      onChange={() => patch({ collaborationMode: 'shared' })}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium">Colaborativa</span>
                      <span className="mt-1 block text-sm text-muted">
                        El grupo construye una actividad conjunta. Repartes los conceptos y
                        UINexus junta las aportaciones.
                      </span>
                    </span>
                  </label>
                </li>
              </ul>
            </section>

            <ResearchBuilder
              questions={draft.researchQuestions}
              onChange={(researchQuestions) => patch({ researchQuestions })}
            />

            {draft.collaborationMode === 'shared' && (
              <>
                <section aria-labelledby="reparto">
                  <h2 id="reparto" className="section-mark font-display text-h3">
                    Reparto de conceptos
                  </h2>
                  <div className="mt-4">
                    <CollaborationPlanner
                      questions={draft.researchQuestions}
                      students={students}
                      assignments={draft.groupAssignments}
                      onChange={(groupAssignments) => patch({ groupAssignments })}
                    />
                  </div>
                </section>

                <section aria-labelledby="visibilidad">
                  <h2 id="visibilidad" className="section-mark font-display text-h3">
                    Visibilidad de las aportaciones
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Tú ves siempre todo. Esto decide qué ve el alumnado.
                  </p>
                  <div className="mt-4 space-y-2">
                    {VISIBILITY_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="contribution-visibility"
                          checked={draft.contributionVisibility === option.value}
                          onChange={() => patch({ contributionVisibility: option.value })}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="block text-sm text-muted">{option.helper}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}

        <ResourceEditor
          links={draft.resourceLinks}
          onChange={(resourceLinks) => patch({ resourceLinks })}
        />

        <ResourcePicker
          courseId={courseId}
          value={draft.resources}
          onChange={(resources) => patch({ resources })}
        />

        <section aria-labelledby="asignar">
          <h2 id="asignar" className="section-mark font-display text-h3">
            A quién se asigna
          </h2>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.assignToAll}
              onChange={(event) => patch({ assignToAll: event.target.checked })}
            />
            <span>Asignar a todo el grupo</span>
          </label>

          {!draft.assignToAll && (
            <div className="mt-4">
              {students.length === 0 ? (
                <Notice>
                  Todavía no hay nadie inscrito. Inscribe estudiantes en la pestaña Estudiantes o
                  deja la tarea para todo el grupo.
                </Notice>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-sm border border-line p-3">
                  {students.map((student) => (
                    <li key={student.handle}>
                      <label className="flex items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          checked={draft.assignedHandles.includes(student.handle)}
                          onChange={(event) =>
                            patch({
                              assignedHandles: event.target.checked
                                ? [...draft.assignedHandles, student.handle]
                                : draft.assignedHandles.filter((h) => h !== student.handle),
                            })
                          }
                        />
                        <span>{student.displayName}</span>
                        <span className="font-mono text-label text-subtle">@{student.handle}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {error && <Notice tone="error">{error}</Notice>}

        <AssignmentSummary draft={draft} students={students} />

        <div className="flex flex-wrap gap-3 border-t border-line pt-6">
          <button
            type="submit"
            disabled={busy || draft.title.trim().length < 3}
            className="btn btn-primary"
          >
            {busy ? 'Guardando…' : 'Publicar tarea'}
          </button>
          <button
            type="button"
            disabled={busy || draft.title.trim().length < 3}
            onClick={() => void save('draft')}
            className="btn btn-secondary"
          >
            Guardar como borrador
          </button>
          <button
            type="button"
            onClick={() => router.push(`/aula/${courseId}`)}
            className="btn btn-ghost"
          >
            Cancelar
          </button>
        </div>
      </form>
      )}
    </AulaScreen>
  );
}

/**
 * Constructor de campos de investigación (§9).
 *
 * No es un constructor tipo Google Forms, y §9 pide explícitamente que no lo
 * sea todavía: tres tipos de campo y un atajo por concepto. Lo justo para
 * reemplazar el DOCX de conceptos, que es el problema real.
 */
function ResearchBuilder({
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
    /**
     * El `groupId` se genera aquí y NO se deriva del nombre: es lo que se
     * reparte entre estudiantes, así que tiene que sobrevivir a que alguien
     * corrija una tilde en «Taxonomía» después de haber repartido.
     */
    const groupId = uid();
    onChange([
      ...questions,
      { id: uid(), group: name, groupId, prompt: 'Definición', type: 'long_text', required: true },
      { id: uid(), group: name, groupId, prompt: 'Fuente', type: 'url', required: false },
      { id: uid(), group: name, groupId, prompt: 'Comentario', type: 'long_text', required: false },
    ]);
    setConcept('');
  }

  function addSingle(): void {
    const id = uid();
    onChange([
      ...questions,
      { id, group: null, groupId: id, prompt: '', type: 'long_text', required: false },
    ]);
  }

  function patchQuestion(id: string, changes: Partial<ResearchQuestion>): void {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...changes } : q)));
  }

  return (
    <section aria-labelledby="campos">
      <h2 id="campos" className="section-mark font-display text-h3">
        Campos que va a rellenar el alumnado
      </h2>
      <p className="mt-1 text-sm text-muted">
        Esto sustituye al documento de Word. Escribe un concepto y se crean sus tres campos:
        definición, fuente y comentario.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1">
          <span className="label">Concepto</span>
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
        <button type="button" onClick={addConcept} className="btn btn-secondary">
          Añadir concepto
        </button>
        <button type="button" onClick={addSingle} className="btn btn-ghost">
          Añadir campo suelto
        </button>
      </div>

      {questions.length > 0 && (
        <ul className="mt-5 space-y-2">
          {questions.map((question, index) => (
            <li key={question.id} className="panel flex flex-wrap items-end gap-2 p-3">
              <span className="w-6 pb-2 text-sm text-subtle tabular-nums">{index + 1}</span>

              <label className="min-w-32 flex-1">
                <span className="label">Concepto</span>
                <input
                  value={question.group ?? ''}
                  onChange={(event) =>
                    patchQuestion(question.id, { group: event.target.value || null })
                  }
                  placeholder="(sin agrupar)"
                  className="field"
                />
              </label>

              <label className="min-w-40 flex-1">
                <span className="label">Campo</span>
                <input
                  value={question.prompt}
                  onChange={(event) => patchQuestion(question.id, { prompt: event.target.value })}
                  placeholder="Definición"
                  className="field"
                />
              </label>

              <label>
                <span className="label">Tipo</span>
                <select
                  value={question.type}
                  onChange={(event) =>
                    patchQuestion(question.id, {
                      type: event.target.value as ResearchQuestion['type'],
                    })
                  }
                  className="field w-36"
                >
                  <option value="long_text">Texto largo</option>
                  <option value="short_text">Texto corto</option>
                  <option value="url">Enlace</option>
                </select>
              </label>

              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) =>
                    patchQuestion(question.id, { required: event.target.checked })
                  }
                />
                <span className="text-sm">Obligatorio</span>
              </label>

              <button
                type="button"
                onClick={() => onChange(questions.filter((q) => q.id !== question.id))}
                className="btn btn-ghost btn-sm"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Recursos de la tarea: se abren directamente desde la pantalla del alumnado. */
function ResourceEditor({
  links,
  onChange,
}: {
  links: ResourceLink[];
  onChange: (links: ResourceLink[]) => void;
}) {
  return (
    <section aria-labelledby="recursos">
      <h2 id="recursos" className="section-mark font-display text-h3">
        Recursos
      </h2>
      <p className="mt-1 text-sm text-muted">
        Lecturas, plantillas, el archivo de Figma… Se abren desde la propia tarea.
      </p>

      <ul className="mt-4 space-y-2">
        {links.map((link, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className="label">Nombre</span>
              <input
                value={link.label}
                onChange={(event) =>
                  onChange(
                    links.map((item, position) =>
                      position === index ? { ...item, label: event.target.value } : item
                    )
                  )
                }
                placeholder="Plantilla en Figma"
                className="field"
              />
            </label>
            <label className="min-w-56 flex-[2]">
              <span className="label">Enlace</span>
              <input
                type="url"
                value={link.url}
                onChange={(event) =>
                  onChange(
                    links.map((item, position) =>
                      position === index ? { ...item, url: event.target.value } : item
                    )
                  )
                }
                placeholder="https://figma.com/file/…"
                className="field"
              />
            </label>
            <button
              type="button"
              onClick={() => onChange(links.filter((_, position) => position !== index))}
              className="btn btn-ghost btn-sm"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onChange([...links, { label: '', url: '' }])}
        className="btn btn-secondary btn-sm mt-3"
      >
        + Añadir recurso
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// P1 — Vista previa docente como estudiante
// ---------------------------------------------------------------------------

/**
 * Muestra al docente cómo vería la tarea un estudiante.
 *
 * Lee sólo el `draft` sin llamar a ninguna API. No crea Submission,
 * no guarda progreso, no suplanta ninguna identidad.
 */
function TeacherPreview({
  draft,
  students,
}: {
  draft: DraftState;
  students: RosterRow[];
}) {
  const multi = draft.shape === 'multi';
  const steps = draft.workflow;

  return (
    <article className="mt-8 max-w-3xl rounded-md border-2 border-dashed border-accent/40 bg-raised/60 p-6">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
        Vista previa · Así lo verá el alumnado
      </p>

      <header className="border-b border-line pb-6">
        <h2 className="font-display text-h1">{draft.title || '(sin título)'}</h2>
        <p className="mt-3 text-sm text-muted">
          {draft.dueDate ? `Entrega: ${formatDueLabel(draftDue(draft))}` : 'Sin fecha límite'}
        </p>
      </header>

      {draft.description && (
        <section className="mt-8">
          <h3 className="font-display text-h3">Objetivo</h3>
          <p className="prose-block mt-2 max-w-prose whitespace-pre-line text-muted">
            {draft.description}
          </p>
        </section>
      )}

      {draft.instructions && (
        <section className="mt-8">
          <h3 className="font-display text-h3">Instrucciones</h3>
          <p className="prose-block mt-2 max-w-prose whitespace-pre-line text-muted">
            {draft.instructions}
          </p>
        </section>
      )}

      {draft.resourceLinks.filter((l) => l.url.trim()).length > 0 && (
        <section className="mt-8">
          <h3 className="font-display text-h3">Recursos</h3>
          <ul className="mt-3 space-y-2">
            {draft.resourceLinks
              .filter((l) => l.url.trim())
              .map((link, i) => (
                <li key={i}>
                  <span className="btn btn-secondary btn-sm">
                    {link.label || link.url} ↗
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {multi && steps.length > 0 && (
        <section className="mt-8">
          <h3 className="font-display text-h3">Los pasos</h3>
          <p className="mt-1 text-sm text-muted">
            Esta actividad tiene varios pasos. Los haces en orden.
          </p>
          <ol className="mt-4 space-y-2">
            {steps.map((step, index) => (
              <li key={step.id} className="panel flex flex-wrap items-center gap-3 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.title || '(sin título)'}</span>
                  <span className="block text-label text-subtle">
                    {stepActionLabel(step.actionType)}
                    {step.tool.toolNames.length > 0 && ` · ${step.tool.toolNames.join(', ')}`}
                    {' · '}
                    {DELIVERABLE_LABEL[step.deliverables[0]?.type ?? 'none']}
                    {!step.required && ' · opcional'}
                  </span>
                  {step.description && (
                    <span className="mt-1 block text-sm text-muted">{step.description}</span>
                  )}
                  {step.instructions && (
                    <span className="mt-1 block whitespace-pre-line text-sm text-muted">
                      {step.instructions}
                    </span>
                  )}
                  {step.prompt?.mode === 'inline' && (
                    <span className="mt-2 block whitespace-pre-wrap rounded-sm border border-line bg-sunken p-2 font-mono text-sm">
                      {step.prompt.text}
                    </span>
                  )}
                  {step.prompt?.mode === 'library' && (
                    <span className="mt-1 block text-label text-subtle">
                      Prompt de la biblioteca: {step.prompt.title || 'sin título'}
                    </span>
                  )}
                  {step.dependsOnStepIds.length > 0 && (
                    <span className="mt-1 block text-label text-subtle">
                      Requiere completar:{' '}
                      {step.dependsOnStepIds
                        .map((id) => {
                          const dep = steps.find((s) => s.id === id);
                          return dep ? dep.title || `Paso ${steps.indexOf(dep) + 1}` : id;
                        })
                        .join(', ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <button
          type="button"
          disabled
          className="btn btn-primary cursor-not-allowed opacity-50"
          title="Vista previa — no crea una entrega real"
        >
          Comenzar tarea (Vista previa)
        </button>
        <p className="mt-2 text-xs text-subtle">
          En vista previa el botón no funciona. El alumnado sí verá el botón real.
        </p>
      </div>

      {students.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {draft.assignToAll
            ? `Se asignará a todo el grupo (${students.length} estudiante${students.length !== 1 ? 's' : ''})`
            : draft.assignedHandles.length > 0
              ? `Asignada a ${draft.assignedHandles.length} estudiante${draft.assignedHandles.length !== 1 ? 's' : ''} seleccionado${draft.assignedHandles.length !== 1 ? 's' : ''}`
              : 'Sin estudiantes asignados aún'}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// P2 — Resumen compacto antes de publicar
// ---------------------------------------------------------------------------

/**
 * Resumen compacto de la tarea, justo antes de publicar.
 *
 * Reutiliza los datos del draft sin llamar a ninguna API. Sólo se
 * muestra cuando hay título suficiente para que el resumen tenga sentido.
 */
function AssignmentSummary({
  draft,
  students,
}: {
  draft: DraftState;
  students: RosterRow[];
}) {
  if (draft.title.trim().length < 3) return null;

  const multi = draft.shape === 'multi';
  const steps = draft.workflow;
  const requiredSteps = steps.filter((s) => s.required);
  const optionalSteps = steps.filter((s) => !s.required);

  // Herramientas únicas de todos los pasos
  const allTools = Array.from(
    new Set(steps.flatMap((s) => s.tool.toolNames))
  ).filter(Boolean);

  // Entregables únicos
  const allDeliverables = Array.from(
    new Set(
      steps.flatMap((s) =>
        s.deliverables.map((d) => DELIVERABLE_LABEL[d.type] ?? d.type)
      )
    )
  ).filter(Boolean);

  const assignedCount = draft.assignToAll
    ? students.length
    : draft.assignedHandles.length;

  const resourceLinkCount = draft.resourceLinks.filter((l) => l.url.trim()).length;

  return (
    <section
      aria-label="Resumen de la tarea"
      className="max-w-3xl rounded-md border border-line bg-raised p-5"
    >
      <h2 className="text-sm font-semibold text-fg">{draft.title}</h2>
      {draft.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted">{draft.description}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {multi && (
          <>
            <div>
              <dt className="text-label text-subtle">Pasos</dt>
              <dd className="font-medium">
                {steps.length}
                {steps.length > 0 && (
                  <span className="ml-1 font-normal text-muted">
                    ({requiredSteps.length} obligatorio{requiredSteps.length !== 1 ? 's' : ''}
                    {optionalSteps.length > 0 &&
                      `, ${optionalSteps.length} opcional${optionalSteps.length !== 1 ? 'es' : ''}`}
                    )
                  </span>
                )}
              </dd>
            </div>

            {allTools.length > 0 && (
              <div>
                <dt className="text-label text-subtle">Herramientas</dt>
                <dd className="font-medium">{allTools.join(' · ')}</dd>
              </div>
            )}

            {allDeliverables.length > 0 && (
              <div>
                <dt className="text-label text-subtle">Entregables</dt>
                <dd className="font-medium">{allDeliverables.join(' · ')}</dd>
              </div>
            )}
          </>
        )}

        {resourceLinkCount > 0 && (
          <div>
            <dt className="text-label text-subtle">Recursos</dt>
            <dd className="font-medium">
              {resourceLinkCount} enlace{resourceLinkCount !== 1 ? 's' : ''}
            </dd>
          </div>
        )}

        {students.length > 0 && (
          <div>
            <dt className="text-label text-subtle">Asignación</dt>
            <dd className="font-medium">
              {draft.assignToAll
                ? `Todo el grupo (${students.length})`
                : assignedCount > 0
                  ? `${assignedCount} estudiante${assignedCount !== 1 ? 's' : ''}`
                  : 'Sin asignar'}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
