import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AulaHome } from '@/components/aula/aula-home';

export const metadata: Metadata = {
  title: 'Aula',
  robots: { index: false, follow: false },
};

export default function AulaPage() {
  return (
    <div className="container-page py-10">
      {/* `useSearchParams` (?crear=1) necesita un límite de Suspense para que el
          resto de la página se pueda prerrenderizar. */}
      <Suspense fallback={<p className="py-16 text-center text-muted">Cargando…</p>}>
        <AulaHome />
      </Suspense>
    </div>
  );
}
