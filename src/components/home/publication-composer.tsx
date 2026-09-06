'use client';
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import { apiFetch } from '@/lib/api-client';
import { Notice } from '@/components/aula/aula-ui';
import { PromptEditor } from '@/components/aula/resources-panel';
import { CourseResourceEditor } from '@/components/aula/general-resources';
import { SkillEditor } from '@/components/aula/skill-editor';
import { PROJECT_TYPES } from '@/lib/constants';
import type { PublicationDTO, PublicationOption } from '@/lib/publications';
import { PublicationDetail } from './publication-detail';

type ContentKind = 'announcement' | 'resource' | 'prompt' | 'skill' | 'project';
type ShareOption = PublicationOption;

export const PUBLICATION_LABELS: Record<ContentKind, string> = {
  announcement: 'Anuncio', resource: 'Recurso', prompt: 'Prompt', skill: 'Skill', project: 'Página / proyecto',
};

/** Audiencia propia del compositor: nunca depende del filtro del muro. */
export function PublicationComposer({ courses, onPublished }: {
  courses: HomePayload['courses']; onPublished: () => void;
}) {
  const teaching = courses.filter((course) => course.role === 'teacher');
  const studying = courses.filter((course) => course.role === 'student');
  const [role, setRole] = useState<'teacher' | 'student'>(teaching.length ? 'teacher' : 'student');
  const available = role === 'teacher' ? teaching : studying;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'share'>('new');
  const [kind, setKind] = useState<ContentKind>('announcement');
  const [audienceMode, setAudienceMode] = useState<'selectedGroups' | 'allTeacherGroups'>('selectedGroups');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [options, setOptions] = useState<ShareOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [reference, setReference] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const groupIds = selected.filter((id) => available.some((course) => course.id === id));
  const audienceValid = (role === 'teacher' && audienceMode === 'allTeacherGroups') || groupIds.length > 0;
  const courseId = (audienceMode === 'allTeacherGroups' ? available[0]?.id : groupIds[0]) ?? '';
  const submitLabel = role === 'teacher' ? 'Publicar' : 'Enviar para aprobación';
  // La audiencia elegida aquí viaja al flujo de publicación para no volver a
  // preguntarla al final. Es una sugerencia: el servidor la vuelve a validar.
  const shareIds = audienceMode === 'allTeacherGroups' && role === 'teacher'
    ? available.map((course) => course.id)
    : groupIds;

  useEffect(() => {
    if (!open || mode !== 'share') return;
    let active = true;
    setLoadingOptions(true);
    setOptionsError(null);
    apiFetch<{ options: ShareOption[] }>('/api/publications?options=1')
      .then((result) => { if (active) setOptions(result.options); })
      .catch((caught: unknown) => { if (active) setOptionsError(caught instanceof Error ? caught.message : 'No se pudo cargar el contenido.'); })
      .finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [open, mode, optionsAttempt]);

  if (!courses.length) return null;

  function cancel() { if (!busy) { setOpen(false); setError(null); } }
  function completed() {
    setOpen(false); setTitle(''); setContent(''); setReference('');
    setDone(role === 'teacher' ? 'Publicación compartida con la audiencia elegida.' : 'Publicación enviada. Tu docente la revisará antes de mostrarla al grupo.');
    onPublished();
  }
  async function publish(payload: Record<string, unknown>) {
    if (!audienceValid) throw new Error('Selecciona la audiencia de tu publicación.');
    setBusy(true); setError(null);
    try {
      await apiFetch('/api/publications', {
        method: 'POST',
        body: { ...payload, allTeacherGroups: audienceMode === 'allTeacherGroups' && role === 'teacher',
          audienceCourseIds: audienceMode === 'allTeacherGroups' && role === 'teacher' ? [] : groupIds },
      });
    } finally { setBusy(false); }
  }
  async function submitSimple(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (mode === 'share') {
        const item = options.find((option) => `${option.kind}:${option.id}` === reference);
        if (!item) throw new Error('Selecciona el contenido que deseas compartir.');
        await publish({ reference: { kind: item.kind, id: item.id } });
      } else await publish({ announcement: { title, content } });
      completed();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo publicar.'); }
  }

  return <section className="mt-10" aria-label="Crear publicación">
    <div className="panel min-w-0 p-4">
      {!open ? <button type="button" className="field min-h-11 w-full text-left text-muted" onClick={() => { setOpen(true); setDone(null); }}>
        Comparte algo con tu grupo…
      </button> : <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-h3">Nueva publicación</h2>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancelar</button>
        </div>
        <fieldset disabled={busy} className="space-y-4">
          {teaching.length > 0 && studying.length > 0 && <label className="block"><span className="label">Publicar como</span>
            <select className="field" value={role} onChange={(event) => { setRole(event.target.value as typeof role); setSelected([]); setAudienceMode('selectedGroups'); }}>
              <option value="teacher">Docente</option><option value="student">Estudiante</option>
            </select></label>}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Acción de publicación">
            <button type="button" aria-pressed={mode === 'new'} className={`btn btn-sm ${mode === 'new' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMode('new'); setKind('announcement'); }}>Crear nuevo</button>
            <button type="button" aria-pressed={mode === 'share'} className={`btn btn-sm ${mode === 'share' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMode('share'); setReference(''); }}>Compartir existente</button>
          </div>
          <fieldset className="rounded-sm border border-line p-3">
            <legend className="px-1 font-medium">Audiencia de esta publicación</legend>
            {role === 'teacher' && <div className="mb-2 flex flex-wrap gap-3">
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name="publication-audience" checked={audienceMode === 'selectedGroups'} onChange={() => setAudienceMode('selectedGroups')} />Uno o varios grupos</label>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name="publication-audience" checked={audienceMode === 'allTeacherGroups'} onChange={() => setAudienceMode('allTeacherGroups')} />Todos mis grupos</label>
            </div>}
            {audienceMode === 'selectedGroups' && available.map((course) => <label key={course.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type={role === 'teacher' ? 'checkbox' : 'radio'} name="publication-group" checked={groupIds.includes(course.id)} onChange={() => setSelected(role === 'student' ? [course.id] : groupIds.includes(course.id) ? groupIds.filter((id) => id !== course.id) : [...groupIds, course.id])} />
              {course.name}
            </label>)}
            {!audienceValid && <p className="mt-1 text-sm text-muted">Selecciona un grupo para publicar.</p>}
            {role === 'student' && <p className="mt-2 text-sm text-muted">Requiere aprobación de tu docente antes de aparecer en el muro.</p>}
          </fieldset>
          {mode === 'new' && <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de contenido">
            {(['announcement', 'resource', 'prompt', 'skill', 'project'] as const).map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`btn btn-sm ${kind === value ? 'btn-primary' : 'btn-secondary'}`}>{PUBLICATION_LABELS[value]}</button>)}
          </div>}
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
        {(mode === 'share' || kind === 'announcement') ? <form onSubmit={submitSimple} className="space-y-3">
          <fieldset disabled={busy} className="space-y-3">
            {mode === 'new' ? <>
              <label className="block"><span className="label">Título del anuncio</span><input className="field" required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="block"><span className="label">Contenido</span><textarea className="field" rows={5} required value={content} onChange={(event) => setContent(event.target.value)} /></label>
            </> : <>
              <label className="block"><span className="label">Buscar contenido existente</span><input className="field" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              {loadingOptions ? <p role="status">Cargando contenido…</p> : optionsError ? <Notice tone="error">{optionsError}<button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => setOptionsAttempt((value) => value + 1)}>Reintentar</button></Notice> : <>
                <label className="block"><span className="label">Página, Prompt, Skill o recurso</span><select className="field" value={reference} onChange={(event) => setReference(event.target.value)} required>
                  <option value="">Selecciona contenido…</option>
                  {options.filter((option) => option.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{PUBLICATION_LABELS[option.kind]} · {option.title}</option>)}
                </select></label>
                {/* Confirmar con la vista, no con el título: dos entregas de la
                    misma práctica se llaman casi igual y la portada las separa. */}
                {(() => { const chosen = options.find((option) => `${option.kind}:${option.id}` === reference);
                  return chosen?.cover ? <img src={chosen.cover.url} alt="" loading="lazy" decoding="async"
                    className="aspect-16/10 w-full max-w-sm rounded-sm border border-line object-cover" /> : null; })()}
                {!options.length && <p className="text-sm text-muted">Todavía no tienes contenido disponible para compartir.</p>}
              </>}
            </>}
            <button className="btn btn-primary min-h-11" type="submit" disabled={!audienceValid || (mode === 'share' && (!reference || loadingOptions || !!optionsError))}>{busy ? 'Publicando…' : submitLabel}</button>
          </fieldset>
        </form> : audienceValid && <div className="min-w-0" key={kind}>
          {kind === 'prompt' && <PromptEditor courseId={courseId} template={null} onSubmit={(data) => publish({ newContent: { kind: 'prompt', data } })} submitLabel={submitLabel} onDone={completed} onCancel={cancel} />}
          {kind === 'resource' && <CourseResourceEditor courseId={courseId} isTeacher={role === 'teacher'} onSubmit={(data) => publish({ newContent: { kind: 'resource', data } })} submitLabel={submitLabel} onDone={completed} onCancel={cancel} />}
          {kind === 'skill' && <SkillEditor courseId={courseId} embedded onSubmit={(data) => publish({ newContent: { kind: 'skill', data } })} submitLabel={submitLabel} onSaved={completed} onCancel={cancel} />}
          {/* Una página no se escribe en un formulario: son archivos que hay
              que validar, previsualizar y alojar. El muro lleva al flujo real
              con la audiencia ya elegida y la publicación se cierra allí. */}
          {kind === 'project' && <div className="space-y-3">
            <p className="text-sm text-muted">Sube tus archivos y, al terminar, se comparte {role === 'teacher' ? 'en el muro de' : 'para aprobación con'} {shareIds.length === 1 ? 'el grupo elegido' : 'los grupos elegidos'}.</p>
            <ul className="space-y-2">{PROJECT_TYPES.map((option) => <li key={option.value}>
              <Link href={`/publish/new?type=${option.value}&compartir=${encodeURIComponent(shareIds.join(','))}`} className="panel flex min-h-11 items-center gap-3 p-3 no-underline transition-colors hover:border-accent">
                <span className="min-w-0"><span className="block font-medium">{option.label}</span><span className="block text-sm text-muted">{option.helper}</span></span>
                <span aria-hidden="true" className="ml-auto text-subtle">→</span>
              </Link>
            </li>)}</ul>
            {role === 'student' && <p className="text-sm text-muted">Tu docente recibirá el aviso y decidirá si aparece en el muro.</p>}
            <p className="text-sm text-muted">¿Ya la tienes subida? Usa <button type="button" className="underline underline-offset-2" onClick={() => { setMode('share'); setReference(''); }}>Compartir existente</button>.</p>
          </div>}
        </div>}
      </div>}
      {done && <p role="status" className="mt-3 text-sm text-muted">{done}</p>}
    </div>
  </section>;
}

export function PublicationModeration({ publications, onChanged, courses = [] }: {
  publications: PublicationDTO[]; onChanged: () => void; courses?: HomePayload['courses'];
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const pending = publications.filter((publication) => publication.canModerate && publication.status === 'proposed');
  if (!pending.length) return null;
  return <section className="mt-8" aria-labelledby="publication-moderation">
    <h2 id="publication-moderation" className="section-mark font-display text-h2">Publicaciones pendientes de aprobación</h2>
    <p className="mt-2 text-sm text-muted">{pending.length} por revisar</p>
    <ul className="mt-4 space-y-3">{pending.map((publication) => <li key={publication.id} className="panel p-4">
      {/* Aprobar una página sin verla es firmar a ciegas: la portada va aquí. */}
      {publication.cover && <img src={publication.cover.url} alt="" loading="lazy" decoding="async"
        className="mb-3 aspect-16/10 w-full rounded-sm border border-line object-cover" />}
      <p className="text-sm text-muted">{publication.author.displayName} · {PUBLICATION_LABELS[publication.kind]}</p>
      <p className="mt-1 font-medium">{publication.title}</p>
      <p className="mt-1 text-sm text-muted">{publication.audienceCourseIds.map((id) => courses.find((course) => course.id === id)?.name ?? id).join(' · ')}</p>
      <p className="mt-1 text-label text-subtle">{new Date(publication.createdAt).toLocaleString('es-MX')}</p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setReviewId(publication.id)}>Revisar contenido</button>
    </li>)}</ul>
    {reviewId && <PublicationDetail id={reviewId} courses={courses} onClose={() => setReviewId(null)} onChanged={onChanged} />}
  </section>;
}
