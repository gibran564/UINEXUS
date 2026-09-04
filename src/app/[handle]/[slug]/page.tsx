import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectShell } from '@/components/project/project-shell';
import { getProjectByPath } from '@/lib/data/repository';
import { parseHandleParam } from '@/lib/slug';
import { liveProjectUrl, profileUrl, publicProjectUrl } from '@/lib/urls';

// La visibilidad puede cambiar en cualquier momento. Un proyecto privatizado
// no debe conservar un shell público en el caché de Next.
export const revalidate = 0;

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
  if (!found) return { title: 'Proyecto no encontrado', robots: { index: false } };

  const { handle, project } = found;
  const canonical = publicProjectUrl(project);
  const isUnlisted = project.status === 'unlisted';

  return {
    title: project.title,
    description: project.description,
    authors: [{ name: project.author.displayName, url: profileUrl(handle) }],
    alternates: { canonical },
    robots: isUnlisted ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'article',
      url: canonical,
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
      images: project.cover ? [project.cover.url] : undefined,
    },
  };
}

export default async function ProjectPage({ params }: PageProps) {
  const found = await load(params);
  if (!found) notFound();

  const { handle, project } = found;

  return (
    <ProjectShell
      title={project.title}
      handle={handle}
      publicUrl={publicProjectUrl(project)}
      originUrl={liveProjectUrl(handle, project.slug)}
    />
  );
}
