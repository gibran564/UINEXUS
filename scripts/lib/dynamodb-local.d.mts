import type { ChildProcess } from 'node:child_process';

/**
 * Tipos del módulo de adquisición de DynamoDB Local.
 *
 * El runner es `.mjs` porque se ejecuta con `node` a pelo, sin pasar por el
 * compilador. Estas declaraciones existen para que las pruebas puedan
 * importarlo con tipos reales en vez de `any`, que es justo donde se cuelan los
 * errores en el código que verifica un hash.
 */

/** Versión fijada, con el formato de fecha con el que AWS las publica. */
export const DYNAMODB_LOCAL_VERSION: string;

/** URL del artefacto fijado. Nunca apunta a `latest`. */
export const DYNAMODB_LOCAL_URL: string;

/** SHA-256 esperado, fijado en el repositorio. */
export const DYNAMODB_LOCAL_SHA256: string;

/** Java mínimo de la línea 2.x. */
export const REQUIRED_JAVA_MAJOR: number;

/** Directorio del caché, siempre fuera del árbol del repositorio. */
export function cacheDir(): string;

/** Ruta del artefacto ya verificado. Descarga si hace falta. */
export function ensureArtifact(log?: (message: string) => void): Promise<string>;

/** Directorio con `DynamoDBLocal.jar`, extraído tras verificar el hash. */
export function ensureExtracted(log?: (message: string) => void): Promise<string>;

/** Comprueba que hay Java suficiente. Lanza con un mensaje accionable si no. */
export function requireJava(): Promise<number>;

/** Arranca DynamoDB Local en memoria en el puerto indicado. */
export function startDynamoDbLocal(options: {
  port: number;
  home: string;
  log?: (message: string) => void;
}): ChildProcess;
