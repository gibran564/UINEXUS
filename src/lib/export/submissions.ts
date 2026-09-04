import type {
  AIWorklogData,
  Assignment,
  ExternalLinkData,
  FreeformData,
  ResearchData,
  ResearchQuestion,
  Submission,
  TextFormat,
  WebProjectData,
} from '../types';
import { ASSIGNMENT_TYPE_LABEL, SUBMISSION_STATUS_LABEL } from '../constants';
import { normalizeAIResult } from '../ai-worklog';

/**
 * Exportación de resultados.
 *
 * Este módulo es DELIBERADAMENTE puro: entra la tarea con sus entregas, sale
 * una cadena. No toca red, ni base de datos, ni `server-only`, y por eso se
 * puede probar sin nube y reutilizar tal cual el día que se exporte desde el
 * navegador.
 *
 * El objetivo de §10 no es «tener un botón de descargar»: es que la docente
 * pueda pegar el resultado en ChatGPT, Claude o Gemini y pedirle que compare
 * respuestas. Eso condiciona el formato Markdown más de lo que parece:
 *
 *  · Encabezados jerárquicos reales, porque un modelo se apoya en ellos para
 *    saber dónde acaba una persona y empieza la siguiente.
 *  · La PREGUNTA junto a la respuesta, no un `questionId`. Un identificador
 *    obliga al modelo a adivinar de qué se hablaba.
 *  · Los campos vacíos se dicen («(sin respuesta)») en vez de omitirse: si se
 *    omiten, no hay forma de distinguir «no contestó» de «no se le preguntó»,
 *    y esa diferencia es justo la que se quiere analizar.
 *
 * No se integra ninguna API de IA aquí, a propósito (§10): esta iteración
 * prepara los datos, no gasta claves ni dinero.
 */

const EMPTY = '(sin respuesta)';

export interface ExportBundle {
  assignment: Assignment;
  courseName: string;
  submissions: Submission[];
  /** Personas sin entrega, para poder decir quién falta. */
  missing?: { handle: string; displayName: string }[];
}

// ---------------------------------------------------------------------------
// Aplanado: una entrega, sea del tipo que sea, como pares etiqueta/valor
// ---------------------------------------------------------------------------

export interface FlatField {
  /** Agrupador opcional. En investigación, el concepto. */
  group: string | null;
  label: string;
  value: string;
  /** Sólo el resultado textual canónico necesita render/export estructural. */
  format?: TextFormat;
}

const text = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

function flattenResearch(
  data: ResearchData,
  questions: readonly ResearchQuestion[]
): FlatField[] {
  const byId = new Map((data.answers ?? []).map((answer) => [answer.questionId, answer.value]));
  return questions.map((question) => ({
    group: question.group,
    label: question.prompt,
    value: text(byId.get(question.id)),
  }));
}

function flattenWorklog(data: AIWorklogData): FlatField[] {
  const result = normalizeAIResult(data);
  return [
    { group: null, label: 'Herramienta', value: text(data.provider) },
    { group: null, label: 'Modelo', value: text(data.model) },
    { group: null, label: 'Enlace a la conversación', value: text(data.conversationUrl) },
    { group: null, label: 'Objetivo', value: text(data.objective) },
    { group: null, label: 'Prompt utilizado', value: text(data.prompt) },
    { group: null, label: 'Resultado', value: result.content, format: result.format },
    { group: null, label: 'Análisis del estudiante', value: text(data.studentAnalysis) },
    { group: null, label: '¿Qué utilizó?', value: text(data.whatWasUsed) },
    { group: null, label: '¿Qué modificó?', value: text(data.whatWasChanged) },
    { group: null, label: '¿Qué descartó?', value: text(data.whatWasDiscarded) },
  ];
}

function flattenLink(data: ExternalLinkData): FlatField[] {
  return [
    { group: null, label: 'Proveedor', value: text(data.provider) },
    { group: null, label: 'Título', value: text(data.title) },
    { group: null, label: 'Enlace', value: text(data.url) },
    { group: null, label: 'Descripción', value: text(data.description) },
  ];
}

function flattenProject(data: WebProjectData): FlatField[] {
  return [
    { group: null, label: 'Proyecto', value: text(data.projectTitle) },
    { group: null, label: 'Dirección', value: text(data.projectPath) },
    { group: null, label: 'Nota', value: text(data.note) },
  ];
}

function flattenFreeform(data: FreeformData): FlatField[] {
  const links = (data.links ?? []).map((link) => `${link.label}: ${link.url}`).join('\n');
  return [
    { group: null, label: 'Respuesta', value: text(data.text) },
    { group: null, label: 'Enlaces', value: links },
  ];
}

/** Convierte cualquier entrega en una lista plana de campos legibles. */
export function flattenSubmission(
  submission: Submission,
  questions: readonly ResearchQuestion[] = []
): FlatField[] {
  const data = submission.data as never;
  switch (submission.type) {
    case 'research':
      return flattenResearch(data as ResearchData, questions);
    case 'ai_worklog':
      return flattenWorklog(data as AIWorklogData);
    case 'external_link':
      return flattenLink(data as ExternalLinkData);
    case 'web_project':
      return flattenProject(data as WebProjectData);
    case 'freeform':
    default:
      return flattenFreeform(data as FreeformData);
  }
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function exportJson(bundle: ExportBundle): string {
  return JSON.stringify(
    {
      course: bundle.courseName,
      assignment: {
        title: bundle.assignment.title,
        type: bundle.assignment.type,
        description: bundle.assignment.description,
        instructions: bundle.assignment.instructions,
        dueDate: bundle.assignment.dueDate,
        questions: bundle.assignment.researchQuestions,
      },
      exportedAt: new Date().toISOString(),
      submissions: bundle.submissions.map((submission) => ({
        student: submission.student.displayName,
        handle: submission.student.handle,
        status: submission.status,
        submittedAt: submission.submittedAt,
        reviewedAt: submission.reviewedAt,
        data: submission.data,
      })),
      missing: bundle.missing ?? [],
    },
    null,
    2
  );
}

/**
 * §11: exportación específica de AI Worklogs, con la forma exacta del encargo.
 * Es un JSON distinto del general a propósito: aquí el objeto tiene los campos
 * al primer nivel para poder pegarlo en una IA sin tener que explicarle antes
 * la estructura.
 */
export function exportWorklogsJson(bundle: ExportBundle): string {
  const rows = bundle.submissions
    .filter((submission) => submission.type === 'ai_worklog')
    .map((submission) => {
      const data = submission.data as AIWorklogData;
      return {
        student: submission.student.displayName,
        handle: submission.student.handle,
        provider: data.provider ?? '',
        model: data.model ?? '',
        objective: data.objective ?? '',
        prompt: data.prompt ?? '',
        result: normalizeAIResult(data),
        // Conservado para consumidores legacy del JSON específico.
        responseSummary: data.responseSummary ?? '',
        studentAnalysis: data.studentAnalysis ?? '',
        whatWasUsed: data.whatWasUsed ?? '',
        whatWasChanged: data.whatWasChanged ?? '',
        whatWasDiscarded: data.whatWasDiscarded ?? '',
        conversationUrl: data.conversationUrl ?? '',
      };
    });

  return JSON.stringify(rows, null, 2);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Escapa una celda de CSV.
 *
 * El prefijo con comilla simple ante `= + - @` no es paranoia decorativa: Excel
 * y Sheets interpretan esas celdas como fórmulas, y aquí se exporta texto
 * escrito por terceros. Una respuesta que empiece por `=` no debe ejecutarse
 * al abrir el archivo.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * CSV con una fila por estudiante y una columna por campo.
 *
 * Sólo tiene sentido cuando todas las entregas comparten estructura, que es el
 * caso de `research` y de `ai_worklog`. Para tipos de forma libre la tabla sale
 * pobre, y por eso la interfaz ofrece CSV sólo donde aporta.
 */
export function exportCsv(bundle: ExportBundle): string {
  const questions = bundle.assignment.researchQuestions ?? [];

  const [first] = bundle.submissions;
  const columns = first
    ? flattenSubmission(first, questions).map((field) =>
        field.group ? `${field.group} — ${field.label}` : field.label
      )
    : questions.map((question) => question.prompt);

  const header = ['Estudiante', 'Handle', 'Estado', 'Entregado', ...columns];

  const rows = bundle.submissions.map((submission) => {
    const fields = flattenSubmission(submission, questions);
    return [
      submission.student.displayName,
      submission.student.handle,
      SUBMISSION_STATUS_LABEL[submission.status],
      submission.submittedAt ?? '',
      ...fields.map((field) => field.value),
    ];
  });

  const missing = (bundle.missing ?? []).map((person) => [
    person.displayName,
    person.handle,
    'Sin entrega',
    '',
    ...columns.map(() => ''),
  ]);

  return [header, ...rows, ...missing]
    .map((row) => row.map((cell) => csvCell(String(cell ?? ''))).join(','))
    .join('\r\n');
}

// ---------------------------------------------------------------------------
// Markdown preparado para IA
// ---------------------------------------------------------------------------

function markdownFields(fields: readonly FlatField[]): string {
  const lines: string[] = [];
  let currentGroup: string | null = null;

  for (const field of fields) {
    if (field.group && field.group !== currentGroup) {
      currentGroup = field.group;
      lines.push('', `### ${field.group}`);
    }
    if (!field.group) currentGroup = null;
    if (field.format) {
      // El contenido se inserta como fuente; nunca se serializa como una cadena
      // JSON ni se encierra en un fence que rompería sus propios fences.
      lines.push('', `## ${field.label}`, '', field.value || EMPTY);
    } else {
      lines.push('', `**${field.label}**`, field.value || EMPTY);
    }
  }

  return lines.join('\n');
}

/**
 * Markdown para pegar en una IA. Un solo estudiante o el grupo entero: la
 * estructura es la misma y sólo cambia cuántos bloques `##` hay.
 */
export function exportMarkdown(bundle: ExportBundle): string {
  const { assignment } = bundle;
  const questions = assignment.researchQuestions ?? [];

  const head = [
    `# Actividad: ${assignment.title}`,
    '',
    `- Materia: ${bundle.courseName}`,
    `- Tipo de entrega: ${ASSIGNMENT_TYPE_LABEL[assignment.type]}`,
    ...(assignment.dueDate ? [`- Fecha límite: ${assignment.dueDate}`] : []),
    `- Entregas incluidas: ${bundle.submissions.length}`,
  ];

  if (assignment.description) head.push('', '## Consigna', assignment.description);
  if (assignment.instructions) head.push('', '## Instrucciones', assignment.instructions);

  const body = bundle.submissions.map((submission) => {
    const fields = flattenSubmission(submission, questions);
    return [
      '',
      '---',
      '',
      `## Estudiante: ${submission.student.displayName} (@${submission.student.handle})`,
      '',
      `Estado: ${SUBMISSION_STATUS_LABEL[submission.status]}` +
        (submission.submittedAt ? ` · Entregado: ${submission.submittedAt}` : ''),
      markdownFields(fields),
    ].join('\n');
  });

  const missing = bundle.missing ?? [];
  const tail =
    missing.length > 0
      ? [
          '',
          '---',
          '',
          '## Sin entrega',
          '',
          ...missing.map((person) => `- ${person.displayName} (@${person.handle})`),
        ]
      : [];

  // No compactar saltos globalmente: podrían pertenecer al resultado Markdown
  // o a un bloque de código pegado por el estudiante.
  return [...head, ...body, ...tail].join('\n') + '\n';
}

/** §11: variante Markdown centrada en los AI Worklogs. */
export function exportWorklogsMarkdown(bundle: ExportBundle): string {
  const worklogs = bundle.submissions.filter((submission) => submission.type === 'ai_worklog');
  return exportMarkdown({ ...bundle, submissions: worklogs });
}

// ---------------------------------------------------------------------------
// Selección de formato
// ---------------------------------------------------------------------------

export type ExportFormat = 'json' | 'csv' | 'md';

export interface ExportResult {
  body: string;
  contentType: string;
  filename: string;
}

const safeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'export';

export function buildExport(
  bundle: ExportBundle,
  format: ExportFormat,
  scope: 'all' | 'worklogs' = 'all'
): ExportResult {
  const base = `${safeName(bundle.assignment.title)}${scope === 'worklogs' ? '-ai-worklogs' : ''}`;

  if (format === 'json') {
    return {
      body: scope === 'worklogs' ? exportWorklogsJson(bundle) : exportJson(bundle),
      contentType: 'application/json; charset=utf-8',
      filename: `${base}.json`,
    };
  }

  if (format === 'csv') {
    return {
      body: exportCsv(
        scope === 'worklogs'
          ? {
              ...bundle,
              submissions: bundle.submissions.filter((s) => s.type === 'ai_worklog'),
            }
          : bundle
      ),
      contentType: 'text/csv; charset=utf-8',
      filename: `${base}.csv`,
    };
  }

  return {
    body: scope === 'worklogs' ? exportWorklogsMarkdown(bundle) : exportMarkdown(bundle),
    contentType: 'text/markdown; charset=utf-8',
    filename: `${base}.md`,
  };
}
