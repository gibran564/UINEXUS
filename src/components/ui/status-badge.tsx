import type { ProjectStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/constants';

const STYLES: Record<ProjectStatus, { dot: string; text: string; border: string }> = {
  published: { dot: 'bg-success', text: 'text-success', border: 'border-success/35' },
  unlisted: { dot: 'bg-warning', text: 'text-warning', border: 'border-warning/40' },
  draft: { dot: 'bg-subtle', text: 'text-muted', border: 'border-line-strong' },
  archived: { dot: 'bg-subtle', text: 'text-subtle', border: 'border-line' },
};

/**
 * El estado nunca se comunica sólo con color (WCAG 1.4.1): el punto va
 * acompañado siempre del texto, y cada estado tiene además su propia forma
 * de decirse en palabras.
 */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-xs border px-2 text-label ${style.border} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
