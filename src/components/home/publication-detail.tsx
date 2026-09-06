'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import type { PublicationDetail as PublicationDetailData } from '@/lib/publications';
import { apiFetch } from '@/lib/api-client';
import { useApi } from '@/lib/aula-client';
import { safeMarkdownUrl } from '@/lib/ai-worklog';
import { Notice } from '@/components/aula/aula-ui';
import { MarkdownContent } from '@/components/aula/markdown-content';

/** Un diálogo nativo conserva el Inicio detrás y devuelve el foco al cerrarse. */
export function PublicationDetail({ id, onClose, onChanged, courses = [] }: {
  id: string; onClose: () => void; onChanged?: () => void; courses?: HomePayload['courses'];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, state, error, reload } = useApi<PublicationDetailData>(`/api/publications/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  async function moderate(status: 'approved' | 'rejected') {
    setBusy(true); setModerationError(null);
    try {
      await apiFetch(`/api/publications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
      onChanged?.(); onClose();
    } catch (caught) { setModerationError(caught instanceof Error ? caught.message : 'No se pudo revisar la publicación.'); }
    finally { setBusy(false); }
  }
  const publication = data?.publication;
  return <dialog ref={dialog} aria-labelledby="publication-detail-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-sm border border-line bg-surface p-5 text-fg backdrop:bg-black/50">
    <div className="flex items-start justify-between gap-4">
      <h2 id="publication-detail-title" className="min-w-0 break-words font-display text-h2">{publication?.title ?? 'Publicación'}</h2>
      <button type="button" autoFocus className="btn btn-secondary btn-sm shrink-0" disabled={busy} onClick={onClose}>Cerrar</button>
    </div>
    {state === 'loading' && <p role="status" className="mt-5">Abriendo contenido…</p>}
    {state === 'error' && <div className="mt-5"><Notice tone="error">{error ?? 'No se pudo abrir la publicación.'}</Notice><button type="button" className="btn btn-secondary mt-3" onClick={reload}>Reintentar</button></div>}
    {data && publication && <>
      <p className="mt-3 text-sm text-muted">{publication.author.displayName}{publication.author.handle ? ` · @${publication.author.handle}` : ''}</p>
      <p className="mt-1 text-sm text-muted">{publication.kind === 'project' ? 'Página / proyecto' : publication.kind === 'announcement' ? 'Anuncio' : publication.kind === 'resource' ? 'Recurso' : publication.kind === 'prompt' ? 'Prompt' : 'Skill'} · {new Date(publication.createdAt).toLocaleString('es-MX')}</p>
      <p className="mt-1 text-sm text-muted">Estado: {publication.status === 'proposed' ? 'Pendiente de aprobación' : publication.status === 'approved' ? 'Aprobada' : publication.status === 'rejected' ? 'Rechazada' : publication.status}</p>
      <p className="mt-1 text-sm text-muted">Audiencia: {publication.audienceCourseIds.map((courseId) => courses.find((course) => course.id === courseId)?.name ?? courseId).join(' · ')}</p>
      {publication.approvedBy && <p className="mt-1 text-sm text-muted">Aprobado por {publication.approvedBy.displayName}</p>}
      <div className="mt-6 min-w-0 space-y-5 break-words"><PublicationContent detail={data} /></div>
      {publication.canModerate && publication.status === 'proposed' && <div className="mt-6 border-t border-line pt-4">
        {moderationError && <Notice tone="error">{moderationError}</Notice>}
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className="btn btn-secondary min-h-11" disabled={busy} onClick={() => void moderate('rejected')}>Rechazar</button>
          <button type="button" className="btn btn-primary min-h-11" disabled={busy} onClick={() => void moderate('approved')}>{busy ? 'Guardando…' : 'Aprobar'}</button>
        </div>
      </div>}
    </>}
  </dialog>;
}

function ExternalLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const safe = safeMarkdownUrl(href ?? '');
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm max-w-full whitespace-normal">{children} ↗</a> : null;
}

export function PublicationContent({ detail }: { detail: PublicationDetailData }) {
  const { publication, resource } = detail;
  if (!resource) return <MarkdownContent content={publication.content} format="plain_text" />;
  return <>
    {resource.description && <MarkdownContent content={resource.description} format="plain_text" />}
    {'prompt' in resource && <>
      <MarkdownContent content={resource.prompt} format="plain_text" />
      {(resource.recommendedProvider || resource.recommendedModel) && <p className="text-sm text-muted">Modelo recomendado: {[resource.recommendedProvider, resource.recommendedModel].filter(Boolean).join(' · ')}</p>}
    </>}
    {'content' in resource && <>
      <MarkdownContent content={resource.content} format="plain_text" />
      <ExternalLink href={resource.url}>Abrir recurso</ExternalLink>
      {resource.category && <p className="text-sm text-muted">Categoría: {resource.category}</p>}
      {resource.workflowSteps?.length > 0 && <ol className="space-y-4">{resource.workflowSteps.map((step) => <li key={step.id}>
        <h3 className="font-medium">{step.order + 1}. {step.title}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{step.description}</p>
        <MarkdownContent content={step.instructions} format="plain_text" />
      </li>)}</ol>}
    </>}
    {'installMethods' in resource && <>
      <p className="text-sm text-muted">Herramientas compatibles: {resource.compatibleTools.join(', ') || 'No especificadas'}</p>
      <div className="flex flex-wrap gap-2"><ExternalLink href={resource.repositoryUrl}>Repositorio</ExternalLink><ExternalLink href={resource.homepageUrl}>Página de la Skill</ExternalLink></div>
      {resource.installMethods.map((method) => <section key={method.id} className="space-y-3">
        <h3 className="font-medium">{method.tool} · {method.title}</h3>
        <ol className="list-inside list-decimal space-y-3">{method.steps.map((step, index) => <li key={index}>
          {step.type === 'link' ? <ExternalLink href={step.url}>{step.label}</ExternalLink> : step.type === 'command' ? <pre className="mt-2 whitespace-pre-wrap break-all rounded-sm bg-sunken p-3 font-mono text-sm">{step.content}</pre> : <span className="whitespace-pre-wrap">{step.content}</span>}
        </li>)}</ol>
      </section>)}
      {resource.usageInstructions && <section><h3 className="mb-2 font-medium">Cómo usarla</h3><MarkdownContent content={resource.usageInstructions} format="plain_text" /></section>}
    </>}
    {'brief' in resource && <>
      {/* La portada primero: quien abre una página compartida viene a verla. */}
      {resource.cover && <img src={resource.cover.url} alt={resource.cover.alt}
        className="w-full rounded-sm border border-line object-cover" loading="lazy" decoding="async" />}
      {Object.entries(resource.brief).filter(([, value]) => value).map(([key, value]) => <section key={key}>
        <h3 className="font-medium">{({ problem: 'Problema', goal: 'Objetivo', process: 'Proceso', tools: 'Herramientas', reflection: 'Reflexión' } as Record<string, string>)[key] ?? key}</h3>
        <MarkdownContent content={value ?? ''} format="plain_text" />
      </section>)}
      <a href={publication.detailHref} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Ver página ↗</a>
    </>}
    {'tags' in resource && resource.tags.length > 0 && <p className="text-sm text-muted">{resource.tags.join(' · ')}</p>}
  </>;
}
