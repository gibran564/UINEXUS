import { Landing } from '@/components/home/landing';
import { HomeGate } from '@/components/home/home-gate';
import {
  listCourses,
  listFeaturedProjects,
  listProjects,
} from '@/lib/data/repository';

export const revalidate = 300;

/**
 * `/`, según quién mira.
 *
 * Un visitante ve la portada pública. Alguien con sesión ve su Inicio: sus
 * tareas, lo que publicó su docente y lo que está haciendo su clase. Hasta hoy
 * un estudiante autenticado aterrizaba en el escaparate y tenía que buscar la
 * puerta de su aula; eso es una pantalla de más entre él y lo que vino a hacer.
 *
 * ## Por qué el reparto ocurre en el navegador y no en el servidor
 *
 * La sesión de UINexus es un ID token de Firebase en memoria del navegador, no
 * una cookie: el servidor de esta página NO sabe quién pide (ver la nota de
 * `lib/aula-client.ts`). Un `redirect()` server-side necesitaría una cookie de
 * sesión, que es un cambio de arquitectura de autenticación, no de portada.
 *
 * Así que los datos públicos se siguen cargando aquí —la portada llega como
 * HTML completo, indexable— y `HomeGate` decide qué se enseña. El destello del
 * escaparate lo evita `SessionScript`, que oculta la portada antes de la
 * primera pintura cuando la última sesión de este navegador estaba iniciada.
 */
export default async function HomePage() {
  const [featured, latest, courses] = await Promise.all([
    listFeaturedProjects(3),
    listProjects({ sort: 'recent' }, 1, 6),
    listCourses(),
  ]);

  return (
    <HomeGate>
      <Landing featured={featured} latest={latest.projects} courses={courses} />
    </HomeGate>
  );
}
