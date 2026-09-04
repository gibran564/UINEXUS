import type { Metadata } from 'next';
import { AssignmentEditor } from '@/components/aula/assignment-editor';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Editar tarea',
  robots: { index: false, follow: false },
};

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  return (
    <div className="container-page py-10">
      <AssignmentEditor courseId={courseId} assignmentId={assignmentId} />
    </div>
  );
}
