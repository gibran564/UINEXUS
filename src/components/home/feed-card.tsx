'use client';

import Link from 'next/link';
import { GeneratedCover } from '@/components/project/generated-cover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { relativeTime, type FeedEvent, type FeedEventKind } from '@/lib/home-feed';

/**
 * El tipo se dice una vez, como etiqueta, y no como narración. «Publicó una
 * actividad» ocupaba una línea entera para repetir lo que el título ya deja
 * claro; «Tarea» cabe al lado del título y se lee de un vistazo.
 */
const EVENT_TYPE: Record<FeedEventKind, string> = {
  assignment: 'Tarea',
  announcement: 'Aviso',
  prompt: 'Prompt',
  skill: 'Skill',
  resource: 'Recurso',
  project: 'Proyecto',
};

/** Sólo lo que se enseña trae miniatura. Lo demás no tiene nada que enseñar. */
const HAS_THUMBNAIL: ReadonlySet<FeedEventKind> = new Set<FeedEventKind>(['project']);

/**
 * Una tarjeta del muro: quién, sobre qué materia, cuándo, qué es y cómo se
 * llama.
 *
 * ## Por qué es tan baja
 *
 * La portada a ancho de columna hacía que cupieran dos publicaciones en una
 * pantalla de 1440 px: el muro no se podía escanear, y empeoraba cuanto mejor
 * era el monitor. La miniatura es de alto fijo (72 × 45 en móvil, 96 × 60 desde
 * `sm:`), así que la altura de la tarjeta ya no depende del ancho.
 *
 * ## Por qué no hay botón
 *
 * La tarjeta entera es el enlace: un solo objetivo y un solo tab-stop. El
 * enlace se estira desde el título con un `::after` sobre toda la tarjeta, de
 * modo que el lector de pantalla anuncia el título —no «Ver», siete veces
 * seguidas—, y el ratón puede pulsar en cualquier parte.
 *
 * ## Lo que no se enseña sin abrir
 *
 * El contenido completo, la audiencia y quién aprobó la publicación. No hay
 * «me gusta», ni comentarios, ni contador de vistas. Un aula no necesita
 * métricas de popularidad para estar viva; necesita que se vea lo que la gente
 * publica.
 */
export function FeedCard({ event }: { event: FeedEvent }) {
  const thumbnail = HAS_THUMBNAIL.has(event.kind);

  return (
    <li className="panel relative p-3.5 transition-colors hover:border-line-strong focus-within:border-accent">
      <div className="flex items-start gap-3">
        {thumbnail && (
          <span
            aria-hidden="true"
            className="block h-[45px] w-[72px] shrink-0 overflow-hidden rounded-xs border border-line bg-surface sm:h-[60px] sm:w-24"
          >
            {event.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.cover.url}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <GeneratedCover seed={event.id} className="h-full w-full" />
            )}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-label text-subtle">
            {event.actor && (
              <>
                <UserAvatar name={event.actor.displayName} src={event.actor.avatarUrl} size={18} />
                <span className="font-medium text-fg">{event.actor.displayName}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {event.courseName && (
              <>
                <span className="text-muted">{event.courseName}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{relativeTime(event.at)}</span>
          </p>

          <div className="mt-1 flex items-start justify-between gap-3">
            <p className="min-w-0 font-medium">
              <CardTarget event={event} />
            </p>
            <span className="tag shrink-0">{EVENT_TYPE[event.kind]}</span>
          </div>

          {event.summary && (
            <p className="mt-0.5 line-clamp-1 text-sm text-muted">{event.summary}</p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * El único elemento pulsable de la tarjeta. Una publicación del muro va a su
 * permalink —`/muro/[id]`, que desde aquí se presenta como diálogo—; el resto
 * de eventos van al objeto real dentro de la materia. En los dos casos el
 * nombre accesible es el título.
 */
function CardTarget({ event }: { event: FeedEvent }) {
  // `after:` estira el objetivo hasta el borde de la tarjeta sin sacar el
  // título de su sitio ni añadir un segundo tab-stop.
  // El anillo de foco se queda donde está —sobre el título— porque marcar la
  // tarjeta entera diría menos y quitarlo no es una opción.
  const stretch = "text-left after:absolute after:inset-0 after:content-[''] hover:underline";

  const href = event.publicationId
    ? `/muro/${encodeURIComponent(event.publicationId)}`
    : event.href;

  return (
    <Link href={href} className={stretch}>
      {event.title}
    </Link>
  );
}
