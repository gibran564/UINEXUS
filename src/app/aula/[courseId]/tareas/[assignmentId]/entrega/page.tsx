import type { Metadata } from 'next';
import { SubmissionForm } from '@/components/aula/submission-form';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Mi entrega',
  robots: { index: false, follow: false },
};

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  return (
    <div className="container-page py-10">
      <SubmissionForm courseId={courseId} assignmentId={assignmentId} />
    </div>
  );
}
