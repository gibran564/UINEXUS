'use client';

import { useRouter } from 'next/navigation';
import { PublicationDetail } from './publication-detail';

/**
 * El diálogo de una publicación cuando se llega desde el muro.
 *
 * Cerrar es volver: `router.back()` deshace la navegación interceptada y deja
 * el Inicio como estaba, con el mismo desplazamiento y el foco donde se quedó.
 */
export function PublicationModal({ id }: { id: string }) {
  const router = useRouter();
  return <PublicationDetail id={id} onClose={() => router.back()} onChanged={() => router.refresh()} />;
}
