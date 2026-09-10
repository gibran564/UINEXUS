'use client';

import { useId, useRef, useState } from 'react';
import {
  ACADEMIC_FILE_LIMITS,
  ACADEMIC_LIMITS,
  MATERIAL_KIND_HELP,
  MATERIAL_KIND_LABEL,
  acceptAttributeFor,
  fileLimitLabel,
} from '@/lib/constants';
import { allowedExtensionsFor, formatFileSize, resolveAcademicUpload } from '@/lib/academic-files';
import {
  assignmentMaterialUrl,
  deleteAssignmentMaterial,
  openSignedUrl,
  updateAssignmentMaterial,
  uploadAssignmentMaterial,
} from '@/lib/aula-client';
import type { AssignmentMaterial, AssignmentMaterialKind } from '@/lib/types';
import { Notice } from './aula-ui';

/**
 * Los archivos que el profesorado reparte con la tarea.
 *
 * Un solo componente para los dos públicos porque la lista es la misma y sólo
 * cambia lo que se puede hacer con ella: la docente sube, renombra y quita; el
 * alumnado descarga. Separarlos en dos componentes habría duplicado la ficha del
 * archivo, que es la parte que tiene que verse igual en las dos pantallas.
 *
 * Ninguna acción recarga la pantalla: la ruta devuelve la lista completa después
 * de cada cambio y el estado local se sustituye por ella. Es más simple que
 * parchear la lista a mano y no puede quedar desincronizado.
 */

const ACCEPT = acceptAttributeFor('material');
const LIMIT = fileLimitLabel('material');

export function AssignmentMaterials({
  assignmentId,
  materials,
  canManage,
  onChange,
}: {
  assignmentId: string;
  materials: AssignmentMaterial[];
  /** `true` sólo para el profesorado de la materia. El servidor lo comprueba. */
  canManage: boolean;
  onChange?: (materials: AssignmentMaterial[]) => void;
}) {
  if (materials.length === 0 && !canManage) return null;

  return (
    <section aria-labelledby="materiales" className="mt-8">
      <h2 id="materiales" className="font-display text-h3">
        {canManage ? 'Archivos para los estudiantes' : 'Materiales de la tarea'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {canManage
          ? 'Plantillas, datos y documentos que necesita el grupo para hacer la tarea.'
          : 'Los descargas, los usas y entregas tu trabajo en el formulario de entrega.'}
      </p>

      <MaterialsList
        assignmentId={assignmentId}
        materials={materials}
        canManage={canManage}
        onChange={onChange}
      />
    </section>
  );
}

/** La lista y sus acciones, sin encabezado: se reutiliza dentro del editor. */
export function MaterialsList({
  assignmentId,
  materials,
  canManage,
  onChange,
}: {
  assignmentId: string;
  materials: AssignmentMaterial[];
  canManage: boolean;
  onChange?: (materials: AssignmentMaterial[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<{ materials: AssignmentMaterial[] }>) {
    setBusyId(id);
    setError(null);
    try {
      const { materials: next } = await action();
      onChange?.(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo completar la acción.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4">
      {materials.length === 0 ? (
        <Notice>
          {canManage
            ? 'Todavía no has adjuntado ningún archivo. Sube la plantilla, los datos o el caso de estudio.'
            : 'Esta tarea no trae archivos.'}
        </Notice>
      ) : (
        <ul className="space-y-2">
          {materials.map((material) => (
            <MaterialRow
              key={material.id}
              assignmentId={assignmentId}
              material={material}
              canManage={canManage}
              busy={busyId === material.id}
              onRename={(displayName) =>
                run(material.id, () =>
                  updateAssignmentMaterial(assignmentId, { id: material.id, displayName })
                )
              }
              onChangeKind={(kind) =>
                run(material.id, () =>
                  updateAssignmentMaterial(assignmentId, { id: material.id, kind })
                )
              }
              onRemove={() =>
                run(material.id, () => deleteAssignmentMaterial(assignmentId, material.id))
              }
            />
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {canManage && (
        <MaterialUploader
          assignmentId={assignmentId}
          count={materials.length}
          onUploaded={(next) => onChange?.(next)}
        />
      )}
    </div>
  );
}

function MaterialRow({
  assignmentId,
  material,
  canManage,
  busy,
  onRename,
  onChangeKind,
  onRemove,
}: {
  assignmentId: string;
  material: AssignmentMaterial;
  canManage: boolean;
  busy: boolean;
  onRename: (displayName: string) => void;
  onChangeKind: (kind: AssignmentMaterialKind) => void;
  onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(material.displayName);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /** La firma se pide al pulsar. Ver `openSignedUrl` para el porqué del orden. */
  async function download(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      await openSignedUrl(() => assignmentMaterialUrl(assignmentId, material.id));
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'No se pudo abrir el archivo.');
    } finally {
      setDownloading(false);
    }
  }

  const extension = material.fileName.split('.').pop()?.toUpperCase() ?? '';
  const size = formatFileSize(material.sizeBytes);

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <FileGlyph kind={material.kind} />

        <div className="min-w-40 flex-1">
          {renaming ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1">
                <span className="sr-only">Nombre visible del archivo</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="field"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRename(name);
                  setRenaming(false);
                }}
                className="btn btn-primary btn-sm"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setName(material.displayName);
                  setRenaming(false);
                }}
                className="btn btn-ghost btn-sm"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <p className="font-medium">{material.displayName}</p>
              <p className="mt-1 text-label text-subtle">
                {/* El estado nunca se dice sólo con color: la clase va escrita. */}
                {MATERIAL_KIND_LABEL[material.kind]}
                {extension && ` · ${extension}`}
                {size && ` · ${size}`}
              </p>
              {canManage && material.uploadedByName && (
                <p className="text-label text-subtle">Subido por {material.uploadedByName}</p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="btn btn-secondary btn-sm"
          >
            {downloading ? 'Abriendo…' : 'Descargar'}
          </button>

          {canManage && !renaming && (
            <>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="btn btn-ghost btn-sm"
              >
                Renombrar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onChangeKind(material.kind === 'template' ? 'resource' : 'template')
                }
                className="btn btn-ghost btn-sm"
              >
                Marcar como{' '}
                {material.kind === 'template'
                  ? MATERIAL_KIND_LABEL.resource
                  : MATERIAL_KIND_LABEL.template}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn btn-ghost btn-sm"
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      </div>

      {!canManage && (
        <p className="mt-2 text-label text-subtle">{MATERIAL_KIND_HELP[material.kind]}</p>
      )}

      {downloadError && (
        <div className="mt-3">
          <Notice tone="error">{downloadError}</Notice>
        </div>
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm">
            ¿Eliminar «{material.displayName}»? El grupo dejará de verlo.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            className="btn btn-danger btn-sm"
          >
            Sí, eliminar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost btn-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

/** Icono con su texto al lado: nunca se distingue la clase sólo por el dibujo. */
function FileGlyph({ kind }: { kind: AssignmentMaterialKind }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line text-base"
    >
      {kind === 'template' ? '📄' : '📎'}
    </span>
  );
}

function MaterialUploader({
  assignmentId,
  count,
  onUploaded,
}: {
  assignmentId: string;
  count: number;
  onUploaded: (materials: AssignmentMaterial[]) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AssignmentMaterialKind>('resource');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const full = count >= ACADEMIC_LIMITS.maxMaterialsPerAssignment;

  /**
   * Se sube uno a uno y en orden. En paralelo sería más rápido y bastante peor:
   * cada subida devuelve la lista completa, así que dos respuestas simultáneas
   * se pisarían y una de las dos desaparecería de la pantalla aunque el archivo
   * sí estuviera guardado.
   */
  async function upload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setError(null);
    setDone(null);

    let latest: AssignmentMaterial[] | null = null;

    for (const file of Array.from(files)) {
      // El mismo aviso que dará el servidor, dicho antes de gastar la subida.
      if (!resolveAcademicUpload('material', { fileName: file.name, contentType: file.type })) {
        setError(
          `«${file.name}» no es un formato admitido. Se admiten: ${allowedExtensionsFor('material').join(', ')}.`
        );
        break;
      }
      if (file.size > ACADEMIC_FILE_LIMITS.material) {
        setError(`«${file.name}» supera el límite de ${LIMIT}.`);
        break;
      }

      setPending(file.name);
      try {
        latest = await uploadAssignmentMaterial(assignmentId, file, { kind });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `No se pudo subir «${file.name}».`);
        break;
      } finally {
        setPending(null);
      }
    }

    if (latest) {
      onUploaded(latest);
      setDone('Archivo añadido. El grupo ya puede descargarlo.');
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="mt-4 rounded-sm border border-dashed border-line-strong p-4">
      <fieldset>
        <legend className="label">¿Qué clase de archivo es?</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(['resource', 'template'] as const).map((option) => (
            <label key={option} className="flex items-start gap-2">
              <input
                type="radio"
                name={`material-kind-${inputId}`}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{MATERIAL_KIND_LABEL[option]}</span>
                <span className="block text-label text-subtle">{MATERIAL_KIND_HELP[option]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={inputId} className="label">
          Añadir archivos
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={Boolean(pending) || full}
          onChange={(event) => void upload(event.target.files)}
          aria-describedby={`${inputId}-hint`}
          className="field"
        />
        <p id={`${inputId}-hint`} className="hint">
          PDF, Word, Excel, PowerPoint, CSV, texto, imágenes y archivos .R. Máximo {LIMIT} por
          archivo.
        </p>
      </div>

      {full && (
        <div className="mt-3">
          <Notice>Esta tarea llegó al límite de archivos. Quita alguno para añadir otro.</Notice>
        </div>
      )}
      {pending && (
        <div className="mt-3">
          <Notice>Subiendo «{pending}»… no cierres esta pestaña.</Notice>
        </div>
      )}
      {done && !pending && (
        <div className="mt-3">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
