import 'server-only';

import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { INDEXES, PUBLISHED_KEY, TABLES } from '../aws/config';
import { getDynamo, pathKey } from '../aws/dynamo';
import type {
  Course,
  ExploreFilters,
  Project,
  ProjectRecord,
  PublicUser,
  SortOption,
} from '../types';
import { DEMO_COURSES, DEMO_PROJECTS, DEMO_USERS } from './demo';
import { toPublicProject, toPublicProjects } from './mappers';

/**
 * Capa de lectura del servidor.
 *
 * Una sola interfaz, dos implementaciones: DynamoDB cuando hay configuración y
 * datos en memoria cuando no. Las páginas no saben cuál está activa, así que la
 * interfaz completa se puede revisar sin backend.
 *
 * Nota de la migración desde Firestore: allí hacía falta mantener colecciones
 * `publicProjects`/`publicProfiles` duplicadas, porque las reglas pueden
 * conceder o negar un documento entero pero no ocultar campos sueltos. Aquí el
 * navegador no lee la base de datos: lee lo que este servidor le devuelve, y
 * `toPublicProject()` (mappers.ts) ya es la frontera de privacidad. La
 * duplicación desaparece, y con ella el riesgo de que las dos copias se
 * desincronicen.
 */

export interface ExplorePage {
  projects: Project[];
  total: number;
  usedFallbackSearch: boolean;
}

const DEFAULT_PAGE_SIZE = 24;

/** Tope de la "página caliente" que se filtra en memoria. Ver LIMITATIONS.md. */
const HOT_PAGE_SIZE = 500;

export function isDemoMode(): boolean {
  return getDynamo() === null;
}

// ---------------------------------------------------------------------------
// Filtrado y orden (compartidos por ambas implementaciones para que el
// comportamiento observable sea idéntico)
// ---------------------------------------------------------------------------

function matchesFilters(project: Project, filters: Partial<ExploreFilters>): boolean {
  if (filters.tag && !project.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase()))
    return false;
  if (filters.courseId && project.courseId !== filters.courseId) return false;
  if (filters.term && project.term !== filters.term) return false;
  if (filters.projectType && project.projectType !== filters.projectType) return false;

  const query = filters.query?.trim().toLowerCase();
  if (query) {
    const haystack = [
      project.title,
      project.description,
      project.author.displayName,
      project.courseName ?? '',
      ...project.tags,
    ]
      .join(' ')
      .toLowerCase();
    if (!query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }

  return true;
}

function compare(sort: SortOption) {
  return (a: Project, b: Project): number => {
    switch (sort) {
      case 'featured':
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
      case 'popular':
        return b.views - a.views;
      case 'alphabetical':
        return a.title.localeCompare(b.title, 'es');
      case 'recent':
      default:
        return (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt);
    }
  };
}

// ---------------------------------------------------------------------------
// Lecturas públicas
// ---------------------------------------------------------------------------

/**
 * Proyectos listables públicamente.
 *
 * Consulta el índice DISPERSO `byStatus`, donde sólo existen los proyectos
 * `published` y no ocultados por moderación. Los borradores y los `unlisted`
 * no están en el índice, así que no hay consulta —ni error de programación—
 * capaz de devolverlos. Antes esa garantía dependía de acordarse de escribir
 * el filtro; ahora es estructural.
 */
async function readPublishedRecords(): Promise<Project[]> {
  const db = getDynamo();
  if (!db) {
    return toPublicProjects(DEMO_PROJECTS.filter((project) => project.status === 'published'));
  }

  const result = await db.send(
    new QueryCommand({
      TableName: TABLES.projects,
      IndexName: INDEXES.projectsByStatus,
      KeyConditionExpression: '#s = :published',
      ExpressionAttributeNames: { '#s': 'statusKey' },
      ExpressionAttributeValues: { ':published': PUBLISHED_KEY },
      ScanIndexForward: false, // publishedAt descendente
      Limit: HOT_PAGE_SIZE,
    })
  );

  return toPublicProjects((result.Items ?? []) as ProjectRecord[]);
}

export async function listProjects(
  filters: Partial<ExploreFilters> = {},
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<ExplorePage> {
  const records = await readPublishedRecords();
  const sort = filters.sort ?? 'recent';
  const filtered = records.filter((project) => matchesFilters(project, filters)).sort(compare(sort));
  const start = (page - 1) * pageSize;

  return {
    projects: filtered.slice(start, start + pageSize),
    total: filtered.length,
    // La búsqueda por texto se resuelve en memoria sobre la página caliente.
    // Con miles de proyectos hay que mover esto a un índice externo; está
    // anotado como limitación conocida en docs/LIMITATIONS.md.
    usedFallbackSearch: Boolean(filters.query),
  };
}

export async function listFeaturedProjects(limit = 3): Promise<Project[]> {
  const records = await readPublishedRecords();
  const featured = records.filter((project) => project.featured);
  const pool = featured.length >= limit ? featured : [...featured, ...records];
  const seen = new Set<string>();
  const unique = pool.filter((project) =>
    seen.has(project.id) ? false : (seen.add(project.id), true)
  );
  return unique.slice(0, limit);
}

/** Recupera un proyecto por su URL pública. Incluye `unlisted` a propósito:
 *  "sólo con enlace" significa exactamente eso. */
export async function getProjectByPath(handle: string, slug: string): Promise<Project | null> {
  const record = await getProjectRecordByPath(handle, slug);
  if (!record) return null;
  if (record.hiddenByAdmin) return null;
  if (!['published', 'unlisted'].includes(record.status)) return null;
  return toPublicProject(record);
}

/**
 * Registro completo por ruta pública, con `ownerId` y rutas internas. Sólo para
 * el servidor: nunca debe cruzar la frontera hacia el navegador sin pasar por
 * `toPublicProject()`.
 */
export async function getProjectRecordByPath(
  handle: string,
  slug: string
): Promise<ProjectRecord | null> {
  const db = getDynamo();

  if (!db) {
    return (
      DEMO_PROJECTS.find(
        (project) => project.ownerHandle === handle && project.slug === slug
      ) ?? null
    );
  }

  const result = await db.send(
    new QueryCommand({
      TableName: TABLES.projects,
      IndexName: INDEXES.projectsByPath,
      KeyConditionExpression: '#p = :path',
      ExpressionAttributeNames: { '#p': 'path' },
      ExpressionAttributeValues: { ':path': pathKey(handle, slug) },
      Limit: 1,
    })
  );

  return ((result.Items ?? [])[0] as ProjectRecord | undefined) ?? null;
}

/** Registro completo por id. Sólo servidor. */
export async function getProjectRecordById(projectId: string): Promise<ProjectRecord | null> {
  const db = getDynamo();
  if (!db) return DEMO_PROJECTS.find((project) => project.id === projectId) ?? null;

  const result = await db.send(
    new GetCommand({ TableName: TABLES.projects, Key: { id: projectId } })
  );
  return (result.Item as ProjectRecord | undefined) ?? null;
}

export async function getUserByHandle(handle: string): Promise<PublicUser | null> {
  const db = getDynamo();

  if (!db) return DEMO_USERS.find((user) => user.handle === handle) ?? null;

  const result = await db.send(
    new QueryCommand({
      TableName: TABLES.users,
      IndexName: INDEXES.usersByHandle,
      KeyConditionExpression: '#h = :handle',
      ExpressionAttributeNames: { '#h': 'handle' },
      ExpressionAttributeValues: { ':handle': handle },
      Limit: 1,
    })
  );

  const user = (result.Items ?? [])[0] as (PublicUser & { suspended?: boolean }) | undefined;
  if (!user || user.suspended) return null;

  return {
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    program: user.program ?? null,
    role: user.role,
    projectCount: user.projectCount ?? 0,
    createdAt: user.createdAt,
  };
}

/**
 * Perfil completo por UID, incluidos los campos que nunca salen al navegador
 * (`role`, `suspended`). Es la fuente de verdad de la autorización: el rol
 * jamás se lee del token ni de lo que mande el cliente.
 */
export async function getUserRecordByUid(uid: string): Promise<
  (PublicUser & { uid: string; suspended: boolean }) | null
> {
  const db = getDynamo();
  if (!db) return null;

  const result = await db.send(new GetCommand({ TableName: TABLES.users, Key: { uid } }));
  const user = result.Item as (PublicUser & { uid: string; suspended?: boolean }) | undefined;
  if (!user) return null;
  return { ...user, suspended: Boolean(user.suspended) };
}

export async function listProjectsByHandle(handle: string): Promise<Project[]> {
  const records = await readPublishedRecords();
  return records.filter((project) => project.author.handle === handle).sort(compare('recent'));
}

/** Proyectos de una persona, borradores incluidos. Sólo para su propio panel. */
export async function listProjectsByOwner(ownerId: string): Promise<ProjectRecord[]> {
  const db = getDynamo();
  if (!db) return DEMO_PROJECTS.filter((project) => project.ownerId === ownerId);

  const result = await db.send(
    new QueryCommand({
      TableName: TABLES.projects,
      IndexName: INDEXES.projectsByOwner,
      KeyConditionExpression: '#o = :owner',
      ExpressionAttributeNames: { '#o': 'ownerId' },
      ExpressionAttributeValues: { ':owner': ownerId },
      ScanIndexForward: false, // updatedAt descendente
    })
  );

  return (result.Items ?? []) as ProjectRecord[];
}

export async function listCourses(): Promise<Course[]> {
  const db = getDynamo();
  if (!db) return DEMO_COURSES;

  // La tabla de cursos es pequeña por naturaleza (unas decenas por institución):
  // un Scan con filtro cuesta menos que mantener un índice para ello.
  const result = await db.send(
    new ScanCommand({
      TableName: TABLES.courses,
      FilterExpression: '#v = :public',
      ExpressionAttributeNames: { '#v': 'visibility' },
      ExpressionAttributeValues: { ':public': 'public' },
    })
  );

  return ((result.Items ?? []) as Course[]).map((course) => ({
    ...course,
    activities: course.activities ?? [],
  }));
}

export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const courses = await listCourses();
  return courses.find((course) => course.slug === slug) ?? null;
}

/**
 * Grupos que ya se han usado, para sugerirlos en el formulario.
 *
 * Se calculan del contenido real y no de un catalogo: un grupo no es una
 * entidad de la plataforma, es una cadena que escribe quien publica. Sugerir
 * los que ya existen es lo que evita que "ISC-7A", "isc 7a" y "7A" acaben
 * siendo tres grupos distintos en los filtros.
 */
export async function listKnownGroups(): Promise<string[]> {
  const records = await readPublishedRecords();
  const seen = new Map<string, string>();
  for (const project of records) {
    const group = project.group?.trim();
    if (!group) continue;
    const key = group.toLowerCase();
    if (!seen.has(key)) seen.set(key, group);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Facetas disponibles para la barra de filtros, calculadas del contenido real
 *  para no ofrecer nunca un filtro que devolvería cero resultados. */
export async function getExploreFacets(): Promise<{
  tags: { value: string; count: number }[];
  courses: { id: string; name: string; count: number }[];
  terms: string[];
}> {
  const records = await readPublishedRecords();

  const tagCounts = new Map<string, number>();
  const courseCounts = new Map<string, { name: string; count: number }>();
  const terms = new Set<string>();

  for (const project of records) {
    for (const tag of project.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (project.courseId && project.courseName) {
      const current = courseCounts.get(project.courseId);
      courseCounts.set(project.courseId, {
        name: project.courseName,
        count: (current?.count ?? 0) + 1,
      });
    }
    if (project.term) terms.add(project.term);
  }

  return {
    tags: [...tagCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es')),
    courses: [...courseCounts.entries()]
      .map(([id, value]) => ({ id, name: value.name, count: value.count }))
      .sort((a, b) => b.count - a.count),
    terms: [...terms].sort(),
  };
}

/** Rutas para el sitemap. Excluye `unlisted` por definición. */
export async function listIndexablePaths(): Promise<
  { handle: string; slug: string; updatedAt: string }[]
> {
  const records = await readPublishedRecords();
  return records.map((project) => ({
    handle: project.author.handle,
    slug: project.slug,
    updatedAt: project.updatedAt,
  }));
}

export async function listPublicHandles(): Promise<string[]> {
  const db = getDynamo();
  if (!db) return DEMO_USERS.filter((user) => user.role === 'student').map((u) => u.handle);

  const result = await db.send(
    new ScanCommand({
      TableName: TABLES.users,
      ProjectionExpression: '#h, #s',
      ExpressionAttributeNames: { '#h': 'handle', '#s': 'suspended' },
      Limit: 1000,
    })
  );

  return ((result.Items ?? []) as { handle?: string; suspended?: boolean }[])
    .filter((user): user is { handle: string; suspended?: boolean } =>
      Boolean(user.handle) && !user.suspended
    )
    .map((user) => user.handle);
}
