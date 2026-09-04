import type { AITextResult, AIWorklogData, TextFormat } from './types';

/**
 * Detecta Markdown únicamente cuando existe una señal estructural clara.
 *
 * Es deliberadamente conservador: texto con asteriscos o guiones aislados
 * sigue siendo texto plano. Un falso negativo conserva todo el contenido; un
 * falso positivo podría cambiar cómo se interpreta una respuesta arbitraria.
 */
export function detectTextFormat(content: string): TextFormat {
  if (!content.trim()) return 'plain_text';

  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  if (lines.some((line) => /^\s{0,3}#{1,6}\s+\S/.test(line))) return 'markdown';
  if (lines.some((line) => /^\s{0,3}```[^`]*$/.test(line))) return 'markdown';
  if (lines.some((line) => /^\s{0,3}>\s+\S/.test(line))) return 'markdown';
  if (/\[[^\]\n]+\]\(https?:\/\/[^\s)]+(?:\s+"[^"]*")?\)/i.test(content)) {
    return 'markdown';
  }

  const listLines = lines.filter((line) => /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)\S/.test(line));
  if (listLines.length >= 2) return 'markdown';

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? '';
    const separator = lines[index + 1] ?? '';
    if (
      header.includes('|') &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)
    ) {
      return 'markdown';
    }
  }

  return 'plain_text';
}

/**
 * Resultado textual efectivo de un AI Worklog.
 *
 * Los registros nuevos guardan `result`. Los anteriores conservan únicamente
 * `responseSummary` y se leen como texto plano, sin migración ni reescritura.
 * Si un cliente nuevo omitió `format`, se aplica la detección conservadora.
 */
export function normalizeAIResult(
  data: Pick<AIWorklogData, 'result' | 'responseSummary'> | null | undefined
): AITextResult {
  const stored = data?.result;
  if (stored && typeof stored.content === 'string') {
    const format =
      stored.format === 'markdown' || stored.format === 'plain_text'
        ? stored.format
        : detectTextFormat(stored.content);
    return { content: stored.content, format };
  }

  return {
    content: typeof data?.responseSummary === 'string' ? data.responseSummary : '',
    format: 'plain_text',
  };
}

const section = (title: string, value: string): string =>
  `## ${title}\n\n${value || '(sin respuesta)'}`;

/**
 * AI Worklog completo como Markdown de intercambio.
 *
 * El resultado se inserta como fuente, no como JSON, bloque de código ni HTML:
 * títulos, tablas, enlaces y fences permanecen utilizables por el siguiente
 * paso. Esta función tampoco resume, traduce ni corrige el contenido.
 */
export function aiWorklogToMarkdown(data: AIWorklogData): string {
  const result = normalizeAIResult(data);
  const blocks = [
    '# AI Worklog',
    section('Herramienta', data.provider ?? ''),
    section('Modelo', data.model ?? ''),
    section('Objetivo', data.objective ?? ''),
    section('Prompt utilizado', data.prompt ?? ''),
    section('Resultado', result.content),
    section('Análisis del estudiante', data.studentAnalysis ?? ''),
    section('Qué utilicé', data.whatWasUsed ?? ''),
    section('Qué modifiqué', data.whatWasChanged ?? ''),
    section('Qué descarté', data.whatWasDiscarded ?? ''),
  ];

  if (data.conversationUrl) {
    blocks.push(section('Conversación', data.conversationUrl));
  }

  return `${blocks.join('\n\n')}\n`;
}

/** Sólo HTTP(S) puede convertirse en un enlace navegable. */
export function safeMarkdownUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}
