/**
 * Portada generada.
 *
 * Cuando un proyecto no tiene captura propia, la tarjeta no puede quedarse en
 * blanco ni mostrar un icono genérico repetido cien veces: la galería vive de
 * que la interfaz del alumno sea el elemento dominante. Se dibuja entonces un
 * boceto de interfaz determinista a partir del slug — siempre el mismo para el
 * mismo proyecto, distinto entre proyectos — con los filetes del sistema.
 *
 * Es decorativa: el texto alternativo real lo pone la tarjeta.
 */

type Layout = 'dashboard' | 'article' | 'mobile' | 'form' | 'gallery';

const LAYOUTS: Layout[] = ['dashboard', 'article', 'mobile', 'form', 'gallery'];

function hash(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

export function GeneratedCover({ seed, className }: { seed: string; className?: string }) {
  const code = hash(seed);
  const layout = LAYOUTS[code % LAYOUTS.length] ?? 'dashboard';
  const line = 'var(--border-strong)';
  const soft = 'var(--border)';
  const accent = 'var(--accent)';

  return (
    <svg
      viewBox="0 0 400 260"
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="400" height="260" fill="var(--surface-sunken)" />
      <g opacity="0.5">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <line
            key={`v${index}`}
            x1={index * 64 + 8}
            y1="0"
            x2={index * 64 + 8}
            y2="260"
            stroke={soft}
            strokeWidth="1"
          />
        ))}
      </g>

      {layout === 'dashboard' && (
        <g>
          <rect x="24" y="24" width="352" height="26" fill="none" stroke={line} />
          <rect x="24" y="24" width="72" height="26" fill={accent} opacity="0.9" />
          <rect x="24" y="66" width="164" height="86" fill="none" stroke={line} />
          <rect x="200" y="66" width="176" height="86" fill="none" stroke={line} />
          <rect x="40" y="118" width="18" height="22" fill={line} />
          <rect x="66" y="100" width="18" height="40" fill={line} />
          <rect x="92" y="86" width="18" height="54" fill={accent} />
          <rect x="118" y="108" width="18" height="32" fill={line} />
          <rect x="24" y="168" width="352" height="1" fill={line} />
          <rect x="24" y="184" width="352" height="1" fill={soft} />
          <rect x="24" y="204" width="352" height="1" fill={soft} />
          <rect x="24" y="224" width="230" height="1" fill={soft} />
        </g>
      )}

      {layout === 'article' && (
        <g>
          <rect x="56" y="30" width="120" height="10" fill={accent} />
          <rect x="56" y="56" width="288" height="20" fill={line} />
          <rect x="56" y="84" width="196" height="20" fill={line} />
          <rect x="56" y="126" width="288" height="1" fill={line} />
          {[0, 1, 2, 3, 4].map((index) => (
            <rect
              key={index}
              x="56"
              y={146 + index * 18}
              width={index === 4 ? 168 : 288}
              height="6"
              fill={soft}
            />
          ))}
        </g>
      )}

      {layout === 'mobile' && (
        <g>
          <rect x="150" y="20" width="100" height="220" rx="10" fill="none" stroke={line} strokeWidth="1.5" />
          <rect x="164" y="38" width="46" height="8" fill={accent} />
          <rect x="164" y="60" width="72" height="46" fill="none" stroke={soft} />
          <rect x="164" y="118" width="72" height="6" fill={soft} />
          <rect x="164" y="132" width="52" height="6" fill={soft} />
          <rect x="164" y="158" width="72" height="24" fill={accent} opacity="0.9" />
          <rect x="150" y="206" width="100" height="1" fill={line} />
          <circle cx="174" cy="223" r="4" fill={line} />
          <circle cx="200" cy="223" r="4" fill={soft} />
          <circle cx="226" cy="223" r="4" fill={soft} />
        </g>
      )}

      {layout === 'form' && (
        <g>
          <rect x="72" y="28" width="128" height="10" fill={accent} />
          {[0, 1, 2].map((index) => (
            <g key={index}>
              <rect x="72" y={62 + index * 52} width="60" height="6" fill={soft} />
              <rect x="72" y={76 + index * 52} width="256" height="26" fill="none" stroke={line} />
            </g>
          ))}
          <rect x="72" y="218" width="104" height="26" fill={accent} />
          <rect x="188" y="218" width="88" height="26" fill="none" stroke={line} />
        </g>
      )}

      {layout === 'gallery' && (
        <g>
          <rect x="28" y="26" width="96" height="8" fill={accent} />
          {[0, 1, 2].map((column) =>
            [0, 1].map((row) => (
              <rect
                key={`${column}-${row}`}
                x={28 + column * 118}
                y={52 + row * 104}
                width="106"
                height="88"
                fill="none"
                stroke={column === 1 && row === 0 ? accent : line}
                strokeWidth={column === 1 && row === 0 ? 1.5 : 1}
              />
            ))
          )}
        </g>
      )}
    </svg>
  );
}
