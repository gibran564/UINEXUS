import type { Metadata } from 'next';
import { CourseWorkspace } from '@/components/aula/course-workspace';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Materia',
  robots: { index: false, follow: false },
};

export default async function CourseAulaPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return (
    <div className="container-page py-10">
      <CourseWorkspace courseId={courseId} />
    </div>
  );
}
