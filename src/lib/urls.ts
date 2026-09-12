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
/**
 * El primer origen que de verdad diga algo, sin la barra final.
 *
 * VACÍO cuenta como ausente, y ésa es toda la diferencia. Con `??` una variable
 * definida como cadena vacía —que es lo que deja un panel de despliegue al
 * borrar un valor, y lo que el sandbox local escribe a propósito para decir «no
 * hay»— se colaba tal cual, y el `new URL('')` de más abajo reventaba con
 * `Invalid URL`: un error que no nombra la variable, que ocurre al CARGAR el
 * módulo y que por tanto tira la compilación entera de una página estática.
 *
 * Lo encontró el sandbox compilado (`npm run prod:local`), no el de desarrollo.
 */
const firstOrigin = (...candidates: (string | undefined)[]): string =>
  (candidates.find((value) => value?.trim()) ?? '').trim().replace(/\/$/, '');

export const APP_ORIGIN = firstOrigin(
  process.env.NEXT_PUBLIC_APP_ORIGIN,
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.NODE_ENV === 'production' ? 'https://uinex.vercel.app' : 'http://localhost:3000'
);

/** Alias compatible para metadata, robots y sitemap. */
export const SITE_URL = APP_ORIGIN;
export const APP_HOST = new URL(APP_ORIGIN).host;

export const PROJECTS_ORIGIN = firstOrigin(
  process.env.NEXT_PUBLIC_PROJECTS_ORIGIN,
  'http://localhost:5002'
);

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
