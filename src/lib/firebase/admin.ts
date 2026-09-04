import 'server-only';

import { cert, getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  EMULATOR_HOST,
  EMULATOR_PORTS,
  FIREBASE_EMULATOR_PROJECT_ID,
  FIREBASE_PROJECT_ID,
  useEmulators,
} from './config';

/**
 * Admin SDK de Firebase.
 *
 * Tras la migración a AWS, Firebase conserva UNA sola responsabilidad:
 * **identidad**. Aquí ya no hay Firestore. Lo único que hace este módulo es
 * permitir que el servidor verifique el ID token que manda el navegador y
 * sepa, con certeza criptográfica, quién está pidiendo algo.
 *
 * Diferencia operativa importante respecto a App Hosting: en AWS no existen
 * las credenciales por defecto de Google, así que `FIREBASE_SERVICE_ACCOUNT_JSON`
 * pasa a ser OBLIGATORIO en producción. Es un secreto de verdad: va en el
 * gestor de secretos de Amplify, nunca en el repositorio.
 */

let cachedApp: App | null | undefined;
let cachedAuth: Auth | null | undefined;

export function parseServiceAccountJson(raw: string): {
  project_id: string;
  client_email: string;
  private_key: string;
} {
  let cleaned = raw.trim();

  // Desempaquetar si viene envuelto entre comillas
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Soporte para JSON codificado en base64 (muy util en Vercel / CI / AWS)
  if (!cleaned.startsWith('{')) {
    try {
      const decoded = Buffer.from(cleaned, 'base64').toString('utf-8').trim();
      if (decoded.startsWith('{')) {
        cleaned = decoded;
      }
    } catch {
      // Continúa con cleaned original
    }
  }

  const parsed = JSON.parse(cleaned) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      'El JSON de la cuenta de servicio de Firebase no contiene project_id, client_email o private_key.'
    );
  }

  return {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key,
  };
}

function createApp(): App | null {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (useEmulators) {
    // `next build` no debe depender de que los emuladores estén levantados.
    if (process.env.NODE_ENV === 'production') return null;
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`;
    return initializeApp({ projectId: FIREBASE_EMULATOR_PROJECT_ID });
  }

  try {
    if (serviceAccountJson) {
      const parsed = parseServiceAccountJson(serviceAccountJson);

      // Verificar tokens contra otro proyecto aceptaría sesiones ajenas.
      if (parsed.project_id !== FIREBASE_PROJECT_ID) {
        throw new Error(`La cuenta de servicio no pertenece a ${FIREBASE_PROJECT_ID}.`);
      }

      return initializeApp({
        credential: cert({
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.includes('\\n')
            ? parsed.private_key.replace(/\\n/g, '\n')
            : parsed.private_key,
        }),
      });
    }

    // Desarrollo local con `gcloud auth application-default login`.
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return initializeApp({
        credential: applicationDefault(),
        projectId: FIREBASE_PROJECT_ID,
      });
    }
  } catch (error) {
    if (serviceAccountJson) throw error;
    console.warn('[uinexus] Admin SDK no disponible; las escrituras quedan cerradas.', error);
  }

  return null;
}

export function getAdminApp(): App | null {
  if (cachedApp !== undefined) return cachedApp;
  cachedApp = getApps()[0] ?? createApp();
  return cachedApp;
}

/** Verificador de ID tokens. `null` si no hay credenciales de administrador. */
export function getAdminAuth(): Auth | null {
  if (cachedAuth !== undefined) return cachedAuth;
  const app = getAdminApp();
  cachedAuth = app ? getAuth(app) : null;
  return cachedAuth;
}

export const isAdminConfigured = (): boolean => getAdminAuth() !== null;
