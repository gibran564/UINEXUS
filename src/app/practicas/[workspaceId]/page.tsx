import type { Metadata } from 'next';
import { PracticeWorkspace } from '@/components/workspace/practice-workspace';

export const metadata: Metadata = {
  title: 'NexCode',
  robots: { index: false, follow: false },
};

export default async function PracticePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <div className="container-page py-10">
      <PracticeWorkspace workspaceId={workspaceId} />
    </div>
  );
}
