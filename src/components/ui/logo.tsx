import React from 'react';

/**
 * Marca UINexus.
 *
 * El símbolo es un nodo de retícula: cuatro celdas y un punto de cruce
 * resaltado. Es la misma idea que la textura del fondo — el lugar donde se
 * cruzan los trabajos — sin caer en la ilustración de red neuronal.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.5V22.5M15 1.5V22.5M1.5 9H22.5M1.5 15H22.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <rect x="9" y="9" width="6" height="6" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span
        className="font-display font-medium tracking-[-0.02em]"
        style={{ fontSize: `${size * 0.92}px` }}
      >
        UINexus
      </span>
    </span>
  );
}
