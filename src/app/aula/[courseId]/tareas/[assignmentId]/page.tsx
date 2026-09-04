import type { Metadata } from 'next';
import { AssignmentDetail } from '@/components/aula/assignment-detail';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Tarea',
  robots: { index: false, follow: false },
};

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  return (
    <div className="container-page py-10">
      <AssignmentDetail courseId={courseId} assignmentId={assignmentId} />
    </div>
  );
}
