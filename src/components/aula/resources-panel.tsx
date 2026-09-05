'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import type { promptTemplateInputSchema } from '@/lib/academic-schemas';
import { AI_PROVIDERS } from '@/lib/constants';
import {
  createPrompt,
  deletePrompt,
  deleteSkill,
  updatePrompt,
  useApi,
  type CourseLibrary,
} from '@/lib/aula-client';
import type { AIProvider, PromptTemplate, SkillResource } from '@/lib/types';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Notice } from './aula-ui';
import { CopyButton } from './copy-button';
import {
  ModerationActions,
  ResourceAttribution,
  ResourceStatusBadge,
} from './resource-card';
import { CourseResourceEditor, GeneralResourceCard } from './general-resources';

/**
 * La biblioteca de IA de una materia (§18, §19, §29).
 *
 * Dos tipos de recurso bajo la misma pestaña porque responden a la misma
 * pregunta del alumnado —«¿con qué me ayudo?»— y separarlos en dos sitios
 * obligaría a recordar en cuál estaba cada cosa.
 *
 * El botón de la Skill dice **Ver instalación** y no «Instalar», y no es
 * cosmética: UINexus no instala nada, no ejecuta nada y no descarga nada. Un
 * botón que dijera «Instalar» prometería algo que la plataforma no hace, y en
 * el peor caso haría creer que un comando ya se ejecutó.
 */
export function ResourcesPanel({ courseId }: { courseId: string }) {
  const { data, state, reload } = useApi<CourseLibrary>(`/api/courses/${courseId}/library`);
  const [tab, setTab] = useState<'prompts' | 'skills' | 'resources'>('prompts');
  const [editing, setEditing] = useState<PromptTemplate | 'new' | null>(null);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTeacher = data?.viewerRole === 'teacher';

  async function removePrompt(promptId: string): Promise<void> {
    setError(null);
    try {
      await deletePrompt(promptId);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    }
  }

  async function removeSkill(skillId: string): Promise<void> {
    setError(null);
    try {
      await deleteSkill(skillId);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    }
  }

  if (state === 'loading') return <p className="py-10 text-center text-muted">Cargando…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Tipo de recurso" className="flex gap-1">
          {[
            { value: 'prompts' as const, label: `Prompts (${data?.prompts.length ?? 0})` },
            { value: 'skills' as const, label: `Skills (${data?.skills.length ?? 0})` },
            {
              value: 'resources' as const,
              label: `Herramientas y guías (${data?.resources.length ?? 0})`,
            },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className="chip"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/*
          Crear ya NO es sólo del profesorado (§7). El alumnado propone y el
          botón lo dice: «Proponer» frente a «Nuevo». Quien lo pulsa sabe dónde
          va a acabar lo que escriba.
        */}
        <div className="flex flex-wrap gap-2">
          {tab === 'prompts' && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="btn btn-primary btn-sm"
            >
              {isTeacher ? '+ Nuevo prompt' : '+ Proponer un prompt'}
            </button>
          )}
          {tab === 'skills' && (
            <Link
              href={`/aula/${courseId}/recursos/skills/nueva`}
              className="btn btn-primary btn-sm"
            >
              {isTeacher ? '+ Nueva Skill' : '+ Proponer una Skill'}
            </Link>
          )}
          {tab === 'resources' && (
            <button
              type="button"
              onClick={() => setProposing(true)}
              className="btn btn-primary btn-sm"
            >
              {isTeacher ? '+ Nueva herramienta o guía' : '+ Proponer un recurso'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {isTeacher && (data?.pendingReview ?? 0) > 0 && (
        <div className="mt-4">
          <Notice>
            {data?.pendingReview} {data?.pendingReview === 1 ? 'recurso' : 'recursos'} de
            estudiantes esperando tu revisión.
          </Notice>
        </div>
      )}

      {proposing && (
        <div className="mt-6">
          <CourseResourceEditor
            courseId={courseId}
            isTeacher={Boolean(isTeacher)}
            onDone={() => {
              setProposing(false);
              reload();
            }}
            onCancel={() => setProposing(false)}
          />
        </div>
      )}

      {editing && (
        <div className="mt-6">
          <PromptEditor
            courseId={courseId}
            template={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <div className="mt-6">
        {tab === 'prompts' && (
          <>
            {data?.prompts.length === 0 ? (
              <EmptyState
                title="Todavía no hay prompts"
                description={
                  isTeacher
                    ? 'Guarda aquí los prompts que quieres que el grupo use como punto de partida.'
                    : 'Cuando tu docente publique prompts, aparecerán aquí.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {data?.prompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    isTeacher={Boolean(isTeacher)}
                    onEdit={() => setEditing(prompt)}
                    onDelete={() => void removePrompt(prompt.id)}
                    onModerated={reload}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'resources' && (
          <>
            {data?.resources.length === 0 ? (
              <EmptyState
                title="Todavía no hay herramientas ni guías"
                description={
                  isTeacher
                    ? 'Registra las herramientas que usa la clase: Perplexity, NotebookLM, Napkin… También sirve para guías y enlaces.'
                    : '¿Encontraste una herramienta útil? Propónla y tu docente decidirá si entra en la biblioteca.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {data?.resources.map((resource) => (
                  <GeneralResourceCard
                    key={resource.id}
                    resource={resource}
                    isTeacher={Boolean(isTeacher)}
                    onChanged={reload}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'skills' && (
          <>
            {data?.skills.length === 0 ? (
              <EmptyState
                title="Todavía no hay Skills"
                description={
                  isTeacher
                    ? 'Una Skill es una ficha: qué hace, con qué herramientas funciona y cómo se instala.'
                    : 'Cuando tu docente publique Skills, aparecerán aquí.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {data?.skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    courseId={courseId}
                    isTeacher={Boolean(isTeacher)}
                    onDelete={() => void removeSkill(skill.id)}
                    onChanged={reload}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  isTeacher,
  onEdit,
  onDelete,
  onModerated,
}: {
  prompt: PromptTemplate;
  isTeacher: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onModerated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="meta">Prompt</p>
          <h3 className="mt-1 flex flex-wrap items-center gap-2 font-medium">
            {prompt.title}
            <ResourceStatusBadge status={prompt.status} />
          </h3>
          {prompt.description && (
            <p className="mt-1 text-sm text-muted">{prompt.description}</p>
          )}
          <ResourceAttribution resource={prompt} />
          {(prompt.recommendedProvider || prompt.recommendedModel) && (
            <p className="mt-1 text-label text-subtle">
              {[prompt.recommendedProvider, prompt.recommendedModel]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="btn btn-secondary btn-sm"
          >
            {open ? 'Ocultar' : 'Ver'}
          </button>
          <CopyButton value={prompt.prompt} label="Copiar" />
          {isTeacher && (
            <>
              <button type="button" onClick={onEdit} className="btn btn-ghost btn-sm">
                Editar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn btn-ghost btn-sm"
              >
                Borrar
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <pre className="mt-4 max-h-80 overflow-y-auto rounded-sm border border-line bg-sunken p-3 font-mono text-sm whitespace-pre-wrap">
          {prompt.prompt}
        </pre>
      )}

      {isTeacher && (
        <ModerationActions
          kind="prompt"
          id={prompt.id}
          status={prompt.status}
          featured={prompt.featured}
          onDone={onModerated}
        />
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm">
            Las tareas que lo recomienden dejarán de mostrarlo. ¿Borrar?
          </p>
          <button type="button" onClick={onDelete} className="btn btn-danger btn-sm">
            Sí, borrar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost btn-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

function SkillCard({
  skill,
  courseId,
  isTeacher,
  onDelete,
  onChanged,
}: {
  skill: SkillResource;
  courseId: string;
  isTeacher: boolean;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="meta">Skill</p>
          <h3 className="mt-1 flex flex-wrap items-center gap-2 font-medium">
            {skill.title}
            <ResourceStatusBadge status={skill.status} />
          </h3>
          {skill.description && <p className="mt-1 text-sm text-muted">{skill.description}</p>}
          {skill.compatibleTools.length > 0 && (
            <p className="mt-1 text-label text-subtle">{skill.compatibleTools.join(' · ')}</p>
          )}
          <ResourceAttribution resource={skill} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/aula/${courseId}/recursos/skills/${skill.id}`}
            className="btn btn-secondary btn-sm"
          >
            Ver instalación
          </Link>
          {skill.repositoryUrl && (
            <a
              href={skill.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              Repositorio ↗
            </a>
          )}
          {isTeacher && (
            <>
              <Link
                href={`/aula/${courseId}/recursos/skills/${skill.id}/editar`}
                className="btn btn-ghost btn-sm"
              >
                Editar
              </Link>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn btn-ghost btn-sm"
              >
                Borrar
              </button>
            </>
          )}
        </div>
      </div>

      {isTeacher && (
        <ModerationActions
          kind="skill"
          id={skill.id}
          status={skill.status}
          featured={skill.featured}
          onDone={onChanged}
        />
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm">Las tareas que la recomienden dejarán de mostrarla. ¿Borrar?</p>
          <button type="button" onClick={onDelete} className="btn btn-danger btn-sm">
            Sí, borrar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost btn-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

/** Alta y edición de un prompt (§19). Cabe en línea: son cinco campos. */
export function PromptEditor({
  courseId,
  template,
  onDone,
  onCancel,
  onSubmit,
  submitLabel = 'Guardar',
}: {
  courseId: string;
  template: PromptTemplate | null;
  onDone: () => void;
  onCancel: () => void;
  onSubmit?: (body: z.input<typeof promptTemplateInputSchema>) => Promise<void>;
  submitLabel?: string;
}) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [prompt, setPrompt] = useState(template?.prompt ?? '');
  const [provider, setProvider] = useState<AIProvider | ''>(
    template?.recommendedProvider ?? ''
  );
  const [model, setModel] = useState(template?.recommendedModel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        description,
        prompt,
        recommendedProvider: provider || null,
        recommendedModel: model || null,
      };
      if (onSubmit) await onSubmit(body);
      else if (template) await updatePrompt(template.id, body);
      else await createPrompt(courseId, body);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <h3 className="font-display text-h3">{template ? 'Editar prompt' : 'Nuevo prompt'}</h3>

      <Field label="Título">
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Evaluación heurística"
          className="field"
        />
      </Field>

      <Field label="Descripción" hint="Para qué sirve y cuándo usarlo.">
        <textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Para analizar una interfaz según las heurísticas de Nielsen."
          className="field"
        />
      </Field>

      <Field label="Prompt">
        <textarea
          required
          rows={8}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Actúa como especialista en UX…"
          className="field font-mono text-sm"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Proveedor recomendado" hint="Opcional.">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as AIProvider | '')}
            className="field"
          >
            <option value="">Cualquiera</option>
            {AI_PROVIDERS.map((option) => (
              <option key={option} value={option}>
                {option === 'Other' ? 'Otra' : option}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Modelo recomendado" hint="Opcional.">
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Claude Opus 4.5"
            className="field"
          />
        </Field>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="submit"
          disabled={busy || title.trim().length < 3 || !prompt.trim()}
          className="btn btn-primary"
        >
          {busy ? 'Guardando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  );
}
