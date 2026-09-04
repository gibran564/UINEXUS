import { describe, expect, it } from 'vitest';
import {
  buildExport,
  exportCsv,
  exportMarkdown,
  exportWorklogsJson,
  flattenSubmission,
} from '../../src/lib/export/submissions';
import { toAssignment, toSubmission } from '../../src/lib/data/academic-mappers';
import {
  aiWorklogDataSchema,
  assignmentInputSchema,
  httpUrlSchema,
} from '../../src/lib/academic-schemas';
import { assignment, course, submission, worklogData, UID } from './academic-fixtures';

const publicAssignment = () =>
  toAssignment(assignment(), { viewerRole: 'teacher', roster: course().students });

const bundle = (overrides: Partial<Parameters<typeof exportMarkdown>[0]> = {}) => ({
  assignment: publicAssignment(),
  courseName: 'Diseño Centrado en el Usuario',
  submissions: [toSubmission(submission())],
  missing: [{ handle: 'ana', displayName: 'Ana Lucía Reyes' }],
  ...overrides,
});

describe('aplanado de una entrega', () => {
  it('empareja cada respuesta con SU pregunta, no con un identificador', () => {
    const fields = flattenSubmission(toSubmission(submission()), publicAssignment().researchQuestions);
    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({
      group: 'Arquitectura de información',
      label: 'Definición',
      value: 'Cómo se organiza y etiqueta la información.',
    });
  });

  it('un campo sin contestar sale vacío, no desaparece', () => {
    const fields = flattenSubmission(toSubmission(submission()), publicAssignment().researchQuestions);
    // q3 (Card sorting) no se contestó: tiene que seguir estando en la lista.
    expect(fields[2]).toMatchObject({ group: 'Card sorting', value: '' });
  });
});

describe('exportación en Markdown para IA', () => {
  it('lleva la materia, la actividad y un bloque por estudiante', () => {
    const text = exportMarkdown(bundle());
    expect(text).toContain('# Actividad: Glosario de arquitectura de información');
    expect(text).toContain('- Materia: Diseño Centrado en el Usuario');
    expect(text).toContain('## Estudiante: Christian González (@christian)');
  });

  it('escribe las preguntas junto a las respuestas', () => {
    const text = exportMarkdown(bundle());
    expect(text).toContain('### Arquitectura de información');
    expect(text).toContain('**Definición**');
    expect(text).toContain('Cómo se organiza y etiqueta la información.');
  });

  it('dice explícitamente qué quedó sin responder', () => {
    // Distinguir «no contestó» de «no se le preguntó» es justo lo que se quiere
    // poder analizar después con una IA.
    expect(exportMarkdown(bundle())).toContain('(sin respuesta)');
  });

  it('nombra a quien no entregó en vez de omitirlo en silencio', () => {
    const text = exportMarkdown(bundle());
    expect(text).toContain('## Sin entrega');
    expect(text).toContain('Ana Lucía Reyes');
  });

  it('no filtra ningún UID', () => {
    const text = exportMarkdown(bundle());
    expect(text).not.toContain(UID.christian);
    expect(text).not.toContain(UID.luz);
  });
});

describe('exportación en CSV', () => {
  it('una fila por estudiante y una columna por campo', () => {
    const rows = exportCsv(bundle()).split('\r\n');
    expect(rows[0]).toContain('"Estudiante"');
    expect(rows[0]).toContain('"Arquitectura de información — Definición"');
    expect(rows[1]).toContain('"Christian González"');
  });

  it('quien no entregó también aparece, marcado como tal', () => {
    expect(exportCsv(bundle())).toContain('"Sin entrega"');
  });

  it('neutraliza las respuestas que Excel tomaría por fórmula', () => {
    const evil = toSubmission(
      submission({
        data: { answers: [{ questionId: 'q1', value: '=HYPERLINK("http://malo","clic")' }] },
      })
    );
    const csv = exportCsv(bundle({ submissions: [evil] }));
    // El apóstrofo delante impide que la hoja de cálculo la evalúe al abrirla.
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it('escapa las comillas dobles duplicándolas', () => {
    const quoted = toSubmission(
      submission({ data: { answers: [{ questionId: 'q1', value: 'dijo "hola"' }] } })
    );
    expect(exportCsv(bundle({ submissions: [quoted] }))).toContain('"dijo ""hola"""');
  });
});

describe('exportación específica de AI Worklogs (§11)', () => {
  const data = worklogData();

  const worklogBundle = () =>
    bundle({
      assignment: { ...publicAssignment(), type: 'ai_worklog', researchQuestions: [] },
      submissions: [toSubmission(submission({ type: 'ai_worklog', data }))],
      missing: [],
    });

  it('produce objetos planos con los campos del encargo', () => {
    const rows = JSON.parse(exportWorklogsJson(worklogBundle())) as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      student: 'Christian González',
      provider: 'ChatGPT',
      model: 'GPT-5',
      objective: 'Evaluar heurísticas',
      conversationUrl: 'https://chatgpt.com/share/abc',
    });
  });

  it('deja fuera lo que no sea un AI Worklog', () => {
    const mixed = worklogBundle();
    mixed.submissions = [...mixed.submissions, toSubmission(submission({ id: 'z' }))];
    const rows = JSON.parse(exportWorklogsJson(mixed)) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('la variante Markdown nombra el prompt y lo que el estudiante decidió', () => {
    const result = buildExport(worklogBundle(), 'md', 'worklogs');
    expect(result.filename).toMatch(/-ai-worklogs\.md$/);
    expect(result.body).toContain('**Prompt utilizado**');
    // El export lo lee el profesorado SOBRE un estudiante, así que los
    // rótulos van en tercera persona; el formulario, que le habla a quien
    // entrega, los escribe en segunda.
    expect(result.body).toContain('**¿Qué descartó?**');
  });
});

describe('selección de formato', () => {
  it('cada formato lleva su tipo de contenido y su extensión', () => {
    expect(buildExport(bundle(), 'json')).toMatchObject({
      contentType: 'application/json; charset=utf-8',
    });
    expect(buildExport(bundle(), 'csv').filename).toMatch(/\.csv$/);
    expect(buildExport(bundle(), 'md').filename).toMatch(/\.md$/);
  });

  it('el nombre del archivo sale del título, sin acentos ni espacios', () => {
    expect(buildExport(bundle(), 'md').filename).toBe(
      'glosario-de-arquitectura-de-informacion.md'
    );
  });
});

describe('validación de lo que se guarda', () => {
  it('rechaza un enlace con esquema javascript:', () => {
    // `z.string().url()` lo aceptaría. Aquí se guarda un enlace que otra
    // persona va a abrir, así que el esquema se comprueba de verdad.
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrlSchema.safeParse('data:text/html,<script>').success).toBe(false);
    expect(httpUrlSchema.safeParse('https://figma.com/file/abc').success).toBe(true);
  });

  it('el enlace a la conversación es opcional', () => {
    const parsed = aiWorklogDataSchema.safeParse({ provider: 'Claude', prompt: 'hola' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.conversationUrl).toBe('');
  });

  it('una tarea sin `assignedHandles` es para todo el grupo', () => {
    const parsed = assignmentInputSchema.safeParse({
      title: 'Evaluación con IA',
      type: 'ai_worklog',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.assignedHandles ?? null).toBeNull();
  });

  it('una tarea sin título no se guarda', () => {
    expect(assignmentInputSchema.safeParse({ title: 'ab', type: 'research' }).success).toBe(false);
  });
});
