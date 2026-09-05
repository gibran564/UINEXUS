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
  | 'resource_reference';

export interface StepDeliverable {
  type: DeliverableType;
  required: boolean;
  /** Ayuda concreta: «pega los cinco enlaces, uno por línea». */
  hint: string;
  /** Sólo cuando `type === 'structured'`: los campos que se rellenan. */
  questions: ResearchQuestion[];
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
    'assignedTo' | 'assignedToAll' | 'groupAssignments' | 'workflow'
  > {
  /** `null` significa TODO EL GRUPO. Una lista, asignación selectiva por UID. */
  assignedTo: string[] | null;
  /** Responsables por concepto, en UID. */
  groupAssignments: GroupAssignmentRecord[];
  /** Pasos con sus responsables en UID. */
  workflow: WorkflowStepRecord[];
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

/** Evidencia que consiste en señalar recursos de la materia. */
export interface ResourceSelectionData {
  refs: ResourceRef[];
  note: string;
}

export type SubmissionData =
  | ResearchData
  | AIWorklogData
  | WebProjectData
  | ExternalLinkData
  | FreeformData
  | MediaData
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
