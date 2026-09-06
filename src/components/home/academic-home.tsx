'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import { useAuth } from '@/components/auth/auth-provider';
import { useApi } from '@/lib/aula-client';
import { EmptyState } from '@/components/ui/empty-state';
import { PublicationComposer, PublicationModeration } from './publication-composer';
import { WallLayout, WallSkeleton } from './wall-layout';
import { WallRail } from './wall-rail';
import { FEED_ORIGINS, WallFeed, WallFilters, type FeedOrigin } from './wall-feed';

/**
 * El Inicio de quien tiene sesión (P1–P4).
 *
 * Este archivo sólo hace tres cosas: pedir los datos, sostener el estado de los
 * filtros y repartir las piezas en las zonas. El marco está en `wall-layout`,
 * el contexto y lo que requiere atención en `wall-rail`, la lista y sus filtros
 * en `wall-feed` y la tarjeta en `feed-card`.
 *
 * ## La regla de la pantalla
 *
 * Las tareas ganan espacio al contenido social. Siempre. Lo que hay que hacer
 * va antes —arriba en móvil, al lado en escritorio— y sólo cuando eso está
 * resuelto aparece lo que publicó la docente y lo que está haciendo la clase.
 * Un muro que entierra una entrega que vence hoy bajo tres proyectos bonitos es
 * un muro que hace daño.
 *
 * ## Por qué no es un panel
 *
 * No hay gráficas, ni KPIs, ni marcadores de progreso del semestre. Cada bloque
 * responde una pregunta concreta —qué me toca, qué cambió, qué hace mi clase— y
 * cada tarjeta dice quién, qué, cuándo y qué se puede hacer al respecto. Lo que
 * no ayuda a decidir qué hacer ahora no está.
 *
 * ## Por qué no hay saludo
 *
 * «Hola, Ana» era el elemento más grande de la pantalla y no decía nada que Ana
 * no supiera. El `<h1>` sigue existiendo para quien navega con lector de
 * pantalla, pero no ocupa la primera pantalla de nadie.
 */

const LAST_VISIT_KEY = 'uinexus-home-visit';

export function AcademicHome() {
  const { user } = useAuth();
  const { data, state, error, reload } = useApi<HomePayload>('/api/home');
  const [since, setSince] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [origin, setOrigin] = useState<FeedOrigin>('all');

  /**
   * «Desde tu última visita» sale de la marca que deja este navegador, no de un
   * sistema de seguimiento: nadie registra qué miras. Se lee una vez y se
   * reescribe enseguida, así que la próxima visita compara con este momento.
   */
  useEffect(() => {
    try {
      setSince(localStorage.getItem(LAST_VISIT_KEY));
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    } catch {
      /* sin almacenamiento: no hay resumen, y no pasa nada */
    }
  }, []);

  /**
   * Los filtros viven en la URL (`?materia=…&origen=…`), como los de
   * `/explore`: así un muro filtrado se puede compartir y sobrevive a una
   * recarga. Se escriben con `replaceState` para no llenar el historial de
   * pasos intermedios, y se leen una sola vez al abrir.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedOrigin = params.get('origen');
    setCourseId(params.get('materia') ?? '');
    if (FEED_ORIGINS.includes(requestedOrigin as FeedOrigin)) {
      setOrigin(requestedOrigin as FeedOrigin);
    }
  }, []);

  const writeUrl = useCallback((nextCourseId: string, nextOrigin: FeedOrigin) => {
    const params = new URLSearchParams(window.location.search);
    if (nextCourseId) params.set('materia', nextCourseId);
    else params.delete('materia');
    if (nextOrigin !== 'all') params.set('origen', nextOrigin);
    else params.delete('origen');
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, []);

  const changeCourse = useCallback(
    (next: string) => {
      setCourseId(next);
      writeUrl(next, origin);
    },
    [origin, writeUrl]
  );

  const changeOrigin = useCallback(
    (next: FeedOrigin) => {
      setOrigin(next);
      writeUrl(courseId, next);
    },
    [courseId, writeUrl]
  );

  if (state === 'loading' && !data) {
    return <WallSkeleton />;
  }

  if (!data) {
    return (
      <div className="container-page py-16">
        <div className="panel mx-auto max-w-md p-8 text-center">
          <h1 className="font-display text-h3">No pudimos abrir tu inicio</h1>
          <p className="mt-3 text-muted">{error ?? 'Vuelve a intentarlo en un momento.'}</p>
          <button type="button" onClick={reload} className="btn btn-secondary mt-6">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const teachesSomewhere = data.courses.some((course) => course.role === 'teacher');
  const studiesSomewhere = data.courses.some((course) => course.role === 'student');
  // Quien da clase de una materia y cursa otra ve los dos bloques; el suyo
  // principal decide cuál va primero.
  const teacherFirst = data.role !== 'student' && teachesSomewhere;

  // Una materia que ya no es tuya no filtra nada: la URL puede traer cualquier
  // cosa y el muro sólo entiende las materias que el servidor mandó.
  const activeCourseId = data.courses.some((course) => course.id === courseId) ? courseId : '';

  return (
    <>
      <h1 className="sr-only">Tu muro</h1>

      <WallLayout
        filters={
          data.courses.length > 0 ? (
            <WallFilters
              courses={data.courses}
              courseId={activeCourseId}
              onCourseChange={changeCourse}
              origin={origin}
              onOriginChange={changeOrigin}
            />
          ) : null
        }
        rail={
          <WallRail
            displayName={data.displayName || user?.displayName || ''}
            handle={data.handle}
            avatarUrl={user?.avatarUrl ?? null}
            role={data.role}
            courses={data.courses}
            attention={data.attention}
            teacherTasks={data.teacherTasks}
            teacherFirst={teacherFirst}
            studiesSomewhere={studiesSomewhere}
            teachesSomewhere={teachesSomewhere}
          />
        }
        feed={
          <div className="flex flex-col gap-6">
            {state === 'error' && <p role="alert" className="text-sm text-muted">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Reintentar actualización</button></p>}
            <PublicationModeration publications={data.publications ?? []} courses={data.courses} onChanged={reload} />
            {data.courses.length > 0 && <PublicationComposer courses={data.courses} onPublished={reload} />}

            <WallFeed
              teacherUpdates={data.teacherUpdates}
              classroomActivity={data.classroomActivity}
              courses={data.courses}
              courseId={activeCourseId}
              origin={origin}
              since={since}
            />

            {data.courses.length === 0 && (
              <EmptyState
                title="Todavía no estás en ninguna materia"
                description={
                  data.role === 'student'
                    ? 'Pide a tu docente el código de la materia y únete desde tu aula.'
                    : 'Crea tu primera materia y comparte su código con el grupo.'
                }
                action={{ href: '/aula', label: 'Ir a mi aula' }}
              />
            )}
          </div>
        }
      />
    </>
  );
}
