/**
 * Construcción de URLs.
 *
 * Hay dos familias y no deben mezclarse nunca:
 *  - `projectPath()`     -> ficha académica en el dominio de la plataforma.
 *  - `liveProjectUrl()`  -> ejecución del proyecto en el ORIGEN AISLADO.
 */

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

export const PROJECTS_ORIGIN =
  process.env.NEXT_PUBLIC_PROJECTS_ORIGIN?.replace(/\/$/, '') ??
  'http://localhost:5002';

export function profilePath(handle: string): string {
  return `/@${handle}`;
}

export function projectPath(handle: string, slug: string): string {
  return `/@${handle}/${slug}`;
}

export function projectUrl(handle: string, slug: string): string {
  return `${SITE_URL}${projectPath(handle, slug)}`;
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
