'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { UploadDropzone } from '@/components/publish/upload-dropzone';
import { VisibilitySelector } from '@/components/publish/visibility-selector';
import { StatusBadge } from '@/components/ui/status-badge';
import { ALL_CATEGORIES, LIMITS } from '@/lib/constants';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { formatBytes, type StagingResult } from '@/lib/files';
import { replaceProjectFiles, type PublishProgress } from '@/lib/publish-client';
import { projectMetadataSchema } from '@/lib/schemas';
import type { Course, ProjectRecord, Visibility } from '@/lib/types';
import { useMyProjects } from '@/lib/use-my-projects';
import { projectPath } from '@/lib/urls';

/**
 * Editar un proyecto ya publicado.
 *
 * Regla que gobierna esta pantalla: la URL nunca cambia. Se puede reescribir
 * el título, la descripción, las etiquetas y hasta los archivos completos, y
 * el enlace que alguien pegó en su entrega sigue funcionando. Por eso el slug
 * se muestra pero no se edita, y por eso reemplazar archivos avisa con todas
 * las letras de que sustituye lo que hay publicado.
 */
export function EditProject({ projectId, courses }: { projectId: string; courses: readonly Course[] }) {
  const { status, user } = useAuth();
  const { projects, state, reload } = useMyProjects(user);
  const project = projects.find((item) => item.id === projectId);

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h2">Entra para editar tu proyecto</h1>
        <Link href={`/login?next=/dashboard/${projectId}/edit`} className="btn btn-primary mt-6 w-full">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (state === 'loading' || status === 'loading') {
    return <p className="py-16 text-center text-muted">Cargando…</p>;
  }

  if (!project) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h2">No encontramos ese proyecto</h1>
        <p className="mt-2 text-muted">Puede que lo hayas eliminado o que el enlace esté mal.</p>
        <Link href="/dashboard" className="btn btn-secondary mt-6">
          Volver a tus proyectos
        </Link>
      </div>
    );
  }

  return <EditForm project={project} courses={courses} onSaved={reload} />;
}

function EditForm({
  project,
  courses,
  onSaved,
}: {
  project: ProjectRecord;
  courses: readonly Course[];
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [courseId, setCourseId] = useState(project.courseId ?? '');
  const [group, setGroup] = useState(project.group ?? '');
  const [tags, setTags] = useState<string[]>(project.tags);
  const [visibility, setVisibility] = useState<Visibility>(
    project.status === 'archived' ? 'draft' : (project.status as Visibility)
  );
  const [brief, setBrief] = useState(project.brief);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [staging, setStaging] = useState<StagingResult | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [version, setVersion] = useState(project.version);
  const [replaceState, setReplaceState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [saveState]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = projectMetadataSchema.safeParse({
      title,
      description,
      courseId: courseId || null,
      group: group || null,
      tags,
      brief,
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setSaveState('saving');

    if (!isFirebaseConfigured) {
      setTimeout(() => setSaveState('saved'), 500);
      return;
    }

    try {
      const { updateProjectMetadata } = await import('@/lib/projects-client');
      await updateProjectMetadata({ projectId: project.id, metadata: parsed.data, status: visibility });
      setSaveState('saved');
      onSaved();
    } catch {
      setSaveState('error');
    }
  }

  async function replaceFiles(): Promise<void> {
    if (!user || !staging?.entryFile) return;
    setReplaceState('working');
    try {
      const next = await replaceProjectFiles(
        user,
        project.id,
        version,
        staging.files,
        staging.entryFile,
        setProgress
      );
      setVersion(next);
      setReplaceState('done');
      onSaved();
    } catch {
      setReplaceState('error');
    }
  }

  const canReplace =
    Boolean(staging?.entryFile) &&
    (staging?.files.length ?? 0) > 0 &&
    (staging?.issues.filter((issue) => issue.path === '').length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Ruta">
        <Link href="/dashboard" className="text-sm text-muted no-underline hover:text-fg">
          ← Tus proyectos
        </Link>
      </nav>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0">
          <h1 className="font-display text-h1">{project.title}</h1>
          <p className="mt-2 font-mono text-sm break-all text-muted">
            uinexus.mx{projectPath(project.ownerHandle, project.slug)}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </header>

      {/* ---------------- Información ---------------- */}
      <form onSubmit={(event) => void save(event)} noValidate className="py-8">
        <h2 className="section-mark font-display text-h2">Información</h2>

        <div className="mt-6 space-y-6">
          <div>
            <label htmlFor="edit-title" className="label">
              Título
            </label>
            <input
              id="edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={LIMITS.titleMax}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'edit-title-error' : 'edit-title-hint'}
              className="field"
            />
            {errors.title ? (
              <p id="edit-title-error" role="alert" className="hint text-danger">
                {errors.title}
              </p>
            ) : (
              <p id="edit-title-hint" className="hint">
                Cambiar el título no cambia la dirección del proyecto.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="edit-description" className="label">
              Descripción
            </label>
            <textarea
              id="edit-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={LIMITS.descriptionMax}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'edit-description-error' : undefined}
              className="field"
            />
            {errors.description && (
              <p id="edit-description-error" role="alert" className="hint text-danger">
                {errors.description}
              </p>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-course" className="label">
                Curso
              </label>
              <select
                id="edit-course"
                value={courseId}
                onChange={(event) => setCourseId(event.target.value)}
                className="field"
              >
                <option value="">Sin curso</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name} · {course.term}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-group" className="label">
                Grupo
              </label>
              <input
                id="edit-group"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                maxLength={24}
                className="field"
              />
            </div>
          </div>

          <fieldset>
            <legend className="label">Etiquetas</legend>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((category) => {
                const checked = tags.includes(category);
                const full = tags.length >= LIMITS.maxTags && !checked;
                return (
                  <label
                    key={category}
                    className={`chip ${checked ? 'chip-selected' : ''} ${
                      full ? 'chip-disabled' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      disabled={full}
                      onChange={() =>
                        setTags((current) =>
                          checked ? current.filter((tag) => tag !== category) : [...current, category]
                        )
                      }
                    />
                    {category}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* La ficha académica: opcional y plegada. Es lo que convierte el
              hosting en un caso de estudio, pero no puede estorbar a quien
              sólo quiere subir su página. */}
          <details className="panel p-4">
            <summary className="cursor-pointer font-medium">
              Ficha académica <span className="font-normal text-muted">(opcional)</span>
            </summary>
            <p className="mt-2 text-sm text-muted">
              Si respondes esto, tu proyecto deja de ser sólo una página y pasa a ser un caso de
              estudio que se puede leer.
            </p>
            <div className="mt-5 space-y-5">
              {(
                [
                  ['problem', 'El problema', '¿Qué estaba mal antes de tu proyecto?'],
                  ['goal', 'Objetivo', '¿Qué querías conseguir?'],
                  ['process', 'Proceso', '¿Cómo lo hiciste? ¿A quién observaste o entrevistaste?'],
                  ['tools', 'Herramientas', 'Figma, HTML/CSS, papel y lápiz…'],
                  ['reflection', 'Qué aprendí', 'Lo que harías distinto la próxima vez.'],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key}>
                  <label htmlFor={`brief-${key}`} className="label">
                    {label}
                  </label>
                  <textarea
                    id={`brief-${key}`}
                    rows={key === 'tools' ? 2 : 3}
                    value={brief[key] ?? ''}
                    onChange={(event) => setBrief({ ...brief, [key]: event.target.value })}
                    className="field"
                  />
                  <p className="hint">{hint}</p>
                </div>
              ))}
            </div>
          </details>

          <div className="border-t border-line pt-6">
            <VisibilitySelector value={visibility} onChange={setVisibility} name="edit-visibility" />
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {saveState === 'saved' && <span className="text-success">Cambios guardados.</span>}
            {saveState === 'error' && (
              <span className="text-danger">No se pudo guardar. Inténtalo otra vez.</span>
            )}
          </p>
        </div>
      </form>

      {/* ---------------- Archivos ---------------- */}
      <section id="archivos" className="border-t border-line py-8">
        <h2 className="section-mark font-display text-h2">Actualizar archivos</h2>
        <p className="mt-2 max-w-prose text-muted">
          Sube la versión nueva completa. Reemplaza lo que está publicado ahora mismo y{' '}
          <strong className="font-medium text-fg">la dirección no cambia</strong>: quien tenga el
          enlace verá la versión nueva al recargar.
        </p>
        <p className="mt-2 text-sm text-subtle">
          Versión publicada actualmente: v{version} · {project.fileCount} archivos ·{' '}
          {formatBytes(project.totalBytes)}
        </p>

        <div className="mt-6">
          <UploadDropzone
            projectType={project.projectType}
            onStaged={setStaging}
            busy={replaceState === 'working'}
          />
        </div>

        {staging && staging.issues.length > 0 && (
          <div role="alert" className="mt-4 rounded-sm border border-danger/40 bg-danger-soft p-4">
            <ul className="space-y-1 text-sm">
              {staging.issues.slice(0, 8).map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {issue.path && <span className="font-mono">{issue.path}: </span>}
                  {issue.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {canReplace && (
          <div className="panel mt-4 border-warning/40 bg-warning-soft p-4">
            <h3 className="font-medium">Estás reemplazando la versión publicada</h3>
            <p className="mt-1 text-sm">
              {staging?.files.length} archivos ({formatBytes(staging?.totalBytes ?? 0)}) pasarán a
              ser la versión v{version + 1}. La anterior deja de mostrarse.
            </p>
            <button
              type="button"
              onClick={() => void replaceFiles()}
              disabled={replaceState === 'working'}
              className="btn btn-primary btn-sm mt-4"
            >
              {replaceState === 'working' ? 'Subiendo…' : `Publicar la versión v${version + 1}`}
            </button>
          </div>
        )}

        {progress && replaceState === 'working' && (
          <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">
            Subiendo {progress.uploaded} de {progress.total} archivos…
          </p>
        )}
        {replaceState === 'done' && (
          <p role="status" className="mt-3 text-sm text-success">
            Listo. La versión v{version} ya es la publicada.
          </p>
        )}
        {replaceState === 'error' && (
          <p role="alert" className="mt-3 text-sm text-danger">
            Algo falló al subir. La versión anterior sigue publicada, así que nadie ve un sitio
            roto. Inténtalo otra vez.
          </p>
        )}
      </section>
    </div>
  );
}
