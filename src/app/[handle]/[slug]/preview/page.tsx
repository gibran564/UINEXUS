import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectPreview } from '@/components/project/project-preview';
import { LogoMark } from '@/components/ui/logo';
import { getProjectByPath } from '@/lib/data/repository';
import { parseHandleParam } from '@/lib/slug';
import { liveProjectUrl, publicProjectPath } from '@/lib/urls';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Vista previa',
  robots: { index: false, follow: false },
};

/**
 * Visor a pantalla casi completa, con simulación de dispositivos.
 *
 * Existe porque en una materia de UX/UI la pregunta más frecuente al revisar
 * un trabajo es "¿y cómo se ve en el celular?". La barra superior deja claro
 * dónde termina UINexus y dónde empieza el proyecto.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle: raw, slug } = await params;
  const handle = parseHandleParam(raw);
  if (!handle) notFound();

  const project = await getProjectByPath(handle, slug);
  if (!project) notFound();

  const live = liveProjectUrl(handle, slug);

  return (
    <div className="container-page py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <Link
          href={publicProjectPath({ handle, slug })}
          className="inline-flex items-center gap-2 text-sm no-underline hover:underline"
        >
          <LogoMark size={17} />
          <span>← Volver a la ficha</span>
        </Link>

        <div className="flex items-center gap-3">
          <p className="meta">Vista previa</p>
          <a href={live} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            Abrir en pestaña nueva ↗
          </a>
        </div>
      </div>

      <h1 className="mt-5 font-display text-h2">{project.title}</h1>
      <p className="mt-1 text-muted">{project.author.displayName}</p>

      <div className="mt-6">
        <ProjectPreview
          src={live}
          title={project.title}
          seed={project.slug}
          coverUrl={project.cover?.url ?? null}
          showDeviceSwitcher
          aspect="aspect-4/3 sm:aspect-16/10"
        />
      </div>
    </div>
  );
}
