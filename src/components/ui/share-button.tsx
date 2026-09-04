'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyField } from './copy-field';

/**
 * Compartir = copiar un enlace. Nada más, salvo el código QR, que sí resuelve
 * un problema real: proyectar la pantalla en clase y que la gente lo abra
 * desde su teléfono sin teclear nada.
 *
 * El QR se genera bajo demanda (import dinámico): no cuesta nada a quien
 * nunca lo abre.
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrState, setQrState] = useState<'idle' | 'loading' | 'error'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function showQr(): Promise<void> {
    if (qr) return;
    setQrState('loading');
    try {
      const { toDataURL } = await import('qrcode');
      setQr(
        await toDataURL(url, { width: 512, margin: 1, color: { dark: '#191a1c', light: '#ffffff' } })
      );
      setQrState('idle');
    } catch {
      setQrState('error');
    }
  }

  async function shareNative(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* La persona canceló: abrimos el panel normal. */
      }
    }
    setOpen(true);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => void shareNative()}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <path
            d="M8 10.5V2m0 0L5.2 4.8M8 2l2.8 2.8M3 9.5v3.2c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3V9.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Compartir
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Compartir ${title}`}
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2.5rem))] rounded-md border border-line bg-raised p-4"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <CopyField value={url} label="Enlace del proyecto" />

          <div className="mt-3 border-t border-line pt-3">
            {!qr && (
              <button
                type="button"
                onClick={() => void showQr()}
                className="btn btn-ghost btn-sm w-full justify-start px-2"
                aria-busy={qrState === 'loading'}
              >
                {qrState === 'loading' ? 'Generando código QR…' : 'Mostrar código QR'}
              </button>
            )}
            {qrState === 'error' && (
              <p className="text-sm text-danger">
                No se pudo generar el código QR. El enlace de arriba sigue funcionando.
              </p>
            )}
            {qr && (
              <figure className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`Código QR que abre ${url}`}
                  width={176}
                  height={176}
                  className="mx-auto rounded-sm border border-line bg-white p-2"
                />
                <figcaption className="hint">Útil para proyectarlo en clase.</figcaption>
              </figure>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
