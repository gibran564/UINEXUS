/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import type { Project } from '@/lib/types';
import { publicProjectPath } from '@/lib/urls';
import { GeneratedCover } from './generated-cover';

/**
 * Tarjeta de proyecto.
 *
 * Reglas que sostienen la galería:
 *  · La portada ocupa el 70 % de la tarjeta. El trabajo del alumno manda.
 *  · Como máximo cuatro datos bajo el título. Más metadatos = menos jerarquía.
 *  · Un solo elemento interactivo por tarjeta: el título, extendido a toda la
 *    superficie con ::after. Las etiquetas se muestran como texto, no como
 *    enlaces, para no anidar interactivos ni multiplicar paradas de tabulador.
 */
export function ProjectCard({
  project,
  priority = false,
}: {
  project: Project;
  priority?: boolean;
}) {
  const href = publicProjectPath(project);
  const context = [project.courseName, project.term].filter(Boolean).join(' · ');

  return (
    <article className="group relative flex flex-col">
      <div className="relative aspect-16/10 overflow-hidden rounded-md border border-line bg-surface transition-colors group-hover:border-line-strong">
        {project.cover ? (
          <img
            src={project.cover.url}
            alt={project.cover.alt}
            className="h-full w-full object-cover"
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
          />
        ) : (
          <GeneratedCover seed={project.slug} className="h-full w-full" />
        )}

        {project.featured && (
          <p className="absolute top-2 left-2 rounded-xs border border-accent-line bg-accent-soft px-2 py-0.5 text-label font-medium text-accent">
            Destacado
          </p>
        )}
      </div>

      <div className="mt-3">
        <h3 className="font-display text-h3 leading-snug">
          <Link
            href={href}
            className="rounded-xs no-underline after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            {project.title}
          </Link>
        </h3>

        <p className="mt-1 text-sm text-muted">{project.author.displayName}</p>

        {context && <p className="mt-0.5 text-sm text-subtle">{context}</p>}

        {project.tags.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {project.tags.slice(0, 3).map((tag) => (
              <li key={tag} className="tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
