'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { HomePayload } from '@/app/api/home/route';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatDueLabel } from '@/lib/due-date';
import {
  progressLabel,
  type AttentionItem,
  type AttentionReason,
  type TeacherTask,
} from '@/lib/home-feed';

/**
 * El carril de contexto: quién eres, qué te toca y en qué materias estás.
 *
 * A partir de 1024 px es una columna fija de 280 px pegada al lado del muro. Por
 * debajo no se comprime: se transforma en una tira sobre el muro —dos columnas
 * en tablet, una en móvil— y la identidad desaparece, porque ya está en el
 * avatar del navbar y en ese ancho no aporta nada.
 *
 * Sólo se enseñan tres pendientes; el resto se despliega aquí mismo. Un carril
 * con once tarjetas deja de ser contexto y se convierte en otra lista que
 * compite con el muro.
 */
export function WallRail({
  displayName,
  handle,
  avatarUrl,
  role,
  courses,
  attention,
  teacherTasks,
  teacherFirst,
  studiesSomewhere,
  teachesSomewhere,
}: {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  role: HomePayload['role'];
  courses: HomePayload['courses'];
  attention: AttentionItem[];
  teacherTasks: TeacherTask[];
  /** Quien da clase y además cursa ve primero lo suyo de docente. */
  teacherFirst: boolean;
  studiesSomewhere: boolean;
  teachesSomewhere: boolean;
}) {
  const mine = <StudentAttention items={attention} show={studiesSomewhere} />;
  const theirs = <TeacherAttention tasks={teacherTasks} show={teachesSomewhere} />;

  return (
    <div className="flex flex-col gap-6">
      <Identity displayName={displayName} handle={handle} avatarUrl={avatarUrl} role={role} />

      {teacherFirst ? (
        <>
          {theirs}
          {mine}
        </>
      ) : (
        <>
          {mine}
          {theirs}
        </>
      )}

      <CourseList courses={courses} />
    </div>
  );
}

const ROLE_LABEL: Record<HomePayload['role'], string> = {
  student: 'Estudiante',
  teacher: 'Docente',
  admin: 'Administración',
};

/** Sólo en escritorio: por debajo, el avatar del navbar ya dice quién eres. */
function Identity({
  displayName,
  handle,
  avatarUrl,
  role,
}: {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  role: HomePayload['role'];
}) {
  if (!displayName) return null;

  return (
    <div className="panel hidden items-center gap-3 p-4 lg:flex">
      <UserAvatar name={displayName} src={avatarUrl} size={40} />
      <div className="min-w-0">
        <p className="truncate font-medium">{displayName}</p>
        <p className="truncate text-label text-subtle">
          {handle && <span className="font-mono">@{handle}</span>}
          {handle && ' · '}
          {ROLE_LABEL[role]}
        </p>
      </div>
    </div>
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

/** Lo que cabe en el carril sin convertirlo en una segunda lista. */
const RAIL_LIMIT = 3;

export function StudentAttention({ items, show }: { items: AttentionItem[]; show: boolean }) {
  const [all, setAll] = useState(false);
  if (!show) return null;

  if (items.length === 0) {
    return (
      <RailSection id="atencion" title="Necesita tu atención">
        <p className="rounded-sm border border-line bg-sunken px-3.5 py-3.5">
          <span className="block text-sm font-medium">Todo al día</span>
          <span className="mt-0.5 block text-label text-subtle">
            No tienes actividades pendientes.
          </span>
        </p>
      </RailSection>
    );
  }

  const shown = all ? items : items.slice(0, RAIL_LIMIT);

  return (
    <RailSection id="atencion" title="Necesita tu atención">
      <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-1">
        {shown.map((item) => (
          <AttentionRow key={item.assignmentId} item={item} />
        ))}
      </ul>
      <MoreButton total={items.length} shown={shown.length} onShowAll={() => setAll(true)} />
    </RailSection>
  );
}

// ---------------------------------------------------------------------------
// P4 · Requiere tu atención (profesorado)
// ---------------------------------------------------------------------------

export function TeacherAttention({ tasks, show }: { tasks: TeacherTask[]; show: boolean }) {
  const [all, setAll] = useState(false);
  if (!show) return null;

  if (tasks.length === 0) {
    return (
      <RailSection id="requiere" title="Requiere tu atención">
        <p className="rounded-sm border border-line bg-sunken px-3.5 py-3.5">
          <span className="block text-sm font-medium">Nada pendiente</span>
          <span className="mt-0.5 block text-label text-subtle">
            No tienes entregas por revisar ni aportaciones por aprobar.
          </span>
        </p>
      </RailSection>
    );
  }

  const shown = all ? tasks : tasks.slice(0, RAIL_LIMIT);

  return (
    <RailSection id="requiere" title="Requiere tu atención">
      <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-1">
        {shown.map((task) => (
          <TeacherTaskRow key={`${task.kind}:${task.courseId}:${task.assignmentId ?? ''}`} task={task} />
        ))}
      </ul>
      <MoreButton total={tasks.length} shown={shown.length} onShowAll={() => setAll(true)} />
    </RailSection>
  );
}

/**
 * Cada fila es un enlace entero, estirado desde el título. Ni un botón por
 * tarjeta ni dos objetivos por fila: el motivo ya dice qué urgencia tiene y la
 * pantalla de la actividad dice qué hacer.
 */
function AttentionRow({ item }: { item: AttentionItem }) {
  const urgent = URGENT.has(item.reason);
  const closed = item.reason === 'closed';
  const due = formatDueLabel(item);
  const steps = progressLabel(item.progress);

  return (
    <RailRow urgent={urgent}>
      <p className="text-label">
        <span className={urgent ? 'font-medium text-accent' : 'text-subtle'}>
          {REASON_LABEL[item.reason]}
        </span>
        <span className="text-subtle"> · {item.courseName}</span>
      </p>

      <p className="mt-0.5 text-sm font-medium">
        {/* No se ofrece entregar lo que ya no admite entrega: la fila lleva a la
            actividad y la barrera real sigue estando en el servidor. */}
        <RailLink href={`/aula/${item.courseId}/tareas/${item.assignmentId}`}>
          {item.title}
        </RailLink>
      </p>

      {(due || steps) && (
        <p className="mt-0.5 text-label text-subtle">
          {due && (
            <span>
              {closed ? 'Cerró el' : 'Entrega'} {due}
            </span>
          )}
          {due && steps && ' · '}
          {steps}
        </p>
      )}
    </RailRow>
  );
}

function TeacherTaskRow({ task }: { task: TeacherTask }) {
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

  return (
    <RailRow urgent={closing}>
      <p className="text-label">
        <span className={closing ? 'font-medium text-accent' : 'text-subtle'}>{headline}</span>
        <span className="text-subtle"> · {task.courseName}</span>
      </p>

      <p className="mt-0.5 text-sm font-medium">
        <RailLink href={href}>{task.title}</RailLink>
      </p>

      {task.audience !== null && task.submitted !== null && (
        <p className="mt-0.5 text-label text-subtle tabular-nums">
          {task.submitted} de {task.audience} entregaron
          {task.audience - task.submitted > 0 && ` · ${task.audience - task.submitted} pendientes`}
        </p>
      )}
    </RailRow>
  );
}

// ---------------------------------------------------------------------------
// Piezas del carril
// ---------------------------------------------------------------------------

function RailSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="meta">
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function RailRow({ urgent, children }: { urgent: boolean; children: ReactNode }) {
  return (
    <li
      className={`panel relative p-3 transition-colors focus-within:border-accent ${
        urgent ? 'border-accent' : 'hover:border-line-strong'
      }`}
    >
      {children}
    </li>
  );
}

function RailLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="after:absolute after:inset-0 after:content-[''] hover:underline">
      {children}
    </Link>
  );
}

/** Nada se esconde detrás de otra pantalla: el resto se despliega aquí. */
function MoreButton({
  total,
  shown,
  onShowAll,
}: {
  total: number;
  shown: number;
  onShowAll: () => void;
}) {
  if (shown >= total) return null;

  return (
    <button type="button" onClick={onShowAll} className="btn btn-ghost btn-sm mt-2">
      Ver {total === 1 ? 'la' : 'las'} {total}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tus materias
// ---------------------------------------------------------------------------

/**
 * La lista de materias es navegación, no filtro: el filtro del muro vive sobre
 * el muro. En móvil no aparece —está en el navbar y en `/aula`— para que la
 * primera pantalla sea lo que hay que hacer y lo que se publicó.
 */
function CourseList({ courses }: { courses: HomePayload['courses'] }) {
  if (courses.length === 0) return null;

  return (
    <section aria-labelledby="tus-materias" className="hidden lg:block">
      <h2 id="tus-materias" className="meta">
        Tus materias
      </h2>
      <ul className="mt-2.5 space-y-0.5">
        {courses.map((course) => (
          <li key={course.id}>
            <Link
              href={`/aula/${course.id}`}
              className="flex min-h-9 items-center gap-2 rounded-xs px-2 text-sm text-muted hover:bg-sunken hover:text-fg"
            >
              <span className="truncate">{course.name}</span>
              {course.role === 'teacher' && (
                <span className="ml-auto shrink-0 text-label text-subtle">Docente</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
