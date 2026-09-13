'use client';

import { useEffect, useState } from 'react';
import { buildPreviewDocument, type PreviewResult } from '@/lib/preview';
import {
  pickWebPreviewEntry,
  workspaceFilesToStagedFiles,
} from '@/lib/workspace-files';

/**
 * El código del alumnado vive en un documento autocontenido y con origen opaco.
 * El sandbox sólo habilita scripts: compartir el origen le permitiría alcanzar
 * la sesión de Nextudio. El razonamiento completo está en `lib/preview.ts`.
 */
export function WorkspacePreview({
  files,
  entryFile,
}: {
  files: Record<string, string>;
  entryFile: string;
}) {
  const previewEntry = pickWebPreviewEntry(files, entryFile);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!previewEntry) {
      setPreview(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setPreview(null);
    setError(null);
    void buildPreviewDocument(workspaceFilesToStagedFiles(files), previewEntry)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setError('No pudimos preparar la vista previa.');
      });

    return () => {
      cancelled = true;
    };
  }, [files, previewEntry]);

  if (!previewEntry) {
    return <p>Este proyecto no tiene un archivo HTML para previsualizar.</p>;
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-line">
        {!preview && !error ? (
          <div className="grid h-[26rem] place-items-center bg-sunken">
            <p className="text-muted" role="status">
              Preparando la vista previa…
            </p>
          </div>
        ) : error ? (
          <div className="grid h-[26rem] place-items-center bg-sunken p-8 text-center">
            <p className="text-danger" role="alert">
              {error}
            </p>
          </div>
        ) : preview?.rendersEmpty ? (
          <div className="grid h-[26rem] place-items-center bg-sunken p-8 text-center">
            <div className="max-w-md">
              <h2 className="font-medium">Tu página no tiene contenido visible</h2>
              <p className="mt-2 text-sm text-muted">
                El archivo se leyó bien, pero no hay texto, imágenes ni JavaScript que pueda
                generarlos.
              </p>
            </div>
          </div>
        ) : preview ? (
          <iframe
            title="Vista previa del proyecto"
            srcDoc={preview.html}
            sandbox="allow-scripts"
            className="h-[26rem] w-full border-0 bg-white"
          />
        ) : null}
      </div>

      {preview && preview.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {preview.notes.map((note) => (
            <li key={note}>· {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
