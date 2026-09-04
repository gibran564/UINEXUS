'use client';

import type { SessionUser } from '@/components/auth/auth-provider';
import { apiFetch, uploadSigned } from './api-client';
import { isFirebaseConfigured } from './firebase/config';
import type { ProjectCover, ProjectType, StagedFile, Visibility } from './types';
import type { ProjectMetadataInput } from './schemas';

/**
 * Publicación de proyectos desde el navegador.
 *
 * Cómo funcionaba antes (Firebase): el navegador escribía directamente en
 * Firestore y en Cloud Storage, y las reglas decidían si le dejaban.
 *
 * Cómo funciona ahora (AWS): el navegador no tiene credenciales de nada. Pide
 * al servidor (1) crear el proyecto, (2) permisos de subida acotados por
 * archivo, y (3) publicar la versión. Los archivos siguen yendo directos del
 * navegador a S3 —sin pasar por el servidor de Next, que sería un cuello de
 * botella de ancho de banda— pero con un permiso que el servidor firmó para
 * una ruta, un tipo y un tamaño concretos.
 *
 * El orden importa y es deliberado: los archivos se suben a `v{n+1}` y el
 * puntero se mueve al final. Si algo falla a mitad, la versión anterior sigue
 * publicada y nadie ve un sitio roto.
 */

export interface PublishPayload {
  metadata: ProjectMetadataInput;
  slug: string;
  projectType: ProjectType;
  visibility: Visibility;
  files: readonly StagedFile[];
  entryFile: string;
  cover: File | null;
}

export interface PublishProgress {
  phase: 'creando' | 'subiendo' | 'portada' | 'publicando' | 'listo';
  uploaded: number;
  total: number;
}

export interface PublishResult {
  projectId: string;
  handle: string;
  slug: string;
}

interface SignedTarget {
  url: string;
  fields: Record<string, string>;
}

interface UploadsResponse {
  uploads: { path: string; url: string; fields: Record<string, string> }[];
  cover: (SignedTarget & { publicUrl: string }) | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulate(
  total: number,
  onProgress: (progress: PublishProgress) => void
): Promise<void> {
  onProgress({ phase: 'creando', uploaded: 0, total });
  await delay(400);
  for (let index = 1; index <= total; index += 1) {
    onProgress({ phase: 'subiendo', uploaded: index, total });
    await delay(60);
  }
  onProgress({ phase: 'publicando', uploaded: total, total });
  await delay(400);
  onProgress({ phase: 'listo', uploaded: total, total });
}

/**
 * Sube los archivos de una versión en serie.
 *
 * En serie a propósito: cien peticiones en paralelo desde la conexión de una
 * cafetería universitaria terminan en tiempos de espera y en una publicación a
 * medias, que es peor que una lenta.
 */
async function uploadFiles(
  files: readonly StagedFile[],
  targets: UploadsResponse['uploads'],
  onProgress: (uploaded: number) => void
): Promise<void> {
  const byPath = new Map(targets.map((target) => [target.path, target]));
  let uploaded = 0;

  for (const file of files) {
    const target = byPath.get(file.path);
    if (!target) throw new Error(`El servidor no autorizó la subida de ${file.path}.`);
    await uploadSigned(target, file.blob, file.path);
    uploaded += 1;
    onProgress(uploaded);
  }
}

/** Pide permisos de subida y sube todo. Devuelve la portada si la había. */
async function uploadVersion(
  projectId: string,
  version: number,
  files: readonly StagedFile[],
  cover: File | null,
  title: string,
  onProgress: (progress: PublishProgress) => void
): Promise<ProjectCover | null> {
  const total = files.length;

  const signed = await apiFetch<UploadsResponse>(`/api/projects/${projectId}/uploads`, {
    method: 'POST',
    body: {
      version,
      files: files.map((file) => ({ path: file.path, size: file.size })),
      cover: cover ? { contentType: cover.type, size: cover.size } : null,
    },
  });

  await uploadFiles(files, signed.uploads, (uploaded) =>
    onProgress({ phase: 'subiendo', uploaded, total })
  );

  if (cover && signed.cover) {
    onProgress({ phase: 'portada', uploaded: total, total });
    await uploadSigned(signed.cover, cover, 'cover');
    return { url: signed.cover.publicUrl, alt: `Captura de ${title}` };
  }

  return null;
}

/**
 * Si la publicación falla después de subir archivos, se pide al servidor que
 * limpie la versión abandonada. Sin esto, cada intento fallido deja copias
 * completas del proyecto ocupando el bucket para siempre.
 */
async function discardVersion(projectId: string, version: number): Promise<void> {
  await apiFetch(`/api/projects/${projectId}/finalize`, {
    method: 'DELETE',
    body: { version },
  }).catch(() => {
    // La limpieza es best-effort: no debe tapar el error real que la provocó.
  });
}

export async function publishProject(
  user: SessionUser,
  payload: PublishPayload,
  onProgress: (progress: PublishProgress) => void
): Promise<PublishResult> {
  const total = payload.files.length;

  // Modo demo: se simula el trabajo para poder recorrer el flujo entero sin
  // backend, igual que antes de la migración.
  if (!isFirebaseConfigured) {
    await simulate(total, onProgress);
    return { projectId: 'demo-nuevo', handle: user.handle, slug: payload.slug };
  }

  // 1. Proyecto en borrador. El servidor asigna id y resuelve el slug libre
  //    dentro de la cuenta; el cliente no elige ninguno de los dos.
  onProgress({ phase: 'creando', uploaded: 0, total });
  const created = await apiFetch<{ projectId: string; slug: string; handle: string }>(
    '/api/projects',
    {
      method: 'POST',
      body: {
        metadata: payload.metadata,
        slug: payload.slug,
        projectType: payload.projectType,
      },
    }
  );

  try {
    // 2. Archivos y portada de la primera versión.
    const cover = await uploadVersion(
      created.projectId,
      1,
      payload.files,
      payload.cover,
      payload.metadata.title,
      onProgress
    );

    // 3. Publicación efectiva: sólo ahora el proyecto apunta a v1.
    onProgress({ phase: 'publicando', uploaded: total, total });
    await apiFetch(`/api/projects/${created.projectId}/finalize`, {
      method: 'POST',
      body: {
        version: 1,
        entryFile: payload.entryFile,
        fileCount: payload.files.length,
        totalBytes: payload.files.reduce((sum, file) => sum + file.size, 0),
        status: payload.visibility,
        cover,
      },
    });
  } catch (error) {
    await discardVersion(created.projectId, 1);
    throw error;
  }

  onProgress({ phase: 'listo', uploaded: total, total });
  return { projectId: created.projectId, handle: created.handle, slug: created.slug };
}

/**
 * Reemplaza los archivos publicados conservando la URL.
 * Sube a v{n+1} y sólo entonces mueve el puntero.
 */
export async function replaceProjectFiles(
  user: SessionUser,
  projectId: string,
  currentVersion: number,
  files: readonly StagedFile[],
  entryFile: string,
  onProgress: (progress: PublishProgress) => void,
  status: Visibility = 'published'
): Promise<number> {
  const total = files.length;
  const nextVersion = currentVersion + 1;

  if (!isFirebaseConfigured) {
    for (let index = 1; index <= total; index += 1) {
      onProgress({ phase: 'subiendo', uploaded: index, total });
      await delay(60);
    }
    onProgress({ phase: 'listo', uploaded: total, total });
    return nextVersion;
  }

  try {
    await uploadVersion(projectId, nextVersion, files, null, '', onProgress);

    onProgress({ phase: 'publicando', uploaded: total, total });
    await apiFetch(`/api/projects/${projectId}/finalize`, {
      method: 'POST',
      body: {
        version: nextVersion,
        entryFile,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        status,
      },
    });
  } catch (error) {
    await discardVersion(projectId, nextVersion);
    throw error;
  }

  onProgress({ phase: 'listo', uploaded: total, total });
  return nextVersion;
}
