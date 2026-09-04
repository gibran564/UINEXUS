/**
 * Construcción de URLs.
 *
 * Hay dos familias y no deben mezclarse nunca:
 *  - `publicProjectUrl()` -> URL canónica que se muestra y comparte.
 *  - `liveProjectUrl()`  -> ejecución del proyecto en el ORIGEN AISLADO.
 */

import type { Project, ProjectRecord } from './types';

/**
 * Origin público de la aplicación. La variable nueva expresa su propósito;
 * `NEXT_PUBLIC_SITE_URL` se conserva como alias para despliegues existentes.
 */
export const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_ORIGIN ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://uinex.vercel.app' : 'http://localhost:3000')
).replace(/\/$/, '');

/** Alias compatible para metadata, robots y sitemap. */
export const SITE_URL = APP_ORIGIN;
export const APP_HOST = new URL(APP_ORIGIN).host;

export const PROJECTS_ORIGIN =
  process.env.NEXT_PUBLIC_PROJECTS_ORIGIN?.replace(/\/$/, '') ??
  'http://localhost:5002';

export function profilePath(handle: string): string {
  return `/@${handle}`;
}

type ProjectAddress =
  | Pick<Project, 'slug' | 'author'>
  | Pick<ProjectRecord, 'slug' | 'ownerHandle'>
  | { handle: string; slug: string };

function addressParts(project: ProjectAddress): { handle: string; slug: string } {
  if ('handle' in project) return project;
  if ('ownerHandle' in project) return { handle: project.ownerHandle, slug: project.slug };
  return { handle: project.author.handle, slug: project.slug };
}

export function publicProjectPath(project: ProjectAddress): string {
  const { handle, slug } = addressParts(project);
  return `/@${handle}/${slug}/`;
}

/** Única URL de producto para mostrar, copiar, compartir y guardar en entregas. */
export function publicProjectUrl(project: ProjectAddress): string {
  return `${APP_ORIGIN}${publicProjectPath(project)}`;
}

export function profileUrl(handle: string): string {
  return `${SITE_URL}${profilePath(handle)}`;
}

/** URL donde REALMENTE se ejecuta el proyecto del alumno. Otro origen. */
export function liveProjectUrl(handle: string, slug: string): string {
  return `${PROJECTS_ORIGIN}/@${handle}/${slug}/`;
}

export function coursePath(slug: string): string {
  return `/courses/${slug}`;
}

/** Serializa filtros de exploración a query string legible y compartible. */
export function exploreHref(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '' && value !== 'all') search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/explore?${qs}` : '/explore';
}
