import type { Metadata } from 'next';
import { SkillDetail } from '@/components/aula/skill-detail';

/**
 * Pantalla privada del aula. `robots: noindex` no es por SEO: es una pagina que
 * solo tiene sentido con sesion, y que aparezca en un buscador solo produciria
 * visitas que acaban en la pantalla de iniciar sesion.
 */
export const metadata: Metadata = {
  title: 'Skill',
  robots: { index: false, follow: false },
};

export default async function SkillPage({
  params,
}: {
  params: Promise<{ courseId: string; skillId: string }>;
}) {
  const { courseId, skillId } = await params;
  return (
    <div className="container-page py-10">
      <SkillDetail courseId={courseId} skillId={skillId} />
    </div>
  );
}
