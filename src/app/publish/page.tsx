import type { Metadata } from 'next';
import Link from 'next/link';
import { PROJECT_TYPES } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Publicar proyecto',
  description: 'Sube tu página, tu sitio completo o tu build estático y obtén un enlace público.',
};

/**
 * La bifurcación del flujo.
 *
 * Tres opciones, no diez. Cada una está descrita por lo que la persona TIENE
 * en su computadora, no por la tecnología: "un archivo HTML", "una carpeta
 * comprimida", "el resultado de un build". Quien no programa reconoce lo
 * primero; "static site generator" no se lo dice a nadie.
 */
export default function PublishPage() {
  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-h1">¿Qué quieres publicar?</h1>
        <p className="mt-2 max-w-xl text-muted">
          Elige lo que más se parezca a lo que tienes ahora mismo. Si te equivocas, puedes
          volver atrás sin perder nada.
        </p>

        <ul className="mt-9 space-y-3">
          {PROJECT_TYPES.map((option, index) => (
            <li key={option.value}>
              <Link
                href={`/publish/new?type=${option.value}`}
                className="panel flex items-start gap-5 p-5 no-underline transition-colors hover:border-accent"
              >
                <span className="meta pt-1 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block font-display text-h3">{option.label}</span>
                  <span className="mt-1 block text-muted">{option.helper}</span>
                  <span className="mt-2 block font-mono text-label text-subtle">
                    {option.example}
                  </span>
                </span>
                <span aria-hidden="true" className="ml-auto self-center text-subtle">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="panel mt-10 bg-sunken p-5">
          <h2 className="font-display text-h3">¿No estás seguro?</h2>
          <p className="mt-2 text-muted">
            Si lo que tienes es un solo archivo que se abre en el navegador y se ve tu página,
            elige <strong className="font-medium text-fg">Página HTML</strong>. Es el caso más
            común y el más rápido.
          </p>
          <p className="mt-3 text-sm text-subtle">
            UINexus aloja sitios estáticos: HTML, CSS, JavaScript de navegador e imágenes. No
            ejecuta servidores ni bases de datos propias.{' '}
            <Link href="/about#seguridad" className="underline underline-offset-2">
              Por qué
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
