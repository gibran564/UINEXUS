'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Botón de copiar con confirmación audible.
 *
 * El resultado se anuncia en una región `aria-live` porque, sin eso, quien usa
 * lector de pantalla no tiene forma de saber si se copió: el único cambio es un
 * texto que aparece medio segundo. Y si el portapapeles falla —contexto no
 * seguro, permiso denegado— se dice, en vez de fingir que funcionó.
 *
 * Es la misma disciplina que ya aplica `CopyField` a los enlaces de proyecto;
 * aquí en formato botón porque lo que se copia puede ser un prompt de veinte
 * líneas que no cabe en un `<input>`.
 */
export function CopyButton({
  value,
  label = 'Copiar',
  variant = 'secondary',
}: {
  value: string;
  label?: string;
  variant?: 'secondary' | 'ghost';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 3000);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className={`btn btn-${variant} btn-sm`}
      >
        {state === 'copied' ? 'Copiado' : label}
      </button>
      <span role="status" aria-live="polite" className="text-label text-muted">
        {state === 'copied' && 'Copiado al portapapeles.'}
        {state === 'failed' && 'No pudimos copiarlo. Selecciona el texto y usa Ctrl+C.'}
      </span>
    </span>
  );
}
