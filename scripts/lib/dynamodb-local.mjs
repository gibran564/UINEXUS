import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { extract } from 'tar';
import { verifyArtifact } from './artifact.mjs';

/**
 * Adquisición y arranque de DynamoDB Local.
 *
 * ## Por qué existe este archivo
 *
 * La suite de integración usaba el paquete `dynamodb-local`, que descarga
 * `dynamodb_local_latest.tar.gz`. Ese nombre es MUTABLE: el mismo comando
 * ejecutado hoy y dentro de seis meses puede traer binarios distintos, así que
 * la suite dejaba de ser reproducible sin que nadie lo notara —y sin que nadie
 * comprobara nunca qué se estaba ejecutando—.
 *
 * Aquí la distribución está fijada por fecha y por hash, y el hash se comprueba
 * SIEMPRE: en la primera descarga y cada vez que se reutiliza el caché.
 *
 * ## El orden importa
 *
 *   ¿hay caché? → verificar SHA-256 → extraer → ejecutar
 *   ¿no hay?    → descargar a .tmp → verificar → renombrar → extraer → ejecutar
 *
 * Nunca «descargar, extraer y después verificar»: para cuando se comprueba, el
 * contenido ya está escrito en el disco.
 */

// ---------------------------------------------------------------------------
// El artefacto fijado
// ---------------------------------------------------------------------------

/**
 * Versión de DynamoDB Local. Es una fecha porque así las publica AWS, y ese
 * nombre —a diferencia de `latest`— no cambia nunca de contenido.
 */
export const DYNAMODB_LOCAL_VERSION = '2024-11-06';

/**
 * Distribución oficial de la línea 2.x, la que necesita Java 17+.
 *
 * OJO al elegir la URL: AWS publica dos artefactos con esta misma fecha y
 * distinto contenido. `s3.us-west-2.amazonaws.com/dynamodb-local/` sirve la
 * línea 1.x (Java 8) y este CloudFront `/v2.x/` sirve la 2.x. Tienen tamaños y
 * hashes distintos; cambiar de uno a otro sin darse cuenta rompería el
 * requisito de Java documentado.
 */
export const DYNAMODB_LOCAL_URL = `https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_${DYNAMODB_LOCAL_VERSION}.tar.gz`;

/**
 * SHA-256 esperado, fijado en el repositorio.
 *
 * Tomado del `.sha256` que AWS publica junto al artefacto
 * (`${DYNAMODB_LOCAL_URL}.sha256`) y comprobado contra el archivo descargado.
 *
 * Se fija AQUÍ y no se descarga en cada ejecución a propósito: pedir el hash al
 * mismo servidor que sirve el binario no verifica nada, porque quien pudiera
 * alterar uno alteraría el otro. El sidecar sirve para revisar a mano que esta
 * constante sigue siendo correcta, no para sustituirla.
 *
 * Para comprobarlo:
 *   node scripts/verify-dynamodb-artifact.mjs
 */
export const DYNAMODB_LOCAL_SHA256 =
  '875cb27dc7843d0d24263f0e1521280f9bfdf0ebf0e69fbd1b4cb00e7c8658e0';

/** Java mínimo de la línea 2.x. */
export const REQUIRED_JAVA_MAJOR = 17;

// ---------------------------------------------------------------------------
// Caché, fuera del repositorio
// ---------------------------------------------------------------------------

/**
 * Dónde vive el artefacto.
 *
 * Fuera del árbol de Git siempre: un binario de 54 MB no entra en el
 * repositorio. Se respeta `UINEXUS_CACHE_DIR` para que CI pueda apuntarlo a su
 * propio caché, y si no, la convención de cada sistema.
 */
export function cacheDir() {
  const override = process.env.UINEXUS_CACHE_DIR;
  if (override) return path.resolve(override);

  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Caches')
        : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'));

  return path.join(base, 'uinexus', 'dynamodb-local');
}

const artifactPath = () =>
  path.join(cacheDir(), `dynamodb_local_${DYNAMODB_LOCAL_VERSION}.tar.gz`);

const extractedDir = () => path.join(cacheDir(), DYNAMODB_LOCAL_VERSION);

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

/**
 * Descarga a un temporal, verifica y sólo entonces renombra.
 *
 * Renombrar al final es lo que impide que una descarga cortada —red que se cae,
 * disco lleno, Ctrl+C— deje un archivo a medias con el nombre definitivo, que
 * la siguiente ejecución encontraría y trataría como caché. El temporal lleva
 * el PID para que dos ejecuciones simultáneas no se pisen.
 */
async function download(log) {
  const target = artifactPath();
  const temporary = `${target}.${process.pid}.tmp`;

  await mkdir(cacheDir(), { recursive: true });
  log(`Descargando DynamoDB Local ${DYNAMODB_LOCAL_VERSION}…`);

  const response = await fetch(DYNAMODB_LOCAL_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(
      `No se pudo descargar DynamoDB Local (HTTP ${response.status}).\n${DYNAMODB_LOCAL_URL}`
    );
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    // Se verifica el TEMPORAL. Si no cuadra, el caché válido que hubiera sigue
    // intacto y no se ha ejecutado nada.
    await verifyArtifact(temporary, DYNAMODB_LOCAL_SHA256);
    await rename(temporary, target);
    log('Descarga verificada.');
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  return target;
}

/**
 * Devuelve la ruta del artefacto ya verificado.
 *
 * Si hay caché, se comprueba su hash ANTES de considerarlo utilizable. Si no
 * coincide, se falla en vez de borrarlo y volver a descargar: un artefacto que
 * cambió es información, y borrarlo la destruye sin que nadie se entere.
 */
export async function ensureArtifact(log = console.log) {
  const target = artifactPath();

  if (await exists(target)) {
    log(`Verificando el caché (${DYNAMODB_LOCAL_VERSION})…`);
    await verifyArtifact(target, DYNAMODB_LOCAL_SHA256);
    log('Caché verificado. No hace falta red.');
    return target;
  }

  return download(log);
}

// ---------------------------------------------------------------------------
// Extracción
// ---------------------------------------------------------------------------

const JAR_NAME = 'DynamoDBLocal.jar';

/**
 * Extrae el artefacto ya verificado y devuelve el directorio resultante.
 *
 * Se usa el paquete `tar`, no un parser propio ni el `tar` del sistema: escribir
 * un parser TAR a mano es exactamente el tipo de código donde aparecen los
 * fallos de travesía de rutas, y depender del binario del sistema haría que el
 * runner funcionara o no según la máquina.
 *
 * La extracción ocurre SÓLO después de verificar el hash. Un `.marker` con el
 * hash evita repetir el trabajo en cada ejecución sin volver a confiar a ciegas:
 * si el marcador no coincide con la constante, se extrae otra vez.
 */
export async function ensureExtracted(log = console.log) {
  const tarball = await ensureArtifact(log);
  const destination = extractedDir();
  const marker = path.join(destination, '.verified-sha256');

  const alreadyGood =
    (await exists(path.join(destination, JAR_NAME))) &&
    (await exists(marker)) &&
    (await import('node:fs/promises')
      .then((fs) => fs.readFile(marker, 'utf8'))
      .then((value) => value.trim() === DYNAMODB_LOCAL_SHA256)
      .catch(() => false));

  if (!alreadyGood) {
    log('Extrayendo…');
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await extract({ file: tarball, cwd: destination });
    await writeFile(marker, DYNAMODB_LOCAL_SHA256, 'utf8');
  }

  const jar = path.join(destination, JAR_NAME);
  if (!(await exists(jar))) {
    throw new Error(`La distribución no contiene ${JAR_NAME}: ${destination}`);
  }

  return destination;
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

/**
 * Comprueba que hay un Java suficientemente nuevo ANTES de intentar arrancar.
 *
 * Sin esto, un Java 11 produce un `UnsupportedClassVersionError` en medio de la
 * salida de la suite, que no le dice a nadie qué instalar. No se instala nada
 * automáticamente: eso es decisión de quien administra la máquina.
 */
export async function requireJava() {
  const version = await javaMajorVersion();

  if (version === null) {
    throw new Error(
      `Java ${REQUIRED_JAVA_MAJOR}+ is required to run DynamoDB Local integration tests.\n` +
        'No se encontró `java` en el PATH.'
    );
  }

  if (version < REQUIRED_JAVA_MAJOR) {
    throw new Error(
      `Java ${REQUIRED_JAVA_MAJOR}+ is required to run DynamoDB Local integration tests.\n` +
        `Se encontró Java ${version}.`
    );
  }

  return version;
}

function javaMajorVersion() {
  return new Promise((resolve) => {
    // `java -version` escribe en stderr; es así desde siempre.
    const child = spawn('java', ['-version'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';

    child.stderr.on('data', (chunk) => (output += chunk.toString()));
    child.once('error', () => resolve(null));
    child.once('close', () => {
      const match = /version "(\d+)(?:\.(\d+))?/.exec(output);
      if (!match) return resolve(null);
      const major = Number(match[1]);
      // Java 8 se anuncia como «1.8.0_xxx»: el número que importa es el segundo.
      resolve(major === 1 ? Number(match[2] ?? 0) : major);
    });
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

/**
 * Arranca DynamoDB Local en memoria, en el puerto indicado.
 *
 * `-inMemory` y no `-sharedDb` sobre disco: la suite crea sus tablas, las usa y
 * las tira. Nada debe sobrevivir entre ejecuciones, y así no hay archivos de
 * base de datos que limpiar ni resultados que dependan de una ejecución previa.
 *
 * Se lanza con `spawn` y argumentos separados —nada de construir una línea de
 * comandos— para que las rutas con espacios, que en Windows son la norma,
 * funcionen sin comillas ni escapes.
 */
export function startDynamoDbLocal({ port, home, log = console.log }) {
  const child = spawn(
    'java',
    [
      `-Djava.library.path=${path.join(home, 'DynamoDBLocal_lib')}`,
      '-jar',
      path.join(home, JAR_NAME),
      '-inMemory',
      '-disableTelemetry',
      '-port',
      String(port),
    ],
    { cwd: home, stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  child.once('exit', (code) => {
    if (code && code !== 0 && stderr.trim()) log(`DynamoDB Local terminó (${code}):\n${stderr}`);
  });

  return child;
}
