'use client';

import { useEffect, useRef, useState } from 'react';
import { flattenSubmission, type FlatField } from '@/lib/export/submissions';
import { aiWorklogToMarkdown } from '@/lib/ai-worklog';
import type { AIWorklogData, Assignment, Submission } from '@/lib/types';
import { Notice, SubmissionBadge } from './aula-ui';
import { MarkdownContent } from './markdown-content';

/**
 * Visor de una entrega (§8).
 *
 * Lo que hace que esta pantalla sirva de verdad es el botón de copiar de CADA
 * bloque. §8 pide poder copiar el prompt, el resumen, la reflexión o el registro
 * entero, y no es un capricho: el flujo real de la docente es leer, copiar un
 * trozo y pegarlo en una IA para compararlo con otro. Un visor sin copiar
 * obliga a seleccionar texto a mano dentro de un diálogo, que es exactamente
 * donde la gente se rinde y vuelve al Word.
 *
 * Todo el contenido se pinta como TEXTO. Ni HTML, ni Markdown renderizado: es
 * texto que escribió otra persona y lo único que se hace con él es mostrarlo.
 */
export function SubmissionViewer({
  submission,
  assignment,
  onClose,
  onReview,
}: {
  submission: Submission;
  assignment: Assignment;
  onClose: () => void;
  onReview: (status: 'reviewed' | 'needs_changes', note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(submission.teacherNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape cierra. Es lo que espera cualquiera que abra algo encima de la
  // página, y no depende de encontrar el botón con el ratón.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fields = flattenSubmission(submission, assignment.researchQuestions);
  const worklog = submission.type === 'ai_worklog' ? (submission.data as AIWorklogData) : null;

  const fullText = worklog
    ? aiWorklogToMarkdown(worklog)
    : fields
        .map((field) => `${field.group ? `${field.group} — ` : ''}${field.label}\n${field.value || '(sin respuesta)'}`)
        .join('\n\n');

  async function review(status: 'reviewed' | 'needs_changes'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onReview(status, note);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la revisión.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Entrega de ${submission.student.displayName}`}
        tabIndex={-1}
        className="panel my-8 w-full max-w-3xl p-6"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 className="font-display text-h2">{submission.student.displayName}</h2>
            <p className="mt-1 text-sm text-muted">
              {assignment.title} · <span className="font-mono">@{submission.student.handle}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SubmissionBadge status={submission.status} />
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cerrar
            </button>
          </div>
        </header>

        {worklog?.conversationUrl && (
          <div className="mt-4">
            <a
              href={worklog.conversationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Abrir conversación ↗
            </a>
          </div>
        )}

        <div className="mt-5 space-y-5">
          {fields.map((field, index) => (
            <CopyBlock key={`${field.label}-${index}`} field={field} />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(fullText)}
            className="btn btn-secondary btn-sm"
          >
            {worklog ? 'Copiar AI Worklog' : 'Copiar registro completo'}
          </button>
        </div>

        <section aria-labelledby="revision" className="mt-6 border-t border-line pt-5">
          <h3 id="revision" className="font-display text-h3">
            Revisión
          </h3>
          <label className="mt-3 block">
            <span className="label">Comentario para el estudiante</span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Qué está bien y qué habría que ajustar."
              className="field"
            />
          </label>

          {error && (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void review('reviewed')}
              className="btn btn-primary btn-sm"
            >
              Marcar como revisada
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void review('needs_changes')}
              className="btn btn-secondary btn-sm"
            >
              Pedir cambios
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Un campo con su botón de copiar. El resultado se anuncia en aria-live. */
function CopyBlock({ field }: { field: FlatField }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(field.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">
          {field.group && <span className="text-subtle">{field.group} · </span>}
          {field.label}
        </h3>
        {field.value && (
          <button
            type="button"
            onClick={() => void copy()}
            className="text-label text-muted underline underline-offset-2 hover:text-fg"
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
      </div>
      <div className="mt-1">
        {field.format ? (
          <MarkdownContent content={field.value} format={field.format} />
        ) : (
          <p className="max-w-prose whitespace-pre-line text-muted">
            {field.value || <span className="text-subtle">(sin respuesta)</span>}
          </p>
        )}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${field.label} copiado al portapapeles.` : ''}
      </span>
    </div>
  );
}
