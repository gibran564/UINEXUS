import Link from 'next/link';

/**
 * Estado vacío. Nunca es sólo "no hay nada": dice qué pasó, por qué, y cuál
 * es el siguiente paso. El dibujo es la misma retícula de la marca, vacía.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="panel flex flex-col items-center px-6 py-14 text-center">
      <svg viewBox="0 0 64 44" width="72" height="50" fill="none" aria-hidden="true" className="mb-5">
        <rect x="0.5" y="0.5" width="63" height="43" rx="2" stroke="var(--border-strong)" />
        <path
          d="M21 .5v43M43 .5v43M.5 15h63M.5 29h63"
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
        <rect x="22" y="16" width="20" height="12" fill="var(--accent-soft)" />
      </svg>
      <h2 className="font-display text-h3">{title}</h2>
      <p className="mt-2 max-w-md text-muted">{description}</p>
      {action && (
        <Link href={action.href} className="btn btn-primary mt-6">
          {action.label}
        </Link>
      )}
    </div>
  );
}
