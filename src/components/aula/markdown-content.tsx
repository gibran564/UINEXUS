import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownUrl } from '@/lib/ai-worklog';
import type { TextFormat } from '@/lib/types';

/**
 * Renderer compartido y seguro para resultados textuales.
 *
 * `react-markdown` no interpreta HTML crudo si no se instala `rehype-raw`; no
 * lo usamos. Los enlaces pasan además por una allowlist HTTP(S). Las imágenes
 * remotas se representan como enlace para no permitir tracking silencioso al
 * abrir una entrega.
 */
export function MarkdownContent({
  content,
  format,
}: {
  content: string;
  format: TextFormat;
}) {
  if (!content) return <span className="text-subtle">(sin respuesta)</span>;
  if (format === 'plain_text') {
    return <p className="max-w-prose whitespace-pre-wrap text-muted">{content}</p>;
  }

  return (
    <div className="markdown-content max-w-none text-muted">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => safeMarkdownUrl(url)}
        components={{
          a: ({ href, children }) => {
            const safe = safeMarkdownUrl(href ?? '');
            return safe ? (
              <a href={safe} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ src, alt }) => {
            const safe = typeof src === 'string' ? safeMarkdownUrl(src) : '';
            return safe ? (
              <a href={safe} target="_blank" rel="noopener noreferrer">
                {alt || 'Abrir imagen'}
              </a>
            ) : (
              <span>{alt ?? ''}</span>
            );
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-line bg-sunken p-2 text-left">{children}</th>,
          td: ({ children }) => <td className="border border-line p-2 align-top">{children}</td>,
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-sm border border-line bg-sunken p-4 text-sm">
              {children}
            </pre>
          ),
          code: ({ className, children }) => (
            <code className={`${className ?? ''} font-mono text-sm`}>{children}</code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-2 border-accent pl-4 text-subtle">{children}</blockquote>
          ),
          h1: ({ children }) => <h1 className="mt-6 font-display text-h2 text-fg first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-5 font-display text-h3 text-fg">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-4 font-medium text-fg">{children}</h3>,
          p: ({ children }) => <p className="my-3 max-w-prose">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
