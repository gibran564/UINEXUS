'use client';

import { useRef, useState } from 'react';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import type { NexBookImageBlock, NexBookImageMimeType } from '@/lib/types';

/**
 * El bloque de imagen.
 *
 * ## Los bytes nunca están aquí
 *
 * El componente recibe una función `upload` y una `resolve`. No sabe que hay S3
 * detrás, ni que la subida es un POST firmado en dos pasos: sabe que entrega un
 * archivo y recibe un identificador. Eso es lo que permite que el mismo bloque
 * se pinte en NexLab, en la revisión de una entrega y en una publicación, donde
 * los permisos de lectura son tres cosas distintas.
 *
 * ## La vista previa local cubre el hueco
 *
 * Entre que la imagen se sube y que el autoguardado la deja en el documento hay
 * unos cientos de milisegundos en los que la ruta de contenido todavía no puede
 * confirmarla. Se enseña el archivo local mientras tanto, así que quien la
 * arrastró la ve aparecer al instante en vez de un cuadro roto.
 *
 * ## El texto alternativo se pide, no se exige
 *
 * Exigirlo llevaría a rellenarlo con «imagen», que para quien usa un lector de
 * pantalla es peor que nada. Se pide, se explica para qué sirve, y hay una
 * casilla para decir que es decorativa —que es lo que pone `alt=""` de verdad—.
 */

export interface NexBookImageProps {
  block: NexBookImageBlock;
  editable: boolean;
  index: number;
  onChange: (block: NexBookImageBlock) => void;
  /** Sube el archivo y devuelve el id del asset. */
  upload?: (file: File, contentType: NexBookImageMimeType) => Promise<string>;
  /** La URL por la que se lee un asset ya guardado. */
  resolve?: (assetId: string, mimeType: NexBookImageMimeType) => string;
}

const ACCEPTED: readonly NexBookImageMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];

export function NexBookImage({
  block,
  editable,
  index,
  onChange,
  upload,
  resolve,
}: NexBookImageProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function accept(file: File | null | undefined): Promise<void> {
    if (!file || !upload) return;

    /**
     * El tipo se lee del ARCHIVO y se comprueba contra la lista.
     *
     * No de la extensión del nombre: renombrar `algo.exe` a `algo.png` no lo
     * convierte en una imagen. Y esto tampoco es la defensa —el servidor fija el
     * `Content-Type` de la subida firmada y S3 lo aplica—, es el aviso temprano
     * que evita gastar una subida para nada.
     */
    if (!ACCEPTED.includes(file.type as NexBookImageMimeType)) {
      setError('La imagen debe ser PNG, JPEG o WebP.');
      return;
    }
    if (file.size > NEXBOOK_LIMITS.maxAssetBytes) {
      setError(
        `La imagen pesa demasiado: el límite son ${Math.round(NEXBOOK_LIMITS.maxAssetBytes / (1024 * 1024))} MB.`
      );
      return;
    }

    setError(null);
    setBusy(true);
    const local = URL.createObjectURL(file);
    setPreview(local);

    try {
      const mimeType = file.type as NexBookImageMimeType;
      const [assetId, size] = await Promise.all([upload(file, mimeType), measure(local)]);
      onChange({ ...block, assetId, mimeType, ...size });
    } catch (caught) {
      setPreview(null);
      URL.revokeObjectURL(local);
      setError(caught instanceof Error ? caught.message : 'No se pudo subir la imagen.');
    } finally {
      setBusy(false);
    }
  }

  const source = preview ?? (block.assetId && resolve ? resolve(block.assetId, block.mimeType) : null);

  return (
    <div className="p-3">
      {source ? (
        <figure className="m-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- Ruta dinámica
              con permisos por petición: el optimizador de Next no puede firmarla. */}
          <img
            src={source}
            alt={block.alt}
            width={block.width}
            height={block.height}
            className="h-auto max-w-full rounded-sm border border-line"
          />
          {block.caption && (
            <figcaption className="mt-1 text-sm text-muted">{block.caption}</figcaption>
          )}
        </figure>
      ) : (
        editable && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void accept(event.dataTransfer.files[0]);
            }}
            // Pegar desde el portapapeles: es como llega una captura de pantalla,
            // que es el caso más común en un documento académico.
            onPaste={(event) => {
              const file = [...event.clipboardData.files][0];
              if (file) void accept(file);
            }}
            className={`flex flex-col items-center gap-2 rounded-sm border border-dashed p-6 text-center ${
              dragging ? 'border-accent bg-sunken' : 'border-line'
            }`}
          >
            <p className="text-sm text-muted">
              Arrastra una imagen, pégala desde el portapapeles o elígela.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              {busy ? 'Subiendo…' : 'Elegir imagen'}
            </button>
            <p className="text-label text-subtle">
              PNG, JPEG o WebP · hasta{' '}
              {Math.round(NEXBOOK_LIMITS.maxAssetBytes / (1024 * 1024))} MB
            </p>
          </div>
        )
      )}

      {!source && !editable && <p className="text-sm text-subtle">Este bloque no tiene imagen.</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        aria-label={`Archivo de imagen del bloque ${index + 1}`}
        onChange={(event) => void accept(event.target.files?.[0])}
      />

      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {editable && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-label text-subtle">Texto alternativo</span>
            <input
              value={block.alt}
              onChange={(event) => onChange({ ...block, alt: event.target.value })}
              disabled={block.alt === '' && isDecorative(block)}
              maxLength={400}
              placeholder="Qué se ve en la imagen"
              className="field"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isDecorative(block)}
              onChange={(event) =>
                onChange({ ...block, alt: '', caption: event.target.checked ? '' : block.caption })
              }
            />
            <span className="text-label text-subtle">
              Es decorativa: los lectores de pantalla pueden saltarla
            </span>
          </label>
          <label className="block">
            <span className="text-label text-subtle">Pie de figura (opcional)</span>
            <input
              value={block.caption ?? ''}
              onChange={(event) => onChange({ ...block, caption: event.target.value })}
              maxLength={400}
              className="field"
            />
          </label>
          {source && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn btn-ghost btn-sm"
            >
              {busy ? 'Subiendo…' : 'Reemplazar imagen'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Sin texto alternativo Y sin pie: la única combinación que es «decorativa». */
function isDecorative(block: NexBookImageBlock): boolean {
  return block.alt === '' && !block.caption;
}

/**
 * Las dimensiones reales del archivo.
 *
 * Se guardan para poder reservar el hueco antes de que la imagen llegue: sin
 * ellas, abrir un documento con cinco imágenes hace saltar el texto cinco veces
 * mientras cargan.
 */
function measure(url: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({});
    image.src = url;
  });
}
