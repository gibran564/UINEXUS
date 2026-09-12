'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/aula/aula-ui';
import { partActionLabel } from '@/lib/activity-builder';
import {
  downloadNexBookArchive,
  nexBookAssetBytes,
  nexBookAssetUrl,
  patchNexBook,
  uploadNexBookAsset,
  useApi,
  type AssignmentDetail,
} from '@/lib/aula-client';
import type { NexBook, NexBookDocument } from '@/lib/types';
import { NexBookShare } from './nexbook-share';
import { NexBookStudio } from './nexbook-studio';

/**
 * Un NexBook personal, a pantalla completa.
 *
 * ## El autoguardado y la revisión
 *
 * Mismo contrato que el resto de Nextudio —800 ms tras la última pulsación— pero
 * con una pieza más: cada guardado manda la REVISIÓN que esta pestaña cree
 * tener. Si otra pestaña guardó mientras, el servidor responde 409 con el
 * documento que ganó y aquí se dice exactamente eso, en vez de sobrescribirlo.
 *
 * Ese caso no es raro: un documento largo se deja abierto en el portátil y se
 * abre otra vez en otro equipo. Sin la revisión, la segunda pestaña borraría en
 * silencio media hora de la primera.
 *
 * ## Lo que NO se hace tras un conflicto
 *
 * No se intenta fusionar. Combinar dos versiones de un documento por bloques
 * requiere decidir qué hacer con un mismo bloque editado en los dos sitios, y
 * cualquier respuesta automática a eso pierde trabajo de alguien. Se dice qué
 * pasó, se deja de guardar y quien edita decide.
 */

const AUTOSAVE_DELAY_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export function NexBookPage({ nexbookId }: { nexbookId: string }) {
  const { data, state, error } = useApi<{ nexbook: NexBook }>(`/api/nexbooks/${nexbookId}`);

  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<NexBookDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  /** La revisión que esta pestaña cree tener. Es la base de la concurrencia. */
  const revisionRef = useRef(0);
  const docRef = useRef<NexBookDocument | null>(null);
  const titleRef = useRef('');
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  /** Tras un conflicto se deja de guardar: insistir sólo pisaría más trabajo. */
  const frozenRef = useRef(false);

  docRef.current = doc;
  titleRef.current = title;

  useEffect(() => {
    if (hydrated || !data?.nexbook) return;
    setTitle(data.nexbook.title);
    setDoc(data.nexbook.document);
    revisionRef.current = data.nexbook.revision;
    setHydrated(true);
  }, [data, hydrated]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;
    if (!dirtyRef.current || frozenRef.current || !docRef.current) return;

    dirtyRef.current = false;
    setSaveState('saving');
    setSaveError(null);

    const request = (async () => {
      try {
        const { nexbook } = await patchNexBook(nexbookId, {
          revision: revisionRef.current,
          title: titleRef.current,
          document: docRef.current!,
        });
        // La revisión avanza a la que devolvió el servidor: el siguiente
        // guardado tiene que pedir ESA, no una que ya no existe.
        revisionRef.current = nexbook.revision;
        setSaveState('saved');
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'No se pudo guardar.';
        const conflict = message.includes('otro sitio');

        if (conflict) {
          frozenRef.current = true;
          setSaveState('conflict');
        } else {
          // Se vuelve a marcar sucio: el siguiente intento lo reintenta en vez
          // de dar el trabajo por perdido.
          dirtyRef.current = true;
          setSaveState('error');
        }
        setSaveError(message);
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [nexbookId]);

  function edit(next: { title?: string; document?: NexBookDocument }): void {
    if (next.title !== undefined) setTitle(next.title);
    if (next.document !== undefined) {
      setDoc(next.document);
      docRef.current = next.document;
    }
    if (next.title !== undefined) titleRef.current = next.title;

    if (frozenRef.current) return;
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
    return <Notice tone="error">{error ?? 'No pudimos abrir este NexBook.'}</Notice>;
  }
  if (!doc) return <p className="py-10 text-center text-muted">Cargando…</p>;

  return (
    <div>
      <header className="border-b border-line pb-4">
        {data.nexbook.context.type === 'workflow' ? (
          <AcademicContext
            assignmentId={data.nexbook.context.assignmentId}
            stepId={data.nexbook.context.stepId}
          />
        ) : (
          <Link href="/practicas" className="meta no-underline hover:underline">
            ← Mis espacios
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Nombre del NexBook</span>
            <input
              value={title}
              onChange={(event) => edit({ title: event.target.value })}
              maxLength={120}
              className="w-full border-0 bg-transparent p-0 font-display text-h1 outline-none focus-visible:underline"
            />
          </label>
        </div>
        {/* «NexLab» dice DÓNDE estás; «NexBook» diría qué formato tiene el
            archivo, que es lo que importa al exportar y no al trabajar. */}
        <p className="mt-1 text-sm text-muted">
          {data.nexbook.context.type === 'workflow'
            ? 'NexLab · trabajo de una actividad'
            : 'NexLab · privado'}
        </p>
      </header>

      {saveState === 'conflict' && (
        <div className="mt-4">
          <Notice tone="error">
            {saveError} Se dejó de guardar para no perder nada. Copia lo que necesites y recarga.
          </Notice>
        </div>
      )}

      <div className="mt-6">
        <NexBookStudio
          document={doc}
          onChange={(next) => edit({ document: next })}
          uploadAsset={(file, contentType) => uploadNexBookAsset(nexbookId, file, contentType)}
          assetUrl={(assetId, mimeType) => nexBookAssetUrl(nexbookId, assetId, mimeType)}
        assetBytes={(assetId, mimeType) => nexBookAssetBytes(nexbookId, assetId, mimeType)}
          toolbar={
            <div className="flex items-center gap-2">
              <SaveIndicator state={saveState} error={saveError} />
              <ExportButton nexbookId={nexbookId} onError={setSaveError} flush={flush} />
              <NexBookShare nexbookId={nexbookId} title={title} />
            </div>
          }
        />
      </div>
    </div>
  );
}

/**
 * De qué actividad es este laboratorio, y cómo volver a ella.
 *
 * Un NexLab académico abierto a pantalla completa es la misma ruta que un
 * laboratorio personal, y sin esto diría «← Mis espacios»: quien lo abriera
 * desde su actividad se encontraría trabajando «en un documento» sin ninguna
 * pista de a qué pertenece ni por dónde se vuelve. La instancia SIGUE VINCULADA
 * a su actividad —`NexBookContext` la lleva—, así que sólo hay que decirlo.
 *
 * Se lee de la actividad, que el servidor ya sirve con sus permisos: si esta
 * persona no tuviera acceso, no habría llegado hasta aquí. Mientras carga —o si
 * la actividad ya no existe— se dice lo único cierto, que esto es trabajo de una
 * actividad, en vez de inventar un enlace que podría no llevar a ninguna parte.
 */
function AcademicContext({ assignmentId, stepId }: { assignmentId: string; stepId: string }) {
  const { data } = useApi<AssignmentDetail>(`/api/assignments/${assignmentId}`);

  if (!data) return <p className="meta">Trabajo de una actividad</p>;

  const part = data.assignment.workflow.find((step) => step.id === stepId);
  const partName = part ? part.title || partActionLabel(part) : '';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link
        href={`/aula/${data.courseId}/tareas/${assignmentId}`}
        className="meta no-underline hover:underline"
      >
        ← Volver a la actividad
      </Link>
      <p className="meta">
        {data.courseName} › {data.assignment.title}
        {partName ? ` › ${partName}` : ''}
      </p>
    </div>
  );
}

/**
 * Descargar el `.nexbook`.
 *
 * Antes de pedirlo se FUERZA el guardado pendiente. El servidor exporta lo que
 * hay guardado, así que exportar con el autoguardado en vuelo produciría un
 * archivo sin los últimos treinta segundos de trabajo —un fallo silencioso, que
 * es el peor tipo—.
 *
 * La descarga va por `fetch` y no por un enlace porque la ruta necesita la
 * cabecera `Authorization`: un `<a href>` no la lleva, y la respuesta sería un
 * 401 en forma de archivo descargado.
 */
function ExportButton({
  nexbookId,
  onError,
  flush,
}: {
  nexbookId: string;
  onError: (message: string) => void;
  flush: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function download(): Promise<void> {
    setBusy(true);
    try {
      await flush();
      const blob = await downloadNexBookArchive(nexbookId);

      const url = URL.createObjectURL(blob.body);
      const link = document.createElement('a');
      link.href = url;
      link.download = blob.fileName;
      link.click();
      // El objeto se libera en el siguiente ciclo: revocarlo de inmediato
      // cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'No se pudo exportar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void download()} disabled={busy} className="btn btn-ghost btn-sm">
      {busy ? 'Exportando…' : 'Exportar'}
    </button>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <span className="text-sm text-danger" role="status">
        {error || 'Error al guardar'}
      </span>
    );
  }
  if (state === 'conflict') {
    return (
      <span className="text-sm text-danger" role="status">
        Guardado detenido
      </span>
    );
  }

  return (
    <span className="text-sm text-subtle" role="status">
      {state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  );
}
