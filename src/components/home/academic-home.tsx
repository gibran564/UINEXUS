'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import { useAuth } from '@/components/auth/auth-provider';
import { useApi } from '@/lib/aula-client';
import { formatDueLabel } from '@/lib/due-date';
import {
  filterEventsByCourse,
  attentionCta,
  progressLabel,
  relativeTime,
  summarizeSince,
  type AttentionItem,
  type AttentionReason,
  type FeedEvent,
  type FeedEventKind,
  type TeacherTask,
} from '@/lib/home-feed';
import { EmptyState } from '@/components/ui/empty-state';
import { GeneratedCover } from '@/components/project/generated-cover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { PublicationComposer, PublicationModeration } from './publication-composer';
import { PublicationDetail } from './publication-detail';

/**
 * El Inicio de quien tiene sesión (P1–P4).
 *
 * ## La regla de la pantalla
 *
 * Las tareas ganan espacio al contenido social. Siempre. Lo que hay que hacer
 * va arriba, y sólo cuando eso está resuelto aparece lo que publicó la docente
 * y lo que está haciendo la clase. Un muro que entierra una entrega que vence
 * hoy bajo tres proyectos bonitos es un muro que hace daño.
 *
 * ## Por qué no es un panel
 *
 * No hay gráficas, ni KPIs, ni marcadores de progreso del semestre. Cada bloque
 * responde una pregunta concreta —qué me toca, qué cambió, qué hace mi clase— y
 * cada tarjeta dice quién, qué, cuándo y qué se puede hacer al respecto. Lo que
 * no ayuda a decidir qué hacer ahora no está.
 *
 * ## Por qué el orden vertical
 *
 * Se lee sobre todo en el móvil, entre clase y clase. Una columna, tarjetas
 * compactas y botones grandes: el mismo orden en cualquier ancho, sin depender
 * de un tablero de tres columnas que en 375 px se convierte en una tira larga
 * con lo importante en medio.
 */

const LAST_VISIT_KEY = 'uinexus-home-visit';

export function AcademicHome() {
  const { user } = useAuth();
  const [feedCourseId, setFeedCourseId] = useState('');
  const { data, state, error, reload } = useApi<HomePayload>(feedCourseId ? `/api/home?courseId=${encodeURIComponent(feedCourseId)}` : '/api/home');
  const [since, setSince] = useState<string | null>(null);

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

  if (state === 'loading' && !data) {
    return <p className="container-page py-24 text-center text-muted">Abriendo tu inicio…</p>;
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

  const attention = <StudentAttention items={data.attention} show={studiesSomewhere} />;
  const tasks = <TeacherAttention tasks={data.teacherTasks} show={teachesSomewhere} />;

  const summary = summarizeSince(
    [...data.teacherUpdates, ...data.classroomActivity],
    since
  );

  return (
    <div className="container-page max-w-3xl py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-h1">
            Hola, {data.displayName?.split(' ')[0] || user?.displayName || 'de nuevo'}
          </h1>
          <p className="mt-1 text-muted">
            {teachesSomewhere && !studiesSomewhere
              ? 'Lo que requiere tu atención y lo que está pasando en tus materias.'
              : 'Lo que tienes que hacer y lo que está pasando en tus materias.'}
          </p>
        </div>
        <Link href="/aula" className="btn btn-secondary btn-sm">
          Ver mis materias
        </Link>
      </header>

      {summary && <SinceSummaryLine summary={summary} />}

      {teacherFirst ? (
        <>
          {tasks}
          {attention}
        </>
      ) : (
        <>
          {attention}
          {tasks}
        </>
      )}

      {state === 'error' && <p role="alert" className="mt-4 text-sm text-muted">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Reintentar actualización</button></p>}
      <PublicationModeration publications={data.publications ?? []} courses={data.courses} onChanged={reload} />
      {data.courses.length > 0 && <PublicationComposer courses={data.courses} onPublished={reload} />}
      {teachesSomewhere && (
        <label className="mt-8 block">
          <span className="label">Filtrar el muro por grupo</span>
          <select className="field" value={feedCourseId} onChange={(event) => setFeedCourseId(event.target.value)}>
            <option value="">Todos los grupos</option>
            {data.courses.filter((course) => course.role === 'teacher').map((course) => (
              <option key={course.id} value={course.id}>{course.name}</option>
            ))}
          </select>
        </label>
      )}

      <FeedSection
        id="de-tu-docente"
        title={teachesSomewhere && !studiesSomewhere ? 'Publicado en tus materias' : 'De tu docente'}
        events={filterEventsByCourse(data.teacherUpdates, feedCourseId)}
        courses={data.courses}
        empty="Cuando tu docente publique una actividad, un recurso o un aviso, aparecerá aquí."
      />

      <FeedSection
        id="tu-clase"
        title="Novedades de tu clase"
        events={filterEventsByCourse(data.classroomActivity, feedCourseId)}
        courses={data.courses}
        empty="Tu aula todavía está tranquila. Cuando tu grupo publique proyectos o aporte recursos, aparecerán aquí."
      />

      {data.courses.length === 0 && (
        <div className="mt-10">
          <EmptyState
            title="Todavía no estás en ninguna materia"
            description={
              data.role === 'student'
                ? 'Pide a tu docente el código de la materia y únete desde tu aula.'
                : 'Crea tu primera materia y comparte su código con el grupo.'
            }
            action={{ href: '/aula', label: 'Ir a mi aula' }}
          />
        </div>
      )}
    </div>
  );
}

/** «Desde tu última visita: 1 actividad, 2 recursos, 4 proyectos». */
function SinceSummaryLine({
  summary,
}: {
  summary: { assignments: number; resources: number; projects: number };
}) {
  const parts = [
    summary.assignments > 0 &&
      `${summary.assignments} ${summary.assignments === 1 ? 'actividad nueva' : 'actividades nuevas'}`,
    summary.resources > 0 &&
      `${summary.resources} ${summary.resources === 1 ? 'recurso' : 'recursos'}`,
    summary.projects > 0 &&
      `${summary.projects} ${summary.projects === 1 ? 'proyecto publicado' : 'proyectos publicados'}`,
  ].filter(Boolean) as string[];

  if (parts.length === 0) return null;

  return (
    <p className="mt-6 rounded-sm border border-line bg-sunken px-4 py-3 text-sm text-muted">
      <span className="font-medium text-fg">Desde tu última visita:</span> {parts.join(' · ')}
    </p>
  );
}

// ---------------------------------------------------------------------------
// P1 · Necesita tu atención
// ---------------------------------------------------------------------------

/** Cómo se anuncia cada motivo. El texto dice el estado, no lo insinúa. */
const REASON_LABEL: Record<AttentionReason, string> = {
  needs_changes: 'Requiere cambios',
  overdue: 'Vencida',
  due_today: 'Entrega hoy',
  due_soon: 'Vence pronto',
  in_progress: 'En progreso',
  new: 'Nueva actividad',
  upcoming: 'Programada',
  no_deadline: 'Sin fecha límite',
  closed: 'Entrega cerrada',
};

/** Los motivos que se marcan en acento. El resto es información, no urgencia. */
const URGENT: ReadonlySet<AttentionReason> = new Set(['needs_changes', 'overdue', 'due_today']);

function StudentAttention({ items, show }: { items: AttentionItem[]; show: boolean }) {
  if (!show) return null;

  if (items.length === 0) {
    return (
      <section aria-labelledby="atencion" className="mt-10">
        <h2 id="atencion" className="section-mark font-display text-h2">
          Necesita tu atención
        </h2>
        <p className="mt-4 rounded-sm border border-line bg-sunken px-4 py-5">
          <span className="block font-medium">Todo al día</span>
          <span className="mt-1 block text-sm text-muted">
            No tienes actividades pendientes. Abajo está lo que se ha publicado.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="atencion" className="mt-10">
      <h2 id="atencion" className="section-mark font-display text-h2">
        Necesita tu atención
      </h2>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <AttentionCard key={item.assignmentId} item={item} />
        ))}
      </ul>
    </section>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const urgent = URGENT.has(item.reason);
  const closed = item.reason === 'closed';
  const due = formatDueLabel(item);
  const steps = progressLabel(item.progress);

  return (
    <li className={`panel p-4 ${urgent ? 'border-accent' : ''}`}>
      <p className="flex flex-wrap items-center gap-2 text-label">
        <span className={urgent ? 'font-medium text-accent' : 'text-subtle'}>
          {REASON_LABEL[item.reason]}
        </span>
        <span className="text-subtle">· {item.courseName}</span>
      </p>

      <p className="mt-1.5 font-medium">{item.title}</p>

      <p className="mt-1 text-sm text-muted">
        {due && (
          <span>
            {closed ? 'Cerró el' : 'Entrega'} {due}
          </span>
        )}
        {due && steps && ' · '}
        {steps}
      </p>

      <div className="mt-3">
        {closed ? (
          // No se ofrece entregar lo que ya no admite entrega. La barrera real
          // está en el servidor; esto evita que alguien trabaje para nada.
          <Link
            href={`/aula/${item.courseId}/tareas/${item.assignmentId}`}
            className="btn btn-secondary btn-sm"
          >
            Ver la actividad
          </Link>
        ) : (
          <Link
            href={`/aula/${item.courseId}/tareas/${item.assignmentId}`}
            className={`btn btn-sm ${urgent ? 'btn-primary' : 'btn-secondary'}`}
          >
            {attentionCta(item)}
          </Link>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// P4 · Requiere tu atención (profesorado)
// ---------------------------------------------------------------------------

function TeacherAttention({ tasks, show }: { tasks: TeacherTask[]; show: boolean }) {
  if (!show) return null;

  if (tasks.length === 0) {
    return (
      <section aria-labelledby="requiere" className="mt-10">
        <h2 id="requiere" className="section-mark font-display text-h2">
          Requiere tu atención
        </h2>
        <p className="mt-4 rounded-sm border border-line bg-sunken px-4 py-5">
          <span className="block font-medium">Nada pendiente</span>
          <span className="mt-1 block text-sm text-muted">
            No tienes entregas por revisar ni aportaciones por aprobar.
          </span>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="requiere" className="mt-10">
      <h2 id="requiere" className="section-mark font-display text-h2">
        Requiere tu atención
      </h2>
      <ul className="mt-5 space-y-3">
        {tasks.map((task) => (
          <TeacherTaskCard key={`${task.kind}:${task.courseId}:${task.assignmentId ?? ''}`} task={task} />
        ))}
      </ul>
    </section>
  );
}

function TeacherTaskCard({ task }: { task: TeacherTask }) {
  const closing = task.kind === 'closing';

  const headline =
    task.kind === 'review'
      ? `${task.count} ${task.count === 1 ? 'entrega nueva' : 'entregas nuevas'}`
      : task.kind === 'moderation'
        ? `${task.count} ${task.count === 1 ? 'aportación pendiente' : 'aportaciones pendientes'}`
        : task.kind === 'publication'
          ? `${task.count} ${task.count === 1 ? 'publicación pendiente' : 'publicaciones pendientes'}`
          : `Cierra el ${formatDueLabel(task)}`;

  // Una publicación se aprueba en el muro, no dentro de la materia: el enlace
  // baja a la lista que ya está en esta misma pantalla.
  const href =
    task.kind === 'publication'
      ? '#publication-moderation'
      : task.kind === 'moderation'
        ? `/aula/${task.courseId}?tab=resources`
        : `/aula/${task.courseId}/tareas/${task.assignmentId}`;

  const cta =
    task.kind === 'closing' ? 'Ver el progreso' : 'Revisar';

  return (
    <li className={`panel p-4 ${closing ? 'border-accent' : ''}`}>
      <p className="flex flex-wrap items-center gap-2 text-label">
        <span className={closing ? 'font-medium text-accent' : 'text-subtle'}>{headline}</span>
        <span className="text-subtle">· {task.courseName}</span>
      </p>

      <p className="mt-1.5 font-medium">{task.title}</p>

      {task.audience !== null && task.submitted !== null && (
        <p className="mt-1 text-sm text-muted tabular-nums">
          {task.submitted} de {task.audience} entregaron
          {task.audience - task.submitted > 0 && ` · ${task.audience - task.submitted} pendientes`}
        </p>
      )}

      <div className="mt-3">
        <Link href={href} className={`btn btn-sm ${closing ? 'btn-primary' : 'btn-secondary'}`}>
          {cta}
        </Link>
      </div>
    </li>
  );
}

const EVENT_VERB: Record<FeedEventKind, string> = {
  assignment: 'Publicó una actividad',
  announcement: 'Compartió un aviso',
  prompt: 'Publicó un prompt',
  skill: 'Publicó una Skill',
  resource: 'Añadió un recurso',
  project: 'Publicó un proyecto',
};

function FeedSection({
  id,
  title,
  events,
  empty,
  courses,
}: {
  id: string;
  title: string;
  events: FeedEvent[];
  empty: string;
  courses: HomePayload['courses'];
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="section-mark font-display text-h2">
        {title}
      </h2>

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {events.map((event) => (
            <FeedCard key={event.id} event={event} courses={courses} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Una tarjeta del muro: quién, qué, sobre qué, cuándo y qué hacer.
 *
 * Compacta a propósito. Se escanea de arriba abajo y no hay nada que pulsar
 * salvo el enlace al objeto real: no hay «me gusta», ni comentarios, ni
 * contador de vistas. Un aula no necesita métricas de popularidad para estar
 * viva; necesita que se vea lo que la gente publica.
 */
function FeedCard({ event, courses }: { event: FeedEvent; courses: HomePayload['courses'] }) {
  const [viewing, setViewing] = useState(false);
  return (
    <li className="panel p-4">
      <div className="flex items-start gap-3">
        {event.actor && (
          <span className="mt-0.5 shrink-0">
            <UserAvatar name={event.actor.displayName} src={event.actor.avatarUrl} size={30} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-label text-subtle">
            {event.actor ? (
              <>
                <span className="font-medium text-fg">{event.actor.displayName}</span>
                {event.actor.handle && (
                  <span className="font-mono"> @{event.actor.handle}</span>
                )}
                {' · '}
              </>
            ) : null}
            {relativeTime(event.at)}
            {event.courseName && ` · ${event.courseName}`}
          </p>

          <p className="mt-1 text-sm text-muted">{EVENT_VERB[event.kind]}</p>
          <p className="mt-0.5 font-medium">{event.title}</p>

          {event.summary && (
            <p className="mt-1 line-clamp-2 text-sm text-muted">{event.summary}</p>
          )}

          {/* Una página compartida se enseña, no se menciona. Sin portada la
              tarjeta sería una línea de texto entre otras y nadie sabría que
              hay una interfaz al otro lado del botón; cuando el proyecto no
              subió captura se dibuja la misma portada generada de la galería,
              que al menos distingue una página de otra. */}
          {event.kind === 'project' && (
            <a
              href={event.href}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              aria-hidden="true"
              className="mt-3 block aspect-16/10 overflow-hidden rounded-sm border border-line bg-surface"
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
            </a>
          )}

          <div className="mt-3">
            {event.publicationId ? (
              <button type="button" onClick={() => setViewing(true)} className="btn btn-secondary btn-sm">{event.ctaLabel}</button>
            ) : (
              <Link href={event.href} className="btn btn-secondary btn-sm">{event.ctaLabel}</Link>
            )}
            {event.approvedByName && <p className="mt-2 text-label text-subtle">Aprobado por {event.approvedByName}</p>}
            {viewing && event.publicationId && <PublicationDetail id={event.publicationId} courses={courses} onClose={() => setViewing(false)} />}
          </div>
        </div>
      </div>
    </li>
  );
}
