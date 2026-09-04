'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { SUBMISSION_FILTERS, type SubmissionFilter } from '@/lib/constants';
import {
  downloadText,
  fetchExport,
  reviewSubmission,
  type SubmissionsPage,
} from '@/lib/aula-client';
import type { Assignment, Submission } from '@/lib/types';
import { MemberChip, Notice, SubmissionBadge } from './aula-ui';
import { SubmissionViewer } from './submission-viewer';

/**
 * Entregas de una tarea, con selección y exportación (§8, §10, §11).
 *
 * La casilla de selección no es un adorno: §10 pide poder exportar una persona,
 * varias o todas, y esa es la unidad de trabajo real de la docente cuando va a
 * comparar respuestas con una IA. Por eso la selección vive en esta lista y no
 * en un diálogo aparte: se marca mientras se lee.
 *
 * La exportación se PREVISUALIZA antes de descargar. Es deliberado: lo que casi
 * siempre se quiere es copiar el texto y pegarlo en ChatGPT o Claude, no
 * acumular archivos en la carpeta de descargas. Descargar sigue estando, un
 * clic más allá.
 */
export function SubmissionsPanel({
  assignment,
  courseId,
  page,
  state,
  onReviewed,
}: {
  assignment: Assignment;
  courseId: string;
  page: SubmissionsPage | null | undefined;
  state: 'loading' | 'ready' | 'error';
  onReviewed: () => void;
}) {
  const [filter, setFilter] = useState<SubmissionFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Submission | null>(null);

  const submissions = page?.submissions ?? [];
  const missing = page?.missing ?? [];

  const visible = submissions.filter((submission) => {
    switch (filter) {
      case 'submitted':
        return submission.status !== 'draft';
      case 'reviewed':
        return submission.status === 'reviewed';
      case 'unreviewed':
        return submission.status === 'submitted';
      case 'pending':
        // «Pendiente» es quien no ha entregado. Se resuelve más abajo con la
        // lista de ausentes; aquí no hay ninguna entrega que enseñar.
        return false;
      case 'all':
      default:
        return true;
    }
  });

  const showMissing = filter === 'all' || filter === 'pending';

  function toggle(handle: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selected.has(s.student.handle));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar entregas">
        {SUBMISSION_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className="chip"
          >
            {item.label}
          </button>
        ))}
      </div>

      <ExportBar
        assignmentId={assignment.id}
        assignmentType={assignment.type}
        selected={[...selected]}
        total={submissions.length}
      />

      {state === 'loading' && <p className="py-8 text-center text-muted">Cargando entregas…</p>}

      {state === 'ready' && submissions.length === 0 && missing.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="Todavía no hay entregas"
            description="En cuanto alguien entregue, aparecerá aquí con su contenido completo."
          />
        </div>
      )}

      {(visible.length > 0 || (showMissing && missing.length > 0)) && (
        <div className="mt-6">
          {visible.length > 0 && (
            <label className="mb-2 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(visible.map((s) => s.student.handle))
                      : new Set()
                  )
                }
              />
              Seleccionar todo lo visible
            </label>
          )}

          <ul className="divide-y divide-line border-y border-line">
            {visible.map((submission) => (
              <li key={submission.id} className="flex flex-wrap items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(submission.student.handle)}
                  onChange={() => toggle(submission.student.handle)}
                  aria-label={`Seleccionar la entrega de ${submission.student.displayName}`}
                />
                <div className="min-w-40 flex-1">
                  <MemberChip
                    handle={submission.student.handle}
                    displayName={submission.student.displayName}
                    avatarUrl={submission.student.avatarUrl}
                  />
                </div>
                <SubmissionBadge status={submission.status} />
                <button
                  type="button"
                  onClick={() => setOpen(submission)}
                  className="btn btn-secondary btn-sm"
                >
                  Abrir
                </button>
              </li>
            ))}

            {showMissing &&
              missing.map((person) => (
                <li key={person.handle} className="flex flex-wrap items-center gap-3 py-3 opacity-70">
                  <span className="w-[13px]" aria-hidden="true" />
                  <div className="min-w-40 flex-1">
                    <MemberChip
                      handle={person.handle}
                      displayName={person.displayName}
                      avatarUrl={person.avatarUrl}
                    />
                  </div>
                  <SubmissionBadge status={null} />
                  <a
                    href={`/aula/${courseId}/estudiantes/${person.handle}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Ver ficha
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}

      {open && (
        <SubmissionViewer
          submission={open}
          assignment={assignment}
          onClose={() => setOpen(null)}
          onReview={async (status, teacherNote) => {
            await reviewSubmission(open.id, { status, teacherNote });
            setOpen(null);
            onReviewed();
          }}
        />
      )}
    </div>
  );
}

/**
 * Barra de exportación.
 *
 * El botón de AI Worklogs sólo aparece cuando la tarea es de ese tipo (§11):
 * ofrecer «Exportar AI Worklogs» en una tarea de investigación descargaría un
 * archivo vacío y haría dudar de si falló algo.
 */
function ExportBar({
  assignmentId,
  assignmentType,
  selected,
  total,
}: {
  assignmentId: string;
  assignmentType: Assignment['type'];
  selected: string[];
  total: number;
}) {
  const [preview, setPreview] = useState<{ text: string; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    format: 'json' | 'csv' | 'md',
    scope: 'all' | 'worklogs' = 'all'
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setPreview(await fetchExport(assignmentId, { format, scope, handles: selected }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo exportar.');
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel =
    selected.length > 0 ? `${selected.length} seleccionados` : `todas (${total})`;

  return (
    <section aria-labelledby="exportar" className="panel mt-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="exportar" className="font-display text-h3">
            Exportar resultados
          </h2>
          <p className="mt-1 text-sm text-muted">
            Se exportan {scopeLabel}. El Markdown está pensado para pegarlo en ChatGPT, Claude o
            Gemini y pedirles el análisis.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('md')}
            className="btn btn-primary btn-sm"
          >
            Markdown para IA
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('json')}
            className="btn btn-secondary btn-sm"
          >
            JSON
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('csv')}
            className="btn btn-secondary btn-sm"
          >
            CSV
          </button>
          {assignmentType === 'ai_worklog' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('md', 'worklogs')}
              className="btn btn-secondary btn-sm"
            >
              AI Worklogs
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-sm text-subtle">{preview.filename}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(preview.text)}
                className="btn btn-secondary btn-sm"
              >
                Copiar todo
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadText(preview.text, preview.filename, 'text/plain;charset=utf-8')
                }
                className="btn btn-secondary btn-sm"
              >
                Descargar
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="btn btn-ghost btn-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={preview.text}
            rows={16}
            onFocus={(event) => event.currentTarget.select()}
            className="field mt-2 font-mono text-sm"
          />
        </div>
      )}
    </section>
  );
}
