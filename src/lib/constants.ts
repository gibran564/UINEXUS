import type { ProjectStatus, ProjectType, SortOption } from './types';

/** Límites de subida. Se replican en las reglas de Storage: el cliente avisa,
 *  el servidor decide. Cambiar aquí implica cambiar storage.rules. */
export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 10 MB por archivo
  maxProjectBytes: 50 * 1024 * 1024, // 50 MB por proyecto
  maxFiles: 300,
  maxZipBytes: 30 * 1024 * 1024,
  maxCoverBytes: 3 * 1024 * 1024,
  maxProjectsPerUser: 30,
  maxTags: 6,
  titleMax: 90,
  descriptionMax: 600,
} as const;

/**
 * Lista blanca de extensiones. Es la misma que aplican storage.rules y la
 * el origen aislado. El servidor la aplica al firmar la subida y fija con ella
 * el Content-Type del objeto en S3.
 */
export const ALLOWED_EXTENSIONS = [
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map', 'txt', 'md', 'csv', 'xml',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf',
  'mp4', 'webm', 'ogg', 'mp3', 'wav', 'pdf',
] as const;

export const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', map: 'application/json',
  txt: 'text/plain', md: 'text/plain', csv: 'text/csv', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
};

export interface ProjectTypeOption {
  value: ProjectType;
  label: string;
  helper: string;
  example: string;
}

/** Las tres puertas de entrada al flujo de publicación. Lenguaje sin jerga. */
export const PROJECT_TYPES: readonly ProjectTypeOption[] = [
  {
    value: 'html',
    label: 'Página HTML',
    helper: 'Tienes un archivo index.html, quizá con su CSS y sus imágenes.',
    example: 'index.html + styles.css',
  },
  {
    value: 'site',
    label: 'Sitio web completo',
    helper: 'Tienes una carpeta con varias páginas. Súbela comprimida en .zip.',
    example: 'mi-sitio.zip',
  },
  {
    value: 'build',
    label: 'Proyecto compilado',
    helper: 'Ya ejecutaste "build" en React, Vite, Astro… Sube la carpeta dist.',
    example: 'dist.zip / out.zip',
  },
];

/** Categorías visibles en el filtro rápido. Son etiquetas curadas, no un campo
 *  aparte: así el alumno etiqueta libre y la galería sigue teniendo orden. */
export const PRIMARY_CATEGORIES = [
  'UX', 'UI', 'Prototipos', 'Accesibilidad', 'Rediseños',
] as const;

export const SECONDARY_CATEGORIES = [
  'Investigación', 'Aplicaciones', 'Web', 'Experimentos', 'Design system',
  'Mobile', 'Data viz', 'Tipografía',
] as const;

export const ALL_CATEGORIES = [...PRIMARY_CATEGORIES, ...SECONDARY_CATEGORIES];

export const SORT_OPTIONS: readonly { value: SortOption; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'featured', label: 'Destacados primero' },
  { value: 'popular', label: 'Más vistos' },
  { value: 'alphabetical', label: 'A – Z' },
];

export const STATUS_LABEL: Readonly<Record<ProjectStatus, string>> = {
  published: 'Publicado',
  unlisted: 'Sólo con enlace',
  draft: 'Borrador',
  archived: 'Archivado',
};

export const STATUS_HELP: Readonly<Record<ProjectStatus, string>> = {
  published: 'Aparece en la galería y cualquiera puede abrirlo.',
  unlisted: 'No aparece en la galería. Sólo quien tenga el enlace puede verlo.',
  draft: 'Sólo tú puedes verlo. Nadie más, ni con el enlace.',
  archived: 'Fuera de circulación. Conservas los archivos.',
};

export const PROJECT_TYPE_LABEL: Readonly<Record<ProjectType, string>> = {
  html: 'Página HTML',
  site: 'Sitio web',
  build: 'Proyecto compilado',
};

export const SITE = {
  name: 'UINexus',
  tagline: 'Diseña. Publica. Comparte.',
  description:
    'Galería y hosting de proyectos web para clases de diseño centrado en el usuario. ' +
    'Publica tu página, obtén un enlace y compártelo.',
} as const;
