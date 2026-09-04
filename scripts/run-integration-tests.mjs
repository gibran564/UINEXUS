import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DYNAMODB_LOCAL_VERSION,
  ensureExtracted,
  requireJava,
  startDynamoDbLocal,
} from './lib/dynamodb-local.mjs';

/**
 * Suite de integración contra DynamoDB Local.
 *
 * El artefacto está FIJADO por versión y por SHA-256 (ver
 * `scripts/lib/dynamodb-local.mjs`): nada se extrae ni se ejecuta antes de
 * comprobar su hash, ni siquiera cuando ya está en el caché. Tras la primera
 * ejecución no hace falta red.
 *
 * El aislamiento respecto a AWS real es doble: el endpoint apunta al bucle
 * local en un puerto libre, y las credenciales que se pasan al proceso hijo son
 * literales de prueba. Esta suite no puede alcanzar `amazonaws.com`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No se pudo reservar un puerto local para DynamoDB.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`DynamoDB Local no respondió en el puerto ${port}.`);
}

const port = await availablePort();
let stopped = false;
let vitestChild;
let dynamoChild;

function stopLocal() {
  if (stopped) return;
  stopped = true;
  dynamoChild?.kill();
}

function handleSignal(signal) {
  vitestChild?.kill(signal);
  stopLocal();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

const handleSigint = () => handleSignal('SIGINT');
const handleSigterm = () => handleSignal('SIGTERM');
process.once('SIGINT', handleSigint);
process.once('SIGTERM', handleSigterm);

try {
  // El orden es el que importa: Java primero —si falta, no tiene sentido
  // descargar 54 MB—, después el artefacto verificado, y sólo entonces se
  // ejecuta algo.
  await requireJava();
  const home = await ensureExtracted();

  console.log(`DynamoDB Local ${DYNAMODB_LOCAL_VERSION} en 127.0.0.1:${port} (en memoria).`);
  dynamoChild = startDynamoDbLocal({ port, home });
  await waitForPort(port);

  const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  vitestChild = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AWS_EC2_METADATA_DISABLED: 'true',
      UINEXUS_INTEGRATION_TESTS: 'true',
      UINEXUS_AWS_ACCESS_KEY_ID: 'localaccesskey',
      UINEXUS_AWS_SECRET_ACCESS_KEY: 'localsecretkey',
      UINEXUS_AWS_REGION: 'us-east-1',
      UINEXUS_DYNAMODB_ENDPOINT: `http://127.0.0.1:${port}`,
      UINEXUS_PROJECTS_BUCKET: 'uinexus-integration-files',
      UINEXUS_TABLE_PREFIX: `uinexus-integration-${process.pid}`,
    },
  });

  const exitCode = await new Promise((resolve, reject) => {
    vitestChild.once('error', reject);
    vitestChild.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Vitest terminó por la señal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  process.exitCode = exitCode;
} finally {
  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);
  stopLocal();
}
