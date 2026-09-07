/**
 * Conserva deep links internos tras autenticar, sin aceptar URLs externas ni
 * rutas protocol-relative. El Inicio académico es el destino por defecto.
 */
export function postLoginDestination(requestedNext: string | null): string {
  return requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/';
}
