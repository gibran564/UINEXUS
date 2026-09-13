'use client';

import { useId, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { apiFetch } from '@/lib/api-client';
import { publishProject, replaceProjectFiles, type PublishProgress } from '@/lib/publish-client';
import { slugify } from '@/lib/slug';
import type { Project, Visibility } from '@/lib/types';
import { liveProjectUrl } from '@/lib/urls';
import {
  planWorkspacePublish,
  publishAndLink,
  resolvePublishTarget,
  retryPublishLink,
  type OwnedProjectsLookup,
  type PublishedLocation,
  type WorkspacePublishOutcome,
} from '@/lib/workspace-publish';

/**
 * Publicar un NexCode web con el publisher de siempre.
 *
 * Este componente no sube archivos: llama a `publishProject` o a
 * `replaceProjectFiles`, que ya existían para el flujo de `/publish` y para la
 * edición desde el panel. Lo que añade es decidir cuál de las dos, recoger la
 * metadata mínima que el esquema exige, y no mentir sobre el resultado.
 */

type Phase = 'idle' | 'validating' | 'uploading' | 'publishing' | 'published' | 'error';

function phaseFor(progress: PublishProgress): Phase {
  if (progress.phase === 'creando' || progress.phase === 'subiendo') return 'uploading';
  if (progress.phase === 'portada' || progress.phase === 'publicando') return 'publishing';
  return 'published';
}

/** Los proyectos de quien pregunta, distinguiendo «no hay» de «no se pudo saber». */
async function lookupOwnProjects(): Promise<OwnedProjectsLookup> {
  try {
    const response = await apiFetch<{ projects: Project[] }>('/api/projects');
    return { ok: true, projects: response.projects };
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message
          ? caught.message
          : 'No pudimos comprobar tus proyectos publicados.',
    };
  }
}

export function WorkspacePublish({
  files,
  entryFile,
  title,
  publishedProjectId,
  onLinked,
}: {
  files: Record<string, string>;
  entryFile: string;
  title: string;
  publishedProjectId?: string;
  /** Persiste el vínculo. Se le deja fallar: quien llama decide qué hacer. */
  onLinked: (projectId: string) => Promise<void>;
}) {
  const { user } = useAuth();
  const titleId = useId();
  const descriptionId = useId();
  const visibilityId = useId();

  const [open, setOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState(title);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('published');

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [location, setLocation] = useState<PublishedLocation | null>(null);
  /** La publicación existe pero el NexCode no pudo recordar cuál es. */
  const [orphan, setOrphan] = useState<PublishedLocation | null>(null);

  const planned = planWorkspacePublish(files, entryFile);
  const busy = phase === 'uploading' || phase === 'publishing' || phase === 'validating';
  const slug = slugify(projectTitle) || 'proyecto';

  function applyOutcome(outcome: WorkspacePublishOutcome): void {
    if (outcome.kind === 'published') {
      setLocation(outcome.location);
      setOrphan(null);
      setMessage(null);
      setPhase('published');
      return;
    }
    if (outcome.kind === 'link-failed') {
      // NO es `error`: el sitio está publicado y su URL sirve. Lo único que
      // falta es que el NexCode recuerde a cuál apunta.
      setLocation(outcome.location);
      setOrphan(outcome.location);
      setMessage(outcome.message);
      setPhase('published');
      return;
    }
    setMessage(outcome.message);
    setPhase('error');
  }

  async function publish(): Promise<void> {
    if (!user || !planned.ok) return;

    setPhase('validating');
    setMessage(null);

    const target = resolvePublishTarget(publishedProjectId, await lookupOwnProjects());

    if (target.kind === 'unresolved') {
      /**
       * No se supo si el vínculo sigue vivo, así que no se publica.
       *
       * Crear ante la duda serían copias del mismo sitio, una por reintento,
       * cada una con su URL y ninguna pedida.
       */
      setMessage(`${target.message} No publicamos para no duplicar tu proyecto.`);
      setPhase('error');
      return;
    }

    const plan = planned.plan;

    const outcome = await publishAndLink({
      alreadyLinkedTo: publishedProjectId,
      link: onLinked,
      publish: async () => {
        if (target.kind === 'update') {
          await replaceProjectFiles(
            user,
            target.projectId,
            target.version,
            plan.files,
            plan.entryFile,
            (next) => {
              setProgress(next);
              setPhase(phaseFor(next));
            },
            visibility
          );
          return { projectId: target.projectId, handle: target.handle, slug: target.slug };
        }

        const created = await publishProject(
          user,
          {
            metadata: {
              title: projectTitle.trim(),
              description: description.trim(),
              courseId: null,
              courseName: null,
              group: null,
              tags: [],
              brief: {},
            },
            slug,
            projectType: plan.projectType,
            visibility,
            files: plan.files,
            entryFile: plan.entryFile,
            cover: null,
          },
          (next) => {
            setProgress(next);
            setPhase(phaseFor(next));
          }
        );
        return { projectId: created.projectId, handle: created.handle, slug: created.slug };
      },
    });

    applyOutcome(outcome);
  }

  async function retryLink(): Promise<void> {
    if (!orphan) return;
    setPhase('publishing');
    applyOutcome(await retryPublishLink(orphan, onLinked));
  }

  const isUpdate = Boolean(publishedProjectId);

  return (
    <div className="border-b border-line px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          // Con un vínculo pendiente el botón abre el aviso, no un formulario:
          // ver la nota de la publicación huérfana más abajo.
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {orphan ? 'Vínculo pendiente' : isUpdate ? 'Publicar nueva versión' : 'Publicar'}
        </button>

        {location && phase === 'published' && (
          <a
            href={liveProjectUrl(location.handle, location.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline"
          >
            Ver publicado
          </a>
        )}
      </div>

      {open && (
        <div className="mt-3">
          {!planned.ok ? (
            <div role="alert">
              <p className="text-sm font-medium">Todavía no se puede publicar</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {planned.blockers.map((blocker) => (
                  <li key={`${blocker.path}:${blocker.reason}`}>
                    · {blocker.path ? <code className="font-mono">{blocker.path}</code> : null}{' '}
                    {blocker.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : orphan ? (
            /**
             * Con una publicación huérfana pendiente NO se ofrece publicar.
             *
             * El proyecto ya existe ahí fuera; lo único que falta es que este
             * NexCode recuerde cuál es. Dejar el formulario a mano sería dejar
             * a un clic de distancia la creación de una segunda publicación con
             * otra URL, que es exactamente el destrozo que hay que evitar.
             */
            null
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void publish();
              }}
              className="space-y-3"
            >
              {!isUpdate && (
                <>
                  <div>
                    <label htmlFor={titleId} className="label">
                      Título
                    </label>
                    <input
                      id={titleId}
                      className="field"
                      value={projectTitle}
                      maxLength={90}
                      onChange={(event) => setProjectTitle(event.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor={descriptionId} className="label">
                      Descripción
                    </label>
                    <textarea
                      id={descriptionId}
                      className="field"
                      rows={2}
                      value={description}
                      maxLength={600}
                      placeholder="Una frase que explique el proyecto."
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor={visibilityId} className="label">
                      Visibilidad
                    </label>
                    <select
                      id={visibilityId}
                      className="field"
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value as Visibility)}
                    >
                      <option value="published">Pública</option>
                      <option value="unlisted">Con enlace</option>
                      <option value="draft">Borrador</option>
                    </select>
                  </div>
                </>
              )}

              {isUpdate && (
                <p className="text-sm text-muted">
                  Se publicará una versión nueva de tu proyecto. La dirección no cambia.
                </p>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy || (!isUpdate && description.trim().length < 10)}
              >
                {busy ? 'Publicando…' : isUpdate ? 'Publicar versión' : 'Publicar proyecto'}
              </button>
            </form>
          )}

          {busy && progress && (
            <p className="mt-2 text-sm text-muted" role="status">
              {phase === 'uploading'
                ? `Subiendo ${progress.uploaded} de ${progress.total} archivos…`
                : 'Publicando…'}
            </p>
          )}

          {phase === 'error' && message && (
            <div className="mt-2" role="alert">
              <p className="text-sm text-danger">{message}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={() => void publish()}
              >
                Reintentar
              </button>
            </div>
          )}

          {orphan && (
            <div className="mt-2" role="alert">
              <p className="text-sm">
                Tu proyecto <strong>sí se publicó</strong>, pero este NexCode no pudo guardar el
                vínculo. No vuelvas a publicar: crearías una copia aparte.
              </p>
              {message && <p className="mt-1 text-sm text-muted">{message}</p>}
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={() => void retryLink()}
              >
                Reintentar sólo el vínculo
              </button>
            </div>
          )}

          {phase === 'published' && !orphan && location && (
            <p className="mt-2 text-sm" role="status">
              Publicado en{' '}
              <a
                href={liveProjectUrl(location.handle, location.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {liveProjectUrl(location.handle, location.slug)}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
