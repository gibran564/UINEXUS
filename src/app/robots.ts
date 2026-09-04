import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/urls';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Zonas privadas o sin valor para un índice público.
        disallow: ['/dashboard', '/dashboard/', '/publish/new', '/login', '/register', '/signup', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
