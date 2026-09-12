/**
 * Búsqueda en Nextudio: el modelo y el criterio de coincidencia.
 *
 * Este módulo es PURO y compartido: no declara lado (ni `'use client'` ni
 * `server-only`) por la misma razón que `lib/identity.ts`. El navegador filtra
 * con él lo que ya tiene en memoria —los espacios propios— y el servidor filtra
 * con él lo que sólo él puede leer. Una regla de coincidencia distinta en cada
 * lado haría que la misma palabra encontrara cosas distintas según de dónde
 * vinieran, y nadie sabría explicar por qué.
 *
 * ## Lo que la búsqueda NO es
 *
 * No es un sistema de archivos. No hay carpetas, ni rutas, ni mover, ni
 * renombrar para ordenar. La pregunta que resuelve es «¿dónde está aquello que
 * hice?», y se responde con contexto —qué es, de qué materia, cuándo se tocó— y
 * no con una jerarquía que alguien tenga que mantener a mano.
 *
 * No es tampoco un índice. No hay tabla nueva, ni proyección, ni sincronización:
 * se consulta lo que ya está y se filtra. El techo de esa decisión está medido y
 * escrito en `docs/NEXTUDIO-ROADMAP.md` §D8, junto con el momento en que habría
 * que cambiarla.
 */

/** Qué clase de cosa se encontró. Decide el icono, la etiqueta y el enlace. */
export type SearchResultKind =
  | 'nexlab'
  | 'nexcode'
  | 'project'
  | 'assignment'
  | 'material'
  | 'prompt'
  | 'skill'
  | 'resource';

/**
 * Quién puede verlo, dicho para quien lo lee y no para el servidor.
 *
 *  · `private`  sólo tú.
 *  · `course`   la gente de esa materia.
 *  · `public`   cualquiera con el enlace.
 *
 * Es una ETIQUETA derivada de dónde vive la cosa, no un permiso: el permiso ya
 * se aplicó antes de que el resultado existiera. Sirve para que nadie tenga que
 * adivinar si lo que acaba de encontrar lo ve alguien más.
 */
export type SearchPrivacy = 'private' | 'course' | 'public';

export interface SearchResult {
  /** Único dentro de la respuesta. No es necesariamente el id del registro. */
  key: string;
  kind: SearchResultKind;
  title: string;
  /** Dónde pertenece: «Mis espacios», o el nombre de la materia. */
  context: string;
  /** Quién lo creó. `null` cuando es de quien busca. */
  author: string | null;
  /** ISO, o `null` si el registro no guarda fecha útil. */
  updatedAt: string | null;
  privacy: SearchPrivacy;
  href: string;
}

export const SEARCH = {
  /**
   * Mínimo para consultar al servidor.
   *
   * Con una letra la respuesta es «casi todo», que no ayuda a nadie y cuesta un
   * abanico de consultas a DynamoDB por pulsación.
   */
  minChars: 2,
  /** Espera tras la última tecla antes de preguntar. */
  debounceMs: 250,
  /** Por clase de resultado, para que una materia con 200 tareas no tape el resto. */
  perKind: 8,
  /** Total devuelto. Más que esto no se lee: se refina la búsqueda. */
  maxResults: 40,
  /**
   * Materias que se recorren como mucho.
   *
   * El coste del nivel 2 es lineal en el número de materias de la persona. Con
   * seis son unas veinte consultas; el tope evita que una cuenta de
   * administración con cincuenta materias convierta cada pulsación en una
   * tormenta. Quien lo alcance verá resultados de sus materias más recientes,
   * que es el orden en que `listCoursesForUser` las devuelve.
   */
  maxCourses: 12,
} as const;

export const SEARCH_KIND_LABEL: Readonly<Record<SearchResultKind, string>> = {
  nexlab: 'NexLab',
  nexcode: 'NexCode',
  project: 'Proyecto',
  assignment: 'Actividad',
  material: 'Material de clase',
  prompt: 'Prompt',
  skill: 'Skill',
  resource: 'Recurso',
};

export const SEARCH_PRIVACY_LABEL: Readonly<Record<SearchPrivacy, string>> = {
  private: 'Privado',
  course: 'De clase',
  public: 'Publicado',
};

/**
 * Marcador temporal para la eñe: un carácter de control que no aparece en
 * ningún título escrito por una persona.
 */
const N_TILDE_GUARD = '\u0001';

/**
 * Texto comparable: sin mayúsculas, sin acentos y sin espacios de más.
 *
 * Los acentos se quitan en los DOS lados —consulta y contenido— para que
 * «metodo» encuentre «Método». Escribir con acentos en un campo de búsqueda es
 * justo lo que nadie hace con prisa, y que una tilde decida si algo aparece es
 * el tipo de detalle que hace pensar que la búsqueda no funciona.
 *
 * ## La eñe se protege, y no es un capricho
 *
 * `ñ` NO es «n con acento»: es una letra distinta. Al descomponer en Unicode
 * (NFD) se parte en `n` más una tilde combinante, así que el mismo filtro que
 * quita los acentos se la llevaría por delante y «año» pasaría a ser «ano». En
 * un producto que se usa en español eso no es un detalle cosmético, así que la
 * eñe se aparta antes de descomponer y se devuelve después.
 *
 * La diéresis sí se quita: «pinguino» tiene que encontrar «pingüino», y ahí no
 * hay ninguna palabra que se convierta en otra.
 */
export function normalizeForSearch(value: string): string {
  return (
    value
      // NFC primero: un texto que ya llegara descompuesto tendría la eñe en dos
      // piezas y el guardado de abajo no la reconocería.
      .normalize('NFC')
      .toLowerCase()
      .split('ñ')
      .join(N_TILDE_GUARD)
      .normalize('NFD')
      // Marcas diacríticas combinantes, escritas como puntos de código para que
      // el archivo no dependa de cómo guarde un editor los acentos sueltos.
      .replace(/[\u0300-\u036f]/g, '')
      .split(N_TILDE_GUARD)
      .join('ñ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Los términos de una consulta, ya normalizados.
 *
 * Se separan por espacios porque lo que la gente escribe es «simplex io», no una
 * frase exacta. Se exigen TODOS (ver `matchesQuery`): añadir una palabra tiene
 * que reducir la lista, que es lo que espera cualquiera que esté afinando.
 */
export function searchTerms(query: string): string[] {
  const normalized = normalizeForSearch(query);
  return normalized ? normalized.split(' ') : [];
}

/**
 * ¿Coinciden todos los términos con alguno de los campos?
 *
 * Coincidencia por SUBCADENA y no por palabra completa: «simp» tiene que
 * encontrar «simplex» mientras se escribe, o la búsqueda no sirve hasta la
 * última letra.
 */
export function matchesQuery(terms: readonly string[], ...fields: (string | null | undefined)[]): boolean {
  if (terms.length === 0) return false;
  const haystack = normalizeForSearch(fields.filter(Boolean).join(' '));
  if (!haystack) return false;
  return terms.every((term) => haystack.includes(term));
}

/**
 * Ordena por relevancia y luego por lo más reciente.
 *
 * La relevancia aquí es una sola cosa: si el término aparece al PRINCIPIO del
 * título. Alguien que escribe «simplex» buscando «Método simplex» y «Simplex
 * revisado» espera ver antes el que empieza así. Más allá de eso manda la fecha,
 * porque lo que se busca casi siempre es lo último que se tocó.
 */
export function rankResults(terms: readonly string[], results: SearchResult[]): SearchResult[] {
  const startsWithTerm = (result: SearchResult): number => {
    const title = normalizeForSearch(result.title);
    return terms.some((term) => title.startsWith(term)) ? 0 : 1;
  };

  return [...results].sort((a, b) => {
    const byPrefix = startsWithTerm(a) - startsWithTerm(b);
    if (byPrefix !== 0) return byPrefix;
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });
}

/** Recorta por clase y luego en total, conservando el orden ya calculado. */
export function capResults(results: readonly SearchResult[]): SearchResult[] {
  const perKind = new Map<SearchResultKind, number>();
  const kept: SearchResult[] = [];

  for (const result of results) {
    if (kept.length >= SEARCH.maxResults) break;
    const used = perKind.get(result.kind) ?? 0;
    if (used >= SEARCH.perKind) continue;
    perKind.set(result.kind, used + 1);
    kept.push(result);
  }

  return kept;
}
