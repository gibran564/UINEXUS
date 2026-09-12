/** Normaliza texto libre a un slug seguro para URL. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

/**
 * Palabras que no pueden ser handle porque chocan con rutas de la plataforma o
 * con el nombre del producto.
 *
 * `uinexus` sigue aquí y no se quita al cambiar la marca: liberarlo permitiría
 * a cualquiera registrar `@uinexus` y hacerse pasar por la plataforma anterior,
 * que es exactamente el problema que la lista viene a evitar. Un nombre
 * reservado se AÑADE; no se devuelve.
 *
 * Se añaden sólo los nombres del producto, y sólo los que nadie podría estar
 * usando ya: esta lista la comprueba también el esquema del perfil, así que
 * reservar retroactivamente una palabra común dejaría a quien la tuviera sin
 * poder guardar su propio perfil. `nexia` se reservará cuando NexIA exista, tras
 * comprobar que no lo tiene nadie.
 */
const RESERVED_HANDLES = new Set([
  'explore', 'courses', 'about', 'login', 'logout', 'publish', 'dashboard',
  'admin', 'api', 'settings', 'help', 'terms', 'privacy', 'www',
  'projects', 'static', 'assets', 'new', 'edit', 'search', 'signup', 'signin',
  'nextudio', 'nexlab', 'nexcode', 'uinexus',
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !isReservedHandle(handle);
}

/** Quita el "@" inicial de un parámetro de ruta y lo normaliza. */
export function parseHandleParam(param: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    return null;
  }
  if (!decoded.startsWith('@')) return null;
  const handle = decoded.slice(1).toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

/** El chrome de Nextudio se oculta sólo en la ruta exacta del Project Shell. */
export function isProjectShellPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return (
    parts.length === 2 &&
    parseHandleParam(parts[0] ?? '') !== null &&
    SLUG_PATTERN.test(parts[1] ?? '')
  );
}

/** Sugiere un slug libre añadiendo sufijo numérico. */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const root = slugify(base) || 'proyecto';
  if (!taken.includes(root)) return root;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${root}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
