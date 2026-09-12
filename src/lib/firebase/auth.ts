'use client';

import type { User } from 'firebase/auth';
import { getClientAuth } from './client';
import { DomainNotAllowedError, isInstitutionalEmail } from '../identity';

/**
 * Operaciones de Firebase Authentication.
 *
 * Todo lo relacionado con identidad vive aquí para que los componentes no
 * importen `firebase/auth` directamente: así el bundle sólo lo carga quien
 * realmente inicia sesión, y hay un único sitio donde traducir los errores.
 *
 * Ningún dato sensible se registra: ni el correo ni la contraseña se escriben
 * en logs. La regla de quién puede entrar NO se define aquí: se importa de
 * `lib/identity.ts`, que es su único sitio.
 */

export class AuthUnavailableError extends Error {
  constructor() {
    super('Firebase Auth no está configurado.');
    this.name = 'AuthUnavailableError';
  }
}

function requireAuth() {
  const auth = getClientAuth();
  if (!auth) throw new AuthUnavailableError();
  return auth;
}

/** Traduce los códigos de Firebase Auth a algo que se pueda leer sin ser
 *  programador. Nunca se muestra el código crudo. */
export function humanizeAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Ese correo no parece válido. Revisa que esté completo.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'El correo o la contraseña no coinciden.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo. Inicia sesión.';
    case 'auth/weak-password':
      return 'La contraseña necesita al menos 6 caracteres.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Se cerró la ventana de Google antes de terminar.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes o inténtalo de nuevo.';
    case 'auth/account-exists-with-different-credential':
      return 'Ese correo ya tiene cuenta con otro método. Entra con el que usaste la primera vez.';
    case 'auth/unauthorized-domain':
      return `Firebase no reconoce todavía el dominio ${
        typeof window === 'undefined' ? 'de esta página' : window.location.hostname
      }. Hay que añadirlo en Firebase → Authentication → Settings → Authorized domains. Mientras tanto, entra con tu correo y contraseña.`;
    case 'auth/network-request-failed':
      return 'No hay conexión. Inténtalo otra vez cuando vuelva.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos seguidos. Espera un momento.';
    case 'auth/operation-not-allowed':
      return 'Ese método de acceso no está habilitado todavía.';
    case 'auth/requires-recent-login':
      return 'Por seguridad, vuelve a iniciar sesión antes de hacer este cambio.';
    default:
      return 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.';
  }
}

/**
 * Las reglas del dominio institucional viven en `lib/identity.ts`, que no
 * declara lado. Se reexportan aquí para no romper a quien ya las importaba
 * desde este módulo, pero el SERVIDOR debe importarlas de `identity.ts`
 * directamente: desde aquí sólo recibiría una client reference.
 */
export {
  ALLOWED_EMAIL_DOMAIN,
  ALLOWED_SPECIAL_EMAILS,
  DomainNotAllowedError,
  getRoleFromInstitutionalEmail,
  isInstitutionalEmail,
} from '../identity';

export function authErrorMessage(caught: unknown): string {
  if (caught instanceof AuthUnavailableError) {
    return 'El servicio de cuentas no está disponible ahora mismo.';
  }
  if (caught instanceof DomainNotAllowedError || (caught instanceof Error && caught.name === 'DomainNotAllowedError')) {
    return caught.message;
  }
  if (caught instanceof Error && caught.message && !('code' in caught)) {
    return caught.message;
  }
  return humanizeAuthError((caught as { code?: string }).code ?? '');
}

// ---------------------------------------------------------------------------
// Correo y contraseña
// ---------------------------------------------------------------------------

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const trimmed = email.trim();
  if (!isInstitutionalEmail(trimmed)) {
    throw new DomainNotAllowedError(trimmed);
  }
  const auth = requireAuth();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const credential = await signInWithEmailAndPassword(auth, trimmed, password);
  return credential.user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const trimmed = email.trim();
  if (!isInstitutionalEmail(trimmed)) {
    throw new DomainNotAllowedError(trimmed);
  }
  const auth = requireAuth();
  const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
  const credential = await createUserWithEmailAndPassword(auth, trimmed, password);
  const name = displayName.trim();
  if (name) await updateProfile(credential.user, { displayName: name });
  return credential.user;
}

/** Envía el correo de recuperación. No revela si la cuenta existe: el mensaje
 *  que ve la persona es el mismo en ambos casos (lo decide la vista). */
export async function sendPasswordReset(email: string, continueUrl?: string): Promise<void> {
  const trimmed = email.trim();
  if (!isInstitutionalEmail(trimmed)) {
    throw new DomainNotAllowedError(trimmed);
  }
  const auth = requireAuth();
  const { sendPasswordResetEmail } = await import('firebase/auth');
  await sendPasswordResetEmail(
    auth,
    trimmed,
    continueUrl ? { url: continueUrl, handleCodeInApp: false } : undefined
  );
}

/** Verificación de correo. Se ofrece, no se impone: bloquear la exploración
 *  por un correo sin verificar sería una barrera sin beneficio. */
export async function sendVerificationEmail(continueUrl?: string): Promise<void> {
  const auth = requireAuth();
  const user = auth.currentUser;
  if (!user) throw new AuthUnavailableError();
  const { sendEmailVerification } = await import('firebase/auth');
  await sendEmailVerification(
    user,
    continueUrl ? { url: continueUrl, handleCodeInApp: false } : undefined
  );
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export async function signInWithGoogle(): Promise<User> {
  const auth = requireAuth();
  const { GoogleAuthProvider, signInWithPopup, signOut: firebaseSignOut } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  // Solo el selector de cuenta. NO se manda `hd`: ese parametro no es una
  // sugerencia, es un filtro duro de Google que oculta cualquier cuenta fuera
  // del dominio, incluidos los correos docentes autorizados de
  // ALLOWED_SPECIAL_EMAILS, que entonces no podrian entrar nunca. El dominio
  // se comprueba aqui abajo, con la misma regla que el resto de la aplicacion.
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  const userEmail = credential.user.email;
  if (!isInstitutionalEmail(userEmail)) {
    await firebaseSignOut(auth);
    throw new DomainNotAllowedError(userEmail ?? undefined);
  }
  return credential.user;
}

// ---------------------------------------------------------------------------
// Teléfono (SMS): retirado a propósito
//
// Existía un inicio de sesión por SMS y se ha retirado, no deshabilitado a
// medias. La razón es de fondo: Nextudio autoriza sobre el CORREO institucional
// —`isInstitutionalEmail`, con su allowlist docente—, y un número de teléfono
// no demuestra pertenencia a `@itdurango.edu.mx`. Una sesión creada por SMS
// llegaba sin correo, así que era exactamente el caso que la política no puede
// evaluar; dejarla habilitada era una puerta lateral a la regla.
//
// El día que vuelva, vuelve como SEGUNDO factor de una cuenta institucional ya
// verificada (`linkWithPhoneNumber` sobre el usuario actual), no como forma de
// entrar. Está anotado en CHECKPOINTS.md.
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const auth = getClientAuth();
  if (!auth) return;
  const { signOut: firebaseSignOut } = await import('firebase/auth');
  await firebaseSignOut(auth);
}
