import 'server-only';

import type { CourseRole, ResourceStatus } from '../types';

/**
 * Quién ve qué recurso dentro de una materia.
 *
 * Esta regla existía escrita a mano dentro de `api/courses/[id]/library`. Salió
 * de ahí al aparecer la búsqueda global, y no por limpieza: **dos copias de una
 * regla de visibilidad son dos reglas**, y la que se olvida de actualizar es
 * siempre la que enseña de más. La búsqueda mira exactamente lo mismo que la
 * biblioteca porque llama a esta función, no porque alguien la haya copiado bien.
 *
 * El criterio, que no cambia:
 *
 *  · El profesorado ve TODO, incluidas las propuestas pendientes. Sin eso no
 *    podría moderarlas.
 *  · El alumnado ve lo aprobado, más LO SUYO en cualquier estado. Lo segundo
 *    importa: quien propone algo tiene derecho a saber qué pasó con su
 *    propuesta, y una que desaparece sin rastro sólo produce la misma propuesta
 *    otra vez la semana siguiente.
 */
export function resourceVisibleTo(
  role: CourseRole,
  handle: string
): (item: { status: ResourceStatus; author: { handle: string } | null }) => boolean {
  if (role === 'teacher') return () => true;
  return (item) => item.status === 'approved' || item.author?.handle === handle;
}
