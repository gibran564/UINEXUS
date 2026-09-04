import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Entra a UINexus para publicar y administrar tus proyectos.',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-sm">
        {/* useSearchParams necesita un límite de Suspense para poder
            prerenderizar el resto de la página. */}
        <Suspense fallback={<p className="py-10 text-center text-muted">Cargando…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
