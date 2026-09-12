'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import { useAuth } from '@/components/auth/auth-provider';
import { useApi } from '@/lib/aula-client';
import { EmptyState } from '@/components/ui/empty-state';
import { PublicationComposer, PublicationModeration } from './publication-composer';
import { WallLayout, WallSkeleton } from './wall-layout';
import { WallRail } from './wall-rail';
import { StudentAttention, TeacherAttention, type Focus } from './attention-panel';
import { ResumeStrip } from './resume-strip';
import { FEED_ORIGINS, WallFeed, WallFilters, type FeedOrigin } from './wall-feed';

/**
 * El Inicio de quien tiene sesión (P1–P4).
 *
 * Este archivo sólo hace tres cosas: pedir los datos, sostener el estado de los
 * filtros y repartir las piezas en las zonas. El marco está en `wall-layout`,
 * el contexto en `wall-rail`, lo que hay que hacer en `attention-panel`, lo que
 * quedó a medias en `resume-strip`, la lista y sus filtros en `wall-feed` y la
 * tarjeta en `feed-card`.
 *
 * ## La regla de la pantalla
 *
 * Las tareas ganan espacio al contenido social. Siempre. Lo que hay que hacer va
 * primero, después lo que se dejó a medias, y sólo cuando eso está resuelto
 * aparece lo que publicó la docente y lo que está haciendo la clase. Un muro que
 * entierra una entrega que vence hoy bajo tres proyectos bonitos es un muro que
 * hace daño.
 *
 * ## Todo cabe aquí
 *
 * El Inicio es el sitio donde se decide qué hacer, no un vestíbulo con enlaces a
 * las pantallas donde se decide. Por eso nada de lo que cambia la respuesta a
 * «¿qué hago ahora?» vive detrás de otra pantalla: los pendientes se filtran
 * aquí, el resto de la lista se despliega aquí y lo que quedó a medias se
 * retoma desde aquí.
 *
 * ## Por qué sigue sin ser un panel
 *
 * No hay gráficas, ni marcadores de progreso del semestre, ni contadores que
 * sólo se miren. Los números que hay son filtros —se pulsan y recortan la lista
 * de abajo, ver `attention-panel`—: un número que no se puede pulsar habla del
 * pasado de quien lo lee, que ya lo conoce.
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
  const [focus, setFocus] = useState<Focus>('all');

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
   * Los filtros viven en la URL (`?materia=…&origen=…&pendiente=…`), como los
   * de `/explore`: así un Inicio filtrado se puede compartir y sobrevive a una
   * recarga. Se escriben con `replaceState` para no llenar el historial de
   * pasos intermedios, y se leen una sola vez al abrir.
   *
   * `pendiente` no se valida contra una lista de valores permitidos, a
   * diferencia de `origen`: los motivos los calcula el servidor y cuáles
   * existen depende de lo que tenga cada quien. Un valor que no corresponda a
   * nada se ignora solo —cada lista sólo atiende a su propio vocabulario, ver
   * `attention-panel`— y la pantalla queda sin filtrar, que es lo correcto.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedOrigin = params.get('origen');
    setCourseId(params.get('materia') ?? '');
    setFocus((params.get('pendiente') as Focus) || 'all');
    if (FEED_ORIGINS.includes(requestedOrigin as FeedOrigin)) {
      setOrigin(requestedOrigin as FeedOrigin);
    }
  }, []);

  const writeUrl = useCallback(
    (nextCourseId: string, nextOrigin: FeedOrigin, nextFocus: Focus) => {
      const params = new URLSearchParams(window.location.search);
      if (nextCourseId) params.set('materia', nextCourseId);
      else params.delete('materia');
      if (nextOrigin !== 'all') params.set('origen', nextOrigin);
      else params.delete('origen');
      if (nextFocus !== 'all') params.set('pendiente', nextFocus);
      else params.delete('pendiente');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
    },
    []
  );

  const changeCourse = useCallback(
    (next: string) => {
      setCourseId(next);
      writeUrl(next, origin, focus);
    },
    [focus, origin, writeUrl]
  );

  const changeOrigin = useCallback(
    (next: FeedOrigin) => {
      setOrigin(next);
      writeUrl(courseId, next, focus);
    },
    [courseId, focus, writeUrl]
  );

  const changeFocus = useCallback(
    (next: Focus) => {
      setFocus(next);
      writeUrl(courseId, origin, next);
    },
    [courseId, origin, writeUrl]
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
        rail={
          <WallRail
            displayName={data.displayName || user?.displayName || ''}
            handle={data.handle}
            avatarUrl={user?.avatarUrl ?? null}
            role={data.role}
            courses={data.courses}
          />
        }
        main={
          <div className="flex flex-col gap-8">
            {state === 'error' && <p role="alert" className="text-sm text-muted">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Reintentar actualización</button></p>}

            {/*
              Lo que hay que hacer, arriba del todo y sin nada por encima. Quien
              da clase de una materia y cursa otra ve los dos bloques; su papel
              principal decide cuál va primero.
            */}
            {teacherFirst ? (
              <>
                <TeacherAttention tasks={data.teacherTasks} show={teachesSomewhere} focus={focus} onFocusChange={changeFocus} />
                <StudentAttention items={data.attention} show={studiesSomewhere} focus={focus} onFocusChange={changeFocus} />
              </>
            ) : (
              <>
                <StudentAttention items={data.attention} show={studiesSomewhere} focus={focus} onFocusChange={changeFocus} />
                <TeacherAttention tasks={data.teacherTasks} show={teachesSomewhere} focus={focus} onFocusChange={changeFocus} />
              </>
            )}

            <ResumeStrip items={data.resume ?? []} />

            <PublicationModeration publications={data.publications ?? []} courses={data.courses} onChanged={reload} />

            {/*
              El muro y sus filtros van juntos y al final: lo social no empieza
              hasta que lo que hay que hacer ya se dijo entero.
            */}
            <div className="flex flex-col gap-6">
              {data.courses.length > 0 && (
                <>
                  <PublicationComposer courses={data.courses} onPublished={reload} />
                  <WallFilters
                    courses={data.courses}
                    courseId={activeCourseId}
                    onCourseChange={changeCourse}
                    origin={origin}
                    onOriginChange={changeOrigin}
                  />
                </>
              )}

              <WallFeed
                teacherUpdates={data.teacherUpdates}
                classroomActivity={data.classroomActivity}
                courses={data.courses}
                courseId={activeCourseId}
                origin={origin}
                since={since}
              />
            </div>

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
