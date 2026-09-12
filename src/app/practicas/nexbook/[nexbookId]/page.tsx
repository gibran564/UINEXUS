import type { Metadata } from 'next';
import { NexBookPage } from '@/components/studio/nexbook-page';

export const metadata: Metadata = {
  title: 'NexLab',
  // Un laboratorio personal es privado por definición: nada que indexar.
  robots: { index: false, follow: false },
};

/**
 * NexLab a pantalla completa.
 *
 * La ruta sigue diciendo `nexbook` porque eso es lo que se abre: un NexBook. El
 * nombre visible es NexLab —el espacio— y el componente sigue llamándose
 * `NexBookStudio`, que es el nombre del módulo y no de la marca.
 *
 * Ancho propio y no `container-page`: un documento con código y salidas
 * necesita el ancho. Es el mismo editor que se usa dentro de una actividad, con
 * otro layout alrededor.
 */
export default async function NexLabPage({
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
