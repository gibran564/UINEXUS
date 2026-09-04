'use client';

import { useState } from 'react';
import { useApi, type CollaborativeView as ViewData } from '@/lib/aula-client';
import type { ContributionState } from '@/lib/types';
import { MemberChip, Notice } from './aula-ui';

/**
 * El documento conjunto (§11).
 *
 * Esto es lo que sustituye al Google Doc compartido, y por eso se parece más a
 * un documento que a un panel: encabezado por concepto, la aportación debajo, y
 * quién la escribió al lado. Sin tablas, sin filas plegables, sin nada que haya
 * que abrir para leer. La docente tiene que poder proyectarlo en clase y que se
 * lea.
 *
 * Lo que NO es: una copia guardada. Se compone en el servidor a partir de la
 * tarea y de las entregas cada vez que se pide
 * (`lib/collaborative.ts`). No hay ningún «documento final» que pueda quedar
 * desincronizado de lo que la gente entregó.
 */

const STATE_LABEL: Record<ContributionState, string> = {
  missing: 'Sin iniciar',
  draft: 'Borrador',
  submitted: 'Entregado',
  reviewed: 'Revisado',
  needs_changes: 'Requiere cambios',
};

const STATE_MARK: Record<ContributionState, string> = {
  missing: '○',
  draft: '◷',
  submitted: '✓',
  reviewed: '✓',
  needs_changes: '!',
};

const STATE_TONE: Record<ContributionState, string> = {
  missing: 'text-subtle',
  draft: 'text-warning',
  submitted: 'text-success',
  reviewed: 'text-success',
  needs_changes: 'text-danger',
};

type Filter = 'all' | 'done' | 'drafting' | 'missing';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'done', label: 'Completados' },
  { value: 'drafting', label: 'En borrador' },
  { value: 'missing', label: 'Sin iniciar' },
];

export function CollaborativeDocument({ assignmentId }: { assignmentId: string }) {
  const { data, state, error } = useApi<ViewData>(
    `/api/assignments/${assignmentId}/collaborative`
  );
  const [filter, setFilter] = useState<Filter>('all');

  if (state === 'loading') return <p className="py-10 text-center text-muted">Componiendo…</p>;
  if (state === 'error' || !data) {
    return <Notice tone="error">{error ?? 'No pudimos abrir la vista conjunta.'}</Notice>;
  }

  const isTeacher = data.viewerRole === 'teacher';

  const sections = data.sections.filter((section) => {
    switch (filter) {
      case 'done':
        return section.state === 'submitted' || section.state === 'reviewed';
      case 'drafting':
        return section.state === 'draft' || section.state === 'needs_changes';
      case 'missing':
        return section.state === 'missing';
      case 'all':
      default:
        return true;
    }
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted tabular-nums">
          {data.progress.total} conceptos · {data.progress.done} completados ·{' '}
          {data.progress.drafting} en borrador · {data.progress.missing} sin iniciar
        </p>

        {isTeacher && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar apartados">
            {FILTERS.map((item) => (
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
        )}
      </div>

      {!isTeacher && data.contributionVisibility !== 'group' && (
        <div className="mt-4">
          <Notice>
            {data.contributionVisibility === 'own'
              ? 'En esta actividad cada quien ve sólo su propia aportación.'
              : 'Verás las aportaciones del resto en cuanto entregues la tuya.'}
          </Notice>
        </div>
      )}

      {sections.length === 0 ? (
        <p className="mt-10 text-center text-muted">Nada que mostrar con ese filtro.</p>
      ) : (
        <div className="mt-8 divide-y divide-line border-t border-line">
          {sections.map((section) => (
            <section key={section.groupId} className="py-7">
              <header className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="font-display text-h3">{section.title}</h3>
                <p className={`text-sm ${STATE_TONE[section.state]}`}>
                  <span aria-hidden="true">{STATE_MARK[section.state]}</span>{' '}
                  {STATE_LABEL[section.state]}
                </p>
              </header>

              {section.responsibles.length > 0 && (
                <p className="mt-1 text-sm text-subtle">
                  Responsable{section.responsibles.length > 1 ? 's' : ''}:{' '}
                  {section.responsibles.map((person) => person.displayName).join(', ')}
                </p>
              )}

              {section.contributions.length === 0 ? (
                <p className="mt-4 text-muted">
                  {section.responsibles.length > 0
                    ? 'Todavía no hay aportación.'
                    : 'Apartado abierto: cualquiera del grupo puede responderlo.'}
                </p>
              ) : (
                <div className="mt-5 space-y-6">
                  {section.contributions.map((contribution) => (
                    <article key={contribution.author.handle}>
                      <div className="flex flex-wrap items-center gap-3">
                        <MemberChip
                          handle={contribution.author.handle}
                          displayName={contribution.author.displayName}
                          avatarUrl={contribution.author.avatarUrl}
                        />
                        <span className={`text-label ${STATE_TONE[contribution.state]}`}>
                          {STATE_LABEL[contribution.state]}
                        </span>
                      </div>

                      <dl className="mt-3 space-y-3 border-l-2 border-line pl-4">
                        {contribution.answers.map((answer) => (
                          <div key={answer.questionId}>
                            <dt className="meta">{answer.prompt}</dt>
                            <dd className="mt-1 max-w-prose whitespace-pre-line text-muted">
                              {answer.value || (
                                <span className="text-subtle">(sin respuesta)</span>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
