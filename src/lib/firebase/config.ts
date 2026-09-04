/**
 * Configuración web de Firebase.
 *
 * Estos valores son PÚBLICOS por diseño: identifican al proyecto, no autorizan
 * nada. La seguridad real vive en Authentication, las reglas de Firestore y
 * Storage, la validación en servidor y App Check. Lo que sí es secreto son las
 * credenciales del Admin SDK, que nunca se importan desde el navegador.
 *
 * Si falta cualquier valor, UINexus arranca en MODO DEMO: la interfaz completa
 * funciona con datos de ejemplo en memoria y las acciones que escriben avisan
 * de que no hay backend. Esto permite revisar UX y accesibilidad sin haber
 * conectado todavía el proyecto de Firebase.
 */

export const FIREBASE_PROJECT_ID = 'uinexus-f379f';
export const FIREBASE_EMULATOR_PROJECT_ID = 'demo-uinexus';

/** Emuladores: sólo se activan mediante una decisión explícita. */
export const useEmulators: boolean =
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
} as const;

const allowedProjectId = useEmulators
  ? firebaseConfig.projectId === FIREBASE_EMULATOR_PROJECT_ID
  : firebaseConfig.projectId === FIREBASE_PROJECT_ID;

if (firebaseConfig.projectId && !allowedProjectId) {
  throw new Error(
    `[uinexus] Proyecto Firebase rechazado: "${firebaseConfig.projectId}". ` +
      `Usa ${FIREBASE_PROJECT_ID} o ${FIREBASE_EMULATOR_PROJECT_ID} con emuladores.`
  );
}

export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && allowedProjectId
);

/**
 * Emuladores. Se activan con una variable explícita, nunca por heurística de
 * NODE_ENV: apuntar sin querer a producción desde una máquina de desarrollo es
 * exactamente el accidente que hay que evitar, y el fallo debe ser ruidoso.
 */
export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
} as const;

export const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';

/**
 * App Check (reCAPTCHA Enterprise v3). Opcional: si no hay clave de sitio no se
 * inicializa y la aplicación funciona igual. Es defensa en profundidad frente
 * al abuso automatizado, NUNCA un sustituto de las reglas de seguridad.
 */
export const appCheckSiteKey: string = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY ?? '';

/** Token de depuración de App Check para desarrollo local (nunca en producción). */
export const appCheckDebugToken: string =
  process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN ?? '';
