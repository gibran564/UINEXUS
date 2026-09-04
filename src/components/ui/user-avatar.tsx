/* eslint-disable @next/next/no-img-element */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Avatar con respaldo de iniciales. El `alt` va vacío cuando el nombre ya
 * aparece al lado: repetirlo sólo añade ruido en el lector de pantalla.
 */
export function UserAvatar({
  name,
  src,
  size = 32,
  labelled = false,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /** true si el nombre NO aparece junto al avatar y hace falta anunciarlo. */
  labelled?: boolean;
}) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) };

  if (src) {
    return (
      <img
        src={src}
        alt={labelled ? name : ''}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="shrink-0 rounded-full border border-line object-cover"
        style={style}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-sunken font-medium text-muted"
      style={style}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? name : undefined}
    >
      {initials(name) || '·'}
    </span>
  );
}
