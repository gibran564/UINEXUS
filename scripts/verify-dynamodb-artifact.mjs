#!/usr/bin/env node
/**
 * Comprueba que el SHA-256 fijado en el repositorio sigue siendo el que AWS
 * publica para la versión fijada.
 *
 * Esto NO se ejecuta durante la suite, y es deliberado: pedirle el hash al mismo
 * servidor que sirve el binario no verifica nada, porque quien pudiera alterar
 * uno alteraría el otro. La constante vive en el repositorio, revisada por
 * personas, y este script sirve para esa revisión —al subir de versión, o
 * periódicamente— no para sustituirla.
 *
 *   node scripts/verify-dynamodb-artifact.mjs
 */

import {
  DYNAMODB_LOCAL_SHA256,
  DYNAMODB_LOCAL_URL,
  DYNAMODB_LOCAL_VERSION,
} from './lib/dynamodb-local.mjs';
import { parseSha256Sidecar } from './lib/artifact.mjs';

const sidecarUrl = `${DYNAMODB_LOCAL_URL}.sha256`;

console.log(`Versión fijada: ${DYNAMODB_LOCAL_VERSION}`);
console.log(`Artefacto:      ${DYNAMODB_LOCAL_URL}`);
console.log(`Hash en el repo: ${DYNAMODB_LOCAL_SHA256}`);

const response = await fetch(sidecarUrl, { redirect: 'follow' });
if (!response.ok) {
  console.error(`\nNo se pudo leer ${sidecarUrl} (HTTP ${response.status}).`);
  process.exit(1);
}

const published = parseSha256Sidecar(await response.text());
console.log(`Hash publicado:  ${published}`);

if (published === DYNAMODB_LOCAL_SHA256) {
  console.log('\nCoinciden.');
} else {
  console.error(
    '\nNO coinciden. O AWS republicó el artefacto con ese nombre —lo que sería\n' +
      'muy raro en una versión fechada— o la constante del repositorio está mal.\n' +
      'No actualices la constante sin entender cuál de las dos cosas pasó.'
  );
  process.exit(1);
}
