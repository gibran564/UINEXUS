/**
 * =============================================================================
 * UINexus — Origen aislado para contenido de alumnos
 * =============================================================================
 *
 * Esta función es la ÚNICA forma pública de leer los archivos que suben los
 * alumnos. Se publica bajo un origen distinto al de la plataforma:
 *
 *     uinexus.mx                 -> Next.js (auth, Firestore, datos del usuario)
 *     uinexus-projects.web.app   -> esta función (HTML/JS no confiable)
 *
 * El origen aislado es un dominio REGISTRABLE distinto, no un subdominio: un
 * subdominio podría escribir cookies sobre uinexus.mx. Ver docs/SECURITY.md §1.
 *
 * Por qué importa: el HTML de un alumno puede contener JavaScript arbitrario.
 * Si se sirviera desde uinexus.mx, ese script tendría acceso al mismo origen
 * que la sesión de Firebase Auth (IndexedDB/localStorage), podría leer tokens,
 * suplantar la interfaz y phishear credenciales de otros alumnos. Al vivir en
 * otro origen, la Same-Origin Policy del navegador lo aísla por completo.
 *
 * Además:
 *  - El Content-Type lo decide el SERVIDOR a partir de una lista blanca de
 *    extensiones. Nunca se confía en el metadata que subió el cliente.
 *  - `X-Content-Type-Options: nosniff` impide que el navegador reinterprete
 *    un .txt como HTML.
 *  - `frame-ancestors` limita quién puede embeber el proyecto en un iframe.
 *  - Se resuelve la ruta con normalización estricta: cualquier intento de
 *    salir del prefijo del proyecto (path traversal) devuelve 400.
 *  - Sólo se sirven proyectos en estado `published` o `unlisted` y no ocultos
 *    por moderación.
 */

import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}
setGlobalOptions({ region: 'us-central1', maxInstances: 20, memory: '256MiB' });

const db = new Proxy({} as admin.firestore.Firestore, {
  get: (_, prop) => (admin.firestore() as unknown as Record<string, unknown>)[prop as string],
});
const bucket = new Proxy({} as ReturnType<ReturnType<typeof admin.storage>['bucket']>, {
  get: (_, prop) => (admin.storage().bucket() as unknown as Record<string, unknown>)[prop as string],
});

/** Lista blanca extensión -> Content-Type. Lo que no esté aquí, no se sirve. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
};

/** Dominio de la plataforma autorizado a embeber previews. */
const PLATFORM_ORIGIN = process.env.PLATFORM_ORIGIN ?? 'https://uinexus.mx';

/**
 * CSP aplicada al contenido del alumno.
 *
 * Es deliberadamente permisiva con recursos externos (los alumnos usan CDNs de
 * tipografías y librerías) pero cierra los vectores que dañan a terceros:
 *  - `object-src 'none'`   -> nada de Flash/plugins.
 *  - `base-uri 'none'`     -> no se puede reescribir la resolución de rutas.
 *  - `form-action 'self'`  -> un formulario no puede enviar datos a un servidor
 *                             externo: bloquea el phishing más simple.
 *  - `frame-ancestors`     -> sólo UINexus puede embeberlo (anti-clickjacking).
 * La defensa principal sigue siendo el aislamiento por origen, no la CSP.
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self' https: data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
    "style-src 'self' 'unsafe-inline' https: data:",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https: data:",
    "media-src 'self' https: data: blob:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors 'self' ${PLATFORM_ORIGIN}`,
  ].join('; ');
}

/**
 * Normaliza la ruta pedida y garantiza que no escapa del prefijo del proyecto.
 * Devuelve null si la ruta es hostil.
 */
export function normalizeAssetPath(raw: string): string | null {
  let decoded: string;
  try {
    // Doble decode defensivo: %252e%252e -> ..
    decoded = decodeURIComponent(raw);
    if (decoded.includes('%')) decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }

  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null; // no se permite subir de nivel, nunca
    if (segment.startsWith('.')) return null; // .git, .env, .htaccess…
    if (segment.length > 200) return null;
    segments.push(segment);
  }

  const path = segments.join('/');
  return path.length > 400 ? null : path;
}

function extensionOf(path: string): string {
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
}

interface ProjectRecord {
  ownerId: string;
  status: string;
  hiddenByAdmin: boolean;
  version: number;
  entryFile: string;
}

const MAX_FILES = 300;
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function objectData(value: unknown, field = 'data'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return value as Record<string, unknown>;
}

function textField(
  value: unknown,
  field: string,
  min: number,
  max: number
): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return value;
}

function visibility(value: unknown, fallback?: string): 'draft' | 'published' | 'unlisted' {
  const candidate = value ?? fallback;
  if (!['draft', 'published', 'unlisted'].includes(String(candidate))) {
    throw new HttpsError('invalid-argument', 'La visibilidad no es válida.');
  }
  return candidate as 'draft' | 'published' | 'unlisted';
}

function publicProject(data: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: data.slug,
    title: data.title,
    description: data.description,
    author: data.author,
    courseId: data.courseId,
    courseName: data.courseName,
    term: data.term,
    group: data.group,
    tags: data.tags,
    cover: data.cover,
    projectType: data.projectType,
    status: data.status,
    brief: data.brief,
    version: data.version,
    fileCount: data.fileCount,
    totalBytes: data.totalBytes,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    publishedAt: data.publishedAt,
    views: data.views,
    featured: data.featured,
  };
}

/**
 * Mantiene la proyección pública incluso cuando una operación administrativa
 * modifica `projects` desde la consola. La función es idempotente y usa Admin
 * SDK; ningún cliente obtiene permiso para escribir `publicProjects`.
 */
export const syncPublicProject = onDocumentWritten('projects/{projectId}', async (event) => {
  const publicRef = db.collection('publicProjects').doc(event.params.projectId);
  const after = event.data?.after;
  if (!after?.exists) {
    await publicRef.delete();
    return;
  }

  const data = objectData(after.data());
  const visible = ['published', 'unlisted'].includes(String(data.status));
  const publishable = visible && data.hiddenByAdmin !== true && Number(data.version) >= 1;
  if (publishable) await publicRef.set(publicProject(data));
  else await publicRef.delete();
});

function sanitizeCover(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const cover = objectData(value, 'cover');
  const url = textField(cover.url, 'cover.url', 1, 2048);
  const alt = textField(cover.alt, 'cover.alt', 1, 140);
  if (!url.startsWith('https://firebasestorage.googleapis.com/')) {
    throw new HttpsError('invalid-argument', 'La portada no pertenece a Firebase Storage.');
  }
  return { url, alt };
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const metadata = objectData(value, 'metadata');
  const title = textField(metadata.title, 'title', 3, 90).trim();
  const description = textField(metadata.description, 'description', 10, 600).trim();
  const optional = (input: unknown, field: string, max: number): string | null => {
    if (input == null || input === '') return null;
    return textField(input, field, 1, max).trim();
  };
  if (!Array.isArray(metadata.tags) || metadata.tags.length > 6) {
    throw new HttpsError('invalid-argument', 'Las etiquetas no son válidas.');
  }
  const tags = metadata.tags.map((tag) => textField(tag, 'tag', 1, 24).trim());
  const rawBrief = objectData(metadata.brief ?? {}, 'brief');
  const brief: Record<string, string> = {};
  const briefLimits: Record<string, number> = {
    problem: 1200,
    goal: 1200,
    process: 2000,
    tools: 400,
    reflection: 1200,
  };
  for (const [key, raw] of Object.entries(rawBrief)) {
    const max = briefLimits[key];
    if (!max) throw new HttpsError('invalid-argument', 'La ficha contiene un campo desconocido.');
    brief[key] = textField(raw, `brief.${key}`, 0, max).trim();
  }
  return {
    title,
    description,
    courseId: optional(metadata.courseId, 'courseId', 64),
    group: optional(metadata.group, 'group', 24),
    tags,
    brief,
  };
}

async function requireOwnedProject(
  uid: string,
  projectId: string
): Promise<FirebaseFirestore.DocumentSnapshot> {
  const snapshot = await db.collection('projects').doc(projectId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Proyecto no encontrado.');
  if (snapshot.get('ownerId') !== uid) {
    throw new HttpsError('permission-denied', 'No puedes modificar este proyecto.');
  }
  if (snapshot.get('hiddenByAdmin') === true) {
    throw new HttpsError('failed-precondition', 'El proyecto está retenido por moderación.');
  }
  return snapshot;
}

async function validateStoredVersion(
  ownerId: string,
  projectId: string,
  versionNumber: number,
  entryFile: string
): Promise<{ fileCount: number; totalBytes: number }> {
  const prefix = `projects/${ownerId}/${projectId}/v${versionNumber}/`;
  const [files] = await bucket.getFiles({ prefix });
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new HttpsError('failed-precondition', `La versión debe contener entre 1 y ${MAX_FILES} archivos.`);
  }

  let totalBytes = 0;
  let foundEntry = false;
  for (const file of files) {
    const relativePath = file.name.slice(prefix.length);
    const normalized = normalizeAssetPath(relativePath);
    const size = Number(file.metadata.size ?? 0);
    const ext = extensionOf(relativePath);
    const expectedType = CONTENT_TYPES[ext]?.split(';')[0];
    if (!normalized || normalized !== relativePath || !expectedType) {
      throw new HttpsError('failed-precondition', `Archivo no permitido: ${relativePath}`);
    }
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
      throw new HttpsError('failed-precondition', `Tamaño no permitido: ${relativePath}`);
    }
    if (file.metadata.contentType !== expectedType) {
      throw new HttpsError('failed-precondition', `MIME no coincide con la extensión: ${relativePath}`);
    }
    totalBytes += size;
    if (relativePath === entryFile) foundEntry = true;
  }
  if (!foundEntry || totalBytes > MAX_PROJECT_BYTES) {
    throw new HttpsError('failed-precondition', 'La versión supera los límites o no contiene su entrada.');
  }
  return { fileCount: files.length, totalBytes };
}

export const finalizeProjectVersion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para publicar.');
  const input = objectData(request.data);
  const projectId = textField(input.projectId, 'projectId', 1, 128);
  const versionNumber = input.version;
  if (!Number.isInteger(versionNumber) || Number(versionNumber) < 1 || Number(versionNumber) > 1000000) {
    throw new HttpsError('invalid-argument', 'La versión no es válida.');
  }
  const entryFile = textField(input.entryFile, 'entryFile', 1, 300);
  if (normalizeAssetPath(entryFile) !== entryFile || !/index[.]html?$/i.test(entryFile)) {
    throw new HttpsError('invalid-argument', 'El archivo de entrada no es válido.');
  }

  const project = await requireOwnedProject(uid, projectId);
  const current = objectData(project.data());
  const nextVersion = Number(versionNumber);
  if (nextVersion !== Number(current.version) + 1) {
    throw new HttpsError('failed-precondition', 'Otra publicación cambió la versión. Recarga e inténtalo de nuevo.');
  }
  const status = visibility(input.status, String(current.status));
  const cover = input.cover === undefined ? current.cover ?? null : sanitizeCover(input.cover);
  const totals = await validateStoredVersion(uid, projectId, nextVersion, entryFile);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const projectRef = db.collection('projects').doc(projectId);
    const fresh = await transaction.get(projectRef);
    const freshData = objectData(fresh.data());
    if (freshData.ownerId !== uid || Number(freshData.version) + 1 !== nextVersion) {
      throw new HttpsError('aborted', 'El proyecto cambió durante la publicación.');
    }
    const next: Record<string, unknown> = {
      ...freshData,
      status,
      cover,
      version: nextVersion,
      entryFile,
      fileCount: totals.fileCount,
      totalBytes: totals.totalBytes,
      updatedAt: now,
      publishedAt: status === 'draft' ? null : (freshData.publishedAt ?? now),
    };
    transaction.update(projectRef, next);
    transaction.create(projectRef.collection('versions').doc(`v${nextVersion}`), {
      version: nextVersion,
      entryFile,
      fileCount: totals.fileCount,
      totalBytes: totals.totalBytes,
      publishedAt: now,
    });
    const publicRef = db.collection('publicProjects').doc(projectId);
    if (status === 'draft') transaction.delete(publicRef);
    else transaction.set(publicRef, publicProject(next));
  });

  return { version: nextVersion };
});

export const updateProjectMetadata = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para editar.');
  const input = objectData(request.data);
  const projectId = textField(input.projectId, 'projectId', 1, 128);
  const snapshot = await requireOwnedProject(uid, projectId);
  const current = objectData(snapshot.data());
  const patch = input.metadata === undefined ? {} : sanitizeMetadata(input.metadata);
  const status = visibility(input.status, String(current.status));
  const now = new Date().toISOString();

  if (patch.courseId) {
    const course = await db.collection('courses').doc(String(patch.courseId)).get();
    patch.courseName = course.exists ? course.get('name') ?? null : null;
    patch.term = course.exists ? course.get('term') ?? null : null;
  } else {
    patch.courseName = null;
    patch.term = null;
  }

  await db.runTransaction(async (transaction) => {
    const projectRef = db.collection('projects').doc(projectId);
    const fresh = await transaction.get(projectRef);
    const freshData = objectData(fresh.data());
    if (freshData.ownerId !== uid) throw new HttpsError('permission-denied', 'No autorizado.');
    const next: Record<string, unknown> = {
      ...freshData,
      ...patch,
      status,
      updatedAt: now,
      publishedAt: status === 'draft' ? null : (freshData.publishedAt ?? now),
    };
    transaction.update(projectRef, next);
    const publicRef = db.collection('publicProjects').doc(projectId);
    if (status === 'draft' || Number(next.version) < 1) transaction.delete(publicRef);
    else transaction.set(publicRef, publicProject(next));
  });
  return {};
});

export const deleteProject = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para eliminar.');
  const input = objectData(request.data);
  const projectId = textField(input.projectId, 'projectId', 1, 128);
  const project = await requireOwnedProject(uid, projectId);
  const data = objectData(project.data());

  await Promise.all([
    bucket.deleteFiles({ prefix: `projects/${uid}/${projectId}/`, force: true }),
    bucket.deleteFiles({ prefix: `covers/${uid}/${projectId}/`, force: true }),
  ]);
  // projectPaths se conserva como lápida: una entrega eliminada nunca puede
  // reaparecer apuntando a un proyecto diferente.
  await db.recursiveDelete(project.ref);
  await db.collection('publicProjects').doc(projectId).delete();
  return { deleted: true, path: `${String(data.ownerHandle)}/${String(data.slug)}` };
});

async function findProject(
  handle: string,
  slug: string
): Promise<{ id: string; data: ProjectRecord } | null> {
  const path = await db.collection('projectPaths').doc(handle).collection('slugs').doc(slug).get();
  if (!path.exists) return null;
  const projectId = path.get('projectId');
  if (typeof projectId !== 'string') return null;
  const project = await db.collection('projects').doc(projectId).get();
  if (!project.exists) return null;
  return { id: project.id, data: project.data() as ProjectRecord };
}

/**
 * Respuesta mínima que necesitamos. Se declara estructuralmente en vez de
 * importar los tipos de Express: firebase-functions trae su propia copia de
 * @types/express y las dos no son asignables entre sí.
 */
interface HttpResponse {
  status(code: number): HttpResponse;
  set(field: Record<string, string>): HttpResponse;
  send(body: unknown): unknown;
}

function fail(res: HttpResponse, code: number, message: string): void {
  res.status(code).set({ 'Content-Type': 'text/html; charset=utf-8' }).send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${code} · UINexus</title>
     <style>
       body{font:16px/1.6 system-ui,sans-serif;background:#f7f5f1;color:#16171b;
            display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
       main{max-width:36rem;text-align:center}
       h1{font-size:1.5rem;margin:0 0 .5rem}
       p{color:#5c5f6b;margin:0}
       @media (prefers-color-scheme:dark){body{background:#111214;color:#f2f1ee}p{color:#9a9daa}}
     </style></head>
     <body><main><h1>${message}</h1>
     <p>Este espacio aloja proyectos publicados en UINexus.</p></main></body></html>`
  );
}

export const serveProject = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').send('Method Not Allowed');
      return;
    }

    // Ruta esperada: /@handle/slug/[…asset]  ó  /handle/slug/[…asset]
    const parts = (req.path || '/').split('/').filter(Boolean);
    const rawHandle = parts[0] ?? '';
    const handle = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle;
    const slug = parts[1] ?? '';

    if (!/^[a-z0-9][a-z0-9-]{2,23}$/.test(handle) || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) {
      fail(res, 404, 'Proyecto no encontrado');
      return;
    }

    const project = await findProject(handle, slug);
    if (!project) {
      fail(res, 404, 'Proyecto no encontrado');
      return;
    }

    const { data } = project;
    if (data.hiddenByAdmin || !['published', 'unlisted'].includes(data.status)) {
      // Mismo mensaje que un 404 real: no revelamos la existencia de borradores.
      fail(res, 404, 'Proyecto no encontrado');
      return;
    }

    const requested = parts.slice(2).join('/');
    const normalized = normalizeAssetPath(requested);
    if (normalized === null) {
      fail(res, 400, 'Ruta no válida');
      return;
    }

    const directoryRequest = (req.path || '/').endsWith('/');
    const requestedExt = extensionOf(normalized);
    if (normalized !== '' && requestedExt && !CONTENT_TYPES[requestedExt]) {
      fail(res, 415, 'Tipo de archivo no permitido');
      return;
    }

    const candidates = normalized === ''
      ? [data.entryFile || 'index.html']
      : directoryRequest
        ? [`${normalized}/index.html`]
        : requestedExt
          ? [normalized]
          : [`${normalized}/index.html`, data.entryFile || 'index.html'];

    let file: ReturnType<typeof bucket.file> | null = null;
    let assetPath = '';
    for (const candidate of [...new Set(candidates)]) {
      const candidateFile = bucket.file(
        `projects/${data.ownerId}/${project.id}/v${data.version}/${candidate}`
      );
      const [exists] = await candidateFile.exists();
      if (exists) {
        file = candidateFile;
        assetPath = candidate;
        break;
      }
    }
    if (!file) {
      fail(res, 404, 'Archivo no encontrado');
      return;
    }

    const contentType = CONTENT_TYPES[extensionOf(assetPath)];
    if (!contentType) {
      fail(res, 415, 'Tipo de archivo no permitido');
      return;
    }

    res.set({
      // El tipo lo decide el servidor, no el archivo subido.
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': contentSecurityPolicy(),
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      // La URL pública es estable y puede cambiar de versión o moderación.
      // Revalidar pronto evita mantener contenido retirado en el edge.
      'Cache-Control': 'public, max-age=60, s-maxage=60, must-revalidate',
      'X-Robots-Tag': data.status === 'unlisted' ? 'noindex, nofollow' : 'all',
    });

    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    file
      .createReadStream()
      .on('error', () => fail(res, 500, 'No se pudo leer el proyecto'))
      .pipe(res);
  }
);
