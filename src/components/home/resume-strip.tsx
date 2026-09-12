'use client';

import Link from 'next/link';
import { relativeTime } from '@/lib/relative-time';
import type { WorkspaceSummary } from '@/lib/types';

/**
 * Sigue donde lo dejaste.
 *
 * El único bloque del Inicio que mira hacia atrás, y lo hace por una razón
 * concreta: un laboratorio a medias no aparece en ninguna otra parte de esta
 * pantalla. «Necesita tu atención» lista ACTIVIDADES —lo que pidió alguien—, y
 * una práctica propia no la pidió nadie: se abre, se deja a medias y se olvida
 * dónde estaba. Hoy, para volver a ella hay que acordarse de en qué materia
 * nació y bajar por `/practicas`.
 *
 * No compite con lo que hay que hacer: va DEBAJO. Retomar algo voluntario nunca
 * puede ir antes que una entrega que cierra esta tarde.
 *
 * ## Por qué no hay estado ni progreso
 *
 * Porque el resumen que manda el servidor no lo tiene, y calcularlo obligaría a
 * mandar el documento entero de cada NexBook —cientos de KB por pantalla, que es
 * justo lo que `listWorkspaceSummariesForOwner` evita—. Se dice lo que se sabe:
 * qué es, cómo se llama y cuándo se tocó.
 */
export function ResumeStrip({ items }: { items: WorkspaceSummary[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="retomar">
      <h2 id="retomar" className="meta">
        Sigue donde lo dejaste
      </h2>

      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="panel relative p-3 transition-colors focus-within:border-accent hover:border-line-strong"
          >
            <p className="text-label text-subtle">{describe(item)}</p>
            <p className="mt-0.5 truncate text-sm font-medium">
              <Link
                href={pathFor(item)}
                className="after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {item.title}
              </Link>
            </p>
            <p className="mt-0.5 text-label text-subtle">guardado {relativeTime(item.updatedAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A dónde lleva cada una. Es la misma regla que `practice-list`: un NexBook y
 * una práctica de un archivo comparten tabla pero no pantalla.
 */
function pathFor(item: WorkspaceSummary): string {
  return item.kind === 'nexbook' ? `/practicas/nexbook/${item.id}` : `/practicas/${item.id}`;
}

/** Qué es, en las palabras que ya usa el índice de prácticas. */
function describe(item: WorkspaceSummary): string {
  if (item.kind === 'nexbook') {
    const blocks = item.blockCount ?? 0;
    return `NexLab · ${blocks} ${blocks === 1 ? 'bloque' : 'bloques'}`;
  }
  return item.language ? `Práctica · ${item.language}` : 'Práctica';
}
