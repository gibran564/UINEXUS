/**
 * Búsqueda como formulario GET nativo.
 *
 * A propósito no es un componente de cliente: funciona sin JavaScript, la
 * consulta queda en la URL (se puede compartir y volver atrás) y no hay
 * ninguna carga de red hasta que la persona envía. Un buscador "en vivo" aquí
 * sólo añadiría parpadeo y peticiones.
 */
export function SearchField({
  defaultValue = '',
  hidden = {},
  size = 'md',
}: {
  defaultValue?: string;
  /** Filtros activos que deben sobrevivir a la búsqueda. */
  hidden?: Record<string, string | null | undefined>;
  size?: 'md' | 'lg';
}) {
  return (
    <form role="search" action="/explore" method="get" className="flex gap-2">
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null
      )}

      <div className="relative flex-1">
        <label htmlFor="explore-q" className="sr-only">
          Buscar proyectos por título, autor, curso o etiqueta
        </label>
        <svg
          viewBox="0 0 16 16"
          width="17"
          height="17"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
        >
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          id="explore-q"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Buscar por título, autor, curso o etiqueta…"
          className={`field pl-10 ${size === 'lg' ? 'min-h-12 text-lead' : ''}`}
        />
      </div>

      <button type="submit" className={`btn btn-secondary ${size === 'lg' ? 'btn-lg' : ''}`}>
        Buscar
      </button>
    </form>
  );
}
