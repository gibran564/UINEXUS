import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_TABLE_PREFIX } from './local-guard.mjs';

/**
 * La configuración del sandbox local, en un solo sitio.
 *
 * ## La decisión que gobierna todo este archivo
 *
 * El `.env.local` de una máquina de desarrollo apunta a Firebase y AWS REALES.
 * Ese archivo existe porque hace falta para trabajar contra producción, y no se
 * toca. El sandbox tiene entonces que **ganarle**, no convivir con él.
 *
 * Y le gana por cómo funciona `@next/env`: al cargar `.env.local`, para cada
 * clave comprueba `hasOwnProperty(process.env, clave)` y, si ya existe,
 * CONSERVA la que ya estaba. Por eso `childEnv()` no deja ninguna variable
 * relevante sin definir —ni siquiera las que tienen que valer cadena vacía, como
 * la cuenta de servicio—: una variable ausente es una variable que `.env.local`
 * rellenaría con el valor de producción.
 *
 * Es la misma idea que la lista BLANCA de `publishableDocument`: se enumera lo
 * que pasa, no lo que se bloquea.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Puertos del sandbox. Distintos de los de producción por si acaso. */
export const LOCAL_PORTS = {
  dynamodb: 8100,
  /** El mismo que declara `firebase.json`, que es quien manda. */
  firebaseAuth: 9099,
  firebaseUi: 4000,
  next: 3000,
};

/** El prefijo de tablas del sandbox. Lo comprueba `requireLocalSandbox`. */
export const LOCAL_PREFIX = LOCAL_TABLE_PREFIX;

/** Dónde vive la base de datos del sandbox. Fuera de git, borrable. */
export const LOCAL_DB_DIR = path.join(root, '.local-sandbox', 'dynamodb');

export const PROJECT_ROOT = root;

/**
 * Las dos identidades del sandbox.
 *
 * ## Por qué el dominio es el institucional de verdad
 *
 * `@itdurango.edu.mx`, y no un `@nextudio.local` inventado, porque
 * `isInstitutionalEmail()` es una regla de PRODUCCIÓN y relajarla para poder
 * probar convertiría el tooling en un agujero. Estas cuentas existen sólo dentro
 * del emulador de Firebase —proyecto `demo-uinexus`, que Google ni siquiera
 * conoce— y dentro de DynamoDB Local. No hay ninguna cuenta real detrás.
 *
 * ## Por qué estos correos concretos
 *
 * El ROL se deduce del correo (`getRoleFromInstitutionalEmail`): con dígitos en
 * la parte local es alumnado —es el número de control del ITD— y sin dígitos es
 * profesorado. Los dos correos de abajo están elegidos para que esa regla real
 * produzca los dos roles, en vez de escribir el rol a mano y dejar sin ejercer
 * justo la función que decide quién es quién.
 */
export const LOCAL_ACCOUNTS = {
  teacher: {
    uid: 'local-teacher',
    email: 'docente.sandbox@itdurango.edu.mx',
    password: 'sandbox-local',
    handle: 'docente-sandbox',
    displayName: 'Docente Sandbox',
    role: 'teacher',
  },
  student: {
    uid: 'local-student',
    email: '20250001@itdurango.edu.mx',
    password: 'sandbox-local',
    handle: 'estudiante-sandbox',
    displayName: 'Estudiante Sandbox',
    role: 'student',
  },
};

export const LOCAL_COURSE_ID = 'local-course-io';

/**
 * El entorno del proceso hijo.
 *
 * Enumera TODA variable que pudiera apuntar a producción, incluidas las que
 * valen cadena vacía. Ver la cabecera: lo que se deja sin definir es lo que
 * `.env.local` rellena con el valor real.
 */
export function childEnv(extra = {}) {
  return {
    ...process.env,

    // --- Firebase: emulador, proyecto demo, sin cuenta de servicio ----------
    NEXT_PUBLIC_FIREBASE_USE_EMULATORS: 'true',
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-uinexus',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-uinexus.firebaseapp.com',
    // La clave web del emulador no autoriza nada: el emulador acepta cualquiera
    // y no habla con Google. Tiene que estar presente porque
    // `isFirebaseConfigured` exige apiKey, projectId y appId.
    NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-local-sandbox',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:demolocalsandbox',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
    // App Check nunca en el sandbox: pediría reCAPTCHA a Google.
    NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY: '',
    NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN: '',
    // Vacía A PROPÓSITO, y por eso está escrita: sin esta línea, `.env.local`
    // metería la cuenta de servicio de producción en el proceso.
    FIREBASE_SERVICE_ACCOUNT_JSON: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${LOCAL_PORTS.firebaseAuth}`,

    // --- AWS: DynamoDB Local, credenciales literales de prueba -------------
    UINEXUS_DYNAMODB_ENDPOINT: `http://127.0.0.1:${LOCAL_PORTS.dynamodb}`,
    UINEXUS_TABLE_PREFIX: LOCAL_PREFIX,
    UINEXUS_AWS_REGION: 'us-east-1',
    UINEXUS_AWS_ACCESS_KEY_ID: 'localaccesskey',
    UINEXUS_AWS_SECRET_ACCESS_KEY: 'localsecretkey',
    UINEXUS_AWS_SESSION_TOKEN: '',
    /**
     * Los buckets se dejan con nombres de sandbox y NO vacíos.
     *
     * Vacíos, `isAwsConfigured` seguiría siendo cierto por el prefijo de tablas
     * y las rutas de assets fallarían con un error sin nombre. Con un nombre que
     * no existe, el fallo dice qué bucket buscaba. No hay S3 local: ver
     * docs/LOCAL-DEVELOPMENT.md.
     */
    UINEXUS_PROJECTS_BUCKET: 'uinexus-local-sandbox-files',
    UINEXUS_PUBLIC_BUCKET: 'uinexus-local-sandbox-public',
    UINEXUS_PUBLIC_BASE_URL: '',
    UINEXUS_ROUTES_KVS_ARN: '',

    // --- Orígenes -----------------------------------------------------------
    NEXT_PUBLIC_APP_ORIGIN: `http://localhost:${LOCAL_PORTS.next}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${LOCAL_PORTS.next}`,
    NEXT_PUBLIC_PROJECTS_ORIGIN: '',

    // --- El interruptor que abre la puerta al endpoint local ---------------
    /**
     * `lib/aws/config.ts` sólo admite `UINEXUS_DYNAMODB_ENDPOINT` en dos
     * runtimes declarados. Éste es el segundo, y exige además
     * `NODE_ENV === 'development'`: en producción no existe ninguna
     * combinación de variables que lo active.
     */
    UINEXUS_LOCAL_SANDBOX: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',

    ...extra,
  };
}
