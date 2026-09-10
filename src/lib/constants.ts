import type {
  AcademicFileClass,
  AIProvider,
  AssignmentMaterialKind,
  AssignmentStatus,
  AssignmentType,
  ProjectStatus,
  DeliverableType,
  ProgrammingLanguage,
  ProjectType,
  SortOption,
  StepActionType,
  SubmissionStatus,
  ToolChoiceMode,
} from './types';

/** Límites de subida. Se replican en las reglas de Storage: el cliente avisa,
 *  el servidor decide. Cambiar aquí implica cambiar storage.rules. */
export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 10 MB por archivo
  maxProjectBytes: 50 * 1024 * 1024, // 50 MB por proyecto
  maxFiles: 300,
  maxZipBytes: 30 * 1024 * 1024,
  maxCoverBytes: 3 * 1024 * 1024,
  maxProjectsPerUser: 30,
  maxTags: 6,
  titleMax: 90,
  descriptionMax: 600,
} as const;

/**
 * Lista blanca de extensiones. Es la misma que aplican storage.rules y la
 * el origen aislado. El servidor la aplica al firmar la subida y fija con ella
 * el Content-Type del objeto en S3.
 */
export const ALLOWED_EXTENSIONS = [
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map', 'txt', 'md', 'csv', 'xml',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf',
  'mp4', 'webm', 'ogg', 'mp3', 'wav', 'pdf',
] as const;

export const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', map: 'application/json',
  txt: 'text/plain', md: 'text/plain', csv: 'text/csv', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
};

export interface ProjectTypeOption {
  value: ProjectType;
  label: string;
  helper: string;
  example: string;
}

/** Las tres puertas de entrada al flujo de publicación. Lenguaje sin jerga. */
export const PROJECT_TYPES: readonly ProjectTypeOption[] = [
  {
    value: 'html',
    label: 'Página HTML',
    helper: 'Tienes un archivo index.html, quizá con su CSS y sus imágenes.',
    example: 'index.html + styles.css',
  },
  {
    value: 'site',
    label: 'Sitio web completo',
    helper: 'Tienes una carpeta con varias páginas. Súbela comprimida en .zip.',
    example: 'mi-sitio.zip',
  },
  {
    value: 'build',
    label: 'Proyecto compilado',
    helper: 'Ya ejecutaste "build" en React, Vite, Astro… Sube la carpeta dist.',
    example: 'dist.zip / out.zip',
  },
];

/** Categorías visibles en el filtro rápido. Son etiquetas curadas, no un campo
 *  aparte: así el alumno etiqueta libre y la galería sigue teniendo orden. */
export const PRIMARY_CATEGORIES = [
  'UX', 'UI', 'Prototipos', 'Accesibilidad', 'Rediseños',
] as const;

export const SECONDARY_CATEGORIES = [
  'Investigación', 'Aplicaciones', 'Web', 'Experimentos', 'Design system',
  'Mobile', 'Data viz', 'Tipografía',
] as const;

export const ALL_CATEGORIES = [...PRIMARY_CATEGORIES, ...SECONDARY_CATEGORIES];

export const SORT_OPTIONS: readonly { value: SortOption; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'featured', label: 'Destacados primero' },
  { value: 'popular', label: 'Más vistos' },
  { value: 'alphabetical', label: 'A – Z' },
];

export const STATUS_LABEL: Readonly<Record<ProjectStatus, string>> = {
  published: 'Publicado',
  unlisted: 'Sólo con enlace',
  draft: 'Borrador',
  archived: 'Archivado',
};

export const STATUS_HELP: Readonly<Record<ProjectStatus, string>> = {
  published: 'Aparece en la galería y cualquiera puede abrirlo.',
  unlisted: 'No aparece en la galería. Sólo quien tenga el enlace puede verlo.',
  draft: 'Sólo tú puedes verlo. Nadie más, ni con el enlace.',
  archived: 'Fuera de circulación. Conservas los archivos.',
};

export const PROJECT_TYPE_LABEL: Readonly<Record<ProjectType, string>> = {
  html: 'Página HTML',
  site: 'Sitio web',
  build: 'Proyecto compilado',
};

export const SITE = {
  name: 'UINexus',
  tagline: 'Diseña. Publica. Comparte.',
  description:
    'Galería y hosting de proyectos web para clases de diseño centrado en el usuario. ' +
    'Publica tu página, obtén un enlace y compártelo.',
} as const;

// ---------------------------------------------------------------------------
// Capa académica (iteración 2)
// ---------------------------------------------------------------------------

export const ACADEMIC_LIMITS = {
  maxAssignmentsPerCourse: 200,
  maxResearchQuestions: 60,
  maxResourceLinks: 10,
  maxStudentsPerCourse: 300,
  /** Un campo de respuesta larga. Suficiente para una definición razonada. */
  answerMax: 4000,
  promptMax: 8000,
  titleMax: 120,
  descriptionMax: 1500,
  instructionsMax: 4000,
  maxInstallMethods: 8,
  maxInstallSteps: 20,
  maxPromptsPerCourse: 100,
  maxSkillsPerCourse: 100,
  /** Archivos que el profesorado puede repartir en UNA tarea. */
  maxMaterialsPerAssignment: 20,
  /** Un fuente pegado en un paso de código. Suficiente para un modelo entero. */
  codeMax: 60000,
} as const;

export interface AssignmentTypeOption {
  value: AssignmentType;
  label: string;
  helper: string;
  /** Lo que dice el botón que abre la entrega. Ver §6 del encargo. */
  action: string;
}

/**
 * Los cinco tipos de entrega. El texto está escrito para quien crea la tarea,
 * no para quien programó el enum: describe lo que va a tener que hacer el
 * alumnado, que es lo único que ayuda a elegir bien.
 */
export const ASSIGNMENT_TYPES: readonly AssignmentTypeOption[] = [
  {
    value: 'research',
    label: 'Investigación estructurada',
    helper:
      'Tú defines los campos y el alumnado los rellena dentro de UINexus. Sustituye al documento de Word.',
    action: 'Comenzar tarea',
  },
  {
    value: 'ai_worklog',
    label: 'AI Worklog',
    helper:
      'El alumnado documenta cómo usó una IA: objetivo, prompt, resultado y qué decidió con él.',
    action: 'Crear AI Worklog',
  },
  {
    value: 'web_project',
    label: 'Proyecto web',
    helper: 'Se entrega un proyecto ya publicado en UINexus. No se duplica: se referencia.',
    action: 'Elegir proyecto',
  },
  {
    value: 'external_link',
    label: 'Enlace externo',
    helper: 'Figma, Miro, Canva, GitHub… Se guarda el enlace con su título y descripción.',
    action: 'Registrar entrega',
  },
  {
    value: 'freeform',
    label: 'Entrega libre',
    helper: 'Un texto y, si hacen falta, enlaces. Para lo que no encaja en los demás tipos.',
    action: 'Comenzar tarea',
  },
];

export const ASSIGNMENT_TYPE_LABEL: Readonly<Record<AssignmentType, string>> =
  Object.fromEntries(
    ASSIGNMENT_TYPES.map((option) => [option.value, option.label])
  ) as Record<AssignmentType, string>;

export const ASSIGNMENT_STATUS_LABEL: Readonly<Record<AssignmentStatus, string>> = {
  draft: 'Borrador',
  published: 'Publicada',
  closed: 'Cerrada',
};

export const SUBMISSION_STATUS_LABEL: Readonly<Record<SubmissionStatus, string>> = {
  draft: 'Borrador',
  submitted: 'Entregado',
  reviewed: 'Revisado',
  needs_changes: 'Requiere cambios',
};

export const SUBMISSION_STATUS_HELP: Readonly<Record<SubmissionStatus, string>> = {
  draft: 'Sólo tú lo ves. Puedes seguir editándolo.',
  submitted: 'Entregado. El profesorado ya puede leerlo.',
  reviewed: 'Revisado por el profesorado.',
  needs_changes: 'El profesorado pidió cambios. Puedes volver a editarlo y entregar otra vez.',
};

export const AI_PROVIDERS: readonly AIProvider[] = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Copilot',
  'Other',
];

/** Sugerencias de modelo. Es una ayuda, no una lista cerrada: el campo es libre. */
export const AI_MODEL_SUGGESTIONS: Readonly<Record<AIProvider, string[]>> = {
  ChatGPT: ['GPT-5', 'GPT-4o', 'GPT-4.1', 'o3'],
  Claude: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'Claude Haiku 4.5'],
  Gemini: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash'],
  Copilot: ['GitHub Copilot', 'Microsoft Copilot'],
  Other: [],
};

/**
 * Proveedores reconocidos de enlaces externos. El `match` sirve para decir
 * «esto es un recurso de Figma» sin pedirle al alumnado que lo clasifique.
 */
export const LINK_PROVIDERS: readonly { value: string; label: string; match: RegExp | null }[] = [
  { value: 'figma', label: 'Figma', match: /(^|\.)figma\.com$/ },
  { value: 'miro', label: 'Miro', match: /(^|\.)miro\.com$/ },
  { value: 'canva', label: 'Canva', match: /(^|\.)canva\.com$/ },
  { value: 'github', label: 'GitHub', match: /(^|\.)github\.(com|io)$/ },
  { value: 'other', label: 'Otro', match: null },
];

/** Filtros del panel docente. §4 del encargo. */
export const SUBMISSION_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'submitted', label: 'Entregó' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'reviewed', label: 'Revisado' },
  { value: 'unreviewed', label: 'Sin revisar' },
] as const;

export type SubmissionFilter = (typeof SUBMISSION_FILTERS)[number]['value'];

// ---------------------------------------------------------------------------
// Workflow académico (iteración 4)
// ---------------------------------------------------------------------------

export const WORKFLOW_LIMITS = {
  maxSteps: 25,
  maxDeliverablesPerStep: 3,
  maxToolsPerStep: 6,
  maxToolsPerCourse: 100,
  stepTitleMax: 120,
  toolNameMax: 80,
} as const;

export interface StepActionOption {
  value: StepActionType;
  /** Lo que dice el botón que añade el paso. §36: son atajos de UX. */
  label: string;
  helper: string;
  /** Entregable con el que se crea el paso. Se puede cambiar después. */
  deliverable: DeliverableType;
  /** Modo de herramienta por defecto. */
  toolMode: ToolChoiceMode;
}

/**
 * Los atajos del constructor (§36).
 *
 * Son PRESETS DE INTERFAZ, no tipos del backend: cada uno rellena un paso con
 * valores razonables y a partir de ahí todo es editable. Por eso `actionType`
 * sigue siendo una cadena abierta: añadir un atajo aquí es una mejora de
 * comodidad, no un requisito para poder modelar algo.
 */
export const STEP_ACTIONS: readonly StepActionOption[] = [
  {
    value: 'instruction',
    label: 'Instrucción',
    helper: 'Algo que hay que hacer o leer. No pide entrega.',
    deliverable: 'none',
    toolMode: 'none',
  },
  {
    value: 'ai_interaction',
    label: 'Usar IA',
    helper: 'Trabajar con una IA y documentar cómo. Entrega un AI Worklog.',
    deliverable: 'ai_worklog',
    toolMode: 'choice',
  },
  {
    value: 'external_tool',
    label: 'Usar herramienta',
    helper: 'Perplexity, NotebookLM, Miro, Napkin… Entrega el enlace del resultado.',
    deliverable: 'url',
    toolMode: 'required',
  },
  {
    value: 'text_response',
    label: 'Responder',
    helper: 'Una respuesta escrita.',
    deliverable: 'text',
    toolMode: 'none',
  },
  {
    value: 'structured_response',
    label: 'Respuesta estructurada',
    helper: 'Campos que tú defines: conceptos, definiciones, fuentes…',
    deliverable: 'structured',
    toolMode: 'none',
  },
  {
    value: 'link_submission',
    label: 'Añadir enlace',
    helper: 'Un enlace a algo hecho fuera: Figma, un tablero, un documento.',
    deliverable: 'url',
    toolMode: 'free',
  },
  {
    value: 'upload',
    label: 'Subir archivo',
    helper: 'Imagen, PDF o video. Hoy se entrega como enlace.',
    deliverable: 'file',
    toolMode: 'none',
  },
  {
    value: 'video',
    label: 'Video',
    helper: 'Un video hecho con IA o grabado. Enlace de HeyGen, YouTube o Drive.',
    deliverable: 'video',
    toolMode: 'free',
  },
  {
    value: 'project',
    label: 'Proyecto UINexus',
    helper: 'Se entrega un proyecto ya publicado. Se referencia, no se duplica.',
    deliverable: 'project',
    toolMode: 'none',
  },
  {
    value: 'code',
    label: 'Desarrollo con código',
    helper: 'Se resuelve programando. Se pega el código y, si quieres, se adjunta el archivo.',
    deliverable: 'code',
    toolMode: 'none',
  },
  {
    value: 'reflection',
    label: 'Reflexión',
    helper: '¿Qué cambiaste respecto a lo que propuso la IA?',
    deliverable: 'text',
    toolMode: 'none',
  },
  {
    value: 'custom',
    label: 'Personalizado',
    helper: 'Cuando ninguno de los anteriores describe lo que quieres pedir.',
    deliverable: 'text',
    toolMode: 'free',
  },
];

export const STEP_ACTION_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  STEP_ACTIONS.map((option) => [option.value, option.label])
);

/** Etiqueta legible de una acción, incluidas las que no están en el catálogo. */
export function stepActionLabel(action: StepActionType): string {
  return STEP_ACTION_LABEL[action] ?? 'Paso';
}

export const DELIVERABLE_LABEL: Readonly<Record<DeliverableType, string>> = {
  none: 'Sin entrega',
  text: 'Texto',
  url: 'Enlace',
  file: 'Documento',
  image: 'Imagen',
  video: 'Video',
  ai_worklog: 'AI Worklog',
  structured: 'Respuesta estructurada',
  project: 'Proyecto de UINexus',
  code: 'Código',
  resource_reference: 'Recursos de la materia',
};

// ---------------------------------------------------------------------------
// Programación
// ---------------------------------------------------------------------------

export interface ProgrammingLanguageOption {
  value: ProgrammingLanguage;
  label: string;
  /** Extensión canónica del fuente. Decide qué acepta el selector de archivo. */
  extension: string;
  /**
   * Si se puede elegir HOY al crear un paso.
   *
   * Los deshabilitados están nombrados a propósito: el modelo ya los admite —una
   * tarea guardada con `python` se lee sin problema— y encenderlos el día que
   * haga falta es cambiar este booleano y añadir su extensión a
   * `ACADEMIC_FILE_EXTENSIONS.code`. No hay nada más que rehacer, y ésa es toda
   * la razón de que el lenguaje sea un valor y no un `isR`.
   */
  enabled: boolean;
}

export const PROGRAMMING_LANGUAGES: readonly ProgrammingLanguageOption[] = [
  { value: 'r', label: 'R', extension: 'r', enabled: true },
  { value: 'python', label: 'Python', extension: 'py', enabled: false },
  { value: 'javascript', label: 'JavaScript', extension: 'js', enabled: false },
  { value: 'java', label: 'Java', extension: 'java', enabled: false },
  { value: 'cpp', label: 'C / C++', extension: 'cpp', enabled: false },
  { value: 'sql', label: 'SQL', extension: 'sql', enabled: false },
];

export const ENABLED_PROGRAMMING_LANGUAGES = PROGRAMMING_LANGUAGES.filter(
  (language) => language.enabled
);

/** El lenguaje con el que nace un paso de código. */
export const DEFAULT_PROGRAMMING_LANGUAGE: ProgrammingLanguage = 'r';

export function programmingLanguageLabel(language: ProgrammingLanguage | null | undefined): string {
  if (!language) return 'Sin lenguaje';
  return (
    PROGRAMMING_LANGUAGES.find((option) => option.value === language)?.label ?? String(language)
  );
}

export const TOOL_MODE_LABEL: Readonly<Record<ToolChoiceMode, string>> = {
  none: 'Sin herramienta',
  required: 'Herramienta obligatoria',
  choice: 'Elegir entre varias',
  free: 'Cualquier herramienta',
};

/**
 * Herramientas que se ofrecen al crear el catálogo de una materia.
 *
 * Son SUGERENCIAS para no empezar con una pantalla vacía, no una lista cerrada:
 * la docente puede escribir cualquier otra y aparece igual (§13). El día que
 * salga una herramienta nueva, nadie tiene que tocar este archivo.
 */
export const SUGGESTED_TOOLS: readonly { name: string; url: string; category: string }[] = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', category: 'IA conversacional' },
  { name: 'Claude', url: 'https://claude.ai', category: 'IA conversacional' },
  { name: 'Gemini', url: 'https://gemini.google.com', category: 'IA conversacional' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', category: 'Búsqueda' },
  { name: 'NotebookLM', url: 'https://notebooklm.google.com', category: 'Investigación' },
  { name: 'Napkin', url: 'https://www.napkin.ai', category: 'Visualización' },
  { name: 'Miro', url: 'https://miro.com', category: 'Pizarra' },
  { name: 'Figma', url: 'https://figma.com', category: 'Diseño' },
  { name: 'Canva', url: 'https://canva.com', category: 'Diseño' },
  { name: 'HeyGen', url: 'https://heygen.com', category: 'Video' },
  { name: 'Gamma', url: 'https://gamma.app', category: 'Presentaciones' },
  { name: 'GitHub', url: 'https://github.com', category: 'Código' },
];

export const TOOL_CATEGORIES = [
  'IA conversacional',
  'Búsqueda',
  'Investigación',
  'Visualización',
  'Pizarra',
  'Diseño',
  'Video',
  'Presentaciones',
  'Código',
  'Otra',
] as const;

/**
 * Límites de los archivos académicos (§«Límites por tipo»).
 *
 * Separados de `LIMITS` a propósito: un video de una presentación con avatar no
 * es una portada de proyecto, y reutilizar el límite de la portada —3 MB—
 * haría inservible el entregable. Cada tipo tiene el suyo, y el servidor lo
 * aplica en la condición `content-length-range` del POST firmado, que es el
 * único sitio donde un límite es real.
 */
export const ACADEMIC_FILE_LIMITS: Readonly<Record<AcademicFileClass, number>> = {
  image: 8 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  /** Un fuente no pesa: un límite generoso aquí sólo invita a subir un binario. */
  code: 2 * 1024 * 1024,
  /** Material del profesorado: un caso de estudio o un dataset, no un video. */
  material: 25 * 1024 * 1024,
};

/**
 * Extensiones admitidas por clase, con el `Content-Type` que les corresponde.
 *
 * ## Por qué manda la EXTENSIÓN y no lo que declare el navegador
 *
 * El `Content-Type` que manda el navegador no es un dato fiable: para un `.R`
 * suele llegar vacío o `application/octet-stream`, y para un `.docx` depende del
 * sistema. Decidir por extensión —igual que hace `presignProjectUpload` con los
 * proyectos— es lo que permite admitir un fuente de R sin abrir la puerta a
 * cualquier binario, porque el tipo del objeto lo FIJA el servidor en la
 * condición del POST firmado a partir de esta tabla.
 *
 * Lo que no está, no entra. No hay `.exe`, `.bat`, `.sh`, `.js`, `.html` ni
 * `.svg`: los tres primeros son ejecutables, y los dos últimos se sirven como
 * contenido activo (un SVG puede llevar script dentro).
 */
export const ACADEMIC_FILE_EXTENSIONS: Readonly<
  Record<AcademicFileClass, Readonly<Record<string, string>>>
> = {
  image: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
  },
  document: {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Un fuente de R entregado como archivo. Se guarda y se sirve como texto:
    // UINexus no lo ejecuta nunca (ver docs/SECURITY.md).
    r: 'text/plain',
    /**
     * Imágenes en un entregable de DOCUMENTO, y no es un descuido.
     *
     * Media Investigación de Operaciones se resuelve a mano: las iteraciones de
     * un Simplex, una matriz de transporte o un diagrama de red se entregan como
     * la foto de la hoja. Obligar a convertirla a PDF antes de subirla sólo
     * conseguiría que se entregue peor, o por WhatsApp.
     */
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  },
  video: {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
  },
  code: {
    r: 'text/plain',
  },
  material: {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    r: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  },
};

/**
 * Tipos MIME admitidos por clase.
 *
 * Segunda mitad de la lista blanca: se usa cuando el nombre del archivo no trae
 * una extensión reconocible, y para desmentir un tipo declarado que no
 * corresponde a la clase. Sigue siendo lista blanca: lo que no está, no entra.
 */
export const ACADEMIC_FILE_TYPES: Readonly<
  Record<AcademicFileClass, Readonly<Record<string, string>>>
> = {
  image: {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
  },
  document: {
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  },
  video: {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  },
  // Sólo R está habilitado (ver PROGRAMMING_LANGUAGES), así que un texto plano
  // en un paso de código es un fuente de R.
  code: {
    'text/plain': 'r',
    'text/x-r': 'r',
    'text/x-r-source': 'r',
  },
  material: {
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  },
};

/** A qué clase de límite corresponde cada entregable de archivo. */
export const FILE_CLASS_BY_DELIVERABLE: Readonly<
  Record<'file' | 'image' | 'video' | 'code', AcademicFileClass>
> = {
  image: 'image',
  video: 'video',
  file: 'document',
  code: 'code',
};

/** Cómo se llama cada clase de material en la pantalla del alumnado. */
export const MATERIAL_KIND_LABEL: Readonly<Record<AssignmentMaterialKind, string>> = {
  template: 'Plantilla',
  resource: 'Material',
};

export const MATERIAL_KIND_HELP: Readonly<Record<AssignmentMaterialKind, string>> = {
  template: 'Se rellena y se entrega.',
  resource: 'Se consulta para hacer la tarea.',
};

/** Lo que ofrece el selector de archivo, por clase. Es una ayuda, no la regla. */
export function acceptAttributeFor(fileClass: AcademicFileClass): string {
  return Object.keys(ACADEMIC_FILE_EXTENSIONS[fileClass])
    .map((extension) => `.${extension}`)
    .join(',');
}

/** El límite en megas, redondeado, para poder decirlo antes de intentar subir. */
export function fileLimitLabel(fileClass: AcademicFileClass): string {
  return `${Math.round(ACADEMIC_FILE_LIMITS[fileClass] / (1024 * 1024))} MB`;
}
