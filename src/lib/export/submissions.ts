import type {
  AIWorklogData,
  Assignment,
  CodeData,
  ExternalLinkData,
  FreeformData,
  MediaData,
  NexBookSubmissionData,
  ResearchData,
  ResearchQuestion,
  StepDeliverable,
  Submission,
  SubmissionData,
  TextFormat,
  WebProjectData,
  WorkflowStep,
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

function flattenMedia(data: MediaData): FlatField[] {
  return [
    { group: null, label: 'Archivo', value: text(data.fileName) },
    { group: null, label: 'Enlace', value: text(data.url) },
    { group: null, label: 'Nota', value: text(data.note) },
  ];
}

function flattenCode(data: CodeData): FlatField[] {
  return [
    { group: null, label: 'Lenguaje', value: text(data.language) },
    { group: null, label: 'Código', value: text(data.code) },
    { group: null, label: 'Archivo adjunto', value: text(data.fileName) },
    { group: null, label: 'Explicación', value: text(data.explanation) },
  ];
}

/**
 * Un laboratorio entregado, resumido.
 *
 * No se vuelca el documento: un NexBook lleva hojas, salidas e imágenes, y
 * pegarlo entero en un CSV o en un prompt no lo hace legible, lo hace ruido. Se
 * dice qué hay —cuántos bloques, de qué tipo— y el texto que el estudiante
 * escribió, que es lo que se lee. El documento completo se abre en su visor.
 */
function flattenNexBook(data: NexBookSubmissionData): FlatField[] {
  const blocks = data.snapshot?.blocks ?? [];
  const kinds = new Map<string, number>();
  for (const block of blocks) kinds.set(block.type, (kinds.get(block.type) ?? 0) + 1);

  const written = blocks
    .flatMap((block) => (block.type === 'markdown' ? [block.source] : []))
    .join('\n\n');

  return [
    { group: null, label: 'Laboratorio', value: text(data.title) },
    {
      group: null,
      label: 'Contenido',
      value: blocks.length === 0 ? '' : [...kinds].map(([kind, count]) => `${count} ${kind}`).join(', '),
    },
    { group: null, label: 'Texto del laboratorio', value: text(written) },
  ];
}

/**
 * Qué aplanador le corresponde a un ENTREGABLE.
 *
 * Es el mismo reparto que hace `evidence-reader.tsx` para pintarlo, y por la
 * misma razón: lo que decide la forma es el entregable de la parte, no el tipo
 * de la actividad. Tenerlo aquí es lo que permite que exportar una actividad
 * por partes diga algo.
 */
function flattenDeliverable(
  deliverable: StepDeliverable,
  data: SubmissionData,
  fallbackQuestions: readonly ResearchQuestion[]
): FlatField[] {
  switch (deliverable.type) {
    case 'structured':
      return flattenResearch(
        data as ResearchData,
        deliverable.questions.length > 0 ? deliverable.questions : fallbackQuestions
      );
    case 'ai_worklog':
      return flattenWorklog(data as AIWorklogData);
    case 'url':
      return flattenLink(data as ExternalLinkData);
    case 'project':
      return flattenProject(data as WebProjectData);
    case 'file':
    case 'image':
    case 'video':
      return flattenMedia(data as MediaData);
    case 'code':
      return flattenCode(data as CodeData);
    case 'nexbook':
      return flattenNexBook(data as NexBookSubmissionData);
    case 'none':
    case 'text':
    case 'resource_reference':
    default:
      return flattenFreeform(data as FreeformData);
  }
}

/**
 * Convierte cualquier entrega en una lista plana de campos legibles.
 *
 * ## Por qué hace falta `workflow`
 *
 * Una actividad por partes NO tiene una forma: tiene una por parte, y sólo la
 * definición de la actividad dice cuál es cada una. Sin ese dato, esta función
 * caía en el aplanador de entrega libre y devolvía «Respuesta: (sin respuesta)»
 * sobre un laboratorio entero —en la exportación de Markdown para IA, en el CSV
 * y en el visor docente—. Es la misma ceguera que la regresión de la Fase 4, en
 * la capa de lectura.
 *
 * Se pasa por parámetro y no se deduce del tipo porque este módulo es puro y no
 * puede ir a buscar la actividad. Quien exporta ya la tiene.
 */
export function flattenSubmission(
  submission: Submission,
  questions: readonly ResearchQuestion[] = [],
  workflow: readonly WorkflowStep[] = []
): FlatField[] {
  const data = submission.data as never;

  if (submission.type === 'workflow') {
    return workflow.flatMap((step) => {
      const evidence = submission.stepEvidence[step.id];
      const deliverable = step.deliverables[0];
      const title = step.title || 'Parte';

      if (!evidence || !deliverable) {
        return [{ group: title, label: 'Entrega', value: '' }];
      }

      const fields = flattenDeliverable(deliverable, evidence.data, questions).map((field) => ({
        ...field,
        // El agrupador pasa a ser la PARTE. En una investigación dentro de una
        // parte ya había grupo propio; se encadenan para no perder ninguno.
        group: field.group ? `${title} — ${field.group}` : title,
      }));

      const extras: FlatField[] = [];
      if (evidence.toolName) {
        extras.push({ group: title, label: 'Herramienta declarada', value: evidence.toolName });
      }
      if (evidence.note) {
        extras.push({ group: title, label: 'Nota del estudiante', value: evidence.note });
      }

      return [...fields, ...extras];
    });
  }

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
    ? flattenSubmission(first, questions, bundle.assignment.workflow).map((field) =>
        field.group ? `${field.group} — ${field.label}` : field.label
      )
    : questions.map((question) => question.prompt);

  const header = ['Estudiante', 'Handle', 'Estado', 'Entregado', ...columns];

  const rows = bundle.submissions.map((submission) => {
    const fields = flattenSubmission(submission, questions, bundle.assignment.workflow);
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
    `- Tipo de entrega: ${ASSIGNMENT_TYPE_LABEL[assignment.type] ?? 'Actividad por partes'}`,
    ...(assignment.dueDate ? [`- Fecha límite: ${assignment.dueDate}`] : []),
    `- Entregas incluidas: ${bundle.submissions.length}`,
  ];

  if (assignment.description) head.push('', '## Consigna', assignment.description);
  if (assignment.instructions) head.push('', '## Instrucciones', assignment.instructions);

  const body = bundle.submissions.map((submission) => {
    const fields = flattenSubmission(submission, questions, bundle.assignment.workflow);
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
