import type { MetadataRoute } from 'next';
import { listCourses, listIndexablePaths, listPublicHandles } from '@/lib/data/repository';
import { SITE_URL } from '@/lib/urls';

export const revalidate = 3600;

/**
 * Mapa del sitio.
 *
 * `listIndexablePaths()` devuelve únicamente proyectos `published`. Los
 * `unlisted` quedan fuera por definición: "sólo con enlace" significa que no
 * entra en ningún índice, ni el nuestro ni el de un buscador.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [projects, handles, courses] = await Promise.all([
    listIndexablePaths(),
    listPublicHandles(),
    listCourses(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/explore`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/courses`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/about`, changeFrequency: 'monthly', priority: 0.4 },
  ];

  return [
    ...staticRoutes,
    ...courses.map((course) => ({
      url: `${SITE_URL}/courses/${course.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...handles.map((handle) => ({
      url: `${SITE_URL}/@${handle}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...projects.map((project) => ({
      url: `${SITE_URL}/@${project.handle}/${project.slug}`,
      lastModified: new Date(project.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
