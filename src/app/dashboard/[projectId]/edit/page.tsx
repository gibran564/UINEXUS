import type { Metadata } from 'next';
import { EditProject } from '@/components/dashboard/edit-project';
import { listCourses, listKnownGroups } from '@/lib/data/repository';

export const metadata: Metadata = {
  title: 'Editar proyecto',
  robots: { index: false, follow: false },
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [{ projectId }, courses, groups] = await Promise.all([
    params,
    listCourses(),
    listKnownGroups(),
  ]);

  return (
    <div className="container-page py-10">
      <EditProject projectId={projectId} courses={courses} groups={groups} />
    </div>
  );
}
