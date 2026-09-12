'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  activityProblems,
  blockingProblems,
  deriveActivity,
  humanizeSaveError,
  partActionLabel,
  partDeliverable,
  partsFromAssignment,
  type ActivityProblem,
} from '@/lib/activity-builder';
import {
  createAssignment,
  updateAssignment,
  useApi,
  type AssignmentDetail,
  type RosterRow,
} from '@/lib/aula-client';
import type {
  AssignmentMaterial,
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
import { ActivityParts } from './activity-parts';
import { MaterialsList } from './assignment-materials';
import { CollaborationPlanner } from './collaboration-planner';
import { NexLabTemplatePanel } from './nexlab-template-panel';
import { ResourcePicker } from './resource-picker';
import { WorkflowTemplatePicker } from './workflow-template-picker';

/**
 * Crear y editar una actividad.
 *
 * ## Qué cambió en la iteración 5
 *
 * La pantalla anterior empezaba preguntando «¿un paso o varios?» y seguía con
 * dos listas de tipos internos. Quien creaba una actividad tenía que traducir su
 * intención al modelo antes de poder escribir nada.
 *
 * Ahora el orden es el de quien enseña:
 *
 * ```
 * 1. Lo básico            título, objetivo, instrucciones, fecha, a quién
 * 2. Qué hará el estudiante   las Partes
 * 3. Materiales y recursos
 * 4. Vista previa
 * 5. Opciones avanzadas
 * ```
 *
 * Y la pregunta de la sección 2 es una sola: **¿qué debe hacer el estudiante?**
 * La forma de la actividad —una parte o varias, y en qué representación se
 * guarda— se DERIVA en `lib/activity-builder`. No se pregunta porque no es una
 * decisión pedagógica.
 *
 * ## El motor no cambió
 *
 * Esta pantalla escribe exactamente el mismo `Assignment` que antes:
 * `Workflow`, `WorkflowStep`, `StepDeliverable`, `StepPrompt`, `StepToolChoice`,
 * `dependsOnStepIds` y `assignedTo`. El runner del alumnado no se tocó, y una
 * actividad creada con la pantalla anterior abre, se edita y se guarda en su
 * misma forma.
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
  /** Fecha límite en local, «YYYY-MM-DD». Vacío = sin fecha límite. */
  dueDate: string;
  /** Hora límite en local, «HH:MM». Vacío = final del día. */
  dueTime: string;
  resourceLinks: ResourceLink[];
  assignToAll: boolean;
  assignedHandles: string[];
  collaborationMode: CollaborationMode;
  contributionVisibility: ContributionVisibility;
  groupAssignments: GroupAssignment[];
  resources: ResourceRef[];
  /** Las Partes. Vacío = todavía no se ha dicho qué hará el estudiante. */
  parts: WorkflowStep[];
  /**
   * La actividad YA se guardaba como proceso antes de esta edición.
   *
   * Decide que no se degrade a la representación antigua: la evidencia de lo
   * entregado se indexa por el id de la parte, y volver atrás la dejaría
   * huérfana. Ver `deriveActivity`.
   */
  wasWorkflow: boolean;
  /**
   * Los campos de investigación de una actividad antigua.
   *
   * No se editan aquí —viven en la Parte que los pide— pero se arrastran para
   * que convertir esa actividad en un proceso no los borre.
   */
  researchQuestions: ResearchQuestion[];
}

const EMPTY: DraftState = {
  title: '',
  description: '',
  instructions: '',
  dueDate: '',
  dueTime: '',
  resourceLinks: [],
  assignToAll: true,
  assignedHandles: [],
  collaborationMode: 'individual',
  contributionVisibility: 'group',
  groupAssignments: [],
  resources: [],
  parts: [],
  wasWorkflow: false,
  researchQuestions: [],
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
   * Estudiantes preseleccionados desde «Materia > Estudiantes».
   *
   * Llegan por la URL y sólo PRECARGAN el formulario: se validan contra la lista
   * real de la materia al guardar, así que escribir handles a mano no concede
   * nada.
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [labPart, setLabPart] = useState<WorkflowStep | null>(null);

  /**
   * El id de la actividad que se está editando AHORA.
   *
   * Arranca en el de la ruta y se rellena en cuanto se guarda por primera vez.
   * Existe porque hay dos cosas —adjuntar archivos y preparar un NexLab— que
   * necesitan que la actividad EXISTA, y hacerlas no puede costar perder lo que
   * se lleva escrito: si se navegara a la ruta de edición, este componente se
   * desmontaría.
   */
  const [liveId, setLiveId] = useState<string | undefined>(assignmentId);
  const liveIdRef = useRef<string | undefined>(assignmentId);

  const roster = useApi<{ students: RosterRow[] }>(`/api/courses/${courseId}/students`);
  const existing = useApi<AssignmentDetail>(
    assignmentId ? `/api/assignments/${assignmentId}` : null
  );

  /**
   * Plantilla de proceso.
   *
   * Se pide al servidor, que devuelve las partes ya CLONADAS con ids nuevos. No
   * se clonan aquí: si dependiera del navegador, la garantía de que dos
   * actividades no comparten claves de evidencia dependería del cliente.
   */
  const templateId = params.get('template');
  const template = useApi<{
    title: string;
    description: string;
    workflow: WorkflowStep[];
  }>(!assignmentId && templateId ? `/api/resources/${templateId}/instantiate` : null);

  const [templateApplied, setTemplateApplied] = useState(false);

  useEffect(() => {
    if (templateApplied || !template.data) return;
    setDraft((current) => ({
      ...current,
      title: current.title || template.data!.title,
      description: current.description || template.data!.description,
      parts: template.data!.workflow,
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
      dueDate: splitDueAt(loaded).date,
      dueTime: splitDueAt(loaded).time,
      resourceLinks: loaded.resourceLinks,
      assignToAll: loaded.assignedToAll,
      assignedHandles: loaded.assignedTo ?? [],
      collaborationMode: loaded.collaborationMode,
      contributionVisibility: loaded.contributionVisibility,
      groupAssignments: loaded.groupAssignments,
      resources: loaded.resources,
      // Una actividad antigua se REPRESENTA como una parte, no se convierte.
      // La parte llega sin título ni instrucciones propias —los suyos son los de
      // la actividad—, y por eso volver a guardarla la deja como estaba.
      parts: partsFromAssignment(loaded, uid),
      wasWorkflow: loaded.type === 'workflow',
      researchQuestions: loaded.researchQuestions,
    });
  }, [existing.data]);

  const patch = (changes: Partial<DraftState>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const students = roster.data?.students ?? [];
  const derived = deriveActivity({
    parts: draft.parts,
    wasWorkflow: draft.wasWorkflow,
    researchQuestions: draft.researchQuestions,
    activityTitle: draft.title,
  });
  const problems = activityProblems({ title: draft.title, parts: draft.parts });
  const blocking = blockingProblems(problems);

  /** Los campos que hay repartibles, vengan de la Parte o de la actividad. */
  const repartibleQuestions =
    draft.parts.flatMap((part) => partDeliverable(part).questions ?? []).length > 0
      ? draft.parts.flatMap((part) => partDeliverable(part).questions ?? [])
      : draft.researchQuestions;

  /**
   * Guarda y devuelve el id.
   *
   * Separado de `save` porque hay tres cosas que hacer después de guardar y sólo
   * una es «volver a la materia»: adjuntar archivos y preparar un NexLab
   * necesitan que la actividad exista, y se quedan aquí dentro.
   */
  async function persist(status: 'draft' | 'published'): Promise<string> {
    const body = {
      title: draft.title,
      description: draft.description,
      instructions: draft.instructions,
      type: derived.type,
      dueDate: draft.dueDate || null,
      /**
       * El instante se compone AQUÍ, en el navegador, porque es aquí donde se
       * conoce la zona horaria de quien pone la fecha. El servidor guarda el
       * instante que recibe y no adivina ninguna zona.
       */
      dueAt: composeDueAt(draft.dueDate, draft.dueTime),
      resourceLinks: draft.resourceLinks.filter((link) => link.url.trim()),
      researchQuestions: derived.researchQuestions,
      assignedHandles: draft.assignToAll ? null : draft.assignedHandles,
      status,
      collaborationMode: draft.collaborationMode,
      contributionVisibility: draft.contributionVisibility,
      // El reparto sólo tiene sentido si hay campos que repartir y la actividad
      // es colaborativa. En cualquier otro caso se manda vacío en vez de
      // arrastrar el de una edición anterior.
      groupAssignments:
        draft.collaborationMode === 'shared' && repartibleQuestions.length > 0
          ? draft.groupAssignments.filter((entry) => entry.assignedTo.length > 0)
          : [],
      resources: draft.resources,
      workflow: derived.workflow.map((part) => ({
        ...part,
        // El modelo habla en handles; el estado del formulario también.
        assignedHandles: part.assignedTo,
      })),
    };

    const current = liveIdRef.current;
    if (current) {
      await updateAssignment(current, body);
      return current;
    }
    const { assignment } = await createAssignment(courseId, body);
    liveIdRef.current = assignment.id;
    setLiveId(assignment.id);
    return assignment.id;
  }

  /**
   * Corrige la barra de direcciones sin navegar.
   *
   * `router.replace` desmontaría este componente y perdería el borrador en
   * memoria —qué parte está abierta, qué se estaba escribiendo—. Esto sólo hace
   * que recargar lleve a la actividad que ya existe en vez de a un formulario
   * vacío.
   *
   * Sólo se usa en los caminos que SE QUEDAN aquí. Al publicar no se toca,
   * porque después viene un `router.push` y reescribir la URL justo antes deja
   * al router del App Router desincronizado con el historial.
   */
  function rememberUrl(id: string): void {
    if (assignmentId) return;
    window.history.replaceState(null, '', `/aula/${courseId}/tareas/${id}/editar`);
  }

  async function save(status: 'draft' | 'published'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await persist(status);
      router.push(`/aula/${courseId}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? humanizeSaveError(caught.message) : 'No se pudo guardar.'
      );
      setBusy(false);
    }
  }

  /** Guarda un borrador y se queda aquí. Para adjuntar archivos. */
  async function saveDraftHere(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      rememberUrl(await persist('draft'));
    } catch (caught) {
      setError(
        caught instanceof Error ? humanizeSaveError(caught.message) : 'No se pudo guardar.'
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Abre la plantilla del laboratorio de una parte.
   *
   * Antes de abrirla se guarda un borrador, porque la plantilla cuelga de la
   * actividad Y de la parte: sin las dos guardadas el servidor no sabría de qué
   * plantilla se habla. Guardar un borrador no publica ni avisa a nadie.
   */
  async function prepareLab(part: WorkflowStep): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      rememberUrl(await persist('draft'));
      setLabPart(part);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? humanizeSaveError(caught.message)
          : 'No se pudo preparar el laboratorio.'
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * El constructor es del profesorado, y la pantalla también.
   *
   * La autorización REAL está en el servidor y no se mueve: un estudiante que
   * pidiera guardar recibe 403 aunque llegue aquí. Lo que faltaba era no
   * pintarle el formulario: `GET /api/assignments/:id` responde 200 al alumnado
   * —puede leer su actividad— así que la pantalla se montaba entera, con las
   * partes, los responsables y el botón de publicar. Verlo no le daba ningún
   * poder, pero le enseñaba una herramienta que no es suya y le dejaba escribir
   * en un formulario que iba a rechazar al final.
   *
   * Se decide con DOS señales, porque hay dos caminos: una actividad existente
   * dice quién la mira (`viewerRole`), y una actividad nueva todavía no existe,
   * así que manda la lista de la materia —que sólo el profesorado puede leer—.
   */
  const notTeacher =
    roster.state === 'error' ||
    (existing.data ? existing.data.viewerRole !== 'teacher' : false);

  const state: 'loading' | 'ready' | 'error' = notTeacher
    ? 'error'
    : assignmentId
      ? existing.state
      : roster.state;

  return (
    <AulaScreen
      state={state}
      error={
        notTeacher
          ? 'Esta pantalla es para el profesorado de la materia. Tu actividad se abre desde el aula.'
          : existing.error
      }
      next={`/aula/${courseId}`}
    >
      {/*
        Con el laboratorio abierto, el formulario de detrás sale del orden de
        tabulación. Sigue montado —para no perder nada— pero deja de ser
        alcanzable, que es lo que espera quien navega con teclado.
      */}
      <div inert={labPart ? true : undefined}>
        <Crumbs
          items={[
            { href: '/aula', label: 'Aula' },
            { href: `/aula/${courseId}`, label: 'Materia' },
            { label: assignmentId ? 'Editar actividad' : 'Nueva actividad' },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-h1">
            {assignmentId ? 'Editar actividad' : 'Nueva actividad'}
          </h1>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="btn btn-secondary btn-sm"
            aria-pressed={preview}
          >
            {preview ? '← Volver al editor' : 'Vista previa como estudiante'}
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
            className="mt-8 max-w-3xl space-y-10"
          >
            {/* 1. Lo básico ------------------------------------------------ */}
            <section aria-labelledby="basico" className="space-y-4">
              <h2 id="basico" className="section-mark font-display text-h3">
                Lo básico
              </h2>

              <Field label="Título">
                <input
                  required
                  id="activity-title"
                  value={draft.title}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="Análisis de ventas"
                  className="field"
                />
              </Field>

              <Field label="Objetivo" hint="Una o dos frases sobre qué se busca con esta actividad.">
                <textarea
                  rows={2}
                  value={draft.description}
                  onChange={(event) => patch({ description: event.target.value })}
                  placeholder="Interpretar un conjunto de datos reales y justificar una decisión."
                  className="field"
                />
              </Field>

              <Field
                label="Instrucciones generales"
                hint="Lo que hay que leer antes de empezar. Cada parte puede añadir las suyas."
              >
                <textarea
                  rows={4}
                  value={draft.instructions}
                  onChange={(event) => patch({ instructions: event.target.value })}
                  placeholder={'Trabaja con los datos del archivo adjunto.\nJustifica cada conclusión con un número.'}
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

              <p className="text-sm text-muted">{dueSummary(draft)}</p>

              <fieldset>
                <legend className="label">Quién la recibe</legend>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.assignToAll}
                    onChange={(event) => patch({ assignToAll: event.target.checked })}
                  />
                  <span className="text-sm">Todo el grupo</span>
                </label>

                {!draft.assignToAll && (
                  <div className="mt-3">
                    {students.length === 0 ? (
                      <Notice>
                        Todavía no hay nadie inscrito. Inscribe estudiantes en la pestaña
                        Estudiantes o deja la actividad para todo el grupo.
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
                              <span className="font-mono text-label text-subtle">
                                @{student.handle}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </fieldset>
            </section>

            {/* 2. Qué hará el estudiante ----------------------------------- */}
            <div>
              {!assignmentId && draft.parts.length === 0 && (
                <WorkflowTemplatePicker
                  hasSteps={false}
                  onApply={(chosen, workflow) =>
                    patch({
                      parts: workflow,
                      title: draft.title || chosen.name,
                      description: draft.description || chosen.summary,
                    })
                  }
                />
              )}

              <ActivityParts
                courseId={courseId}
                parts={draft.parts}
                students={students}
                activity={{ title: draft.title, description: draft.description }}
                assignmentId={liveId}
                onChange={(parts) => patch({ parts })}
                onPrepareLab={(part) => void prepareLab(part)}
              />
            </div>

            {/* 3. Materiales y recursos ------------------------------------ */}
            <section aria-labelledby="materiales" className="space-y-6">
              <div>
                <h2 id="materiales" className="section-mark font-display text-h3">
                  Materiales y recursos
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Lo que el estudiante <strong>consulta</strong>. No es lo que entrega: lo que
                  entrega se decide en cada Parte.
                </p>
              </div>

              <MaterialsSection
                assignmentId={liveId}
                initial={existing.data?.assignment.materials ?? []}
                busy={busy}
                onSaveDraft={() => void saveDraftHere()}
              />

              <ResourceEditor
                links={draft.resourceLinks}
                onChange={(resourceLinks) => patch({ resourceLinks })}
              />

              <ResourcePicker
                courseId={courseId}
                value={draft.resources}
                onChange={(resources) => patch({ resources })}
              />
            </section>

            {/* 5. Opciones avanzadas --------------------------------------- */}
            <section aria-labelledby="avanzadas">
              <h2 id="avanzadas" className="section-mark font-display text-h3">
                Opciones avanzadas
              </h2>
              <p className="mt-1 text-sm text-muted">
                La mayoría de las actividades no necesitan nada de aquí.
              </p>

              {!showAdvanced ? (
                <button
                  type="button"
                  onClick={() => setShowAdvanced(true)}
                  aria-expanded={false}
                  className="btn btn-ghost btn-sm mt-3"
                >
                  Mostrar opciones avanzadas
                </button>
              ) : (
                <div className="mt-4 space-y-6">
                  <fieldset>
                    <legend className="label">¿Se trabaja en grupo?</legend>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="collaboration-mode"
                          checked={draft.collaborationMode === 'individual'}
                          onChange={() => patch({ collaborationMode: 'individual' })}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            Cada estudiante la hace entera
                          </span>
                          <span className="block text-sm text-muted">Es lo normal.</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="collaboration-mode"
                          checked={draft.collaborationMode === 'shared'}
                          onChange={() => patch({ collaborationMode: 'shared' })}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            El grupo construye algo conjunto
                          </span>
                          <span className="block text-sm text-muted">
                            Repartes los conceptos y Nextudio junta las aportaciones.
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  {draft.collaborationMode === 'shared' && (
                    <>
                      {repartibleQuestions.length > 0 && (
                        <fieldset>
                          <legend className="label">Reparto de conceptos</legend>
                          <div className="mt-2">
                            <CollaborationPlanner
                              questions={repartibleQuestions}
                              students={students}
                              assignments={draft.groupAssignments}
                              onChange={(groupAssignments) => patch({ groupAssignments })}
                            />
                          </div>
                        </fieldset>
                      )}

                      <fieldset>
                        <legend className="label">Visibilidad de las aportaciones</legend>
                        <p className="hint">Tú ves siempre todo. Esto decide qué ve el grupo.</p>
                        <div className="mt-2 space-y-2">
                          {VISIBILITY_OPTIONS.map((option) => (
                            <label key={option.value} className="flex items-start gap-2">
                              <input
                                type="radio"
                                name="contribution-visibility"
                                checked={draft.contributionVisibility === option.value}
                                onChange={() =>
                                  patch({ contributionVisibility: option.value })
                                }
                                className="mt-1"
                              />
                              <span>
                                <span className="block text-sm font-medium">{option.label}</span>
                                <span className="block text-sm text-muted">{option.helper}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}
                </div>
              )}
            </section>

            {error && <Notice tone="error">{error}</Notice>}

            <ProblemList problems={problems} />

            <ActivitySummary draft={draft} derived={derived} students={students} />

            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              <button
                type="submit"
                disabled={busy || blocking.length > 0 || draft.parts.length === 0}
                className="btn btn-primary"
              >
                {busy ? 'Guardando…' : 'Publicar actividad'}
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

            {draft.parts.length === 0 && (
              <p className="text-sm text-muted">
                Para publicarla hace falta decir qué hará el estudiante. Mientras tanto puedes
                guardarla como borrador.
              </p>
            )}
          </form>
        )}
      </div>

      {labPart && liveId && (
        <NexLabTemplatePanel
          assignmentId={liveId}
          stepId={labPart.id}
          partLabel={labPart.title.trim() || draft.title || 'Laboratorio'}
          onClose={() => setLabPart(null)}
        />
      )}
    </AulaScreen>
  );
}

/**
 * Lo que falta, dicho en lenguaje de persona.
 *
 * Nunca `workflow.steps[2].deliverables[0].type invalid`. Se dice qué Parte, qué
 * campo y qué hacer, que es lo único que permite arreglarlo sin adivinar. Lo
 * `soft` no impide guardar: una actividad se construye poco a poco.
 */
function ProblemList({ problems }: { problems: ActivityProblem[] }) {
  if (problems.length === 0) return null;

  return (
    <div className="rounded-md border border-line bg-raised p-4" role="status">
      <p className="text-sm font-medium">Antes de publicar</p>
      <ul className="mt-2 space-y-1">
        {problems.map((problem, index) => (
          <li key={index} className="text-sm text-muted">
            {problem.severity === 'blocking' ? '· ' : '· '}
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Los archivos que se reparten con la actividad.
 *
 * Mientras la actividad no existe no hay dónde colgarlos, así que en vez de
 * fingir una zona de subida que no puede funcionar se ofrece el atajo honesto:
 * guardar el borrador —que no publica nada— y seguir en el mismo sitio.
 */
function MaterialsSection({
  assignmentId,
  initial,
  busy,
  onSaveDraft,
}: {
  assignmentId?: string;
  initial: AssignmentMaterial[];
  busy: boolean;
  onSaveDraft: () => void;
}) {
  const [materials, setMaterials] = useState<AssignmentMaterial[]>(initial);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || initial.length === 0) return;
    setMaterials(initial);
    setSeeded(true);
  }, [initial, seeded]);

  return (
    <fieldset>
      <legend className="label">Archivos de la actividad</legend>
      <p className="hint">
        La plantilla del reporte, los datos del ejercicio, el caso de estudio. Se descargan desde la
        actividad.
      </p>

      {assignmentId ? (
        <MaterialsList
          assignmentId={assignmentId}
          materials={materials}
          canManage
          onChange={setMaterials}
        />
      ) : (
        <div className="mt-3">
          <Notice>
            Para adjuntar archivos hace falta que la actividad exista. Guárdala como borrador y
            sigue aquí mismo: no se publica ni se avisa a nadie.
          </Notice>
          <button
            type="button"
            disabled={busy}
            onClick={onSaveDraft}
            className="btn btn-secondary btn-sm mt-3"
          >
            {busy ? 'Guardando…' : 'Guardar borrador y adjuntar archivos'}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** Enlaces que se abren directamente desde la actividad. */
function ResourceEditor({
  links,
  onChange,
}: {
  links: ResourceLink[];
  onChange: (links: ResourceLink[]) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Enlaces</legend>
      <p className="hint">Lecturas, plantillas, el archivo de Figma… Se abren desde la actividad.</p>

      <ul className="mt-3 space-y-2">
        {links.map((link, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className="sr-only">Nombre del enlace {index + 1}</span>
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
              <span className="sr-only">Dirección del enlace {index + 1}</span>
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
              aria-label={`Quitar el enlace ${index + 1}`}
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
        + Añadir enlace
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

/**
 * Cómo verá la actividad un estudiante.
 *
 * Lee sólo el borrador en memoria y NO llama a ninguna API. No crea entrega, no
 * crea instancia, no cambia propietario, no escribe progreso, no altera fechas y
 * no ejecuta ninguna acción académica. El laboratorio de una parte no se monta
 * aquí: montarlo pediría al servidor la plantilla, y una vista previa no debería
 * crear nada. Se describe en su lugar.
 */
function TeacherPreview({ draft, students }: { draft: DraftState; students: RosterRow[] }) {
  const parts = draft.parts;

  return (
    <article className="mt-8 max-w-3xl rounded-md border-2 border-dashed border-accent/40 bg-raised/60 p-6">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
        Vista previa · Así lo verá el estudiante
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

      {draft.resourceLinks.filter((link) => link.url.trim()).length > 0 && (
        <section className="mt-8">
          <h3 className="font-display text-h3">Materiales</h3>
          <ul className="mt-3 space-y-2">
            {draft.resourceLinks
              .filter((link) => link.url.trim())
              .map((link, index) => (
                <li key={index}>
                  <span className="btn btn-secondary btn-sm">{link.label || link.url} ↗</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {parts.length > 0 && (
        <section className="mt-8">
          <h3 className="font-display text-h3">
            {parts.length === 1 ? 'Qué hay que hacer' : 'Las partes'}
          </h3>
          {parts.length > 1 && (
            <p className="mt-1 text-sm text-muted">
              Esta actividad tiene {parts.length} partes.
            </p>
          )}
          <ol className="mt-4 space-y-2">
            {parts.map((part, index) => {
              const deliverable = partDeliverable(part);
              const blockedBy = part.dependsOnStepIds
                .map((id) => {
                  const dependency = parts.find((other) => other.id === id);
                  return dependency
                    ? dependency.title || `Parte ${parts.indexOf(dependency) + 1}`
                    : null;
                })
                .filter(Boolean);

              return (
                <li key={part.id} className="panel flex flex-wrap items-start gap-3 p-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {part.title || draft.title || `Parte ${index + 1}`}
                    </span>
                    <span className="block text-label text-subtle">
                      {partActionLabel(part)}
                      {part.tool.toolNames.length > 0 && ` · ${part.tool.toolNames.join(', ')}`}
                      {!part.required && ' · opcional'}
                    </span>
                    {part.instructions && (
                      <span className="mt-1 block whitespace-pre-line text-sm text-muted">
                        {part.instructions}
                      </span>
                    )}
                    {deliverable.hint && (
                      <span className="mt-1 block text-sm text-muted">{deliverable.hint}</span>
                    )}
                    {deliverable.type === 'nexbook' && (
                      <span className="mt-1 block text-label text-subtle">
                        Se abrirá un NexLab con la plantilla que prepares. Los bloques marcados
                        como no editables se leen pero no se tocan.
                      </span>
                    )}
                    {deliverable.type === 'ai_worklog' && (
                      <span className="mt-1 block text-label text-subtle">
                        Conclusión:{' '}
                        {deliverable.conclusionMode === 'required'
                          ? 'obligatoria para entregar'
                          : deliverable.conclusionMode === 'none'
                            ? 'no se pide'
                            : 'opcional'}
                      </span>
                    )}
                    {deliverable.type === 'code' && (
                      <span className="mt-1 block text-label text-subtle">
                        {deliverable.language} ·{' '}
                        {deliverable.executionEnabled ? 'puede ejecutarlo' : 'sin ejecución'}
                      </span>
                    )}
                    {part.prompt?.mode === 'inline' && (
                      <span className="mt-2 block whitespace-pre-wrap rounded-sm border border-line bg-sunken p-2 font-mono text-sm">
                        {part.prompt.text}
                      </span>
                    )}
                    {part.prompt?.mode === 'library' && (
                      <span className="mt-1 block text-label text-subtle">
                        Prompt de la biblioteca: {part.prompt.title || 'sin título'}
                      </span>
                    )}
                    {blockedBy.length > 0 && (
                      <span className="mt-1 block text-label text-subtle">
                        Se desbloquea después de: {blockedBy.join(', ')}
                      </span>
                    )}
                    {part.assignedTo && part.assignedTo.length > 0 && (
                      <span className="mt-1 block text-label text-subtle">
                        La hacen: {part.assignedTo.join(', ')}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <button
          type="button"
          disabled
          className="btn btn-primary cursor-not-allowed opacity-50"
          title="Vista previa — no crea ninguna entrega"
        >
          Comenzar actividad (vista previa)
        </button>
        <p className="mt-2 text-xs text-subtle">
          En vista previa el botón no hace nada y no se crea ninguna entrega. El estudiante sí verá
          el botón real.
        </p>
      </div>

      {students.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {draft.assignToAll
            ? `Se asignará a todo el grupo (${students.length} estudiante${students.length !== 1 ? 's' : ''})`
            : draft.assignedHandles.length > 0
              ? `Asignada a ${draft.assignedHandles.length} estudiante${draft.assignedHandles.length !== 1 ? 's' : ''}`
              : 'Sin estudiantes asignados aún'}
        </p>
      )}
    </article>
  );
}

/** Resumen compacto justo antes de publicar. */
function ActivitySummary({
  draft,
  derived,
  students,
}: {
  draft: DraftState;
  derived: ReturnType<typeof deriveActivity>;
  students: RosterRow[];
}) {
  if (draft.title.trim().length < 3) return null;

  const parts = draft.parts;
  const optional = parts.filter((part) => !part.required);
  const tools = Array.from(new Set(parts.flatMap((part) => part.tool.toolNames))).filter(Boolean);
  const kinds = Array.from(new Set(parts.map((part) => partActionLabel(part))));
  const assignedCount = draft.assignToAll ? students.length : draft.assignedHandles.length;
  const linkCount = draft.resourceLinks.filter((link) => link.url.trim()).length;

  return (
    <section
      aria-label="Resumen de la actividad"
      className="max-w-3xl rounded-md border border-line bg-raised p-5"
    >
      <h2 className="text-sm font-semibold text-fg">{draft.title}</h2>
      {draft.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted">{draft.description}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-label text-subtle">Partes</dt>
          <dd className="font-medium">
            {parts.length}
            {optional.length > 0 && (
              <span className="ml-1 font-normal text-muted">
                ({optional.length} opcional{optional.length !== 1 ? 'es' : ''})
              </span>
            )}
          </dd>
        </div>

        {kinds.length > 0 && (
          <div>
            <dt className="text-label text-subtle">Qué se entrega</dt>
            <dd className="font-medium">{kinds.join(' · ')}</dd>
          </div>
        )}

        {tools.length > 0 && (
          <div>
            <dt className="text-label text-subtle">Herramientas</dt>
            <dd className="font-medium">{tools.join(' · ')}</dd>
          </div>
        )}

        {linkCount > 0 && (
          <div>
            <dt className="text-label text-subtle">Enlaces</dt>
            <dd className="font-medium">
              {linkCount} enlace{linkCount !== 1 ? 's' : ''}
            </dd>
          </div>
        )}

        {students.length > 0 && (
          <div>
            <dt className="text-label text-subtle">Quién la recibe</dt>
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

      {/*
        La forma guardada se enseña, pero como nota al pie y en lenguaje llano:
        es útil saber que una actividad de una parte se sigue guardando como lo
        que era, sin que eso sea una decisión que haya que tomar.
      */}
      <p className="mt-4 text-label text-subtle">
        {derived.workflow.length === 0
          ? 'Se guardará en su forma sencilla de siempre.'
          : `Se guardará como una actividad de ${derived.workflow.length} parte${derived.workflow.length !== 1 ? 's' : ''}.`}
      </p>
    </section>
  );
}
