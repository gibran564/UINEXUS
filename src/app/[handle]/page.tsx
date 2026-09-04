import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectGrid } from '@/components/project/project-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { getUserByHandle, listProjectsByHandle } from '@/lib/data/repository';
import { parseHandleParam } from '@/lib/slug';
import { profileUrl } from '@/lib/urls';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle: raw } = await params;
  const handle = parseHandleParam(raw);
  if (!handle) return { title: 'Perfil no encontrado' };

  const user = await getUserByHandle(handle);
  if (!user) return { title: 'Perfil no encontrado' };

  const description = user.bio ?? `Proyectos publicados por ${user.displayName} en UINexus.`;

  return {
    title: user.displayName,
    description,
    alternates: { canonical: profileUrl(handle) },
    openGraph: {
      type: 'profile',
      title: `${user.displayName} · UINexus`,
      description,
      url: profileUrl(handle),
    },
  };
}

export default async function ProfilePage({ params }: PageProps) {
  const { handle: raw } = await params;
  const handle = parseHandleParam(raw);
  if (!handle) notFound();

  const user = await getUserByHandle(handle);
  if (!user) notFound();

  const projects = await listProjectsByHandle(handle);

  return (
    <div className="container-page py-10">
      {/* Perfil deliberadamente sobrio: sin seguidores, sin "likes", sin
          rankings. Lo que importa es el trabajo, no las métricas sociales. */}
      <header className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-start sm:gap-7">
        <UserAvatar name={user.displayName} src={user.avatarUrl} size={84} />

        <div className="min-w-0">
          <h1 className="font-display text-h1">{user.displayName}</h1>
          <p className="mt-1 font-mono text-sm text-muted">@{user.handle}</p>

          {user.bio && <p className="prose-block mt-4 text-lead">{user.bio}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            {user.program && <span className="text-muted">{user.program}</span>}
            <span className="text-muted tabular-nums">
              {projects.length} {projects.length === 1 ? 'proyecto publicado' : 'proyectos publicados'}
            </span>
            {user.role === 'teacher' && (
              <span className="rounded-xs border border-line-strong px-2 py-0.5 text-muted">
                Docente
              </span>
            )}
          </div>
        </div>
      </header>

      <section aria-labelledby="proyectos" className="pt-9">
        <h2 id="proyectos" className="sr-only">
          Proyectos de {user.displayName}
        </h2>

        {projects.length > 0 ? (
          <ProjectGrid projects={projects} label={`Proyectos de ${user.displayName}`} />
        ) : (
          <EmptyState
            title="Este estudiante aún no ha publicado proyectos"
            description="Cuando publique el primero aparecerá en esta página, con su enlace para compartir."
            action={{ href: '/explore', label: 'Explorar otros proyectos' }}
          />
        )}
      </section>
    </div>
  );
}
