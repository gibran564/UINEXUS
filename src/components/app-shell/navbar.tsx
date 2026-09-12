'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { SearchPalette } from '@/components/search/search-palette';
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
 * No hay entradas nuevas para «Tareas» y «Recursos» y es deliberado: en Nextudio
 * ambas viven DENTRO de una materia (`/aula/:id`), y añadir dos pantallas
 * globales que repitieran lo que ya hay sería duplicar para cumplir un nombre.
 * Lo que de verdad hace falta para encontrarlas es una búsqueda global, y ésa
 * llega en la Fase 2 (ver `docs/NEXTUDIO-ROADMAP.md` §D4).
 */
const PUBLIC_LINKS = [
  { href: '/explore', label: 'Explorar' },
  { href: '/courses', label: 'Materias' },
  { href: '/about', label: 'Acerca de' },
];

/**
 * `Aula` se queda como se llama.
 *
 * El nombre está por todo el producto —la ruta, los componentes, «Tu aula» del
 * menú— y en la cabeza de quien ya lo usa. Renombrarlo a «Clases» en un sitio y
 * dejarlo en los otros nueve sería peor que cualquiera de las dos opciones
 * consistentes.
 *
 * Lo que sí faltaba era `Proyectos`: hasta ahora sólo se llegaba a `/dashboard`
 * por el menú de la cuenta, escondiendo justo la mitad del producto que la
 * portada nueva promete. Ahora que Nextudio no es sólo publicar, el área donde
 * vive lo construido tiene que estar en la barra.
 *
 * ## «Prácticas» pasa a llamarse «Espacios», y la ruta sigue siendo `/practicas`
 *
 * El nombre cambia porque lo que hay ahí dejó de ser sólo práctica: es un
 * laboratorio por bloques (NexLab) o un archivo de código (NexCode), y mañana
 * un registro de uso de IA. La RUTA no cambia porque no hay ninguna razón para
 * cambiarla: hay enlaces repartidos, y crear `/espacios` sólo para que la URL
 * repita la etiqueta sería inventar una ruta para justificar un nombre. Es la
 * misma decisión que mantiene `/aula`.
 */
const PRIVATE_LINKS = [
  { href: '/', label: 'Inicio' },
  { href: '/aula', label: 'Aula' },
  { href: '/practicas', label: 'Espacios' },
  { href: '/dashboard', label: 'Proyectos' },
  { href: '/explore', label: 'Explorar' },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const authenticated = status === 'authenticated';

  // Cerrar los menús al navegar: si no, quedan abiertos sobre la página nueva.
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  /**
   * `Ctrl/Cmd + K` abre la búsqueda — salvo dentro del editor.
   *
   * Monaco usa `Ctrl+K` como PREFIJO de acorde: `Ctrl+K Ctrl+C` comenta,
   * `Ctrl+K Ctrl+X` recorta espacios. Robárselo dejaría medio VS Code sin
   * funcionar dentro de un NexLab, y en un producto donde se programa eso no es
   * un detalle. La comprobación es estructural —¿el foco está dentro de un
   * `.monaco-editor`?— y no una lista de rutas donde «hay editor», que se
   * quedaría desfasada la primera vez que alguien ponga uno en otra pantalla.
   */
  useEffect(() => {
    if (!authenticated) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.monaco-editor')) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [authenticated]);

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
    <>
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      {/*
        La barra no puede empujar el documento a lo ancho.

        Con sesión conviven aquí la marca, la búsqueda, publicar, la cuenta y el
        menú. En un teléfono de 360 px eso sumaba 18 px más de los que hay, y el
        resultado era un scroll horizontal de toda la página —en TODAS las
        pantallas, porque la barra es global—. Se arregla donde está la causa y
        no pantalla por pantalla: menos separación por debajo de `sm`, y la
        marca sin su nombre por debajo de 400 px (el enlace lo sigue diciendo
        para quien no ve la pantalla). Lo vigila `tests/e2e/responsive.spec.ts`,
        que mide ocho anchos y falla si vuelve.
      */}
      <div className="container-page flex h-16 items-center gap-2 sm:gap-4">
        <Link
          href="/"
          className="shrink-0 rounded-xs text-fg no-underline"
          aria-label="Nextudio, ir al inicio"
        >
          <Wordmark size={20} hideNameUnder400 />
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

        {/*
          Con sesión, el campo deja de ser un formulario hacia `/explore`.
          `/explore` busca PROYECTOS PUBLICADOS, que es una fracción de lo que
          alguien con sesión tiene: sus espacios, sus actividades, los materiales
          de sus materias. Un campo que dice «Buscar…» y sólo encuentra una de
          esas cosas enseña que la búsqueda no sirve. Es un BOTÓN porque lo que
          hace es abrir un diálogo, y un `<input>` que no se escribe donde está
          sería mentir sobre lo que va a pasar al pulsarlo.
        */}
        {authenticated ? (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="field ml-auto hidden h-9 min-h-9 max-w-64 flex-1 items-center gap-2 bg-transparent text-left text-sm text-subtle lg:flex"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" className="shrink-0">
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="flex-1 truncate">Buscar en Nextudio…</span>
            <kbd className="shrink-0 rounded-xs border border-line px-1 font-mono text-label">
              Ctrl K
            </kbd>
          </button>
        ) : (
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
        )}

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {/* Por debajo de `lg` no cabe el campo, pero la búsqueda tiene que
              seguir estando: aquí es un icono, con su nombre accesible. */}
          {authenticated && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="btn btn-ghost h-11 w-11 px-0 lg:hidden"
            >
              <span className="sr-only">Buscar en Nextudio</span>
              <svg viewBox="0 0 16 16" width="17" height="17" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}

          <div className="hidden xl:block">
            <ThemeToggle />
          </div>

          {status === 'loading' && (
            <div
              className="hidden h-9 w-24 animate-pulse rounded-sm bg-sunken md:block"
              aria-hidden="true"
            />
          )}

          {/*
            Para quien todavía no ha entrado, la acción principal es ENTRAR.
            Antes era «Publicar», y eso decía —en el sitio más visible de la
            pantalla— que Nextudio es un publicador. Publicar sigue estando a un
            clic una vez dentro, que es además el único momento en que se puede.
          */}
          {status === 'anonymous' && (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Iniciar sesión
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm">
                Crear cuenta
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
            {authenticated ? (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setSearchOpen(true);
                }}
                className="field mb-3 flex w-full items-center gap-2 text-left text-subtle"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" className="shrink-0">
                  <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Buscar en Nextudio…
              </button>
            ) : (
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
            )}
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
                      Acerca de Nextudio
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

    {/*
      La paleta vive aquí y no en el layout porque su estado es el de esta barra:
      quien la abre es este botón o este atajo. Sacarla al layout habría exigido
      un contexto o un evento global para decirle «ábrete», que es plumbing para
      no mover un `useState` de sitio.
    */}
    {authenticated && <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />}
    </>
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
