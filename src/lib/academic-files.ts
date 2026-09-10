import {
  ACADEMIC_FILE_EXTENSIONS,
  ACADEMIC_FILE_LIMITS,
  ACADEMIC_FILE_TYPES,
} from './constants';
import type { AcademicFileClass } from './types';

/**
 * Qué tipo de archivo es y con qué extensión se guarda.
 *
 * Módulo PURO —sin `server-only`, sin red— porque la decisión la necesitan los
 * dos lados: el navegador para avisar antes de intentar subir, el servidor para
 * decidir. Lo que vale es la del servidor; ésta es la misma función, así que no
 * pueden discrepar.
 *
 * ## La regla, y por qué está escrita así
 *
 * Manda la EXTENSIÓN del nombre, y el `Content-Type` declarado sólo puede
 * confirmarla o desmentirla. Suena al revés de lo intuitivo, así que conviene el
 * porqué:
 *
 *  · Un `.R` llega del navegador con `Content-Type` vacío o
 *    `application/octet-stream`. Si el tipo declarado decidiera, no habría forma
 *    de admitir un fuente de R sin admitir a la vez cualquier binario, que es
 *    exactamente lo que la lista blanca existe para impedir.
 *  · La extensión no es un riesgo porque no se confía en ella para NADA
 *    ejecutable: sólo elige una entrada de una tabla cerrada, y el
 *    `Content-Type` con el que el objeto acaba guardado lo fija el servidor en
 *    la condición del POST firmado a partir de esa misma tabla. Un `.pdf` que en
 *    realidad sea otra cosa se guarda como `application/pdf` y se sirve como
 *    tal desde un bucket privado y otro origen; no se ejecuta nada.
 *  · Un tipo declarado que NO pertenece a la clase —`text/html` en un documento—
 *    se rechaza aunque la extensión sea válida. No aporta seguridad real, pero
 *    delata un cliente que está mintiendo sobre algo, y en ese caso lo correcto
 *    es no seguir.
 *
 * El nombre del archivo NUNCA entra en la ruta en S3 (ver `academicFileKey`):
 * de él sólo se lee la extensión, y sólo para buscarla en la tabla.
 */

/** Lo que manda un navegador cuando no sabe qué es. No decide nada por sí solo. */
const GENERIC_BINARY = 'application/octet-stream';

export interface ResolvedUpload {
  /** Extensión con la que se guarda el objeto. Sale de la lista blanca. */
  extension: string;
  /** `Content-Type` que el servidor fija en el POST firmado. */
  contentType: string;
}

/** La extensión de un nombre de archivo, en minúsculas y sin el punto. */
export function fileExtensionOf(fileName: string): string {
  const base = fileName.trim().toLowerCase().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).replace(/[^a-z0-9]/g, '');
}

/**
 * Resuelve el tipo de una subida, o `null` si no se admite.
 *
 * Devuelve `null` en vez de lanzar para poder usarse también en el navegador,
 * donde un tipo no admitido es un aviso y no un error. Quien firma la subida
 * traduce el `null` a un 422 con la lista de lo que sí se admite.
 */
export function resolveAcademicUpload(
  fileClass: AcademicFileClass,
  input: { contentType?: string | null; fileName?: string | null }
): ResolvedUpload | null {
  const byExtension = ACADEMIC_FILE_EXTENSIONS[fileClass];
  const byType = ACADEMIC_FILE_TYPES[fileClass];

  const declared = (input.contentType ?? '').trim().toLowerCase();
  const extension = fileExtensionOf(input.fileName ?? '');
  const canonical = extension ? byExtension[extension] : undefined;

  if (canonical) {
    const consistent =
      !declared ||
      declared === GENERIC_BINARY ||
      declared === canonical ||
      Boolean(byType[declared]);
    return consistent ? { extension, contentType: canonical } : null;
  }

  // Sin extensión reconocible, el tipo declarado es lo único que queda.
  const fromType = declared ? byType[declared] : undefined;
  return fromType ? { extension: fromType, contentType: declared } : null;
}

/** Las extensiones que admite una clase, para poder decirlas en un mensaje. */
export function allowedExtensionsFor(fileClass: AcademicFileClass): string[] {
  return Object.keys(ACADEMIC_FILE_EXTENSIONS[fileClass]).map((extension) => `.${extension}`);
}

/** ¿Cabe? El límite real lo aplica la condición del POST firmado. */
export function isWithinAcademicLimit(fileClass: AcademicFileClass, sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= ACADEMIC_FILE_LIMITS[fileClass];
}

/** Tamaño legible: «2.4 MB». Para las fichas de archivo, no para validar. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}
