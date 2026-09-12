'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { relativeTime } from '@/lib/relative-time';
import {
  SEARCH,
  SEARCH_KIND_LABEL,
  SEARCH_PRIVACY_LABEL,
  matchesQuery,
  rankResults,
  searchTerms,
  type SearchResult,
} from '@/lib/search';
import type { WorkspaceSummary } from '@/lib/types';

/**
 * «Buscar en Nextudio».
 *
 * ## Dos niveles, y por qué se ven como dos secciones
 *
 * ```
 * Mis espacios        → ya está en memoria. Filtra al teclear, sin red.
 * En mis materias     → sólo lo sabe el servidor. Espera 250 ms y pregunta.
 * ```
 *
 * Mezclarlos en una sola lista habría obligado a esperar al servidor para pintar
 * algo, y lo que más se busca —«dónde está la práctica que hice el martes»— es
 * justo lo que el navegador ya tiene. Así la respuesta a eso es instantánea y el
 * resto llega cuando llega, sin que la lista dé saltos.
 *
 * La separación no es sólo de rendimiento: también es la frontera de privacidad.
 * Arriba hay cosas TUYAS, que ya viajaron a este navegador para pintar la
 * pantalla de Espacios. Abajo hay cosas de tus materias, que el servidor filtra
 * antes de mandarlas. Nada ajeno se descarga «por si acaso» para buscarlo aquí.
 *
 * ## Esto no es un explorador de archivos
 *
 * No hay carpetas, ni árbol, ni mover. Sin escribir nada se ven los últimos
 * espacios tocados, que es la respuesta correcta a «lo abro y no sé qué buscar».
 */

interface WorkspacesPayload {
  workspaces: WorkspaceSummary[];
}

/** Un espacio propio, con la forma de un resultado. */
function workspaceResult(item: WorkspaceSummary): SearchResult {
  const isLab = item.kind === 'nexbook';
  return {
    key: `${item.kind}:${item.id}`,
    kind: isLab ? 'nexlab' : 'nexcode',
    title: item.title,
    context: 'Mis espacios',
    author: null,
    updatedAt: item.updatedAt,
    privacy: 'private',
    href: isLab ? `/practicas/nexbook/${item.id}` : `/practicas/${item.id}`,
  };
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const [mine, setMine] = useState<WorkspaceSummary[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);

  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [remoteState, setRemoteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  /** El servidor recortó. Se dice, por la misma razón que se dice en una tabla. */
  const [truncated, setTruncated] = useState(false);

  /**
   * Los espacios propios se piden UNA vez por sesión de paleta y se quedan.
   * Es la misma consulta que ya hace la pantalla de Espacios (`byOwner`, un
   * resumen por fila), así que abrir la paleta no añade una fuente nueva: usa la
   * que ya existe.
   */
  useEffect(() => {
    if (!open || mine !== null) return;
    let alive = true;
    void (async () => {
      try {
        const data = await apiFetch<WorkspacesPayload>('/api/workspaces');
        if (alive) setMine(data.workspaces);
      } catch (caught) {
        if (!alive) return;
        setMine([]);
        setMineError(caught instanceof Error ? caught.message : 'No se pudieron leer tus espacios.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, mine]);

  const terms = useMemo(() => searchTerms(query), [query]);
  const longEnough = terms.join('').length >= SEARCH.minChars;

  /** Nivel 1: en memoria, sin red y sin esperar a nadie. */
  const localResults = useMemo(() => {
    const all = (mine ?? []).map(workspaceResult);
    if (!longEnough) return all.slice(0, 6);
    return rankResults(
      terms,
      all.filter((result) => matchesQuery(terms, result.title))
    );
  }, [mine, terms, longEnough]);

  /** Nivel 2: el servidor, con espera tras la última tecla. */
  useEffect(() => {
    if (!open) return;
    if (!longEnough) {
      setRemote([]);
      setRemoteState('idle');
      setRemoteError(null);
      setTruncated(false);
      return;
    }

    let alive = true;
    setRemoteState('loading');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await apiFetch<{ results: SearchResult[]; truncated: boolean }>(
            `/api/search?q=${encodeURIComponent(query)}`
          );
          if (!alive) return;
          setRemote(data.results);
          setTruncated(data.truncated);
          setRemoteState('ready');
        } catch (caught) {
          if (!alive) return;
          setRemote([]);
          setRemoteError(caught instanceof Error ? caught.message : 'No se pudo buscar.');
          setRemoteState('error');
        }
      })();
    }, SEARCH.debounceMs);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query, longEnough]);

  /** La lista navegable es la concatenación, en el orden en que se pinta. */
  const flat = useMemo(() => [...localResults, ...remote], [localResults, remote]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setRemote([]);
      setRemoteState('idle');
      setTruncated(false);
    }
  }, [open]);

  const go = useCallback(
    (result: SearchResult) => {
      onClose();
      router.push(result.href);
    },
    [onClose, router]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      if (!dialogRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length));
    } else if (event.key === 'Enter') {
      const chosen = flat[active];
      if (chosen) {
        event.preventDefault();
        go(chosen);
      }
    }
  }

  const nothing =
    longEnough && flat.length === 0 && remoteState !== 'loading' && remoteState !== 'error';

  return (
    // El fondo oscurecido NO captura el clic: el cierre por clic fuera lo lleva
    // el listener de `mousedown`, que también funciona cuando el foco está en el
    // campo. Un `onClick` aquí se habría comido el primer clic de una selección.
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en Nextudio"
        className="w-full max-w-2xl overflow-hidden rounded-md border border-line bg-raised"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" className="shrink-0 text-subtle">
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <label htmlFor={`${listId}-input`} className="sr-only">
            Buscar en Nextudio
          </label>
          <input
            id={`${listId}-input`}
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="Buscar en Nextudio…"
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            className="h-14 min-h-14 flex-1 border-0 bg-transparent text-lead outline-none placeholder:text-subtle"
          />
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm shrink-0">
            Esc
          </button>
        </div>

        <div id={listId} role="listbox" aria-label="Resultados" className="max-h-[60vh] overflow-y-auto">
          <Section
            title={longEnough ? 'Mis espacios' : 'Recientes'}
            hint={mineError ?? undefined}
            empty={longEnough && localResults.length === 0 ? 'Ningún espacio con ese nombre.' : undefined}
          >
            {localResults.map((result, index) => (
              <Row
                key={result.key}
                id={`${listId}-${index}`}
                result={result}
                active={index === active}
                onPick={() => go(result)}
                onHover={() => setActive(index)}
              />
            ))}
          </Section>

          {longEnough && (
            <Section
              title="En mis materias y proyectos"
              hint={
                remoteState === 'loading'
                  ? 'Buscando…'
                  : remoteState === 'error'
                    ? (remoteError ?? 'No se pudo buscar.')
                    : undefined
              }
              empty={
                remoteState === 'ready' && remote.length === 0
                  ? 'Nada con ese nombre en tus materias.'
                  : undefined
              }
            >
              {remote.map((result, index) => {
                const position = localResults.length + index;
                return (
                  <Row
                    key={result.key}
                    id={`${listId}-${position}`}
                    result={result}
                    active={position === active}
                    onPick={() => go(result)}
                    onHover={() => setActive(position)}
                  />
                );
              })}
            </Section>
          )}

          {longEnough && truncated && remoteState === 'ready' && (
            <p className="border-t border-line px-4 py-3 text-label text-subtle">
              Hay más coincidencias de las que caben aquí. Añade una palabra para acotar.
            </p>
          )}

          {!longEnough && (
            <p className="border-t border-line px-4 py-3 text-label text-subtle">
              Escribe al menos {SEARCH.minChars} letras para buscar también en tus materias, tus
              actividades, los materiales de clase y tus proyectos.
            </p>
          )}

          {nothing && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Nada coincide con «{query.trim()}».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  /**
   * `role="group"` y no una `<section>` a secas.
   *
   * Un `listbox` tiene que «poseer» sus `option`. Entre el contenedor y los
   * botones hay un encabezado y una lista, y sin marcarlos la relación se rompe:
   * el lector de pantalla anunciaría los resultados sueltos, sin decir cuántos
   * hay ni de qué grupo son. `group` conserva la cadena y da nombre al bloque;
   * `presentation` en la lista evita que además se anuncie «lista de 6
   * elementos» encima de «opción 3 de 6», que es la misma cuenta dicha dos veces.
   */
  return (
    <div role="group" aria-label={title} className="border-b border-line last:border-b-0">
      <p className="meta px-4 pt-3 pb-1">{title}</p>
      {hint && (
        <p role="status" className="px-4 pb-2 text-label text-subtle">
          {hint}
        </p>
      )}
      {empty ? (
        <p className="px-4 pb-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul role="presentation" className="pb-2">
          {children}
        </ul>
      )}
    </div>
  );
}

/**
 * Una fila dice cinco cosas, y las cinco hacen falta para no tener que abrirla:
 * qué es, cómo se llama, dónde pertenece, quién la hizo y cuándo se tocó.
 */
function Row({
  id,
  result,
  active,
  onPick,
  onHover,
}: {
  id: string;
  result: SearchResult;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <li role="presentation">
      <button
        type="button"
        id={id}
        role="option"
        aria-selected={active}
        onClick={onPick}
        onMouseEnter={onHover}
        className={`flex w-full items-baseline gap-3 px-4 py-2 text-left ${
          active ? 'bg-accent-soft' : 'hover:bg-sunken'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{result.title}</span>
          <span className="block truncate text-label text-subtle">
            {SEARCH_KIND_LABEL[result.kind]} · {result.context}
            {result.author ? ` · ${result.author}` : ''} · {relativeTime(result.updatedAt)}
          </span>
        </span>
        <span className="shrink-0 text-label text-subtle">
          {SEARCH_PRIVACY_LABEL[result.privacy]}
        </span>
      </button>
    </li>
  );
}
