import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/dashboard/profile-editor';

export const metadata: Metadata = {
  title: 'Editar perfil',
  robots: { index: false, follow: false },
};

export default function ProfileSettingsPage() {
  return (
    <div className="container-page py-10">
      <ProfileEditor />
    </div>
  );
}
