'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CodeEditor, sourceFilenameFor } from '@/components/aula/code-editor';
import { Notice } from '@/components/aula/aula-ui';
import { WorkspacePreview } from '@/components/workspace/workspace-preview';
import { WorkspacePublish } from '@/components/workspace/workspace-publish';
import { patchWorkspace, useApi } from '@/lib/aula-client';
import { programmingLanguageLabel } from '@/lib/constants';
import {
  buildWorkspaceFileTree,
  createWorkspaceFile,
  deleteWorkspaceFile,
  detectLanguageFromPath,
  pickWebPreviewEntry,
  renameWorkspaceFile,
  type WorkspaceFileState,
  type WorkspaceFileTreeNode,
} from '@/lib/workspace-files';
import type { CodeSaveState } from '@/components/aula/deliverable-fields';
import type { Workspace } from '@/lib/types';

/** Un solo Monaco, varios buffers controlados y un único archivo ejecutable. */

const AUTOSAVE_DELAY_MS = 800;
const AUTOSAVE_RETRY_MS = 2_000;
const MAX_AUTOSAVE_RETRIES = 1;
const PREVIEW_DELAY_MS = 400;

export function PracticeWorkspace({ workspaceId }: { workspaceId: string }) {
  const { data, state, error } = useApi<{ workspace: Workspace }>(
    `/api/workspaces/${workspaceId}`
  );

  const [files, setFiles] = useState<Record<string, string>>({});
  const [entryFile, setEntryFile] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [multiFile, setMultiFile] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [saveState, setSaveState] = useState<CodeSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'editor' | 'preview'>('editor');
  const [previewFiles, setPreviewFiles] = useState<Record<string, string> | null>(null);
  const [publishedProjectId, setPublishedProjectId] = useState<string | undefined>(undefined);

  const filesRef = useRef(files);
  const entryFileRef = useRef(entryFile);
  const activeFileRef = useRef(activeFile);
  const multiFileRef = useRef(multiFile);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const retryCountRef = useRef(0);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  const previewEntry = pickWebPreviewEntry(files, entryFile);

  useEffect(() => {
    if (workspaceMode !== 'preview') return;
    const timer = setTimeout(() => setPreviewFiles({ ...files }), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [files, workspaceMode]);

  useEffect(() => {
    if (!previewEntry && workspaceMode === 'preview') setWorkspaceMode('editor');
  }, [previewEntry, workspaceMode]);

  const replaceProject = useCallback((next: WorkspaceFileState, isMultiFile = true): void => {
    filesRef.current = next.files;
    entryFileRef.current = next.entryFile;
    activeFileRef.current = next.activeFile;
    multiFileRef.current = isMultiFile;
    setFiles(next.files);
    setEntryFile(next.entryFile);
    setActiveFile(next.activeFile);
    setMultiFile(isMultiFile);
  }, []);

  // El registro se hidrata una sola vez: una recarga del hook nunca pisa buffers locales.
  useEffect(() => {
    if (hydrated || !data?.workspace) return;
    const workspace = data.workspace;
    const isMultiFile = workspace.files !== undefined;
    const virtualPath = sourceFilenameFor(workspace.language);
    const initialFiles = isMultiFile ? { ...workspace.files } : { [virtualPath]: workspace.code };
    const paths = Object.keys(initialFiles).sort((left, right) => left.localeCompare(right));
    const initialEntry =
      isMultiFile &&
      workspace.entryFile &&
      Object.prototype.hasOwnProperty.call(initialFiles, workspace.entryFile)
        ? workspace.entryFile
        : paths[0] ?? '';

    replaceProject(
      {
        files: initialFiles,
        entryFile: isMultiFile ? initialEntry : virtualPath,
        activeFile: isMultiFile ? initialEntry : virtualPath,
      },
      isMultiFile
    );
    setPublishedProjectId(workspace.publishedProjectId);
    setHydrated(true);
  }, [data, hydrated, replaceProject]);

  /**
   * Guarda a qué proyecto publicado apunta este NexCode.
   *
   * Deja escapar el fallo a propósito: quien publica necesita distinguir «no se
   * publicó» de «se publicó pero no pude recordarlo», y esa segunda no puede
   * reintentarse volviendo a publicar. Ver `lib/workspace-publish.ts`.
   */
  const linkPublishedProject = useCallback(
    async (projectId: string): Promise<void> => {
      await patchWorkspace(workspaceId, { publishedProjectId: projectId });
      setPublishedProjectId(projectId);
    },
    [workspaceId]
  );

  const scheduleFlush = useCallback((delay = AUTOSAVE_DELAY_MS): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flushRef.current(), delay);
  }, []);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
    retryCountRef.current = 0;
    setSaveState('saving');
    setSaveError(null);
    scheduleFlush();
  }, [scheduleFlush]);

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
        if (multiFileRef.current) {
          const snapshotFiles = { ...filesRef.current };
          const snapshotEntry = entryFileRef.current;
          await patchWorkspace(workspaceId, {
            files: snapshotFiles,
            entryFile: snapshotEntry,
            code: snapshotFiles[snapshotEntry] ?? '',
          });
        } else {
          const currentPath = activeFileRef.current;
          await patchWorkspace(workspaceId, { code: filesRef.current[currentPath] ?? '' });
        }

        setSaveState(dirtyRef.current ? 'saving' : 'saved');
      } catch (caught) {
        dirtyRef.current = true;
        setSaveState('error');
        setSaveError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
        if (retryCountRef.current < MAX_AUTOSAVE_RETRIES) {
          retryCountRef.current += 1;
          scheduleFlush(AUTOSAVE_RETRY_MS);
        }
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [scheduleFlush, workspaceId]);

  flushRef.current = flush;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) void flushRef.current();
    }, []
  );

  function edit(nextSource: string): void {
    const path = activeFileRef.current;
    if (!path) return;
    const nextFiles = { ...filesRef.current, [path]: nextSource };
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    markDirty();
  }

  function selectFile(path: string): void {
    if (!Object.prototype.hasOwnProperty.call(filesRef.current, path)) return;
    activeFileRef.current = path;
    setActiveFile(path);
    setExplorerOpen(false);
    setFileError(null);
  }

  function convertToMultiFile(): void {
    replaceProject(currentProject(), true);
    markDirty();
  }

  function createFile(path: string): boolean {
    try {
      const next = createWorkspaceFile(currentProject(), path);
      replaceProject(next, true);
      setFileError(null);
      markDirty();
      return true;
    } catch (caught) {
      setFileError(fileOperationError(caught));
      return false;
    }
  }

  function renameFile(oldPath: string, newPath: string): boolean {
    try {
      const previous = currentProject();
      const wasMultiFile = multiFileRef.current;
      const next = renameWorkspaceFile(previous, oldPath, newPath);
      replaceProject(next, true);
      setFileError(null);
      if (next !== previous || !wasMultiFile) markDirty();
      return true;
    } catch (caught) {
      setFileError(fileOperationError(caught));
      return false;
    }
  }

  function deleteFile(path: string): boolean {
    try {
      const next = deleteWorkspaceFile(currentProject(), path);
      replaceProject(next, true);
      setFileError(null);
      markDirty();
      return true;
    } catch (caught) {
      setFileError(fileOperationError(caught));
      return false;
    }
  }

  function markAsEntry(path: string): void {
    if (!Object.prototype.hasOwnProperty.call(filesRef.current, path)) return;
    replaceProject({ ...currentProject(), entryFile: path }, true);
    setFileError(null);
    markDirty();
  }

  function retrySave(): void {
    retryCountRef.current = 0;
    void flush();
  }

  function currentProject(): WorkspaceFileState {
    return {
      files: filesRef.current,
      entryFile: entryFileRef.current,
      activeFile: activeFileRef.current,
    };
  }

  if (state === 'error') {
    return <Notice tone="error">{error ?? 'No pudimos abrir este NexCode.'}</Notice>;
  }
  if (state === 'loading' || !hydrated) {
    return <p className="py-10 text-center text-muted">Cargando…</p>;
  }
  if (!data) return <Notice tone="error">No pudimos abrir este NexCode.</Notice>;

  const { workspace } = data;
  const activeLanguage = detectLanguageFromPath(activeFile, workspace.language);
  const entryLanguage = detectLanguageFromPath(entryFile, workspace.language);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <Link href="/practicas" className="meta no-underline hover:underline" onClick={() => void flush()}>
            ← Mis espacios
          </Link>
          <h1 className="mt-2 truncate font-display text-h1">{workspace.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {programmingLanguageLabel(workspace.language)} · privada
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm md:hidden"
            aria-controls="workspace-file-explorer"
            aria-expanded={explorerOpen}
            onClick={() => setExplorerOpen((open) => !open)}
          >
            {explorerOpen ? 'Ocultar archivos' : 'Archivos'}
          </button>
          <SaveIndicator state={saveState} error={saveError} onRetry={retrySave} />
        </div>
      </header>

      <div className="panel mt-6 overflow-hidden md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          id="workspace-file-explorer"
          aria-label="Explorador de archivos"
          className={`${explorerOpen ? 'block' : 'hidden'} border-b border-line bg-sunken md:block md:border-r md:border-b-0`}
        >
          <WorkspaceExplorer
            files={files}
            entryFile={entryFile}
            activeFile={activeFile}
            multiFile={multiFile}
            error={fileError}
            onSelect={selectFile}
            onCreate={createFile}
            onRename={renameFile}
            onDelete={deleteFile}
            onMarkEntry={markAsEntry}
            onConvert={convertToMultiFile}
          />
        </aside>

        <main className="min-w-0 bg-surface">
          {previewEntry && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
              <div className="flex gap-2" aria-label="Vista del proyecto">
                <button
                  type="button"
                  className={`chip ${workspaceMode === 'editor' ? 'chip-selected' : ''}`}
                  aria-pressed={workspaceMode === 'editor'}
                  onClick={() => setWorkspaceMode('editor')}
                >
                  Editor
                </button>
                <button
                  type="button"
                  className={`chip ${workspaceMode === 'preview' ? 'chip-selected' : ''}`}
                  aria-pressed={workspaceMode === 'preview'}
                  onClick={() => {
                    setPreviewFiles({ ...files });
                    setWorkspaceMode('preview');
                  }}
                >
                  Vista previa
                </button>
              </div>
              {workspaceMode === 'preview' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPreviewFiles({ ...files })}
                >
                  Actualizar vista previa
                </button>
              )}
            </div>
          )}
          {/* Publicar aparece con la misma condición que la vista previa —hay
              un HTML—, así que un NexCode de Python o R no lo ve. */}
          {previewEntry && (
            <WorkspacePublish
              files={files}
              entryFile={entryFile}
              title={workspace.title}
              publishedProjectId={publishedProjectId}
              onLinked={linkPublishedProject}
            />
          )}
          {/* Oculto y NO desmontado: desmontarlo tiraría el modelo de Monaco, y
              con él el deshacer y la posición del cursor de quien sólo quería
              echar un vistazo a la vista previa. */}
          <div hidden={workspaceMode !== 'editor'}>
            <WorkspaceTabs
              paths={Object.keys(files).sort((left, right) => left.localeCompare(right))}
              activeFile={activeFile}
              entryFile={entryFile}
              onSelect={selectFile}
            />
            <div className="p-3 sm:p-4">
              {activeFile ? (
                <CodeEditor
                  language={activeLanguage}
                  executionLanguage={entryLanguage}
                  value={files[activeFile] ?? ''}
                  onChange={edit}
                  executionEnabled
                  executionSource={files[entryFile] ?? ''}
                  // El workspace legacy usa una clave virtual; enviarla cambiaría
                  // una ejecución de un archivo por una ejecución de proyecto.
                  executionFiles={multiFile ? files : undefined}
                  executionEntryFile={multiFile ? entryFile : undefined}
                  beforeExecute={flush}
                  height={460}
                  ariaLabel={`Archivo ${activeFile} en ${programmingLanguageLabel(activeLanguage)}`}
                />
              ) : (
                <div className="flex min-h-[460px] items-center justify-center p-8 text-center text-sm text-muted">
                  Crea un archivo para empezar a editar este proyecto.
                </div>
              )}
            </div>
          </div>
          {workspaceMode === 'preview' && previewFiles && (
            <div className="p-3 sm:p-4">
              <WorkspacePreview files={previewFiles} entryFile={entryFile} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function WorkspaceExplorer({
  files,
  entryFile,
  activeFile,
  multiFile,
  error,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onMarkEntry,
  onConvert,
}: {
  files: Record<string, string>;
  entryFile: string;
  activeFile: string;
  multiFile: boolean;
  error: string | null;
  onSelect: (path: string) => void;
  onCreate: (path: string) => boolean;
  onRename: (oldPath: string, newPath: string) => boolean;
  onDelete: (path: string) => boolean;
  onMarkEntry: (path: string) => void;
  onConvert: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const createInputId = useId();
  const renameInputId = useId();

  function submitCreate(event: FormEvent): void {
    event.preventDefault();
    if (onCreate(newPath)) {
      setNewPath('');
      setCreating(false);
    }
  }

  function submitRename(event: FormEvent): void {
    event.preventDefault();
    if (renaming && onRename(renaming, renamePath)) {
      setRenaming(null);
      setRenamePath('');
    }
  }

  return (
    <div className="flex max-h-[38rem] min-h-0 flex-col md:h-full md:max-h-none">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="meta text-fg">Proyecto</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Crear nuevo archivo"
          title="Nuevo archivo"
          onClick={() => setCreating(true)}
        >
          + Archivo
        </button>
      </div>

      {!multiFile && (
        <div className="border-b border-line px-3 py-3">
          <p className="text-sm text-muted">Este NexCode aún usa un solo archivo.</p>
          <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={onConvert}>
            Convertir en proyecto
          </button>
        </div>
      )}

      {creating && (
        <form className="border-b border-line p-3" onSubmit={submitCreate}>
          <label htmlFor={createInputId} className="label">Ruta del archivo</label>
          <input
            id={createInputId}
            className="field font-mono text-sm"
            value={newPath}
            autoFocus
            placeholder="src/utils.py"
            onChange={(event) => setNewPath(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">Crear</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && <p className="border-b border-line px-3 py-2 text-sm text-danger" role="alert">{error}</p>}

      <div className="min-h-0 overflow-y-auto p-2">
        <FileTree
          nodes={buildWorkspaceFileTree(files)}
          activeFile={activeFile}
          entryFile={entryFile}
          onSelect={onSelect}
          onStartRename={(path) => {
            setRenaming(path);
            setRenamePath(path);
            setDeleting(null);
          }}
          onStartDelete={(path) => {
            setDeleting(path);
            setRenaming(null);
          }}
          onMarkEntry={onMarkEntry}
        />
      </div>

      {renaming && (
        <form className="border-t border-line p-3" onSubmit={submitRename}>
          <label htmlFor={renameInputId} className="label">Renombrar {renaming}</label>
          <input
            id={renameInputId}
            className="field font-mono text-sm"
            value={renamePath}
            autoFocus
            onChange={(event) => setRenamePath(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {deleting && (
        <div className="border-t border-line p-3" role="alertdialog" aria-label={`Eliminar ${deleting}`}>
          <p className="text-sm">¿Eliminar <span className="font-mono">{deleting}</span>?</p>
          <p className="mt-1 text-sm text-muted">Esta acción no se puede deshacer.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              autoFocus
              onClick={() => {
                if (onDelete(deleting)) setDeleting(null);
              }}
            >
              Eliminar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileTree({
  nodes,
  activeFile,
  entryFile,
  onSelect,
  onStartRename,
  onStartDelete,
  onMarkEntry,
  depth = 0,
}: {
  nodes: WorkspaceFileTreeNode[];
  activeFile: string;
  entryFile: string;
  onSelect: (path: string) => void;
  onStartRename: (path: string) => void;
  onStartDelete: (path: string) => void;
  onMarkEntry: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-1" aria-label={depth === 0 ? 'Archivos del proyecto' : undefined}>
      {nodes.map((node) =>
        node.type === 'folder' ? (
          <li key={`folder:${node.path}`}>
            <details open>
              <summary className="cursor-pointer rounded-xs px-2 py-1.5 font-mono text-sm text-muted hover:bg-surface">
                {node.name}/
              </summary>
              <div className="ml-3 border-l border-line pl-1">
                <FileTree
                  nodes={node.children}
                  activeFile={activeFile}
                  entryFile={entryFile}
                  onSelect={onSelect}
                  onStartRename={onStartRename}
                  onStartDelete={onStartDelete}
                  onMarkEntry={onMarkEntry}
                  depth={depth + 1}
                />
              </div>
            </details>
          </li>
        ) : (
          <li
            key={`file:${node.path}`}
            className={`group rounded-sm border ${activeFile === node.path ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface'}`}
          >
            <button
              type="button"
              className="flex min-h-9 w-full min-w-0 items-center gap-2 px-2 text-left font-mono text-sm"
              aria-current={activeFile === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)}
            >
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {entryFile === node.path && <span className="tag h-5 px-1 text-[0.65rem]">Principal</span>}
            </button>
            <div className="flex border-t border-line px-1 py-1">
              {entryFile !== node.path && (
                <button
                  type="button"
                  className="btn btn-ghost min-h-8 px-2 text-xs"
                  aria-label={`Marcar ${node.path} como archivo principal`}
                  onClick={() => onMarkEntry(node.path)}
                >
                  Principal
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost min-h-8 px-2 text-xs"
                aria-label={`Renombrar ${node.path}`}
                onClick={() => onStartRename(node.path)}
              >
                Renombrar
              </button>
              <button
                type="button"
                className="btn btn-ghost min-h-8 px-2 text-xs text-danger"
                aria-label={`Eliminar ${node.path}`}
                onClick={() => onStartDelete(node.path)}
              >
                Eliminar
              </button>
            </div>
          </li>
        )
      )}
    </ul>
  );
}

function WorkspaceTabs({
  paths,
  activeFile,
  entryFile,
  onSelect,
}: {
  paths: string[];
  activeFile: string;
  entryFile: string;
  onSelect: (path: string) => void;
}) {
  return (
    <nav className="tab-row border-b border-line bg-sunken px-2 pt-2" aria-label="Archivos abiertos">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          className={`min-h-10 border border-b-0 px-3 font-mono text-sm ${
            activeFile === path
              ? 'border-line-strong bg-surface text-fg'
              : 'border-transparent text-muted hover:bg-surface'
          }`}
          aria-current={activeFile === path ? 'page' : undefined}
          title={path}
          onClick={() => onSelect(path)}
        >
          {path}
          {entryFile === path && <span className="ml-2 text-accent" aria-label="Archivo principal">●</span>}
        </button>
      ))}
    </nav>
  );
}

function SaveIndicator({
  state,
  error,
  onRetry,
}: {
  state: CodeSaveState;
  error: string | null;
  onRetry: () => void;
}) {
  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2" role="status">
        <span className="text-sm text-danger">{error || 'No se pudo guardar.'}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <span className="text-sm text-subtle" role="status">
      {state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  );
}

function fileOperationError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'No se pudo actualizar el archivo.';
}
