import { WORKSPACE_LIMITS } from './constants';
import { contentTypeFor, isAllowedExtension, pickEntryFile } from './files';
import type { ProgrammingLanguage, StagedFile } from './types';

const MAX_WORKSPACE_PATH_SEGMENT_LENGTH = 100;
const ILLEGAL_WORKSPACE_PATH_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

export const WORKSPACE_FILES_CONSISTENCY_ERROR =
  'El archivo de entrada debe existir en files.';

/**
 * El archivo HTML con el que se abre la vista previa.
 * Es distinto del archivo de ejecución y nunca lo modifica.
 */
export function pickWebPreviewEntry(
  files: Record<string, string>,
  entryFile: string
): string | null {
  if (
    /\.html?$/i.test(entryFile) &&
    Object.prototype.hasOwnProperty.call(files, entryFile)
  ) {
    return entryFile;
  }

  const paths = Object.keys(files);
  const index = pickEntryFile(paths);
  if (index) return index;

  const htmlFiles = paths.filter((path) => /\.html?$/i.test(path));
  return htmlFiles.length === 1 ? htmlFiles[0] ?? null : null;
}

/** Los archivos del NexCode en la forma que consume la vista previa existente. */
export function workspaceFilesToStagedFiles(
  files: Record<string, string>
): StagedFile[] {
  return Object.entries(files).flatMap(([path, source]) => {
    if (!isAllowedExtension(path)) return [];
    const contentType = contentTypeFor(path);
    const blob = new Blob([source], { type: contentType });
    return [{ path, blob, contentType, size: blob.size }];
  });
}

/** Comprueba que el archivo de entrada pertenezca al conjunto de archivos declarado. */
export function validateWorkspaceFilesConsistency(
  files?: Record<string, string>,
  entryFile?: string
): { valid: true } | { valid: false; error: string } {
  if (
    files !== undefined &&
    entryFile !== undefined &&
    !Object.prototype.hasOwnProperty.call(files, entryFile)
  ) {
    return { valid: false, error: WORKSPACE_FILES_CONSISTENCY_ERROR };
  }

  return { valid: true };
}

/** Normaliza separadores y valida una ruta relativa de un NexCode. */
export function normalizeWorkspacePath(raw: string): string | null {
  if (raw.length === 0 || raw.includes('\0')) return null;
  if (/^[A-Za-z]:/.test(raw)) return null;

  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.length > WORKSPACE_LIMITS.maxFilePathLength) {
    return null;
  }

  const segments = normalized.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > MAX_WORKSPACE_PATH_SEGMENT_LENGTH ||
        segment.startsWith('.') ||
        ILLEGAL_WORKSPACE_PATH_CHARACTERS.test(segment)
    )
  ) {
    return null;
  }

  return normalized;
}

/** Permite validar desde formularios sin duplicar las reglas de normalización. */
export function validateWorkspacePath(path: string): boolean {
  return normalizeWorkspacePath(path) !== null;
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, ProgrammingLanguage>> = {
  py: 'python',
  r: 'r',
  js: 'javascript',
  html: 'html',
  css: 'css',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  sql: 'sql',
};

/** Deduce el resaltado de Monaco a partir del archivo, sin cambiar el lenguaje del proyecto. */
export function detectLanguageFromPath(
  path: string,
  fallback: ProgrammingLanguage
): ProgrammingLanguage {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return fallback;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? fallback;
}

export type WorkspaceFileTreeNode =
  | { type: 'file'; name: string; path: string }
  | { type: 'folder'; name: string; path: string; children: WorkspaceFileTreeNode[] };

interface MutableFolderNode {
  name: string;
  path: string;
  folders: Map<string, MutableFolderNode>;
  files: Map<string, { type: 'file'; name: string; path: string }>;
}

/** Convierte el mapa persistido en el árbol ordenado que consume el explorador. */
export function buildWorkspaceFileTree(files: Record<string, string>): WorkspaceFileTreeNode[] {
  const root: MutableFolderNode = {
    name: '',
    path: '',
    folders: new Map(),
    files: new Map(),
  };

  for (const path of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
    const segments = path.split('/');
    let folder = root;

    segments.forEach((segment, index) => {
      const childPath = segments.slice(0, index + 1).join('/');
      const isFile = index === segments.length - 1;
      if (isFile) {
        folder.files.set(segment, { type: 'file', name: segment, path });
        return;
      }

      const existing = folder.folders.get(segment);
      if (existing) {
        folder = existing;
        return;
      }

      const next: MutableFolderNode = {
        name: segment,
        path: childPath,
        folders: new Map(),
        files: new Map(),
      };
      folder.folders.set(segment, next);
      folder = next;
    });
  }

  const materialize = (node: MutableFolderNode): WorkspaceFileTreeNode[] => [
    ...[...node.folders.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => ({
        type: 'folder' as const,
        name: folder.name,
        path: folder.path,
        children: materialize(folder),
      })),
    ...[...node.files.values()].sort((left, right) => left.name.localeCompare(right.name)),
  ];

  return materialize(root);
}

export interface WorkspaceFileState {
  files: Record<string, string>;
  entryFile: string;
  activeFile: string;
}

function assertSafeWorkspacePath(rawPath: string): string {
  const path = normalizeWorkspacePath(rawPath.trim());
  if (!path) {
    throw new Error('Usa una ruta relativa sin puntos ocultos, caracteres inválidos ni “..”.');
  }
  return path;
}

function assertWorkspaceSize(files: Record<string, string>): void {
  if (Object.keys(files).length > WORKSPACE_LIMITS.maxFiles) {
    throw new Error(`Un NexCode admite como máximo ${WORKSPACE_LIMITS.maxFiles} archivos.`);
  }
  const total = Object.values(files).reduce((sum, source) => sum + source.length, 0);
  if (total > WORKSPACE_LIMITS.maxTotalWorkspaceChars) {
    throw new Error('El contenido total del NexCode es demasiado grande.');
  }
}

/** Crea y activa un archivo, sin sobrescribir rutas existentes. */
export function createWorkspaceFile(
  state: WorkspaceFileState,
  rawPath: string,
  source = ''
): WorkspaceFileState {
  const path = assertSafeWorkspacePath(rawPath);
  if (Object.prototype.hasOwnProperty.call(state.files, path)) {
    throw new Error('Ya existe un archivo con esa ruta.');
  }
  if (source.length > WORKSPACE_LIMITS.maxFileSize) {
    throw new Error('Ese archivo es demasiado grande.');
  }

  const files = { ...state.files, [path]: source };
  assertWorkspaceSize(files);
  return {
    files,
    entryFile: state.entryFile || path,
    activeFile: path,
  };
}

/** Renombra una clave de forma atómica y conserva entrada, selección y contenido. */
export function renameWorkspaceFile(
  state: WorkspaceFileState,
  oldPath: string,
  rawNewPath: string
): WorkspaceFileState {
  if (!Object.prototype.hasOwnProperty.call(state.files, oldPath)) {
    throw new Error('Ese archivo ya no existe.');
  }
  const newPath = assertSafeWorkspacePath(rawNewPath);
  if (newPath === oldPath) return state;
  if (Object.prototype.hasOwnProperty.call(state.files, newPath)) {
    throw new Error('Ya existe un archivo con esa ruta.');
  }

  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(state.files)) {
    files[path === oldPath ? newPath : path] = source;
  }
  return {
    files,
    entryFile: state.entryFile === oldPath ? newPath : state.entryFile,
    activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
  };
}

/** Elimina un archivo y elige de forma determinista una nueva entrada/selección si hace falta. */
export function deleteWorkspaceFile(
  state: WorkspaceFileState,
  path: string
): WorkspaceFileState {
  if (!Object.prototype.hasOwnProperty.call(state.files, path)) {
    throw new Error('Ese archivo ya no existe.');
  }
  if (Object.keys(state.files).length <= 1) {
    throw new Error('El proyecto debe conservar al menos un archivo.');
  }

  const { [path]: _removed, ...files } = state.files;
  const firstRemaining = Object.keys(files).sort((left, right) => left.localeCompare(right))[0];
  if (!firstRemaining) throw new Error('El proyecto debe conservar al menos un archivo.');

  return {
    files,
    entryFile: state.entryFile === path ? firstRemaining : state.entryFile,
    activeFile: state.activeFile === path ? firstRemaining : state.activeFile,
  };
}
