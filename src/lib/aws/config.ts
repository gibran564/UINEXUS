/**
 * Configuración de AWS.
 *
 * UINexus usa Firebase SÓLO para identidad (Authentication). Los datos y los
 * archivos viven en AWS:
 *
 *   Firebase Auth   →  quién eres (ID token)
 *   DynamoDB        →  metadata: usuarios, proyectos, cursos, reportes
 *   S3              →  archivos de los alumnos y portadas
 *   CloudFront      →  el ORIGEN AISLADO donde se ejecutan esos archivos
 *
 * Consecuencia arquitectónica de la migración: al salir de Firestore
 * desaparecen las Security Rules, que eran la única autoridad sobre las
 * escrituras. El navegador no puede hablar con DynamoDB ni con S3, así que
 * TODA escritura pasa por una ruta de API que verifica el ID token con el
 * Admin SDK. La autorización ya no es declarativa: es código, y por eso está
 * concentrada en `lib/server/authorize.ts` en vez de repartida.
 */

/** Región. En Lambda/Amplify viene dada por el entorno. */
export const AWS_REGION: string =
  process.env.UINEXUS_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

/** Prefijo común de las tablas, para poder tener `dev` y `prod` en una cuenta. */
const TABLE_PREFIX: string = process.env.UINEXUS_TABLE_PREFIX ?? 'uinexus';

export const TABLES = {
  users: `${TABLE_PREFIX}-users`,
  handles: `${TABLE_PREFIX}-handles`,
  projects: `${TABLE_PREFIX}-projects`,
  courses: `${TABLE_PREFIX}-courses`,
  reports: `${TABLE_PREFIX}-reports`,
  // Capa académica (iteración 2). Tablas nuevas, no columnas nuevas: una
  // entrega y un proyecto no comparten ni ciclo de vida ni patrón de acceso.
  assignments: `${TABLE_PREFIX}-assignments`,
  submissions: `${TABLE_PREFIX}-submissions`,
  prompts: `${TABLE_PREFIX}-prompts`,
  skills: `${TABLE_PREFIX}-skills`,
  resources: `${TABLE_PREFIX}-resources`,
} as const;

export const INDEXES = {
  usersByHandle: 'byHandle',
  projectsByOwner: 'byOwner',
  projectsByPath: 'byPath',
  projectsByStatus: 'byStatus',
  coursesBySlug: 'bySlug',
  assignmentsByCourse: 'byCourse',
  submissionsByAssignment: 'byAssignment',
  submissionsByStudent: 'byStudent',
  promptsByCourse: 'byCourse',
  skillsByCourse: 'byCourse',
  resourcesByCourse: 'byCourse',
} as const;

/**
 * Bucket privado con el código de los alumnos. NO es de lectura pública: sólo
 * lo lee CloudFront mediante Origin Access Control, y el servidor para firmar
 * subidas. Es el equivalente exacto de lo que hacían las reglas de Storage.
 */
export const PROJECTS_BUCKET: string = process.env.UINEXUS_PROJECTS_BUCKET ?? '';

/** Bucket de portadas y avatares: lectura pública, sólo imágenes. */
export const PUBLIC_BUCKET: string = process.env.UINEXUS_PUBLIC_BUCKET ?? '';

/**
 * Si falta configuración, la capa de datos cae al MODO DEMO igual que antes.
 * Se comprueba lo que de verdad hace falta para leer, no todo.
 */
export const isAwsConfigured: boolean = Boolean(
  process.env.UINEXUS_TABLE_PREFIX || process.env.UINEXUS_PROJECTS_BUCKET
);

/** Clave de partición del índice disperso de la galería. Ver `dynamo.ts`. */
export const PUBLISHED_KEY = 'published' as const;

/**
 * Los límites de subida NO se redefinen aquí: viven en `lib/constants.ts`
 * (`LIMITS`), que ya los comparten el validador del navegador y las vistas.
 * El servidor los aplica al firmar la subida; el cliente sólo los usa para
 * avisar antes de intentarlo.
 */

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Credenciales explícitas de AWS.
 *
 * En Amplify las resolvía el rol de ejecución del backend y no hacía falta
 * escribir nada. En Vercel no hay rol, y además hay una trampa: las funciones
 * de Vercel se ejecutan sobre Lambda, y Lambda ya define
 * `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_SESSION_TOKEN` con la
 * identidad de VERCEL, no con la nuestra. Si dejáramos que la cadena por
 * defecto del SDK los tomara, las peticiones se firmarían con una identidad
 * ajena y DynamoDB respondería `AccessDenied` sin que nadie entienda por qué.
 *
 * Por eso las nuestras llevan nombre propio (`UINEXUS_AWS_*`) y se pasan al
 * cliente a mano. Si no están, se usa la cadena por defecto, que es lo correcto
 * en local (`aws configure`) y en cualquier cómputo con rol propio.
 */
const accessKeyId = process.env.UINEXUS_AWS_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.UINEXUS_AWS_SECRET_ACCESS_KEY ?? '';

export const awsCredentials =
  accessKeyId && secretAccessKey
    ? {
        accessKeyId,
        secretAccessKey,
        ...(process.env.UINEXUS_AWS_SESSION_TOKEN
          ? { sessionToken: process.env.UINEXUS_AWS_SESSION_TOKEN }
          : {}),
      }
    : undefined;

/**
 * Opciones comunes de todos los clientes del SDK.
 *
 * `maxAttempts: 3` acota los reintentos: sin credenciales válidas, lo que se
 * quiere es un error legible en segundos, no un `next build` colgado.
 */
export const awsClientConfig = {
  region: AWS_REGION,
  maxAttempts: 3,
  ...(awsCredentials ? { credentials: awsCredentials } : {}),
};

/**
 * Endpoint alternativo EXCLUSIVO de DynamoDB.
 *
 * Se usa para pruebas de integración contra DynamoDB Local. No forma parte de
 * `awsClientConfig` porque esa configuración también alimenta S3 y CloudFront:
 * apuntar esos clientes al emulador de Dynamo sería incorrecto. En producción
 * la variable no existe y el SDK conserva su resolución normal de endpoints.
 */
const configuredDynamoEndpoint = process.env.UINEXUS_DYNAMODB_ENDPOINT?.trim() || undefined;
const integrationRuntime =
  process.env.NODE_ENV === 'test' && process.env.UINEXUS_INTEGRATION_TESTS === 'true';

if (configuredDynamoEndpoint && !integrationRuntime) {
  throw new Error(
    'UINEXUS_DYNAMODB_ENDPOINT sólo se admite en el runner explícito de integración.'
  );
}

if (configuredDynamoEndpoint) {
  const parsed = new URL(configuredDynamoEndpoint);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'http:' || !loopback) {
    throw new Error('El endpoint de DynamoDB para integración debe ser HTTP loopback.');
  }
}

export const DYNAMODB_ENDPOINT = configuredDynamoEndpoint;

/**
 * Sin credenciales propias y fuera de AWS, la cadena del SDK acaba preguntando
 * al servicio de metadatos de EC2 (169.254.169.254). En un contenedor de
 * compilación de Vercel esa dirección no responde ni rechaza: se traga la
 * petición. El resultado es un build que se queda parado en "Collecting page
 * data" hasta agotar el tiempo del despliegue. Desactivarlo convierte esa
 * espera indefinida en un error inmediato y con nombre.
 */
if (!awsCredentials && process.env.VERCEL) {
  process.env.AWS_EC2_METADATA_DISABLED ??= 'true';
}
