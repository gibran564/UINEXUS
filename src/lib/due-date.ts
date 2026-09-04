/**
 * La fecha límite de una actividad, como INSTANTE.
 *
 * Módulo puro —sin red y sin `server-only`— porque la misma regla tiene que
 * poder ejecutarse en tres sitios: el navegador para decidir qué pinta, el
 * servidor para rechazar de verdad, y las pruebas sin nube.
 *
 * ## Por qué hay dos campos
 *
 * Hasta esta iteración una tarea sólo tenía `dueDate` («2026-09-11»), que no
 * dice a qué hora se cierra. Ahora se guarda además `dueAt`, un instante ISO en
 * UTC que el navegador compone a partir de la fecha y la hora LOCALES de quien
 * crea la tarea. `dueDate` se sigue escribiendo con la parte de fecha local para
 * que todo lo que ya lo leía —el orden del aula, la ficha pública de la
 * materia— siga funcionando sin tocarse.
 *
 * ## Qué se hace con una tarea antigua
 *
 * Una tarea que sólo tiene `dueDate` NO se migra. Se interpreta como el final
 * de ese día en la zona horaria más tardía del planeta (UTC−12). Es un fallback
 * deliberadamente PERMISIVO: nunca cierra la entrega antes del final del día de
 * nadie. Cerrar antes de tiempo por un dato que nunca tuvo hora sería inventar
 * una regla que la docente no escribió.
 */

export interface DueFields {
  /** Fecha local «YYYY-MM-DD». Es lo único que tienen las tareas antiguas. */
  dueDate: string | null;
  /** Instante ISO en UTC. Lo componen los formularios nuevos. */
  dueAt?: string | null;
}

/** El día sin hora se cierra al final del día en la zona más tardía (UTC−12). */
const LATEST_END_OF_DAY = 'T23:59:59.999-12:00';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** El instante en que la actividad deja de recibir entregas. `null` = nunca. */
export function resolveDueInstant(assignment: DueFields): Date | null {
  const explicit = assignment.dueAt?.trim();
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const legacy = assignment.dueDate?.trim();
  if (legacy && DATE_ONLY.test(legacy)) {
    const parsed = new Date(`${legacy}${LATEST_END_OF_DAY}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

/**
 * ¿Se pasó la fecha límite?
 *
 * `now` se inyecta para poder probar sin depender del reloj real. En el
 * servidor se llama SIEMPRE sin argumento: la hora la pone él, nunca el
 * cliente.
 */
export function isPastDue(assignment: DueFields, now: Date = new Date()): boolean {
  const due = resolveDueInstant(assignment);
  return due !== null && now.getTime() > due.getTime();
}

/** Descompone una fecha límite en los dos campos del formulario, en local. */
export function splitDueAt(assignment: DueFields): { date: string; time: string } {
  const explicit = assignment.dueAt?.trim();
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) {
      const pad = (value: number) => String(value).padStart(2, '0');
      return {
        date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
        time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
      };
    }
  }

  const legacy = assignment.dueDate?.trim() ?? '';
  return { date: DATE_ONLY.test(legacy) ? legacy : '', time: '' };
}

/**
 * Compone el instante a partir de la fecha y la hora LOCALES del formulario.
 *
 * Sin fecha no hay límite. Sin hora se asume el final del día local: es lo que
 * significa «para el 11 de septiembre» cuando nadie dijo una hora, y se muestra
 * explícitamente en la interfaz para que no sea una suposición callada.
 */
export function composeDueAt(date: string, time: string): string | null {
  if (!DATE_ONLY.test(date.trim())) return null;

  const [year, month, day] = date.trim().split('-').map(Number);
  const [hours, minutes] = (/^\d{2}:\d{2}/.test(time) ? time : '23:59')
    .slice(0, 5)
    .split(':')
    .map(Number);

  const local = new Date(year!, month! - 1, day!, hours!, minutes!, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/**
 * En 24 horas, y no por gusto: el formulario captura la hora con un campo de 24
 * horas, así que mostrarla como «11:59 p.m.» obligaría a traducir mentalmente
 * lo que se acaba de escribir.
 */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/**
 * La fecha límite en lenguaje humano y en la zona horaria de quien mira.
 *
 * «11 sep 2026 · 23:59», nunca «2026-09-12T05:59:00.000Z». Una tarea antigua
 * sin hora se muestra sin hora: no se inventa una medianoche que nadie escribió.
 */
export function formatDueLabel(assignment: DueFields, locale = 'es-MX'): string {
  const explicit = assignment.dueAt?.trim();
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.toLocaleDateString(locale, DATE_FORMAT)} · ${parsed.toLocaleTimeString(
        locale,
        TIME_FORMAT
      )}`;
    }
  }

  const legacy = assignment.dueDate?.trim() ?? '';
  if (!DATE_ONLY.test(legacy)) return '';

  // Mediodía UTC: el día sale igual en cualquier zona horaria del planeta.
  return new Date(`${legacy}T12:00:00Z`).toLocaleDateString(locale, DATE_FORMAT);
}
