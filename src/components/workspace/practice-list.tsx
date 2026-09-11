'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  ENABLED_PROGRAMMING_LANGUAGES,
  DEFAULT_PROGRAMMING_LANGUAGE,
  languageCapabilities,
  programmingLanguageLabel,
} from '@/lib/constants';
import {
  createNexBook,
  createWorkspace,
  deleteNexBook,
  deleteWorkspace,
  importNexBookArchive,
  useApi,
} from '@/lib/aula-client';
import { Field, Notice } from '@/components/aula/aula-ui';
import { EmptyState } from '@/components/ui/empty-state';
import type { WorkspaceSummary } from '@/lib/types';

/**
 * Mis prácticas: laboratorios personales.
 *
 * ## Dos formas, una lista
 *
 * Un NexBook —explicación, código y resultados en un documento— y una práctica
 * de un solo archivo. Comparten lista porque comparten para qué sirven: probar
 * cosas sin que cuenten como entrega. La lista sale de UNA consulta (ver
 * `listWorkspaceSummariesForOwner`); dos listas separadas habrían obligado a
 * fusionar y reordenar en el navegador, y «lo último que toqué» dejaría de ser
 * cierto.
 *
 * ## Por qué sigue llamándose «Prácticas»
 *
 * Porque es el nombre que ya está en la barra, en la ruta y en la cabeza de
 * quien lo usa. Renombrarlo a «Laboratorios» el mismo día que aparecen los
 * NexBooks obligaría a aprender dos cosas a la vez, y la palabra no es lo que
 * cambia aquí.
 *
 * Todo es privado y no hay interruptor de visibilidad: enseñar una práctica se
 * hará convirtiéndola en entrega o en proyecto, no con un permiso que nadie sabe
 * interpretar.
 */

type NewKind = 'nexbook' | 'code';

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

  async function create(): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      if (creating === 'nexbook') {
        const { nexbook } = await createNexBook({ title: title.trim() });
        // Se entra directo a Studio: crear un documento vacío y volver a la
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

  const workspaces = data?.workspaces ?? [];

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-h1">Mis prácticas</h1>
          <p className="mt-1 text-muted">
            Espacios para construir sin entregar nada. Sólo tú los ves.
          </p>
        </div>
        {!creating && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCreating('nexbook')}
              className="btn btn-primary"
            >
              + Nuevo NexBook
            </button>
            <button
              type="button"
              onClick={() => setCreating('code')}
              className="btn btn-secondary"
            >
              + Archivo suelto
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
          <p className="meta">
            {creating === 'nexbook'
              ? 'NexBook · texto, código y resultados en un documento'
              : 'Archivo suelto · un solo programa'}
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Nombre">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={creating === 'nexbook' ? 'Método simplex' : 'Two Sum'}
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
              Un NexBook puede mezclar varios lenguajes: cada bloque de código elige el suyo.
            </p>
          )}
        </form>
      )}

      {formError && (
        <div className="mt-4">
          <Notice tone="error">{formError}</Notice>
        </div>
      )}

      <div className="mt-8">
        {state === 'loading' && <p className="py-10 text-center text-muted">Cargando…</p>}

        {state === 'error' && (
          <Notice tone="error">{error ?? 'No pudimos abrir tus prácticas.'}</Notice>
        )}

        {state === 'ready' && workspaces.length === 0 && !creating && (
          <EmptyState
            title="Todavía no tienes prácticas"
            description="Crea un NexBook para mezclar explicación y código, o un archivo suelto para probar algo rápido."
          />
        )}

        {workspaces.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {workspaces.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link href={pathFor(item)} className="min-w-0 flex-1 no-underline">
                  <span className="block truncate font-medium text-fg">{item.title}</span>
                  <span className="mt-0.5 block text-label text-subtle">{describe(item)}</span>
                </Link>
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
  const when = relativeTime(item.updatedAt);

  if (item.kind === 'nexbook') {
    const blocks = item.blockCount ?? 0;
    return `NexBook · ${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} · ${when}`;
  }

  const language = programmingLanguageLabel(item.language);
  const runnable = languageCapabilities(item.language).browserExecution;
  return `${language}${runnable ? '' : ' · sin ejecución'} · ${when}`;
}

/**
 * «Guardado hace 3 min», que es lo que importa en una lista de borradores.
 *
 * Una fecha absoluta obliga a calcular; lo que se quiere saber es si es de hace
 * un rato o de hace un mes. Pasada la semana sí se dice la fecha: «hace 43 días»
 * tampoco significa nada.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'sin fecha';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'guardado ahora mismo';
  if (minutes < 60) return `guardado hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `guardado hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'guardado ayer';
  if (days < 7) return `guardado hace ${days} días`;

  return `guardado el ${new Date(iso).toLocaleDateString('es-MX')}`;
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
