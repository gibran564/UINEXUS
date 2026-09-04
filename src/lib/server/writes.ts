import 'server-only';

import { randomUUID } from 'node:crypto';
import { DeleteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PROJECTS_BUCKET, PUBLIC_BUCKET, TABLES } from '../aws/config';
import { getDynamo, pathKey, visibilityAttributes } from '../aws/dynamo';
import { deletePrefix, deleteProjectFiles } from '../aws/s3';
import { removeProjectRoute, syncProjectRoute } from '../aws/routes';
import { listProjectsByOwner } from '../data/repository';
import { LIMITS } from '../constants';
import type { ProjectMetadataInput } from '../schemas';
import { slugify, uniqueSlug } from '../slug';
import { getRoleFromInstitutionalEmail } from '../firebase/auth';
import type {
  ProjectCover,
  ProjectRecord,
  ProjectType,
  PublicUser,
  Visibility,
} from '../types';
import { HttpError, isStaff, type Actor, type Identity } from './session';

/**
 * Escrituras autorizadas.
 *
 * Cada función de este módulo asume que quien llama YA verificó la identidad
 * con `session.ts`. Lo que se hace aquí es lo otro: garantizar que el dato que
 * queda guardado es coherente, pase lo que pase por la petición.
 *
 * Los invariantes son los mismos que aplicaban las reglas de Firestore, y por
 * las mismas razones:
 *  - `ownerId`, `ownerHandle` y `slug` NO se pueden cambiar: una entrega
 *    académica tiene que conservar su URL.
 *  - `featured`, `hiddenByAdmin`, `reportCount` y `views` no los toca el
 *    alumnado; son potestad del profesorado o del propio servidor.
 *  - Nadie se cambia el rol.
 *
 * La diferencia es que ahora ninguna de esas garantías es declarativa: se
 * cumplen porque las escrituras enumeran los campos que tocan en vez de
 * volcar el objeto que llegó por la red. Ese detalle es la defensa entera.
 */

function db() {
  const client = getDynamo();
  if (!client) throw new HttpError(503, 'La base de datos no está disponible.');
  return client;
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Perfil y handle
// ---------------------------------------------------------------------------

/**
 * Reserva un handle libre. La condición `attribute_not_exists` convierte la
 * reserva en atómica: si dos personas se registran a la vez con el mismo
 * nombre, una de las dos escrituras falla y se prueba el siguiente candidato.
 * Es el mismo truco que se usaba con `/handles/{handle}` en Firestore.
 */
async function reserveHandle(uid: string, displayName: string): Promise<string> {
  const client = db();
  const base = slugify(displayName).slice(0, 20) || 'estudiante';
  const seed = base.length >= 3 ? base : `${base}-uinexus`.slice(0, 20);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = (attempt === 0 ? seed : `${seed}-${attempt + 1}`).slice(0, 24);
    try {
      await client.send(
        new PutCommand({
          TableName: TABLES.handles,
          Item: { handle: candidate, uid, createdAt: nowIso() },
          ConditionExpression: 'attribute_not_exists(handle)',
        })
      );
      return candidate;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    }
  }

  const fallback = `${seed}-${randomUUID().slice(0, 4)}`.slice(0, 24);
  await client.send(
    new PutCommand({
      TableName: TABLES.handles,
      Item: { handle: fallback, uid, createdAt: nowIso() },
      ConditionExpression: 'attribute_not_exists(handle)',
    })
  );
  return fallback;
}

export type StoredProfile = PublicUser & { uid: string; suspended: boolean };

/**
 * Crea el perfil si es el primer inicio de sesión. Idempotente: la condición
 * impide pisar un perfil existente aunque dos pestañas entren a la vez.
 */
export async function ensureProfile(
  identity: Identity,
  hints: { displayName?: string | null; avatarUrl?: string | null } = {}
): Promise<StoredProfile> {
  const client = db();
  const { getUserRecordByUid } = await import('../data/repository');

  const existing = await getUserRecordByUid(identity.uid);
  if (existing) return existing;

  const displayName = hints.displayName?.trim() || identity.email?.split('@')[0] || 'Estudiante';
  const handle = await reserveHandle(identity.uid, displayName);

  const role = getRoleFromInstitutionalEmail(identity.email);

  const profile: StoredProfile = {
    uid: identity.uid,
    handle,
    displayName: displayName.slice(0, 60),
    avatarUrl: hints.avatarUrl ?? null,
    bio: null,
    program: null,
    // Auto-asignación de rol según correo institucional ITD:
    // Con números (número de control) -> 'student'; sin números -> 'teacher'.
    role,
    projectCount: 0,
    suspended: false,
    createdAt: nowIso(),
  };

  try {
    await client.send(
      new PutCommand({
        TableName: TABLES.users,
        Item: { ...profile, updatedAt: nowIso() },
        ConditionExpression: 'attribute_not_exists(uid)',
      })
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      const raced = await getUserRecordByUid(identity.uid);
      if (raced) return raced;
    }
    throw error;
  }

  return profile;
}

/** Campos del perfil que su dueño puede cambiar. El resto, ni se mira. */
export async function updateProfile(
  actor: Actor,
  input: { displayName?: string; bio?: string; program?: string; avatarUrl?: string | null }
): Promise<void> {
  const sets: string[] = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': nowIso() };

  const assign = (field: string, value: unknown) => {
    sets.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  };

  if (input.displayName !== undefined) assign('displayName', input.displayName.trim().slice(0, 60));
  if (input.bio !== undefined) assign('bio', input.bio.trim().slice(0, 280) || null);
  if (input.program !== undefined) assign('program', input.program.trim().slice(0, 80) || null);
  if (input.avatarUrl !== undefined) assign('avatarUrl', input.avatarUrl);

  await db().send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { uid: actor.uid },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(uid)',
    })
  );
}

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  metadata: ProjectMetadataInput;
  slug: string;
  projectType: ProjectType;
}

/**
 * Crea el proyecto en borrador. Existe ANTES que los archivos para que la
 * subida pueda firmarse contra un id real y un dueño conocido.
 */
export async function createProject(
  actor: Actor,
  input: CreateProjectInput
): Promise<ProjectRecord> {
  const mine = await listProjectsByOwner(actor.uid);
  if (mine.length >= LIMITS.maxProjectsPerUser) {
    throw new HttpError(409, `No puedes tener más de ${LIMITS.maxProjectsPerUser} proyectos.`);
  }

  // El slug se deriva y se hace único DENTRO de la cuenta: la URL pública es
  // (handle, slug), así que dos personas sí pueden compartir slug.
  const slug = uniqueSlug(
    slugify(input.slug || input.metadata.title),
    mine.map((project) => project.slug)
  );

  const timestamp = nowIso();
  const record: ProjectRecord = {
    id: randomUUID(),
    slug,
    title: input.metadata.title,
    description: input.metadata.description,
    // El dueño y el handle salen del actor verificado, NUNCA del cuerpo de la
    // petición. Es lo que impide publicar bajo la ruta pública de otra persona.
    ownerId: actor.uid,
    ownerHandle: actor.profile.handle,
    author: {
      handle: actor.profile.handle,
      displayName: actor.profile.displayName,
      avatarUrl: actor.profile.avatarUrl,
    },
    courseId: input.metadata.courseId ?? null,
    courseName: null,
    term: null,
    group: input.metadata.group ?? null,
    tags: input.metadata.tags.slice(0, LIMITS.maxTags),
    cover: null,
    projectType: input.projectType,
    status: 'draft',
    brief: input.metadata.brief ?? {},
    version: 0,
    entryFile: '',
    fileCount: 0,
    totalBytes: 0,
    hiddenByAdmin: false,
    reportCount: 0,
    featured: false,
    views: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.projects,
      Item: { ...record, path: pathKey(record.ownerHandle, record.slug) },
      ConditionExpression: 'attribute_not_exists(id)',
    })
  );

  return record;
}

/**
 * Publica una versión ya subida: mueve el puntero a `v{n}` y ajusta el estado.
 *
 * El puntero se mueve al final a propósito. Si la subida falla a medias, la
 * versión anterior sigue siendo la publicada y nadie ve un sitio roto.
 */
export async function finalizeProjectVersion(
  project: ProjectRecord,
  input: {
    version: number;
    entryFile: string;
    fileCount: number;
    totalBytes: number;
    status: Visibility;
    cover?: ProjectCover | null;
  }
): Promise<ProjectRecord> {
  if (input.version !== project.version + 1) {
    throw new HttpError(409, 'Esa versión no es la siguiente. Vuelve a intentarlo.');
  }
  if (input.totalBytes > LIMITS.maxProjectBytes) {
    throw new HttpError(413, 'El proyecto entero supera el límite de tamaño.');
  }

  const timestamp = nowIso();
  const publishedAt =
    input.status === 'draft' ? null : (project.publishedAt ?? timestamp);

  const next: ProjectRecord = {
    ...project,
    version: input.version,
    entryFile: input.entryFile,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    status: input.status,
    cover: input.cover ?? project.cover,
    updatedAt: timestamp,
    publishedAt,
  };

  await putProject(next);
  return next;
}

/** Metadata y visibilidad. No toca archivos, dueño, handle ni slug. */
export async function updateProjectMetadata(
  actor: Actor,
  project: ProjectRecord,
  input: { metadata?: ProjectMetadataInput; status?: Visibility }
): Promise<ProjectRecord> {
  const next: ProjectRecord = {
    ...project,
    ...(input.metadata
      ? {
          title: input.metadata.title,
          description: input.metadata.description,
          courseId: input.metadata.courseId ?? null,
          group: input.metadata.group ?? null,
          tags: input.metadata.tags.slice(0, LIMITS.maxTags),
          brief: input.metadata.brief ?? {},
        }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    updatedAt: nowIso(),
  };

  if (input.status && input.status !== 'draft' && !next.publishedAt) {
    next.publishedAt = next.updatedAt;
  }

  // Un proyecto oculto por moderación no vuelve a la galería porque su autor
  // lo republique: sólo el profesorado puede levantar la ocultación.
  if (project.hiddenByAdmin && !isStaff(actor.profile.role)) {
    next.hiddenByAdmin = true;
  }

  await putProject(next);
  return next;
}

/** Moderación. Sólo staff; el resto de campos quedan intactos. */
export async function moderateProject(
  project: ProjectRecord,
  input: { featured?: boolean; hiddenByAdmin?: boolean }
): Promise<ProjectRecord> {
  const next: ProjectRecord = {
    ...project,
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
    ...(input.hiddenByAdmin !== undefined ? { hiddenByAdmin: input.hiddenByAdmin } : {}),
    updatedAt: nowIso(),
  };
  await putProject(next);
  return next;
}

/**
 * Guarda el registro completo recalculando los atributos de índice.
 *
 * Pasa siempre por aquí para que `path`, `statusKey` y `listedAt` no se puedan
 * quedar desincronizados del estado real. Los atributos de visibilidad se
 * ELIMINAN cuando el proyecto deja de ser listable: dejarlos a null lo
 * mantendría dentro del índice de la galería.
 */
async function putProject(record: ProjectRecord): Promise<void> {
  const visibility = visibilityAttributes(record);
  await db().send(
    new PutCommand({
      TableName: TABLES.projects,
      Item: {
        ...record,
        path: pathKey(record.ownerHandle, record.slug),
        ...visibility,
      },
      ConditionExpression: 'attribute_exists(id)',
    })
  );

  // La ruta del origen aislado se sincroniza DESPUES de que el dato quede
  // guardado. Si se hiciera antes y la escritura fallara, CloudFront estaria
  // sirviendo un proyecto que la plataforma cree despublicado.
  await syncProjectRoute(record);
}

/** Borra el proyecto y sus archivos. Los archivos primero: un registro sin
 *  archivos es un 404; archivos sin registro son basura que nadie reclama. */
export async function deleteProject(project: ProjectRecord): Promise<void> {
  // Primero se corta el acceso publico: mientras se borran los archivos, el
  // proyecto ya no es alcanzable por su URL.
  await removeProjectRoute(project.ownerHandle, project.slug);
  await deleteProjectFiles(project.ownerId, project.id);
  await deletePrefix(PUBLIC_BUCKET, `covers/${project.ownerId}/${project.id}/`);
  await db().send(
    new DeleteCommand({ TableName: TABLES.projects, Key: { id: project.id } })
  );
}

/** Limpia una versión abandonada tras un fallo de subida. */
export function discardVersionFiles(
  ownerId: string,
  projectId: string,
  version: number
): Promise<number> {
  return deletePrefix(PROJECTS_BUCKET, `projects/${ownerId}/${projectId}/v${version}/`);
}

// ---------------------------------------------------------------------------
// Moderación: reportes
// ---------------------------------------------------------------------------

export async function createReport(
  actor: Actor,
  input: { projectId: string; reason: string; details?: string }
): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: TABLES.reports,
      Item: {
        id: randomUUID(),
        projectId: input.projectId,
        reason: input.reason,
        details: (input.details ?? '').slice(0, 500),
        reporterId: actor.uid,
        // Un reporte nace siempre abierto: quien reporta no resuelve.
        status: 'open',
        createdAt: nowIso(),
      },
    })
  );

  await db()
    .send(
      new UpdateCommand({
        TableName: TABLES.projects,
        Key: { id: input.projectId },
        UpdateExpression: 'SET reportCount = if_not_exists(reportCount, :zero) + :one',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
        ConditionExpression: 'attribute_exists(id)',
      })
    )
    .catch(() => {
      // Que el contador falle no debe perder el reporte, que ya está guardado.
    });
}
