import { WORKSPACE_LIMITS } from './constants';

const MAX_WORKSPACE_PATH_SEGMENT_LENGTH = 100;
const ILLEGAL_WORKSPACE_PATH_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

export const WORKSPACE_FILES_CONSISTENCY_ERROR =
  'El archivo de entrada debe existir en files.';

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
