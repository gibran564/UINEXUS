'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ENABLED_PROGRAMMING_LANGUAGES,
  DEFAULT_PROGRAMMING_LANGUAGE,
  languageCapabilities,
  programmingLanguageLabel,
} from '@/lib/constants';
import { relativeTime } from '@/lib/relative-time';
import {
  createNexBook,
  createWorkspace,
  deleteNexBook,
  deleteWorkspace,
  importNexBookArchive,
  useApi,
} from '@/lib/aula-client';
import { NEXIA_DEFAULT_TITLE, nexiaPresetDocument } from '@/lib/nexia-preset';
import { Field, Notice } from '@/components/aula/aula-ui';
import { EmptyState } from '@/components/ui/empty-state';
import type { WorkspaceSummary } from '@/lib/types';

/**
 * Mis espacios: NexLab y NexCode personales.
 *
 * ## Dos formas, una lista
 *
 * Un **NexLab** —explicación, código, datos y resultados en un documento— y un
 * **NexCode** de un solo archivo. Comparten lista porque comparten para qué
 * sirven: construir sin que cuente como entrega. La lista sale de UNA consulta
 * (ver `listWorkspaceSummariesForOwner`); dos listas separadas habrían obligado
 * a fusionar y reordenar en el navegador, y «lo último que toqué» dejaría de
 * ser cierto.
 *
 * ## NexLab es el espacio; NexBook sigue siendo el documento
 *
 * No se renombró nada por dentro. `NexBook` es la entidad, el formato y la
 * extensión `.nexbook`, y por eso el botón de importar sigue hablando de
 * `.nexbook`: eso es el ARCHIVO. Lo que cambió es cómo se llama el sitio donde
 * se trabaja, que antes no tenía nombre propio.
 *
 * ## Por qué la pantalla se llama «Espacios» y la ruta sigue siendo /practicas
 *
 * Porque «práctica» dejó de describir lo que hay aquí —un laboratorio con datos
 * y gráficas no es una práctica— pero la ruta tiene enlaces repartidos y
 * cambiarla no arreglaría nada. Ver `docs/NEXTUDIO-ROADMAP.md` §D4.
 *
 * Todo es privado y no hay interruptor de visibilidad: enseñar un espacio se
 * hace convirtiéndolo en entrega, en publicación o en proyecto, no con un
 * permiso que nadie sabe interpretar.
 *
 * ## Los filtros NO piden nada al servidor
 *
 * La respuesta de `/api/workspaces` ya trae `kind` y `updatedAt` de cada fila, y
 * son doscientas como mucho. Filtrar aquí es instantáneo y no añade una consulta
 * por pulsación; pedirle al servidor «los de tipo NexLab» habría sido inventar
 * un parámetro para hacer peor lo que el navegador ya puede hacer bien.
 *
 * El estado vive en la URL (`?tipo=`) igual que en `/explore` y en el muro: un
 * filtro que no sobrevive a una recarga obliga a volver a ponerlo cada vez, y no
 * se puede compartir ni guardar en marcadores.
 */

/**
 * Las tres puertas del lanzador.
 *
 * `nexia` NO es una clase de espacio: es un NexBook sembrado. Por eso vive en
 * esta unión —que dice qué formulario se abre— y no en `WorkspaceKind`, que dice
 * qué se guarda. Lo creado aparece en la lista como un NexLab más, porque eso
 * es. Ver `lib/nexia-preset.ts`.
 */
type NewKind = 'nexbook' | 'code' | 'nexia';

/**
 * Los cuatro cortes de la lista.
 *
 * `recent` no es un ORDEN —la lista ya llega con lo último tocado primero— sino
 * un CORTE: los últimos siete días. Con cuarenta espacios acumulados de un
 * semestre, «lo de esta semana» es una pregunta distinta de «todos».
 */
type Filter = 'all' | 'nexlab' | 'nexcode' | 'recent';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'nexlab', label: 'NexLab' },
  { value: 'nexcode', label: 'NexCode' },
  { value: 'recent', label: 'Recientes' },
];

/**
 * Qué es cada puerta, dicho al abrir el formulario.
 *
 * El de NexIA evita a propósito «pregunta», «genera» y «respuesta de Nextudio»:
 * la plataforma no ejecuta ninguna IA, y el copy del lanzador es el primer sitio
 * donde eso se puede entender mal.
 */
const LAUNCHER_HINT: Readonly<Record<NewKind, string>> = {
  nexbook: 'NexLab · texto, código, datos y resultados en un documento',
  code: 'NexCode · un solo programa, un solo lenguaje',
  nexia: 'NexIA · registra de forma trazable cómo utilizaste una IA',
};

const RECENT_DAYS = 7;

function isRecent(iso: string): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then <= RECENT_DAYS * 24 * 60 * 60 * 1000;
}

function keep(item: WorkspaceSummary, filter: Filter): boolean {
  if (filter === 'nexlab') return item.kind === 'nexbook';
  if (filter === 'nexcode') return item.kind === 'code';
  if (filter === 'recent') return isRecent(item.updatedAt);
  return true;
}

export function PracticeList() {
  const router = useRouter();
  const { data, state, error, reload } = useApi<{ workspaces: WorkspaceSummary[] }>(
    '/api/workspaces'
  );

  const [creating, setCreating] = useState<NewKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<string>(DEFAULT_PROGRAMMING_LANGUAGE);
  const [filter, setFilter] = useState<Filter>('all');

  // El filtro de la URL se lee UNA vez al abrir. Después manda el estado: leerlo
  // en cada render haría que el botón y la dirección se pelearan.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tipo');
    if (FILTERS.some((option) => option.value === requested)) setFilter(requested as Filter);
  }, []);

  const chooseFilter = useCallback((next: Filter) => {
    setFilter(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'all') params.delete('tipo');
    else params.set('tipo', next);
    const query = params.toString();
    // `replaceState` y no `push`: cuatro filtros pulsados seguidos no deberían
    // costar cuatro pasos de «atrás».
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, []);

  async function create(): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      if (creating === 'nexbook' || creating === 'nexia') {
        const { nexbook } = await createNexBook({
          title: title.trim(),
          // Un NexIA es un NexBook que nace con dos bloques. El servidor lo
          // valida con el MISMO esquema y lo guarda con el mismo `kind`.
          ...(creating === 'nexia' ? { document: nexiaPresetDocument() } : {}),
        });
        // Se entra directo a NexLab: crear un documento vacío y volver a la
        // lista para abrirlo sería un clic de más sin ninguna razón.
        router.push(`/practicas/nexbook/${nexbook.id}`);
        return;
      }
      await createWorkspace({ title: title.trim(), language });
      setTitle('');
      setCreating(null);
      reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo crear.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: WorkspaceSummary): Promise<void> {
    setBusy(true);
    try {
      await (item.kind === 'nexbook' ? deleteNexBook(item.id) : deleteWorkspace(item.id));
      reload();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    } finally {
      setBusy(false);
    }
  }

  const workspaces = useMemo(() => data?.workspaces ?? [], [data]);
  const visible = useMemo(
    () => workspaces.filter((item) => keep(item, filter)),
    [workspaces, filter]
  );

  /** Cuántos hay de cada corte. Un filtro que da cero se ve antes de pulsarlo. */
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((option) => [option.value, workspaces.filter((item) => keep(item, option.value)).length])
      ) as Record<Filter, number>,
    [workspaces]
  );

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-h1">Mis espacios</h1>
          <p className="mt-1 max-w-xl text-muted">
            Para construir sin entregar nada. <strong className="font-medium text-fg">NexLab</strong>{' '}
            reúne explicación, código, datos y resultados en un documento;{' '}
            <strong className="font-medium text-fg">NexCode</strong> es un archivo suelto para
            programar rápido; <strong className="font-medium text-fg">NexIA</strong> registra de
            forma trazable cómo utilizaste una IA. Sólo tú los ves.
          </p>
        </div>
        {!creating && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCreating('nexbook')}
              className="btn btn-primary"
            >
              + Nuevo NexLab
            </button>
            <button
              type="button"
              onClick={() => setCreating('code')}
              className="btn btn-secondary"
            >
              + Nuevo NexCode
            </button>
            <button
              type="button"
              onClick={() => setCreating('nexia')}
              className="btn btn-secondary"
            >
              + Nuevo NexIA
            </button>
            <ImportButton
              onImported={(nexbookId) => router.push(`/practicas/nexbook/${nexbookId}`)}
              onError={setFormError}
            />
          </div>
        )}
      </header>

      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="panel mt-6 p-5"
        >
          <p className="meta">{LAUNCHER_HINT[creating]}</p>

          <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Nombre">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  creating === 'nexia'
                    ? NEXIA_DEFAULT_TITLE
                    : creating === 'nexbook'
                      ? 'Método simplex'
                      : 'Two Sum'
                }
                maxLength={120}
                autoFocus
                className="field"
              />
            </Field>

            {creating === 'code' && (
              <Field label="Lenguaje">
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="field"
                >
                  {ENABLED_PROGRAMMING_LANGUAGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {option.capabilities.browserExecution ? '' : ' · sin ejecución'}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={busy || !title.trim()} className="btn btn-primary">
                {busy ? 'Creando…' : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(null);
                  setFormError(null);
                }}
                className="btn btn-ghost"
              >
                Cancelar
              </button>
            </div>
          </div>

          {creating === 'nexbook' && (
            <p className="hint mt-2">
              Un NexLab puede mezclar varios lenguajes: cada bloque de código elige el suyo.
            </p>
          )}

          {creating === 'nexia' && (
            <p className="hint mt-2">
              Se crea un NexLab con un bloque para registrar qué herramienta usaste, qué le pediste,
              qué te contestó y qué hiciste con eso. Nextudio no ejecuta ninguna IA.
            </p>
          )}
        </form>
      )}

      {formError && (
        <div className="mt-4">
          <Notice tone="error">{formError}</Notice>
        </div>
      )}

      {workspaces.length > 0 && (
        <div
          role="group"
          aria-label="Filtrar espacios"
          className="mt-8 flex flex-wrap items-center gap-2 border-b border-line pb-3"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => chooseFilter(option.value)}
              className="chip"
            >
              {option.label}{' '}
              <span className="tabular-nums text-subtle">{counts[option.value]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        {state === 'loading' && <p className="py-10 text-center text-muted">Cargando…</p>}

        {state === 'error' && (
          <Notice tone="error">{error ?? 'No pudimos abrir tus espacios.'}</Notice>
        )}

        {state === 'ready' && workspaces.length === 0 && !creating && (
          <EmptyState
            title="Todavía no tienes espacios"
            description="Crea un NexLab para mezclar explicación, código y resultados, o un NexCode para probar algo rápido."
          />
        )}

        {/* Hay espacios, pero ninguno pasa el filtro. Se dice cuál, y se ofrece
            deshacerlo: un vacío sin explicación parece que se perdió algo. */}
        {state === 'ready' && workspaces.length > 0 && visible.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-muted">
              Ninguno de tus {workspaces.length} espacios entra en «
              {FILTERS.find((option) => option.value === filter)?.label}».
            </p>
            <button
              type="button"
              onClick={() => chooseFilter('all')}
              className="btn btn-secondary btn-sm mt-3"
            >
              Ver todos
            </button>
          </div>
        )}

        {visible.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {visible.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link href={pathFor(item)} className="min-w-0 flex-1 no-underline">
                  <span className="block truncate font-medium text-fg">{item.title}</span>
                  <span className="mt-0.5 block text-label text-subtle">{describe(item)}</span>
                </Link>
                {/* Todo lo de esta pantalla es privado, y decirlo en cada fila
                    es lo que evita la duda al ir a compartir algo. */}
                <span className="text-label text-subtle">Privado</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(item)}
                  className="btn btn-ghost btn-sm"
                  aria-label={`Borrar ${item.title}`}
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function pathFor(item: WorkspaceSummary): string {
  return item.kind === 'nexbook' ? `/practicas/nexbook/${item.id}` : `/practicas/${item.id}`;
}

/** La segunda línea de cada fila. Dice qué es y cuándo se tocó. */
function describe(item: WorkspaceSummary): string {
  const when = `guardado ${relativeTime(item.updatedAt)}`;

  if (item.kind === 'nexbook') {
    const blocks = item.blockCount ?? 0;
    return `NexLab · ${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} · ${when}`;
  }

  const language = programmingLanguageLabel(item.language);
  const runnable = languageCapabilities(item.language).browserExecution;
  return `NexCode · ${language}${runnable ? '' : ' · sin ejecución'} · ${when}`;
}

/**
 * Importar un `.nexbook`.
 *
 * El archivo se manda al servidor tal cual y es él quien lo abre: descomprimir
 * en el navegador para «validar antes de subir» daría una falsa sensación de
 * control —quien quiera saltárselo llama a la API directamente— y duplicaría las
 * comprobaciones que de verdad protegen, que son las del servidor.
 *
 * El documento importado nace SIEMPRE como propio y privado, sea de quien sea el
 * archivo. Ver `app/api/nexbooks/import/route.ts`.
 */
function ImportButton({
  onImported,
  onError,
}: {
  onImported: (nexbookId: string) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function accept(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const nexbook = await importNexBookArchive(file);
      onImported(nexbook.id);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'No se pudo importar.');
    } finally {
      setBusy(false);
      // Se limpia el campo: sin esto, volver a elegir EL MISMO archivo no
      // dispara `change` y parecería que el botón dejó de funcionar.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn btn-ghost"
      >
        {busy ? 'Importando…' : 'Importar .nexbook'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".nexbook,application/zip"
        className="sr-only"
        aria-label="Archivo .nexbook para importar"
        onChange={(event) => void accept(event.target.files?.[0])}
      />
    </>
  );
}
