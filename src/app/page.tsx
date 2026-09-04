import Link from 'next/link';
import { APP_HOST } from '@/lib/urls';
import { ProjectCard } from '@/components/project/project-card';
import { ProjectGrid } from '@/components/project/project-grid';
import { SearchField } from '@/components/explore/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import { PRIMARY_CATEGORIES } from '@/lib/constants';
import {
  listCourses,
  listFeaturedProjects,
  listProjects,
} from '@/lib/data/repository';
import { coursePath, exploreHref } from '@/lib/urls';

export const revalidate = 300;

/**
 * Home.
 *
 * No es un panel: es una galería con una entrada breve. El héroe ocupa poco
 * más de 300 px para que la primera fila de proyectos entre en pantalla en un
 * portátil de 768 px de alto. La promesa está en una frase y hay exactamente
 * dos caminos: explorar o publicar.
 */
export default async function HomePage() {
  const [featured, latest, courses] = await Promise.all([
    listFeaturedProjects(3),
    listProjects({ sort: 'recent' }, 1, 6),
    listCourses(),
  ]);

  const [lead, ...rest] = featured;

  return (
    <>
      {/* ---------- Entrada ---------- */}
      <section className="border-b border-line bg-surface">
        <div className="container-page grid gap-10 py-12 lg:grid-cols-[1.25fr_1fr] lg:py-16">
          <div>
            <p className="meta">Instituto Tecnológico de Durango · Ago–Dic 2026</p>
            <h1 className="mt-3 font-display text-display">Diseña. Publica. Comparte.</h1>
            <p className="mt-4 max-w-xl text-lead text-muted">
              UINexus es donde el trabajo de la clase deja de vivir en una carpeta y pasa a
              tener una dirección propia. Sube tu página, obtén un enlace, compártelo.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Explorar proyectos
              </Link>
              <Link href="/publish" className="btn btn-secondary btn-lg">
                Publicar proyecto
              </Link>
            </div>
            <p className="mt-4 text-sm text-subtle">
              Explorar no requiere cuenta. Para publicar necesitas una, y toma un minuto.
            </p>
          </div>

          {/* Los tres pasos, dichos como los diría alguien que no programa. */}
          <ol className="grid content-center gap-0 self-center">
            {[
              { n: '01', title: 'Sube tu archivo', text: 'Un index.html o un .zip. Se arrastra y ya.' },
              { n: '02', title: 'Cuenta de qué va', text: 'Título, una descripción y tu curso.' },
              { n: '03', title: 'Comparte el enlace', text: `${APP_HOST}/@tunombre/tu-proyecto/` },
            ].map((step, index) => (
              <li
                key={step.n}
                className={`flex gap-4 py-4 ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="meta pt-1 tabular-nums">{step.n}</span>
                <div>
                  <h2 className="font-display text-h3">{step.title}</h2>
                  <p className="mt-0.5 text-sm text-muted">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Destacados ---------- */}
      {lead && (
        <section aria-labelledby="destacados" className="container-page pt-14">
          <h2 id="destacados" className="section-mark font-display text-h2">
            Proyectos destacados
          </h2>
          <p className="mt-1 text-muted">Elegidos por el profesorado del curso.</p>

          <div className="mt-7 grid gap-x-6 gap-y-9 lg:grid-cols-[1.6fr_1fr]">
            {/* El primero se muestra más grande: una galería sin jerarquía es
                una cuadrícula de ruido. */}
            <div className="lg:row-span-2">
              <ProjectCard project={lead} priority />
            </div>
            {rest.map((project) => (
              <ProjectCard key={project.id} project={project} priority />
            ))}
          </div>
        </section>
      )}

      {/* ---------- Explorar ---------- */}
      <section aria-labelledby="explorar" className="container-page pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="explorar" className="section-mark font-display text-h2">
              Explorar trabajos
            </h2>
            <p className="mt-1 text-muted">Lo más reciente de todos los cursos.</p>
          </div>
          <Link href="/explore" className="text-sm text-accent underline underline-offset-2">
            Ver todos los proyectos
          </Link>
        </div>

        <div className="mt-6 max-w-2xl">
          <SearchField size="lg" />
        </div>

        <nav aria-label="Categorías" className="mt-4 flex flex-wrap gap-2">
          {PRIMARY_CATEGORIES.map((category) => (
            <Link key={category} href={exploreHref({ tag: category })} className="chip">
              {category}
            </Link>
          ))}
        </nav>

        <div className="mt-9">
          {latest.projects.length > 0 ? (
            <ProjectGrid projects={latest.projects} label="Proyectos recientes" />
          ) : (
            <EmptyState
              title="Todavía no hay proyectos publicados"
              description="En cuanto alguien publique el primero, aparecerá aquí."
              action={{ href: '/publish', label: 'Publicar el primero' }}
            />
          )}
        </div>
      </section>

      {/* ---------- Cursos ---------- */}
      {courses.length > 0 && (
        <section aria-labelledby="cursos" className="container-page pt-16">
          <h2 id="cursos" className="section-mark font-display text-h2">
            Galerías por curso
          </h2>
          <p className="mt-1 text-muted">Cada materia tiene su propia exposición.</p>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={coursePath(course.slug)}
                  className="panel block h-full p-5 no-underline transition-colors hover:border-line-strong"
                >
                  <p className="meta">{course.term}</p>
                  <h3 className="mt-2 font-display text-h3">{course.name}</h3>
                  <p className="mt-1 text-sm text-muted">{course.institution}</p>
                  <p className="mt-4 text-sm text-subtle tabular-nums">
                    {course.projectCount} proyectos · {course.studentCount} estudiantes
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- Llamada final ---------- */}
      <section className="container-page pt-16">
        <div className="panel flex flex-col items-start gap-6 bg-sunken p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-h2">¿Hiciste una página para tu clase?</h2>
            <p className="mt-2 max-w-xl text-muted">
              No hace falta saber Git, GitHub, npm ni comprar un dominio. Si tienes un archivo
              HTML, tienes un sitio publicable en tres pasos.
            </p>
          </div>
          <Link href="/publish" className="btn btn-primary btn-lg shrink-0">
            Publicar proyecto
          </Link>
        </div>
      </section>
    </>
  );
}
