'use client';

import { useId, useRef, useState } from 'react';
import { formatBytes, stageLooseFiles, stageZipFile, type StagingResult } from '@/lib/files';
import { LIMITS } from '@/lib/constants';
import type { ProjectType } from '@/lib/types';

/**
 * Zona de subida.
 *
 * El control real es un <input type="file"> con su etiqueta: se alcanza con el
 * tabulador, se activa con Enter y el lector de pantalla lo anuncia como lo que
 * es. Arrastrar y soltar es una mejora encima, nunca la única vía — es la
 * trampa más habitual en este patrón.
 */
export function UploadDropzone({
  projectType,
  onStaged,
  busy = false,
}: {
  projectType: ProjectType;
  onStaged: (result: StagingResult) => void;
  busy?: boolean;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const dragDepth = useRef(0);

  const wantsZip = projectType !== 'html';
  const accept = wantsZip ? '.zip' : '.html,.htm,.css,.js,.png,.jpg,.jpeg,.gif,.svg,.webp,.woff2';

  async function handleFiles(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return;
    setReading(true);
    try {
      const files = Array.from(list);
      const zip = files.find((file) => file.name.toLowerCase().endsWith('.zip'));
      onStaged(zip ? await stageZipFile(zip) : stageLooseFiles(files));
    } catch {
      onStaged({
        files: [],
        entryFile: null,
        totalBytes: 0,
        issues: [
          {
            path: '',
            reason:
              'No pudimos leer el archivo. Si es un .zip, comprueba que no esté protegido con contraseña.',
          },
        ],
      });
    } finally {
      setReading(false);
    }
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
      className={`rounded-md border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface'
      }`}
    >
      <svg
        viewBox="0 0 40 32"
        width="46"
        height="37"
        fill="none"
        aria-hidden="true"
        className="mx-auto mb-4 text-subtle"
      >
        <path
          d="M20 22V6m0 0l-6 6m6-6l6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 20v7a3 3 0 003 3h30a3 3 0 003-3v-7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>

      <p className="font-display text-h3">
        {wantsZip ? 'Arrastra aquí tu archivo .zip' : 'Arrastra aquí tus archivos'}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        {wantsZip
          ? 'Debe contener un index.html en su interior. Si está dentro de una carpeta, no pasa nada: lo detectamos.'
          : 'Necesitas al menos un index.html. Puedes añadir el CSS, el JavaScript y las imágenes.'}
      </p>

      <div className="mt-5">
        <label htmlFor={inputId} className="btn btn-secondary cursor-pointer">
          {reading ? 'Leyendo archivos…' : 'Elegir archivos'}
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          multiple={!wantsZip}
          accept={accept}
          disabled={busy || reading}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      <p className="mt-4 text-sm text-subtle">
        Máximo {formatBytes(LIMITS.maxFileBytes)} por archivo y {LIMITS.maxFiles} archivos.
        No se admiten ejecutables ni código de servidor.
      </p>
    </div>
  );
}
