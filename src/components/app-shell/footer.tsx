import Link from 'next/link';
import { LogoMark } from '@/components/ui/logo';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 font-display text-h3">
            <LogoMark size={18} />
            UINexus
          </p>
          <p className="mt-2 max-w-64 text-sm text-muted">
            Galería y hosting de proyectos web para clases de diseño centrado en el usuario.
          </p>
        </div>

        <nav aria-labelledby="footer-explorar">
          <h2 id="footer-explorar" className="meta mb-3">
            Explorar
          </h2>
          <ul className="text-sm">
            <FooterLink href="/explore">Todos los proyectos</FooterLink>
            <FooterLink href="/courses">Cursos</FooterLink>
            <FooterLink href="/explore?sort=featured">Destacados</FooterLink>
          </ul>
        </nav>

        <nav aria-labelledby="footer-publicar">
          <h2 id="footer-publicar" className="meta mb-3">
            Publicar
          </h2>
          <ul className="text-sm">
            <FooterLink href="/publish">Publicar un proyecto</FooterLink>
            <FooterLink href="/dashboard">Tus proyectos</FooterLink>
            <FooterLink href="/login">Iniciar sesión</FooterLink>
          </ul>
        </nav>

        <nav aria-labelledby="footer-acerca">
          <h2 id="footer-acerca" className="meta mb-3">
            Plataforma
          </h2>
          <ul className="text-sm">
            <FooterLink href="/about">Acerca de UINexus</FooterLink>
            <FooterLink href="/about#seguridad">Cómo protegemos los proyectos</FooterLink>
            <FooterLink href="/about#privacidad">Privacidad</FooterLink>
          </ul>
        </nav>
      </div>

      <div className="container-page border-t border-line py-5">
        <p className="text-sm text-subtle">
          Proyecto académico. Los trabajos publicados pertenecen a sus autoras y autores.
        </p>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      {/* min-h-9: en móvil estos enlaces son el objetivo táctil más pequeño de
          la página, y 17px de alto no es un objetivo, es una lotería. */}
      <Link
        href={href}
        className="inline-flex min-h-9 items-center text-muted no-underline hover:text-fg hover:underline"
      >
        {children}
      </Link>
    </li>
  );
}
