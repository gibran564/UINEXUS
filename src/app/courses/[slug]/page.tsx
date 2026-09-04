import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectGrid } from '@/components/project/project-grid';
import { SearchField } from '@/components/explore/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import { getCourseBySlug, listCourses, listProjects } from '@/lib/data/repository';
import { exploreHref } from '@/lib/urls';

export const revalidate = 300;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const courses = await listCourses();
  return courses.map((course) => ({ slug: course.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) return { title: 'Curso no encontrado' };

  return {
    title: `${course.name} · ${course.term}`,
    description: course.description,
    openGraph: {
      title: `${course.name} · ${course.term}`,
      description: course.description,
    },
  };
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const course = await getCourseBySlug(slug);
  if (!course) notFound();

  const search = typeof query.q === 'string' ? query.q : '';
  const tag = typeof query.tag === 'string' ? query.tag : null;

  const { projects, total } = await listProjects(
    { courseId: course.id, query: search, tag, sort: 'featured' },
    1,
    60
  );

  const tags = [...new Set(projects.flatMap((project) => project.tags))].slice(0, 8);

  return (
    <div className="container-page py-10">
      <nav aria-label="Ruta">
        <Link href="/courses" className="text-sm text-muted no-underline hover:text-fg">
          ← Cursos
        </Link>
      </nav>

      <header className="mt-4 border-b border-line pb-8">
        <p className="meta">{course.institution}</p>
        <h1 className="mt-2 font-display text-h1">{course.name}</h1>
        <p className="mt-1 text-lead text-muted">{course.term}</p>
        <p className="mt-4 max-w-prose text-muted">{course.description}</p>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Estudiantes" value={course.studentCount} />
          <Stat label="Proyectos publicados" value={total} />
          <div>
            <dt className="meta">Docente</dt>
            <dd className="mt-1 text-lead">{course.teacherName}</dd>
          </div>
        </dl>
      </header>

      {course.activities.length > 0 && (
        <section aria-labelledby="actividades" className="border-b border-line py-8">
          <h2 id="actividades" className="section-mark font-display text-h2">
            Actividades del curso
          </h2>
          <p className="mt-1 text-muted">
            Cada entrega se publica como un proyecto normal y se comparte con su enlace.
          </p>

          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {course.activities.map((activity) => (
              <li key={activity.id} className="panel p-5">
                <h3 className="font-display text-h3">{activity.title}</h3>
                <p className="mt-2 text-sm text-muted">{activity.description}</p>
                {activity.dueDate && (
                  <p className="mt-4 text-sm text-subtle">
                    Fecha límite:{' '}
                    <time dateTime={activity.dueDate}>
                      {new Date(`${activity.dueDate}T12:00:00Z`).toLocaleDateString('es-MX', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </time>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="galeria" className="py-8">
        <h2 id="galeria" className="section-mark font-display text-h2">
          Galería del grupo
        </h2>

        <div className="mt-5 max-w-xl">
          <SearchField defaultValue={search} hidden={{ course: course.id }} />
        </div>

        {tags.length > 0 && (
          <nav aria-label="Filtrar la galería del curso" className="mt-4 flex flex-wrap gap-2">
            <CourseChip href={`/courses/${course.slug}`} active={!tag}>
              Todos
            </CourseChip>
            {tags.map((value) => (
              <CourseChip
                key={value}
                href={`/courses/${course.slug}?tag=${encodeURIComponent(value)}`}
                active={tag === value}
              >
                {value}
              </CourseChip>
            ))}
          </nav>
        )}

        <div className="mt-8">
          {projects.length > 0 ? (
            <ProjectGrid projects={projects} label={`Proyectos de ${course.name}`} />
          ) : (
            <EmptyState
              title="Este curso aún no tiene proyectos publicados"
              description="Cuando el grupo empiece a publicar sus entregas, aparecerán aquí."
              action={{ href: exploreHref({}), label: 'Explorar otros proyectos' }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="mt-1 font-display text-h2 tabular-nums">{value}</dd>
    </div>
  );
}

function CourseChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? 'true' : undefined} className="chip">
      {children}
    </Link>
  );
}
