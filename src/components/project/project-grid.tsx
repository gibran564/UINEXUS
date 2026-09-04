import type { Project } from '@/lib/types';
import { ProjectCard } from './project-card';

export function ProjectGrid({
  projects,
  label,
  priorityCount = 3,
}: {
  projects: readonly Project[];
  /** Nombre accesible de la lista, p. ej. "Resultados de la búsqueda". */
  label: string;
  priorityCount?: number;
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3"
    >
      {projects.map((project, index) => (
        <li key={project.id}>
          <ProjectCard project={project} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

/** Esqueleto con la misma retícula: la página no salta al cargar. */
export function ProjectGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className="aspect-16/10 animate-pulse rounded-md border border-line bg-surface" />
          <div className="mt-3 h-5 w-3/4 animate-pulse rounded-xs bg-sunken" />
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded-xs bg-sunken" />
        </div>
      ))}
    </div>
  );
}
