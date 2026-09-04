'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_TYPE_LABEL,
  SUBMISSION_STATUS_LABEL,
} from '@/lib/constants';
import type { AssignmentStatus, AssignmentType, SubmissionStatus } from '@/lib/types';

/**
 * Piezas compartidas del aula.
 *
 * Son deliberadamente pocas y pequeñas. La tentación en una plataforma
 * académica es inventar un sistema de componentes nuevo; aquí se reutilizan las
 * clases que ya existen en `globals.css` (`panel`, `field`, `chip`, `btn`,
 * `meta`) para que el aula se vea como el resto de UINexus y no como un
 * producto pegado al lado.
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

const SUBMISSION_STYLES: Record<SubmissionStatus, string> = {
  draft: 'border-line-strong text-muted',
  submitted: 'border-accent/40 text-accent',
  reviewed: 'border-success/35 text-success',
  needs_changes: 'border-warning/40 text-warning',
};

const SUBMISSION_DOTS: Record<SubmissionStatus, string> = {
  draft: 'bg-subtle',
  submitted: 'bg-accent',
  reviewed: 'bg-success',
  needs_changes: 'bg-warning',
};

/**
 * El estado nunca se dice sólo con color (WCAG 1.4.1): el punto siempre va con
 * su palabra. Es el mismo criterio que `StatusBadge` aplica a los proyectos.
 */
export function SubmissionBadge({ status }: { status: SubmissionStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-xs border border-line px-2 text-label text-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-subtle" aria-hidden="true" />
        Sin entregar
      </span>
    );
  }

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-xs border px-2 text-label ${SUBMISSION_STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${SUBMISSION_DOTS[status]}`} aria-hidden="true" />
      {SUBMISSION_STATUS_LABEL[status]}
    </span>
  );
}

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const style =
    status === 'published'
      ? 'border-success/35 text-success'
      : status === 'closed'
        ? 'border-line-strong text-subtle'
        : 'border-warning/40 text-warning';

  return (
    <span className={`inline-flex h-6 items-center rounded-xs border px-2 text-label ${style}`}>
      {ASSIGNMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function TypeChip({ type }: { type: AssignmentType }) {
  return <span className="tag">{ASSIGNMENT_TYPE_LABEL[type]}</span>;
}

// ---------------------------------------------------------------------------
// Envoltorio de pantalla
// ---------------------------------------------------------------------------

/**
 * Carcasa de cualquier pantalla del aula.
 *
 * Concentra los tres estados que TODAS comparten —cargando, sin sesión, error—
 * para que ninguna pantalla se los invente por su cuenta y para que «no has
 * iniciado sesión» no se confunda nunca con «no tienes permiso»: son dos cosas
 * distintas y llevan a sitios distintos.
 */
export function AulaScreen({
  state,
  error,
  next,
  children,
}: {
  state: 'loading' | 'ready' | 'error';
  error?: string | null;
  next: string;
  children: ReactNode;
}) {
  const { status } = useAuth();

  if (status === 'loading' || (state === 'loading' && status === 'authenticated')) {
    return <p className="py-16 text-center text-muted">Cargando…</p>;
  }

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h2 className="font-display text-h2">Entra para ver tu aula</h2>
        <p className="mt-3 text-muted">
          Aquí están tus materias, tus tareas y tus entregas.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="btn btn-primary btn-lg mt-6 w-full"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h2 className="font-display text-h3">No pudimos abrir esto</h2>
        <p className="mt-3 text-muted">{error ?? 'Vuelve a intentarlo en un momento.'}</p>
        <Link href="/aula" className="btn btn-secondary mt-6">
          Volver al aula
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Piezas de composición
// ---------------------------------------------------------------------------

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Ruta" className="flex flex-wrap items-center gap-2 text-sm text-muted">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.href ? (
            <Link href={item.href} className="no-underline hover:text-fg">
              {item.label}
            </Link>
          ) : (
            <span className="text-fg">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="mt-1 font-display text-h2 tabular-nums">{value}</dd>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Aviso corto. `tone` decide el color; el texto siempre dice qué hacer. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
}) {
  const style =
    tone === 'error'
      ? 'border-danger/40 text-danger'
      : tone === 'success'
        ? 'border-success/35 text-success'
        : 'border-line-strong text-muted';

  return (
    <p role="status" className={`rounded-sm border px-3 py-2 text-sm ${style}`}>
      {children}
    </p>
  );
}

/** Fecha en el formato que se lee en clase, con `<time>` para la máquina. */
export function DueDate({ value }: { value: string | null }) {
  if (!value) return <span className="text-subtle">Sin fecha límite</span>;
  return (
    <time dateTime={value}>
      {new Date(`${value}T12:00:00Z`).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}
    </time>
  );
}

/** Ficha compacta de una persona: avatar, nombre y handle. */
export function MemberChip({
  handle,
  displayName,
  avatarUrl,
}: {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  return (
    <span className="flex items-center gap-2">
      <UserAvatar name={displayName} src={avatarUrl} size={26} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{displayName}</span>
        <span className="block truncate font-mono text-label text-subtle">@{handle}</span>
      </span>
    </span>
  );
}
