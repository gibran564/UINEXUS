'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // El detalle técnico va a la consola del servidor, no a la cara del usuario.
    console.error('[uinexus]', error);
  }, [error]);

  return (
    <div className="container-page py-24">
      <div className="mx-auto max-w-lg text-center">
        <p className="meta">Algo se rompió</p>
        <h1 className="mt-3 font-display text-h1">No pudimos cargar esta página</h1>
        <p className="mt-4 text-muted">
          El fallo es nuestro, no tuyo. Si acabas de publicar algo, tus archivos están a salvo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            Reintentar
          </button>
          <Link href="/" className="btn btn-secondary">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
