import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-page py-24">
      <div className="mx-auto max-w-lg text-center">
        <p className="meta">Error 404</p>
        <h1 className="mt-3 font-display text-h1">Esta dirección no lleva a ningún proyecto</h1>
        <p className="mt-4 text-muted">
          Puede que el enlace esté mal escrito, que el proyecto se haya eliminado o que su autor
          lo haya vuelto privado.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/explore" className="btn btn-primary">
            Explorar proyectos
          </Link>
          <Link href="/" className="btn btn-secondary">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
