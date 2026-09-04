import 'server-only';

import { getAdminAuth } from '../firebase/admin';
import { getProjectRecordById, getUserRecordByUid } from '../data/repository';
import type { ProjectRecord, PublicUser, UserRole } from '../types';

/**
 * Autorización del servidor.
 *
 * Este módulo es el sustituto de `firestore.rules` y `storage.rules`. Cuando
 * los datos vivían en Firestore, el navegador escribía directamente y las
 * reglas eran la única autoridad. En AWS el navegador no puede hablar con
 * DynamoDB ni con S3: pide, y aquí se decide.
 *
 * Se ha concentrado a propósito en un solo archivo. Una regla declarativa es
 * difícil de olvidar porque se aplica sola; una comprobación en código es fácil
 * de olvidar porque hay que escribirla en cada ruta. La defensa contra eso es
 * que exista un único sitio donde mirar, y que las rutas no hagan sus propias
 * comprobaciones a mano.
 *
 * Invariantes que se mantienen desde la versión con reglas:
 *  - El rol NUNCA se lee del token ni del cuerpo de la petición: se lee de la
 *    tabla de usuarios, que sólo el servidor escribe.
 *  - `ownerId`, `ownerHandle` y `slug` son inmutables tras la creación.
 *  - Una persona suspendida puede leer, no puede escribir.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Identidad verificada criptográficamente. Es lo único que aporta el token. */
export interface Identity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/** Identidad + perfil almacenado. El rol viene de la base de datos, no del token. */
export interface Actor extends Identity {
  profile: PublicUser & { uid: string; suspended: boolean };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Verifica el ID token de Firebase. `checkRevoked` obliga a una consulta extra
 * pero hace que cerrar sesión en un equipo compartido —un laboratorio del
 * campus— surta efecto de verdad.
 */
export async function requireIdentity(request: Request): Promise<Identity> {
  const auth = getAdminAuth();
  if (!auth) throw new HttpError(503, 'El servicio de cuentas no está disponible.');

  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Necesitas iniciar sesión.');

  try {
    const decoded = await auth.verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    // Nunca se devuelve el motivo exacto: distinguir "token caducado" de
    // "token falso" sólo ayuda a quien está probando tokens falsos.
    throw new HttpError(401, 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
  }
}

/** Identidad + perfil. Falla si la persona todavía no tiene perfil creado. */
export async function requireActor(request: Request): Promise<Actor> {
  const identity = await requireIdentity(request);
  const profile = await getUserRecordByUid(identity.uid);
  if (!profile) throw new HttpError(403, 'Tu perfil todavía no está creado.');
  return { ...identity, profile };
}

/** Actor con permiso de escritura: tiene perfil y no está suspendido. */
export async function requireWriter(request: Request): Promise<Actor> {
  const actor = await requireActor(request);
  if (actor.profile.suspended) {
    throw new HttpError(403, 'Tu cuenta está suspendida. Habla con el profesorado.');
  }
  return actor;
}

export function isStaff(role: UserRole): boolean {
  return role === 'teacher' || role === 'admin';
}

export async function requireStaff(request: Request): Promise<Actor> {
  const actor = await requireWriter(request);
  if (!isStaff(actor.profile.role)) throw new HttpError(403, 'No tienes permiso para esto.');
  return actor;
}

export async function requireAdmin(request: Request): Promise<Actor> {
  const actor = await requireWriter(request);
  if (actor.profile.role !== 'admin') throw new HttpError(403, 'No tienes permiso para esto.');
  return actor;
}

/**
 * Proyecto sobre el que el actor puede escribir: el suyo, o cualquiera si es
 * staff. Devuelve 404 —no 403— cuando no existe o no es suyo y no es staff:
 * confirmar la existencia de un borrador ajeno ya es filtrar información.
 */
export async function requireWritableProject(
  actor: Actor,
  projectId: string
): Promise<ProjectRecord> {
  const project = await getProjectRecordById(projectId);
  if (!project) throw new HttpError(404, 'Ese proyecto no existe.');

  const owns = project.ownerId === actor.uid;
  if (!owns && !isStaff(actor.profile.role)) {
    throw new HttpError(404, 'Ese proyecto no existe.');
  }
  return project;
}

/**
 * Lee y valida el cuerpo JSON con el mismo esquema de Zod que usa el
 * formulario. Que la validación sea compartida no la hace redundante: en el
 * navegador sirve para dar buenos mensajes, aquí para decidir.
 */
export async function readJson<T>(
  request: Request,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'La petición no tiene un cuerpo válido.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, parsed.error.issues[0]?.message ?? 'Datos no válidos.');
  }
  return parsed.data;
}

/** Traduce cualquier fallo a una respuesta JSON sin filtrar detalles internos. */
export function errorResponse(caught: unknown): Response {
  if (caught instanceof HttpError) {
    return Response.json({ error: caught.message }, { status: caught.status });
  }
  console.error('[uinexus] Fallo no controlado en una ruta de API:', caught);
  return Response.json({ error: 'Algo falló por nuestra parte.' }, { status: 500 });
}
