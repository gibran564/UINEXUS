'use client';

import { useState } from 'react';
import { EMBED_SANDBOX, describeLink } from '@/lib/link-preview';
import { Notice } from './aula-ui';

/**
 * Un enlace externo, con la mejor representación segura que se pueda dar.
 *
 * El nivel lo decide `describeLink`, que sólo mira el texto de la URL: nunca se
 * pide nada al sitio de destino desde el servidor (ver `lib/link-preview.ts`).
 *
 * **La tarjeta sin embed no es un fallo.** La mayoría de las herramientas
 * bloquean el iframe, y prometer una vista incrustada que casi nunca funciona
 * convertiría el caso normal en un error aparente. Cuando no hay embed, el
 * texto lo dice sin dramatismo y ofrece abrirlo.
 */
export function LinkCard({
  url,
  title,
  description,
  compact = false,
}: {
  url: string;
  title?: string;
  description?: string;
  /** Sin previsualización: sólo la línea con el enlace. */
  compact?: boolean;
}) {
  const link = describeLink(url);
  const [showEmbed, setShowEmbed] = useState(false);

  if (!link.ok) {
    return <Notice tone="error">{link.reason}</Notice>;
  }

  return (
    <div className={compact ? '' : 'panel p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-label text-subtle">
            {link.provider}
            {link.provider !== link.domain && ` · ${link.domain}`}
          </p>
          {title && <p className="mt-1 font-medium">{title}</p>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {link.embedUrl && (
            <button
              type="button"
              onClick={() => setShowEmbed((value) => !value)}
              className="btn btn-secondary btn-sm"
            >
              {showEmbed ? 'Ocultar' : 'Previsualizar'}
            </button>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Abrir ↗
          </a>
        </div>
      </div>

      {link.embedUrl && showEmbed && (
        <div className="mt-3 overflow-hidden rounded-sm border border-line">
          {/*
            `sandbox` acotado, `referrerPolicy` sin origen y carga perezosa. El
            contenido es de un tercero: puede ejecutarse dentro de su propio
            origen, pero no puede navegar la pestaña ni abrir diálogos que
            parezcan de UINexus.
          */}
          <iframe
            src={link.embedUrl}
            title={title || `Previsualización de ${link.provider}`}
            sandbox={EMBED_SANDBOX}
            referrerPolicy="no-referrer"
            loading="lazy"
            allowFullScreen
            className="aspect-video w-full border-0"
          />
        </div>
      )}

      {!link.embedUrl && !compact && (
        <p className="hint">
          {link.provider === link.domain
            ? 'Se abre en una pestaña nueva.'
            : `${link.provider} no permite mostrarse dentro de UINexus. Se abre en una pestaña nueva.`}
        </p>
      )}
    </div>
  );
}
