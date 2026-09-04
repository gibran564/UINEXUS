'use client';

import { usePathname } from 'next/navigation';
import { isProjectShellPath } from '@/lib/slug';

export function AppFrame({
  banner,
  navigation,
  footer,
  children,
}: {
  banner: React.ReactNode;
  navigation: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const shell = isProjectShellPath(usePathname());

  return (
    <>
      {!shell && banner}
      {!shell && navigation}
      <main id="contenido" tabIndex={-1}>
        {children}
      </main>
      {!shell && footer}
    </>
  );
}
