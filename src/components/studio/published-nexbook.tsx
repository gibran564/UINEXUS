'use client';

import { useEffect, useState } from 'react';
import { Notice } from '@/components/aula/aula-ui';
import type { NexBookPublication } from '@/lib/types';
import { NexBookReader } from './nexbook-reader';

/**
 * La pantalla de una publicación.
 *
 * ## Se pide sin token
 *
 * No usa `useApi`, que exige Firebase configurado y adjunta el token de la
 * sesión: una publicación `public` o `link` la abre alguien que no ha entrado y
 * que a lo mejor ni tiene cuenta. Un `fetch` pelado es exactamente lo que hace
 * falta, y la ruta decide qué enseña según la visibilidad.
 *
 * ## Qué se ve y qué no
 *
 * El documento congelado, su título, quién lo publicó y cuándo. No se ve la
 * revisión, ni el id del documento vivo, ni nada de la actividad de la que
 * pudiera haber salido: la ruta no los devuelve.
 */

export function PublishedNexBook({ slug }: { slug: string }) {
  const [publication, setPublication] = useState<NexBookPublication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch(`/api/nexbooks/published/${slug}`);
        if (!response.ok) {
          // «No existe» y «no puedes verla» llegan aquí como el mismo 404, que
          // es como los responde la ruta. No se intenta adivinar cuál era.
          throw new Error('Esta publicación no existe o ya no está disponible.');
        }
        const data = (await response.json()) as { publication: NexBookPublication };
        if (active) setPublication(data.publication);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'No se pudo cargar.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) return <p className="py-10 text-center text-muted">Cargando…</p>;
  if (error || !publication) {
    return <Notice tone="error">{error ?? 'Esta publicación no existe.'}</Notice>;
  }

  return (
    <article>
      <header className="border-b border-line pb-4">
        <h1 className="font-display text-h1">{publication.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {publication.authorName ? `${publication.authorName} · ` : ''}
          NexBook publicado el <PublishedDate value={publication.publishedAt} />
          {publication.updatedAt !== publication.publishedAt && (
            <>
              {' · actualizado el '}
              <PublishedDate value={publication.updatedAt} />
            </>
          )}
        </p>
      </header>

      <div className="mt-6">
        <NexBookReader
          document={publication.document}
          assetUrl={(assetId) => `/api/nexbooks/published/${slug}/assets/${assetId}`}
        />
      </div>

      <footer className="mt-8 border-t border-line pt-4 text-label text-subtle">
        Los resultados que se muestran son los que guardó quien publicó este documento. Nextudio no
        vuelve a ejecutarlos al abrir esta página.
      </footer>
    </article>
  );
}

/**
 * La fecha, formateada en el CLIENTE.
 *
 * Un `toLocaleDateString` durante el renderizado del servidor usa la zona
 * horaria del servidor y produce un texto distinto al del navegador, que React
 * marca como discrepancia de hidratación. Se pinta la marca ISO primero y la
 * fecha legible después de montar.
 */
function PublishedDate({ value }: { value: string }) {
  const [text, setText] = useState(value.slice(0, 10));

  useEffect(() => {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setText(parsed.toLocaleDateString('es-MX', { dateStyle: 'long' }));
    }
  }, [value]);

  return <time dateTime={value}>{text}</time>;
}
