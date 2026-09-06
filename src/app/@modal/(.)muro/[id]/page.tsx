import { PublicationModal } from '@/components/home/publication-modal';

/**
 * La misma ruta `/muro/[id]`, interceptada.
 *
 * Al pulsar una publicación desde el muro, Next intercepta la navegación y la
 * presenta como diálogo sobre el Inicio: la lista no se pierde y el foco vuelve
 * a su sitio al cerrar. Recargar, compartir el enlace o abrirlo en otra pestaña
 * lleva a la pantalla completa, que es la misma ruta sin interceptar.
 */
export default async function InterceptedPublication({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PublicationModal id={id} />;
}
