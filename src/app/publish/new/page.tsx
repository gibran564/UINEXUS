import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublishFlow } from '@/components/publish/publish-flow';
import { listCourses } from '@/lib/data/repository';
import type { ProjectType } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Publicar proyecto',
  robots: { index: false, follow: false },
};

const TYPES: ProjectType[] = ['html', 'site', 'build'];

export default async function PublishNewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  if (!type || !TYPES.includes(type as ProjectType)) redirect('/publish');

  const courses = await listCourses();

  return (
    <div className="container-page py-12">
      <PublishFlow projectType={type as ProjectType} courses={courses} />
    </div>
  );
}
