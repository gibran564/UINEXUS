import { LEGACY_STEP_ID } from './types';
import { detectTextFormat, normalizeAIResult } from './ai-worklog';
import type {
  AIWorklogData,
  AssignmentRecord,
  AssignmentType,
  DeliverableType,
  ResearchQuestion,
  StepDeliverable,
  StepEvidence,
  StepPrompt,
  StepToolChoice,
  SubmissionData,
  SubmissionRecord,
  WorkflowStepRecord,
  TextFormat,
} from './types';

/**
 * El workflow académico: normalización, permisos y progreso.
 *
 * Módulo PURO a propósito —sin red, sin `server-only`— por dos razones: la
 * regla que decide quién puede trabajar en qué paso tiene que poder leerse
 * entera y probarse sin nube, y el constructor del navegador necesita las
 * mismas funciones para no pintar pasos que el servidor va a rechazar.
 *
 * ## La estrategia de compatibilidad, en una frase
 *
 * Una tarea anterior a la iteración 4 se LEE como un workflow de un solo paso.
 * No se migra ningún registro: `synthesizeLegacyStep()` deriva ese paso de los
 * campos que la tarea ya tenía, y `LEGACY_STEP_ID` es constante para que la
 * evidencia de las entregas viejas siga encontrándose siempre en el mismo
 * sitio. Todo lo que hay aguas arriba puede recorrer `workflow` sin
 * preguntarse nunca si la tarea es antigua.
 */

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const EMPTY_TOOL: StepToolChoice = { mode: 'none', toolIds: [], toolNames: [] };

const EMPTY_PROMPT: StepPrompt = { mode: 'none', title: '', text: '', resourceId: null };

/**
 * El prompt de un paso, siempre presente al leer.
 *
 * Un paso guardado antes de que existiera el campo no tiene ninguno, y eso es
 * exactamente «este paso no usa prompt»: no hay nada que migrar. Un `inline`
 * sin texto o un `library` sin recurso se leen también como `none`, para que
 * nadie aguas abajo tenga que comprobar las dos cosas por separado.
 */
export function normalizeStepPrompt(raw: Partial<StepPrompt> | undefined): StepPrompt {
  const prompt: StepPrompt = {
    mode: raw?.mode ?? 'none',
    title: raw?.title ?? '',
    text: raw?.text ?? '',
    resourceId: raw?.resourceId ?? null,
  };

  if (prompt.mode === 'inline' && !prompt.text.trim()) return { ...prompt, mode: 'none' };
  if (prompt.mode === 'library' && !prompt.resourceId) return { ...prompt, mode: 'none' };
  return prompt;
}

/** ¿Este paso trae un prompt que enseñarle a alguien? */
export function hasStepPrompt(step: { prompt?: Partial<StepPrompt> }): boolean {
  return normalizeStepPrompt(step.prompt).mode !== 'none';
}

/** Las referencias a prompts de biblioteca que usan los pasos. */
export function stepPromptRefs(
  workflow: readonly { prompt?: Partial<StepPrompt> }[]
): { kind: 'prompt'; id: string }[] {
  return workflow.flatMap((step) => {
    const prompt = normalizeStepPrompt(step.prompt);
    return prompt.mode === 'library' && prompt.resourceId
      ? [{ kind: 'prompt' as const, id: prompt.resourceId }]
      : [];
  });
}

export function normalizeDeliverable(raw: Partial<StepDeliverable>): StepDeliverable {
  return {
    type: raw.type ?? 'none',
    required: raw.required ?? true,
    hint: raw.hint ?? '',
    questions: raw.questions ?? [],
  };
}

export function normalizeStep(
  raw: Partial<WorkflowStepRecord>,
  index: number
): WorkflowStepRecord {
  return {
    id: raw.id ?? `step-${index + 1}`,
    order: raw.order ?? index,
    title: raw.title ?? '',
    description: raw.description ?? '',
    instructions: raw.instructions ?? '',
    actionType: raw.actionType ?? 'instruction',
    tool: raw.tool ? { ...EMPTY_TOOL, ...raw.tool } : EMPTY_TOOL,
    resources: raw.resources ?? [],
    prompt: normalizeStepPrompt(raw.prompt),
    deliverables: (raw.deliverables ?? []).map(normalizeDeliverable),
    required: raw.required ?? true,
    assignedTo: raw.assignedTo ?? null,
    dependsOnStepIds: raw.dependsOnStepIds ?? [],
  };
}

/**
 * Rechaza workflows cuyas dependencias formen un ciclo.
 *
 * Es una regla pura y estructural: sólo necesita los ids de los pasos y sus
 * dependencias, por lo que puede reutilizarse en la validación de tareas y de
 * plantillas antes de persistirlas. Una referencia a un paso ausente no se
 * considera un ciclo; esa es una invariante distinta.
 */
export function assertAcyclicWorkflow(
  steps: readonly Pick<WorkflowStepRecord, 'id' | 'dependsOnStepIds'>[]
): void {
  const dependenciesById = new Map(
    steps.map((step) => [step.id, step.dependsOnStepIds] as const)
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) {
      throw new Error('El workflow contiene dependencias cíclicas.');
    }
    if (visited.has(stepId)) return;

    visiting.add(stepId);
    for (const dependencyId of dependenciesById.get(stepId) ?? []) {
      if (dependenciesById.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };

  for (const stepId of dependenciesById.keys()) visit(stepId);
}

/**
 * Cómo se traduce cada tipo antiguo a un paso.
 *
 * El mapeo dice lo que la tarea YA era, no lo que nos gustaría que fuese: una
 * tarea `ai_worklog` era exactamente «usa una IA y documéntalo», así que su
 * paso pide un AI Worklog y deja la herramienta libre, que es lo que permitía
 * antes.
 */
const LEGACY_STEP: Readonly<
  Record<AssignmentType, { action: string; deliverable: DeliverableType; toolMode: StepToolChoice['mode'] }>
> = {
  research: { action: 'structured_response', deliverable: 'structured', toolMode: 'none' },
  ai_worklog: { action: 'ai_interaction', deliverable: 'ai_worklog', toolMode: 'free' },
  web_project: { action: 'project', deliverable: 'project', toolMode: 'none' },
  external_link: { action: 'link_submission', deliverable: 'url', toolMode: 'free' },
  freeform: { action: 'text_response', deliverable: 'text', toolMode: 'none' },
  // Una tarea `workflow` sin pasos guardados no debería existir; si aparece, se
  // trata como una instrucción suelta en vez de romper la pantalla.
  workflow: { action: 'instruction', deliverable: 'none', toolMode: 'none' },
};

/** El paso único que representa una tarea anterior a la iteración 4. */
export function synthesizeLegacyStep(assignment: {
  type: AssignmentType;
  title: string;
  description: string;
  instructions: string;
  researchQuestions: ResearchQuestion[];
  resources: AssignmentRecord['resources'];
}): WorkflowStepRecord {
  const shape = LEGACY_STEP[assignment.type] ?? LEGACY_STEP.freeform;

  return {
    id: LEGACY_STEP_ID,
    order: 0,
    title: assignment.title,
    description: assignment.description,
    instructions: assignment.instructions,
    actionType: shape.action,
    tool: { ...EMPTY_TOOL, mode: shape.toolMode },
    resources: assignment.resources,
    prompt: EMPTY_PROMPT,
    deliverables: [
      {
        type: shape.deliverable,
        required: true,
        hint: '',
        // Los campos de una investigación viven en la tarea, no en el paso. Se
        // referencian aquí para que el formulario los encuentre por el mismo
        // camino que en una tarea nueva.
        questions: shape.deliverable === 'structured' ? assignment.researchQuestions : [],
      },
    ],
    required: true,
    assignedTo: null,
    dependsOnStepIds: [],
  };
}

/**
 * Los pasos de una tarea, siempre al menos uno.
 *
 * Si no hay pasos guardados se sintetiza el legado. Si los hay, se ordenan por
 * `order`: el orden es dato, no el índice del array, para que reordenar en el
 * constructor no dependa de cómo llegó la lista.
 */
export function normalizeWorkflow(
  raw: Partial<AssignmentRecord>,
  fallback: Parameters<typeof synthesizeLegacyStep>[0]
): WorkflowStepRecord[] {
  const stored = raw.workflow ?? [];
  if (stored.length === 0) return [synthesizeLegacyStep(fallback)];

  return stored
    .map((step, index) => normalizeStep(step, index))
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index }));
}

/** ¿Es una tarea de un solo paso? Decide si la UX esconde el workflow (§20). */
export function isSingleStep(assignment: { workflow: readonly unknown[] }): boolean {
  return assignment.workflow.length <= 1;
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export function normalizeEvidence(
  raw: Partial<StepEvidence>,
  stepId: string
): StepEvidence {
  return {
    stepId: raw.stepId ?? stepId,
    toolId: raw.toolId ?? null,
    toolName: raw.toolName ?? '',
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    data: raw.data ?? ({} as SubmissionData),
    note: raw.note ?? '',
  };
}

/**
 * La evidencia de una entrega, indexada por paso.
 *
 * Una entrega anterior a la iteración 4 sólo tiene `data`. Se envuelve bajo
 * `LEGACY_STEP_ID`, que es justo el id que `synthesizeLegacyStep` le da al paso
 * único: por eso encajan sin que nadie migre nada.
 */
export function normalizeStepEvidence(
  raw: Partial<SubmissionRecord>
): Record<string, StepEvidence> {
  const stored = raw.stepEvidence;

  if (stored && Object.keys(stored).length > 0) {
    return Object.fromEntries(
      Object.entries(stored).map(([stepId, evidence]) => [
        stepId,
        normalizeEvidence(evidence, stepId),
      ])
    );
  }

  if (!raw.data) return {};

  return {
    [LEGACY_STEP_ID]: normalizeEvidence(
      { data: raw.data, completedAt: raw.submittedAt ?? null },
      LEGACY_STEP_ID
    ),
  };
}

/**
 * Campos que NO cuentan como contenido escrito.
 *
 * Son identificadores estructurales (`questionId`) y valores que los esquemas
 * rellenan solos (`provider` por defecto es «Other», `kind` por defecto es
 * «file»). Sin esta lista, un formulario que nadie tocó parecería relleno:
 * un AI Worklog en blanco llega con `provider: 'Other'`, y una respuesta
 * estructurada vacía llega con sus `questionId` puestos.
 */
const STRUCTURAL_KEYS = new Set(['questionId', 'stepId', 'id', 'kind', 'provider', 'format']);

/** ¿Hay algo escrito en esta evidencia? Vacío no cuenta como hecho. */
export function hasContent(evidence: StepEvidence | undefined): boolean {
  if (!evidence) return false;
  const data = evidence.data as unknown as Record<string, unknown>;

  const written = (key: string, value: unknown): boolean => {
    if (STRUCTURAL_KEYS.has(key)) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) {
      return value.some((item) =>
        typeof item === 'object' && item !== null
          ? Object.entries(item).some(([innerKey, inner]) => written(innerKey, inner))
          : Boolean(item)
      );
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).some(([innerKey, inner]) => written(innerKey, inner));
    }
    return false;
  };

  for (const [key, value] of Object.entries(data ?? {})) {
    if (written(key, value)) return true;
  }

  return Boolean(evidence.toolName.trim() || evidence.note.trim());
}

// ---------------------------------------------------------------------------
// Permisos y progreso
// ---------------------------------------------------------------------------

/**
 * ¿Puede esta persona trabajar en este paso?
 *
 * Misma semántica que en el resto del aula, y no por casualidad: la ausencia de
 * restricción significa «para todos», nunca «para nadie». Un paso sin
 * responsables lo hace quien tenga la tarea; un olvido al repartir deja el paso
 * abierto —se nota y se arregla— en vez de dejarlo bloqueado sin que nadie
 * entienda por qué.
 */
export function canWorkOnStep(
  step: Pick<WorkflowStepRecord, 'assignedTo'>,
  uid: string
): boolean {
  if (step.assignedTo === null || step.assignedTo.length === 0) return true;
  return step.assignedTo.includes(uid);
}

/** Los ids de paso que esta persona puede rellenar. */
export function workableStepIds(
  workflow: readonly WorkflowStepRecord[],
  uid: string
): Set<string> {
  return new Set(
    workflow.filter((step) => canWorkOnStep(step, uid)).map((step) => step.id)
  );
}

export type StepState = 'locked' | 'pending' | 'done';

/**
 * Estado de un paso para quien lo mira.
 *
 * `locked` sólo aparece cuando el paso declara dependencias y alguna sigue sin
 * completarse. Por defecto NO se bloquea nada: §22 pide dependencias, no una
 * cadena rígida, y un paso bloqueado por error deja a alguien sin poder
 * avanzar sin saber qué le falta.
 */
export function stepState(
  step: WorkflowStepRecord,
  evidence: Record<string, StepEvidence>
): StepState {
  if (hasContent(evidence[step.id])) return 'done';

  const blocked = step.dependsOnStepIds.some((id) => !hasContent(evidence[id]));
  return blocked ? 'locked' : 'pending';
}

export interface WorkflowProgress {
  total: number;
  done: number;
  /** Sólo los obligatorios: es lo que decide si la tarea puede entregarse. */
  requiredTotal: number;
  requiredDone: number;
}

export function workflowProgress(
  workflow: readonly WorkflowStepRecord[],
  evidence: Record<string, StepEvidence>,
  uid?: string
): WorkflowProgress {
  // Con `uid`, el progreso es el de esa persona: sus pasos, no los del grupo.
  const mine = uid ? workflow.filter((step) => canWorkOnStep(step, uid)) : workflow;

  const done = mine.filter((step) => hasContent(evidence[step.id])).length;
  const required = mine.filter((step) => step.required);

  return {
    total: mine.length,
    done,
    requiredTotal: required.length,
    requiredDone: required.filter((step) => hasContent(evidence[step.id])).length,
  };
}

/** ¿Está la tarea lista para entregarse? Todos los pasos obligatorios propios. */
export function canSubmitWorkflow(
  workflow: readonly WorkflowStepRecord[],
  evidence: Record<string, StepEvidence>,
  uid: string
): boolean {
  const progress = workflowProgress(workflow, evidence, uid);
  return progress.requiredDone >= progress.requiredTotal;
}

/**
 * Cuántas personas completaron cada paso (§34).
 *
 * Se cuenta sobre la audiencia REAL del paso: si el paso 2 es sólo de Pedro, el
 * marcador es «1 de 1» y no «1 de 31». Decir lo contrario haría que el panel
 * pareciera atrasado cuando en realidad está al día.
 */
export function stepCompletion(
  step: WorkflowStepRecord,
  audience: readonly { uid: string }[],
  evidenceByUid: Map<string, Record<string, StepEvidence>>
): { assigned: number; done: number } {
  const responsible = audience.filter((member) => canWorkOnStep(step, member.uid));
  const done = responsible.filter((member) =>
    hasContent(evidenceByUid.get(member.uid)?.[step.id])
  ).length;

  return { assigned: responsible.length, done };
}

// ---------------------------------------------------------------------------
// Utilidades para el DTO
// ---------------------------------------------------------------------------

/** El primer entregable del paso, que es el que rellena el formulario. */
export function primaryDeliverable(step: {
  deliverables: readonly StepDeliverable[];
}): StepDeliverable {
  return step.deliverables[0] ?? { type: 'none', required: false, hint: '', questions: [] };
}

/**
 * Los pasos obligatorios que le faltan a esta persona.
 *
 * Se devuelven los pasos y no un número porque el formulario dice exactamente
 * cuáles faltan. «Te faltan 2 pasos» obliga a buscarlos; «te falta el paso 3,
 * Miro» no.
 *
 * No hay una máquina de estados nueva por paso: el ciclo de vida sigue siendo el
 * de `Submission` (`draft → submitted → reviewed / needs_changes`). Lo que
 * aporta el workflow es cuánto se lleva hecho dentro del borrador.
 */
export function missingRequiredSteps(
  workflow: readonly WorkflowStepRecord[],
  evidence: Record<string, StepEvidence>,
  uid: string
): WorkflowStepRecord[] {
  return workflow.filter(
    (step) => step.required && canWorkOnStep(step, uid) && !hasContent(evidence[step.id])
  );
}

// ---------------------------------------------------------------------------
// Plantillas reutilizables
// ---------------------------------------------------------------------------

/**
 * Genera un identificador de paso. Se inyecta para poder probar el clonado con
 * valores deterministas en vez de depender del azar.
 */
export type IdFactory = () => string;

const randomStepId: IdFactory = () => Math.random().toString(36).slice(2, 10);

/**
 * Clona los pasos de una plantilla para una tarea nueva.
 *
 * ## Por qué los identificadores TIENEN que cambiar
 *
 * La evidencia de una entrega se indexa por `stepId`
 * (`Submission.stepEvidence`). Si dos tareas creadas desde la misma plantilla
 * conservaran los ids de la plantilla, compartirían claves: lo que alguien
 * escribiera en el paso «Perplexity» de la primera tarea aparecería como
 * escrito en el paso «Perplexity» de la segunda. No es un detalle estético; es
 * corrupción silenciosa de trabajo académico.
 *
 * ## Lo que se remapea
 *
 * Las dependencias apuntan a ids de paso, así que hay que traducirlas al mismo
 * tiempo. Una dependencia que apunte a un paso que no está en la plantilla se
 * descarta: dejarla apuntando al id viejo bloquearía ese paso para siempre sin
 * que se viera por qué.
 *
 * ## Lo que se limpia
 *
 * `assignedTo` se vacía. Una plantilla puede reutilizarse en otra materia, y
 * los UID de los responsables de la primera no existen en la segunda: copiarlos
 * produciría pasos asignados a gente que no está en el grupo. Repartir es una
 * decisión de cada tarea, no de la plantilla.
 *
 * ## Lo que NO se toca
 *
 * Los `id` de las preguntas de un entregable estructurado se conservan. No
 * colisionan: las respuestas viven dentro de la evidencia de SU paso, y los
 * pasos ya tienen ids distintos.
 */
export function cloneWorkflowSteps(
  steps: readonly WorkflowStepRecord[],
  newId: IdFactory = randomStepId
): WorkflowStepRecord[] {
  const idByOldId = new Map(steps.map((step) => [step.id, newId()]));

  return steps.map((step, index) => ({
    ...step,
    id: idByOldId.get(step.id)!,
    order: index,
    dependsOnStepIds: step.dependsOnStepIds.flatMap((oldId) => {
      const mapped = idByOldId.get(oldId);
      return mapped ? [mapped] : [];
    }),
    assignedTo: null,
    // Se copian en profundidad las partes que el editor va a mutar. Sin esto,
    // editar la tarea nueva cambiaría también la plantilla de la que salió.
    tool: { ...step.tool, toolIds: [...step.tool.toolIds], toolNames: [...step.tool.toolNames] },
    resources: [...step.resources],
    prompt: { ...normalizeStepPrompt(step.prompt) },
    deliverables: step.deliverables.map((deliverable) => ({
      ...deliverable,
      questions: deliverable.questions.map((question) => ({ ...question })),
    })),
  }));
}

export interface AvailableDependencyResult {
  stepId: string;
  title: string;
  content: string;
  format: TextFormat;
}

/**
 * Resultados textuales propios que el paso actual puede reutilizar.
 *
 * Cada dependencia permanece separada y nada se envía a servicios externos.
 * La persona decide qué abre y qué copia. Por ahora cubre el formato canónico
 * de AI Worklog y las respuestas de texto libre.
 */
export function availableDependencyResults(
  workflow: readonly WorkflowStepRecord[],
  step: Pick<WorkflowStepRecord, 'dependsOnStepIds'>,
  evidence: Record<string, StepEvidence>
): AvailableDependencyResult[] {
  const byId = new Map(workflow.map((item) => [item.id, item]));

  return step.dependsOnStepIds.flatMap((stepId) => {
    const dependency = byId.get(stepId);
    const stored = evidence[stepId];
    if (!dependency || !stored) return [];

    const deliverable = primaryDeliverable(dependency);
    if (deliverable.type === 'ai_worklog') {
      const result = normalizeAIResult(stored.data as AIWorklogData);
      return result.content
        ? [{ stepId, title: dependency.title, content: result.content, format: result.format }]
        : [];
    }

    if (deliverable.type === 'text') {
      const content = (stored.data as { text?: unknown }).text;
      if (typeof content !== 'string' || !content) return [];
      return [
        {
          stepId,
          title: dependency.title,
          content,
          format: detectTextFormat(content),
        },
      ];
    }

    return [];
  });
}

/**
 * Los pasos de una plantilla, ya normalizados.
 *
 * Una plantilla guardada antes de que existiera este campo —o de un tipo que no
 * es `workflow`— devuelve lista vacía en vez de romper.
 */
export function templateSteps(resource: {
  type: string;
  workflowSteps?: readonly Partial<WorkflowStepRecord>[];
}): WorkflowStepRecord[] {
  if (resource.type !== 'workflow') return [];
  return (resource.workflowSteps ?? []).map((step, index) => normalizeStep(step, index));
}
