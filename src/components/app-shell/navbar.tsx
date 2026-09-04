'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Wordmark } from '@/components/ui/logo';
import { UserAvatar } from '@/components/ui/user-avatar';
import { profilePath } from '@/lib/urls';

/**
 * La navegación cambia con la sesión, porque la pregunta cambia con la sesión.
 *
 * Quien llega de fuera viene a mirar: explorar, ver los cursos, entender qué es
 * esto. Quien tiene sesión viene a trabajar, y para eso lo primero es su
 * Inicio —qué le toca y qué pasó— y después su aula.
 *
 * No hay entradas nuevas para «Tareas» y «Recursos» y es deliberado: en UINexus
 * ambas viven DENTRO de una materia (`/aula/:id`), y añadir dos pantallas
 * globales que repitieran lo que ya hay sería duplicar para cumplir un nombre.
 */
const PUBLIC_LINKS = [
  { href: '/explore', label: 'Explorar' },
  { href: '/courses', label: 'Cursos' },
  { href: '/about', label: 'Acerca de' },
];

const PRIVATE_LINKS = [
  { href: '/', label: 'Inicio' },
  { href: '/aula', label: 'Aula' },
  { href: '/explore', label: 'Explorar' },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Cerrar los menús al navegar: si no, quedan abiertos sobre la página nueva.
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [accountOpen]);

  const links = status === 'authenticated' ? PRIVATE_LINKS : PUBLIC_LINKS;

  const isActive = (href: string): boolean =>
    // «Inicio» es la raíz: sin el caso especial, `startsWith('/')` la marcaría
    // como activa en todas las pantallas de la aplicación.
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  function onSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = String(data.get('q') ?? '').trim();
    router.push(query ? `/explore?q=${encodeURIComponent(query)}` : '/explore');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center gap-4">
        <Link
          href="/"
          className="shrink-0 rounded-xs text-fg no-underline"
          aria-label="UINexus, ir al inicio"
        >
          <Wordmark size={20} />
        </Link>

        <nav aria-label="Principal" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={`inline-flex h-9 items-center rounded-sm px-3 text-sm no-underline transition-colors ${
                    isActive(link.href)
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-muted hover:bg-sunken hover:text-fg'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <form role="search" onSubmit={onSearch} className="ml-auto hidden max-w-64 flex-1 lg:block">
          <label htmlFor="nav-search" className="sr-only">
            Buscar proyectos
          </label>
          <div className="relative">
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle"
            >
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              id="nav-search"
              name="q"
              type="search"
              placeholder="Buscar…"
              className="field h-9 min-h-9 bg-transparent pl-8 text-sm"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <div className="hidden xl:block">
            <ThemeToggle />
          </div>

          {status === 'loading' && (
            <div
              className="hidden h-9 w-24 animate-pulse rounded-sm bg-sunken md:block"
              aria-hidden="true"
            />
          )}

          {status === 'anonymous' && (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Iniciar sesión
              </Link>
              <Link href="/register" className="btn btn-secondary btn-sm hidden md:inline-flex">
                Registrarse
              </Link>
              <Link href="/publish" className="btn btn-primary btn-sm">
                Publicar
              </Link>
            </>
          )}

          {status === 'authenticated' && user && (
            <>
              {/* Visible también en móvil: publicar es la acción principal de
                  la plataforma y no puede vivir sólo dentro de un menú. */}
              <Link href="/publish" className="btn btn-primary btn-sm">
                Publicar
              </Link>
              <div className="relative" ref={accountRef}>
                <button
                  type="button"
                  onClick={() => setAccountOpen((open) => !open)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  aria-controls="account-menu"
                  className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-sunken"
                >
                  <UserAvatar name={user.displayName} src={user.avatarUrl} size={30} />
                  <span className="sr-only">Tu cuenta, {user.displayName}</span>
                </button>

                {accountOpen && (
                  <div
                    id="account-menu"
                    role="menu"
                    className="absolute right-0 mt-1 w-56 rounded-md border border-line bg-raised py-1"
                    style={{ boxShadow: 'var(--shadow-pop)' }}
                  >
                    <p className="truncate border-b border-line px-3 pt-1 pb-2 text-sm">
                      <span className="block font-medium">{user.displayName}</span>
                      {user.handle && (
                        <span className="font-mono text-label text-muted">@{user.handle}</span>
                      )}
                    </p>
                    <MenuLink href="/">Inicio</MenuLink>
                    <MenuLink href="/aula">Tu aula</MenuLink>
                    <MenuLink href="/dashboard">Tus proyectos</MenuLink>
                    {user.handle && (
                      <MenuLink href={profilePath(user.handle)}>Ver tu perfil público</MenuLink>
                    )}
                    <MenuLink href="/dashboard/profile">Editar perfil</MenuLink>
                    <div className="my-1 border-t border-line" />
                    <div className="px-3 py-2 xl:hidden">
                      <ThemeToggle />
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut()}
                      className="block w-full px-3 py-2 text-left text-sm text-muted hover:bg-sunken hover:text-fg"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="btn btn-ghost h-11 w-11 px-0 md:hidden"
          >
            <span className="sr-only">{mobileOpen ? 'Cerrar menú' : 'Abrir menú'}</span>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
              {mobileOpen ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Principal (móvil)" className="border-t border-line bg-surface md:hidden">
          <div className="container-page py-3">
            <form role="search" onSubmit={onSearch} className="mb-3">
              <label htmlFor="mobile-search" className="sr-only">
                Buscar proyectos
              </label>
              <input
                id="mobile-search"
                name="q"
                type="search"
                placeholder="Buscar proyectos…"
                className="field"
              />
            </form>
            <ul className="flex flex-col">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(link.href) ? 'page' : undefined}
                    className={`flex min-h-11 items-center rounded-sm px-2 no-underline ${
                      isActive(link.href) ? 'font-medium text-accent' : 'text-fg'
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {status === 'anonymous' && (
                <>
                  <li>
                    <Link href="/login" className="flex min-h-11 items-center rounded-sm px-2 no-underline">
                      Iniciar sesión
                    </Link>
                  </li>
                  <li>
                    <Link href="/register" className="flex min-h-11 items-center rounded-sm px-2 font-medium text-accent no-underline">
                      Crear cuenta (@itdurango.edu.mx)
                    </Link>
                  </li>
                </>
              )}
              {status === 'authenticated' && (
                <>
                  <li>
                    <Link href="/dashboard" className="flex min-h-11 items-center rounded-sm px-2 no-underline">
                      Tus proyectos
                    </Link>
                  </li>
                  <li>
                    <Link href="/about" className="flex min-h-11 items-center rounded-sm px-2 no-underline">
                      Acerca de UINexus
                    </Link>
                  </li>
                  <li>
                    <Link href="/publish" className="flex min-h-11 items-center rounded-sm px-2 no-underline">
                      Publicar proyecto
                    </Link>
                  </li>
                </>
              )}
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block px-3 py-2 text-sm text-muted no-underline hover:bg-sunken hover:text-fg"
    >
      {children}
    </Link>
  );
}
