import type { Metadata } from 'next';
import { NexBookPage } from '@/components/studio/nexbook-page';

export const metadata: Metadata = {
  title: 'UINexus Studio',
  // Un laboratorio personal es privado por definición: nada que indexar.
  robots: { index: false, follow: false },
};

/**
 * UINexus Studio a pantalla completa.
 *
 * `container-wide` y no `container-page`: un documento con código y salidas
 * necesita el ancho. Es el mismo editor que se usa dentro de una actividad, con
 * otro layout alrededor —ver `NexBookStudio`—.
 */
export default async function StudioPage({
  params,
}: {
  params: Promise<{ nexbookId: string }>;
}) {
  const { nexbookId } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <NexBookPage nexbookId={nexbookId} />
    </div>
  );
}
