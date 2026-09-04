import Link from 'next/link';
import { PRIMARY_CATEGORIES, SORT_OPTIONS } from '@/lib/constants';
import { exploreHref } from '@/lib/urls';
import type { ExploreFilters } from '@/lib/types';

interface Facets {
  tags: { value: string; count: number }[];
  courses: { id: string; name: string; count: number }[];
  terms: string[];
}

/**
 * Barra de filtros.
 *
 * Dos decisiones:
 *  1. Cada filtro es un ENLACE, no un control de JavaScript. El estado vive en
 *     la URL, así que se puede compartir "los proyectos de accesibilidad de
 *     este curso", el botón Atrás funciona y la página sigue filtrando sin JS.
 *  2. Progressive disclosure: cinco categorías a la vista; curso, periodo,
 *     tipo y orden viven dentro de un <details>. Quince filtros de golpe
 *     convierten una galería en un formulario de aduana.
 */
export function FilterBar({
  filters,
  facets,
  total,
}: {
  filters: ExploreFilters;
  facets: Facets;
  total: number;
}) {
  const base = {
    q: filters.query || null,
    course: filters.courseId,
    term: filters.term,
    type: filters.projectType,
    sort: filters.sort === 'recent' ? null : filters.sort,
  };

  const activeCount =
    (filters.tag ? 1 : 0) +
    (filters.courseId ? 1 : 0) +
    (filters.term ? 1 : 0) +
    (filters.projectType ? 1 : 0);

  const visibleTags = PRIMARY_CATEGORIES.filter((category) =>
    facets.tags.some((tag) => tag.value === category)
  );
  const extraTags = facets.tags
    .filter((tag) => !(PRIMARY_CATEGORIES as readonly string[]).includes(tag.value))
    .slice(0, 10);

  return (
    <div>
      <nav aria-label="Filtrar por categoría" className="flex flex-wrap items-center gap-2">
        <FilterChip href={exploreHref({ ...base, tag: null })} active={!filters.tag}>
          Todos
        </FilterChip>
        {visibleTags.map((category) => (
          <FilterChip
            key={category}
            href={exploreHref({ ...base, tag: category })}
            active={filters.tag === category}
          >
            {category}
          </FilterChip>
        ))}
      </nav>

      <details className="group mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-muted hover:text-fg">
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
            className="transition-transform group-open:rotate-90"
          >
            <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Más filtros
          {activeCount > 0 && (
            <span className="rounded-xs border border-accent-line bg-accent-soft px-1.5 text-label text-accent">
              {activeCount} {activeCount === 1 ? 'activo' : 'activos'}
            </span>
          )}
        </summary>

        <div className="panel mt-3 grid gap-6 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <h2 className="sr-only">Filtros adicionales</h2>
          {extraTags.length > 0 && (
            <FilterGroup title="Más categorías">
              {extraTags.map((tag) => (
                <FilterLink
                  key={tag.value}
                  href={exploreHref({ ...base, tag: tag.value })}
                  active={filters.tag === tag.value}
                >
                  {tag.value}
                  <Count value={tag.count} />
                </FilterLink>
              ))}
            </FilterGroup>
          )}

          {facets.courses.length > 0 && (
            <FilterGroup title="Curso">
              <FilterLink href={exploreHref({ ...base, tag: filters.tag, course: null })} active={!filters.courseId}>
                Todos los cursos
              </FilterLink>
              {facets.courses.map((course) => (
                <FilterLink
                  key={course.id}
                  href={exploreHref({ ...base, tag: filters.tag, course: course.id })}
                  active={filters.courseId === course.id}
                >
                  {course.name}
                  <Count value={course.count} />
                </FilterLink>
              ))}
            </FilterGroup>
          )}

          {facets.terms.length > 0 && (
            <FilterGroup title="Periodo">
              <FilterLink href={exploreHref({ ...base, tag: filters.tag, term: null })} active={!filters.term}>
                Todos los periodos
              </FilterLink>
              {facets.terms.map((term) => (
                <FilterLink
                  key={term}
                  href={exploreHref({ ...base, tag: filters.tag, term })}
                  active={filters.term === term}
                >
                  {term}
                </FilterLink>
              ))}
            </FilterGroup>
          )}

          <FilterGroup title="Ordenar por">
            {SORT_OPTIONS.map((option) => (
              <FilterLink
                key={option.value}
                href={exploreHref({
                  ...base,
                  tag: filters.tag,
                  sort: option.value === 'recent' ? null : option.value,
                })}
                active={filters.sort === option.value}
              >
                {option.label}
              </FilterLink>
            ))}
          </FilterGroup>
        </div>
      </details>

      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted" aria-live="polite">
        <span>
          {total === 0
            ? 'Ningún proyecto coincide'
            : `${total} ${total === 1 ? 'proyecto' : 'proyectos'}`}
        </span>
        {(activeCount > 0 || filters.query) && (
          <Link href="/explore" className="text-accent underline underline-offset-2">
            Quitar filtros
          </Link>
        )}
      </p>
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="ml-1.5 text-subtle tabular-nums">{value}</span>;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="meta mb-2">{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'true' : undefined}
        className={`flex min-h-9 items-center rounded-xs px-1.5 text-sm no-underline ${
          active ? 'font-medium text-accent' : 'text-muted hover:bg-sunken hover:text-fg'
        }`}
      >
        {active && (
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" className="mr-1.5 shrink-0">
            <path d="M2 6.4l2.6 2.6L10 3.6" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          </svg>
        )}
        {children}
      </Link>
    </li>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    // El estado seleccionado lo pinta `.chip` a partir de aria-current.
    <Link href={href} aria-current={active ? 'true' : undefined} className="chip">
      {children}
    </Link>
  );
}
