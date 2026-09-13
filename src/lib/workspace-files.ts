import { WORKSPACE_LIMITS } from './constants';

const MAX_WORKSPACE_PATH_SEGMENT_LENGTH = 100;
const ILLEGAL_WORKSPACE_PATH_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

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
