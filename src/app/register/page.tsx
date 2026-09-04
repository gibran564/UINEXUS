import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Crear cuenta institucional',
  description: 'Regístrate con tu correo @itdurango.edu.mx para publicar y compartir tus proyectos web en UINexus.',
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-sm">
        <Suspense fallback={<p className="py-10 text-center text-muted">Cargando…</p>}>
          <LoginForm initialMode="signup" />
        </Suspense>
      </div>
    </div>
  );
}
