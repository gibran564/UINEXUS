import { describe, expect, it } from 'vitest';
import {
  SEARCH,
  capResults,
  matchesQuery,
  normalizeForSearch,
  rankResults,
  searchTerms,
  type SearchResult,
} from '../../src/lib/search';

/**
 * El criterio de coincidencia de la búsqueda.
 *
 * Se prueba aquí y no a través de la ruta porque es lógica PURA y porque la
 * comparten los dos lados: el navegador filtra los espacios propios con estas
 * mismas funciones y el servidor filtra con ellas lo que sólo él puede leer. Un
 * fallo aquí haría que la misma palabra encontrara cosas distintas según de
 * dónde vinieran.
 */

function result(partial: Partial<SearchResult> & { key: string; title: string }): SearchResult {
  return {
    kind: 'nexlab',
    context: 'Mis espacios',
    author: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    privacy: 'private',
    href: '/',
    ...partial,
  };
}

describe('normalización', () => {
  it('quita acentos, mayúsculas y espacios de más', () => {
    expect(normalizeForSearch('  Método   SIMPLEX ')).toBe('metodo simplex');
    expect(normalizeForSearch('Investigación de Operaciones')).toBe('investigacion de operaciones');
  });

  it('deja la eñe en paz', () => {
    /**
     * `ñ` NO es «n con acento»: es una letra. Si la normalización la aplanara,
     * «año» y «ano» serían la misma palabra, y eso no es un detalle cosmético en
     * un producto que se usa en español.
     */
    expect(normalizeForSearch('Diseño')).toBe('diseño');
    expect(normalizeForSearch('año')).not.toBe('ano');
    expect(matchesQuery(searchTerms('ano'), 'año escolar')).toBe(false);
  });

  it('la diéresis sí se quita', () => {
    // Aquí no hay ninguna palabra que se convierta en otra, y «pinguino» tiene
    // que encontrar «pingüino».
    expect(normalizeForSearch('pingüino')).toBe('pinguino');
  });

  it('una consulta vacía no produce términos', () => {
    for (const empty of ['', '   ', '\n\t']) {
      expect(searchTerms(empty)).toEqual([]);
    }
  });
});

describe('coincidencia', () => {
  it('encuentra sin acentos lo que sí los tiene', () => {
    expect(matchesQuery(searchTerms('metodo'), 'Método simplex')).toBe(true);
    expect(matchesQuery(searchTerms('MÉTODO'), 'metodo simplex')).toBe(true);
  });

  it('coincide por subcadena, para que sirva mientras se escribe', () => {
    expect(matchesQuery(searchTerms('simp'), 'Método simplex')).toBe(true);
  });

  it('exige TODOS los términos, y busca en todos los campos', () => {
    const terms = searchTerms('simplex operaciones');
    expect(matchesQuery(terms, 'Método simplex', 'Investigación de Operaciones')).toBe(true);
    // Añadir una palabra tiene que REDUCIR la lista, nunca ampliarla.
    expect(matchesQuery(searchTerms('simplex transporte'), 'Método simplex')).toBe(false);
  });

  it('una consulta vacía no coincide con nada', () => {
    expect(matchesQuery([], 'Método simplex')).toBe(false);
    expect(matchesQuery(searchTerms(''), 'Método simplex')).toBe(false);
  });

  it('un contenido vacío no coincide con nada', () => {
    expect(matchesQuery(searchTerms('simplex'), '', null, undefined)).toBe(false);
  });
});

describe('orden', () => {
  it('primero lo que EMPIEZA por el término, después lo más reciente', () => {
    const ranked = rankResults(searchTerms('simplex'), [
      result({ key: 'a', title: 'Método simplex', updatedAt: '2026-03-01T00:00:00.000Z' }),
      result({ key: 'b', title: 'Simplex revisado', updatedAt: '2026-01-01T00:00:00.000Z' }),
      result({ key: 'c', title: 'Simplex dual', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(ranked.map((item) => item.key)).toEqual(['c', 'b', 'a']);
  });

  it('sin fecha no revienta el orden', () => {
    const ranked = rankResults(searchTerms('nota'), [
      result({ key: 'sin', title: 'Nota suelta', updatedAt: null }),
      result({ key: 'con', title: 'Nota con fecha', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ranked.map((item) => item.key)).toEqual(['con', 'sin']);
  });
});

describe('recorte', () => {
  it('no deja que una sola clase se coma la lista', () => {
    const many = Array.from({ length: SEARCH.perKind + 5 }, (_, index) =>
      result({ key: `lab-${index}`, title: `Lab ${index}` })
    );
    const others = [result({ key: 'code', title: 'Suelto', kind: 'nexcode' })];

    const kept = capResults([...many, ...others]);

    expect(kept.filter((item) => item.kind === 'nexlab')).toHaveLength(SEARCH.perKind);
    // Lo importante: el NexCode sigue ahí aunque llegara el último.
    expect(kept.some((item) => item.key === 'code')).toBe(true);
  });

  it('nunca devuelve más del tope total', () => {
    const kinds = ['nexlab', 'nexcode', 'project', 'assignment', 'material', 'prompt', 'skill', 'resource'] as const;
    const flood = kinds.flatMap((kind) =>
      Array.from({ length: SEARCH.perKind }, (_, index) =>
        result({ key: `${kind}-${index}`, title: `${kind} ${index}`, kind })
      )
    );

    expect(flood.length).toBeGreaterThan(SEARCH.maxResults);
    expect(capResults(flood).length).toBeLessThanOrEqual(SEARCH.maxResults);
  });

  it('conserva el orden que recibe', () => {
    const kept = capResults([
      result({ key: 'primero', title: 'A' }),
      result({ key: 'segundo', title: 'B' }),
    ]);
    expect(kept.map((item) => item.key)).toEqual(['primero', 'segundo']);
  });
});
