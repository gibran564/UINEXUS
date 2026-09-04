import { unzip } from 'fflate';
import { ALLOWED_EXTENSIONS, CONTENT_TYPE_BY_EXTENSION, LIMITS } from './constants';
import type { StagedFile } from './types';

/**
 * Validación de archivos subidos por alumnos.
 *
 * IMPORTANTE: esto se ejecuta en el navegador y su función es dar buenos
 * mensajes de error, no proteger la plataforma. La protección real está en
 * el servidor:
 * al firmar la subida (extensión, tamaño, ruta, Content-Type del objeto) y en
 * el origen aislado (saneado de rutas, cabeceras, estado publicado).
 */

export interface FileIssue {
  path: string;
  reason: string;
}

export interface StagingResult {
  files: StagedFile[];
  entryFile: string | null;
  totalBytes: number;
  issues: FileIssue[];
}

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(path: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(path));
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(path)] ?? 'application/octet-stream';
}

/**
 * Limpia una ruta relativa: quita prefijos peligrosos, colapsa separadores y
 * rechaza cualquier intento de salir del directorio del proyecto.
 * Devuelve null si la ruta no es admisible.
 */
export function sanitizeRelativePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('\0')) return null;

  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    if (segment.startsWith('.')) return null; // .git, .env, .DS_Store…
    if (segment.length > 120) return null;
    if (/[<>:"|?*\u0000-\u001f]/.test(segment)) return null;
    segments.push(segment);
  }

  const path = segments.join('/');
  if (path === '' || path.length > 300) return null;
  return path;
}

/**
 * Muchos .zip traen todo dentro de una carpeta raíz ("mi-sitio/index.html").
 * Publicar eso tal cual dejaría el index.html en el nivel equivocado, así que
 * se detecta y se elimina el prefijo común.
 */
export function stripCommonRoot(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const firstPath = paths[0];
  if (!firstPath) return '';
  const first = firstPath.split('/');
  if (first.length < 2) return '';
  const candidate = first[0];
  if (!candidate) return '';
  return paths.every((path) => path.startsWith(`${candidate}/`)) ? `${candidate}/` : '';
}

/** Elige el index.html más cercano a la raíz como entrada del proyecto. */
export function pickEntryFile(paths: readonly string[]): string | null {
  const candidates = paths
    .filter((path) => /(^|\/)index\.html?$/i.test(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return candidates[0] ?? null;
}

function validate(path: string, size: number, issues: FileIssue[]): boolean {
  if (!isAllowedExtension(path)) {
    issues.push({
      path,
      reason: `No se admite el tipo de archivo ".${extensionOf(path) || '?'}".`,
    });
    return false;
  }
  if (size > LIMITS.maxFileBytes) {
    issues.push({
      path,
      reason: `Pesa ${formatBytes(size)}; el máximo por archivo es ${formatBytes(
        LIMITS.maxFileBytes
      )}.`,
    });
    return false;
  }
  return true;
}

/** Prepara archivos sueltos (drag & drop de una carpeta o de varios archivos). */
export function stageLooseFiles(fileList: readonly File[]): StagingResult {
  const issues: FileIssue[] = [];
  const files: StagedFile[] = [];
  let totalBytes = 0;

  const rawPaths = fileList.map(
    (file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  );
  const root = stripCommonRoot(rawPaths.map((p) => sanitizeRelativePath(p) ?? p));

  fileList.forEach((file, index) => {
    const rawPath = rawPaths[index] ?? file.name;
    const clean = sanitizeRelativePath(rawPath);
    if (!clean) {
      issues.push({ path: rawPath, reason: 'La ruta del archivo no es válida.' });
      return;
    }
    const path = root && clean.startsWith(root) ? clean.slice(root.length) : clean;
    if (!path) return;
    if (!validate(path, file.size, issues)) return;

    files.push({ path, size: file.size, contentType: contentTypeFor(path), blob: file });
    totalBytes += file.size;
  });

  return finalize(files, totalBytes, issues);
}

/** Extrae y valida un .zip en el navegador, entrada por entrada. */
export async function stageZipFile(zip: File): Promise<StagingResult> {
  const issues: FileIssue[] = [];

  if (zip.size > LIMITS.maxZipBytes) {
    return {
      files: [],
      entryFile: null,
      totalBytes: 0,
      issues: [
        {
          path: zip.name,
          reason: `El .zip pesa ${formatBytes(zip.size)}; el máximo es ${formatBytes(
            LIMITS.maxZipBytes
          )}.`,
        },
      ],
    };
  }

  const buffer = new Uint8Array(await zip.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, (error, data) => (error ? reject(error) : resolve(data)));
  });

  const rawPaths = Object.keys(entries).filter((path) => !path.endsWith('/'));
  const cleaned = rawPaths
    .map((path) => ({ raw: path, clean: sanitizeRelativePath(path) }))
    .filter((entry): entry is { raw: string; clean: string } => {
      if (entry.clean) return true;
      issues.push({ path: entry.raw, reason: 'Ruta no permitida dentro del .zip.' });
      return false;
    });

  const root = stripCommonRoot(cleaned.map((entry) => entry.clean));
  const files: StagedFile[] = [];
  let totalBytes = 0;

  for (const entry of cleaned) {
    const bytes = entries[entry.raw];
    if (!bytes) continue;
    const path =
      root && entry.clean.startsWith(root) ? entry.clean.slice(root.length) : entry.clean;
    if (!path) continue;
    if (!validate(path, bytes.byteLength, issues)) continue;

    const contentType = contentTypeFor(path);
    // La copia evita el problema de SharedArrayBuffer al construir el Blob.
    files.push({
      path,
      size: bytes.byteLength,
      contentType,
      blob: new Blob([new Uint8Array(bytes)], { type: contentType }),
    });
    totalBytes += bytes.byteLength;
  }

  return finalize(files, totalBytes, issues);
}

function finalize(
  files: StagedFile[],
  totalBytes: number,
  issues: FileIssue[]
): StagingResult {
  if (files.length > LIMITS.maxFiles) {
    issues.push({
      path: '',
      reason: `El proyecto tiene ${files.length} archivos; el máximo es ${LIMITS.maxFiles}.`,
    });
  }
  if (totalBytes > LIMITS.maxProjectBytes) {
    issues.push({
      path: '',
      reason: `El proyecto pesa ${formatBytes(totalBytes)}; el máximo es ${formatBytes(
        LIMITS.maxProjectBytes
      )}.`,
    });
  }

  const entryFile = pickEntryFile(files.map((file) => file.path));
  if (files.length > 0 && !entryFile) {
    issues.push({
      path: '',
      reason: 'No encontramos un archivo index.html. Es el que se abre primero.',
    });
  }

  return { files, entryFile, totalBytes, issues };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
