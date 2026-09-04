'use client';

import Link from 'next/link';
import { APP_HOST } from '@/lib/urls';
import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { ProjectRowActions } from './project-row-actions';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useMyProjects } from '@/lib/use-my-projects';
import { formatBytes } from '@/lib/files';
import { PROJECT_TYPE_LABEL } from '@/lib/constants';
import { profilePath } from '@/lib/urls';

type Tab = 'all' | 'published' | 'drafts';

const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'published', label: 'Publicados' },
  { value: 'drafts', label: 'Borradores' },
];

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  }
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short' });
}

/**
 * Panel del estudiante.
 *
 * Una tabla y tres pestañas. Nada de KPIs, gráficas ni "actividad reciente":
 * quien entra aquí viene a hacer una cosa concreta con un proyecto concreto.
 * En móvil la tabla se convierte en tarjetas, no en una tabla comprimida con
 * desplazamiento horizontal.
 */
export function DashboardClient() {
  const { status, user } = useAuth();
  const { projects, state, reload, removeLocal } = useMyProjects(user);
  const [tab, setTab] = useState<Tab>('all');

  if (status === 'loading') {
    return <p className="py-16 text-center text-muted">Cargando tus proyectos…</p>;
  }

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h2 className="font-display text-h2">Entra para ver tus proyectos</h2>
        <p className="mt-3 text-muted">
          Aquí aparecen los proyectos que has publicado y tus borradores.
        </p>
        <Link href="/login?next=/dashboard" className="btn btn-primary btn-lg mt-6 w-full">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  const filtered = projects.filter((project) => {
    if (tab === 'published') return project.status === 'published' || project.status === 'unlisted';
    if (tab === 'drafts') return project.status === 'draft';
    return true;
  });

  const counts = {
    all: projects.length,
    published: projects.filter((p) => p.status === 'published' || p.status === 'unlisted').length,
    drafts: projects.filter((p) => p.status === 'draft').length,
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-h1">Tus proyectos</h1>
          {user?.handle && (
            <p className="mt-1 text-sm text-muted">
              Tu perfil público:{' '}
              <Link href={profilePath(user.handle)} className="font-mono text-accent underline underline-offset-2">
                {APP_HOST}/@{user.handle}
              </Link>
            </p>
          )}
        </div>
        <Link href="/publish" className="btn btn-primary">
          + Nuevo proyecto
        </Link>
      </div>

      <div className="mt-7 border-b border-line">
        <div role="tablist" aria-label="Filtrar tus proyectos" className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm ${
                tab === item.value
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {item.label}
              <span className="text-subtle tabular-nums">{counts[item.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        {state === 'loading' && (
          <ul className="space-y-3" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="h-20 animate-pulse rounded-md border border-line bg-surface" />
            ))}
          </ul>
        )}

        {state === 'error' && (
          <div role="alert" className="panel border-danger/40 p-6">
            <h2 className="font-medium">No pudimos cargar tus proyectos</h2>
            <p className="mt-1 text-muted">
              Puede ser un problema de conexión. Tus proyectos siguen ahí.
            </p>
            <button type="button" onClick={reload} className="btn btn-secondary btn-sm mt-4">
              Reintentar
            </button>
          </div>
        )}

        {state === 'ready' && filtered.length === 0 && (
          <EmptyState
            title={
              tab === 'drafts'
                ? 'No tienes borradores'
                : projects.length === 0
                  ? 'Tu primer proyecto empieza aquí'
                  : 'Nada en esta pestaña'
            }
            description={
              projects.length === 0
                ? 'Sube tu página, ponle un título y obtén un enlace para compartirla. Toma menos de cinco minutos.'
                : 'Cambia de pestaña o publica un proyecto nuevo.'
            }
            action={{ href: '/publish', label: 'Publicar proyecto' }}
          />
        )}

        {state === 'ready' && filtered.length > 0 && (
          <>
            {/* Escritorio: tabla real, con encabezados asociados. */}
            <table className="hidden w-full border-collapse md:table">
              <caption className="sr-only">
                Tus proyectos, ordenados por fecha de última actualización
              </caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="meta py-2 pr-4 font-normal">
                    Proyecto
                  </th>
                  <th scope="col" className="meta py-2 pr-4 font-normal">
                    Estado
                  </th>
                  <th scope="col" className="meta py-2 pr-4 font-normal">
                    Actualizado
                  </th>
                  <th scope="col" className="meta py-2 pr-4 font-normal">
                    Tamaño
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id} className="border-b border-line align-middle">
                    <th scope="row" className="max-w-xs py-4 pr-4 text-left font-normal">
                      <span className="block truncate font-display text-h3">{project.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-label text-subtle">
                        /@{project.ownerHandle}/{project.slug}
                      </span>
                    </th>
                    <td className="py-4 pr-4">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="py-4 pr-4 text-sm text-muted">
                      <time dateTime={project.updatedAt}>{relativeDate(project.updatedAt)}</time>
                    </td>
                    <td className="py-4 pr-4 text-sm text-muted tabular-nums">
                      {formatBytes(project.totalBytes)}
                    </td>
                    <td className="py-4">
                      <ProjectRowActions
                        project={project}
                        onDeleted={removeLocal}
                        onChanged={reload}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Móvil: tarjetas que aprovechan el ancho. */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((project) => (
                <li key={project.id} className="panel p-4">
                  <h2 className="font-display text-h3">{project.title}</h2>
                  <p className="mt-1 font-mono text-label break-all text-subtle">
                    /@{project.ownerHandle}/{project.slug}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                    <StatusBadge status={project.status} />
                    <span>
                      <time dateTime={project.updatedAt}>{relativeDate(project.updatedAt)}</time>
                    </span>
                    <span>{PROJECT_TYPE_LABEL[project.projectType]}</span>
                  </div>
                  <div className="mt-4">
                    <ProjectRowActions
                      project={project}
                      onDeleted={removeLocal}
                      onChanged={reload}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
