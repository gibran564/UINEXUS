import { LIMITS } from './constants';
import { contentTypeFor, extensionOf, isAllowedExtension } from './files';
import type { Project, ProjectType, StagedFile } from './types';
import { pickWebPreviewEntry } from './workspace-files';

/**
 * Publicar un NexCode web con el publisher que ya existe.
 *
 * Este módulo NO sube nada ni sabe qué es S3. Decide dos cosas, las dos puras y
 * las dos comprobables sin red: si el proyecto se puede publicar, y si al
 * publicar hay que CREAR uno nuevo o REEMPLAZAR los archivos de uno existente.
 * Subir es cosa de `publish-client.ts`, que ya lo hacía antes de que NexCode
 * pudiera publicar.
 *
 * Se publican los archivos ORIGINALES del proyecto —`index.html`, `styles.css`,
 * `script.js`—, nunca el documento autocontenido que arma la vista previa. La
 * vista previa incrusta todo en un solo HTML porque no hay ningún sitio desde el
 * que servir los archivos sueltos; el origen aislado sí lo hay. Comparten
 * archivos, no tubería.
 */

/** Lo que impide publicar, con la ruta culpable para poder arreglarlo. */
export interface WorkspacePublishBlocker {
  /** Vacía cuando el problema es del proyecto entero y no de un archivo. */
  path: string;
  reason: string;
}

export interface WorkspacePublishPlan {
  /** El HTML por el que se entra al sitio publicado. */
  entryFile: string;
  files: StagedFile[];
  projectType: ProjectType;
  totalBytes: number;
}

export type WorkspacePublishPlanResult =
  | { ok: true; plan: WorkspacePublishPlan }
  | { ok: false; blockers: WorkspacePublishBlocker[] };

/**
 * ¿Se puede publicar esto, y con qué?
 *
 * Los archivos que el publisher no admite se DEVUELVEN como bloqueo, uno por
 * uno y con su ruta. La vista previa hace lo contrario —descarta en silencio lo
 * que no sabe pintar— y ahí es correcto, porque un `.py` no se dibuja. Aquí no:
 * alguien que publica su sitio y encuentra que falta un archivo merece saber
 * cuál y por qué antes de publicarlo, no después.
 *
 * Es una función de MENSAJES, no de permisos. El servidor vuelve a validar
 * extensión, ruta y tamaño al firmar cada subida, y esa es la barrera real.
 */
export function planWorkspacePublish(
  files: Record<string, string>,
  entryFile: string
): WorkspacePublishPlanResult {
  const blockers: WorkspacePublishBlocker[] = [];

  const entry = pickWebPreviewEntry(files, entryFile);
  if (!entry) {
    blockers.push({
      path: '',
      reason: 'Este proyecto no tiene un archivo HTML para publicar.',
    });
  }

  const staged: StagedFile[] = [];
  let totalBytes = 0;

  for (const [path, source] of Object.entries(files)) {
    if (!isAllowedExtension(path)) {
      blockers.push({
        path,
        reason: `No se admite el tipo de archivo ".${extensionOf(path) || '?'}" al publicar.`,
      });
      continue;
    }

    const contentType = contentTypeFor(path);
    const blob = new Blob([source], { type: contentType });
    if (blob.size > LIMITS.maxFileBytes) {
      blockers.push({
        path,
        reason: `Pesa ${formatBytes(blob.size)}; el máximo por archivo es ${formatBytes(
          LIMITS.maxFileBytes
        )}.`,
      });
      continue;
    }

    totalBytes += blob.size;
    staged.push({ path, blob, contentType, size: blob.size });
  }

  if (totalBytes > LIMITS.maxProjectBytes) {
    blockers.push({
      path: '',
      reason: `El proyecto entero pesa ${formatBytes(totalBytes)}; el máximo es ${formatBytes(
        LIMITS.maxProjectBytes
      )}.`,
    });
  }

  if (!entry || blockers.length > 0) return { ok: false, blockers };

  return {
    ok: true,
    plan: { entryFile: entry, files: staged, projectType: projectTypeFor(staged), totalBytes },
  };
}

/**
 * `html` es una página con sus cosas al lado; `site` es una carpeta con varias.
 * Se deduce en vez de preguntarlo porque el archivo ya lo dice.
 */
function projectTypeFor(files: readonly StagedFile[]): ProjectType {
  const htmlCount = files.filter((file) => /\.html?$/i.test(file.path)).length;
  const hasFolders = files.some((file) => file.path.includes('/'));
  return htmlCount === 1 && !hasFolders ? 'html' : 'site';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// A qué proyecto publicar
// ---------------------------------------------------------------------------

/**
 * El resultado de preguntar por los proyectos de quien publica.
 *
 * Se modela explícitamente el «no lo sé» porque es el caso que causa el daño:
 * una lista que no llegó por un 500 o por un túnel de metro NO significa que el
 * proyecto no exista.
 */
export type OwnedProjectsLookup =
  | { ok: true; projects: readonly Pick<Project, 'id' | 'slug' | 'version' | 'author'>[] }
  | { ok: false; message: string };

export type PublishTarget =
  /** No hay vínculo, o el vínculo apunta a algo que CONFIRMADAMENTE ya no está. */
  | { kind: 'create' }
  | { kind: 'update'; projectId: string; version: number; slug: string; handle: string }
  /**
   * No se pudo averiguar. NO se publica: ni se crea ni se reemplaza.
   *
   * Ésta es la rama que evita el daño real. Si un fallo de red hiciera caer el
   * vínculo hacia `create`, cada intento con la wifi mala dejaría un proyecto
   * publicado de más, con su propia URL, y la persona acabaría con cinco copias
   * de su sitio sin haber pedido ninguna.
   */
  | { kind: 'unresolved'; message: string };

/**
 * Decide si publicar crea un proyecto o reemplaza el que ya había.
 *
 * La única forma de degradar a `create` teniendo vínculo es que la consulta
 * HAYA FUNCIONADO y el proyecto no esté entre los de esta persona: eso sí es
 * una ausencia confirmada —lo borró, o nunca fue suyo— y seguir bloqueando el
 * botón la dejaría sin manera de volver a publicar.
 */
export function resolvePublishTarget(
  publishedProjectId: string | undefined,
  lookup: OwnedProjectsLookup
): PublishTarget {
  if (!publishedProjectId) return { kind: 'create' };

  if (!lookup.ok) return { kind: 'unresolved', message: lookup.message };

  const project = lookup.projects.find((candidate) => candidate.id === publishedProjectId);
  if (!project) return { kind: 'create' };

  return {
    kind: 'update',
    projectId: project.id,
    version: project.version,
    slug: project.slug,
    handle: project.author.handle,
  };
}

// ---------------------------------------------------------------------------
// El desenlace de publicar
// ---------------------------------------------------------------------------

export interface PublishedLocation {
  projectId: string;
  handle: string;
  slug: string;
}

export type WorkspacePublishOutcome =
  /** Publicado y vinculado: todo en su sitio. */
  | { kind: 'published'; location: PublishedLocation }
  /**
   * La publicación EXISTE, pero el NexCode no pudo guardar a cuál apunta.
   *
   * Se distingue de `failed` a propósito, y es la diferencia entre una molestia
   * y un destrozo: si esto se contara como fallo, el reintento natural volvería
   * a llamar a `publishProject` y crearía un SEGUNDO proyecto publicado, con
   * otra URL, mientras el primero sigue vivo y sin dueño aparente. Lo único que
   * falta aquí es un PATCH, así que lo único que se reintenta es el PATCH.
   */
  | { kind: 'link-failed'; location: PublishedLocation; message: string }
  /** No se publicó: no hay nada que recordar ni que limpiar. */
  | { kind: 'failed'; message: string };

/**
 * Publica y vincula, manteniendo separados los dos fracasos posibles.
 *
 * Recibe las operaciones como argumentos —no las importa— para que el orden y
 * el desenlace se puedan comprobar sin red, sin sesión y sin S3.
 */
export async function publishAndLink(operations: {
  /** Crea o reemplaza. Devuelve dónde quedó publicado. */
  publish: () => Promise<PublishedLocation>;
  /** Guarda el vínculo en el Workspace. */
  link: (projectId: string) => Promise<void>;
  /** Con vínculo ya guardado y sin cambios, no se vuelve a escribir. */
  alreadyLinkedTo?: string;
}): Promise<WorkspacePublishOutcome> {
  let location: PublishedLocation;
  try {
    location = await operations.publish();
  } catch (caught) {
    return { kind: 'failed', message: describe(caught, 'No se pudo publicar el proyecto.') };
  }

  if (operations.alreadyLinkedTo === location.projectId) {
    return { kind: 'published', location };
  }

  try {
    await operations.link(location.projectId);
  } catch (caught) {
    return {
      kind: 'link-failed',
      location,
      message: describe(caught, 'No se pudo guardar el vínculo con la publicación.'),
    };
  }

  return { kind: 'published', location };
}

/**
 * Reintenta SÓLO el vínculo.
 *
 * No vuelve a subir ni a finalizar: los archivos ya están publicados y
 * repetirlo gastaría una versión nueva para no cambiar nada.
 */
export async function retryPublishLink(
  location: PublishedLocation,
  link: (projectId: string) => Promise<void>
): Promise<WorkspacePublishOutcome> {
  try {
    await link(location.projectId);
  } catch (caught) {
    return {
      kind: 'link-failed',
      location,
      message: describe(caught, 'No se pudo guardar el vínculo con la publicación.'),
    };
  }
  return { kind: 'published', location };
}

function describe(caught: unknown, fallback: string): string {
  // El backend ya redacta mensajes útiles —«Esa versión no es la siguiente»— y
  // taparlos con un «algo salió mal» deja a la persona sin saber qué hacer.
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
