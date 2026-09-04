'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DELIVERABLE_LABEL } from '@/lib/constants';
import { aiWorklogToMarkdown, normalizeAIResult } from '@/lib/ai-worklog';
import { academicFileUrl, useApi } from '@/lib/aula-client';
import type {
  AIWorklogData,
  ContributionState,
  DeliverableType,
  ExternalLinkData,
  FreeformData,
  MediaData,
  ResearchData,
  ResourceSelectionData,
  StepEvidence,
  WebProjectData,
  WorkflowGroupStep,
  WorkflowGroupView,
} from '@/lib/types';
import { MemberChip, Notice } from './aula-ui';
import { LinkCard } from './link-card';
import { CopyButton } from './copy-button';
import { MarkdownContent } from './markdown-content';

/**
 * Avance por paso, para el profesorado (§34).
 *
 * Es la pantalla que responde «¿por dónde va el grupo?» sin abrir treinta y una
 * entregas. Cada paso muestra su marcador sobre su AUDIENCIA REAL —si el paso 2
 * es sólo de Pedro, dice «1 de 1»— y quién lo tiene hecho.
 *
 * También muestra qué herramienta dijo usar cada persona. Conviene recordar lo
 * que eso es y lo que no: un registro que escribió el estudiante, no una
 * comprobación. UINexus no entra en ChatGPT ni en Perplexity a verificar nada
 * (§48).
 */

interface StepProgress {
  stepId: string;
  title: string;
  actionLabel: string;
  required: boolean;
  toolNames: string[];
  deliverableType: DeliverableType;
  assigned: number;
  done: number;
  people: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    done: boolean;
    toolName: string;
    completedAt: string | null;
  }[];
}

export function WorkflowProgress({
  assignmentId,
  courseId,
}: {
  assignmentId: string;
  courseId: string;
}) {
  const { data, state, error } = useApi<{
    title: string;
    steps: StepProgress[];
    groupView: WorkflowGroupView;
  }>(
    `/api/assignments/${assignmentId}/workflow`
  );
  const [view, setView] = useState<'progress' | 'group'>('progress');

  if (state === 'loading') return <p className="py-10 text-center text-muted">Cargando…</p>;
  if (state === 'error' || !data) {
    return <Notice tone="error">{error ?? 'No pudimos abrir el avance.'}</Notice>;
  }

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist" aria-label="Vista del workflow">
        {([
          ['progress', 'Avance por paso'],
          ['group', 'Resultado del grupo'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm ${
              view === value
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'group' ? (
        <GroupResult assignmentId={assignmentId} steps={data.groupView.steps} />
      ) : (
      <div className="space-y-5">
      {data.steps.map((step, index) => {
        const complete = step.assigned > 0 && step.done === step.assigned;

        return (
          <section key={step.stepId} className="panel p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="meta">
                  Paso {index + 1} · {step.actionLabel}
                  {!step.required && ' · opcional'}
                </p>
                <h3 className="mt-1 font-display text-h3">{step.title}</h3>
                <p className="mt-1 text-label text-subtle">
                  {DELIVERABLE_LABEL[step.deliverableType]}
                  {step.toolNames.length > 0 && ` · ${step.toolNames.join(', ')}`}
                </p>
              </div>

              <p
                className={`text-sm tabular-nums ${complete ? 'text-success' : 'text-muted'}`}
              >
                {step.done} / {step.assigned} completaron
              </p>
            </header>

            {step.people.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {step.people.map((person) => (
                  <li
                    key={person.handle}
                    className="flex flex-wrap items-center gap-3 py-2.5"
                  >
                    <div className="min-w-40 flex-1">
                      <Link
                        href={`/aula/${courseId}/estudiantes/${person.handle}`}
                        className="no-underline"
                      >
                        <MemberChip
                          handle={person.handle}
                          displayName={person.displayName}
                          avatarUrl={person.avatarUrl}
                        />
                      </Link>
                    </div>

                    {person.toolName && (
                      <span className="text-label text-subtle">{person.toolName}</span>
                    )}

                    <span
                      className={`text-sm ${person.done ? 'text-success' : 'text-subtle'}`}
                    >
                      <span aria-hidden="true">{person.done ? '✓' : '○'}</span>{' '}
                      {person.done ? 'Hecho' : 'Pendiente'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      </div>
      )}
    </div>
  );
}

const STATE_LABEL: Record<ContributionState, string> = {
  missing: 'Sin iniciar',
  draft: 'Borrador',
  submitted: 'Entregado',
  reviewed: 'Revisado',
  needs_changes: 'Requiere cambios',
};

const STATE_TONE: Record<ContributionState, string> = {
  missing: 'text-subtle',
  draft: 'text-warning',
  submitted: 'text-success',
  reviewed: 'text-success',
  needs_changes: 'text-danger',
};

function GroupResult({
  assignmentId,
  steps,
}: {
  assignmentId: string;
  steps: WorkflowGroupStep[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Abre un paso para revisar las aportaciones independientes de cada participante.
      </p>

      {steps.map((step, index) => (
        <details key={step.id} className="panel group p-5">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="meta">Paso {index + 1}</p>
                <h3 className="mt-1 font-display text-h3">{step.title}</h3>
                <p className="mt-1 text-label text-subtle">
                  {step.expectedParticipants} participantes · {step.withEvidence} con evidencia
                </p>
              </div>
              <p className={`text-sm ${STATE_TONE[step.state]}`}>{STATE_LABEL[step.state]}</p>
            </div>
          </summary>

          {(step.instructions || step.description) && (
            <p className="mt-4 max-w-prose whitespace-pre-line border-t border-line pt-4 text-sm text-muted">
              {step.instructions || step.description}
            </p>
          )}

          <div className="mt-5 space-y-5 border-t border-line pt-5">
            {step.contributions.map((contribution) => (
              <article key={contribution.author.handle} className="rounded-sm border border-line p-4">
                <header className="flex flex-wrap items-center gap-3">
                  <div className="min-w-48 flex-1">
                    <MemberChip
                      handle={contribution.author.handle}
                      displayName={contribution.author.displayName}
                      avatarUrl={contribution.author.avatarUrl}
                    />
                  </div>
                  {contribution.evidence?.toolName && (
                    <span className="text-label text-subtle">
                      Herramienta: {contribution.evidence.toolName}
                    </span>
                  )}
                  <span className={`text-sm ${STATE_TONE[contribution.state]}`}>
                    {STATE_LABEL[contribution.state]}
                  </span>
                </header>

                {contribution.evidence && contribution.state !== 'missing' ? (
                  <div className="mt-4 border-t border-line pt-4">
                    <EvidenceReader
                      assignmentId={assignmentId}
                      step={step}
                      evidence={contribution.evidence}
                    />
                    <p className="mt-3 text-label text-subtle">
                      {contribution.evidence.completedAt
                        ? `Completado: ${formatDate(contribution.evidence.completedAt)}`
                        : contribution.updatedAt
                          ? `Actualizado: ${formatDate(contribution.updatedAt)}`
                          : ''}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-subtle">Todavía no hay evidencia.</p>
                )}
              </article>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function EvidenceReader({
  assignmentId,
  step,
  evidence,
}: {
  assignmentId: string;
  step: WorkflowGroupStep;
  evidence: StepEvidence;
}) {
  const type = step.deliverables[0]?.type ?? 'none';

  if (type === 'structured') {
    const answers = (evidence.data as ResearchData).answers ?? [];
    const byId = new Map(answers.map((answer) => [answer.questionId, answer.value]));
    return (
      <dl className="space-y-3">
        {(step.deliverables[0]?.questions ?? []).map((question) => (
          <div key={question.id}>
            <dt className="meta">{question.prompt}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-muted">
              {byId.get(question.id) || <span className="text-subtle">(sin respuesta)</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (type === 'ai_worklog') {
    const data = evidence.data as AIWorklogData;
    const result = normalizeAIResult(data);
    const fields = [
      ['Herramienta', data.provider],
      ['Modelo', data.model],
      ['Objetivo', data.objective],
      ['Prompt utilizado', data.prompt],
      ['Qué utilizó', data.whatWasUsed],
      ['Qué modificó', data.whatWasChanged],
      ['Qué descartó', data.whatWasDiscarded],
      ['Análisis', data.studentAnalysis],
    ] as const;
    return (
      <div className="space-y-3">
        {fields.map(([label, value]) =>
          value ? (
            <div key={label}>
              <p className="meta">{label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{value}</p>
            </div>
          ) : null
        )}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="meta">Resultado</p>
            {result.content && <CopyButton value={result.content} label="Copiar resultado" variant="ghost" />}
          </div>
          <div className="mt-1">
            <MarkdownContent content={result.content} format={result.format} />
          </div>
        </div>
        <CopyButton value={aiWorklogToMarkdown(data)} label="Copiar AI Worklog" />
        {data.conversationUrl && <LinkCard url={data.conversationUrl} compact />}
      </div>
    );
  }

  if (type === 'url') {
    const data = evidence.data as ExternalLinkData;
    return data.url ? (
      <LinkCard url={data.url} title={data.title} description={data.description} />
    ) : null;
  }

  if (type === 'project') {
    const data = evidence.data as WebProjectData;
    return (
      <div className="text-sm text-muted">
        {data.projectPath && (
          <Link href={data.projectPath} className="font-medium underline">
            {data.projectTitle || 'Abrir proyecto'}
          </Link>
        )}
        {data.note && <p className="mt-2 whitespace-pre-wrap">{data.note}</p>}
      </div>
    );
  }

  if (type === 'file' || type === 'image' || type === 'video') {
    return <MediaEvidence assignmentId={assignmentId} data={evidence.data as MediaData} />;
  }

  if (type === 'resource_reference') {
    const data = evidence.data as ResourceSelectionData;
    return (
      <div className="text-sm text-muted">
        {data.refs?.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {data.refs.map((ref) => <li key={`${ref.kind}-${ref.id}`}>{ref.kind}: {ref.id}</li>)}
          </ul>
        )}
        {data.note && <p className="mt-2 whitespace-pre-wrap">{data.note}</p>}
      </div>
    );
  }

  const data = evidence.data as FreeformData;
  return (
    <div className="space-y-3 text-sm text-muted">
      {data.text && <p className="whitespace-pre-wrap">{data.text}</p>}
      {(data.links ?? []).map((link) => (
        <LinkCard key={`${link.label}-${link.url}`} url={link.url} title={link.label} compact />
      ))}
      {evidence.note && <p className="whitespace-pre-wrap">{evidence.note}</p>}
    </div>
  );
}

function MediaEvidence({ assignmentId, data }: { assignmentId: string; data: MediaData }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare(): Promise<void> {
    setError(null);
    try {
      const result = await academicFileUrl(assignmentId, data.storageKey);
      setUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo abrir el archivo.');
    }
  }

  return (
    <div className="space-y-2 text-sm text-muted">
      {data.storageKey && !url && (
        <button type="button" onClick={() => void prepare()} className="btn btn-secondary btn-sm">
          Preparar {data.fileName || 'archivo'}
        </button>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
          Abrir {data.fileName || 'archivo'} ↗
        </a>
      )}
      {data.url && <LinkCard url={data.url} title={data.fileName} compact />}
      {data.note && <p className="whitespace-pre-wrap">{data.note}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-MX');
}
