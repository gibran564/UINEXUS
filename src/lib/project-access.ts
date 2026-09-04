import type { ProjectRecord } from './types';

/** Alcanzable por enlace directo: publicado o no listado, completo y coherente. */
export function isPubliclyRoutable(project: ProjectRecord): boolean {
  return (
    !project.hiddenByAdmin &&
    project.version >= 1 &&
    Boolean(project.entryFile) &&
    project.ownerHandle === project.author.handle &&
    (project.status === 'published' || project.status === 'unlisted')
  );
}

/** La ruta pedida debe pertenecer exactamente al proyecto que se encontró. */
export function isPublicProjectAtPath(
  project: ProjectRecord,
  handle: string,
  slug: string
): boolean {
  return (
    isPubliclyRoutable(project) &&
    project.ownerHandle === handle &&
    project.author.handle === handle &&
    project.slug === slug
  );
}
