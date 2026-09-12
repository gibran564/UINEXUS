/**
 * El guardián del entorno local.
 *
 * ## Qué problema resuelve
 *
 * Los comandos de este entorno —crear tablas, sembrar datos, vaciarlos— son
 * DESTRUCTIVOS por naturaleza. Ejecutar `reset` contra la cuenta de AWS de
 * producción borraría el trabajo académico de personas reales, y no hay
 * deshacer. El `.env.local` de esta máquina apunta a Firebase y AWS REALES, así
 * que el accidente no es hipotético: es lo que pasa si alguien olvida una
 * variable.
 *
 * ## La regla
 *
 * No se confía en el NOMBRE del script, ni en `NODE_ENV`, ni en que quien lo
 * ejecuta «sabe lo que hace». Se comprueba el DESTINO, que es lo único que
 * determina qué se va a borrar:
 *
 *   1. El endpoint de DynamoDB tiene que existir, ser `http:` y apuntar al
 *      bucle local. Sin endpoint, el SDK resolvería `dynamodb.<región>
 *      .amazonaws.com`, que es exactamente la cuenta que no se puede tocar.
 *   2. El prefijo de tablas tiene que empezar por el prefijo reservado del
 *      sandbox. Así, aunque alguien apuntara a un DynamoDB local con datos que
 *      le importan, no puede pisar tablas que no sean del sandbox.
 *   3. No puede haber credenciales de AWS de verdad en el entorno. Si las hay,
 *      es señal de que este proceso heredó la configuración de producción.
 *
 * Las tres son AND. Falla cerrado: si algo no se puede comprobar, no se ejecuta.
 */

/** Todo lo que el sandbox escribe empieza por aquí. Nada más se puede borrar. */
export const LOCAL_TABLE_PREFIX = 'uinexus-local';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];

export class NotLocalError extends Error {
  constructor(message) {
    super(
      `${message}\n\n` +
        'Este comando sólo puede ejecutarse contra el sandbox LOCAL.\n' +
        'Arráncalo con `npm run dev:local`, que configura el entorno por ti.\n' +
        'Nunca se ejecuta contra AWS ni contra Firebase de producción.'
    );
    this.name = 'NotLocalError';
  }
}

/** ¿Esta URL apunta a un DynamoDB del propio equipo? */
export function isLoopbackEndpoint(endpoint) {
  if (!endpoint) return false;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }
  // `http:` y no `https:`: DynamoDB Local no sirve TLS, así que un `https://`
  // aquí significa que alguien apuntó a otra cosa.
  if (parsed.protocol !== 'http:') return false;
  return LOOPBACK.includes(parsed.hostname);
}

/**
 * Comprueba que el entorno actual es el sandbox local, o lanza.
 *
 * Devuelve la configuración ya validada para que quien llama no tenga que
 * volver a leer `process.env` y arriesgarse a leer otra variable.
 */
export function requireLocalSandbox(env = process.env) {
  const endpoint = env.UINEXUS_DYNAMODB_ENDPOINT ?? '';
  const prefix = env.UINEXUS_TABLE_PREFIX ?? '';

  if (!endpoint) {
    throw new NotLocalError(
      'Falta UINEXUS_DYNAMODB_ENDPOINT: sin él, el SDK hablaría con DynamoDB de AWS.'
    );
  }
  if (!isLoopbackEndpoint(endpoint)) {
    throw new NotLocalError(`El endpoint "${endpoint}" no es un DynamoDB local por HTTP.`);
  }
  if (!prefix.startsWith(LOCAL_TABLE_PREFIX)) {
    throw new NotLocalError(
      `El prefijo de tablas "${prefix || '(vacío)'}" no empieza por "${LOCAL_TABLE_PREFIX}".`
    );
  }

  /**
   * Credenciales de verdad en el entorno.
   *
   * DynamoDB Local acepta cualquier cosa como credencial, así que su presencia
   * no rompería nada por sí sola. Lo que significa es que este proceso heredó la
   * configuración de producción, y eso es justo el estado en el que un error de
   * una línea —un endpoint mal escrito, una variable que se olvidó— acaba
   * escribiendo en la cuenta real.
   */
  const realKey = env.UINEXUS_AWS_ACCESS_KEY_ID ?? '';
  if (realKey && !realKey.startsWith('local')) {
    throw new NotLocalError(
      'Hay credenciales de AWS reales en el entorno. El sandbox usa credenciales literales de prueba.'
    );
  }

  return { endpoint, prefix, region: env.UINEXUS_AWS_REGION ?? 'us-east-1' };
}

/**
 * Y el equivalente para Firebase.
 *
 * El emulador se identifica por el proyecto `demo-*`, que es la convención de
 * Firebase para «este proyecto no existe en la nube»: el SDK se niega a hablar
 * con Google usando uno. Se comprueba además el interruptor explícito, porque
 * `src/lib/firebase/config.ts` no activa emuladores por heurística.
 */
export function requireLocalFirebase(env = process.env) {
  const useEmulators = env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';

  if (!useEmulators) {
    throw new NotLocalError('NEXT_PUBLIC_FIREBASE_USE_EMULATORS no está en "true".');
  }
  if (!projectId.startsWith('demo-')) {
    throw new NotLocalError(
      `El proyecto de Firebase "${projectId || '(vacío)'}" no es un proyecto de emulador (demo-*).`
    );
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new NotLocalError(
      'Hay una cuenta de servicio de Firebase en el entorno: el sandbox nunca la necesita.'
    );
  }

  return { projectId };
}
