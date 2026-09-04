import type {
  AIWorklogData,
  AssignmentRecord,
  CourseRecord,
  CourseResourceRecord,
  SkillResourceRecord,
  StepEvidence,
  SubmissionRecord,
  SubmissionData,
  WorkflowStepRecord,
} from '../../src/lib/types';

/**
 * Fábricas para las pruebas del aula.
 *
 * Los UID se escriben aparte de los handles a propósito: buena parte de lo que
 * se prueba es justamente que el UID NO salga por ninguna parte, y para poder
 * afirmarlo hay que poder buscarlo en la respuesta.
 */

export const UID = {
  luz: 'uid-luz-teacher',
  christian: 'uid-christian',
  ana: 'uid-ana',
  pedro: 'uid-pedro-ajeno',
} as const;

export function course(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    id: 'course-dcu',
    slug: 'dcu-2026',
    name: 'Diseño Centrado en el Usuario',
    institution: 'Instituto Tecnológico de Durango',
    term: 'Ago–Dic 2026',
    description: '',
    teacherName: 'Luz Adriana Márquez',
    studentCount: 2,
    projectCount: 0,
    activities: [],
    code: 'ABC234',
    academicPeriod: 'Ago–Dic 2026',
    teachers: [
      { uid: UID.luz, handle: 'profesora-luz', displayName: 'Luz Adriana Márquez', avatarUrl: null },
    ],
    students: [
      { uid: UID.christian, handle: 'christian', displayName: 'Christian González', avatarUrl: null },
      { uid: UID.ana, handle: 'ana', displayName: 'Ana Lucía Reyes', avatarUrl: null },
    ],
    visibility: 'public',
    createdBy: UID.luz,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export function assignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    id: 'assignment-1',
    courseId: 'course-dcu',
    title: 'Glosario de arquitectura de información',
    description: 'Analizar la organización actual del sitio.',
    instructions: '1. Identifica categorías.',
    type: 'research',
    resourceLinks: [],
    researchQuestions: [
      {
        id: 'q1',
        group: 'Arquitectura de información',
        groupId: 'arquitectura',
        prompt: 'Definición',
        type: 'long_text',
        required: true,
      },
      {
        id: 'q2',
        group: 'Arquitectura de información',
        groupId: 'arquitectura',
        prompt: 'Fuente',
        type: 'url',
        required: false,
      },
      {
        id: 'q3',
        group: 'Card sorting',
        groupId: 'card-sorting',
        prompt: 'Definición',
        type: 'long_text',
        required: true,
      },
    ],
    dueDate: '2026-09-06',
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    groupAssignments: [],
    resources: [],
    // Vacío a propósito: representa una tarea guardada ANTES de la iteración 4.
    // `normalizeAssignment` le sintetiza el paso único al leerla, y varias
    // pruebas dependen de que aquí no haya pasos.
    workflow: [],
    assignedTo: null,
    status: 'published',
    createdBy: UID.luz,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

export function submission(
  overrides: Partial<SubmissionRecord> & { data?: SubmissionData } = {}
): SubmissionRecord {
  return {
    id: 'submission-1',
    assignmentId: 'assignment-1',
    courseId: 'course-dcu',
    studentId: UID.christian,
    student: { handle: 'christian', displayName: 'Christian González', avatarUrl: null },
    type: 'research',
    status: 'submitted',
    submittedAt: '2026-09-05T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    teacherNote: '',
    data: {
      answers: [
        { questionId: 'q1', value: 'Cómo se organiza y etiqueta la información.' },
        { questionId: 'q2', value: 'https://www.nngroup.com/articles/ia/' },
      ],
    },
    stepEvidence: {},
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    ...overrides,
  };
}

/** AI Worklog completo, con los campos nuevos de la iteración 3. */
export function worklogData(
  overrides: Partial<AIWorklogData> = {}
): AIWorklogData {
  return {
    provider: 'ChatGPT',
    model: 'GPT-5',
    conversationUrl: 'https://chatgpt.com/share/abc',
    objective: 'Evaluar heurísticas',
    prompt: 'Analiza esta interfaz…',
    responseSummary: 'Encontró seis problemas.',
    studentAnalysis: 'Dos no aplicaban a nuestro caso.',
    whatWasUsed: 'Los cuatro primeros.',
    whatWasChanged: 'Reescribí las recomendaciones.',
    whatWasDiscarded: 'La parte de accesibilidad, ya la teníamos.',
    resourcesUsed: [],
    ...overrides,
  };
}

/** Una investigación colaborativa con dos conceptos ya repartidos. */
export function sharedAssignment(
  overrides: Partial<AssignmentRecord> = {}
): AssignmentRecord {
  return assignment({
    collaborationMode: 'shared',
    contributionVisibility: 'group',
    groupAssignments: [
      { groupId: 'arquitectura', assignedTo: [UID.christian] },
      { groupId: 'card-sorting', assignedTo: [UID.ana] },
    ],
    ...overrides,
  });
}

export function skill(
  overrides: Partial<SkillResourceRecord> = {}
): SkillResourceRecord {
  return {
    id: 'skill-1',
    courseId: 'course-dcu',
    createdBy: UID.luz,
    title: 'UI UX Pro Max',
    description: 'Skill especializada en diseño UI/UX.',
    repositoryUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    homepageUrl: null,
    compatibleTools: ['Claude Code', 'Cursor', 'Codex'],
    installMethods: [
      {
        id: 'm1',
        tool: 'Claude Code',
        title: 'Desde el marketplace',
        steps: [
          { type: 'text', content: 'Abre Claude Code en tu proyecto.' },
          { type: 'command', content: '/plugin marketplace add nextlevelbuilder/ui-ux-pro-max' },
        ],
      },
    ],
    usageInstructions: '1. Instala la skill.\n2. Reinicia Claude Code.',
    tags: ['ui', 'ux'],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...authorship(),
    ...overrides,
  };
}

/**
 * Autoría y moderación por defecto: aprobada y de la docente. Es lo que se
 * lee de un recurso creado antes de la iteración 4.
 */
export function authorship(overrides: Partial<ResourceAuthorshipRecord> = {}) {
  return {
    status: 'approved' as const,
    authorHandle: 'profesora-luz',
    authorName: 'Luz Adriana Márquez',
    approvedByUid: UID.luz,
    approvedByName: 'Luz Adriana Márquez',
    approvedAt: '2026-09-01T00:00:00.000Z',
    featured: false,
    ...overrides,
  };
}

interface ResourceAuthorshipRecord {
  status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'archived';
  authorHandle: string;
  authorName: string;
  approvedByUid: string | null;
  approvedByName: string;
  approvedAt: string | null;
  featured: boolean;
}

/** Un recurso general de la materia: herramienta, enlace, guía… */
export function courseResource(
  overrides: Partial<CourseResourceRecord> = {}
): CourseResourceRecord {
  return {
    id: 'resource-1',
    courseId: 'course-dcu',
    createdBy: UID.luz,
    type: 'tool',
    title: 'Napkin AI',
    description: 'Convierte texto en diagramas.',
    url: 'https://www.napkin.ai',
    content: '',
    category: 'Visualización',
    tags: [],
    workflowSteps: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...authorship(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Workflow (iteración 4)
// ---------------------------------------------------------------------------

export function step(
  overrides: Partial<WorkflowStepRecord> = {}
): WorkflowStepRecord {
  return {
    id: 's1',
    order: 0,
    title: 'Buscar fuentes',
    description: '',
    instructions: '',
    actionType: 'instruction',
    tool: { mode: 'none', toolIds: [], toolNames: [] },
    resources: [],
    deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
    required: true,
    assignedTo: null,
    dependsOnStepIds: [],
    ...overrides,
  };
}

export function stepEvidence(overrides: Partial<StepEvidence> = {}): StepEvidence {
  return {
    stepId: 's1',
    toolId: null,
    toolName: '',
    startedAt: null,
    completedAt: null,
    data: { text: '', links: [] },
    note: '',
    ...overrides,
  };
}

/** Una tarea que SÍ tiene pasos guardados: nace en la iteración 4. */
export function workflowAssignment(
  overrides: Partial<AssignmentRecord> = {}
): AssignmentRecord {
  return assignment({
    type: 'workflow',
    workflow: [step()],
    ...overrides,
  });
}
