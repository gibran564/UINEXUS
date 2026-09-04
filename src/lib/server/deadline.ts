import 'server-only';

import { formatDueLabel, isPastDue, type DueFields } from '../due-date';
import { HttpError } from './session';

/**
 * El cierre REAL de las entregas.
 *
 * Está en el servidor y usa SU reloj: la hora que mande el cliente no
 * interviene. Deshabilitar el botón en React evita el susto, pero no cierra
 * nada; esto sí.
 *
 * Responde 409 —el mismo estado que ya usa esta API para «tu petición es
 * válida pero el estado de la actividad no la admite», como entregar con pasos
 * obligatorios sin hacer— y dice la fecha, porque «no se puede» sin decir
 * cuándo terminó obliga a ir a buscarlo.
 */
export function assertOpenForSubmission(assignment: DueFields): void {
  if (!isPastDue(assignment)) return;

  const label = formatDueLabel(assignment);
  throw new HttpError(
    409,
    label
      ? `La fecha límite de esta actividad ya terminó (${label}).`
      : 'La fecha límite de esta actividad ya terminó.'
  );
}
