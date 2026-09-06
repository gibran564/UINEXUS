'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import {
  filterEventsByCourse,
  sortEventsReservingAssignments,
  type FeedEvent,
} from '@/lib/home-feed';
import { FeedCard } from './feed-card';

/** De quién viene lo que se está mirando. Es información real, no dos muros. */
export type FeedOrigin = 'all' | 'teachers' | 'class';

const ORIGIN_LABEL: Record<FeedOrigin, string> = {
  all: 'Todo',
  teachers: 'De docentes',
  class: 'De la clase',
};

export const FEED_ORIGINS: readonly FeedOrigin[] = ['all', 'teachers', 'class'];

/** Cuánto muro se pinta de una vez, y cuánto añade cada «cargar más». */
const PAGE = 6;

/**
 * El muro: una sola lista.
 *
 * ## Por qué una y no dos
 *
 * «De tu docente» y «Novedades de tu clase» eran dos cabeceras de sección de 82
 * px que partían en dos un muro que casi nunca llenaba ninguna de las dos. La
 * distinción se conserva —es información real— pero se resuelve en el filtro de
 * origen y dentro de la tarjeta, que ya dice quién publicó y en qué materia.
 *
 * ## El orden
 *
 * Cronológico, con cupo reservado para las actividades: un grupo que comparte
 * veinte páginas en una tarde no puede empujar fuera del muro la entrega del
 * viernes. Eso lo garantiza `sortEventsReservingAssignments`, que no se toca.
 *
 * ## El final del muro es un destino
 *
 * Cuando ya no queda nada por cargar, la lista no termina en vacío: termina en
 * la galería. Estar al día es un estado, no un callejón.
 */
export function WallFeed({
  teacherUpdates,
  classroomActivity,
  courses,
  courseId,
  origin,
  since,
}: {
  teacherUpdates: FeedEvent[];
  classroomActivity: FeedEvent[];
  courses: HomePayload['courses'];
  courseId: string;
  origin: FeedOrigin;
  /** ISO de la última visita, o `null` si este navegador no la recuerda. */
  since: string | null;
}) {
  const [page, setPage] = useState(1);

  // Cambiar de filtro empieza un muro nuevo: seguir en la página 4 de la lista
  // anterior enseñaría un tramo del que nadie ha visto el principio.
  useEffect(() => {
    setPage(1);
  }, [courseId, origin]);

  const fromOrigin =
    origin === 'teachers'
      ? teacherUpdates
      : origin === 'class'
        ? classroomActivity
        : [...teacherUpdates, ...classroomActivity];

  const all = filterEventsByCourse(fromOrigin, courseId);
  const events = sortEventsReservingAssignments(all, PAGE * page);
  const hasMore = events.length < all.length;

  // El corte entre lo nuevo y lo ya visto. Sale de la marca que guarda este
  // navegador, no de un registro de qué mira quién.
  const newCount = since ? events.filter((event) => event.at > since).length : 0;
  const dividerAfter = newCount > 0 && newCount < events.length ? newCount : -1;

  return (
    <section aria-labelledby="muro">
      <h2 id="muro" className="sr-only">
        Publicaciones de tus materias
      </h2>

      {events.length === 0 ? (
        <EmptyWall filtered={Boolean(courseId) || origin !== 'all'} courses={courses} />
      ) : (
        <>
          <ul className="space-y-3">
            {events.map((event, index) => (
              <Fragment key={event.id}>
                <FeedCard event={event} />
                {index === dividerAfter - 1 && <SinceDivider />}
              </Fragment>
            ))}
          </ul>

          <div className="mt-6 text-center">
            {hasMore ? (
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                className="btn btn-secondary btn-sm"
              >
                Cargar más
              </button>
            ) : (
              <p className="text-sm text-muted">
                Estás al día.{' '}
                <Link href="/explore" className="underline">
                  Explorar otros trabajos
                </Link>
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** La línea que separa lo que no habías visto de lo que ya estaba. */
function SinceDivider() {
  return (
    <li className="flex items-center gap-3 py-1 text-label text-subtle">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      Hasta aquí, lo nuevo desde tu última visita
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </li>
  );
}

function EmptyWall({
  filtered,
  courses,
}: {
  filtered: boolean;
  courses: HomePayload['courses'];
}) {
  if (filtered) {
    return <p className="text-sm text-muted">No hay publicaciones con este filtro.</p>;
  }

  return (
    <p className="text-sm text-muted">
      {courses.length === 0
        ? 'Cuando estés en una materia, aquí aparecerá lo que se publique en ella.'
        : 'Tu muro todavía está tranquilo. Cuando tu docente publique una actividad, un recurso o un aviso, o tu grupo comparta un proyecto, aparecerá aquí.'}
    </p>
  );
}

/**
 * Los filtros del muro: materia y origen.
 *
 * Los ve todo el mundo, no sólo quien da clase. Filtrar lo que ya se tiene
 * delante no cambia lo que se puede ver: la audiencia de cada publicación la
 * decidió el servidor antes de mandarla.
 */
export function WallFilters({
  courses,
  courseId,
  onCourseChange,
  origin,
  onOriginChange,
}: {
  courses: HomePayload['courses'];
  courseId: string;
  onCourseChange: (courseId: string) => void;
  origin: FeedOrigin;
  onOriginChange: (origin: FeedOrigin) => void;
}) {
  if (courses.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {courses.length > 1 && (
        <div role="group" aria-label="Filtrar el muro por materia" className="tab-row">
          <button
            type="button"
            className="chip"
            aria-pressed={courseId === ''}
            onClick={() => onCourseChange('')}
          >
            Todas
          </button>
          {courses.map((course) => (
            <button
              key={course.id}
              type="button"
              className="chip"
              aria-pressed={courseId === course.id}
              onClick={() => onCourseChange(course.id)}
            >
              {course.name}
            </button>
          ))}
        </div>
      )}

      <div role="group" aria-label="Filtrar el muro por origen" className="tab-row">
        {FEED_ORIGINS.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={origin === value}
            onClick={() => onOriginChange(value)}
          >
            {ORIGIN_LABEL[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
