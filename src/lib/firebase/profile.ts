'use client';

import type { User } from 'firebase/auth';
import { apiFetch } from '../api-client';
import type { UserRole } from '../types';

/**
 * Perfil público del usuario.
 *
 * Tras la migración a AWS el perfil vive en DynamoDB y sólo lo escribe el
 * servidor: el navegador se limita a avisar de que alguien acaba de entrar y
 * el servidor decide si hay que crear el perfil o ya existía. La reserva
 * atómica del handle también se hizo servidor adentro, donde una condición de
 * escritura puede garantizarla de verdad.
 *
 * La identidad pública sigue siendo el `handle` (@christian). El UID, el correo
 * y el teléfono se quedan en Firebase Authentication: no se copian aquí ni
 * aparecen en ninguna vista.
 */

export interface UserProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  suspended: boolean;
}

/**
 * Devuelve el perfil, creándolo si es la primera vez. Es idempotente.
 *
 * Nunca lanza: si el servidor no responde se devuelve un perfil derivado de
 * Authentication para que la sesión siga siendo usable y la persona no se
 * quede mirando una pantalla en blanco. El handle vacío significa "todavía sin
 * perfil persistido", y se reintenta en el siguiente inicio de sesión o al
 * publicar.
 */
export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const displayName = user.displayName?.trim() || 'Estudiante';
  const avatarUrl = user.photoURL ?? null;

  try {
    return await apiFetch<UserProfile>('/api/profile', {
      method: 'POST',
      body: { displayName, avatarUrl },
    });
  } catch {
    return { handle: '', displayName, avatarUrl, role: 'student', suspended: false };
  }
}
