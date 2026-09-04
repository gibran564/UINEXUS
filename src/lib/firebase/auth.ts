'use client';

import type { ConfirmationResult, User } from 'firebase/auth';
import { getClientAuth } from './client';
import { useEmulators } from './config';

/**
 * Operaciones de Firebase Authentication.
 *
 * Todo lo relacionado con identidad vive aquí para que los componentes no
 * importen `firebase/auth` directamente: así el bundle sólo lo carga quien
 * realmente inicia sesión, y hay un único sitio donde traducir los errores.
 *
 * Ningún dato sensible se registra: los códigos OTP no se guardan y el número
 * de teléfono no se escribe en logs ni en Firestore.
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
      return 'Este dominio todavía no está autorizado para iniciar sesión. Avisa al profesorado.';
    case 'auth/network-request-failed':
      return 'No hay conexión. Inténtalo otra vez cuando vuelva.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos seguidos. Espera un momento.';
    case 'auth/invalid-phone-number':
      return 'Ese número no parece válido. Escríbelo con código de país, por ejemplo +52 55 1234 5678.';
    case 'auth/missing-phone-number':
      return 'Escribe tu número de teléfono.';
    case 'auth/quota-exceeded':
      return 'Se agotó el envío de SMS por hoy. Entra con correo o con Google.';
    case 'auth/invalid-verification-code':
      return 'Ese código no es correcto. Revísalo o pide uno nuevo.';
    case 'auth/code-expired':
      return 'El código caducó. Pide uno nuevo.';
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential':
      return 'No se pudo verificar que eres una persona. Recarga la página e inténtalo otra vez.';
    case 'auth/operation-not-allowed':
      return 'Ese método de acceso no está habilitado todavía.';
    case 'auth/requires-recent-login':
      return 'Por seguridad, vuelve a iniciar sesión antes de hacer este cambio.';
    default:
      return 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.';
  }
}

export const ALLOWED_EMAIL_DOMAIN = 'itdurango.edu.mx';
export const ALLOWED_SPECIAL_EMAILS = ['cegibran@gmail.com'];

export function isInstitutionalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (
    normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`) ||
    ALLOWED_SPECIAL_EMAILS.includes(normalized)
  );
}

/**
 * Deduce el rol institucional a partir del correo:
 * - Correos docentes especiales autorizados (ej. cegibran@gmail.com) -> 'teacher'.
 * - Estudiantes: contienen dígitos en el usuario (ej. 20041243@itdurango.edu.mx, l21040123@itdurango.edu.mx).
 * - Docentes / Profesores: NO llevan dígitos (ej. nombre.apellido@itdurango.edu.mx, docente@itdurango.edu.mx).
 */
export function getRoleFromInstitutionalEmail(
  email: string | null | undefined
): 'student' | 'teacher' {
  if (!email) return 'student';
  const normalized = email.trim().toLowerCase();
  if (ALLOWED_SPECIAL_EMAILS.includes(normalized)) {
    return 'teacher';
  }
  const localPart = normalized.split('@')[0] ?? '';
  return /\d/.test(localPart) ? 'student' : 'teacher';
}

export class DomainNotAllowedError extends Error {
  constructor(email?: string) {
    super(
      `El correo ${email ? `"${email}" ` : ''}no pertenece al dominio institucional (@${ALLOWED_EMAIL_DOMAIN}). Debes usar tu cuenta del Instituto Tecnológico de Durango o un correo docente autorizado.`
    );
    this.name = 'DomainNotAllowedError';
  }
}

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
  // Fuerza el selector de cuenta y sugiere el dominio institucional
  provider.setCustomParameters({
    prompt: 'select_account',
    hd: ALLOWED_EMAIL_DOMAIN,
  });
  const credential = await signInWithPopup(auth, provider);
  const userEmail = credential.user.email;
  if (!isInstitutionalEmail(userEmail)) {
    await firebaseSignOut(auth);
    throw new DomainNotAllowedError(userEmail ?? undefined);
  }
  return credential.user;
}

// ---------------------------------------------------------------------------
// Teléfono (SMS)
// ---------------------------------------------------------------------------

/**
 * Firebase exige un verificador anti-abuso (reCAPTCHA) antes de enviar un SMS.
 * No hay forma soportada de saltárselo, ni debe haberla: cada mensaje cuesta
 * dinero y es un vector de abuso. Se usa el modo invisible para no añadir un
 * paso más a quien sí es una persona.
 */
export interface PhoneChallenge {
  confirm: (code: string) => Promise<User>;
  /** Libera el widget de reCAPTCHA. Llamar siempre al terminar o cancelar. */
  dispose: () => void;
}

export async function startPhoneSignIn(
  phoneNumber: string,
  recaptchaContainerId: string
): Promise<PhoneChallenge> {
  const auth = requireAuth();
  const { RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');

  // Con el emulador de Auth no hay reCAPTCHA real ni se envían SMS: el código
  // aparece en la consola del emulador.
  if (useEmulators) auth.settings.appVerificationDisabledForTesting = true;

  const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, { size: 'invisible' });

  let confirmation: ConfirmationResult;
  try {
    confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  } catch (error) {
    verifier.clear();
    throw error;
  }

  return {
    confirm: async (code: string) => {
      const credential = await confirmation.confirm(code.trim());
      return credential.user;
    },
    dispose: () => {
      try {
        verifier.clear();
      } catch {
        /* el widget ya no existe */
      }
    },
  };
}

/** Normaliza a E.164 asumiendo México cuando no se escribe el prefijo. */
export function normalizePhoneNumber(raw: string, defaultCountryCode = '+52'): string {
  const trimmed = raw.replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  return `${defaultCountryCode}${trimmed.replace(/^0+/, '')}`;
}

export function isValidPhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const auth = getClientAuth();
  if (!auth) return;
  const { signOut: firebaseSignOut } = await import('firebase/auth');
  await firebaseSignOut(auth);
}
