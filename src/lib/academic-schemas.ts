import { z } from 'zod';
import { ACADEMIC_LIMITS, WORKFLOW_LIMITS } from './constants';
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
    case 'resource_reference':
      return resourceSelectionDataSchema;
    case 'none':
    case 'text':
    default:
      return freeformDataSchema;
  }
}

export const stepDeliverableSchema = z.object({
  type: deliverableTypeSchema,
  required: z.boolean().default(true),
  hint: z.string().trim().max(400).default(''),
  questions: z
    .array(researchQuestionSchema)
    .max(ACADEMIC_LIMITS.maxResearchQuestions)
    .default([]),
});

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
