'use client';

import { partActionLabel } from '@/lib/activity-builder';
import {
  ACTIVITY_STATE_LABEL,
  PART_STATUS_LABEL,
  PART_STATUS_MARK,
  activityProgress,
  blockedBy,
  partStatus,
  type ActivityState,
  type MissingItem,
  type PartStatus,
  type StudentWork,
} from '@/lib/student-activity';
import type { WorkflowStep } from '@/lib/types';

/**
 * «Tu trabajo»: el panorama de la actividad para quien la está haciendo.
 *
 * Es la pieza que responde a la vez a tres de las cinco preguntas del alumnado
 * —qué tengo que hacer, qué llevo, qué me falta— y por eso se pinta arriba y no
 * se pliega. Se usa en los dos sitios donde hacen falta: la ficha de la
 * actividad, donde sólo se lee, y el recorrido, donde además se navega.
 *
 * Nada de aquí dice «paso», «entregable» ni «workflow». Dice Parte, y dice qué
 * pide cada una con el mismo nombre humano que eligió quien la creó
 * (`partActionLabel`).
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

const PART_STATUS_TONE: Record<PartStatus, string> = {
  locked: 'border-line text-subtle',
  not_started: 'border-line-strong text-muted',
  in_progress: 'border-warning/40 text-warning',
  done: 'border-success/35 text-success',
};

/**
 * El estado de una Parte.
 *
 * El símbolo va `aria-hidden` y la palabra no: un lector de pantalla anuncia
 * «Completada», no «marca de verificación». Y el color nunca va solo.
 */
export function PartStatusChip({ status }: { status: PartStatus }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-xs border px-2 text-label ${PART_STATUS_TONE[status]}`}
    >
      <span aria-hidden="true">{PART_STATUS_MARK[status]}</span>
      {PART_STATUS_LABEL[status]}
    </span>
  );
}

const ACTIVITY_STATE_TONE: Record<ActivityState, string> = {
  not_started: 'border-line-strong text-muted',
  in_progress: 'border-warning/40 text-warning',
  ready: 'border-accent/40 text-accent',
  submitted: 'border-success/35 text-success',
  submitted_late: 'border-warning/40 text-warning',
  reviewed: 'border-success/35 text-success',
  needs_changes: 'border-danger/40 text-danger',
};

/** En qué punto está la actividad entera, en una palabra. */
export function ActivityStateChip({ state }: { state: ActivityState }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-xs border px-2 text-label ${ACTIVITY_STATE_TONE[state]}`}
    >
      {ACTIVITY_STATE_LABEL[state]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// El panorama
// ---------------------------------------------------------------------------

export function ProgressLine({
  parts,
  work,
}: {
  parts: readonly WorkflowStep[];
  work: StudentWork;
}) {
  const progress = activityProgress(parts, work);
  if (progress.total <= 1) return null;

  return (
    <p className="text-sm text-muted tabular-nums" role="status">
      {progress.label}
    </p>
  );
}

/**
 * La lista de Partes.
 *
 * `onOpen` decide si esto es un índice navegable o una lectura. En la ficha de
 * la actividad no se pasa: ahí todavía no se está trabajando y una lista de
 * botones que no llevan a ninguna parte sería ruido.
 *
 * Las Partes que NO le tocan a esta persona se pintan igual pero sin acción y
 * sin estado: que existan es información útil —la actividad se reparte—, pero
 * cómo las lleva otra persona no le corresponde saberlo, y el servidor tampoco
 * se lo manda (ver `toAssignment`).
 */
export function WorkOverview({
  parts,
  mine,
  work,
  activeId,
  onOpen,
}: {
  /** Todas las Partes de la actividad, en orden. */
  parts: readonly WorkflowStep[];
  /** Las que le tocan a quien mira. Lo decide el servidor (`myStepIds`). */
  mine: ReadonlySet<string>;
  work: StudentWork;
  activeId?: string | null;
  onOpen?: (partId: string) => void;
}) {
  const ownParts = parts.filter((part) => mine.has(part.id));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-h3">Tu trabajo</h2>
        <ProgressLine parts={ownParts} work={work} />
      </div>

      {ownParts.length < parts.length && (
        <p className="mt-1 text-sm text-muted">
          Esta actividad se reparte. De sus {parts.length} partes, te{' '}
          {ownParts.length === 1 ? 'toca' : 'tocan'} {ownParts.length}.
        </p>
      )}

      <ol className="mt-4 space-y-2">
        {parts.map((part, index) => {
          const isMine = mine.has(part.id);
          const status = partStatus(parts, part, work);
          const blockers = status === 'locked' ? blockedBy(parts, part, work) : [];
          const current = activeId === part.id;

          const body = (
            <>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {part.title || partActionLabel(part)}
                </span>
                <span className="block text-label text-subtle">
                  {partActionLabel(part)}
                  {!part.required && ' · opcional'}
                </span>
                {blockers.length > 0 && (
                  <span className="mt-1 block text-label text-subtle">
                    Completa primero:{' '}
                    {blockers.map((blocker, position) => (
                      <span key={blocker.id}>
                        {position > 0 && ', '}
                        «{blocker.title || partActionLabel(blocker)}»
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {isMine ? (
                <PartStatusChip status={status} />
              ) : (
                <span className="shrink-0 text-label text-subtle">La hace otra persona</span>
              )}
            </>
          );

          return (
            <li key={part.id}>
              {isMine && onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(part.id)}
                  aria-current={current ? 'step' : undefined}
                  className={`panel flex w-full flex-wrap items-center gap-3 p-3 text-left ${
                    current ? 'border-accent' : 'hover:border-line-strong'
                  }`}
                >
                  {body}
                </button>
              ) : (
                <div className="panel flex flex-wrap items-center gap-3 p-3">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lo que falta
// ---------------------------------------------------------------------------

/**
 * La lista de lo que impide entregar.
 *
 * Cada línea lleva a SU Parte. «Te faltan dos cosas» obliga a buscarlas; esto
 * no. Es también lo que se enseña cuando el servidor rechaza una entrega, para
 * que el rechazo y la lista digan lo mismo.
 */
export function MissingList({
  items,
  onOpen,
}: {
  items: readonly MissingItem[];
  onOpen?: (partId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="falta-para-entregar" className="rounded-sm border border-line-strong p-4">
      <h3 id="falta-para-entregar" className="font-display text-h3">
        Todavía falta
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.partId} className="text-sm">
            <span className="text-muted">
              {item.title}: {item.message}
            </span>
            {onOpen && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onOpen(item.partId)}
                  className="text-accent underline underline-offset-2"
                >
                  Ir a esta parte
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
