/**
 * Reglas de identidad institucional.
 *
 * Este módulo es DELIBERADAMENTE neutro: no lleva `'use client'` ni
 * `server-only`, no importa el SDK de Firebase y no toca red. Son reglas puras
 * sobre una cadena de texto, y las necesitan los dos lados:
 *
 *   navegador  ->  avisar antes de enviar el formulario y pintar el rol
 *   servidor   ->  decidir el rol con el que se crea el perfil
 *
 * Vivían en `firebase/auth.ts`, que sí es `'use client'`. Importarlas desde el
 * servidor compilaba sin quejarse, pero lo que llegaba al bundle del servidor
 * no era la función: era una *client reference*, un envoltorio que lanza
 * «Attempted to call getRoleFromInstitutionalEmail() from the server». El
 * síntoma era desconcertante porque aparecía a mitad de `ensureProfile`: el
 * handle quedaba reservado y el perfil no se escribía nunca.
 *
 * La lección, y la razón de que este archivo exista: una regla de negocio que
 * ambos lados comparten no puede vivir en un módulo que declara un lado.
 */

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
 * Por qué se rechazó una sesión, dicho en la URL.
 *
 * Existe para que el rechazo sobreviva a la navegación: quien entra con la
 * cuenta equivocada acaba en `/login` sin sesión y sin estado en memoria, así
 * que el único sitio donde puede viajar el motivo es la dirección. El formulario
 * lo convierte en un aviso y LO BORRA de la URL, para que no reaparezca cada vez
 * que alguien vuelve atrás.
 */
export const INVALID_DOMAIN_REASON = 'invalid-domain';

export const LOGIN_INVALID_DOMAIN_PATH = `/login?reason=${INVALID_DOMAIN_REASON}`;

/**
 * El aviso que ve una persona que entró con una cuenta que no es la suya del
 * ITD. Dice qué pasó y qué hacer; no menciona Firebase, ni tokens, ni dominios
 * en abstracto, porque nada de eso ayuda a entrar.
 */
export const INVALID_DOMAIN_NOTICE =
  `Nextudio usa tu correo institucional @${ALLOWED_EMAIL_DOMAIN}. ` +
  'Cierra la sesión de esa cuenta de Google e inténtalo de nuevo con tu cuenta del ITD.';

export const INVALID_DOMAIN_TITLE = 'Usaste una cuenta no autorizada';

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
