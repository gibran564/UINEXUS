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
} as const;

export const INDEXES = {
  usersByHandle: 'byHandle',
  projectsByOwner: 'byOwner',
  projectsByPath: 'byPath',
  projectsByStatus: 'byStatus',
  coursesBySlug: 'bySlug',
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
