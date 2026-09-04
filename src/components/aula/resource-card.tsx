'use client';

import { useState } from 'react';
import { moderateResource } from '@/lib/aula-client';
import type { ResourceAuthorship, ResourceStatus } from '@/lib/types';
import { Notice } from './aula-ui';

/**
 * Autoría y moderación de un recurso (§8, §9, §44, §45).
 *
 * La autoría se muestra SIEMPRE, también después de aprobar. Es lo que
 * convierte la biblioteca en conocimiento colectivo de la materia en vez de un
 * almacén anónimo: si Christian encontró la Skill, la ficha lo dice aunque la
 * docente la haya revisado y destacado.
 */

const STATUS_LABEL: Record<ResourceStatus, string> = {
  draft: 'Borrador',
  proposed: 'Pendiente de revisión',
  approved: 'En la biblioteca',
  rejected: 'No aceptado',
  archived: 'Archivado',
};

const STATUS_TONE: Record<ResourceStatus, string> = {
  draft: 'border-line-strong text-muted',
  proposed: 'border-warning/40 text-warning',
  approved: 'border-success/35 text-success',
  rejected: 'border-danger/40 text-danger',
  archived: 'border-line text-subtle',
};

export function ResourceStatusBadge({ status }: { status: ResourceStatus }) {
  // Aprobado es el caso normal: marcarlo sería ruido en cada tarjeta.
  if (status === 'approved') return null;

  return (
    <span
      className={`inline-flex h-6 items-center rounded-xs border px-2 text-label ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** «Aportado por Christian · Aprobado por la docente» (§9). */
export function ResourceAttribution({ resource }: { resource: ResourceAuthorship }) {
  if (!resource.author) return null;

  return (
    <p className="mt-1 text-label text-subtle">
      Aportado por {resource.author.displayName}
      {resource.status === 'approved' && resource.approvedBy && (
        <> · Aprobado por {resource.approvedBy.displayName}</>
      )}
      {resource.featured && <> · ⭐ Destacado</>}
    </p>
  );
}

/**
 * Los botones de decisión. Sólo se pintan para el profesorado.
 *
 * `Rechazar` y `Archivar` no borran: quien propuso algo tiene derecho a saber
 * qué pasó, y un recurso que desaparece sin rastro sólo produce la misma
 * propuesta otra vez la semana siguiente.
 */
export function ModerationActions({
  kind,
  id,
  status,
  featured,
  onDone,
}: {
  kind: 'prompt' | 'skill' | 'resource';
  id: string;
  status: ResourceStatus;
  featured: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    action: 'approve' | 'reject' | 'archive' | 'feature' | 'unfeature'
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await moderateResource(kind, id, action);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la decisión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === 'proposed' && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('approve')}
            className="btn btn-primary btn-sm"
          >
            Añadir a la biblioteca
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('reject')}
            className="btn btn-secondary btn-sm"
          >
            No aceptar
          </button>
        </>
      )}

      {status === 'approved' && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(featured ? 'unfeature' : 'feature')}
            className="btn btn-ghost btn-sm"
          >
            {featured ? 'Quitar destacado' : '⭐ Destacar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('archive')}
            className="btn btn-ghost btn-sm"
          >
            Archivar
          </button>
        </>
      )}

      {(status === 'rejected' || status === 'archived') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('approve')}
          className="btn btn-secondary btn-sm"
        >
          Recuperar
        </button>
      )}

      {error && (
        <div className="w-full">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
