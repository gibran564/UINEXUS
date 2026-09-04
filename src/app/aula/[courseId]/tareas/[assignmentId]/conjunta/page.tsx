import type { Metadata } from 'next';
import { CollaborativeScreen } from '@/components/aula/collaborative-screen';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Actividad del grupo',
  robots: { index: false, follow: false },
};

export default async function CollaborativePage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  return (
    <div className="container-page py-10">
      <CollaborativeScreen courseId={courseId} assignmentId={assignmentId} />
    </div>
  );
}
