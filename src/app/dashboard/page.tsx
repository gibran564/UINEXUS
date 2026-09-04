import type { Metadata } from 'next';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const metadata: Metadata = {
  title: 'Tus proyectos',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <div className="container-page py-10">
      <DashboardClient />
    </div>
  );
}
