import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterBar } from '@/components/explore/filter-bar';
import { SearchField } from '@/components/explore/search-field';
import { ProjectGrid } from '@/components/project/project-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { getExploreFacets, listProjects } from '@/lib/data/repository';
import type { ExploreFilters, ProjectType, SortOption } from '@/lib/types';
import { exploreHref } from '@/lib/urls';

export const revalidate = 120;

export const metadata: Metadata = {
  title: 'Explorar proyectos',
  description:
    'Busca y filtra los proyectos publicados por estudiantes: interfaces, prototipos, ' +
    'investigaciones y rediseños.',
};

const PAGE_SIZE = 24;
const SORTS: SortOption[] = ['recent', 'featured', 'popular', 'alphabetical'];
const TYPES: ProjectType[] = ['html', 'site', 'build'];

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const sortParam = first(params.sort);
  const typeParam = first(params.type);

  const filters: ExploreFilters = {
    query: first(params.q) ?? '',
    tag: first(params.tag),
    courseId: first(params.course),
    term: first(params.term),
    projectType: TYPES.includes(typeParam as ProjectType) ? (typeParam as ProjectType) : null,
    sort: SORTS.includes(sortParam as SortOption) ? (sortParam as SortOption) : 'recent',
  };

  const page = Math.max(1, Number.parseInt(first(params.page) ?? '1', 10) || 1);

  const [result, facets] = await Promise.all([
    listProjects(filters, page, PAGE_SIZE),
    getExploreFacets(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const carry = {
    q: filters.query || null,
    tag: filters.tag,
    course: filters.courseId,
    term: filters.term,
    type: filters.projectType,
    sort: filters.sort === 'recent' ? null : filters.sort,
  };

  return (
    <div className="container-page py-10">
      <header>
        <h1 className="font-display text-h1">Explorar proyectos</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Todo lo que han publicado los grupos de la materia. No necesitas cuenta para verlo
          ni para compartirlo.
        </p>
      </header>

      <div className="mt-7 max-w-2xl">
        <SearchField
          defaultValue={filters.query}
          size="lg"
          hidden={{
            tag: filters.tag,
            course: filters.courseId,
            term: filters.term,
            type: filters.projectType,
            sort: filters.sort === 'recent' ? null : filters.sort,
          }}
        />
      </div>

      <div className="mt-7">
        <FilterBar filters={filters} facets={facets} total={result.total} />
      </div>

      <div className="mt-9">
        {/* Encabezado sólo para lectores de pantalla: sin él, los títulos de
            las tarjetas (h3) colgarían directamente del h1 y el esquema del
            documento quedaría con un salto de nivel. */}
        <h2 className="sr-only">Resultados</h2>
        {result.projects.length > 0 ? (
          <ProjectGrid
            projects={result.projects}
            label={filters.query ? `Resultados para ${filters.query}` : 'Proyectos publicados'}
          />
        ) : filters.query || filters.tag || filters.courseId || filters.term ? (
          <EmptyState
            title="Ningún proyecto coincide con esa búsqueda"
            description="Prueba con menos palabras, revisa la ortografía o quita alguno de los filtros activos."
            action={{ href: '/explore', label: 'Ver todos los proyectos' }}
          />
        ) : (
          <EmptyState
            title="Todavía no hay proyectos publicados"
            description="Esta galería se llena con lo que suben los grupos. El primero puede ser el tuyo."
            action={{ href: '/publish', label: 'Publicar proyecto' }}
          />
        )}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Paginación" className="mt-12 flex items-center justify-between gap-4">
          {page > 1 ? (
            <Link href={exploreHref({ ...carry, page: String(page - 1) })} className="btn btn-secondary">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <p className="text-sm text-muted tabular-nums">
            Página {page} de {totalPages}
          </p>
          {page < totalPages ? (
            <Link href={exploreHref({ ...carry, page: String(page + 1) })} className="btn btn-secondary">
              Siguiente →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
