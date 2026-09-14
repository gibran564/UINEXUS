import { RUNTIME_BASE_PATH } from './runtime-assets';

/**
 * La cadena de herramientas de Java EN EL NAVEGADOR, fijada pieza por pieza.
 *
 * Este módulo existe para que no haya dos sitios donde diga «4.3» o «3.13.102».
 * Todo lo que la fase J1 fijó —versiones, orígenes, rutas del sistema de
 * archivos virtual, la lista blanca de red— se declara aquí y se importa desde
 * el motor, el Worker, el script de descarga y las pruebas. Si mañana alguien
 * sube una versión, la suite se lo cuenta en un solo archivo.
 *
 * ## Por qué Java 8 y no 17
 *
 * No es nostalgia: es lo único que se demostró funcionando (ver
 * `spikes/j0-cheerpj/README.md`). ECJ 3.33 con Java 17 intenta montar un
 * `JrtFileSystem` sobre una imagen modular que CheerpJ no expone; la ruta
 * Java 8 + `rt.jar` explícito como `-bootclasspath` compila y ejecuta. Declarar
 * soporte para 11, 17 o 21 sin una ruta probada sería prometer algo que nadie
 * comprobó, así que el alcance es exactamente uno.
 *
 * ## Dos dependencias, dos licencias
 *
 * CheerpJ y ECJ no son lo mismo y no comparten términos:
 *
 *  · CheerpJ Community Edition se sirve DESDE EL CDN de Leaning Technologies.
 *    Autoalojarlo requiere licencia comercial, así que aquí no se copia a
 *    `public/` ni a S3, al contrario de lo que se hace con Pyodide y webR.
 *  · ECJ es Eclipse Public License 2.0 y sí se autoaloja, con su SHA-256
 *    verificado en la descarga.
 *
 * El detalle está en `docs/SECURITY.md` y `docs/LIMITATIONS.md`.
 */

/** La versión de CheerpJ. FIJADA: nunca `latest`. */
export const CHEERPJ_VERSION = '4.3';

/** El prefijo EXACTO del que puede salir el runtime de CheerpJ. */
export const CHEERPJ_BASE_URL = `https://cjrtnc.leaningtech.com/${CHEERPJ_VERSION}/`;

/** El único script de terceros que este Worker carga, y sólo al arrancar. */
export const CHEERPJ_LOADER_URL = `${CHEERPJ_BASE_URL}loader.js`;

/** La versión de Java que el runtime del navegador ofrece. Una sola. */
export const JAVA_RUNTIME_VERSION = 8;

/**
 * El `rt.jar` del JRE 8 que empaqueta CheerpJ.
 *
 * ECJ lo necesita como `-bootclasspath` explícito: sin él busca un JDK modular
 * y no encuentra ninguno.
 */
export const JAVA_BOOTCLASSPATH = `/lt/${JAVA_RUNTIME_VERSION}/jre/lib/rt.jar`;

/** El compilador: Eclipse Compiler for Java, versión fijada y verificada. */
export const ECJ_VERSION = '3.13.102';

export const ECJ_SHA256 = 'e6b938338b7bb12388ca32ba8dfe91c6ab1c56bf5bd8dab6d6e6265fec3b9be3';

export const ECJ_LICENSE = 'EPL-2.0';

/** De dónde se descarga, en el momento de construir. Nunca en tiempo de clase. */
export const ECJ_DOWNLOAD_URLS = [
  `https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/${ECJ_VERSION}/ecj-${ECJ_VERSION}.jar`,
  `https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/${ECJ_VERSION}/ecj-${ECJ_VERSION}.jar`,
] as const;

/** Dónde se publica en el propio origen. Dentro de `/runtime/`, como los demás. */
export const JAVA_RUNTIME_PATH = `${RUNTIME_BASE_PATH}/java/`;

export const ECJ_ASSET_NAME = `ecj-${ECJ_VERSION}.jar`;

/** La URL del propio origen desde la que se sirve el compilador. */
export const ECJ_URL = `${JAVA_RUNTIME_PATH}${ECJ_ASSET_NAME}`;

/**
 * La misma cosa, vista desde DENTRO de CheerpJ.
 *
 * `/app` es la raíz HTTP del origen montada como sólo lectura en el sistema de
 * archivos virtual, así que `/runtime/java/ecj.jar` del navegador es
 * `/app/runtime/java/ecj.jar` para Java. No hay copia: es la misma descarga.
 */
export const ECJ_VFS_PATH = `/app${ECJ_URL}`;

/** La clase pública y documentada del compilador por lotes de ECJ. */
export const ECJ_BATCH_COMPILER_CLASS = 'org.eclipse.jdt.core.compiler.batch.BatchCompiler';

/**
 * Los prefijos de red que el Worker de Java puede alcanzar DESPUÉS de arrancar.
 *
 * Es una lista blanca de dos entradas, y las dos hacen falta de verdad:
 *
 *   ✓  https://cjrtnc.leaningtech.com/4.3/8/jre/lib/rt.jar   recursos tardíos
 *   ✓  /runtime/java/ecj-3.13.102.jar                        el compilador
 *   ✗  /api/private/hit                                      mismo origen, API
 *   ✗  /runtime/pyodide/…                                    otro runtime
 *   ✗  https://ejemplo.mx/…                                  cualquier tercero
 *
 * Lo que NO es: una regla «mismo origen vale». Eso dejaría `/api/*` abierto a
 * cualquier `HttpURLConnection` que escriba el alumnado, que es exactamente el
 * agujero que J0 demostró y que esta fase cierra. Tampoco es `*.leaningtech.com`:
 * el prefijo incluye la VERSIÓN, así que un `4.4` futuro no entra sin que alguien
 * lo escriba aquí.
 */
export const JAVA_NETWORK_ALLOWLIST = [CHEERPJ_BASE_URL, JAVA_RUNTIME_PATH] as const;

// ---------------------------------------------------------------------------
// Sistema de archivos virtual
// ---------------------------------------------------------------------------

/**
 * Dónde vive lo de Nextudio dentro de CheerpJ.
 *
 * `/files` es PERSISTENTE —CheerpJ lo respalda en IndexedDB—, así que no basta
 * con escribir bien: hay que borrar. Todo lo que este runtime crea cuelga de un
 * único prefijo para que «borrar lo mío» sea una operación con un solo nombre.
 */
export const JAVA_VFS_ROOT = '/files/nextudio';

/** El harness compilado, UNA vez por Worker. No es de ninguna ejecución. */
export const JAVA_VFS_RUNTIME_DIR = `${JAVA_VFS_ROOT}/runtime/harness`;

/** Las ejecuciones aisladas: una carpeta por identificador opaco. */
export const JAVA_VFS_RUNS_DIR = `${JAVA_VFS_ROOT}/runs`;

/**
 * Reservado para una fase posterior (Java con estado en NexBook).
 *
 * No se usa en J1 y aun así se declara, porque la abstracción de limpieza tiene
 * que saber HOY que va a existir un segundo tipo de namespace: un borrado que
 * arrasara con todo lo que cuelga de `/files/nextudio` y se llamara «limpiar la
 * ejecución» se llevaría por delante la sesión el día que exista.
 */
export const JAVA_VFS_SESSIONS_DIR = `${JAVA_VFS_ROOT}/sessions`;

/**
 * `/str` es el buzón de JS hacia Java: JS escribe, Java lee, y se va con el
 * runtime. Es PLANO —CheerpJ responde «Directories are not supported» a
 * cualquier ruta con subcarpetas—, así que las fuentes viajan en ranuras
 * numeradas y el harness las coloca en su sitio según el manifiesto.
 */
export const JAVA_STR_PREFIX = '/str/nextudio.';

export const JAVA_MANIFEST_PATH = `${JAVA_STR_PREFIX}manifest`;

/**
 * La ranura de un archivo del proyecto. El nombre NO tiene que ser el de la clase.
 *
 * Porque de aquí no compila nadie: el harness copia cada ranura a
 * `src/<ruta real>` dentro de su namespace, y es ahí donde ECJ exige que el
 * archivo se llame como la clase pública que declara.
 */
export function javaSourceSlotPath(index: number): string {
  return `${JAVA_STR_PREFIX}src.${index}`;
}

/**
 * La ranura del harness, y ésta SÍ se llama como su clase.
 *
 * Es el único fuente que se compila directamente desde `/str`, porque cuando se
 * compila todavía no hay harness que lo copie a ningún sitio. ECJ rechaza un
 * archivo cuyo nombre no coincida con el tipo público que declara —«The public
 * type X must be defined in its own file»—, así que la ranura se llama
 * `NxRunHarness.java` y no `nextudio.harness`.
 */
export function javaHarnessSlotPath(): string {
  return `/str/${JAVA_HARNESS_CLASS_NAME}.java`;
}

// ---------------------------------------------------------------------------
// El espacio de nombres reservado
// ---------------------------------------------------------------------------

/**
 * El paquete del harness, prohibido para el código del alumnado.
 *
 * La defensa que de verdad importa no es este nombre: es que las clases del
 * proyecto se cargan con un `URLClassLoader` cuyo padre es el cargador de
 * arranque, así que desde el código del alumnado el harness y ECJ NO EXISTEN
 * —no están «protegidos», no se pueden nombrar—. Este prefijo es la segunda
 * capa: un proyecto que declare `package io.nextudio.runtime…` se rechaza antes
 * de compilar, para que nadie pueda intentar confundir un classpath.
 */
export const JAVA_RESERVED_PACKAGE = 'io.nextudio.runtime';

export const JAVA_HARNESS_PACKAGE = `${JAVA_RESERVED_PACKAGE}.internal`;

export const JAVA_HARNESS_CLASS_NAME = 'NxRunHarness';

export const JAVA_HARNESS_MAIN_CLASS = `${JAVA_HARNESS_PACKAGE}.${JAVA_HARNESS_CLASS_NAME}`;

/** ¿Este paquete invade el espacio reservado del runtime? */
export function isReservedJavaPackage(packageName: string): boolean {
  return (
    packageName === JAVA_RESERVED_PACKAGE || packageName.startsWith(`${JAVA_RESERVED_PACKAGE}.`)
  );
}
