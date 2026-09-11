import { z } from 'zod';
import {
  ACADEMIC_LIMITS,
  DEFAULT_CODE_MODE,
  NEXBOOK_LIMITS,
  WORKFLOW_LIMITS,
} from './constants';
import { NEXBOOK_FORMAT_VERSION } from './types';
import type { NexBookBlock, NexBookDocument, NexBookJsonValue } from './types';
import { collectAssetIds, documentBytes, emptyDocument } from './nexbook-document';
import { detectTextFormat } from './ai-worklog';
import { HANDLE_PATTERN } from './slug';
import { assertAcyclicWorkflow } from './workflow';

/**
 * Validación de la capa académica.
 *
 * Vive aparte de `schemas.ts` por tamaño, no por naturaleza: sigue siendo el
 * mismo contrato compartido entre el formulario y la ruta de API. En el
 * navegador da mensajes; en el servidor DECIDE, porque tras la salida de
 * Firestore no hay reglas declarativas que repitan la invariante.
 *
 * Dos criterios recorren todo el archivo:
 *
 *  · Las personas se nombran por `handle`, nunca por UID. El UID no cruza la
 *    frontera hacia el navegador (docs/ARCHITECTURE.md §7), así que tampoco
 *    puede llegar en el cuerpo de una petición: el servidor lo resuelve.
 *  · Toda URL se valida ANTES de guardarse, y sólo http/https. Un
 *    `javascript:` almacenado y luego pintado en un enlace es XSS almacenado,
 *    y aquí se guardan enlaces que otra persona va a abrir.
 */

/** URL con esquema comprobado. `z.string().url()` acepta `javascript:`. */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(2048, 'Ese enlace es demasiado largo.')
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Escribe un enlace completo que empiece por http:// o https://' }
  );

/** Igual, pero el campo puede quedarse vacío. §7: el enlace es opcional. */
export const optionalHttpUrlSchema = z.union([z.literal(''), httpUrlSchema]).default('');

export const memberHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_PATTERN, 'Ese nombre de usuario no es válido.');

export const resourceLinkSchema = z.object({
  label: z.string().trim().min(1, 'Ponle nombre al recurso.').max(80),
  url: httpUrlSchema,
});

export const researchQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  group: z.string().trim().max(120).nullable().default(null),
  /**
   * Opcional en la ENTRADA porque una investigacion creada en la iteracion 2 no
   * lo trae. El servidor lo rellena al normalizar; a partir de ahi es estable y
   * es la clave por la que se reparte el trabajo.
   */
  groupId: z.string().trim().max(60).optional(),
  prompt: z.string().trim().min(1, 'El campo necesita un enunciado.').max(300),
  type: z.enum(['short_text', 'long_text', 'url']),
  required: z.boolean().default(false),
});

export const assignmentTypeSchema = z.enum([
  'research',
  'ai_worklog',
  'web_project',
  'external_link',
  'freeform',
  // Iteracion 4. Una tarea de varios pasos; los cinco anteriores se conservan
  // porque hay tareas creadas con ellos y porque una tarea sencilla no deberia
  // obligar a nadie a abrir un constructor de workflows.
  'workflow',
]);

export const assignmentStatusSchema = z.enum(['draft', 'published', 'closed']);

/**
 * Fecha límite. Se acepta `YYYY-MM-DD` —lo que da un `<input type="date">`— y
 * se guarda tal cual, sin convertir a instante: una entrega vence «el 6 de
 * septiembre» en la zona de quien la entrega, no a una hora UTC concreta.
 */
export const dueDateSchema = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha válida.')])
  .nullish();

/**
 * El instante en que se cierran las entregas.
 *
 * Lo compone el navegador a partir de la fecha y la hora locales
 * (`composeDueAt`), así que aquí sólo se comprueba que sea una marca temporal
 * que `Date` sepa leer. Se normaliza a ISO en UTC al escribir.
 */
export const dueAtSchema = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Usa una hora válida.'),
  ])
  .nullish();

export const collaborationModeSchema = z.enum(['individual', 'shared']);

export const contributionVisibilitySchema = z.enum(['group', 'own', 'after_submit']);

export const resourceKindSchema = z.enum(['prompt', 'skill']);

export const resourceRefSchema = z.object({
  kind: resourceKindSchema,
  id: z.string().trim().min(1).max(64),
});

// ---------------------------------------------------------------------------
// Workflow académico (iteración 4)
// ---------------------------------------------------------------------------

export const mediaDataSchema = z.object({
  url: optionalHttpUrlSchema,
  /**
   * Sólo se aceptan claves del espacio académico. El servidor las genera, así
   * que lo único que puede llegar aquí es una que él mismo emitió; el patrón
   * impide además que alguien intente citar un objeto de otro prefijo del
   * bucket, como el código de los proyectos.
   */
  storageKey: z
    .union([z.literal(''), z.string().trim().regex(/^academic\/[\w./-]{10,300}$/)])
    .default(''),
  fileName: z.string().trim().max(200).default(''),
  kind: z.enum(['file', 'image', 'video']).default('file'),
  note: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
});

export const resourceSelectionDataSchema = z.object({
  refs: z.array(resourceRefSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
  note: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
});

/**
 * El lenguaje de un paso de código.
 *
 * Cadena acotada y NO un enum, por la misma razón que `actionType`: el día que
 * se habilite Python, una tarea guardada con ese valor tiene que poder leerse
 * sin desplegar el esquema antes. Qué se OFRECE hoy lo decide
 * `ENABLED_PROGRAMMING_LANGUAGES` en la interfaz.
 */
export const programmingLanguageSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(24)
  .regex(/^[a-z0-9+#.-]+$/, 'Ese lenguaje no es válido.');

/**
 * Código entregado en un paso.
 *
 * `code` NO lleva `trim`: la sangría es parte del programa. Tampoco se valida
 * como código ni se interpreta —UINexus no lo ejecuta en ningún momento—, sólo
 * se acota su tamaño, que es la única propiedad que puede hacer daño aquí.
 */
export const codeDataSchema = z.object({
  language: programmingLanguageSchema.default('r'),
  code: z.string().max(ACADEMIC_LIMITS.codeMax, 'Ese archivo de código es demasiado largo.').default(''),
  explanation: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  storageKey: z
    .union([z.literal(''), z.string().trim().regex(/^academic\/[\w./-]{10,300}$/)])
    .default(''),
  fileName: z.string().trim().max(200).default(''),
});

export const deliverableTypeSchema = z.enum([
  'none',
  'text',
  'url',
  'file',
  'image',
  'video',
  'ai_worklog',
  'structured',
  'project',
  'code',
  'nexbook',
  'resource_reference',
]);

/**
 * Qué validador corresponde a cada entregable.
 *
 * Es el equivalente por paso de `dataSchemaFor`, y cumple la misma invariante:
 * lo que decide la forma de la evidencia es lo que PIDE EL PASO, nunca lo que
 * mande el navegador. Sin esto se podría guardar un AI Worklog donde se pedía
 * un enlace, y la vista del profesorado no sabría pintarlo.
 */
export function deliverableSchemaFor(type: z.infer<typeof deliverableTypeSchema>) {
  switch (type) {
    case 'ai_worklog':
      return aiWorklogDataSchema;
    case 'structured':
      return researchDataSchema;
    case 'project':
      return webProjectDataSchema;
    case 'url':
      return externalLinkDataSchema;
    case 'file':
    case 'image':
    case 'video':
      return mediaDataSchema;
    case 'code':
      return codeDataSchema;
    case 'nexbook':
      return nexBookSubmissionDataSchema;
    case 'resource_reference':
      return resourceSelectionDataSchema;
    case 'none':
    case 'text':
    default:
      return freeformDataSchema;
  }
}

export const stepDeliverableSchema = z
  .object({
    type: deliverableTypeSchema,
    required: z.boolean().default(true),
    hint: z.string().trim().max(400).default(''),
    questions: z
      .array(researchQuestionSchema)
      .max(ACADEMIC_LIMITS.maxResearchQuestions)
      .default([]),
    /**
     * En qué lenguaje se pide la solución. Sólo significa algo con
     * `type === 'code'`; ausente en cualquier otro caso, que es lo que traen los
     * pasos guardados antes de que existiera el entregable de código.
     */
    language: programmingLanguageSchema.nullish(),
    codeMode: z.enum(['editor', 'upload', 'either']).nullish(),
    // Sin trim: la sangría y los saltos son parte del programa inicial.
    starterCode: z.string().max(ACADEMIC_LIMITS.codeMax).default(''),
    executionEnabled: z.boolean().default(false),
  })
  .transform((deliverable) => ({
    ...deliverable,
    codeMode: deliverable.type === 'code' ? (deliverable.codeMode ?? DEFAULT_CODE_MODE) : null,
    starterCode: deliverable.type === 'code' ? deliverable.starterCode : '',
    executionEnabled: deliverable.type === 'code' ? deliverable.executionEnabled : false,
  }));

export const toolChoiceSchema = z.object({
  mode: z.enum(['none', 'required', 'choice', 'free']).default('none'),
  toolIds: z.array(z.string().trim().max(64)).max(WORKFLOW_LIMITS.maxToolsPerStep).default([]),
  /**
   * Los nombres viajan junto a los ids a propósito (§50): si la herramienta
   * desaparece del catálogo, el paso sigue diciendo qué usar.
   */
  toolNames: z
    .array(z.string().trim().max(WORKFLOW_LIMITS.toolNameMax))
    .max(WORKFLOW_LIMITS.maxToolsPerStep)
    .default([]),
});

/**
 * El prompt de un paso.
 *
 * `inline` NO exige `resourceId`, y eso es justo lo que arregla: hasta ahora un
 * paso que necesitaba un prompt tenía que apuntar a uno de la biblioteca, así
 * que no se podía crear una actividad con un prompt que sólo tiene sentido para
 * ella.
 */
export const stepPromptSchema = z
  .object({
    mode: z.enum(['none', 'inline', 'library']).default('none'),
    title: z.string().trim().max(120).default(''),
    // Sin trim: la sangría y los saltos de un prompt son parte del prompt.
    text: z.string().max(ACADEMIC_LIMITS.promptMax).default(''),
    resourceId: z
      .union([z.literal(''), z.string().trim().max(64)])
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .transform((prompt) => ({
    ...prompt,
    /**
     * Un `inline` sin texto y un `library` sin recurso no son prompts: son un
     * modo que alguien seleccionó y no llegó a rellenar. Se guardan como lo que
     * son para que nada aguas abajo tenga que preguntárselo.
     */
    mode:
      prompt.mode === 'inline' && !prompt.text.trim()
        ? ('none' as const)
        : prompt.mode === 'library' && !prompt.resourceId
          ? ('none' as const)
          : prompt.mode,
  }));

export const workflowStepSchema = z.object({
  id: z.string().trim().min(1).max(40),
  order: z.number().int().min(0).max(WORKFLOW_LIMITS.maxSteps).default(0),
  title: z.string().trim().min(1, 'El paso necesita un título.').max(WORKFLOW_LIMITS.stepTitleMax),
  description: z.string().trim().max(ACADEMIC_LIMITS.descriptionMax).default(''),
  instructions: z.string().trim().max(ACADEMIC_LIMITS.instructionsMax).default(''),
  /**
   * Cadena libre, NO un enum. §4: la docente encontrará otra herramienta la
   * semana que viene y no puede depender de un despliegue para poder usarla.
   * Los valores conocidos sólo eligen icono y textos por defecto.
   */
  actionType: z.string().trim().min(1).max(40).default('instruction'),
  tool: toolChoiceSchema.default({ mode: 'none', toolIds: [], toolNames: [] }),
  resources: z.array(resourceRefSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
  prompt: stepPromptSchema.default({ mode: 'none', title: '', text: '', resourceId: null }),
  deliverables: z
    .array(stepDeliverableSchema)
    .max(WORKFLOW_LIMITS.maxDeliverablesPerStep)
    .default([]),
  required: z.boolean().default(true),
  /** Handles. `null` o ausente = quien tenga la tarea. */
  assignedHandles: z
    .array(memberHandleSchema)
    .max(ACADEMIC_LIMITS.maxStudentsPerCourse)
    .nullish(),
  dependsOnStepIds: z.array(z.string().trim().max(40)).max(WORKFLOW_LIMITS.maxSteps).default([]),
});

export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;

/**
 * El navegador evita ciclos al construir, pero la API no confía en él. Este
 * esquema se reutiliza en tareas y plantillas para responder 422 antes de
 * guardar un workflow imposible de completar.
 */
const acyclicWorkflowSchema = z
  .array(workflowStepSchema)
  .max(WORKFLOW_LIMITS.maxSteps)
  .superRefine((steps, context) => {
    try {
      assertAcyclicWorkflow(steps);
    } catch (caught) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          caught instanceof Error ? caught.message : 'El workflow contiene dependencias cíclicas.',
      });
    }
  });

/** Evidencia de un paso, tal y como llega del formulario. */
export const stepEvidenceInputSchema = z.object({
  stepId: z.string().trim().min(1).max(40),
  toolId: z.string().trim().max(64).nullish(),
  toolName: z.string().trim().max(WORKFLOW_LIMITS.toolNameMax).default(''),
  note: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  data: z.record(z.unknown()).default({}),
});

/**
 * Cuerpo de una entrega con pasos.
 *
 * Convive con `submissionInputSchema`, que sigue sirviendo a las tareas de un
 * solo paso: no se rompió el contrato anterior para añadir el nuevo.
 */
export const workflowSubmissionInputSchema = z.object({
  intent: z.enum(['draft', 'submit']),
  steps: z.array(stepEvidenceInputSchema).max(WORKFLOW_LIMITS.maxSteps).default([]),
});

// ---------------------------------------------------------------------------
// Materiales de la tarea
// ---------------------------------------------------------------------------

export const assignmentMaterialKindSchema = z.enum(['template', 'resource']);

/** Paso 1: pedir permiso para subir. Todavía no se guarda nada. */
export const materialUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1, 'Falta el nombre del archivo.').max(200),
  /** Lo que dice el navegador. El servidor decide el tipo real por extensión. */
  contentType: z.string().trim().max(160).default(''),
  sizeBytes: z.number().int().positive(),
});

/**
 * Paso 2: registrar el archivo ya subido.
 *
 * La clave se acota al espacio de materiales con el patrón, y la ruta comprueba
 * ADEMÁS que sea de ESTA tarea (`isAssignmentMaterialKeyFor`). Lo primero
 * impide citar cualquier objeto del bucket; lo segundo, el material de otra
 * materia. El `contentType` y el tamaño que lleguen aquí son etiquetas para
 * mostrar: el servidor los vuelve a derivar del nombre y del límite de la clase.
 */
export const materialConfirmSchema = z.object({
  storageKey: z
    .string()
    .trim()
    .regex(/^academic\/materials\/[\w./-]{10,300}$/, 'Esa referencia no es un material válido.'),
  fileName: z.string().trim().min(1, 'Falta el nombre del archivo.').max(200),
  displayName: z.string().trim().max(160).default(''),
  kind: assignmentMaterialKindSchema.default('resource'),
  sizeBytes: z.number().int().nonnegative().default(0),
});

/** Cambiar el nombre visible o la clase de un material ya subido. */
export const materialPatchSchema = z.object({
  id: z.string().trim().min(1).max(64),
  displayName: z.string().trim().max(160).optional(),
  kind: assignmentMaterialKindSchema.optional(),
});

export const toolInputSchema = z.object({
  name: z.string().trim().min(2, 'La herramienta necesita un nombre.').max(WORKFLOW_LIMITS.toolNameMax),
  url: optionalHttpUrlSchema,
  description: z.string().trim().max(ACADEMIC_LIMITS.descriptionMax).default(''),
  category: z.string().trim().max(60).default('Otra'),
  /** Nivel de integración. Ver `EmbedLevel` en types.ts. */
  embedLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
  usageInstructions: z.string().trim().max(ACADEMIC_LIMITS.instructionsMax).default(''),
});

export type ToolInput = z.infer<typeof toolInputSchema>;

export const assignmentInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'El título necesita al menos 3 caracteres.')
    .max(ACADEMIC_LIMITS.titleMax),
  description: z.string().trim().max(ACADEMIC_LIMITS.descriptionMax).default(''),
  instructions: z.string().trim().max(ACADEMIC_LIMITS.instructionsMax).default(''),
  type: assignmentTypeSchema,
  resourceLinks: z.array(resourceLinkSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
  researchQuestions: z
    .array(researchQuestionSchema)
    .max(ACADEMIC_LIMITS.maxResearchQuestions)
    .default([]),
  dueDate: dueDateSchema,
  /**
   * Fecha límite CON hora. Un cliente antiguo que no la mande sigue creando
   * exactamente lo que creaba antes: una tarea con `dueDate` y sin instante.
   */
  dueAt: dueAtSchema,
  /**
   * `null` = todo el grupo. Es el valor por defecto porque es el caso normal, y
   * porque un olvido debe caer del lado de «lo ve todo el mundo» y no del de
   * «no lo ve nadie y nadie se entera».
   */
  assignedHandles: z.array(memberHandleSchema).max(ACADEMIC_LIMITS.maxStudentsPerCourse).nullish(),
  status: assignmentStatusSchema.default('draft'),

  /**
   * Modo de actividad. Por omision `individual`, que es lo que eran todas las
   * tareas hasta la iteracion 3: un cliente antiguo que no mande el campo
   * sigue creando exactamente lo que creaba antes.
   */
  collaborationMode: collaborationModeSchema.default('individual'),
  contributionVisibility: contributionVisibilitySchema.default('group'),
  /**
   * Reparto por concepto, en handles. El servidor los traduce a UID contra la
   * lista de la materia, asi que no se puede repartir trabajo a alguien de
   * fuera. Un `groupId` ausente de esta lista queda abierto a todo el grupo.
   */
  groupAssignments: z
    .array(
      z.object({
        groupId: z.string().trim().min(1).max(60),
        assignedTo: z.array(memberHandleSchema).max(ACADEMIC_LIMITS.maxStudentsPerCourse),
      })
    )
    .max(ACADEMIC_LIMITS.maxResearchQuestions)
    .default([]),
  resources: z.array(resourceRefSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
  /**
   * Los pasos. Vacío significa «tarea de un solo paso», que es lo que mandan
   * los formularios sencillos y lo que mandaban todos antes de la iteración 4:
   * el servidor sintetiza el paso al leerla y nadie tiene que enterarse.
   */
  workflow: acyclicWorkflowSchema.default([]),
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------

export const aiProviderSchema = z.enum(['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Other']);

const aiTextResultSchema = z
  .object({
    // Sin trim: incluso los saltos e indentación de los extremos son fuente.
    content: z.string().max(ACADEMIC_LIMITS.promptMax).default(''),
    format: z.enum(['markdown', 'plain_text']).optional(),
  })
  .transform((result) => ({
    content: result.content,
    format: result.format ?? detectTextFormat(result.content),
  }));

export const aiWorklogDataSchema = z.object({
  provider: aiProviderSchema.default('Other'),
  model: z.string().trim().max(80).default(''),
  conversationUrl: optionalHttpUrlSchema,
  objective: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  prompt: z.string().trim().max(ACADEMIC_LIMITS.promptMax).default(''),
  result: aiTextResultSchema.optional(),
  responseSummary: z.string().trim().max(ACADEMIC_LIMITS.promptMax).default(''),
  studentAnalysis: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  whatWasUsed: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  whatWasChanged: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  whatWasDiscarded: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  /** Recursos de la materia que dice haber usado. Opcional (§28). */
  resourcesUsed: z.array(resourceRefSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
});

export const researchDataSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(40),
        value: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
      })
    )
    .max(ACADEMIC_LIMITS.maxResearchQuestions)
    .default([]),
});

export const webProjectDataSchema = z.object({
  projectId: z.string().trim().max(64).default(''),
  projectPath: z.string().trim().max(200).default(''),
  projectTitle: z.string().trim().max(200).default(''),
  note: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
});

export const externalLinkDataSchema = z.object({
  url: optionalHttpUrlSchema,
  title: z.string().trim().max(160).default(''),
  description: z.string().trim().max(ACADEMIC_LIMITS.answerMax).default(''),
  provider: z.string().trim().max(40).default('other'),
});

export const freeformDataSchema = z.object({
  text: z.string().trim().max(ACADEMIC_LIMITS.promptMax).default(''),
  links: z.array(resourceLinkSchema).max(ACADEMIC_LIMITS.maxResourceLinks).default([]),
});

/**
 * Cuerpo de una entrega. El tipo NO se acepta del cliente: lo dicta la tarea.
 * `intent` separa «guardar borrador» de «entregar», que es la única diferencia
 * entre las dos acciones del formulario.
 */
export const submissionInputSchema = z.object({
  intent: z.enum(['draft', 'submit']),
  data: z.record(z.unknown()),
});

/** Elige el validador del cuerpo según el tipo que declara la TAREA. */
export function dataSchemaFor(type: z.infer<typeof assignmentTypeSchema>) {
  switch (type) {
    case 'ai_worklog':
      return aiWorklogDataSchema;
    case 'research':
      return researchDataSchema;
    case 'web_project':
      return webProjectDataSchema;
    case 'external_link':
      return externalLinkDataSchema;
    case 'freeform':
    case 'workflow':
    default:
      // Una tarea de varios pasos no valida su contenido aqui: cada paso lo
      // hace con `deliverableSchemaFor`, porque lo que decide la forma es el
      // entregable del paso y no el tipo de la tarea.
      return freeformDataSchema;
  }
}

export const reviewInputSchema = z.object({
  status: z.enum(['reviewed', 'needs_changes', 'submitted']),
  teacherNote: z.string().trim().max(2000).default(''),
});

// ---------------------------------------------------------------------------
// Materias
// ---------------------------------------------------------------------------

export const courseInputSchema = z.object({
  name: z.string().trim().min(3, 'La materia necesita un nombre.').max(80),
  code: z.string().trim().max(24).nullish(),
  description: z.string().trim().max(600).default(''),
  academicPeriod: z.string().trim().max(40).nullish(),
  institution: z.string().trim().max(120).default('Instituto Tecnológico de Durango'),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const enrollInputSchema = z.object({
  handles: z.array(memberHandleSchema).min(1, 'Elige al menos una persona.').max(100),
  role: z.enum(['student', 'teacher']).default('student'),
});

/** Código de acceso de la materia. Se compara siempre en mayúsculas. */
export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'El código tiene 6 caracteres entre letras y números.');

export const promptTemplateInputSchema = z.object({
  title: z.string().trim().min(3, 'Ponle título al prompt.').max(120),
  description: z.string().trim().max(600).default(''),
  prompt: z
    .string()
    .trim()
    .min(1, 'El prompt no puede estar vacío.')
    .max(ACADEMIC_LIMITS.promptMax),
  recommendedProvider: aiProviderSchema.nullish(),
  recommendedModel: z.string().trim().max(80).nullish(),
});

/** Ficha académica del perfil. Todo opcional: los perfiles viejos no la tienen. */
export const academicProfileSchema = z.object({
  studentProfile: z
    .object({
      enrollmentNumber: z.string().trim().max(20).nullish(),
      semester: z.string().trim().max(20).nullish(),
      career: z.string().trim().max(120).nullish(),
    })
    .optional(),
  teacherProfile: z
    .object({
      department: z.string().trim().max(120).nullish(),
      title: z.string().trim().max(80).nullish(),
    })
    .optional(),
});

export const exportFormatSchema = z.enum(['json', 'csv', 'md']);

// ---------------------------------------------------------------------------
// Biblioteca de Skills (iteración 3)
// ---------------------------------------------------------------------------

/**
 * Un paso de instalación.
 *
 * `command` NO se valida como comando ni se interpreta: es una cadena que se
 * pinta y se copia. UINexus no ejecuta nada de esto —ni `exec`, ni shell, ni
 * terminal remota— y por eso no hace falta ninguna lista blanca de comandos:
 * sería seguridad de mentira sobre algo que nunca se ejecuta. Lo que sí se
 * acota es la longitud, y lo que sí se valida de verdad son los enlaces.
 */
export const installStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('command'), content: z.string().trim().min(1).max(2000) }),
  z.object({
    type: z.literal('link'),
    label: z.string().trim().min(1).max(120),
    url: httpUrlSchema,
  }),
]);

export const installMethodSchema = z.object({
  id: z.string().trim().min(1).max(40),
  tool: z.string().trim().min(1, 'Di para qué herramienta es.').max(60),
  title: z.string().trim().max(120).default(''),
  steps: z.array(installStepSchema).max(ACADEMIC_LIMITS.maxInstallSteps).default([]),
});

export const skillInputSchema = z.object({
  title: z.string().trim().min(3, 'La Skill necesita un nombre.').max(ACADEMIC_LIMITS.titleMax),
  description: z.string().trim().max(ACADEMIC_LIMITS.descriptionMax).default(''),
  /** Opcional a propósito: una Skill no tiene por qué venir de GitHub (§30). */
  repositoryUrl: optionalHttpUrlSchema,
  homepageUrl: optionalHttpUrlSchema,
  compatibleTools: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  installMethods: z.array(installMethodSchema).max(ACADEMIC_LIMITS.maxInstallMethods).default([]),
  usageInstructions: z.string().trim().max(ACADEMIC_LIMITS.instructionsMax).default(''),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});

export type SkillInput = z.infer<typeof skillInputSchema>;


// ---------------------------------------------------------------------------
// Recursos generales y moderación (iteración 4)
// ---------------------------------------------------------------------------

export const courseResourceTypeSchema = z.enum([
  'tool',
  'link',
  'guide',
  'video',
  'document',
  'template',
  'workflow',
  /**
   * Un aviso de la materia: «mañana revisamos los prototipos en clase».
   *
   * Vive en la tabla de recursos y NO en una entidad nueva. Un anuncio tiene
   * exactamente la forma que ya tiene un recurso —materia, autor, título,
   * contenido, fecha, moderación— y estrenar una tabla para repetirla habría
   * añadido infraestructura por un campo. Reutilizarla trae gratis la
   * autoría, el filtrado por rol y la moderación que ya estaban probadas.
   */
  'announcement',
  'other',
]);

export const courseResourceInputSchema = z.object({
  type: courseResourceTypeSchema,
  title: z.string().trim().min(2, 'El recurso necesita un nombre.').max(ACADEMIC_LIMITS.titleMax),
  description: z.string().trim().max(ACADEMIC_LIMITS.descriptionMax).default(''),
  url: optionalHttpUrlSchema,
  /** Cómo se usa, la guía, o el proceso. Texto plano. */
  content: z.string().trim().max(ACADEMIC_LIMITS.instructionsMax).default(''),
  category: z.string().trim().max(60).default(''),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  /**
   * Los pasos, cuando el recurso es una plantilla de workflow.
   *
   * Se validan con el MISMO esquema que los de una tarea: una plantilla es un
   * proceso, y un proceso guardado a medias sería una plantilla que produce
   * tareas rotas. Se ignoran si el tipo no es `workflow`.
   */
  workflowSteps: acyclicWorkflowSchema.default([]),
});

/**
 * El ESTADO no se acepta del cliente en ningún sitio.
 *
 * Lo decide el rol al crear (`initialAuthorship`) y la moderación después. Si
 * el estado llegara en el cuerpo, un estudiante podría publicar directamente en
 * la biblioteca oficial, que es exactamente lo que §8 prohíbe.
 */
export const moderationInputSchema = z.object({
  action: z.enum(['approve', 'reject', 'archive', 'feature', 'unfeature']),
});

// ---------------------------------------------------------------------------
// Workspace de programación (iteración 7)
// ---------------------------------------------------------------------------

/**
 * Lo que se acepta al crear o guardar una práctica.
 *
 * Lo que NO está aquí es tan importante como lo que está: no hay `ownerUid`, no
 * hay `id`, no hay `createdAt` y no hay `context`. El dueño sale del token
 * verificado, el id lo genera el servidor y `context` es `personal` porque es lo
 * único que existe. Si el dueño llegara en el cuerpo, «guardar la práctica de
 * otro» sería algo que se puede expresar, y por eso no está.
 *
 * `code` comparte el tope de `CodeData.code`: una práctica y una entrega son el
 * mismo tipo de texto y no tiene sentido que quepan cosas distintas.
 */
export const workspaceInputSchema = z.object({
  title: z.string().trim().min(1, 'Ponle un nombre a tu práctica.').max(120),
  language: programmingLanguageSchema.default('python'),
  code: z.string().max(ACADEMIC_LIMITS.codeMax, 'Ese código es demasiado largo.').default(''),
  /** Se relaciona con una materia sólo si se dice; una práctica suelta no la tiene. */
  courseId: z
    .union([z.literal(''), z.string().trim().max(120)])
    .nullish()
    .transform((value) => (value ? value : null)),
});

/**
 * Un guardado parcial: title y/o code, sin obligar a reenviar todo.
 *
 * Es lo que usa el autoguardado. `partial()` sobre el esquema completo dejaría
 * pasar `language: undefined`, que al escribir borraría el lenguaje de la
 * práctica; aquí cada campo es opcional pero, si viene, viene válido.
 */
export const workspacePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    code: z.string().max(ACADEMIC_LIMITS.codeMax, 'Ese código es demasiado largo.').optional(),
    language: programmingLanguageSchema.optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.code !== undefined || value.language !== undefined,
    'No hay nada que guardar.'
  );

// ---------------------------------------------------------------------------
// NexBook (iteración 8)
// ---------------------------------------------------------------------------


const nexBookBlockIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Ese identificador de bloque no es válido.');

/**
 * Un bloque de Markdown.
 *
 * Sin `trim` en `source`: en Markdown la sangría de una lista anidada y las
 * líneas en blanco entre párrafos son significativas.
 */
const markdownBlockSchema = z.object({
  id: nexBookBlockIdSchema,
  type: z.literal('markdown'),
  source: z.string().max(NEXBOOK_LIMITS.maxMarkdownChars, 'Ese bloque de texto es demasiado largo.'),
  editableByStudent: z.boolean().optional(),
});

const codeBlockSchema = z.object({
  id: nexBookBlockIdSchema,
  type: z.literal('code'),
  language: programmingLanguageSchema.default('python'),
  source: z.string().max(NEXBOOK_LIMITS.maxCodeChars, 'Ese bloque de código es demasiado largo.'),
  editableByStudent: z.boolean().optional(),
});

/**
 * El identificador de un asset.
 *
 * Es un UUID que genera el SERVIDOR. Se valida la forma aquí porque este id
 * acaba formando parte de una clave de S3, y una cadena arbitraria del cliente
 * dentro de una ruta es la forma clásica de escribir donde no se debe. Con esta
 * expresión, `../` no es un id válido.
 */
export const nexBookAssetIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Ese asset no es válido.');

export const nexBookImageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);

const imageBlockSchema = z.object({
  id: nexBookBlockIdSchema,
  type: z.literal('image'),
  assetId: nexBookAssetIdSchema,
  mimeType: nexBookImageMimeSchema,
  /**
   * `alt` se acepta vacío, y eso NO es un descuido.
   *
   * Una imagen decorativa debe llevar `alt=""` para que un lector de pantalla la
   * salte, y obligar a escribir algo llevaría a rellenarlo con «imagen», que es
   * peor que nada. Quien decide es la interfaz, que lo pide y ofrece marcarla
   * como decorativa.
   */
  alt: z.string().trim().max(400).default(''),
  caption: z.string().trim().max(400).optional(),
  width: z.number().int().min(1).max(20_000).optional(),
  height: z.number().int().min(1).max(20_000).optional(),
});

/**
 * Una celda de la hoja.
 *
 * Se guarda lo ESCRITO, no lo calculado: ver `NexBookSheetCell`. El tope por
 * celda es el de una celda de tabla, porque el problema es el mismo —una celda
 * no es donde se vuelca un texto largo— y tener dos números distintos para la
 * misma idea sólo garantiza que uno se quede obsoleto.
 */
const sheetCellSchema = z.object({
  input: z.string().max(NEXBOOK_LIMITS.maxTableCellChars),
});

const sheetDataSchema = z
  .object({
    rows: z.number().int().min(1).max(NEXBOOK_LIMITS.maxSheetRows),
    columns: z.number().int().min(1).max(NEXBOOK_LIMITS.maxSheetColumns),
    cells: z.record(z.string().regex(/^\d+:\d+$/), sheetCellSchema).default({}),
    headers: z.array(z.string().max(120)).max(NEXBOOK_LIMITS.maxSheetColumns).optional(),
  })
  .superRefine((sheet, ctx) => {
    if (Object.keys(sheet.cells).length > NEXBOOK_LIMITS.maxSheetCells) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Una hoja admite hasta ${NEXBOOK_LIMITS.maxSheetCells} celdas con contenido.`,
      });
      return;
    }

    /**
     * Una celda fuera de la rejilla se rechaza.
     *
     * Sin esto, `"999:999"` en una hoja de 10 × 5 se guardaría sin aparecer en
     * ninguna pantalla: espacio ocupado para siempre por algo que nadie puede
     * ver ni borrar. Y si la hoja creciera después, reaparecería.
     */
    for (const key of Object.keys(sheet.cells)) {
      const [row = '', column = ''] = key.split(':');
      if (Number(row) >= sheet.rows || Number(column) >= sheet.columns) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hay celdas fuera de la hoja.',
        });
        return;
      }
    }
  });

const spreadsheetBlockSchema = z.object({
  id: nexBookBlockIdSchema,
  type: z.literal('spreadsheet'),
  name: z.string().trim().min(1).max(NEXBOOK_LIMITS.maxSheetNameChars).default('Hoja'),
  sheet: sheetDataSchema,
  editableByStudent: z.boolean().optional(),
});

export const nexBookBlockSchema = z.discriminatedUnion('type', [
  markdownBlockSchema,
  codeBlockSchema,
  imageBlockSchema,
  spreadsheetBlockSchema,
]);

/**
 * Un trozo de salida.
 *
 * Discriminado por `stream`, que es el campo que ya existía en V1: un documento
 * guardado en la iteración 8 —sólo `stdout`, `stderr` y `error`— sigue validando
 * con esto sin tocar un byte. Ver `NexBookOutputStream` en `lib/types.ts`.
 */
const textOutputSchema = z.object({
  seq: z.number().int().min(0).max(100_000),
  stream: z.enum(['stdout', 'stderr', 'error']),
  text: z.string().max(NEXBOOK_LIMITS.maxOutputChars),
  truncated: z.boolean().optional(),
});

/** Sólo primitivos. Una celda de tabla no anida un documento. */
const tableCellSchema = z.union([
  z.string().max(NEXBOOK_LIMITS.maxTableCellChars),
  z.number(),
  z.boolean(),
  z.null(),
]);

const tableOutputSchema = z.object({
  seq: z.number().int().min(0).max(100_000),
  stream: z.literal('table'),
  columns: z.array(z.string().max(NEXBOOK_LIMITS.maxTableCellChars)).max(
    NEXBOOK_LIMITS.maxTableColumns
  ),
  rows: z
    .array(z.array(tableCellSchema).max(NEXBOOK_LIMITS.maxTableColumns))
    .max(NEXBOOK_LIMITS.maxTableRows),
  /** Cuántas filas tenía el original. Puede ser mayor que `rows.length`. */
  totalRows: z.number().int().min(0).max(1_000_000_000).default(0),
  truncated: z.boolean().optional(),
});

/**
 * Una imagen de salida: una REFERENCIA, nunca los bytes.
 *
 * Si esto aceptara Base64, una sesión con cinco gráficas llenaría el
 * presupuesto del documento y el guardado empezaría a fallar sin que nadie
 * entendiera por qué. Los bytes viven en S3 y aquí va el identificador.
 */
const imageOutputSchema = z.object({
  seq: z.number().int().min(0).max(100_000),
  stream: z.literal('image'),
  assetId: nexBookAssetIdSchema,
  mimeType: nexBookImageMimeSchema,
  width: z.number().int().min(1).max(20_000).optional(),
  height: z.number().int().min(1).max(20_000).optional(),
  alt: z.string().trim().max(400).optional(),
});

/**
 * Un valor JSON, con PROFUNDIDAD ACOTADA.
 *
 * Un `z.lazy` sin fondo acepta una estructura de diez mil niveles, y entonces
 * el que se queda sin pila no es quien la escribió sino el servidor que la
 * valida. Cinco niveles cubren cualquier cosa que valga la pena enseñar como
 * resultado; lo más profundo se queda en texto.
 */
const jsonValueSchema: z.ZodType<NexBookJsonValue> = z.lazy(() => jsonAtDepth(5));

function jsonAtDepth(depth: number): z.ZodType<NexBookJsonValue> {
  const leaf = z.union([z.string().max(4_000), z.number(), z.boolean(), z.null()]);
  if (depth <= 0) return leaf;
  const inner = jsonAtDepth(depth - 1);
  return z.union([
    leaf,
    z.array(inner).max(500),
    z.record(z.string().max(200), inner),
  ]) as z.ZodType<NexBookJsonValue>;
}

const jsonOutputSchema = z.object({
  seq: z.number().int().min(0).max(100_000),
  stream: z.literal('json'),
  value: jsonValueSchema,
  truncated: z.boolean().optional(),
});

const nexBookOutputSchema = z.discriminatedUnion('stream', [
  textOutputSchema,
  tableOutputSchema,
  imageOutputSchema,
  jsonOutputSchema,
]);

const nexBookCellResultSchema = z.object({
  blockId: nexBookBlockIdSchema,
  status: z.enum(['ok', 'failed', 'timeout', 'stopped', 'rejected']),
  outputs: z.array(nexBookOutputSchema).max(NEXBOOK_LIMITS.maxOutputsPerCell).default([]),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
  ranAt: z.string().trim().max(40).default(''),
});

/**
 * El documento entero.
 *
 * Tres comprobaciones que NO son redundantes entre sí:
 *
 *  1. `maxBlocks`, para fallar con un mensaje legible antes de que el item de
 *     DynamoDB se vuelva ingestionable.
 *  2. Ids únicos. Dos bloques con el mismo id harían que sus outputs se
 *     mezclaran —`results` se indexa por `blockId`— y que mover uno moviera el
 *     otro. Es el tipo de fallo que sólo se nota tres semanas después.
 *  3. `documentBytes` sobre el JSON YA serializado, que es lo único que se
 *     corresponde con lo que DynamoDB va a medir. Sumar longitudes de campos
 *     daría un número parecido y equivocado.
 */
export const nexBookDocumentSchema = z
  .object({
    formatVersion: z.number().int().min(1).max(NEXBOOK_FORMAT_VERSION).default(NEXBOOK_FORMAT_VERSION),
    blocks: z
      .array(nexBookBlockSchema)
      .max(NEXBOOK_LIMITS.maxBlocks, `Un NexBook admite hasta ${NEXBOOK_LIMITS.maxBlocks} bloques.`)
      .default([]),
    results: z.record(z.string(), nexBookCellResultSchema).default({}),
  })
  .superRefine((document, ctx) => {
    const ids = new Set<string>();
    for (const block of document.blocks) {
      if (ids.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hay dos bloques con el mismo identificador.',
        });
        return;
      }
      ids.add(block.id);
    }

    /**
     * Los resultados de un bloque que ya no existe se consideran un error y no
     * se limpian en silencio: significa que quien escribió esto perdió la
     * correspondencia entre código y salida, y aceptarlo dejaría outputs
     * huérfanos creciendo en el item para siempre.
     */
    for (const blockId of Object.keys(document.results)) {
      if (!ids.has(blockId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hay resultados de un bloque que ya no existe.',
        });
        return;
      }
    }

    /**
     * Cuántos assets distintos referencia.
     *
     * Acota lo que puede costar exportar o publicar un documento: cada asset es
     * una descarga de S3 al hacer el ZIP. Sin tope, un documento de 300 KB podría
     * arrastrar cien imágenes de cuatro megas cada una.
     */
    if (collectAssetIds(document as NexBookDocument).length > NEXBOOK_LIMITS.maxAssetsPerNexBook) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Un NexBook admite hasta ${NEXBOOK_LIMITS.maxAssetsPerNexBook} imágenes.`,
      });
      return;
    }

    if (documentBytes(document as NexBookDocument) > NEXBOOK_LIMITS.documentBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Este NexBook es demasiado grande. Borra salidas antiguas o divide el documento.',
      });
    }
  });

export { documentBytes as nexBookDocumentBytes };

export const nexBookTitleSchema = z
  .string()
  .trim()
  .min(1, 'Ponle un nombre a tu NexBook.')
  .max(NEXBOOK_LIMITS.maxTitleChars);

/**
 * Lo que se acepta al guardar.
 *
 * `revision` es OBLIGATORIA: es la que el cliente creía tener, y el servidor
 * escribe sólo si sigue siendo esa. Hacerla opcional habría convertido la
 * concurrencia optimista en «gana el último», que es justo lo que evita.
 *
 * Ni `ownerUid`, ni `id`, ni `context`, ni `createdAt`. El dueño sale del token.
 */
export const nexBookPatchSchema = z
  .object({
    revision: z.number().int().min(0),
    title: nexBookTitleSchema.optional(),
    document: nexBookDocumentSchema.optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.document !== undefined,
    'No hay nada que guardar.'
  );

/** Un documento vacío pero VÁLIDO, para que crear no pase por un estado roto. */
export function emptyNexBookDocument(blocks: NexBookBlock[] = []): NexBookDocument {
  return emptyDocument(blocks);
}

/**
 * La entrega de un NexBook: una COPIA congelada, no un puntero.
 *
 * Si la evidencia guardara sólo el id, seguir trabajando después de entregar
 * cambiaría lo que la docente califica y no habría forma de saber qué se
 * entregó. Por eso `snapshot` lleva el documento entero y `revision` dice de qué
 * versión salió.
 *
 * `nexbookId` se conserva para poder decir «esto salió de aquel documento», no
 * para leerlo: la revisión ya no existe en el original en cuanto se toca.
 */
export const nexBookSubmissionDataSchema = z.object({
  nexbookId: z.string().trim().max(64).default(''),
  revision: z.number().int().min(0).default(0),
  title: nexBookTitleSchema.or(z.literal('')).default(''),
  snapshot: nexBookDocumentSchema,
  submittedAt: z.string().trim().max(40).default(''),
});
