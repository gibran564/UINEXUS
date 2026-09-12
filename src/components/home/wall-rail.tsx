'use client';

import Link from 'next/link';
import type { HomePayload } from '@/app/api/home/route';
import { UserAvatar } from '@/components/ui/user-avatar';

/**
 * El carril de contexto: quién eres y en qué materias estás.
 *
 * A partir de 1024 px es una columna fija de 280 px pegada al lado de la
 * columna principal. Por debajo no se comprime: desaparece, porque las dos
 * cosas que lleva ya están en el navbar y en `/aula`, y en un móvil la primera
 * pantalla tiene que ser lo que hay que hacer.
 *
 * ## Qué se fue de aquí
 *
 * «Necesita tu atención» vivía en este carril, recortado a tres filas por un
 * ancho de 280 px. Se mudó a la columna principal (`attention-panel`): lo que
 * decide la próxima hora de alguien no puede ser lo más estrecho de la
 * pantalla, y así dejó de competir con la lista de materias por el mismo sitio.
 */
export function WallRail({
  displayName,
  handle,
  avatarUrl,
  role,
  courses,
}: {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  role: HomePayload['role'];
  courses: HomePayload['courses'];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Identity displayName={displayName} handle={handle} avatarUrl={avatarUrl} role={role} />
      <CourseList courses={courses} />
    </div>
  );
}

const ROLE_LABEL: Record<HomePayload['role'], string> = {
  student: 'Estudiante',
  teacher: 'Docente',
  admin: 'Administración',
};

/** Sólo en escritorio: por debajo, el avatar del navbar ya dice quién eres. */
function Identity({
  displayName,
  handle,
  avatarUrl,
  role,
}: {
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  role: HomePayload['role'];
}) {
  if (!displayName) return null;

  return (
    <div className="panel hidden items-center gap-3 p-4 lg:flex">
      <UserAvatar name={displayName} src={avatarUrl} size={40} />
      <div className="min-w-0">
        <p className="truncate font-medium">{displayName}</p>
        <p className="truncate text-label text-subtle">
          {handle && <span className="font-mono">@{handle}</span>}
          {handle && ' · '}
          {ROLE_LABEL[role]}
        </p>
      </div>
    </div>
  );
}

/**
 * La lista de materias es navegación, no filtro: el filtro del muro vive sobre
 * el muro. En móvil no aparece —está en el navbar y en `/aula`— para que la
 * primera pantalla sea lo que hay que hacer y lo que se publicó.
 */
function CourseList({ courses }: { courses: HomePayload['courses'] }) {
  if (courses.length === 0) return null;

  return (
    <section aria-labelledby="tus-materias" className="hidden lg:block">
      <h2 id="tus-materias" className="meta">
        Tus materias
      </h2>
      <ul className="mt-2.5 space-y-0.5">
        {courses.map((course) => (
          <li key={course.id}>
            <Link
              href={`/aula/${course.id}`}
              className="flex min-h-9 items-center gap-2 rounded-xs px-2 text-sm text-muted hover:bg-sunken hover:text-fg"
            >
              <span className="truncate">{course.name}</span>
              {course.role === 'teacher' && (
                <span className="ml-auto shrink-0 text-label text-subtle">Docente</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
