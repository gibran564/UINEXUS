import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  aiWorklogToMarkdown,
  detectTextFormat,
  normalizeAIResult,
} from '../../src/lib/ai-worklog';
import { assignmentInputSchema, aiWorklogDataSchema } from '../../src/lib/academic-schemas';
import { toAssignment, toSubmission } from '../../src/lib/data/academic-mappers';
import { buildWorkflowGroupView } from '../../src/lib/collaborative';
import { exportWorklogsMarkdown } from '../../src/lib/export/submissions';
import {
  availableDependencyResults,
  hasContent,
} from '../../src/lib/workflow';
import { MarkdownContent } from '../../src/components/aula/markdown-content';
import {
  assignment,
  course,
  step,
  stepEvidence,
  submission,
  workflowAssignment,
  worklogData,
} from './academic-fixtures';

describe('detección conservadora del formato textual', () => {
  it.each([
    ['heading', '# Hallazgos'],
    ['lista', '- Uno\n- Dos'],
    ['tabla', '| Hallazgo | Impacto |\n|---|---|\n| Menú | Alto |'],
    ['code fence', '```typescript\nconst example = true\n```'],
    ['blockquote', '> Fuente consultada'],
    ['enlace', '[Fuente](https://example.com/informe)'],
  ])('detecta %s', (_name, content) => {
    expect(detectTextFormat(content)).toBe('markdown');
  });

  it('deja como texto plano lo que no tiene estructura clara', () => {
    expect(detectTextFormat('Una respuesta normal con - un guion intermedio.')).toBe('plain_text');
  });
});

describe('compatibilidad del AI Worklog', () => {
  it('lee el campo legacy como texto plano', () => {
    expect(normalizeAIResult(worklogData({ responseSummary: '# No se reinterpretaba' }))).toEqual({
      content: '# No se reinterpretaba',
      format: 'plain_text',
    });
  });

  it('prefiere el resultado nuevo y respeta su formato explícito', () => {
    expect(
      normalizeAIResult(
        worklogData({
          responseSummary: 'legacy',
          result: { content: '# Nuevo', format: 'markdown' },
        })
      )
    ).toEqual({ content: '# Nuevo', format: 'markdown' });
  });

  it('detecta el formato cuando un cliente nuevo lo omite', () => {
    const parsed = aiWorklogDataSchema.parse({
      provider: 'Claude',
      prompt: 'Analiza',
      result: { content: '| A | B |\n|---|---|\n| 1 | 2 |' },
    });
    expect(parsed.result?.format).toBe('markdown');
  });

  it('normaliza ausencia y resultado vacío sin fallar', () => {
    expect(normalizeAIResult(undefined)).toEqual({ content: '', format: 'plain_text' });
    expect(normalizeAIResult({ result: { content: '', format: 'markdown' }, responseSummary: '' }))
      .toEqual({ content: '', format: 'markdown' });
  });
});

describe('renderer Markdown seguro con GFM', () => {
  const render = (content: string) =>
    renderToStaticMarkup(createElement(MarkdownContent, { content, format: 'markdown' }));

  it('renderiza tablas, enlaces HTTPS y código sin ejecutarlo', () => {
    const html = render(
      '| Hallazgo | Impacto |\n|---|---|\n| Menú | Alto |\n\n' +
        '[Fuente](https://example.com)\n\n' +
        '```typescript\nconst example = true\n```'
    );
    expect(html).toContain('<table');
    expect(html).not.toContain('|---|');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('language-typescript');
    expect(html).toContain('const example = true');
  });

  it('omite HTML crudo y rechaza protocolos peligrosos', () => {
    const html = render(
      '<script>alert(1)</script><b onclick="evil()">texto</b>\n\n' +
        '[js](javascript:alert(1)) [data](data:text/html,x) [file](file:///tmp/x)'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('file:');
  });
});

describe('intercambio y exportación Markdown', () => {
  const source =
    '# Hallazgos\n\n- Problema A\n- Problema B\n\n' +
    '| Hallazgo | Prioridad |\n|---|---|\n| Navegación | Alta |\n\n' +
    '[Fuente](https://example.com)\n\n```typescript\nconst example = true\n```';
  const data = worklogData({
    responseSummary: '',
    result: { content: source, format: 'markdown' },
  });

  it('copia el Worklog completo sin escapar el resultado', () => {
    const markdown = aiWorklogToMarkdown(data);
    expect(markdown).toContain(`## Resultado\n\n${source}`);
    expect(markdown).not.toContain(JSON.stringify(source));
  });

  it('preserva headings, listas, tablas, enlaces y fences en la exportación', () => {
    const record = assignment({ type: 'ai_worklog', researchQuestions: [] });
    const markdown = exportWorklogsMarkdown({
      assignment: toAssignment(record, { viewerRole: 'teacher', roster: course().students }),
      courseName: course().name,
      submissions: [toSubmission(submission({ type: 'ai_worklog', data }))],
      missing: [],
    });
    expect(markdown).toContain(`## Resultado\n\n${source}`);
  });
});

describe('Markdown dentro de un workflow', () => {
  const research = step({
    id: 'research',
    title: 'Investigación',
    deliverables: [{ type: 'ai_worklog', required: true, hint: '', questions: [] }],
  });
  const synthesis = step({ id: 'synthesis', title: 'Síntesis', dependsOnStepIds: ['research'] });
  const evidence = stepEvidence({
    stepId: 'research',
    data: worklogData({
      responseSummary: '',
      result: { content: '# Resultado previo', format: 'markdown' },
    }),
  });

  it('cuenta result.content como evidencia real', () => {
    expect(hasContent(evidence)).toBe(true);
  });

  it('expone cada dependencia textual por separado y copiable como fuente', () => {
    expect(
      availableDependencyResults([research, synthesis], synthesis, { research: evidence })
    ).toEqual([
      {
        stepId: 'research',
        title: 'Investigación',
        content: '# Resultado previo',
        format: 'markdown',
      },
    ]);
  });

  it('la vista grupal conserva el resultado canónico dentro de la evidencia', () => {
    const item = workflowAssignment({ workflow: [research, synthesis] });
    const result = buildWorkflowGroupView(item, course(), [
      submission({
        type: 'workflow',
        stepEvidence: { research: evidence },
        data: evidence.data,
      }),
    ]);
    const stored = result.steps[0]?.contributions[0]?.evidence?.data as ReturnType<
      typeof worklogData
    >;
    expect(normalizeAIResult(stored)).toEqual({
      content: '# Resultado previo',
      format: 'markdown',
    });
  });

  it('el esquema server-side rechaza dependencias cíclicas', () => {
    const parsed = assignmentInputSchema.safeParse({
      title: 'Workflow cíclico',
      type: 'workflow',
      workflow: [
        { id: 'a', title: 'A', dependsOnStepIds: ['b'] },
        { id: 'b', title: 'B', dependsOnStepIds: ['a'] },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('cíclicas'))).toBe(true);
    }
  });
});
