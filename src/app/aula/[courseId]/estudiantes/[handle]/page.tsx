import type { Metadata } from 'next';
import { StudentInCourse } from '@/components/aula/student-in-course';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Estudiante',
  robots: { index: false, follow: false },
};

export default async function StudentPage({
  params,
}: {
  params: Promise<{ courseId: string; handle: string }>;
}) {
  const { courseId, handle } = await params;
  return (
    <div className="container-page py-10">
      <StudentInCourse courseId={courseId} handle={decodeURIComponent(handle)} />
    </div>
  );
}
