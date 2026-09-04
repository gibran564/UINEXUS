'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Campo de sólo lectura con su botón de copiar.
 *
 * Detalles que importan:
 *  · El resultado se anuncia en una región aria-live: sin eso, quien usa
 *    lector de pantalla no sabe si se copió.
 *  · Si el portapapeles falla (contexto no seguro, permiso denegado) se
 *    selecciona el texto y se dice qué hacer, en vez de fingir que funcionó.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      inputRef.current?.select();
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 4000);
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className="field flex-1 font-mono text-sm"
        />
        <button type="button" onClick={() => void copy()} className="btn btn-secondary shrink-0">
          Copiar
        </button>
      </div>
      <p role="status" aria-live="polite" className="hint min-h-5">
        {state === 'copied' && 'Enlace copiado al portapapeles.'}
        {state === 'failed' && 'No pudimos copiarlo. El texto quedó seleccionado: usa Ctrl+C.'}
      </p>
    </div>
  );
}
