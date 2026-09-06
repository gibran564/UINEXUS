import type { Metadata } from 'next';
import { PublicationPage } from '@/components/home/publication-page';

/**
 * El permalink de una publicación del muro.
 *
 * No se indexa: lo que se publica en una materia es de esa materia. La ruta
 * existe para poder enlazar, recargar y volver con el botón Atrás, no para
 * llegar desde un buscador.
 */
export const metadata: Metadata = {
  title: 'Publicación',
  robots: { index: false, follow: false },
};

export default async function MuroPublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="container-page py-10">
      <PublicationPage id={id} />
    </div>
  );
}
