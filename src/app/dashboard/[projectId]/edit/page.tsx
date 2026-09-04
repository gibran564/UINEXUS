import type { Metadata } from 'next';
import { EditProject } from '@/components/dashboard/edit-project';
import { listCourses } from '@/lib/data/repository';

export const metadata: Metadata = {
  title: 'Editar proyecto',
  robots: { index: false, follow: false },
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [{ projectId }, courses] = await Promise.all([params, listCourses()]);

  return (
    <div className="container-page py-10">
      <EditProject projectId={projectId} courses={courses} />
    </div>
  );
}
