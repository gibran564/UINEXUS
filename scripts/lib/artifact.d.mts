/**
 * Tipos del módulo de verificación de artefactos.
 *
 * El módulo es `.mjs` porque lo usa el runner, que se ejecuta con `node` a
 * pelo. Estas declaraciones existen para que las pruebas lo importen con tipos
 * reales en vez de `any`: es código que decide si se ejecuta un binario, y ahí
 * un `any` silencioso es justo lo que no conviene.
 */

/** Se lanza cuando el hash de un archivo no coincide con el esperado. */
export class ChecksumMismatchError extends Error {
  constructor(filePath: string, expected: string, actual: string);
  readonly filePath: string;
  readonly expected: string;
  readonly actual: string;
}

/** SHA-256 de un archivo, en hexadecimal minúsculo. */
export function sha256File(filePath: string): Promise<string>;

/**
 * Comprueba que el archivo es el esperado. Devuelve el hash si coincide y lanza
 * `ChecksumMismatchError` si no. No borra el archivo.
 */
export function verifyArtifact(filePath: string, expectedSha256: string): Promise<string>;

/** Extrae el hash de un `.sha256` con el formato `<hash> *<nombre>` de AWS. */
export function parseSha256Sidecar(contents: string): string;
