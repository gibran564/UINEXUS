import type { Metadata } from 'next';
import { PracticeList } from '@/components/workspace/practice-list';

export const metadata: Metadata = {
  title: 'Mis prácticas',
  // Privadas por definición: no hay nada que indexar y sí algo que proteger.
  robots: { index: false, follow: false },
};

export default function PracticesPage() {
  return (
    <div className="container-page py-10">
      <PracticeList />
    </div>
  );
}
