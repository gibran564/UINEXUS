#!/usr/bin/env node
/**
 * Comprueba que las credenciales de RUNTIME alcanzan las tablas académicas.
 *
 * Por qué existe: `ensure-academic-tables.mjs` dice si las tablas están; esto
 * dice si la aplicación puede USARLAS. Son preguntas distintas y la segunda es
 * la que rompe en producción: una tabla puede existir y estar fuera de la
 * política de IAM del despliegue, y entonces la pestaña «Recursos IA» responde
 * 500 aunque en local funcione.
 *
 * Replica EXACTAMENTE la resolución de credenciales de `lib/aws/config.ts`:
 * usa `UINEXUS_AWS_*` si están y, si no, la cadena por defecto del SDK. Por eso
 * hay que ejecutarlo con el mismo entorno que tiene la aplicación:
 *
 *   # local
 *   node scripts/check-runtime-access.mjs
 *
 *   # con las credenciales de producción
 *   UINEXUS_AWS_ACCESS_KEY_ID=... UINEXUS_AWS_SECRET_ACCESS_KEY=... \
 *     node scripts/check-runtime-access.mjs
 *
 * Comprueba lectura en todas las tablas y, con `--write`, un ciclo completo de
 * escritura y borrado sobre un elemento de prueba que limpia siempre.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.UINEXUS_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const PREFIX = process.env.UINEXUS_TABLE_PREFIX ?? 'uinexus';
const WRITE = process.argv.includes('--write');

const accessKeyId = process.env.UINEXUS_AWS_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.UINEXUS_AWS_SECRET_ACCESS_KEY ?? '';

const explicit = Boolean(accessKeyId && secretAccessKey);

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: REGION,
    maxAttempts: 2,
    ...(explicit
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey,
            ...(process.env.UINEXUS_AWS_SESSION_TOKEN
              ? { sessionToken: process.env.UINEXUS_AWS_SESSION_TOKEN }
              : {}),
          },
        }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false } }
);

console.log(`Región ${REGION} · prefijo ${PREFIX}`);
console.log(
  explicit
    ? 'Credenciales: UINEXUS_AWS_ACCESS_KEY_ID (las mismas que usaría la aplicación).'
    : 'Credenciales: cadena por defecto del SDK. OJO: en producción la aplicación usa\n' +
        '  UINEXUS_AWS_ACCESS_KEY_ID, que puede tener OTRA política. Para comprobar\n' +
        '  producción de verdad, ejecuta esto con esas credenciales.'
);
console.log('');

/** Las consultas que la aplicación hace de verdad, tabla por tabla. */
const CHECKS = [
  { table: 'assignments', index: 'byCourse', key: 'courseId' },
  { table: 'submissions', index: 'byAssignment', key: 'assignmentId' },
  { table: 'submissions', index: 'byStudent', key: 'studentId' },
  { table: 'prompts', index: 'byCourse', key: 'courseId' },
  { table: 'skills', index: 'byCourse', key: 'courseId' },
  { table: 'resources', index: 'byCourse', key: 'courseId' },
  { table: 'courses', index: null, key: 'id' },
  { table: 'users', index: null, key: 'uid' },
];

let failures = 0;

for (const check of CHECKS) {
  const table = `${PREFIX}-${check.table}`;
  const label = check.index ? `${table} · ${check.index}` : `${table} · lectura por clave`;

  try {
    if (check.index) {
      await client.send(
        new QueryCommand({
          TableName: table,
          IndexName: check.index,
          KeyConditionExpression: '#k = :v',
          ExpressionAttributeNames: { '#k': check.key },
          // Un valor que no existe: se comprueba el PERMISO, no el contenido.
          ExpressionAttributeValues: { ':v': '__check__' },
          Limit: 1,
        })
      );
    } else {
      await client.send(new GetCommand({ TableName: table, Key: { [check.key]: '__check__' } }));
    }
    console.log(`  ok    ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FALLA ${label} → ${error.name}: ${String(error.message).slice(0, 120)}`);
  }
}

if (WRITE) {
  console.log('\nEscritura sobre uinexus-resources:');
  const id = `check-${Date.now()}`;
  const table = `${PREFIX}-resources`;

  try {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: { id, courseId: '__check__', createdAt: new Date().toISOString(), title: 'check' },
      })
    );
    console.log('  ok    Put');
    await client.send(new DeleteCommand({ TableName: table, Key: { id } }));
    console.log('  ok    Delete (elemento de prueba limpiado)');
  } catch (error) {
    failures += 1;
    console.log(`  FALLA escritura → ${error.name}: ${String(error.message).slice(0, 120)}`);
    console.log(`  Puede haber quedado el elemento ${id}. Bórralo a mano si es así.`);
  }
}

console.log('');
if (failures === 0) {
  console.log('Todo accesible con estas credenciales.');
} else {
  console.log(
    `${failures} comprobación(es) fallaron. Si el error es AccessDenied, la política de\n` +
      'IAM no cubre esa tabla o ese índice: añádelos y vuelve a ejecutar.'
  );
  process.exitCode = 1;
}
