/**
 * Modelo de dominio de UINexus.
 *
 * Convención de privacidad: existen dos formas del proyecto.
 *  - `ProjectRecord`  vive en el servidor y contiene `ownerId` (UID de Firebase)
 *    y rutas internas de Storage.
 *  - `Project`        es el DTO que viaja al navegador. NO lleva UID ni rutas
 *    internas: la identidad pública de una persona es su `handle`.
 * `toPublicProject()` en lib/data/mappers.ts es el único puente entre ambas.
 */

export type ProjectStatus = 'draft' | 'published' | 'unlisted' | 'archived';

/** Nivel de complejidad de lo que se publica (ver docs/ARCHITECTURE.md §5). */
export type ProjectType = 'html' | 'site' | 'build';

export type UserRole = 'student' | 'teacher' | 'admin';

export type Visibility = Extract<ProjectStatus, 'published' | 'unlisted' | 'draft'>;

/** Ficha académica opcional. Convierte el hosting en un caso de estudio. */
export interface ProjectBrief {
  problem?: string;
  goal?: string;
  process?: string;
  tools?: string;
  reflection?: string;
}

export interface ProjectCover {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Autor tal y como se muestra públicamente. Sin correo, sin UID. */
export interface ProjectAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** DTO público de un proyecto. Es lo único que llega al navegador. */
export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: ProjectAuthor;
  courseId: string | null;
  courseName: string | null;
  term: string | null;
  group: string | null;
  tags: string[];
  cover: ProjectCover | null;
  projectType: ProjectType;
  status: ProjectStatus;
  brief: ProjectBrief;
  version: number;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  views: number;
  featured: boolean;
}

/** Forma persistida en Firestore. Nunca se serializa tal cual al cliente. */
export interface ProjectRecord extends Project {
  ownerId: string;
  ownerHandle: string;
  entryFile: string;
  hiddenByAdmin: boolean;
  reportCount: number;
}

export interface PublicUser {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  program: string | null;
  role: UserRole;
  projectCount: number;
  createdAt: string;
}

export interface CourseActivity {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
}

export interface Course {
  id: string;
  slug: string;
  name: string;
  institution: string;
  term: string;
  description: string;
  teacherName: string;
  studentCount: number;
  projectCount: number;
  activities: CourseActivity[];
}

/** Un archivo ya validado, listo para subirse a Storage. */
export interface StagedFile {
  /** Ruta relativa dentro del proyecto, p. ej. "assets/logo.svg". */
  path: string;
  size: number;
  contentType: string;
  blob: Blob;
}

export type SortOption = 'recent' | 'featured' | 'popular' | 'alphabetical';

export interface ExploreFilters {
  query: string;
  tag: string | null;
  courseId: string | null;
  term: string | null;
  projectType: ProjectType | null;
  sort: SortOption;
}
