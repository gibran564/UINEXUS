import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublishFlow } from '@/components/publish/publish-flow';
import { listCourses, listKnownGroups } from '@/lib/data/repository';
import type { ProjectType } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Publicar proyecto',
  robots: { index: false, follow: false },
};

const TYPES: ProjectType[] = ['html', 'site', 'build'];

export default async function PublishNewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; compartir?: string }>;
}) {
  const { type, compartir } = await searchParams;
  if (!type || !TYPES.includes(type as ProjectType)) redirect('/publish');

  const [courses, groups] = await Promise.all([listCourses(), listKnownGroups()]);

  /**
   * `?compartir=` sólo PRESELECCIONA grupos en el paso final. No autoriza nada:
   * quien comparte tiene que ser miembro de cada grupo, y eso lo comprueba
   * `POST /api/publications` con la sesión, no esta URL.
   */
  const shareCourseIds = (compartir ?? '').split(',').map((id) => id.trim()).filter(Boolean);

  return (
    <div className="container-page py-12">
      <PublishFlow
        projectType={type as ProjectType}
        courses={courses}
        groups={groups}
        shareCourseIds={shareCourseIds}
      />
    </div>
  );
}
