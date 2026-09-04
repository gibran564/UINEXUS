import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Verificación de artefactos descargados.
 *
 * Módulo diminuto y PURO a propósito: es la pieza de la que depende que la
 * suite de integración no ejecute un binario que nadie ha comprobado, así que
 * tiene que poder leerse entera y probarse sin descargar nada.
 *
 * La regla que impone es una sola y no admite excepciones:
 *
 *   nada se extrae ni se ejecuta antes de comparar su SHA-256.
 *
 * Se aplica también al caché. «Si ya está descargado, es seguro» es justo la
 * suposición que convierte un caché en un punto de entrada: un archivo en el
 * disco del desarrollador lo puede haber tocado cualquier cosa desde la última
 * vez, desde un fallo de escritura hasta otro programa.
 */

export class ChecksumMismatchError extends Error {
  constructor(filePath, expected, actual) {
    super(
      [
        'DynamoDB Local checksum mismatch.',
        `Expected: ${expected}`,
        `Actual:   ${actual}`,
        'Cached artifact will not be executed.',
        `File: ${filePath}`,
      ].join('\n')
    );
    this.name = 'ChecksumMismatchError';
    this.filePath = filePath;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * SHA-256 de un archivo, en hexadecimal minúsculo.
 *
 * Por streaming y no leyendo el archivo entero: el artefacto pesa ~54 MB y no
 * hay razón para tenerlo dos veces en memoria.
 */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Comprueba que el archivo es exactamente el que se espera.
 *
 * Lanza `ChecksumMismatchError` si no coincide. NO borra el archivo: se prefiere
 * fallar de forma ruidosa a limpiar en silencio y volver a descargar, porque un
 * artefacto alterado es información —puede ser corrupción de disco o algo
 * peor— y borrarlo la destruye. Quien lo vea decide qué hacer.
 *
 * La comparación es insensible a mayúsculas porque los `.sha256` oficiales de
 * AWS vienen en minúscula pero otras fuentes no siempre.
 */
export async function verifyArtifact(filePath, expectedSha256) {
  const expected = String(expectedSha256).trim().toLowerCase();
  const actual = await sha256File(filePath);

  if (actual !== expected) {
    throw new ChecksumMismatchError(filePath, expected, actual);
  }

  return actual;
}

/**
 * Lee un archivo `.sha256` con el formato de AWS: `<hash> *<nombre>`.
 *
 * Existe para poder COMPROBAR a mano que la constante fijada en el repositorio
 * sigue coincidiendo con lo que publica AWS, no para confiar en ella en tiempo
 * de ejecución. Descargar el hash del mismo sitio que el binario no verifica
 * nada: quien pudiera alterar uno alteraría el otro.
 */
export function parseSha256Sidecar(contents) {
  const match = /^([a-fA-F0-9]{64})\b/.exec(String(contents).trim());
  if (!match) throw new Error('El archivo .sha256 no tiene un hash reconocible.');
  return match[1].toLowerCase();
}
