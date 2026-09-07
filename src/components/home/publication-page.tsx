'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { Notice } from '@/components/aula/aula-ui';
import { useApi } from '@/lib/aula-client';
import type { PublicationCourse, PublicationDetail as PublicationDetailData } from '@/lib/publications';
import { PublicationContent } from './publication-detail';

const KIND_LABEL: Record<string, string> = {
  project: 'Página / proyecto',
  announcement: 'Anuncio',
  resource: 'Recurso',
  prompt: 'Prompt',
  skill: 'Skill',
};

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Pendiente de aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

/**
 * Una publicación del muro con URL propia: `/muro/[id]`.
 *
 * Es la densidad completa —contenido íntegro, audiencia, estado— y la única
 * versión que se puede enlazar, recargar y compartir. Sobre el muro, la misma
 * ruta se presenta interceptada como diálogo; aquí es una pantalla.
 *
 * ## Quién la ve
 *
 * Exactamente quien ya podía verla. La autorización la decide el servidor en
 * `/api/publications/[id]`: tener el enlace no da acceso a nada, y si la
 * publicación no es para ti la respuesta es la misma que si no existiera.
 */
export function PublicationPage({ id }: { id: string }) {
  const { status } = useAuth();
  const authenticated = status === 'authenticated';

  const { data, state, error, reload } = useApi<PublicationDetailData>(
    authenticated ? `/api/publications/${encodeURIComponent(id)}` : null
  );
  // Sólo para poner nombre a la audiencia: los identificadores de materia no
  // significan nada para quien lee.
  const { data: mine } = useApi<{ courses: PublicationCourse[] }>(
    authenticated ? '/api/publications?options=1' : null
  );

  if (status === 'loading') {
    return <p className="py-16 text-center text-muted">Cargando…</p>;
  }

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h2">Entra para ver esta publicación</h1>
        <p className="mt-3 text-muted">
          El muro es de tus materias, así que hay que saber quién eres para abrirlo.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/muro/${id}`)}`}
          className="btn btn-primary btn-lg mt-6 w-full"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <p role="status" className="py-16 text-center text-muted">
        Abriendo la publicación…
      </p>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h3">No pudimos abrir la publicación</h1>
        <div className="mt-4">
          <Notice tone="error">{error ?? 'Puede que ya no exista o que no sea para ti.'}</Notice>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Reintentar
          </button>
          <Link href="/" className="btn btn-secondary">
            Volver al muro
          </Link>
        </div>
      </div>
    );
  }

  const { publication } = data;
  const audience = publication.audienceCourseIds
    .map((courseId) => mine?.courses.find((course) => course.id === courseId)?.name ?? courseId)
    .join(' · ');

  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="min-w-0 break-words font-display text-h1">{publication.title}</h1>

      <p className="mt-3 text-sm text-muted">
        {publication.author.displayName}
        {publication.author.handle ? ` · @${publication.author.handle}` : ''}
      </p>
      <p className="mt-1 text-sm text-muted">
        {KIND_LABEL[publication.kind] ?? publication.kind} ·{' '}
        {new Date(publication.createdAt).toLocaleString('es-MX')}
      </p>
      <p className="mt-1 text-sm text-muted">
        Estado: {STATUS_LABEL[publication.status] ?? publication.status}
      </p>
      {audience && <p className="mt-1 text-sm text-muted">Audiencia: {audience}</p>}
      {publication.approvedBy && (
        <p className="mt-1 text-sm text-muted">Aprobado por {publication.approvedBy.displayName}</p>
      )}

      <div className="mt-8 min-w-0 space-y-5 break-words">
        <PublicationContent detail={data} />
      </div>

      <p className="mt-10">
        <Link href="/" className="btn btn-secondary btn-sm">
          Volver al muro
        </Link>
      </p>
    </article>
  );
}
