'use client';

import { useAuth } from '@/components/auth/auth-provider';

/**
 * Aviso honesto: sin Firebase configurado, la interfaz funciona pero nada se
 * guarda. Aparece una sola vez, arriba del todo, y no se puede cerrar: quien
 * revise la plataforma debe saber en todo momento qué es real y qué no.
 */
export function DemoBanner() {
  const { isDemo } = useAuth();
  if (!isDemo) return null;

  return (
    // <aside> y no <div>: si no, este aviso queda fuera de todo landmark y
    // un lector de pantalla no lo encuentra al recorrer las regiones.
    <aside aria-label="Estado de la plataforma" className="border-b border-warning/40 bg-warning-soft">
      <p className="container-page py-2 text-sm text-fg">
        <strong className="font-semibold">Modo demo.</strong> No hay ningún proyecto de Firebase
        conectado: puedes recorrer toda la interfaz, pero las publicaciones no se guardan.{' '}
        <span className="text-muted">Consulta docs/DEPLOY.md para conectarlo.</span>
      </p>
    </aside>
  );
}
