import { DEFAULT_CODE_MODE, DEFAULT_PROGRAMMING_LANGUAGE } from './constants';
import type {
  AssignmentType,
  DeliverableType,
  NexBookConclusionMode,
  ResearchQuestion,
  StepDeliverable,
  WorkflowStep,
} from './types';

/**
 * La traducción entre lo que el profesorado quiere pedir y el modelo académico.
 *
 * ## Por qué existe este archivo
 *
 * El constructor anterior le pedía a quien crea una actividad que pensara en
 * `actionType`, `deliverableType` y «¿cuántos pasos tendrá?». Eso es el modelo
 * hablando, no la persona. Aquí vive la otra dirección: un catálogo de
 * INTENCIONES humanas —«responder», «trabajar en laboratorio»— y la función
 * determinista que las convierte en `WorkflowStep`.
 *
 * El motor no cambia. `Workflow`, `WorkflowStep`, `StepDeliverable`,
 * `StepPrompt`, `StepToolChoice`, `dependsOnStepIds` y `assignedTo` siguen
 * siendo exactamente lo que eran, y el runner del alumnado sigue leyendo lo
 * mismo. Lo que cambia es quién decide esos valores: antes un `<select>`, ahora
 * una traducción probada.
 *
 * ## Por qué es un módulo puro
 *
 * Sin React y sin red. Las reglas que de verdad importan —qué produce cada
 * opción, cuándo una actividad se guarda en su forma antigua, qué pasa al
 * borrar una parte de la que depende otra— se pueden probar una por una, y no
 * a través de la interfaz. Es también lo que permite que la misma regla la
 * apliquen el editor y la vista previa sin duplicarla.
 */

// ---------------------------------------------------------------------------
// El catálogo humano
// ---------------------------------------------------------------------------

/**
 * Lo que se le pregunta a quien crea la actividad: ¿qué debe hacer el
 * estudiante? Son intenciones, no tipos del backend.
 */
export type ActivityActionId =
  | 'respond'
  | 'evidence'
  | 'code'
  | 'lab'
  | 'ai'
  | 'project'
  | 'instruction'
  /** Lo que una actividad antigua pedía y ya no se ofrece de entrada. */
  | 'legacy';

/**
 * La concreción de una intención, cuando hace falta.
 *
 * «Entregar archivo o evidencia» no se parte en cuatro botones de primer nivel:
 * primero se elige la intención y después, si acaso, el formato. «Responder»
 * tiene dos formas y ninguna merece su propia tarjeta.
 */
export interface ActivityVariant {
  id: string;
  label: string;
  helper: string;
  deliverable: DeliverableType;
}

export interface ActivityAction {
  id: ActivityActionId;
  label: string;
  /** Una frase sobre lo que el estudiante acabará haciendo. */
  helper: string;
  /** Qué `actionType` del modelo escribe. Ver `StepActionType`. */
  actionType: string;
  /** Entregable por defecto: el de la primera variante. */
  variants: readonly ActivityVariant[];
}

/**
 * Las siete opciones de primer nivel.
 *
 * El orden es el de la frecuencia esperada en una materia, no el del enum.
 * `legacy` no está aquí: no es algo que se pueda elegir, es cómo se etiqueta lo
 * que ya existía.
 */
export const ACTIVITY_ACTIONS: readonly ActivityAction[] = [
  {
    id: 'respond',
    label: 'Responder',
    helper: 'El estudiante escribe su respuesta dentro de Nextudio.',
    actionType: 'text_response',
    variants: [
      {
        id: 'text',
        label: 'Una respuesta escrita',
        helper: 'Un texto libre. Lo más habitual.',
        deliverable: 'text',
      },
      {
        id: 'structured',
        label: 'Campos que tú defines',
        helper: 'Conceptos, definiciones, fuentes… cada uno en su campo.',
        deliverable: 'structured',
      },
    ],
  },
  {
    id: 'evidence',
    label: 'Entregar archivo o evidencia',
    helper: 'El estudiante sube algo que hizo, o enlaza dónde lo hizo.',
    actionType: 'upload',
    variants: [
      {
        id: 'file',
        label: 'Archivo',
        helper: 'Un documento, una hoja, un PDF.',
        deliverable: 'file',
      },
      { id: 'image', label: 'Imagen', helper: 'Una captura, un diagrama, una foto.', deliverable: 'image' },
      { id: 'video', label: 'Video', helper: 'Grabado o generado. Se entrega el enlace.', deliverable: 'video' },
      {
        id: 'link',
        label: 'Enlace',
        helper: 'Figma, Miro, un documento compartido.',
        deliverable: 'url',
      },
    ],
  },
  {
    id: 'code',
    label: 'Programar — NexCode',
    helper: 'El estudiante escribe un programa y lo entrega.',
    actionType: 'code',
    variants: [
      { id: 'code', label: 'Programa', helper: '', deliverable: 'code' },
    ],
  },
  {
    id: 'lab',
    label: 'Trabajar en laboratorio — NexLab',
    helper: 'Texto, datos, código y resultados en un mismo documento.',
    actionType: 'code',
    variants: [
      { id: 'nexbook', label: 'Laboratorio', helper: '', deliverable: 'nexbook' },
    ],
  },
  {
    id: 'ai',
    label: 'Registrar uso de IA — NexIA',
    helper: 'El estudiante documenta cómo usó una IA. Nextudio no ejecuta la IA.',
    actionType: 'ai_interaction',
    variants: [
      { id: 'ai_worklog', label: 'Registro de uso de IA', helper: '', deliverable: 'ai_worklog' },
    ],
  },
  {
    id: 'project',
    label: 'Entregar proyecto',
    helper: 'Se entrega un proyecto ya publicado en Nextudio. Se referencia, no se duplica.',
    actionType: 'project',
    variants: [
      { id: 'project', label: 'Proyecto', helper: '', deliverable: 'project' },
    ],
  },
  {
    id: 'instruction',
    label: 'Continuar proceso',
    helper: 'Algo que leer o hacer antes de seguir. No pide entrega.',
    actionType: 'instruction',
    variants: [
      { id: 'none', label: 'Sin entrega', helper: '', deliverable: 'none' },
    ],
  },
];

/**
 * Cómo se etiqueta lo que una actividad antigua pedía y ya no se ofrece.
 *
 * NO se elimina del modelo y NO se convierte al abrir: `resource_reference`
 * sigue siendo un entregable válido, sólo que deja de merecer una tarjeta de
 * primer nivel. Ver `actionForPart`.
 */
export const LEGACY_DELIVERABLE_LABEL: Readonly<Partial<Record<DeliverableType, string>>> = {
  resource_reference: 'Elegir recursos de la materia',
};

export function actionById(id: ActivityActionId): ActivityAction | undefined {
  return ACTIVITY_ACTIONS.find((action) => action.id === id);
}

// ---------------------------------------------------------------------------
// Intención → modelo
// ---------------------------------------------------------------------------

/** Modo de herramienta con el que nace cada intención. */
const DEFAULT_TOOL_MODE: Readonly<Record<ActivityActionId, WorkflowStep['tool']['mode']>> = {
  respond: 'none',
  // Entregar algo hecho fuera admite cualquier herramienta: el estudiante
  // escribe cuál usó y queda en la evidencia.
  evidence: 'free',
  code: 'none',
  lab: 'none',
  /**
   * Quien documenta su uso de IA usó la que usó. Obligar a elegir de una lista
   * de la docente convierte el registro en una ficción, y además es lo que la
   * lectura de las actividades antiguas ya hacía (`LEGACY_TOOL_MODE`): con el
   * mismo valor, una actividad de esta clase se sigue guardando como antes.
   */
  ai: 'free',
  project: 'none',
  instruction: 'none',
  legacy: 'none',
};

export interface NewPartOptions {
  action: ActivityActionId;
  /** Id de la variante. Si falta, la primera de la intención. */
  variant?: string;
  id: string;
  order: number;
  /**
   * El título de la parte. VACÍO por defecto, y eso importa.
   *
   * Una actividad de una sola parte no necesita dos títulos: el de la actividad
   * ya nombra lo que hay que hacer. Y además, una parte con título propio no
   * cabe en la representación antigua (`legacyEquivalent`), así que ponerle uno
   * por defecto convertiría en proceso hasta la actividad más sencilla.
   *
   * Cuando hay varias partes sí hace falta nombrarlas, y quien las añade lo hace
   * explícitamente: ver `titleForNewPart`.
   */
  title?: string;
}

/**
 * Una parte nueva, ya en el modelo.
 *
 * Todos los campos se escriben explícitamente. Nada de `{ ...preset }`: una
 * parte a medio rellenar que heredara campos de otro sitio sería imposible de
 * razonar al leerla después.
 */
export function makePart({ action, variant, id, order, title }: NewPartOptions): WorkflowStep {
  const catalog = actionById(action);
  const chosen =
    catalog?.variants.find((item) => item.id === variant) ?? catalog?.variants[0] ?? null;

  return {
    id,
    order,
    title: title ?? '',
    description: '',
    instructions: '',
    actionType: catalog?.actionType ?? 'instruction',
    tool: { mode: DEFAULT_TOOL_MODE[action], toolIds: [], toolNames: [] },
    resources: [],
    prompt: { mode: 'none', title: '', text: '', resourceId: null },
    deliverables: [makeDeliverable(chosen?.deliverable ?? 'none')],
    required: true,
    assignedTo: null,
    dependsOnStepIds: [],
  };
}

/**
 * Cómo quedan los títulos al añadir una parte.
 *
 * Con una sola parte, ninguna necesita título. En cuanto hay dos, las dos lo
 * necesitan —el estudiante las ve en una lista— y se rellenan con el nombre de
 * su intención para que nadie se quede bloqueado en un campo vacío. Se pone al
 * AÑADIR y no al guardar, para que quien lo vea pueda cambiarlo antes.
 */
export function titleForNewPart(
  existing: readonly WorkflowStep[],
  incoming: WorkflowStep
): { parts: WorkflowStep[] } {
  const named = (part: WorkflowStep): WorkflowStep =>
    part.title.trim() ? part : { ...part, title: defaultTitleFor(part) };

  const next = [...existing, incoming];
  if (next.length < 2) return { parts: reorderParts(next) };
  return { parts: reorderParts(next.map(named)) };
}

/** El nombre por defecto de una parte: el de su intención. */
export function defaultTitleFor(part: WorkflowStep): string {
  const { action } = actionForPart(part);
  if (action === 'legacy') return partActionLabel(part);
  return actionById(action)?.label ?? 'Parte';
}

/** El entregable de un tipo, con los campos que ese tipo necesita y ningún otro. */
export function makeDeliverable(type: DeliverableType): StepDeliverable {
  return {
    type,
    required: true,
    hint: '',
    questions: [],
    language: type === 'code' ? DEFAULT_PROGRAMMING_LANGUAGE : null,
    codeMode: type === 'code' ? DEFAULT_CODE_MODE : null,
    starterCode: '',
    executionEnabled: false,
    // Sólo significa algo en un registro de uso de IA. Es la MISMA política que
    // `NexBookAIWorklogBlock.conclusionMode`, no un segundo concepto.
    conclusionMode: type === 'ai_worklog' ? 'optional' : null,
  };
}

/**
 * Cambia el entregable de una parte conservando lo que sigue significando algo.
 *
 * Los campos específicos de un tipo se LIMPIAN al salir de él. Guardar un
 * `starterCode` en una parte que ya no pide código obligaría a cada lectura a
 * preguntarse si significa algo.
 */
export function retypeDeliverable(
  current: StepDeliverable,
  type: DeliverableType
): StepDeliverable {
  const fresh = makeDeliverable(type);
  return {
    ...fresh,
    required: current.required,
    hint: current.hint,
    questions: type === 'structured' ? current.questions : [],
    language: type === 'code' ? (current.language ?? fresh.language) : null,
    codeMode: type === 'code' ? (current.codeMode ?? fresh.codeMode) : null,
    starterCode: type === 'code' ? (current.starterCode ?? '') : '',
    executionEnabled: type === 'code' ? (current.executionEnabled ?? false) : false,
    conclusionMode:
      type === 'ai_worklog' ? (current.conclusionMode ?? fresh.conclusionMode) : null,
  };
}

/** El entregable que describe la parte. Una parte siempre tiene al menos uno. */
export function partDeliverable(part: WorkflowStep): StepDeliverable {
  return part.deliverables[0] ?? makeDeliverable('none');
}

// ---------------------------------------------------------------------------
// Modelo → intención (para abrir lo que ya existe)
// ---------------------------------------------------------------------------

/**
 * De qué intención viene una parte guardada.
 *
 * Manda el ENTREGABLE, no `actionType`: el entregable es lo que el estudiante
 * verá y lo que el runner sabe pintar, mientras que `actionType` es una cadena
 * abierta que puede traer cualquier cosa de una plantilla antigua. Un
 * entregable que ninguna intención ofrece hoy vuelve como `legacy`, que es
 * exactamente lo que es: sigue funcionando, deja de estar en el catálogo.
 */
export function actionForPart(part: WorkflowStep): { action: ActivityActionId; variant: string } {
  const type = partDeliverable(part).type;

  // NexLab y NexCode comparten `actionType: 'code'`; los separa el entregable.
  if (type === 'nexbook') return { action: 'lab', variant: 'nexbook' };
  if (type === 'code') return { action: 'code', variant: 'code' };
  if (type === 'ai_worklog') return { action: 'ai', variant: 'ai_worklog' };
  if (type === 'project') return { action: 'project', variant: 'project' };
  if (type === 'text') return { action: 'respond', variant: 'text' };
  if (type === 'structured') return { action: 'respond', variant: 'structured' };
  if (type === 'file') return { action: 'evidence', variant: 'file' };
  if (type === 'image') return { action: 'evidence', variant: 'image' };
  if (type === 'video') return { action: 'evidence', variant: 'video' };
  if (type === 'url') return { action: 'evidence', variant: 'link' };
  if (type === 'none') return { action: 'instruction', variant: 'none' };

  return { action: 'legacy', variant: type };
}

/** Cómo se nombra una parte en la interfaz, venga de donde venga. */
export function partActionLabel(part: WorkflowStep): string {
  const { action, variant } = actionForPart(part);
  if (action === 'legacy') {
    return LEGACY_DELIVERABLE_LABEL[partDeliverable(part).type] ?? 'Entrega de una versión anterior';
  }
  const catalog = actionById(action);
  const chosen = catalog?.variants.find((item) => item.id === variant);
  if (!catalog) return 'Parte';
  // Con una sola variante el nombre de la intención ya lo dice todo.
  return catalog.variants.length > 1 ? `${catalog.label} · ${chosen?.label ?? ''}` : catalog.label;
}

// ---------------------------------------------------------------------------
// Reordenar, quitar, dependencias
// ---------------------------------------------------------------------------

/** Reordena y reescribe `order`, que es dato y no el índice del array. */
export function reorderParts(parts: readonly WorkflowStep[]): WorkflowStep[] {
  return parts.map((part, index) => ({ ...part, order: index }));
}

export function movePart(parts: readonly WorkflowStep[], index: number, delta: number): WorkflowStep[] {
  const target = index + delta;
  if (target < 0 || target >= parts.length) return [...parts];
  const next = [...parts];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return reorderParts(next);
}

/** Quién depende de una parte. Vacío = se puede quitar sin romper nada. */
export function dependentsOf(parts: readonly WorkflowStep[], id: string): WorkflowStep[] {
  return parts.filter((part) => part.dependsOnStepIds.includes(id));
}

/**
 * Quita una parte.
 *
 * Si otra dependía de ella NO se borra la dependencia en silencio: se devuelve
 * quién dependía para que la interfaz lo diga y quien decide lo decida. Borrar
 * la referencia sin avisar dejaría una actividad que se comporta distinto sin
 * que nadie sepa por qué.
 */
export function removePart(
  parts: readonly WorkflowStep[],
  id: string,
  options: { releaseDependents?: boolean } = {}
): { parts: WorkflowStep[]; blockedBy: WorkflowStep[] } {
  const blockedBy = dependentsOf(parts, id);
  if (blockedBy.length > 0 && !options.releaseDependents) {
    return { parts: [...parts], blockedBy };
  }

  return {
    parts: reorderParts(
      parts
        .filter((part) => part.id !== id)
        .map((part) => ({
          ...part,
          dependsOnStepIds: part.dependsOnStepIds.filter((dep) => dep !== id),
        }))
    ),
    blockedBy: [],
  };
}

// ---------------------------------------------------------------------------
// Derivación de la forma guardada
// ---------------------------------------------------------------------------

/**
 * El tipo antiguo equivalente a UN entregable, cuando lo hay.
 *
 * Es la mitad fácil. La otra mitad —si la parte cabe entera en esa forma— la
 * decide `legacyEquivalent`.
 */
const LEGACY_TYPE_FOR: Readonly<Partial<Record<DeliverableType, AssignmentType>>> = {
  text: 'freeform',
  structured: 'research',
  ai_worklog: 'ai_worklog',
  project: 'web_project',
  url: 'external_link',
};

/** El modo de herramienta que la lectura antigua sintetiza para cada tipo. */
const LEGACY_TOOL_MODE: Readonly<Record<string, WorkflowStep['tool']['mode']>> = {
  research: 'none',
  ai_worklog: 'free',
  web_project: 'none',
  external_link: 'free',
  freeform: 'none',
};

/**
 * ¿Cabe esta parte en la representación antigua sin perder nada?
 *
 * Una tarea anterior a los procesos se LEE sintetizando un paso
 * (`synthesizeLegacyStep`): título, objetivo e instrucciones salen de la tarea,
 * el prompt sale vacío, los recursos son los de la tarea y la herramienta es la
 * que corresponde al tipo. Todo lo que la parte diga POR ENCIMA de eso se
 * perdería al guardarla así.
 *
 * Por eso la comprobación es exhaustiva y no sólo del entregable: es la
 * diferencia entre «se guarda como antes» y «se guarda como antes y desaparece
 * el prompt que acabo de escribir».
 */
export function legacyEquivalent(part: WorkflowStep): AssignmentType | null {
  const deliverable = partDeliverable(part);
  const type = LEGACY_TYPE_FOR[deliverable.type];
  if (!type) return null;

  if (part.title.trim()) return null;
  if (part.description.trim()) return null;
  if (part.instructions.trim()) return null;
  if (part.prompt.mode !== 'none') return null;
  if (part.resources.length > 0) return null;
  if (part.dependsOnStepIds.length > 0) return null;
  if (part.assignedTo && part.assignedTo.length > 0) return null;
  if (!part.required) return null;
  if (deliverable.hint.trim()) return null;
  if (!deliverable.required) return null;
  // Un registro de IA con conclusión obligatoria es una política que la lectura
  // antigua no sabe transportar: no hay dónde guardarla fuera del paso.
  if (deliverable.conclusionMode && deliverable.conclusionMode !== 'optional') return null;
  if (part.tool.mode !== LEGACY_TOOL_MODE[type]) return null;
  if (part.tool.toolIds.length > 0 || part.tool.toolNames.length > 0) return null;

  return type;
}

export interface DerivedActivity {
  /** Lo que se manda en `type`. */
  type: AssignmentType;
  /** Lo que se manda en `workflow`. Vacío = forma antigua. */
  workflow: WorkflowStep[];
  /** Los campos de una investigación viven en la tarea cuando es antigua. */
  researchQuestions: ResearchQuestion[];
}

/**
 * Qué forma se guarda, a partir de las partes.
 *
 * ```
 * ya era un proceso   → proceso            (nunca se degrada)
 * 2 o más partes      → proceso
 * 1 parte que cabe    → su forma antigua
 * 1 parte que no cabe → proceso
 * ```
 *
 * ## Por qué un proceso NUNCA vuelve a la forma antigua
 *
 * Porque la evidencia de las entregas se indexa por el id del paso. Una
 * actividad guardada como proceso tiene partes con ids propios; devolverla a la
 * forma antigua la haría leerse con el paso sintético `main`, y todo lo
 * entregado hasta ese momento dejaría de encontrarse. Es el mismo motivo por el
 * que `LEGACY_STEP_ID` es una constante.
 *
 * ## Por qué una actividad antigua no se convierte sola
 *
 * Abrirla y volver a guardarla no puede cambiar su forma: quien corrige una
 * fecha no está pidiendo una migración. La parte que representa una actividad
 * antigua llega sin título ni instrucciones propias —los suyos son los de la
 * actividad— y por eso `legacyEquivalent` la reconoce y la devuelve igual.
 */
export function deriveActivity({
  parts,
  wasWorkflow,
  researchQuestions,
  activityTitle = '',
}: {
  parts: readonly WorkflowStep[];
  /** La actividad ya se guardaba como proceso antes de esta edición. */
  wasWorkflow: boolean;
  /** Los campos de investigación del formulario. */
  researchQuestions: readonly ResearchQuestion[];
  /**
   * El título de la actividad. Da nombre a una parte que no lo tenga: ver
   * `namedForWorkflow`.
   */
  activityTitle?: string;
}): DerivedActivity {
  const ordered = reorderParts(parts);

  if (!wasWorkflow && ordered.length === 1) {
    const legacy = legacyEquivalent(ordered[0]!);
    if (legacy) {
      return {
        type: legacy,
        workflow: [],
        researchQuestions:
          legacy === 'research'
            ? [...(partDeliverable(ordered[0]!).questions ?? [])]
            : [...researchQuestions],
      };
    }
  }

  return {
    type: 'workflow',
    workflow: ordered.map((part) => namedForWorkflow(part, ordered.length, activityTitle)),
    researchQuestions: [...researchQuestions],
  };
}

/**
 * Una parte guardada como proceso NECESITA nombre.
 *
 * El modelo lo exige —`workflowStepSchema` pide un título— porque es lo que el
 * estudiante ve en la lista. Pero pedírselo a quien sólo quiso decir «que
 * trabajen en el laboratorio» sería pedir dos veces lo mismo: la actividad ya
 * se llama de algo.
 *
 * Así que el título de la parte sigue siendo OPCIONAL en la interfaz y aquí se
 * completa: con el de la actividad cuando hay una sola parte, y con el de su
 * intención cuando hay varias. Es determinista, y es lo que quien lo lea habría
 * escrito.
 */
function namedForWorkflow(part: WorkflowStep, total: number, activityTitle: string): WorkflowStep {
  if (part.title.trim()) return part;
  const fallback = total === 1 ? activityTitle.trim() : '';
  return { ...part, title: fallback || defaultTitleFor(part) };
}

/**
 * Las partes con las que se abre una actividad existente.
 *
 * Una actividad antigua NO se convierte: se representa con una parte que lleva
 * sólo lo que la forma antigua sabía guardar, de modo que `legacyEquivalent` la
 * reconozca y volver a guardarla la deje igual que estaba.
 */
export function partsFromAssignment(
  assignment: {
    type: AssignmentType;
    workflow: WorkflowStep[];
    researchQuestions: ResearchQuestion[];
  },
  newId: () => string
): WorkflowStep[] {
  if (assignment.type === 'workflow') return reorderParts(assignment.workflow);

  const deliverable = LEGACY_DELIVERABLE_OF[assignment.type] ?? 'text';
  const part = makePart({
    action: actionForDeliverable(deliverable),
    variant: variantForDeliverable(deliverable),
    id: newId(),
    order: 0,
    // Sin título propio: el de la actividad ya lo es. Escribir uno aquí
    // convertiría la actividad en un proceso al guardar.
    title: '',
  });

  const base = partDeliverable(part);
  return [
    {
      ...part,
      tool: { mode: LEGACY_TOOL_MODE[assignment.type] ?? 'none', toolIds: [], toolNames: [] },
      deliverables: [
        {
          ...base,
          questions: deliverable === 'structured' ? assignment.researchQuestions : [],
          conclusionMode: deliverable === 'ai_worklog' ? 'optional' : null,
        },
      ],
    },
  ];
}

/** Qué pedía cada tipo antiguo. Es el inverso de `LEGACY_TYPE_FOR`. */
const LEGACY_DELIVERABLE_OF: Readonly<Record<AssignmentType, DeliverableType>> = {
  research: 'structured',
  ai_worklog: 'ai_worklog',
  web_project: 'project',
  external_link: 'url',
  freeform: 'text',
  workflow: 'none',
};

function actionForDeliverable(type: DeliverableType): ActivityActionId {
  return actionForPart({ ...EMPTY_PART, deliverables: [makeDeliverable(type)] }).action;
}

function variantForDeliverable(type: DeliverableType): string {
  return actionForPart({ ...EMPTY_PART, deliverables: [makeDeliverable(type)] }).variant;
}

const EMPTY_PART: WorkflowStep = {
  id: '',
  order: 0,
  title: '',
  description: '',
  instructions: '',
  actionType: 'instruction',
  tool: { mode: 'none', toolIds: [], toolNames: [] },
  resources: [],
  prompt: { mode: 'none', title: '', text: '', resourceId: null },
  deliverables: [],
  required: true,
  assignedTo: null,
  dependsOnStepIds: [],
};

// ---------------------------------------------------------------------------
// Errores en lenguaje de persona
// ---------------------------------------------------------------------------

export interface ActivityProblem {
  /** Índice de la parte, o `null` si el problema es de la actividad entera. */
  part: number | null;
  /** Qué campo hay que tocar. Se usa para llevar el foco. */
  field: string;
  message: string;
  /** Un borrador puede guardarse con problemas `soft`; publicar, no. */
  severity: 'blocking' | 'soft';
}

/**
 * Qué le falta a la actividad, dicho como se lo diría una persona.
 *
 * Nada de `workflow.steps[2].deliverables[0].type invalid`. Se dice QUÉ parte,
 * QUÉ campo y qué hacer, porque eso es lo único que permite arreglarlo sin
 * adivinar.
 *
 * La distinción entre `soft` y `blocking` existe porque preparar una actividad
 * es progresivo: se empieza por el título, se añaden partes y se va rellenando.
 * Exigirlo todo en cada guardado impediría construirla poco a poco, que es
 * justo como se construye.
 */
export function activityProblems({
  title,
  parts,
}: {
  title: string;
  parts: readonly WorkflowStep[];
}): ActivityProblem[] {
  const problems: ActivityProblem[] = [];

  if (title.trim().length < 3) {
    problems.push({
      part: null,
      field: 'title',
      message: 'La actividad necesita un título de al menos 3 caracteres.',
      severity: 'blocking',
    });
  }

  parts.forEach((part, index) => {
    /**
     * Con varias partes, cada una se lee en una lista y un nombre propio ayuda.
     * No BLOQUEA: al guardar se completa con el de su intención
     * (`namedForWorkflow`), así que quedarse sin escribirlo no rompe nada. Lo
     * que sería un error es dejar que alguien publique creyendo que puso un
     * nombre que no puso.
     */
    if (parts.length > 1 && !part.title.trim()) {
      problems.push({
        part: index,
        field: 'title',
        message: `La Parte ${index + 1} no tiene nombre propio: en la lista del estudiante aparecerá como «${defaultTitleFor(part)}».`,
        severity: 'soft',
      });
    }

    const deliverable = partDeliverable(part);

    if (deliverable.type === 'structured' && deliverable.questions.length === 0) {
      problems.push({
        part: index,
        field: 'questions',
        message: `La Parte ${index + 1} pide una respuesta por campos pero todavía no tiene ninguno. Añade al menos uno.`,
        severity: 'soft',
      });
    }

    if (part.tool.mode === 'required' && part.tool.toolNames.length === 0) {
      problems.push({
        part: index,
        field: 'tool',
        message: `La Parte ${index + 1} exige una herramienta concreta pero no dice cuál. Escribe su nombre.`,
        severity: 'soft',
      });
    }

    for (const dependency of part.dependsOnStepIds) {
      if (!parts.some((other) => other.id === dependency)) {
        problems.push({
          part: index,
          field: 'dependsOn',
          message: `La Parte ${index + 1} se desbloquea después de una parte que ya no existe. Revísalo en Opciones avanzadas.`,
          severity: 'blocking',
        });
      }
    }
  });

  return problems;
}

/** Lo que impide publicar. Un borrador tolera lo demás. */
export function blockingProblems(problems: readonly ActivityProblem[]): ActivityProblem[] {
  return problems.filter((problem) => problem.severity === 'blocking');
}

/**
 * Traduce un error del servidor a algo accionable cuando se puede.
 *
 * El servidor valida con Zod y sus mensajes son buenos, pero las rutas de campo
 * no lo son: `workflow.2.title` no le dice nada a quien está creando una
 * actividad. Cuando se reconoce la ruta se reescribe; cuando no, se deja el
 * mensaje tal cual, que es mejor que inventar uno genérico.
 */
export function humanizeSaveError(message: string): string {
  const step = /workflow\.(\d+)\.(\w+)/.exec(message);
  if (!step) return message;

  const position = Number(step[1]) + 1;
  const field = step[2];
  if (field === 'title') return `La Parte ${position} necesita un título.`;
  if (field === 'instructions') return `Las instrucciones de la Parte ${position} son demasiado largas.`;
  if (field === 'deliverables') return `Revisa qué debe entregar el estudiante en la Parte ${position}.`;
  return `Revisa la Parte ${position}.`;
}

export const CONCLUSION_MODES: readonly { value: NexBookConclusionMode; label: string; helper: string }[] = [
  { value: 'none', label: 'No solicitar', helper: 'Sólo el registro de lo que hizo con la IA.' },
  {
    value: 'optional',
    label: 'Opcional',
    helper: 'Se ofrece el espacio para escribirla, pero no se exige.',
  },
  {
    value: 'required',
    label: 'Obligatoria',
    helper: 'No podrá entregar sin escribir qué concluyó. Se comprueba al entregar.',
  },
];
