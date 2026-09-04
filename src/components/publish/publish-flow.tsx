'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { CopyField } from '@/components/ui/copy-field';
import { UploadDropzone } from './upload-dropzone';
import { VisibilitySelector } from './visibility-selector';
import { ALL_CATEGORIES, LIMITS, PROJECT_TYPES } from '@/lib/constants';
import { formatBytes, type StagingResult } from '@/lib/files';
import { buildPreviewDocument, type PreviewResult } from '@/lib/preview';
import { publishProject, type PublishProgress } from '@/lib/publish-client';
import { projectMetadataSchema } from '@/lib/schemas';
import { slugify } from '@/lib/slug';
import type { Course, ProjectType, Visibility } from '@/lib/types';
import { liveProjectUrl, projectPath, projectUrl } from '@/lib/urls';

const STEPS = [
  { id: 1, label: 'Archivos' },
  { id: 2, label: 'Información' },
  { id: 3, label: 'Vista previa' },
  { id: 4, label: 'Visibilidad' },
] as const;

type FieldErrors = Partial<Record<'title' | 'description', string>>;

export function PublishFlow({
  projectType,
  courses,
}: {
  projectType: ProjectType;
  courses: readonly Course[];
}) {
  const { status, user } = useAuth();
  const [step, setStep] = useState(1);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Paso 1
  const [staging, setStaging] = useState<StagingResult | null>(null);

  // Paso 2
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [courseId, setCourseId] = useState<string>('');
  const [group, setGroup] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Paso 3
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Paso 4-5
  const [visibility, setVisibility] = useState<Visibility>('published');
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [result, setResult] = useState<{ handle: string; slug: string } | null>(null);

  const typeInfo = PROJECT_TYPES.find((option) => option.value === projectType);
  const files = staging?.files ?? [];
  const blocking = staging?.issues.filter((issue) => issue.path === '') ?? [];
  const canContinueFiles = files.length > 0 && Boolean(staging?.entryFile) && blocking.length === 0;

  const slug = useMemo(() => slugify(title) || 'proyecto', [title]);

  // Al cambiar de paso, el foco va al encabezado: sin esto, quien navega con
  // teclado o lector de pantalla se queda al principio de la página.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 3 || !staging?.entryFile || preview) return;
    let active = true;
    void buildPreviewDocument(staging.files, staging.entryFile).then((built) => {
      if (active) setPreview(built);
    });
    return () => {
      active = false;
    };
  }, [step, staging, preview]);

  function validateMetadata(): boolean {
    const parsed = projectMetadataSchema.safeParse({
      title,
      description,
      courseId: courseId || null,
      group: group || null,
      tags,
      brief: {},
    });

    if (parsed.success) {
      setErrors({});
      return true;
    }

    const next: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'title' || field === 'description') next[field] = issue.message;
    }
    setErrors(next);
    return false;
  }

  async function publish(): Promise<void> {
    if (!user || !staging?.entryFile) return;
    setPublishError(null);
    try {
      const published = await publishProject(
        user,
        {
          metadata: {
            title,
            description,
            courseId: courseId || null,
            group: group || null,
            tags,
            brief: {},
          },
          slug,
          projectType,
          visibility,
          files: staging.files,
          entryFile: staging.entryFile,
          cover,
        },
        setProgress
      );
      setResult({ handle: published.handle, slug: published.slug });
      setStep(5);
    } catch (caught) {
      setProgress(null);
      // El motivo real importa: «revisa tu conexión» manda a buscar donde no
      // está cuando lo que falla es un permiso, una sesión caducada o el CORS
      // del bucket. Los mensajes de la API ya vienen redactados para leerse.
      const reason = caught instanceof Error ? caught.message : '';
      setPublishError(
        reason
          ? `${reason} Tus archivos siguen aquí: puedes intentarlo otra vez.`
          : 'No se pudo publicar. Revisa tu conexión e inténtalo otra vez; tus archivos siguen aquí.'
      );
    }
  }

  // ---------------------------------------------------------------- sesión
  if (status === 'loading') {
    return <p className="py-16 text-center text-muted">Cargando…</p>;
  }

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h2">Necesitas una cuenta para publicar</h1>
        <p className="mt-3 text-muted">
          Explorar proyectos es libre. Para tener tu propio enlace hace falta identificarte, y
          toma menos de un minuto.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/publish/new?type=${projectType}`)}`}
          className="btn btn-primary btn-lg mt-6 w-full"
        >
          Iniciar sesión
        </Link>
        <Link href="/explore" className="btn btn-ghost mt-2 w-full">
          Volver a la galería
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------- éxito
  if (step === 5 && result) {
    const url = projectUrl(result.handle, result.slug);
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-3xl" aria-hidden="true">
          🎉
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-h1">
          {visibility === 'draft' ? 'Guardamos tu borrador' : 'Tu proyecto está publicado'}
        </h1>
        <p className="mt-3 text-muted">
          {visibility === 'published' &&
            'Ya aparece en la galería y cualquiera puede abrirlo con este enlace.'}
          {visibility === 'unlisted' &&
            'No aparece en la galería. Sólo quien reciba este enlace podrá verlo.'}
          {visibility === 'draft' &&
            'Nadie más puede verlo todavía. Publícalo cuando quieras desde tus proyectos.'}
        </p>

        <div className="mt-7">
          <CopyField value={url} label="Enlace público de tu proyecto" />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={projectPath(result.handle, result.slug)} className="btn btn-primary">
            Ver la ficha del proyecto
          </Link>
          <a
            href={liveProjectUrl(result.handle, result.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Abrir el proyecto ↗
          </a>
        </div>

        <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
          ¿Te equivocaste en algo? Puedes cambiar la información, reemplazar los archivos o
          borrarlo desde{' '}
          <Link href="/dashboard" className="text-accent underline underline-offset-2">
            tus proyectos
          </Link>
          . El enlace no cambia.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- pasos
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Pasos para publicar" className="mb-9">
        <ol className="flex flex-wrap gap-x-2 gap-y-2">
          {STEPS.map((item) => {
            const state = item.id === step ? 'current' : item.id < step ? 'done' : 'todo';
            return (
              <li key={item.id} className="flex items-center gap-2">
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={`inline-flex min-h-8 items-center gap-2 rounded-sm px-2.5 text-sm ${
                    state === 'current'
                      ? 'bg-accent-soft font-medium text-accent'
                      : state === 'done'
                        ? 'text-muted'
                        : 'text-subtle'
                  }`}
                >
                  <span className="meta tabular-nums">{String(item.id).padStart(2, '0')}</span>
                  {item.label}
                  {state === 'done' && <span className="sr-only">(completado)</span>}
                </span>
                {item.id < STEPS.length && (
                  <span className="text-subtle" aria-hidden="true">
                    ·
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---------------- Paso 1 · Archivos ---------------- */}
      {step === 1 && (
        <section aria-labelledby="paso-1">
          <h1 id="paso-1" ref={headingRef} tabIndex={-1} className="font-display text-h1">
            Sube tus archivos
          </h1>
          <p className="mt-2 text-muted">{typeInfo?.helper}</p>

          <div className="mt-7">
            <UploadDropzone projectType={projectType} onStaged={setStaging} />
          </div>

          {staging && (
            <div className="mt-6" aria-live="polite">
              {staging.issues.length > 0 && (
                <div
                  role="alert"
                  className="rounded-sm border border-danger/40 bg-danger-soft p-4"
                >
                  <h2 className="font-medium">Hay que arreglar esto antes de seguir</h2>
                  <ul className="mt-2 space-y-1 text-sm">
                    {staging.issues.slice(0, 8).map((issue, index) => (
                      <li key={`${issue.path}-${index}`}>
                        {issue.path && <span className="font-mono">{issue.path}: </span>}
                        {issue.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {files.length > 0 && (
                <div className="panel mt-4 p-4">
                  <p className="flex flex-wrap items-baseline gap-x-3">
                    <strong className="font-medium">
                      {files.length} {files.length === 1 ? 'archivo listo' : 'archivos listos'}
                    </strong>
                    <span className="text-sm text-muted">
                      {formatBytes(staging.totalBytes)} en total
                    </span>
                  </p>
                  {staging.entryFile && (
                    <p className="mt-1 text-sm text-muted">
                      Se abrirá <span className="font-mono">{staging.entryFile}</span>.
                    </p>
                  )}

                  <details className="mt-3">
                    <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm text-muted hover:text-fg">
                      Ver la lista de archivos
                    </summary>
                    <ul className="mt-2 max-h-56 overflow-auto font-mono text-label text-muted">
                      {files.map((file) => (
                        <li key={file.path} className="flex justify-between gap-4 py-0.5">
                          <span className="truncate">{file.path}</span>
                          <span className="shrink-0 text-subtle">{formatBytes(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          )}

          <StepNav
            onNext={() => setStep(2)}
            nextDisabled={!canContinueFiles}
            nextLabel="Continuar"
            backHref="/publish"
            backLabel="Cambiar tipo de proyecto"
          />
        </section>
      )}

      {/* ---------------- Paso 2 · Información ---------------- */}
      {step === 2 && (
        <section aria-labelledby="paso-2">
          <h1 id="paso-2" ref={headingRef} tabIndex={-1} className="font-display text-h1">
            Cuéntanos de qué va
          </h1>
          <p className="mt-2 text-muted">
            Esto es lo que verá quien llegue a tu proyecto. Puedes cambiarlo después.
          </p>

          <div className="mt-7 space-y-6">
            <div>
              <label htmlFor="title" className="label">
                Título
              </label>
              <input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={LIMITS.titleMax}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'title-error' : 'title-hint'}
                className="field"
              />
              {errors.title ? (
                <p id="title-error" role="alert" className="hint text-danger">
                  {errors.title}
                </p>
              ) : (
                <p id="title-hint" className="hint">
                  Tu dirección será{' '}
                  <span className="font-mono text-fg">
                    uinexus.mx/@{user?.handle || 'tunombre'}/{slug}
                  </span>
                </p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="label">
                Descripción
              </label>
              <textarea
                id="description"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={LIMITS.descriptionMax}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? 'description-error' : 'description-hint'}
                className="field"
              />
              {errors.description ? (
                <p id="description-error" role="alert" className="hint text-danger">
                  {errors.description}
                </p>
              ) : (
                <p id="description-hint" className="hint">
                  Una o dos frases: qué resuelve y para quién.{' '}
                  <span className="tabular-nums">
                    {description.length}/{LIMITS.descriptionMax}
                  </span>
                </p>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="course" className="label">
                  Curso <span className="font-normal text-subtle">(opcional)</span>
                </label>
                <select
                  id="course"
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
                <label htmlFor="group" className="label">
                  Grupo <span className="font-normal text-subtle">(opcional)</span>
                </label>
                <input
                  id="group"
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  maxLength={24}
                  className="field"
                />
              </div>
            </div>

            <fieldset>
              <legend className="label">
                Etiquetas{' '}
                <span className="font-normal text-subtle">
                  (hasta {LIMITS.maxTags}, ayudan a que te encuentren)
                </span>
              </legend>
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
                            checked
                              ? current.filter((tag) => tag !== category)
                              : [...current, category]
                          )
                        }
                      />
                      {category}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor="cover" className="label">
                Portada <span className="font-normal text-subtle">(opcional)</span>
              </label>
              <input
                id="cover"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setCover(event.target.files?.[0] ?? null)}
                className="field h-auto py-2"
              />
              <p className="hint">
                Una captura de tu proyecto. Si no subes ninguna, generamos una portada con la
                retícula de UINexus. Máximo {formatBytes(LIMITS.maxCoverBytes)}.
              </p>
            </div>
          </div>

          <StepNav
            onBack={() => setStep(1)}
            onNext={() => {
              if (validateMetadata()) setStep(3);
            }}
            nextLabel="Ver la vista previa"
          />
        </section>
      )}

      {/* ---------------- Paso 3 · Vista previa ---------------- */}
      {step === 3 && (
        <section aria-labelledby="paso-3">
          <h1 id="paso-3" ref={headingRef} tabIndex={-1} className="font-display text-h1">
            Todo parece correcto
          </h1>
          <p className="mt-2 text-muted">
            Encontramos <span className="font-mono">{staging?.entryFile}</span> y {files.length}{' '}
            {files.length === 1 ? 'archivo' : 'archivos'} válidos. Así se ve tu proyecto:
          </p>

          <div className="mt-6 overflow-hidden rounded-md border border-line">
            <div className="border-b border-line bg-surface px-3 py-2">
              <p className="meta">Vista previa del borrador</p>
            </div>
            {preview ? (
              <iframe
                title="Vista previa de tu proyecto"
                srcDoc={preview.html}
                // sandbox vacío: origen opaco y sin scripts. Ver lib/preview.ts.
                sandbox=""
                className="h-[26rem] w-full border-0 bg-white"
              />
            ) : (
              <div className="grid h-[26rem] place-items-center bg-sunken">
                <p className="text-muted">Preparando la vista previa…</p>
              </div>
            )}
          </div>

          {preview && preview.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {preview.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}

          <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Continuar" />
        </section>
      )}

      {/* ---------------- Paso 4 · Visibilidad ---------------- */}
      {step === 4 && (
        <section aria-labelledby="paso-4">
          <h1 id="paso-4" ref={headingRef} tabIndex={-1} className="font-display text-h1">
            ¿Cómo quieres compartirlo?
          </h1>
          <p className="mt-2 text-muted">Puedes cambiarlo cuando quieras, sin perder el enlace.</p>

          <div className="mt-7">
            <VisibilitySelector value={visibility} onChange={setVisibility} />
          </div>

          {progress && (
            <div className="panel mt-6 p-4" role="status" aria-live="polite">
              <p className="font-medium">
                {progress.phase === 'creando' && 'Preparando tu proyecto…'}
                {progress.phase === 'subiendo' &&
                  `Subiendo archivos… ${progress.uploaded} de ${progress.total}`}
                {progress.phase === 'portada' && 'Subiendo la portada…'}
                {progress.phase === 'publicando' && 'Publicando…'}
                {progress.phase === 'listo' && 'Listo.'}
              </p>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.uploaded}
                aria-label="Progreso de la subida"
              >
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{
                    width: `${Math.round((progress.uploaded / Math.max(1, progress.total)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {publishError && (
            <p role="alert" className="mt-6 rounded-sm border border-danger/40 bg-danger-soft p-4">
              {publishError}
            </p>
          )}

          <StepNav
            onBack={() => setStep(3)}
            onNext={() => void publish()}
            nextLabel={visibility === 'draft' ? 'Guardar borrador' : 'Publicar proyecto'}
            nextDisabled={Boolean(progress) && progress?.phase !== 'listo'}
            primary
          />
        </section>
      )}
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled = false,
  backHref,
  backLabel = 'Atrás',
  primary = false,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  backHref?: string;
  backLabel?: string;
  primary?: boolean;
}) {
  return (
    <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-line pt-6">
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className={`btn ${primary ? 'btn-primary btn-lg' : 'btn-primary'}`}
      >
        {nextLabel}
      </button>

      {onBack && (
        <button type="button" onClick={onBack} className="btn btn-ghost">
          ← {backLabel}
        </button>
      )}
      {backHref && (
        <Link href={backHref} className="btn btn-ghost">
          ← {backLabel}
        </Link>
      )}
    </div>
  );
}
