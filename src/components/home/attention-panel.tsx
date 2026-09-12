'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { formatDueLabel } from '@/lib/due-date';
import {
  attentionBuckets,
  progressLabel,
  REASON_LABEL,
  teacherTaskBuckets,
  type Bucket,
  type AttentionItem,
  type AttentionReason,
  type TeacherTask,
  type TeacherTaskKind,
} from '@/lib/home-feed';

/**
 * Lo que hay que hacer, con sus contadores.
 *
 * Vivía en el carril de contexto, recortado a tres filas. Ahora ocupa la
 * columna principal, que es donde va lo que decide la próxima hora de alguien:
 * el carril se quedó con lo que de verdad es contexto —quién eres y en qué
 * materias estás— y esto dejó de competir por 280 px con la lista de materias.
 *
 * ## Los contadores son filtros, no marcadores
 *
 * Es la única forma de contador que se admite aquí. Un número que se pulsa y
 * recorta la lista es un control: sirve para responder «enséñame sólo lo que
 * vence hoy». Un número que sólo se mira —«prácticas: 2», «materias: 3»— habla
 * del pasado de quien lo lee, que ya lo conoce, y ocupa el sitio de una entrega
 * que cierra esta tarde.
 *
 * Por eso no se inventa vocabulario: cada contador es un MOTIVO de los que ya
 * calcula `home-feed`, con su etiqueta de siempre. Y aparecen en el orden en
 * que llegan los elementos, que ya viene ordenado por urgencia desde el
 * servidor: lo que cierra antes, antes.
 */

/** Los motivos que se marcan en acento. El resto es información, no urgencia. */
const URGENT: ReadonlySet<AttentionReason> = new Set(['needs_changes', 'overdue', 'due_today']);

/** Cuántas filas se pintan antes de pedir que se desplieguen las demás. */
const PANEL_LIMIT = 5;

/**
 * El contador activo. `all` es el estado normal, y cualquier otro valor es un
 * motivo del alumnado o una clase de pendiente del profesorado.
 *
 * Es UNO para las dos listas a propósito: quien da clase y además cursa ve dos
 * bloques, y dos filtros activos a la vez en la misma pantalla obligan a
 * recordar cuál se aplicó a cuál. Cada lista sólo atiende a los valores de su
 * propio vocabulario y pasa de los ajenos —ver `Focus`—, así que pulsar «Por
 * revisar» nunca deja vacía la lista del alumnado.
 */
export type Focus = 'all' | AttentionReason | TeacherTaskKind;

function isReason(focus: Focus, items: AttentionItem[]): focus is AttentionReason {
  return items.some((item) => item.reason === focus);
}

function isKind(focus: Focus, tasks: TeacherTask[]): focus is TeacherTaskKind {
  return tasks.some((task) => task.kind === focus);
}

// ---------------------------------------------------------------------------
// P1 · Necesita tu atención
// ---------------------------------------------------------------------------

export function StudentAttention({
  items,
  show,
  focus,
  onFocusChange,
}: {
  items: AttentionItem[];
  show: boolean;
  focus: Focus;
  onFocusChange: (focus: Focus) => void;
}) {
  const [all, setAll] = useState(false);
  if (!show) return null;

  if (items.length === 0) {
    return (
      <PanelSection id="atencion" title="Necesita tu atención">
        <p className="rounded-sm border border-line bg-sunken px-3.5 py-3.5">
          <span className="block text-sm font-medium">Todo al día</span>
          <span className="mt-0.5 block text-label text-subtle">
            No tienes actividades pendientes.
          </span>
        </p>
      </PanelSection>
    );
  }

  const active = isReason(focus, items) ? focus : 'all';
  const matching = active === 'all' ? items : items.filter((item) => item.reason === active);
  const shown = all ? matching : matching.slice(0, PANEL_LIMIT);

  return (
    <PanelSection id="atencion" title="Necesita tu atención">
      <Counters
        label="Filtrar lo que necesita tu atención"
        total={items.length}
        buckets={attentionBuckets(items)}
        active={active}
        onChange={(next) => {
          onFocusChange(next);
          setAll(false);
        }}
      />

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((item) => (
          <AttentionRow key={item.assignmentId} item={item} />
        ))}
      </ul>

      <MoreButton total={matching.length} shown={shown.length} onShowAll={() => setAll(true)} />
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// P4 · Requiere tu atención (profesorado)
// ---------------------------------------------------------------------------

export function TeacherAttention({
  tasks,
  show,
  focus,
  onFocusChange,
}: {
  tasks: TeacherTask[];
  show: boolean;
  focus: Focus;
  onFocusChange: (focus: Focus) => void;
}) {
  const [all, setAll] = useState(false);
  if (!show) return null;

  if (tasks.length === 0) {
    return (
      <PanelSection id="requiere" title="Requiere tu atención">
        <p className="rounded-sm border border-line bg-sunken px-3.5 py-3.5">
          <span className="block text-sm font-medium">Nada pendiente</span>
          <span className="mt-0.5 block text-label text-subtle">
            No tienes entregas por revisar ni aportaciones por aprobar.
          </span>
        </p>
      </PanelSection>
    );
  }

  const active = isKind(focus, tasks) ? focus : 'all';
  const matching = active === 'all' ? tasks : tasks.filter((task) => task.kind === active);
  const shown = all ? matching : matching.slice(0, PANEL_LIMIT);

  return (
    <PanelSection id="requiere" title="Requiere tu atención">
      <Counters
        label="Filtrar lo que requiere tu atención"
        total={tasks.length}
        buckets={teacherTaskBuckets(tasks)}
        active={active}
        onChange={(next) => {
          onFocusChange(next);
          setAll(false);
        }}
      />

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((task) => (
          <TeacherTaskRow
            key={`${task.kind}:${task.courseId}:${task.assignmentId ?? ''}`}
            task={task}
          />
        ))}
      </ul>

      <MoreButton total={matching.length} shown={shown.length} onShowAll={() => setAll(true)} />
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Los contadores
// ---------------------------------------------------------------------------

function Counters({
  label,
  total,
  buckets,
  active,
  onChange,
}: {
  label: string;
  total: number;
  buckets: Bucket<AttentionReason>[] | Bucket<TeacherTaskKind>[];
  active: Focus;
  onChange: (focus: Focus) => void;
}) {
  // `attentionBuckets` y `teacherTaskBuckets` ya devuelven la lista vacía
  // cuando hay un solo grupo: un contador que no filtra nada no se pinta.
  if (buckets.length === 0) return null;

  return (
    <div role="group" aria-label={label} className="tab-row">
      <button
        type="button"
        className="chip"
        aria-pressed={active === 'all'}
        onClick={() => onChange('all')}
      >
        Todo <span className="ml-1.5 tabular-nums text-subtle">{total}</span>
      </button>

      {buckets.map((bucket) => (
        <button
          key={bucket.key}
          type="button"
          className="chip"
          aria-pressed={active === bucket.key}
          onClick={() => onChange(bucket.key as Focus)}
        >
          {bucket.label} <span className="ml-1.5 tabular-nums text-subtle">{bucket.count}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Las filas
// ---------------------------------------------------------------------------

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
    <PanelRow urgent={urgent}>
      <p className="text-label">
        <span className={urgent ? 'font-medium text-accent' : 'text-subtle'}>
          {REASON_LABEL[item.reason]}
        </span>
        <span className="text-subtle"> · {item.courseName}</span>
      </p>

      <p className="mt-0.5 text-sm font-medium">
        {/* No se ofrece entregar lo que ya no admite entrega: la fila lleva a la
            actividad y la barrera real sigue estando en el servidor. */}
        <PanelLink href={`/aula/${item.courseId}/tareas/${item.assignmentId}`}>
          {item.title}
        </PanelLink>
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
    </PanelRow>
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
    <PanelRow urgent={closing}>
      <p className="text-label">
        <span className={closing ? 'font-medium text-accent' : 'text-subtle'}>{headline}</span>
        <span className="text-subtle"> · {task.courseName}</span>
      </p>

      <p className="mt-0.5 text-sm font-medium">
        <PanelLink href={href}>{task.title}</PanelLink>
      </p>

      {task.audience !== null && task.submitted !== null && (
        <p className="mt-0.5 text-label text-subtle tabular-nums">
          {task.submitted} de {task.audience} entregaron
          {task.audience - task.submitted > 0 && ` · ${task.audience - task.submitted} pendientes`}
        </p>
      )}
    </PanelRow>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function PanelSection({
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

function PanelRow({ urgent, children }: { urgent: boolean; children: ReactNode }) {
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

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
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
