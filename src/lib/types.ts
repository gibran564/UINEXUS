import type { PublicationReference } from './publications';
/**
 * Modelo de dominio de UINexus.
 *
 * Convención de privacidad: existen dos formas del proyecto.
 *  - `ProjectRecord`  vive en el servidor y contiene `ownerId` (UID de Firebase)
 *    y rutas internas de Storage.
 *  - `Project`        es el DTO que viaja al navegador. NO lleva UID ni rutas
 *    internas: la identidad pública de una persona es su `handle`.
 * `toPublicProject()` en lib/data/mappers.ts es el único puente entre ambas.
 */

export type ProjectStatus = 'draft' | 'published' | 'unlisted' | 'archived';

/** Nivel de complejidad de lo que se publica (ver docs/ARCHITECTURE.md §5). */
export type ProjectType = 'html' | 'site' | 'build';

export type UserRole = 'student' | 'teacher' | 'admin';

export type Visibility = Extract<ProjectStatus, 'published' | 'unlisted' | 'draft'>;

/** Ficha académica opcional. Convierte el hosting en un caso de estudio. */
export interface ProjectBrief {
  problem?: string;
  goal?: string;
  process?: string;
  tools?: string;
  reflection?: string;
}

export interface ProjectCover {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Autor tal y como se muestra públicamente. Sin correo, sin UID. */
export interface ProjectAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** DTO público de un proyecto. Es lo único que llega al navegador. */
export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: ProjectAuthor;
  courseId: string | null;
  courseName: string | null;
  term: string | null;
  group: string | null;
  tags: string[];
  cover: ProjectCover | null;
  projectType: ProjectType;
  status: ProjectStatus;
  brief: ProjectBrief;
  version: number;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  views: number;
  featured: boolean;
}

/** Forma persistida en Firestore. Nunca se serializa tal cual al cliente. */
export interface ProjectRecord extends Project {
  ownerId: string;
  ownerHandle: string;
  entryFile: string;
  hiddenByAdmin: boolean;
  reportCount: number;
}

export interface PublicUser {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  program: string | null;
  role: UserRole;
  projectCount: number;
  createdAt: string;
  /**
   * Ficha academica. Ambas son OPCIONALES a proposito: los perfiles creados
   * antes de la iteracion 2 no las tienen, y una lectura que las exigiera
   * romperia a todo el mundo que ya estaba dentro. Ver docs/ARCHITECTURE.md.
   */
  studentProfile?: StudentProfile;
  teacherProfile?: TeacherProfile;
}

export interface CourseActivity {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
}

export interface Course {
  id: string;
  slug: string;
  name: string;
  institution: string;
  term: string;
  description: string;
  teacherName: string;
  studentCount: number;
  projectCount: number;
  activities: CourseActivity[];
}

/** Un archivo ya validado, listo para subirse a Storage. */
export interface StagedFile {
  /** Ruta relativa dentro del proyecto, p. ej. "assets/logo.svg". */
  path: string;
  size: number;
  contentType: string;
  blob: Blob;
}

export type SortOption = 'recent' | 'featured' | 'popular' | 'alphabetical';

export interface ExploreFilters {
  query: string;
  tag: string | null;
  courseId: string | null;
  term: string | null;
  projectType: ProjectType | null;
  sort: SortOption;
}

// ---------------------------------------------------------------------------
// Capa académica (iteración 2)
//
// UINexus deja de ser sólo un hosting de proyectos: pasa a modelar
// Materia → Grupo → Tareas → Entregas. La convención de privacidad es la misma
// que en proyectos y no se relaja aquí: los tipos `*Record` viven en el
// servidor y llevan UID de Firebase; los DTO que viajan al navegador
// identifican a las personas por su `handle`. `lib/data/academic-mappers.ts`
// es el único puente.
// ---------------------------------------------------------------------------

/**
 * Qué se espera que entregue el alumnado.
 *
 * `workflow` es el tipo de la iteración 4: una actividad de varios pasos. Los
 * cinco anteriores se conservan tal cual porque hay tareas creadas con ellos, y
 * porque una tarea de un solo paso no debería obligar a nadie a abrir un
 * constructor de workflows (§51). Internamente TODAS son un workflow: las
 * antiguas, de un paso, sintetizado al leer (`normalizeAssignment`).
 */
export type AssignmentType =
  | 'research'
  | 'ai_worklog'
  | 'web_project'
  | 'external_link'
  | 'freeform'
  | 'workflow';

export type AssignmentStatus = 'draft' | 'published' | 'closed';

/**
 * Cómo se reparte el trabajo de una actividad.
 *
 * `shared` es la respuesta de UINexus al documento compartido de Drive, pero
 * NO imita su mecánica: no hay edición simultánea del mismo texto. Cada
 * persona escribe SU aportación y la vista conjunta se compone al leer. Así no
 * hay conflictos que resolver ni texto que se pise, que es el problema real de
 * un glosario que escriben treinta personas a la vez.
 */
export type CollaborationMode = 'individual' | 'shared';

/**
 * Quién ve las aportaciones del resto en una actividad colaborativa.
 * El profesorado siempre lo ve todo; esto sólo regula al alumnado.
 */
export type ContributionVisibility = 'group' | 'own' | 'after_submit';

/** Responsables de un concepto. En el DTO son handles; en el registro, UID. */
export interface GroupAssignment {
  groupId: string;
  assignedTo: string[];
}

export interface GroupAssignmentRecord extends GroupAssignment {
  assignedTo: string[];
}

/** Tipos de recurso de la biblioteca de IA de una materia. */
export type ResourceKind = 'prompt' | 'skill';

/**
 * Referencia a un recurso de la materia.
 *
 * Se guarda el id y NO una copia del contenido. Si la docente corrige el
 * prompt, la tarea que lo recomienda enseña la corrección: es lo que hace que
 * el recurso sea uno solo y no una copia por tarea que envejece aparte. El
 * precio es que un recurso borrado deja una referencia colgando, y por eso las
 * vistas resuelven los recursos que existen y omiten en silencio los que no.
 */
export interface ResourceRef {
  kind: ResourceKind;
  id: string;
}

/** Un campo de una investigación estructurada: sustituye al DOCX de conceptos. */
export interface ResearchQuestion {
  id: string;
  /**
   * Concepto al que pertenece el campo, p. ej. "Card sorting". Existe para que
   * el formulario del alumnado agrupe «Definición / Fuente / Comentario» bajo
   * un mismo encabezado sin que el modelo deje de ser una lista plana de
   * campos, que es lo que hace fácil añadir después otros tipos de pregunta.
   */
  group: string | null;
  /**
   * Identificador ESTABLE del concepto. Es lo que se reparte entre estudiantes
   * en una actividad colaborativa, y por eso no puede ser el texto de `group`:
   * corregir una tilde en «Taxonomía» reasignaría el apartado a nadie.
   *
   * Las investigaciones anteriores a la iteración 3 no lo tienen. La lectura se
   * lo deriva del texto del grupo (`normalizeAssignment`), así que siguen
   * funcionando; las nuevas lo llevan explícito desde que se crean.
   */
  groupId: string;
  prompt: string;
  type: 'short_text' | 'long_text' | 'url';
  required: boolean;
}

export interface ResourceLink {
  label: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Workflow académico (iteración 4)
//
// Una tarea deja de ser «una investigación» o «un AI Worklog» y pasa a ser un
// PROCESO de uno o varios pasos. Es lo que permite modelar la actividad real:
//
//   Perplexity → NotebookLM → Miro → reflexión
//
// sin que el código tenga que conocer Perplexity, NotebookLM ni Miro.
//
// La compatibilidad no se resuelve migrando registros: una tarea anterior se
// LEE como un workflow de un solo paso (`normalizeAssignment`), y su entrega
// como la evidencia de ese paso (`normalizeSubmission`). Por eso no hay script
// de migración y por eso `LEGACY_STEP_ID` es una constante y no un uuid: tiene
// que ser el mismo valor en cada lectura o la evidencia dejaría de encontrarse.
// ---------------------------------------------------------------------------

/**
 * Qué clase de acción es un paso.
 *
 * Deliberadamente NO es una unión cerrada. §4 lo pide con todas las letras: la
 * docente encontrará otra herramienta la semana que viene y no puede depender
 * de que alguien despliegue código para poder usarla. Los valores conocidos
 * están en `STEP_ACTIONS` (lib/constants.ts) y sirven para elegir icono y texto
 * por defecto; cualquier otra cadena es válida y cae en el trato genérico.
 */
export type StepActionType =
  | 'instruction'
  | 'ai_interaction'
  | 'prompt'
  | 'skill'
  | 'external_tool'
  | 'external_resource'
  | 'research'
  | 'upload'
  | 'link_submission'
  | 'text_response'
  | 'structured_response'
  | 'video'
  | 'image'
  | 'project'
  | 'reflection'
  | 'approval'
  | 'custom'
  // El literal ancho mantiene el autocompletado de los valores conocidos sin
  // cerrar el tipo. Es el precio de que el modelo sobreviva a herramientas que
  // todavía no existen.
  | (string & {});

/** Qué evidencia espera un paso. */
export type DeliverableType =
  | 'none'
  | 'text'
  | 'url'
  | 'file'
  | 'image'
  | 'video'
  | 'ai_worklog'
  | 'structured'
  | 'project'
  /** Código fuente: pegado, adjunto, o ambos. Ver `ProgrammingLanguage`. */
  | 'code'
  /**
   * Un documento computacional. Ver `NexBook`.
   *
   * Es un entregable MÁS, no el sustituto de `code`: una actividad que sólo
   * pide veinte líneas de Python no debería obligar a nadie a abrir un
   * documento por bloques.
   */
  | 'nexbook'
  | 'resource_reference';

/**
 * Lenguaje de programación de un paso de código.
 *
 * Es una unión ABIERTA por la misma razón que `StepActionType`: el modelo no
 * puede depender de un despliegue para admitir un lenguaje nuevo. Qué se ofrece
 * HOY, y para qué, lo decide `PROGRAMMING_LANGUAGES` (lib/constants.ts).
 *
 * Deliberadamente NO es un booleano `isR`: eso habría obligado a rehacer las
 * entregas el día que entrara el segundo lenguaje.
 */
export type ProgrammingLanguage =
  | 'r'
  | 'python'
  | 'java'
  | 'c'
  | 'cpp'
  | 'javascript'
  | 'html'
  | 'css'
  | 'sql'
  | (string & {});

/**
 * Qué se puede hacer con un lenguaje, dicho campo por campo.
 *
 * Antes esto era UN booleano, `enabled`, y era un error de diseño: mezclaba
 * «se puede escribir» con «se puede ejecutar». Con un solo interruptor, ofrecer
 * Java en el editor significaba prometer que Java corre, y no corre. Separarlos
 * es lo que permite decir la verdad en la interfaz —«Ejecución no disponible»—
 * en vez de esconder el lenguaje o fingir que funciona.
 *
 * `execution` es la pregunta que le importa a quien programa; `browserExecution`
 * y `remoteExecution` son DÓNDE, y le importan a la arquitectura.
 */
export interface LanguageCapabilities {
  /** Se puede escribir en Monaco, con resaltado y su extensión propia. */
  editor: boolean;
  /** Se puede ejecutar en alguna parte. Si es `false`, la UI lo dice. */
  execution: boolean;
  /** Se ejecuta en el navegador de quien programa (Pyodide, webR). */
  browserExecution: boolean;
  /** Necesitaría un sandbox remoto. Hoy ninguno está conectado. */
  remoteExecution: boolean;
  /** Puede ser la base de un proyecto web publicable en el origen aislado. */
  projects: boolean;
}

/** Cómo puede entregar el fuente el alumnado en un paso de programación. */
export type CodeMode = 'editor' | 'upload' | 'either';

export interface StepDeliverable {
  type: DeliverableType;
  required: boolean;
  /** Ayuda concreta: «pega los cinco enlaces, uno por línea». */
  hint: string;
  /** Sólo cuando `type === 'structured'`: los campos que se rellenan. */
  questions: ResearchQuestion[];
  /**
   * Sólo cuando `type === 'code'`: en qué lenguaje se pide la solución.
   *
   * OPCIONAL a propósito: los pasos guardados antes de que existiera el
   * entregable de código no lo traen, y no hay nada que migrar porque tampoco
   * piden código.
   */
  language?: ProgrammingLanguage | null;
  /** Opcional por compatibilidad; un paso de código legacy se normaliza a `either`. */
  codeMode?: CodeMode | null;
  /** Fuente inicial de la docente. Los espacios son significativos. */
  starterCode?: string;
  /** Si la interfaz puede ofrecer ejecución dentro de un sandbox aislado. */
  executionEnabled?: boolean;
}

/**
 * Cómo se elige la herramienta de un paso (§24, §37).
 *
 *  · `none`     el paso no usa herramienta.
 *  · `required` hay que usar una concreta.
 *  · `choice`   se elige entre las que propone la docente.
 *  · `free`     cualquiera; el estudiante escribe cuál usó.
 */
export type ToolChoiceMode = 'none' | 'required' | 'choice' | 'free';

export interface StepToolChoice {
  mode: ToolChoiceMode;
  /** Herramientas del catálogo de la materia. */
  toolIds: string[];
  /**
   * Los nombres, guardados JUNTO a los ids y no en lugar de ellos.
   *
   * §50: una actividad no puede romperse porque una herramienta desaparezca del
   * catálogo, cambie de nombre o deje de existir. Si el id no resuelve, el paso
   * sigue diciendo «usa Perplexity», que es lo que de verdad necesita entender
   * quien lo lee.
   */
  toolNames: string[];
}

/** Un paso del proceso. */
/**
 * De dónde sale el prompt de un paso.
 *
 *  · `none`    el paso no usa prompt.
 *  · `inline`  la docente lo escribió DENTRO de la actividad. No es un recurso
 *              de la biblioteca y no tiene por qué serlo: la biblioteca es
 *              reutilización, no un requisito para poder crear una tarea.
 *  · `library` el paso apunta a un prompt de la biblioteca de la materia. Se
 *              guarda la referencia y no una copia, para que corregir el prompt
 *              lo corrija en todas las tareas que lo usan.
 */
export type StepPromptMode = 'none' | 'inline' | 'library';

export interface StepPrompt {
  mode: StepPromptMode;
  /** Título del prompt. Opcional en `inline`; en `library` es el del recurso. */
  title: string;
  /** El texto, cuando vive en la actividad (`inline`). */
  text: string;
  /**
   * El recurso de la biblioteca. Obligatorio en `library`; en `inline` puede
   * estar relleno si la docente guardó su prompt en la biblioteca desde el
   * editor, y entonces sólo dice de dónde salió.
   */
  resourceId: string | null;
}

export interface WorkflowStep {
  id: string;
  order: number;
  title: string;
  description: string;
  instructions: string;
  actionType: StepActionType;
  tool: StepToolChoice;
  /** Prompts, Skills y demás recursos recomendados PARA ESTE PASO (§30). */
  resources: ResourceRef[];
  /**
   * El prompt del paso, si lo usa. Escrito a mano, elegido de la biblioteca o
   * generado: los tres casos caben aquí y NINGUNO obliga a que exista un
   * recurso previo.
   */
  prompt: StepPrompt;
  /** Qué hay que entregar. Varios entregables son válidos (§17). */
  deliverables: StepDeliverable[];
  required: boolean;
  /**
   * Responsables del paso (§33). `null` = quien tenga la tarea.
   * UID en el registro, handles en el DTO y sólo para el profesorado.
   */
  assignedTo: string[] | null;
  /** Pasos que hay que haber completado antes (§22). */
  dependsOnStepIds: string[];
}

export interface WorkflowStepRecord extends Omit<WorkflowStep, 'assignedTo'> {
  assignedTo: string[] | null;
}

/**
 * Identificador del paso sintetizado para una tarea anterior a la iteración 4.
 *
 * Constante y no generado: la evidencia de las entregas antiguas se indexa por
 * este valor al leerlas, así que cambiarlo dejaría huérfano todo lo entregado
 * hasta hoy.
 */
export const LEGACY_STEP_ID = 'main';

/** Herramienta externa del catálogo de la materia (§5, §13). */
export interface ExternalTool {
  id: string;
  courseId: string;
  name: string;
  url: string | null;
  description: string;
  category: string;
  /** Qué tan lejos llega la integración. Ver `EmbedLevel`. */
  embedLevel: EmbedLevel;
  usageInstructions: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Niveles de integración (§39).
 *
 *  0 · enlace          se abre en otra pestaña y ya.
 *  1 · tarjeta         título, dominio y descripción.
 *  2 · embed           la propia herramienta permite incrustarse.
 *  3 · API             integración real. NO implementado, y a propósito.
 *
 * Por defecto se usa 0/1. Subir de nivel es una decisión por herramienta, no
 * algo que se deduzca de que exista una URL.
 */
export type EmbedLevel = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Materiales de la tarea
//
// El tercer concepto de archivo de UINexus, y el que faltaba. Son DOS cosas
// distintas y no se mezclan:
//
//   Submission / StepEvidence  →  lo que ENTREGA el alumnado. Privado por
//                                 persona, con fecha límite y revisión.
//   AssignmentMaterial         →  lo que REPARTE el profesorado para poder
//                                 hacer la tarea. Lo lee todo el grupo, no
//                                 caduca y nadie lo revisa.
//
// Meterlos en la misma lista habría obligado a preguntarse en cada lectura «¿de
// quién es este archivo?», que es justo la pregunta que decide quién puede
// borrarlo. Por eso viven en la tarea y no en las entregas, y por eso tienen su
// propia ruta de API y su propio prefijo en S3.
// ---------------------------------------------------------------------------

/**
 * Para qué sirve el archivo que reparte la docente.
 *
 *  · `template` se rellena y se devuelve: el formato del reporte, la hoja de
 *    cálculo con la tabla vacía.
 *  · `resource` se consulta: el caso de estudio, el dataset, el ejemplo.
 *
 * Es una etiqueta para quien lo lee, no una regla: UINexus no comprueba que la
 * plantilla se devuelva. Distinguirlas ahorra la pregunta «¿esto lo tengo que
 * entregar?» en la pantalla del alumnado.
 */
export type AssignmentMaterialKind = 'template' | 'resource';

/** Un archivo repartido por el profesorado, tal y como lo ve la clase. */
export interface AssignmentMaterial {
  id: string;
  kind: AssignmentMaterialKind;
  /** Cómo se llama en la pantalla. Editable sin tocar el archivo. */
  displayName: string;
  /** El nombre original, para que la descarga se llame como debe. */
  fileName: string;
  /** Clave en S3. La construye el servidor; nunca llega del cliente. */
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** Quién lo subió, por nombre. El UID se queda en el registro. */
  uploadedByName: string;
}

export interface AssignmentMaterialRecord extends AssignmentMaterial {
  /** UID de quien lo subió. No cruza la frontera hacia el navegador. */
  uploadedBy: string;
}

/** Tarea tal y como la ve quien tiene derecho a verla. */
export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description: string;
  instructions: string;
  type: AssignmentType;
  resourceLinks: ResourceLink[];
  /** Sólo se usa cuando `type === 'research'`. */
  researchQuestions: ResearchQuestion[];
  /**
   * Fecha límite en local, «YYYY-MM-DD». Se conserva porque hay pantallas y
   * ordenaciones que sólo necesitan el día, y porque es lo único que tienen las
   * tareas anteriores a esta iteración.
   */
  dueDate: string | null;
  /**
   * El instante EXACTO en que se cierran las entregas, ISO en UTC.
   *
   * `null` en una tarea antigua: `lib/due-date.ts` la interpreta entonces como
   * el final de su día, y ahí está documentado por qué de forma permisiva.
   */
  dueAt: string | null;
  /**
   * `individual`: cada persona responde la actividad entera por su cuenta.
   * `shared`: la actividad se reparte por conceptos y el resultado se compone
   * de las aportaciones de todo el grupo.
   *
   * Las tareas anteriores a la iteración 3 no lo tienen y se leen como
   * `individual`, que es exactamente lo que eran.
   */
  collaborationMode: CollaborationMode;
  /** Quién ve las aportaciones ajenas. Sólo aplica en modo `shared`. */
  contributionVisibility: ContributionVisibility;
  /**
   * Reparto de conceptos en modo `shared`. En el registro del servidor los
   * responsables son UID; en el DTO son handles.
   *
   * Un `groupId` que no aparece aquí queda ABIERTO a todo el grupo: ver
   * `canAnswerGroup()` en lib/data/academic.ts.
   */
  groupAssignments: GroupAssignment[];
  /** Prompts y Skills recomendados. Referencias por id, nunca copias. */
  resources: ResourceRef[];
  /**
   * Los pasos del proceso.
   *
   * SIEMPRE tiene al menos uno. Una tarea anterior a la iteración 4 no lo trae
   * guardado y la lectura le sintetiza un paso único a partir de su `type`, así
   * que el resto del código puede recorrer `workflow` sin preguntarse nunca si
   * la tarea es «antigua» o «nueva». Esa es toda la estrategia de
   * compatibilidad, y por eso no hace falta migrar la tabla.
   */
  workflow: WorkflowStep[];
  /**
   * Los archivos que reparte el profesorado (plantillas y materiales).
   *
   * Una tarea anterior a esta iteración no lo trae guardado y se lee como lista
   * vacía, igual que el resto de campos añadidos: no hay migración. Se gestiona
   * por su propia ruta (`/api/assignments/[id]/materials`) y NO por el cuerpo de
   * la tarea, para que editar el título no pueda borrar los archivos.
   */
  materials: AssignmentMaterial[];
  /** `true` cuando la tarea es para todo el grupo. Lo ven ambos roles. */
  assignedToAll: boolean;
  /**
   * A quién se asignó cuando no es para todo el grupo. En el registro del
   * servidor son UID; en el DTO son handles, y SÓLO se rellena para el
   * profesorado: a un estudiante no le corresponde la lista de sus compañeros.
   */
  assignedTo: string[] | null;
  status: AssignmentStatus;
  createdAt: string;
  updatedAt: string;
}

/** Forma persistida. `assignedTo` y `createdBy` son UID: no salen del servidor. */
export interface AssignmentRecord
  extends Omit<
    Assignment,
    'assignedTo' | 'assignedToAll' | 'groupAssignments' | 'workflow' | 'materials'
  > {
  /** `null` significa TODO EL GRUPO. Una lista, asignación selectiva por UID. */
  assignedTo: string[] | null;
  /** Responsables por concepto, en UID. */
  groupAssignments: GroupAssignmentRecord[];
  /** Pasos con sus responsables en UID. */
  workflow: WorkflowStepRecord[];
  /** Materiales con el UID de quien los subió. */
  materials: AssignmentMaterialRecord[];
  createdBy: string;
}

export type SubmissionStatus = 'draft' | 'submitted' | 'reviewed' | 'needs_changes';

export type AIProvider = 'ChatGPT' | 'Claude' | 'Gemini' | 'Copilot' | 'Other';

/** Formato textual interoperable de un resultado generado por IA. */
export type TextFormat = 'markdown' | 'plain_text';

export interface AITextResult {
  /** Fuente original. UINexus no la resume, corrige, traduce ni reordena. */
  content: string;
  format: TextFormat;
}

/** Registro de uso de IA. No ejecuta modelos: documenta cómo se usaron. */
export interface AIWorklogData {
  provider: AIProvider;
  model: string;
  conversationUrl: string;
  objective: string;
  prompt: string;
  /**
   * Representación canónica nueva. Es opcional para leer Worklogs anteriores
   * sin migración; `normalizeAIResult` cae a `responseSummary`.
   */
  result?: AITextResult;
  /** Campo legacy conservado. Los clientes nuevos escriben `result`. */
  responseSummary: string;
  studentAnalysis: string;
  whatWasUsed: string;
  whatWasChanged: string;
  whatWasDiscarded: string;
  /**
   * Recursos de la materia que el estudiante dice haber usado (§28).
   * OPCIONAL y sin verificar: es un registro académico, no una comprobación
   * técnica. UINexus no sabe —ni puede saber— si alguien instaló de verdad una
   * Skill; lo que aporta es que quede escrito junto al prompt y al modelo.
   *
   * Los AI Worklogs anteriores a la iteración 3 no lo tienen y se leen como
   * lista vacía.
   */
  resourcesUsed: ResourceRef[];
}

export interface ResearchData {
  answers: { questionId: string; value: string }[];
}

/** Entrega que apunta a un proyecto ya publicado. Se referencia, no se copia. */
export interface WebProjectData {
  projectId: string;
  projectPath: string;
  projectTitle: string;
  note: string;
}

export interface ExternalLinkData {
  url: string;
  title: string;
  description: string;
  provider: string;
}

export interface FreeformData {
  text: string;
  links: ResourceLink[];
}

/**
 * Un archivo o medio entregado (§18, §19).
 *
 * Se guarda una URL, no bytes. Cubre el caso real —HeyGen, YouTube, Drive, un
 * enlace de descarga— sin inventar almacenamiento: subir un MP4 a UINexus
 * necesitaría un prefijo propio en S3 y una ruta de firma que hoy no existen, y
 * §18 pide documentar esa infraestructura antes que improvisarla. Está anotado
 * en CHECKPOINTS.md.
 *
 * `kind` es informativo: sirve para elegir cómo pintarlo, no para validar.
 */
export interface MediaData {
  /** Enlace externo: HeyGen, YouTube, Drive… Vacío si se subió el archivo. */
  url: string;
  /**
   * Clave del archivo en S3, cuando se subió a UINexus.
   *
   * Convive con `url` a propósito: §19 pide admitir las dos formas, y para un
   * video hecho con un avatar de IA el enlace suele ser lo natural. La clave la
   * genera el SERVIDOR (`academicFileKey`) y el navegador sólo la devuelve tal
   * cual; leerla exige una URL firmada de corta duración.
   */
  storageKey: string;
  fileName: string;
  kind: 'file' | 'image' | 'video';
  note: string;
}

/**
 * Familias de archivo académico. Cada una tiene su lista blanca y su límite
 * (`ACADEMIC_FILE_EXTENSIONS`, `ACADEMIC_FILE_TYPES`, `ACADEMIC_FILE_LIMITS`).
 *
 * `material` es la del profesorado; las demás son entregas del alumnado.
 */
export type AcademicFileClass = 'image' | 'document' | 'video' | 'code' | 'material';

/** Evidencia que consiste en señalar recursos de la materia. */
export interface ResourceSelectionData {
  refs: ResourceRef[];
  note: string;
}

/**
 * Código entregado en un paso.
 *
 * Las dos formas conviven a propósito y NO se excluyen: pegar el fuente es lo
 * que permite al profesorado leerlo sin descargar nada, y adjuntar el `.R` es
 * lo que permite ejecutarlo tal cual. Pedir sólo una de las dos empeora uno de
 * los dos usos reales.
 *
 * UINexus NO ejecuta este código en ningún momento (ver docs/SECURITY.md). Se
 * guarda como texto y se muestra como texto.
 */
export interface CodeData {
  language: ProgrammingLanguage;
  /** El fuente, tal cual se pegó. Sin formatear, sin corregir. */
  code: string;
  /** Qué hace el programa, si la tarea lo pide. */
  explanation: string;
  /** Clave en S3 del archivo adjunto, cuando se subió uno. */
  storageKey: string;
  fileName: string;
}

export type SubmissionData =
  | ResearchData
  | AIWorklogData
  | WebProjectData
  | ExternalLinkData
  | FreeformData
  | MediaData
  | CodeData
  | NexBookSubmissionData
  | ResourceSelectionData;

/**
 * Lo que una persona entregó en UN paso.
 *
 * `data` reutiliza la misma unión de siempre: un AI Worklog es igual sea la
 * tarea entera o un paso de cuatro (§25). Lo que añade el paso es el contexto
 * —qué herramienta se usó de verdad, cuándo— que §47 pide registrar.
 */
export interface StepEvidence {
  stepId: string;
  /** Herramienta del catálogo, si se eligió una de ahí. */
  toolId: string | null;
  /**
   * Nombre de la herramienta REALMENTE usada. Se guarda aunque haya `toolId`:
   * es lo que sigue siendo legible si el catálogo cambia (§50), y es el único
   * dato cuando el paso permitía elegir libremente (§24).
   */
  toolName: string;
  startedAt: string | null;
  completedAt: string | null;
  data: SubmissionData;
  note: string;
}

/** Entrega. Un solo tipo para todos los formatos: comparte estado y revisión. */
export interface Submission {
  id: string;
  assignmentId: string;
  courseId: string;
  student: ProjectAuthor;
  type: AssignmentType;
  status: SubmissionStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  teacherNote: string;
  /**
   * El contenido de la entrega en el formato de la iteración 3.
   *
   * Se CONSERVA y se sigue escribiendo para las tareas de un solo paso: es lo
   * que leen la exportación, el visor docente y la vista conjunta, todos ya
   * probados. Para una tarea de varios pasos vale el del primer paso.
   */
  data: SubmissionData;
  /**
   * La evidencia paso a paso, indexada por `stepId`.
   *
   * Una entrega anterior a la iteración 4 no lo trae y la lectura lo sintetiza
   * a partir de `data` bajo `LEGACY_STEP_ID`. Así toda la capa de workflow puede
   * leer `stepEvidence` sin distinguir entregas viejas de nuevas.
   */
  stepEvidence: Record<string, StepEvidence>;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionRecord extends Omit<Submission, 'student'> {
  studentId: string;
  student: ProjectAuthor;
  reviewedBy: string | null;
}

/** Persona dentro de una materia, tal y como se muestra al profesorado. */
export interface CourseMember {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CourseMemberRecord extends CourseMember {
  uid: string;
}

/** Rol de quien mira una materia. Decide qué se pinta y qué se puede pedir. */
export type CourseRole = 'teacher' | 'student';

/**
 * Registro de la materia. Extiende el `Course` público que ya alimentaba la
 * galería: los campos nuevos son opcionales en la base de datos real, así que
 * toda lectura les pone valor por defecto (ver `lib/data/academic.ts`).
 */
export interface CourseRecord extends Course {
  code: string | null;
  academicPeriod: string | null;
  teachers: CourseMemberRecord[];
  students: CourseMemberRecord[];
  visibility: 'public' | 'private';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Materia con su gente, sin UID. Es lo que llega al navegador del docente. */
export interface CourseDetail extends Course {
  code: string | null;
  academicPeriod: string | null;
  teachers: CourseMember[];
  students: CourseMember[];
  visibility: 'public' | 'private';
  /** Rol de quien pide la materia. El servidor no permite mentir aquí. */
  viewerRole: CourseRole;
}

/** §21: sólo el modelo base. La biblioteca completa es de otra iteración. */
export interface PromptTemplate extends ResourceAuthorship {
  id: string;
  courseId: string;
  title: string;
  description: string;
  prompt: string;
  recommendedProvider: AIProvider | null;
  recommendedModel: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Forma persistida.
 *
 * `author` y `approvedBy` NO se guardan como objeto: se guardan desnormalizados
 * en `authorHandle`/`authorName` y `approvedByUid`/`approvedByName`. El mapper
 * los recompone para el navegador, que es donde se leen como personas.
 */
export interface PromptTemplateRecord
  extends Omit<PromptTemplate, 'author' | 'approvedBy'> {
  /**
   * Quién lo creó. Se llama `teacherId` por historia —en la iteración 3 sólo el
   * profesorado podía crear prompts— y desde la iteración 4 puede ser también
   * un estudiante. Se conserva el nombre para no migrar la tabla.
   */
  teacherId: string;
  authorHandle: string;
  authorName: string;
  approvedByUid: string | null;
  approvedByName: string;
}

/** Ficha académica opcional del alumnado. Compatible con perfiles antiguos. */
export interface StudentProfile {
  enrollmentNumber?: string | null;
  semester?: string | null;
  career?: string | null;
}

export interface TeacherProfile {
  department?: string | null;
  title?: string | null;
}

/** Resumen de una persona dentro de UNA materia. Nunca mezcla materias. */
export interface StudentCourseSummary {
  student: CourseMember;
  submitted: number;
  pending: number;
  reviewed: number;
  worklogs: number;
  projects: number;
}

// ---------------------------------------------------------------------------
// Biblioteca de Skills (iteración 3)
//
// Una Skill en UINexus es una FICHA ACADÉMICA, no software que la plataforma
// ejecute: explica qué hace una habilidad de IA, dónde vive, con qué
// herramientas funciona, cómo se instala y cómo se usa. Los comandos que
// contiene son contenido educativo que se muestra y se copia. UINexus no los
// ejecuta nunca, por ninguna vía. Ver docs/SECURITY.md.
// ---------------------------------------------------------------------------

/** Un paso de instalación. Discriminado para poder pintar cada uno como toca. */
export type InstallStep =
  | { type: 'text'; content: string }
  | { type: 'command'; content: string }
  | { type: 'link'; label: string; url: string };

/**
 * Una forma de instalar la Skill. Hay varias porque la misma habilidad se
 * instala distinto en Claude Code, en Codex o en Cursor, y obligar a elegir una
 * sola dejaría fuera a media clase.
 */
export interface InstallMethod {
  id: string;
  /** Herramienta a la que corresponde este método, p. ej. "Claude Code". */
  tool: string;
  title: string;
  steps: InstallStep[];
}

export interface SkillResource extends ResourceAuthorship {
  id: string;
  courseId: string;

  title: string;
  description: string;

  /**
   * Ambas opcionales: una Skill puede venir de GitHub, de un marketplace, de la
   * documentación de una herramienta o directamente de lo que escriba la
   * docente. Exigir repositorio dejaría fuera los tres últimos casos.
   */
  repositoryUrl: string | null;
  homepageUrl: string | null;

  compatibleTools: string[];
  installMethods: InstallMethod[];
  /** Cómo se usa, en texto plano con saltos de línea. */
  usageInstructions: string;
  tags: string[];

  createdAt: string;
  updatedAt: string;
}

/** Forma persistida. `createdBy` es UID y no sale del servidor. */
export interface SkillResourceRecord
  extends Omit<SkillResource, 'author' | 'approvedBy'> {
  createdBy: string;
  authorHandle: string;
  authorName: string;
  approvedByUid: string | null;
  approvedByName: string;
}

// ---------------------------------------------------------------------------
// Vista conjunta de una actividad colaborativa (iteración 3)
//
// Es DERIVADA: se compone al leer a partir de la tarea y de las entregas reales.
// No existe ningún "documento final" persistido, y no debe existir: sería una
// segunda copia del mismo contenido, y la segunda copia siempre acaba
// desincronizada de la primera.
// ---------------------------------------------------------------------------

/** Estado de un apartado, derivado del estado de la entrega que lo contiene. */
export type ContributionState = 'missing' | 'draft' | 'submitted' | 'reviewed' | 'needs_changes';

/** Lo que una persona aportó a UN concepto. */
export interface Contribution {
  author: CourseMember;
  state: ContributionState;
  updatedAt: string | null;
  /** Respuestas de esa persona a los campos del concepto, en orden. */
  answers: { questionId: string; prompt: string; value: string }[];
}

/** Un concepto de la actividad, con todo lo que se aportó a él. */
export interface CollaborativeSection {
  groupId: string;
  /** Nombre del concepto tal y como lo escribió la docente. */
  title: string;
  questions: ResearchQuestion[];
  /** Quién es responsable. Vacío significa abierto a todo el grupo. */
  responsibles: CourseMember[];
  contributions: Contribution[];
  /** Estado del apartado en conjunto, para el recuento del profesorado. */
  state: ContributionState;
}

export interface CollaborativeView {
  assignmentId: string;
  title: string;
  courseName: string;
  collaborationMode: CollaborationMode;
  contributionVisibility: ContributionVisibility;
  sections: CollaborativeSection[];
  progress: { total: number; done: number; drafting: number; missing: number };
  /** Rol de quien mira. Decide si puede ver aportaciones ajenas. */
  viewerRole: CourseRole;
}

/** Aportación independiente de una persona a un paso del workflow. */
export interface WorkflowGroupContribution {
  author: CourseMember;
  state: ContributionState;
  /** Referencia opaca para abrir/revisar la entrega; nunca es el UID. */
  submissionId: string | null;
  /** `null` conserva explícitamente a quien todavía no ha hecho nada. */
  evidence: StepEvidence | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
}

/** Resultado agregado de UN paso, derivado de su audiencia y sus entregas. */
export interface WorkflowGroupStep {
  id: string;
  order: number;
  title: string;
  description: string;
  instructions: string;
  actionType: StepActionType;
  required: boolean;
  toolNames: string[];
  deliverables: StepDeliverable[];
  responsibles: CourseMember[];
  state: ContributionState;
  expectedParticipants: number;
  withEvidence: number;
  contributions: WorkflowGroupContribution[];
}

/** Vista docente derivada del resultado real de un workflow. No se persiste. */
export interface WorkflowGroupView {
  assignmentId: string;
  title: string;
  courseName: string;
  steps: WorkflowGroupStep[];
}

// ---------------------------------------------------------------------------
// Biblioteca colectiva de la materia (iteración 4)
//
// El cambio de fondo: los recursos dejan de ser sólo del profesorado. Un
// estudiante que encuentra una Skill útil o una herramienta nueva puede
// PROPONERLA, y si la docente la aprueba pasa a formar parte de la biblioteca
// oficial —conservando quién la aportó (§9)—.
// ---------------------------------------------------------------------------

/**
 * Estado de moderación (§8).
 *
 * `draft` es de quien lo escribe; `proposed` está esperando revisión;
 * `approved` está en la biblioteca; `rejected` y `archived` salen de ella sin
 * borrarse, para que quien lo propuso sepa qué pasó.
 *
 * El profesorado crea directamente en `approved`; el alumnado no puede saltarse
 * `proposed`, y eso lo decide el servidor, no el formulario.
 */
export type ResourceStatus = 'draft' | 'proposed' | 'approved' | 'rejected' | 'archived';

/** Autoría de un recurso. Se conserva SIEMPRE, también tras aprobarlo (§9). */
export interface ResourceAuthorship {
  /** Quién lo aportó. Handle, nunca UID. */
  author: CourseMember | null;
  status: ResourceStatus;
  /** Quién lo aprobó, si alguien lo hizo. */
  approvedBy: CourseMember | null;
  approvedAt: string | null;
  /** Destacado por la docente (§45). No hay ratings ni votos. */
  featured: boolean;
}

/** Los tipos que viven en la tabla general de recursos. */
export type CourseResourceType =
  | 'tool'
  | 'link'
  | 'guide'
  | 'video'
  | 'document'
  | 'template'
  | 'workflow'
  /** Aviso de la materia. Ver `courseResourceTypeSchema` para el porqué. */
  | 'announcement'
  | 'other';

/**
 * Recurso general de la materia.
 *
 * Prompts y Skills NO están aquí: tienen tablas propias porque tienen forma
 * propia —una Skill lleva métodos de instalación con pasos anidados— y porque
 * ya existían. Meterlos aquí habría exigido migrar tablas en producción para
 * ahorrar una consulta, y habría dejado la mitad de los campos vacíos según el
 * tipo. La UX sí los presenta juntos, que es lo que pedía §6.
 */
export interface CourseResource extends ResourceAuthorship {
  id: string;
  courseId: string;
  type: CourseResourceType;
  title: string;
  description: string;
  /** Enlace principal. Opcional: una guía puede ser sólo texto. */
  url: string | null;
  /** Para `tool`: cómo se usa. Para `guide`: la guía. */
  content: string;
  /** Para `tool`: categoría; para el resto, etiqueta libre de agrupación. */
  category: string;
  tags: string[];
  /**
   * Los pasos, cuando `type === 'workflow'`. Vacío en cualquier otro tipo.
   *
   * Una plantilla guarda el proceso, no una tarea: no tiene materia asignada,
   * ni fecha, ni estado de publicación. Crear una tarea desde ella CLONA los
   * pasos con identificadores nuevos (`cloneWorkflowSteps`), porque dos tareas
   * creadas desde la misma plantilla no pueden compartir claves de evidencia.
   */
  workflowSteps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CourseResourceRecord
  extends Omit<CourseResource, 'author' | 'approvedBy' | 'workflowSteps'> {
  publication?: { audienceCourseIds: string[]; reference?: PublicationReference; origin: 'teacher' | 'student' };
  workflowSteps: WorkflowStepRecord[];
  createdBy: string;
  /** Se guarda desnormalizado: el panel lista sin ir a buscar a cada persona. */
  authorHandle: string;
  authorName: string;
  approvedByUid: string | null;
  approvedByName: string;
}

// ---------------------------------------------------------------------------
// Workspace de programación (iteración 7)
//
// Un sitio donde escribir código que NO es una entrega. Hasta ahora todo el
// código de UINexus vivía dentro de `stepEvidence[stepId]` de una entrega, lo
// que significaba que para probar cinco líneas de Python había que tener una
// actividad abierta con fecha límite.
//
// ## Por qué una entidad nueva y no un campo más en la entrega
//
// Porque no comparten ciclo de vida. Una entrega pertenece a una actividad,
// tiene fecha límite, se revisa y se califica; una práctica es de quien la
// escribió, no caduca y nadie la corrige. Meter las dos en la misma tabla
// obligaría a que cada lectura preguntara «¿esto es entregable?», que es
// exactamente el tipo de campo que se acaba interpretando mal.
//
// ## Por qué NO se llama `PracticeCode`, `EditorCode` ni similar
//
// Un `Workspace` es el concepto general: un espacio con un lenguaje y unos
// archivos. Su `context` dice de quién depende. Hoy sólo existe el personal, y
// los otros dos están nombrados para que añadirlos no sea una tabla nueva —la
// misma razón por la que `ProgrammingLanguage` es un valor y no un booleano—.
// ---------------------------------------------------------------------------

/**
 * A qué pertenece un workspace.
 *
 * `personal` es una práctica de quien la escribió. Los otros dos están
 * declarados y NO implementados: una actividad guarda su código en
 * `stepEvidence` y ahí se queda, porque mover eso sería migrar entregas ya
 * calificadas para ganar una simetría que nadie ha pedido.
 */
export type WorkspaceContext = 'personal' | 'activity' | 'project';

/**
 * Los archivos de un workspace.
 *
 * `code` es la fuente de verdad de un workspace de un solo archivo, que es lo
 * único que existe hoy, y es un `string` por la misma razón que `CodeData.code`:
 * ya funciona y ya está probado.
 *
 * `files` es la puerta a varios archivos, y está OPCIONAL a propósito. Cuando
 * llegue, `code` seguirá siendo el archivo de entrada —el que se ejecuta— y
 * `files` el resto. Un workspace guardado hoy se leerá entonces sin migrar
 * nada; convertir `code` en `files` de golpe habría obligado a reescribir el
 * editor, el runner y todas las prácticas existentes a la vez.
 */
export interface WorkspaceFiles {
  code: string;
  files?: Record<string, string>;
}

/**
 * Qué clase de workspace es.
 *
 * `code` es el de un solo archivo con un lenguaje, que es lo que existía antes
 * de los NexBooks. Ausente significa `code`: las prácticas guardadas hasta
 * ahora se crearon cuando era la única forma, y reinterpretarlas sería
 * convertir en documento algo que nadie escribió como documento.
 *
 * Los dos comparten tabla, índice y dueño porque comparten ciclo de vida
 * —privados, sin fecha límite, de quien los escribió— y patrón de acceso: «los
 * míos, el último tocado primero». Un `kind` es más barato que dos tablas que
 * hay que consultar por separado para pintar UNA lista.
 */
export type WorkspaceKind = 'code' | 'nexbook';

export interface Workspace extends WorkspaceFiles {
  id: string;
  kind: WorkspaceKind;
  context: WorkspaceContext;
  title: string;
  language: ProgrammingLanguage;
  /** Materia con la que se relaciona, si nació dentro de una. */
  courseId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * El workspace tal y como se guarda.
 *
 * `ownerUid` no viaja nunca al navegador de otra persona: una práctica es
 * privada y sólo la lee su dueño, así que la API devuelve `Workspace` y este
 * registro se queda en el servidor.
 */
export interface WorkspaceRecord extends Workspace {
  ownerUid: string;
}

// ---------------------------------------------------------------------------
// NexBook (iteración 8)
//
// El documento computacional de UINexus: explicación, código ejecutable y
// resultados en un mismo sitio reproducible.
//
// ## Qué NO es
//
// No es un Jupyter Notebook con otro nombre. La diferencia que importa en el
// modelo es que aquí un OUTPUT NO ES UN BLOQUE: una gráfica que produce el
// código del alumnado no se convierte en un `ImageBlock` que luego se pueda
// editar a mano. Los bloques son lo que alguien escribió; los outputs son lo
// que la máquina contestó. Confundirlos es lo que hace imposible saber, al
// revisar, qué escribió el estudiante y qué salió de ejecutar.
//
// ## Un solo NexBook, no cuatro
//
// No hay `PersonalNexBook`, `TeacherNexBook` ni `SubmittedNexBook`. Hay UN
// documento con un `context` que dice de quién depende y una `visibility` que
// dice quién lo ve. Cuatro entidades incompatibles habrían obligado a duplicar
// el editor, el autoguardado y los kernels cuatro veces.
// ---------------------------------------------------------------------------

/** Versión del esquema del documento. Nunca se confía en que no cambiará. */
export const NEXBOOK_FORMAT_VERSION = 1;

/**
 * Un bloque de explicación, en Markdown.
 *
 * El Markdown se renderiza SANITIZADO (ver `components/aula/markdown-content.tsx`):
 * un documento que un docente reparte a treinta personas no puede ejecutar
 * JavaScript de quien lo escribió.
 */
export interface NexBookMarkdownBlock {
  id: string;
  type: 'markdown';
  source: string;
  /**
   * Si el alumnado puede tocarlo cuando el documento viene de una plantilla.
   *
   * Ausente significa `true`: los bloques de un laboratorio personal son todos
   * suyos, y sólo una plantilla docente tiene razones para bloquear alguno
   * —«# Instrucciones» sí, «# Escribe tu conclusión» no—.
   */
  editableByStudent?: boolean;
}

export interface NexBookCodeBlock {
  id: string;
  type: 'code';
  /**
   * El lenguaje es una PROPIEDAD, no un tipo de bloque.
   *
   * No hay `PythonBlock` ni `RBlock` por la misma razón que no hay `REditor`:
   * duplicar el bloque por lenguaje duplicaría también su ejecución, su
   * autoguardado y su consola. Qué se puede hacer con cada uno lo dice
   * `languageCapabilities()`.
   */
  language: ProgrammingLanguage;
  source: string;
  editableByStudent?: boolean;
}

/**
 * Una imagen que forma parte del DOCUMENTO.
 *
 * No confundir con `NexBookImageOutput`, que es lo que devolvió una ejecución.
 * La diferencia no es cosmética: un bloque es lo que alguien decidió poner ahí y
 * una salida es lo que contestó la máquina. Por eso una gráfica generada por
 * código NO se convierte sola en un `ImageBlock`: al revisar dejaría de poderse
 * distinguir qué escribió cada persona y qué salió de ejecutar.
 *
 * Los bytes viven en el almacén de assets. El bloque lleva la referencia y lo
 * que hace falta para pintarlo bien sin haberlo descargado todavía —dimensiones,
 * para reservar el hueco y no dar un salto de layout—.
 */
export interface NexBookImageBlock {
  id: string;
  type: 'image';
  assetId: string;
  mimeType: NexBookImageMimeType;
  /**
   * Texto alternativo. Obligatorio en el tipo, vacío SÓLO si es decorativa.
   *
   * Se pide siempre en la interfaz porque una imagen sin alternativa en un
   * documento académico deja fuera a quien use un lector de pantalla, y el
   * momento de escribirla es cuando se sabe qué representa.
   */
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Hoja de cálculo
// ---------------------------------------------------------------------------

/**
 * Lo que hay en una celda de una hoja.
 *
 * Se guarda lo que la persona ESCRIBIÓ (`input`), no lo que se calculó. Guardar
 * el resultado como si fuera el dato convierte `=SUMA(A1:A3)` en un número
 * suelto la primera vez que alguien reabre el documento, y entonces la hoja deja
 * de recalcular. El valor calculado se deriva al abrir y no se persiste.
 */
export interface NexBookSheetCell {
  /** Texto tal cual, incluida la fórmula con su `=` inicial si la hay. */
  input: string;
}

/**
 * Una hoja, DISPERSA.
 *
 * Las celdas se indexan por `"fila:columna"` en vez de una matriz completa
 * porque una hoja de 50 × 20 con seis datos ocuparía 1 000 huecos vacíos en el
 * JSON. Con el presupuesto de 300 KB del documento eso no es un detalle.
 */
export interface NexBookSheetData {
  rows: number;
  columns: number;
  /** Clave `"<fila>:<columna>"`, base 0. Sólo las celdas con contenido. */
  cells: Record<string, NexBookSheetCell>;
  /** Nombre de las columnas, si quien hizo la hoja les puso uno. */
  headers?: string[];
}

/**
 * Una hoja de cálculo dentro del documento.
 *
 * `name` existe para poder referirse a ella —«Ventas»— desde el puente que
 * conectará la hoja con Python y R. Ver `lib/spreadsheet/bridge.ts`.
 */
export interface NexBookSpreadsheetBlock {
  id: string;
  type: 'spreadsheet';
  name: string;
  sheet: NexBookSheetData;
  editableByStudent?: boolean;
}

/**
 * Los bloques declarados.
 *
 * La unión está discriminada por `type` para que añadir uno sea añadir un
 * miembro y un `case`. No se declara ninguno antes de existir: un tipo que
 * ninguna pantalla sabe pintar produce documentos que nadie puede abrir. Por eso
 * `image` y `spreadsheet` entran en la iteración 9 —con su renderizador, su
 * almacén y su exportación— y `AIBlock` y `ChartBlock` siguen sin estar aquí:
 * ver `docs/NEXBOOK.md`.
 */
export type NexBookBlock =
  | NexBookMarkdownBlock
  | NexBookCodeBlock
  | NexBookImageBlock
  | NexBookSpreadsheetBlock;

export type NexBookBlockType = NexBookBlock['type'];

/**
 * Lo que devolvió una ejecución, en ORDEN.
 *
 * `seq` existe porque el orden cronológico es información: un programa que
 * imprime, falla y vuelve a imprimir cuenta una historia que se pierde si
 * stdout y stderr se guardan en dos montones separados. Desde la iteración 9 ese
 * orden es REAL y no reconstruido: ver `NexBookTextOutput`.
 */
export type NexBookOutput =
  | NexBookTextOutput
  | NexBookTableOutput
  | NexBookImageOutput
  | NexBookJsonOutput;

/**
 * Los flujos de V1, y por qué `stream` sigue siendo el discriminante.
 *
 * Los tipos ricos llegaron como valores NUEVOS de este campo y no como una forma
 * distinta de output, que es exactamente lo que V1 anticipó. La consecuencia
 * práctica importa: un documento guardado en la iteración 8 —`{ seq, stream:
 * 'stdout', text }`— sigue validando sin tocar un byte, así que
 * `NEXBOOK_FORMAT_VERSION` NO sube y no hace falta migración. Un discriminante
 * nuevo (`type`) habría obligado a reescribir cada `results` almacenado, cada
 * snapshot de entrega y cada export, a cambio de un nombre más bonito.
 */
export type NexBookOutputStream = 'stdout' | 'stderr' | 'error';

/**
 * Texto, con el flujo del que salió.
 *
 * El orden entre stdout y stderr es el REAL desde la iteración 9: Pyodide
 * entrega sus dos flujos por llamadas según se escriben, y `captureR` devuelve
 * un array ya ordenado. El motor sólo tenía que dejar de tirar esa información
 * juntándola en dos cadenas. Ver `code-engines/output-recorder.ts`.
 */
export interface NexBookTextOutput {
  seq: number;
  stream: NexBookOutputStream;
  text: string;
  /** Se marcó porque se alcanzó el límite, no porque el programa acabara. */
  truncated?: boolean;
}

/** Un valor de celda. Sólo primitivos: una tabla no anida documentos. */
export type NexBookCellValue = string | number | boolean | null;

/**
 * Datos tabulares, ESTRUCTURADOS.
 *
 * No es el HTML que imprima pandas ni el texto que imprima R: son columnas y
 * filas, y quien las pinta es UINexus. Aceptar HTML de la biblioteca habría
 * significado renderizar marcado que genera el código del alumnado, que es justo
 * lo que `MarkdownContent` lleva todo el proyecto evitando.
 */
export interface NexBookTableOutput {
  seq: number;
  stream: 'table';
  columns: string[];
  rows: NexBookCellValue[][];
  /**
   * Cuántas filas tenía el original.
   *
   * Se recorta a `NEXBOOK_LIMITS.maxTableRows` y se dice: una tabla que enseña
   * 50 de 10 000 filas sin avisar es una mentira sobre los datos.
   */
  totalRows: number;
  truncated?: boolean;
}

/**
 * Una imagen, POR REFERENCIA.
 *
 * Los bytes viven en el almacén de assets (S3), nunca dentro del documento. Una
 * gráfica de 30 KB en Base64 son 40 KB de los 300 KB del item de DynamoDB: tres
 * gráficas y el documento deja de poder guardarse. Ver `docs/NEXBOOK.md`.
 */
export interface NexBookImageOutput {
  seq: number;
  stream: 'image';
  assetId: string;
  mimeType: NexBookImageMimeType;
  width?: number;
  height?: number;
  /** Qué representa, para quien no la ve. Lo pone quien genera la salida. */
  alt?: string;
}

/** Los tipos de imagen que UINexus almacena. Sin SVG: ver `docs/SECURITY.md`. */
export type NexBookImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Un valor JSON, para lo que no es ni texto ni tabla ni imagen. */
export type NexBookJsonValue =
  | string
  | number
  | boolean
  | null
  | NexBookJsonValue[]
  | { [key: string]: NexBookJsonValue };

export interface NexBookJsonOutput {
  seq: number;
  stream: 'json';
  value: NexBookJsonValue;
  truncated?: boolean;
}

/** El resultado de ejecutar UNA celda, tal y como se guarda con el bloque. */
export interface NexBookCellResult {
  blockId: string;
  status: 'ok' | 'failed' | 'timeout' | 'stopped' | 'rejected';
  outputs: NexBookOutput[];
  durationMs: number;
  /** Cuándo se ejecutó. Al revisar importa si la salida es de este código. */
  ranAt: string;
}

/**
 * De qué depende un NexBook.
 *
 * `workflow` lleva la actividad Y el paso: un mismo alumno puede tener dos
 * NexBooks en la misma actividad si son dos pasos distintos, y sin `stepId` no
 * habría forma de distinguirlos.
 */
export type NexBookContext =
  | { type: 'personal' }
  | { type: 'workflow'; assignmentId: string; stepId: string; role: 'template' | 'instance' };

/**
 * Quién puede verlo.
 *
 * Sólo `private` está implementado en V1, y por eso es lo único que la interfaz
 * ofrece. Los otros tres están NOMBRADOS para que activarlos no sea una
 * migración; enseñarlos antes de que funcionen sería prometer un botón que no
 * hace nada.
 */
export type NexBookVisibility = 'private' | 'class' | 'link' | 'public';

export interface NexBookDocument {
  formatVersion: number;
  blocks: NexBookBlock[];
  /**
   * Los outputs, indexados por bloque y FUERA de los bloques.
   *
   * Separarlos es lo que hace que borrar la salida no toque el código, que un
   * output enorme no infle el bloque, y que la instantánea de una entrega pueda
   * llevar el código con o sin resultados según convenga.
   */
  results: Record<string, NexBookCellResult>;
}

export interface NexBook {
  id: string;
  title: string;
  context: NexBookContext;
  visibility: NexBookVisibility;
  document: NexBookDocument;
  /**
   * Contador de escrituras, para concurrencia optimista.
   *
   * Cada guardado exige la revisión que el cliente creía tener. Dos pestañas
   * abiertas no se pisan en silencio: la segunda recibe un 409 y la interfaz
   * puede decir qué pasó, en vez de que gane la última en llegar.
   */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Como se guarda. `ownerUid` no viaja al navegador de nadie más. */
export interface NexBookRecord extends NexBook {
  ownerUid: string;
}

/**
 * Una fila de la lista de Prácticas, sea del tipo que sea.
 *
 * Es lo MÍNIMO que la lista necesita, y eso es deliberado: sin esto habría que
 * mandar al navegador el documento entero de cada NexBook —cientos de KB— sólo
 * para pintar un título y una fecha.
 */
export interface WorkspaceSummary {
  id: string;
  kind: WorkspaceKind;
  title: string;
  /** Sólo con `kind: 'code'`. Un NexBook puede tener varios lenguajes. */
  language: ProgrammingLanguage | null;
  /** Sólo con `kind: 'nexbook'`. Cuántos bloques tiene. */
  blockCount: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Assets (iteración 9)
// ---------------------------------------------------------------------------

/**
 * Un binario que pertenece a un NexBook y NO vive dentro de él.
 *
 * ## Por qué no hay tabla de assets
 *
 * Porque no hace falta, y una tabla nueva es un recurso de AWS nuevo. Todo lo
 * que identifica un asset cabe en su CLAVE de S3, que construye el servidor:
 *
 * ```
 * nexbook/<ownerUid>/<nexbookId>/<assetId>.<ext>
 * ```
 *
 * La propiedad es entonces ESTRUCTURAL —la clave se arma con el uid del token,
 * nunca con lo que mande el cliente— igual que ya ocurre con los archivos
 * académicos. Y la autorización de lectura no sale del asset sino del DOCUMENTO
 * que lo referencia: quien puede abrir el NexBook puede ver sus imágenes, y
 * quien puede abrir una publicación puede ver las suyas. Un asset que ningún
 * documento menciona no lo lee nadie.
 */
export interface NexBookAssetRef {
  assetId: string;
  mimeType: NexBookImageMimeType;
  bytes: number;
  width?: number;
  height?: number;
}

/** De dónde salió un asset. Cambia quién lo borra y cuándo. */
export type NexBookAssetOrigin = 'upload' | 'output';

// ---------------------------------------------------------------------------
// Publicación (iteración 9)
// ---------------------------------------------------------------------------

/**
 * Un NexBook publicado.
 *
 * ## Publicar es CONGELAR, no cambiar un interruptor
 *
 * Poner `visibility: 'public'` sobre el documento vivo habría significado que
 * cada pulsación en el editor se publica al instante: un experimento a medias, un
 * dato de prueba o un error escrito a la una de la mañana quedan expuestos sin
 * que nadie lo decida. Aquí publicar produce una COPIA, igual que entregar:
 *
 * ```
 * NexBook vivo  ──Publicar──▶  NexBookPublication (inmutable)
 *      │                                  ▲
 *      └──────Actualizar publicación──────┘
 * ```
 *
 * El autor sigue trabajando y lo publicado no se mueve hasta que lo diga.
 */
export interface NexBookPublication {
  /** El identificador que viaja en la URL. No es el id del NexBook vivo. */
  slug: string;
  title: string;
  /** El documento congelado en el momento de publicar. */
  document: NexBookDocument;
  visibility: NexBookPublicVisibility;
  /** De qué revisión del original salió. Para poder decir «hay cambios nuevos». */
  sourceRevision: number;
  publishedAt: string;
  updatedAt: string;
  /** Nombre para mostrar de quien publica. NUNCA su uid ni su correo. */
  authorName: string;
}

/**
 * Quién puede ver una publicación.
 *
 * `private` no aparece: un documento privado sencillamente no se publica, no se
 * publica «en privado». Los tres valores que quedan son los que de verdad
 * cambian quién puede leer.
 */
export type NexBookPublicVisibility = Exclude<NexBookVisibility, 'private'>;

/** Como se guarda una publicación. `ownerUid` no viaja a ningún navegador. */
export interface NexBookPublicationRecord extends NexBookPublication {
  ownerUid: string;
  /** El NexBook del que salió, para poder actualizarla. Nunca se expone. */
  sourceNexbookId: string;
}

/**
 * Lo que se entregó, congelado.
 *
 * Una entrega NO apunta al NexBook vivo: lleva una COPIA. Si apuntara, seguir
 * trabajando después de entregar cambiaría lo que la docente califica, y no
 * habría forma de saber qué se entregó de verdad. `revision` dice de qué
 * versión salió la copia.
 */
export interface NexBookSubmissionData {
  nexbookId: string;
  revision: number;
  snapshot: NexBookDocument;
  submittedAt: string;
  /** El título en el momento de entregar: renombrarlo después no lo cambia. */
  title: string;
}
