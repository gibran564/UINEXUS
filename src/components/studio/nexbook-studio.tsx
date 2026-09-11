'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Notice } from '@/components/aula/aula-ui';
import {
  DEFAULT_PROGRAMMING_LANGUAGE,
  NEXBOOK_LIMITS,
  languageCapabilities,
  programmingLanguageLabel,
} from '@/lib/constants';
import { documentBytes, withoutResult, withoutResults } from '@/lib/nexbook-document';
import { createNotebookKernel, type KernelStatus, type NotebookKernel } from '@/lib/notebook-kernel';
import { emptySheet } from '@/lib/spreadsheet/cells';
import type {
  NexBookBlock,
  NexBookBlockType,
  NexBookCellResult,
  NexBookDocument,
  NexBookImageMimeType,
  ProgrammingLanguage,
} from '@/lib/types';
import { NexBookBlockCard } from './nexbook-block-card';

/**
 * UINexus Studio: el editor de un NexBook.
 *
 * ## Un solo editor, dos layouts
 *
 * Este componente no sabe si está a pantalla completa en `/practicas` o en un
 * panel al lado de las instrucciones de una actividad. Quien lo usa le pasa el
 * documento y recibe los cambios; el layout es de la página. Dos
 * implementaciones del editor —una «integrada» y otra «completa»— habrían
 * significado arreglar cada fallo dos veces.
 *
 * ## El estado del documento es de quien llama
 *
 * Studio es controlado: recibe `document` y emite `onChange`. El autoguardado,
 * la revisión y los conflictos son de la página, porque cambian según el
 * contexto —una práctica se guarda sola, una plantilla docente se guarda con la
 * actividad—. Meter el guardado aquí habría atado el editor a UNA forma de
 * persistir.
 *
 * ## El kernel sí es de aquí
 *
 * Y vive en un `ref`, no en el estado de React: una sesión que se perdiera al
 * re-renderizar no sería una sesión. Se libera al desmontar, porque dejar 46 MB
 * de webR vivos porque alguien pasó por un documento no es aceptable.
 */

export interface NexBookStudioProps {
  document: NexBookDocument;
  onChange: (document: NexBookDocument) => void;
  /** `false` en la vista docente de una entrega. */
  editable?: boolean;
  /** Se pinta en la barra: estado de guardado, avisos, acciones de la página. */
  toolbar?: React.ReactNode;
  /** Qué lenguaje traen los bloques de código nuevos. */
  defaultLanguage?: ProgrammingLanguage;
  /** Sube una imagen y devuelve su id. Sin esto, no se ofrecen bloques de imagen. */
  uploadAsset?: (file: File, contentType: NexBookImageMimeType) => Promise<string>;
  /** Resuelve la URL de lectura de un asset. */
  assetUrl?: (assetId: string, mimeType: NexBookImageMimeType) => string;
}

/** Ids cortos y legibles: aparecen en `results` y en los mensajes de error. */
function newBlockId(): string {
  return `b${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Cuándo avisar de que el documento está creciendo.
 *
 * Al 80 % del presupuesto, que es donde todavía quedan unas cuantas ejecuciones
 * de margen para hacer algo al respecto. Avisar al 99 % sería avisar cuando ya
 * no se puede guardar.
 */
const SIZE_WARNING_RATIO = 0.8;

export function NexBookStudio({
  document: doc,
  onChange,
  editable = true,
  toolbar,
  defaultLanguage = DEFAULT_PROGRAMMING_LANGUAGE,
  uploadAsset,
  assetUrl,
}: NexBookStudioProps) {
  const kernelRef = useRef<NotebookKernel | null>(null);
  const [kernelStatus, setKernelStatus] = useState<Record<string, KernelStatus>>({});
  const [runningBlockId, setRunningBlockId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Imágenes recién generadas, por bloque y por `seq`, mientras se suben. */
  const [pending, setPending] = useState<Record<string, Record<number, string>>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  /** El bloque al que hay que llevar el foco tras crearlo. */
  const focusBlockId = useRef<string | null>(null);

  /**
   * El documento más reciente, para las funciones asíncronas.
   *
   * «Ejecutar todo» recorre celdas con `await` entre ellas, y cada resultado
   * cambia el documento. Leer `doc` de la clausura devolvería el de cuando
   * empezó el recorrido, así que la última celda borraría los resultados de las
   * anteriores.
   */
  const docRef = useRef(doc);
  docRef.current = doc;

  const kernel = useCallback((): NotebookKernel => {
    kernelRef.current ??= createNotebookKernel({
      onStatusChange: (language, status) =>
        setKernelStatus((current) => ({ ...current, [language]: status })),
    });
    return kernelRef.current;
  }, []);

  useEffect(
    () => () => {
      const active = kernelRef.current;
      kernelRef.current = null;
      void active?.dispose();
    },
    []
  );

  // Tras insertar un bloque el foco va a su primer campo. Sin esto, quien
  // navega con teclado tiene que volver a tabular desde el botón «+ Bloque»
  // hasta el final del documento.
  useEffect(() => {
    const target = focusBlockId.current;
    if (!target) return;
    focusBlockId.current = null;
    const node = containerRef.current?.querySelector<HTMLElement>(
      `[data-block="${target}"] textarea, [data-block="${target}"] input, [data-block="${target}"] .monaco-editor textarea`
    );
    node?.focus();
  }, [doc.blocks.length]);

  const languagesInUse = useMemo(
    () => [
      ...new Set(doc.blocks.flatMap((block) => (block.type === 'code' ? [block.language] : []))),
    ],
    [doc.blocks]
  );

  const runnable = useMemo(
    () =>
      doc.blocks.filter(
        (block) => block.type === 'code' && languageCapabilities(block.language).browserExecution
      ),
    [doc.blocks]
  );

  const size = useMemo(() => documentBytes(doc), [doc]);
  const tooBig = size > NEXBOOK_LIMITS.documentBytes * SIZE_WARNING_RATIO;

  function patchDocument(next: Partial<NexBookDocument>): void {
    onChange({ ...docRef.current, ...next });
  }

  function updateBlock(blockId: string, block: NexBookBlock): void {
    patchDocument({
      blocks: docRef.current.blocks.map((item) => (item.id === blockId ? block : item)),
    });
  }

  function addBlock(type: NexBookBlockType): void {
    setAdding(false);
    if (doc.blocks.length >= NEXBOOK_LIMITS.maxBlocks) {
      setNotice(`Un NexBook admite hasta ${NEXBOOK_LIMITS.maxBlocks} bloques.`);
      return;
    }
    setNotice(null);

    const id = newBlockId();
    focusBlockId.current = id;
    patchDocument({ blocks: [...doc.blocks, blankBlock(id, type, defaultLanguage)] });
  }

  function duplicateBlock(index: number): void {
    if (doc.blocks.length >= NEXBOOK_LIMITS.maxBlocks) {
      setNotice(`Un NexBook admite hasta ${NEXBOOK_LIMITS.maxBlocks} bloques.`);
      return;
    }

    const original = doc.blocks[index];
    if (!original) return;

    /**
     * La copia NO se lleva el resultado.
     *
     * `results` se indexa por bloque, y un resultado copiado diría que ese
     * código se ejecutó cuando no lo ha hecho nunca. Dos celdas idénticas, una
     * con salida y otra sin ella, es exactamente lo que hay que ver.
     */
    const copy = { ...original, id: newBlockId() } as NexBookBlock;
    focusBlockId.current = copy.id;

    const blocks = [...doc.blocks];
    blocks.splice(index + 1, 0, copy);
    patchDocument({ blocks });
  }

  function removeBlock(blockId: string): void {
    /**
     * Se borra el bloque Y su resultado.
     *
     * Dejar el resultado huérfano no sólo ocuparía espacio: el esquema lo
     * rechaza al guardar, porque un output sin bloque significa que se perdió la
     * correspondencia entre código y salida.
     */
    const next = withoutResult(docRef.current, blockId);
    onChange({ ...next, blocks: next.blocks.filter((block) => block.id !== blockId) });
  }

  function moveBlock(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= doc.blocks.length) return;

    const blocks = [...doc.blocks];
    const [moved] = blocks.splice(index, 1);
    blocks.splice(target, 0, moved!);
    patchDocument({ blocks });
  }

  /**
   * Guarda el resultado y sube las imágenes que trajo.
   *
   * El resultado se escribe DOS veces a propósito: la primera sin `assetId`,
   * para que la gráfica aparezca en cuanto termina de ejecutarse usando los
   * bytes que están en memoria; la segunda cuando la subida termina. Esperar a
   * la red para pintar convertiría «ejecutar una celda» en una operación cuya
   * duración depende de la conexión del aula.
   */
  async function storeResult(
    blockId: string,
    result: NexBookCellResult,
    images: { seq: number; base64: string; mimeType: NexBookImageMimeType }[]
  ): Promise<void> {
    patchDocument({ results: { ...docRef.current.results, [blockId]: result } });

    if (images.length === 0) return;
    setPending((current) => ({
      ...current,
      [blockId]: Object.fromEntries(images.map((image) => [image.seq, image.base64])),
    }));

    if (!uploadAsset) return;

    const uploaded = await Promise.all(
      images.map(async (image) => {
        try {
          const bytes = base64ToBytes(image.base64);
          const file = new File([bytes.buffer as ArrayBuffer], `${blockId}-${image.seq}.png`, {
            type: image.mimeType,
          });
          return { seq: image.seq, assetId: await uploadAsset(file, image.mimeType) };
        } catch {
          // Una gráfica que no se pudo guardar deja su output sin `assetId`, y
          // la interfaz lo dice. Es preferible a perder también el texto que la
          // celda sí produjo.
          return { seq: image.seq, assetId: '' };
        }
      })
    );

    const byAsset = new Map(uploaded.map((item) => [item.seq, item.assetId]));
    const stored: NexBookCellResult = {
      ...result,
      outputs: result.outputs.map((output) =>
        output.stream === 'image' && byAsset.get(output.seq)
          ? { ...output, assetId: byAsset.get(output.seq)! }
          : output
      ),
    };

    // Los outputs sin `assetId` se caen: el esquema exige un UUID y un documento
    // con una imagen a medias no se podría guardar, así que el fallo de una
    // subida bloquearía TODO el autoguardado.
    stored.outputs = stored.outputs.filter(
      (output) => output.stream !== 'image' || Boolean(output.assetId)
    );

    patchDocument({ results: { ...docRef.current.results, [blockId]: stored } });
    setPending((current) => {
      const next = { ...current };
      delete next[blockId];
      return next;
    });
  }

  async function runBlock(block: NexBookBlock): Promise<boolean> {
    if (block.type !== 'code') return true;

    const { result, sessionLost, images } = await kernel().executeCell(
      block.id,
      block.language,
      block.source
    );
    await storeResult(block.id, result, images);

    if (sessionLost) {
      // No se finge que la sesión sobrevivió: la celda siguiente fallaría con
      // un `NameError` que nadie sabría explicar.
      setNotice(
        `El kernel de ${programmingLanguageLabel(block.language)} se reinició. Las variables de las celdas anteriores se perdieron: vuelve a ejecutarlas.`
      );
    }
    return result.status === 'ok';
  }

  async function runOne(block: NexBookBlock): Promise<void> {
    if (runningBlockId || runningAll) return;
    setNotice(null);
    setRunningBlockId(block.id);
    try {
      await runBlock(block);
    } finally {
      setRunningBlockId(null);
    }
  }

  /**
   * Ejecutar todo, en orden y PARANDO en el primer error.
   *
   * Es la política V1 y es la predecible: las celdas de un documento suelen
   * depender de las anteriores, así que seguir tras un fallo produce una cascada
   * de errores donde sólo el primero dice algo. Se anuncia dónde se paró.
   *
   * Cada lenguaje conserva su propia sesión: recorrer el documento no mezcla los
   * espacios de nombres de Python y R.
   */
  async function runAll(): Promise<void> {
    if (runningAll || runningBlockId || runnable.length === 0) return;

    setNotice(null);
    setRunningAll(true);
    try {
      for (const block of runnable) {
        setRunningBlockId(block.id);
        const ok = await runBlock(block);
        if (!ok) {
          const position = docRef.current.blocks.findIndex((item) => item.id === block.id) + 1;
          setNotice(`Se detuvo en el bloque ${position}: esa celda terminó con un error.`);
          return;
        }
      }
      setNotice(`Se ejecutaron ${runnable.length} celdas.`);
    } finally {
      setRunningBlockId(null);
      setRunningAll(false);
    }
  }

  async function restartKernel(language: ProgrammingLanguage): Promise<void> {
    await kernel().restart(language);
    setNotice(
      `Kernel de ${programmingLanguageLabel(language)} reiniciado. Las variables se borraron.`
    );
  }

  async function restartAll(): Promise<void> {
    const active = kernel().activeLanguages();
    if (active.length === 0) return;

    await Promise.all(active.map((language) => kernel().restart(language)));
    setNotice('Se reiniciaron todos los kernels. Las variables se borraron.');
  }

  async function interruptKernel(language: ProgrammingLanguage): Promise<void> {
    await kernel().interrupt(language);
  }

  const busy = runningBlockId !== null || runningAll;

  return (
    <div className="space-y-4" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        {editable && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding((value) => !value)}
              className="btn btn-secondary btn-sm"
              aria-expanded={adding}
              aria-haspopup="menu"
            >
              + Bloque
            </button>
            {adding && (
              /*
                Sólo los tipos que existen de verdad. No hay «IA» ni «Gráfica» en
                este menú porque no hay nada detrás: un menú que promete lo que no
                puede hacer enseña a desconfiar del resto.
              */
              <div
                role="menu"
                className="absolute left-0 top-full z-30 mt-1 w-52 rounded-sm border border-line bg-surface py-1 shadow-lg"
              >
                <MenuItem onSelect={() => addBlock('markdown')} label="Texto" hint="Markdown" />
                <MenuItem onSelect={() => addBlock('code')} label="Código" hint="Python, R…" />
                {uploadAsset && (
                  <MenuItem onSelect={() => addBlock('image')} label="Imagen" hint="PNG, JPEG, WebP" />
                )}
                <MenuItem
                  onSelect={() => addBlock('spreadsheet')}
                  label="Hoja de cálculo"
                  hint="Datos y fórmulas"
                />
              </div>
            )}
          </div>
        )}

        {runnable.length > 0 && (
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            {runningAll ? 'Ejecutando…' : 'Ejecutar todo'}
          </button>
        )}

        {kernel().activeLanguages().length > 1 && (
          <button
            type="button"
            onClick={() => void restartAll()}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            Reiniciar kernels
          </button>
        )}

        {Object.keys(doc.results).length > 0 && editable && (
          <button
            type="button"
            onClick={() => onChange(withoutResults(docRef.current))}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            Limpiar salidas
          </button>
        )}

        {languagesInUse.map((language) => (
          <KernelChip
            key={language}
            language={language}
            status={kernelStatus[language] ?? 'idle'}
            running={busy}
            onRestart={() => void restartKernel(language)}
            onInterrupt={() => void interruptKernel(language)}
          />
        ))}

        <div className="ml-auto">{toolbar}</div>
      </div>

      {notice && <Notice tone="info">{notice}</Notice>}

      {tooBig && (
        <Notice tone="error">
          Este NexBook está creciendo mucho. Limpia salidas antiguas o divide el documento: cuando
          se llene, dejará de poder guardarse.
        </Notice>
      )}

      {doc.blocks.length === 0 && (
        <p className="py-8 text-center text-muted">
          Este NexBook está vacío. Empieza con un bloque de texto o de código.
        </p>
      )}

      <div className="space-y-3">
        {doc.blocks.map((block, index) => (
          <div key={block.id} data-block={block.id}>
            <NexBookBlockCard
              block={block}
              index={index}
              total={doc.blocks.length}
              result={doc.results[block.id]}
              editable={editable}
              running={runningBlockId === block.id}
              onChange={(next) => updateBlock(block.id, next)}
              onRemove={() => removeBlock(block.id)}
              onDuplicate={() => duplicateBlock(index)}
              onMove={(direction) => moveBlock(index, direction)}
              onRun={() => void runOne(block)}
              onClearResult={() => onChange(withoutResult(docRef.current, block.id))}
              uploadAsset={uploadAsset}
              assetUrl={assetUrl}
              pendingImages={pending[block.id]}
            />
          </div>
        ))}
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button type="button" onClick={() => addBlock('markdown')} className="btn btn-ghost btn-sm">
            + Texto
          </button>
          <button type="button" onClick={() => addBlock('code')} className="btn btn-ghost btn-sm">
            + Código
          </button>
          <span className="ml-auto self-center text-label text-subtle tabular-nums">
            {doc.blocks.length} / {NEXBOOK_LIMITS.maxBlocks} bloques
          </span>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onSelect,
  label,
  hint,
}: {
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-sunken"
    >
      <span className="text-sm">{label}</span>
      <span className="ml-auto text-label text-subtle">{hint}</span>
    </button>
  );
}

/** Un bloque recién creado de cada tipo. */
function blankBlock(
  id: string,
  type: NexBookBlockType,
  language: ProgrammingLanguage
): NexBookBlock {
  switch (type) {
    case 'markdown':
      return { id, type: 'markdown', source: '' };
    case 'image':
      return { id, type: 'image', assetId: '', mimeType: 'image/png', alt: '' };
    case 'spreadsheet':
      return { id, type: 'spreadsheet', name: 'Hoja', sheet: emptySheet() };
    default:
      return { id, type: 'code', language, source: '' };
  }
}

/** Base64 a bytes, para poder subir la gráfica como archivo. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const KERNEL_LABEL: Record<KernelStatus, string> = {
  idle: 'sin iniciar',
  preparing: 'preparando…',
  ready: 'listo',
  running: 'ejecutando…',
  restarting: 'reiniciando…',
  error: 'error',
  lost: 'reiniciado',
};

const KERNEL_TONE: Record<KernelStatus, string> = {
  idle: 'text-subtle',
  preparing: 'text-warning',
  ready: 'text-success',
  running: 'text-accent',
  restarting: 'text-warning',
  error: 'text-danger',
  lost: 'text-warning',
};

/**
 * El estado de un kernel, por lenguaje.
 *
 * Uno por lenguaje y no uno global: un documento con Python y R tiene dos
 * runtimes independientes, y decir «listo» cuando sólo uno lo está sería
 * mentira. Sólo aparecen los lenguajes que el documento usa de verdad.
 *
 * El estado se dice con PALABRAS además de con color. «Preparando…» y «error»
 * en dos tonos de un mismo gris no se distinguen, y son justo los dos momentos
 * en que hace falta saber cuál es.
 */
function KernelChip({
  language,
  status,
  running,
  onRestart,
  onInterrupt,
}: {
  language: ProgrammingLanguage;
  status: KernelStatus;
  running: boolean;
  onRestart: () => void;
  onInterrupt: () => void;
}) {
  const busy = status === 'running' || status === 'preparing';

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm font-medium">{programmingLanguageLabel(language)}</span>
      <span className={`text-label ${KERNEL_TONE[status]}`} role="status">
        {KERNEL_LABEL[status]}
      </span>
      {busy && (
        <button type="button" onClick={onInterrupt} className="btn btn-ghost btn-sm">
          Detener
        </button>
      )}
      {!busy && status !== 'idle' && (
        <button
          type="button"
          onClick={onRestart}
          disabled={running}
          className="btn btn-ghost btn-sm"
          aria-label={`Reiniciar el kernel de ${programmingLanguageLabel(language)}`}
        >
          Reiniciar
        </button>
      )}
    </span>
  );
}
