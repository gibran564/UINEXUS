import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectCard } from '@/components/project/project-card';
import { ProjectPreview } from '@/components/project/project-preview';
import { ReportProject } from '@/components/project/report-project';
import { ShareButton } from '@/components/ui/share-button';
import { PROJECT_TYPE_LABEL } from '@/lib/constants';
import { getProjectByPath, listProjectsByHandle } from '@/lib/data/repository';
import { parseHandleParam } from '@/lib/slug';
import { exploreHref, liveProjectUrl, profilePath, projectUrl } from '@/lib/urls';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ handle: string; slug: string }>;
}

async function load(params: PageProps['params']) {
  const { handle: raw, slug } = await params;
  const handle = parseHandleParam(raw);
  if (!handle) return null;

  const project = await getProjectByPath(handle, slug);
  return project ? { handle, project } : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await load(params);
  if (!found) return { title: 'Proyecto no encontrado' };

  const { handle, project } = found;
  const url = projectUrl(handle, project.slug);
  const isUnlisted = project.status === 'unlisted';

  return {
    title: project.title,
    description: project.description,
    authors: [{ name: project.author.displayName, url: profilePath(handle) }],
    alternates: { canonical: url },
    // Un proyecto "sólo con enlace" no debe entrar en ningún índice.
    robots: isUnlisted ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'article',
      url,
      title: project.title,
      description: project.description,
      publishedTime: project.publishedAt ?? undefined,
      authors: [project.author.displayName],
      images: project.cover ? [{ url: project.cover.url, alt: project.cover.alt }] : undefined,
    },
    twitter: {
      card: project.cover ? 'summary_large_image' : 'summary',
      title: project.title,
      description: project.description,
    },
  };
}

export default async function ProjectPage({ params }: PageProps) {
  const found = await load(params);
  if (!found) notFound();

  const { handle, project } = found;
  const live = liveProjectUrl(handle, project.slug);
  const share = projectUrl(handle, project.slug);
  const others = (await listProjectsByHandle(handle))
    .filter((item) => item.id !== project.id)
    .slice(0, 3);

  const brief = [
    { key: 'problem', title: 'El problema', value: project.brief.problem },
    { key: 'goal', title: 'Objetivo', value: project.brief.goal },
    { key: 'process', title: 'Proceso', value: project.brief.process },
    { key: 'reflection', title: 'Qué aprendí', value: project.brief.reflection },
  ].filter((section) => Boolean(section.value));

  return (
    <article className="container-page py-8">
      <nav aria-label="Ruta">
        <Link href="/explore" className="text-sm text-muted no-underline hover:text-fg">
          ← Explorar
        </Link>
      </nav>

      {/* ---------- Cabecera ---------- */}
      <header className="mt-5 border-b border-line pb-8">
        {project.status === 'unlisted' && (
          <p className="mb-4 inline-flex items-center gap-2 rounded-sm border border-warning/40 bg-warning-soft px-3 py-1.5 text-sm">
            Este proyecto no aparece en la galería. Sólo lo ve quien tenga el enlace.
          </p>
        )}

        <h1 className="max-w-4xl font-display text-h1">{project.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-lead">
          <Link href={profilePath(handle)} className="font-medium text-fg underline-offset-2 hover:underline">
            {project.author.displayName}
          </Link>
          {project.courseName && (
            <>
              <span className="text-subtle" aria-hidden="true">
                ·
              </span>
              <span className="text-muted">{project.courseName}</span>
            </>
          )}
          {project.term && (
            <>
              <span className="text-subtle" aria-hidden="true">
                ·
              </span>
              <span className="text-muted">{project.term}</span>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={live}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-lg"
          >
            Abrir proyecto
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path
                d="M6 3h7v7M13 3L4.5 11.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">(se abre en una pestaña nueva)</span>
          </a>
          <ShareButton url={share} title={project.title} />
        </div>
      </header>

      {/* ---------- Vista previa ---------- */}
      <section aria-labelledby="vista-previa" className="py-8">
        <h2 id="vista-previa" className="sr-only">
          Vista previa del proyecto
        </h2>
        <ProjectPreview
          src={live}
          title={project.title}
          seed={project.slug}
          coverUrl={project.cover?.url ?? null}
        />
      </section>

      {/* ---------- Contenido ---------- */}
      <div className="grid gap-12 border-t border-line py-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <section aria-labelledby="sobre">
            <h2 id="sobre" className="section-mark font-display text-h2">
              Sobre este proyecto
            </h2>
            <p className="prose-block mt-4 text-lead text-fg">{project.description}</p>
          </section>

          {brief.map((section) => (
            <section key={section.key} aria-labelledby={`brief-${section.key}`} className="mt-9">
              <h2 id={`brief-${section.key}`} className="font-display text-h3">
                {section.title}
              </h2>
              <p className="prose-block mt-2">{section.value}</p>
            </section>
          ))}

          {project.brief.tools && (
            <section aria-labelledby="brief-tools" className="mt-9">
              <h2 id="brief-tools" className="font-display text-h3">
                Herramientas
              </h2>
              <p className="prose-block mt-2">{project.brief.tools}</p>
            </section>
          )}
        </div>

        {/* Metadatos: columna secundaria, tipografía menor, sin competir. */}
        <aside aria-labelledby="ficha" className="lg:border-l lg:border-line lg:pl-8">
          <h2 id="ficha" className="meta">
            Ficha
          </h2>

          <dl className="mt-4 space-y-4 text-sm">
            <Row label="Autoría">
              <Link href={profilePath(handle)} className="text-fg no-underline hover:underline">
                {project.author.displayName}
              </Link>
            </Row>
            {project.courseName && <Row label="Curso">{project.courseName}</Row>}
            {project.group && <Row label="Grupo">{project.group}</Row>}
            {project.term && <Row label="Periodo">{project.term}</Row>}
            <Row label="Tipo">{PROJECT_TYPE_LABEL[project.projectType]}</Row>
            {project.publishedAt && (
              <Row label="Publicado">
                <time dateTime={project.publishedAt}>
                  {new Date(project.publishedAt).toLocaleDateString('es-MX', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
              </Row>
            )}
            {project.version > 1 && <Row label="Versión">{project.version}</Row>}
          </dl>

          {project.tags.length > 0 && (
            <div className="mt-7">
              <h3 className="meta">Etiquetas</h3>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {project.tags.map((tag) => (
                  <li key={tag}>
                    <Link href={exploreHref({ tag })} className="chip">
                      {tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 border-t border-line pt-5">
            <ReportProject projectId={project.id} title={project.title} />
          </div>
        </aside>
      </div>

      {/* ---------- Más del alumno ---------- */}
      {others.length > 0 && (
        <section aria-labelledby="mas" className="border-t border-line pt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="mas" className="section-mark font-display text-h2">
              Más de {project.author.displayName}
            </h2>
            <Link href={profilePath(handle)} className="text-sm text-accent underline underline-offset-2">
              Ver perfil completo
            </Link>
          </div>

          <ul className="mt-7 grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((item) => (
              <li key={item.id}>
                <ProjectCard project={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="mt-1 text-fg">{children}</dd>
    </div>
  );
}
