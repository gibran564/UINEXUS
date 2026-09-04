#!/usr/bin/env node
/**
 * Crea las tablas académicas que falten. Idempotente.
 *
 * Por qué existe, y por qué no basta con `npm run aws:deploy:infra`:
 *
 * Las tablas de la iteración 2 (`-assignments`, `-submissions`, `-prompts`) ya
 * están en la cuenta, ACTIVE y con sus índices, pero NO las creó la pila de
 * CloudFormation: no tienen ninguna etiqueta `aws:cloudformation:*`. Se
 * crearon por otra vía. Eso significa que la pila y la cuenta ya divergen, y
 * que ejecutar `deploy` sobre `infra/uinexus.cfn.yaml` fallaría al intentar
 * crear recursos que ya existen.
 *
 * Este script NO sustituye a la plantilla: la plantilla sigue siendo la fuente
 * declarativa de verdad y declara todas las tablas, incluida `-skills`. Esto es
 * el atajo para un entorno sin AWS CLI, que es donde estamos.
 *
 * Sólo CREA lo que falta. No modifica ni borra nada de lo que ya existe: si una
 * tabla está, se informa y se pasa a la siguiente. Se puede ejecutar las veces
 * que haga falta.
 *
 *   node scripts/ensure-academic-tables.mjs
 *   node scripts/ensure-academic-tables.mjs --dry-run
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.UINEXUS_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const PREFIX = process.env.UINEXUS_TABLE_PREFIX ?? 'uinexus';
const DRY_RUN = process.argv.includes('--dry-run');

const credentials =
  process.env.UINEXUS_AWS_ACCESS_KEY_ID && process.env.UINEXUS_AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.UINEXUS_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.UINEXUS_AWS_SECRET_ACCESS_KEY,
        ...(process.env.UINEXUS_AWS_SESSION_TOKEN
          ? { sessionToken: process.env.UINEXUS_AWS_SESSION_TOKEN }
          : {}),
      }
    : undefined;

const client = new DynamoDBClient({
  region: REGION,
  maxAttempts: 3,
  ...(credentials ? { credentials } : {}),
});

/**
 * Las definiciones tienen que coincidir EXACTAMENTE con
 * `infra/uinexus.cfn.yaml`. Si divergen, la pila y la cuenta describen dos
 * bases de datos distintas y el siguiente que lea la plantilla se equivocará.
 */
const TABLES = [
  {
    name: `${PREFIX}-resources`,
    spec: {
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'byCourse',
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
  },
  {
    name: `${PREFIX}-skills`,
    spec: {
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'byCourse',
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
  },
];

async function exists(name) {
  try {
    const result = await client.send(new DescribeTableCommand({ TableName: name }));
    return result.Table?.TableStatus ?? 'UNKNOWN';
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') return null;
    throw error;
  }
}

async function waitActive(name) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await exists(name);
    if (status === 'ACTIVE') return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

let created = 0;
let skipped = 0;

for (const table of TABLES) {
  const status = await exists(table.name);

  if (status) {
    console.log(`· ${table.name} ya existe (${status}). No se toca.`);
    skipped += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`· ${table.name} NO existe. Se crearía.`);
    continue;
  }

  console.log(`+ creando ${table.name}…`);
  await client.send(new CreateTableCommand({ TableName: table.name, ...table.spec }));

  const ok = await waitActive(table.name);
  console.log(ok ? `  ${table.name} ACTIVE` : `  ${table.name} sigue creándose; revísala luego`);
  created += 1;
}

console.log(`\nRegión ${REGION} · prefijo ${PREFIX} · creadas ${created} · ya existían ${skipped}`);
