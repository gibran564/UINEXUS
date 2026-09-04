import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { listCourses } from '@/lib/data/repository';
import { coursePath } from '@/lib/urls';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Cursos',
  description: 'Galerías oficiales de cada materia que publica en UINexus.',
};

export default async function CoursesPage() {
  const courses = await listCourses();

  return (
    <div className="container-page py-10">
      <header className="max-w-2xl">
        <h1 className="font-display text-h1">Cursos</h1>
        <p className="mt-2 text-muted">
          Cada materia tiene su galería: la exposición completa de lo que hizo el grupo durante
          el periodo.
        </p>
      </header>

      <div className="mt-9">
        {courses.length === 0 ? (
          <EmptyState
            title="Todavía no hay cursos"
            description="El profesorado crea los cursos y los grupos. En cuanto exista el primero, aparecerá aquí."
          />
        ) : (
          <ul className="grid gap-5 md:grid-cols-2">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={coursePath(course.slug)}
                  className="panel block h-full p-6 no-underline transition-colors hover:border-line-strong"
                >
                  <p className="meta">{course.term}</p>
                  <h2 className="mt-2 font-display text-h2">{course.name}</h2>
                  <p className="mt-1 text-sm text-muted">{course.institution}</p>
                  <p className="mt-3 max-w-prose text-muted">{course.description}</p>
                  <p className="mt-5 border-t border-line pt-4 text-sm text-subtle tabular-nums">
                    {course.projectCount} proyectos · {course.studentCount} estudiantes ·{' '}
                    {course.teacherName}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
