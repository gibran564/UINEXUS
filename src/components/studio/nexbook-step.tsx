'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/aula/aula-ui';
import {
  createNexBook,
  nexBookAssetBytes,
  nexBookAssetUrl,
  patchNexBook,
  uploadNexBookAsset,
  useApi,
} from '@/lib/aula-client';
import type { NexBook, NexBookDocument } from '@/lib/types';
import { NexBookStudio } from './nexbook-studio';

/**
 * El NexBook de un paso de actividad, dentro del runner.
 *
 * ## Es el mismo NexLab
 *
 * No hay una versión «integrada» del editor. `NexBookStudio` es el mismo
 * componente que en `/practicas/nexbook/:id`; lo único que cambia es el ancho que
 * le da la página y que aquí existe «Abrir en NexLab» para cuando el documento
 * se queda estrecho al lado de las instrucciones.
 *
 * ## La entrega no se hace aquí
 *
 * El botón de entregar es del runner, que ya sabe entregar todos los pasos. Lo
 * que este componente aporta a la entrega es el `snapshot`: la copia congelada
 * del documento en el momento de entregar, que se escribe en la evidencia del
 * paso. Ver `onSnapshot`.
 */

const AUTOSAVE_DELAY_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export function NexBookStep({
  assignmentId,
  stepId,
  readOnly = false,
  variant = 'runner',
  partTitle,
  onSnapshot,
}: {
  assignmentId: string;
  stepId: string;
  readOnly?: boolean;
  /**
   * El nombre humano de la Parte que se está haciendo.
   *
   * Sirve para que el laboratorio diga a qué pertenece. Abrir un editor a
   * pantalla completa sin decir de qué actividad es deja a alguien trabajando
   * «en un documento» en vez de «en la parte 2 de su tarea», que es lo que hace
   * que se pierda el hilo al volver.
   */
  partTitle?: string;
  /**
   * Desde dónde se abre.
   *
   * `template` es el docente preparando el laboratorio desde el constructor de
   * la actividad. No cambia el documento ni el permiso —eso lo decide el
   * servidor con `role`—, sólo el marco: ahí no tiene sentido ofrecer «copiar a
   * mis espacios», que es una acción de quien ESTÁ haciendo la actividad.
   */
  variant?: 'runner' | 'template';
  /**
   * Se llama en cada guardado con lo que habría que entregar.
   *
   * El runner guarda esto como evidencia del paso, así que al pulsar «Entregar»
   * lo que viaja es una copia del documento y no una referencia a él. Sin esto,
   * seguir trabajando después de entregar cambiaría lo que se califica.
   */
  onSnapshot?: (snapshot: {
    nexbookId: string;
    revision: number;
    title: string;
    snapshot: NexBookDocument;
  }) => void;
}) {
  const { data, state, error } = useApi<{ nexbook: NexBook; role: string }>(
    `/api/assignments/${assignmentId}/steps/${stepId}/nexbook`
  );

  const [doc, setDoc] = useState<NexBookDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const revisionRef = useRef(0);
  const docRef = useRef<NexBookDocument | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const frozenRef = useRef(false);
  const snapshotRef = useRef(onSnapshot);
  snapshotRef.current = onSnapshot;

  docRef.current = doc;
  const nexbookId = data?.nexbook.id ?? '';
  const title = data?.nexbook.title ?? '';

  useEffect(() => {
    if (hydrated || !data?.nexbook) return;
    setDoc(data.nexbook.document);
    revisionRef.current = data.nexbook.revision;
    setHydrated(true);
    // Lo ya guardado también es entregable: si alguien entrega sin tocar nada,
    // la evidencia tiene que llevar el documento que hay, no quedarse vacía.
    snapshotRef.current?.({
      nexbookId: data.nexbook.id,
      revision: data.nexbook.revision,
      title: data.nexbook.title,
      snapshot: data.nexbook.document,
    });
  }, [data, hydrated]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) await inFlightRef.current;
    if (!dirtyRef.current || frozenRef.current || !docRef.current || !nexbookId) return;

    dirtyRef.current = false;
    setSaveState('saving');
    setSaveError(null);

    const request = (async () => {
      try {
        const { nexbook } = await patchNexBook(nexbookId, {
          revision: revisionRef.current,
          document: docRef.current!,
        });
        revisionRef.current = nexbook.revision;
        setSaveState('saved');
        snapshotRef.current?.({
          nexbookId: nexbook.id,
          revision: nexbook.revision,
          title: nexbook.title,
          snapshot: nexbook.document,
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'No se pudo guardar.';
        if (message.includes('otro sitio')) {
          frozenRef.current = true;
          setSaveState('conflict');
        } else {
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

  function edit(next: NexBookDocument): void {
    setDoc(next);
    docRef.current = next;
    if (frozenRef.current || readOnly) return;
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

  if (state === 'loading') return <p className="py-8 text-center text-muted">Preparando tu NexLab…</p>;
  if (state === 'error' || !data) {
    return <Notice tone="error">{error ?? 'No pudimos abrir el NexLab de este paso.'}</Notice>;
  }
  if (!doc) return <p className="py-8 text-center text-muted">Cargando…</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {/*
          Desde el constructor, la cabecera del panel ya dice que se está
          editando la plantilla y de qué parte. Repetirlo aquí sería decirlo dos
          veces en dos palabras distintas, que es peor que no decirlo.
        */}
        {/*
          De quién es este documento y cuál es.
          El título del documento se añade sólo si dice algo que la cabecera de
          la Parte —justo encima— no diga ya: un laboratorio que se llama igual
          que su parte repetiría el mismo nombre tres veces seguidas.
        */}
        {variant === 'runner' && (
          <p className="meta">
            {data.role === 'template' ? 'Plantilla de la actividad' : 'Tu NexLab'}
            {title && title !== partTitle ? ` · ${title}` : ''}
          </p>
        )}
        {variant === 'runner' && (
          <Link
            href={`/practicas/nexbook/${nexbookId}`}
            className="text-sm text-accent underline underline-offset-2"
          >
            Abrir en NexLab ↗
          </Link>
        )}
      </div>

      {saveState === 'conflict' && (
        <div className="mb-3">
          <Notice tone="error">
            {saveError} Se dejó de guardar para no perder nada. Copia lo que necesites y recarga.
          </Notice>
        </div>
      )}

      <NexBookStudio
        document={doc}
        onChange={edit}
        editable={!readOnly}
        // El rol lo decide el SERVIDOR (`role: 'template' | 'instance'`), no una
        // suposición del navegador sobre quién está mirando.
        templateMode={data.role === 'template'}
        uploadAsset={(file, contentType) => uploadNexBookAsset(nexbookId, file, contentType)}
        assetUrl={(assetId, mimeType) => nexBookAssetUrl(nexbookId, assetId, mimeType)}
        assetBytes={(assetId, mimeType) => nexBookAssetBytes(nexbookId, assetId, mimeType)}
        toolbar={
          <div className="flex items-center gap-2">
            <SaveState state={saveState} error={saveError} />
            {!readOnly && variant === 'runner' && <CopyForPortfolio title={title} document={doc} />}
          </div>
        }
      />
    </div>
  );
}

/**
 * «Crear copia para mi portafolio».
 *
 * ## Por qué no se publica el trabajo de la actividad directamente
 *
 * Porque no es sólo suyo. El documento de un paso puede llevar las instrucciones
 * internas de la materia, los datos que repartió el profesorado o la
 * retroalimentación recibida, y publicar eso sería publicar material de la clase
 * sin que nadie de la clase lo decidiera. La ruta de publicación lo rechaza en
 * el servidor; aquí está el camino que sí funciona:
 *
 * ```
 * NexBook de la actividad  ──copia──▶  NexBook personal  ──publicar──▶  público
 * ```
 *
 * La entrega no se toca. Lo que se califica sigue siendo el snapshot que viajó
 * en la evidencia, y la copia es un documento nuevo del que su autor decide qué
 * hacer. Es la separación entre evidencia académica y portafolio.
 *
 * Las imágenes NO se duplican: sus bytes cuelgan de la persona, no del
 * documento, así que la copia referencia las mismas y sigue viéndolas. Ver
 * `nexBookAssetKey`.
 */
function CopyForPortfolio({ title, document: doc }: { title: string; document: NexBookDocument }) {
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { nexbook } = await createNexBook({
        title: `${title} (copia)`.slice(0, 120),
        document: doc,
      });
      setCreated(nexbook.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo copiar.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Link
        href={`/practicas/nexbook/${created}`}
        className="text-sm text-accent underline underline-offset-2"
      >
        Abrir la copia ↗
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={busy}
        className="btn btn-ghost btn-sm"
        title="Una copia personal en tus espacios, que puedes publicar sin tocar tu entrega"
      >
        {busy ? 'Copiando…' : 'Copiar a mis espacios'}
      </button>
      {error && (
        <span className="text-sm text-danger" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function SaveState({ state, error }: { state: SaveState; error: string | null }) {
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
