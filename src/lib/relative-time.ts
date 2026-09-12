/**
 * «hace 3 min», que es lo que de verdad se quiere saber de un borrador.
 *
 * Una fecha absoluta obliga a calcular. Lo que responde a «¿dónde está lo que
 * hice?» es si fue hace un rato o hace un mes, y por eso pasada la semana sí se
 * dice la fecha: «hace 43 días» tampoco significa nada.
 *
 * Vive aquí porque lo usan la lista de Espacios y la paleta de búsqueda, y dos
 * formateadores de lo mismo acaban redondeando distinto.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'sin fecha';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'sin fecha';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;

  return new Date(iso).toLocaleDateString('es-MX');
}
