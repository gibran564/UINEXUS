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
import {
  assignment,
  course,
  step,
  stepEvidence,
  submission,
  worklogData,
  UID,
} from './academic-fixtures';

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

/**
 * Una actividad POR PARTES no tiene una forma: tiene una por parte.
 *
 * Antes, aplanar una entrega así caía en el aplanador de entrega libre y
 * devolvía «Respuesta: (sin respuesta)» sobre un laboratorio entero. Es la
 * misma ceguera que la regresión de la Fase 4 —una pantalla que no distingue
 * una actividad por partes— pero en la capa de LECTURA, que es la que alimenta
 * la exportación, el CSV y el visor docente.
 */
describe('aplanado de una actividad por partes', () => {
  const byParts = () =>
    toAssignment(
      assignment({
        type: 'workflow',
        workflow: [
          step({
            id: 'lab',
            title: 'Tu laboratorio',
            deliverables: [{ type: 'nexbook', required: true, hint: '', questions: [] }],
          }),
          step({
            id: 'ia',
            title: 'Registrar uso de IA',
            deliverables: [{ type: 'ai_worklog', required: true, hint: '', questions: [] }],
          }),
          step({
            id: 'cierre',
            title: 'Tu conclusión',
            deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
          }),
        ],
      }),
      { viewerRole: 'teacher', roster: course().students }
    );

  const delivered = () =>
    toSubmission(
      submission({
        type: 'workflow',
        stepEvidence: {
          lab: stepEvidence({
            stepId: 'lab',
            note: 'Me costó la hoja.',
            data: {
              nexbookId: 'i1',
              revision: 4,
              title: 'Ventas',
              submittedAt: '2026-09-05T10:00:00.000Z',
              snapshot: {
                formatVersion: 1,
                blocks: [
                  { id: 'b1', type: 'markdown', source: 'Las ventas suben en Q4.' },
                  { id: 'b2', type: 'code', language: 'python', source: 'print(1)' },
                ],
                results: {},
              },
            } as never,
          }),
          ia: stepEvidence({
            stepId: 'ia',
            toolName: 'Claude',
            data: worklogData({ objective: 'Comparar métodos' }) as never,
          }),
          cierre: stepEvidence({
            stepId: 'cierre',
            data: { text: 'Me quedo con el símplex.', links: [] } as never,
          }),
        },
      })
    );

  it('lee cada Parte con el aplanador de SU entregable', () => {
    const fields = flattenSubmission(delivered(), [], byParts().workflow);
    const byLabel = (group: string, label: string) =>
      fields.find((field) => field.group === group && field.label === label)?.value;

    expect(byLabel('Tu laboratorio', 'Laboratorio')).toBe('Ventas');
    expect(byLabel('Tu laboratorio', 'Texto del laboratorio')).toContain('Las ventas suben');
    expect(byLabel('Registrar uso de IA', 'Objetivo')).toBe('Comparar métodos');
    expect(byLabel('Tu conclusión', 'Respuesta')).toBe('Me quedo con el símplex.');
  });

  it('conserva la herramienta declarada y la nota de cada Parte', () => {
    const fields = flattenSubmission(delivered(), [], byParts().workflow);
    expect(
      fields.find((field) => field.label === 'Herramienta declarada')
    ).toMatchObject({ group: 'Registrar uso de IA', value: 'Claude' });
    expect(fields.find((field) => field.label === 'Nota del estudiante')).toMatchObject({
      group: 'Tu laboratorio',
      value: 'Me costó la hoja.',
    });
  });

  it('una Parte sin entregar se dice, no desaparece', () => {
    const partial = toSubmission(
      submission({ type: 'workflow', stepEvidence: {} })
    );
    const fields = flattenSubmission(partial, [], byParts().workflow);

    expect(fields.map((field) => field.group)).toEqual([
      'Tu laboratorio',
      'Registrar uso de IA',
      'Tu conclusión',
    ]);
    expect(fields.every((field) => field.value === '')).toBe(true);
  });

  it('la exportación en Markdown ya no sale vacía', () => {
    const text = exportMarkdown({
      assignment: byParts(),
      courseName: 'Investigación de Operaciones',
      submissions: [delivered()],
    });

    expect(text).toContain('Tu laboratorio');
    expect(text).toContain('Las ventas suben en Q4.');
    expect(text).toContain('Comparar métodos');
    // Y el encabezado dice qué es, en vez de quedarse en `undefined`.
    expect(text).toContain('Actividad por partes');
    expect(text).not.toContain('undefined');
  });

  it('el CSV pone una columna por Parte y campo', () => {
    const csv = exportCsv({
      assignment: byParts(),
      courseName: 'Investigación de Operaciones',
      submissions: [delivered()],
    });

    expect(csv).toContain('Tu laboratorio — Laboratorio');
    expect(csv).toContain('Tu conclusión — Respuesta');
  });
});
