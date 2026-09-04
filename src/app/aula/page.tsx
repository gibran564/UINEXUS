import type { Metadata } from 'next';
import { AulaHome } from '@/components/aula/aula-home';

export const metadata: Metadata = {
  title: 'Aula',
  robots: { index: false, follow: false },
};

export default function AulaPage() {
  return (
    <div className="container-page py-10">
      <AulaHome />
    </div>
  );
}
