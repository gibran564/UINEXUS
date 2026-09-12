import {
  INVALID_DOMAIN_NOTICE,
  INVALID_DOMAIN_REASON,
  LOGIN_INVALID_DOMAIN_PATH,
  isInstitutionalEmail,
} from './identity';
import type { UserRole } from './types';

/**
 * Qué hacer con una sesión de Firebase que acaba de aparecer.
 *
 * ## El fallo que este módulo existe para cerrar
 *
 * La validación del dominio institucional vivía SÓLO en los métodos explícitos
 * de inicio de sesión (`signInWithGoogle`, `signInWithEmail`, `registerWith…`).
 * Pero Firebase persiste la sesión: al recargar la página, `onAuthStateChanged`
 * devuelve el usuario sin volver a pasar por ninguno de esos métodos. Una cuenta
 * de Gmail que hubiera entrado antes de que existiera la regla —o que la hubiera
 * esquivado— quedaba restaurada como autenticada para siempre: perfil creado,
 * `status = 'authenticated'`, y todas las llamadas al aula respondiendo 403
 * porque el servidor no la conocía. Una sesión válida para Firebase e inválida
 * para Nextudio deja la plataforma inutilizable y sin salida visible.
 *
 * ## Por qué es un módulo aparte y PURO
 *
 * Ni `'use client'` ni `server-only`, y sin importar el SDK de Firebase: la
 * decisión es una regla sobre un correo y dos efectos (crear perfil o cerrar
 * sesión). Aislarla la hace probable sin navegador —que es donde se comprueba
 * que un correo no autorizado NUNCA llega a `ensureUserProfile`— y deja al
 * proveedor de React con una sola responsabilidad: pintar el resultado.
 *
 * La regla vive en `identity.ts` y NO se reescribe aquí. Ese es el punto: un
 * `endsWith('@itdurango.edu.mx')` repetido por los archivos es exactamente lo
 * que hace que la allowlist docente (`ALLOWED_SPECIAL_EMAILS`) se pierda en uno
 * de ellos.
 */

export interface SessionUser {
  uid: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
}

/** Lo mínimo que se necesita de un usuario de Firebase. */
export interface FirebaseIdentityLike {
  uid: string;
  email: string | null;
}

/** Lo mínimo que devuelve `ensureUserProfile`. */
export interface SessionProfileLike {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
}

export type SessionOutcome =
  | { kind: 'authenticated'; user: SessionUser }
  | { kind: 'rejected'; reason: string; message: string; redirectTo: string };

export const REJECTED_SESSION: Extract<SessionOutcome, { kind: 'rejected' }> = {
  kind: 'rejected',
  reason: INVALID_DOMAIN_REASON,
  message: INVALID_DOMAIN_NOTICE,
  redirectTo: LOGIN_INVALID_DOMAIN_PATH,
};

/**
 * Decide qué hacer con la sesión que Firebase acaba de restaurar o crear.
 *
 * El orden importa y es la mitad de la corrección: se comprueba el correo
 * ANTES de tocar el perfil. Si no está autorizado no se crea nada, no se
 * consulta nada y se cierra la sesión de Firebase; sólo entonces se devuelve el
 * rechazo. Al revés —crear el perfil y luego arrepentirse— dejaría en la base de
 * datos un usuario que la plataforma no reconoce.
 *
 * `signOut` se llama SIEMPRE que se rechaza, incluso si falla: el fallo se
 * traga porque lo que no puede pasar es que el rechazo se convierta en una
 * excepción y la sesión se quede a medias, ni autenticada ni cerrada.
 */
export async function resolveRestoredSession<T extends FirebaseIdentityLike>(
  firebaseUser: T,
  deps: {
    ensureProfile: (user: T) => Promise<SessionProfileLike>;
    signOut: () => Promise<void>;
  }
): Promise<SessionOutcome> {
  if (!isInstitutionalEmail(firebaseUser.email)) {
    try {
      await deps.signOut();
    } catch {
      /* La sesión se descarta igual; el estado local ya no la va a usar. */
    }
    return REJECTED_SESSION;
  }

  const profile = await deps.ensureProfile(firebaseUser);

  return {
    kind: 'authenticated',
    user: {
      uid: firebaseUser.uid,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
    },
  };
}
