'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@/components/aula/code-editor';
import { Notice } from '@/components/aula/aula-ui';
import { patchWorkspace, useApi } from '@/lib/aula-client';
import { programmingLanguageLabel } from '@/lib/constants';
import type { CodeSaveState } from '@/components/aula/deliverable-fields';
import type { Workspace } from '@/lib/types';

/**
 * Una práctica abierta.
 *
 * ## Por qué reutiliza `CodeEditor` sin envolverlo en nada
 *
 * El editor ya sabe cargar Monaco sin SSR, seguir el tema, caer a un
 * `<textarea>` si no monta, arrancar el runtime bajo demanda, aplicar el tiempo
 * límite y decir «Ejecución no disponible» cuando el lenguaje no se ejecuta.
 * Nada de eso es específico de una entrega, así que nada de eso se reescribe
 * aquí. Lo único que cambia entre una práctica y un paso de actividad es DÓNDE
 * se guarda el texto.
 *
 * ## El autoguardado
 *
 * Mismo contrato que en el runner de actividades —800 ms tras la última tecla, y
 * guardado forzoso antes de ejecutar— pero contra `PATCH /api/workspaces/:id`,
 * que escribe sólo los campos que se nombran. Aquí no hay «entregar»: una
 * práctica no se entrega, y por eso no hay ningún botón que lo sugiera.
 */

const AUTOSAVE_DELAY_MS = 800;

export function PracticeWorkspace({ workspaceId }: { workspaceId: string }) {
  const { data, state, error } = useApi<{ workspace: Workspace }>(
    `/api/workspaces/${workspaceId}`
  );

  const [code, setCode] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<CodeSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const codeRef = useRef(code);
  codeRef.current = code;
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // El texto guardado se carga UNA vez: sin la guarda, cada recarga del hook
  // pisaría lo que la persona lleva escrito.
  useEffect(() => {
    if (hydrated || !data?.workspace) return;
    setCode(data.workspace.code);
    setHydrated(true);
  }, [data, hydrated]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;
    if (!dirtyRef.current) return;

    dirtyRef.current = false;
    setSaveState('saving');
    setSaveError(null);

    const request = (async () => {
      try {
        await patchWorkspace(workspaceId, { code: codeRef.current });
        setSaveState('saved');
      } catch (caught) {
        // Vuelve a marcarse sucio: el siguiente intento lo reintenta en vez de
        // dar el trabajo por perdido.
        dirtyRef.current = true;
        setSaveState('error');
        setSaveError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [workspaceId]);

  function edit(next: string): void {
    setCode(next);
    dirtyRef.current = true;
    setSaveState('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  if (state === 'loading') return <p className="py-10 text-center text-muted">Cargando…</p>;
  if (state === 'error' || !data) {
    return <Notice tone="error">{error ?? 'No pudimos abrir esta práctica.'}</Notice>;
  }

  const { workspace } = data;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <Link href="/practicas" className="meta no-underline hover:underline">
            ← Mis prácticas
          </Link>
          <h1 className="mt-2 truncate font-display text-h1">{workspace.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {programmingLanguageLabel(workspace.language)} · privada
          </p>
        </div>
        <SaveIndicator state={saveState} error={saveError} />
      </header>

      <div className="mt-6">
        <CodeEditor
          language={workspace.language}
          value={code}
          onChange={edit}
          // Una práctica existe PARA ejecutarse. El editor decide después si el
          // lenguaje puede, y lo dice cuando no.
          executionEnabled
          beforeExecute={flush}
          height={460}
          ariaLabel={`Práctica ${workspace.title} en ${programmingLanguageLabel(workspace.language)}`}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ state, error }: { state: CodeSaveState; error: string | null }) {
  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <span className="text-sm text-danger" role="status">
        {error || 'No se pudo guardar.'}
      </span>
    );
  }

  return (
    <span className="text-sm text-subtle" role="status">
      {state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  );
}
