import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureExtracted, requireJava } from './dynamodb-local.mjs';
import { childEnv, LOCAL_DB_DIR, LOCAL_PORTS, PROJECT_ROOT } from './local-env.mjs';
import { ensureLocalTables, seedLocalAccounts, seedLocalData } from './local-seed.mjs';

/**
 * Los servicios del sandbox, para los dos scripts que los necesitan.
 *
 * `dev:local` levanta esto y encima `next dev`; `prod:local` levanta esto y
 * encima un `next build` + `next start`. Lo que hay debajo —DynamoDB Local, el
 * emulador de Auth, las tablas y la semilla— es exactamente lo mismo, y tenerlo
 * en un solo sitio es lo que impide que los dos entornos se separen sin que
 * nadie se entere: el día que cambie un puerto o un paso de la siembra, cambia
 * para ambos.
 *
 * ## Los hijos se matan siempre
 *
 * Una JVM de DynamoDB y otra del emulador sobreviven alegremente a su padre si
 * nadie las mata, y dejan los puertos ocupados hasta que alguien los busca en
 * el administrador de tareas. Por eso el registro de procesos y el apagado
 * viven aquí, y por eso se enganchan `SIGINT`, `SIGTERM` y `exit`.
 */

const children = [];
let closing = false;

export function registerChild(child) {
  children.push(child);
  return child;
}

/** Mata a todos los hijos. Idempotente: llamarlo dos veces no hace daño. */
export function stopChildren() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Ya terminó. No hay nada que hacer.
    }
  }
}

export function shutdown(code = 0) {
  stopChildren();
  process.exit(code);
}

/** Engancha las señales UNA vez. Sin esto, Ctrl+C deja dos JVM vivas. */
export function installShutdownHandlers() {
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
  // `exit` cubre el camino que no pasa por una señal: una excepción no
  // capturada, o un `process.exit` de otro sitio.
  process.once('exit', stopChildren);
}

export async function waitForPort(port, label, timeoutMs = 60_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} no respondió en el puerto ${port}.`);
}

/** ¿Hay algo escuchando ya? Sirve para no arrancar dos sandboxes a la vez. */
export async function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Se lanza el JS del paquete con el propio Node, no el `.cmd` del `node_modules/.bin`.
 *
 * Desde Node 20.12, `spawn` sin `shell: true` se niega a ejecutar un `.cmd` en
 * Windows —es la mitigación de CVE-2024-27980— y falla con un `EINVAL` que no
 * dice nada. La salida fácil es `shell: true`, pero eso mete un intérprete de
 * comandos en medio y con él las reglas de comillas de Windows. Invocar el
 * archivo JS con `process.execPath` evita las dos cosas y funciona igual en los
 * tres sistemas.
 */
export function spawnNode(script, args, env, stdio = ['ignore', 'ignore', 'inherit']) {
  return spawn(process.execPath, [script, ...args], { cwd: PROJECT_ROOT, stdio, env });
}

/** Un script o binario de Node que tiene que TERMINAR antes de seguir. */
export function runNode(script, args, env, stdio = ['ignore', 'ignore', 'inherit']) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: PROJECT_ROOT,
      stdio,
      env,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(script)} terminó con código ${code}.`))
    );
  });
}

/**
 * DynamoDB Local con `-sharedDb` sobre DISCO, no en memoria.
 *
 * Al contrario que la suite de integración —que crea, usa y tira—, aquí los
 * datos tienen que sobrevivir a reiniciar el servidor: si cada `Ctrl+C` borrara
 * el NexLab que alguien estaba probando, el entorno no serviría para recorrer
 * nada. `--reset` es la forma explícita de empezar de cero.
 */
function startDynamo(home) {
  return spawn(
    'java',
    [
      `-Djava.library.path=${path.join(home, 'DynamoDBLocal_lib')}`,
      '-jar',
      path.join(home, 'DynamoDBLocal.jar'),
      '-sharedDb',
      '-dbPath',
      LOCAL_DB_DIR,
      '-disableTelemetry',
      '-port',
      String(LOCAL_PORTS.dynamodb),
    ],
    { cwd: home, stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

/**
 * El emulador de Auth, y SÓLO el de Auth.
 *
 * `firebase.json` declara auth y la interfaz. No se levantan Firestore ni
 * Storage porque Nextudio no los usa desde la migración a AWS: Firebase conserva
 * una sola responsabilidad, que es decir quién eres.
 */
function startAuthEmulator(env) {
  return spawnNode(
    path.join(PROJECT_ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
    ['emulators:start', '--only', 'auth', '--project', 'demo-uinexus'],
    env
  );
}

/**
 * Deja el sandbox en pie: runtimes compilados, base de datos, tablas, semilla
 * y cuentas. Devuelve el entorno que hay que pasarle a Next.
 */
export async function startSandbox({ reset = false, env: extraEnv = {} } = {}) {
  const env = childEnv(extraEnv);

  if (reset) {
    console.log('Borrando los datos locales…');
    await rm(LOCAL_DB_DIR, { recursive: true, force: true });
  }
  await mkdir(LOCAL_DB_DIR, { recursive: true });

  /**
   * Los Workers se recompilan ANTES de arrancar.
   *
   * `npm run dev` lo hace por su `predev`; aquí se lanza Next directamente
   * —para no dejar un npm de por medio que haya que matar bien— y ese paso se
   * perdía. El síntoma fue de los que cuesta atribuir: el código de una celda
   * fallaba con `NameError: name 'nex' is not defined` porque
   * `public/runtime/workers/` seguía teniendo el Worker COMPILADO ANTES del
   * cambio. La aplicación estaba bien; lo que se ejecutaba era otra cosa.
   */
  console.log('Compilando los runtimes y los Workers…');
  await runNode(path.join(PROJECT_ROOT, 'scripts', 'copy-code-runtimes.mjs'), [], env);

  await requireJava();
  const home = await ensureExtracted();

  console.log(`DynamoDB Local en 127.0.0.1:${LOCAL_PORTS.dynamodb} (datos en .local-sandbox/).`);
  registerChild(startDynamo(home));
  await waitForPort(LOCAL_PORTS.dynamodb, 'DynamoDB Local');

  await ensureLocalTables(env);
  await seedLocalData(env);

  console.log(`Emulador de Auth en 127.0.0.1:${LOCAL_PORTS.firebaseAuth} (proyecto demo-uinexus).`);
  registerChild(startAuthEmulator(env));
  /**
   * Más margen que para DynamoDB, y no por capricho.
   *
   * El emulador de Auth arranca una JVM y, en un Windows con antivirus de por
   * medio, el primer arranque del día pasa holgadamente del minuto. Con 60 s el
   * sandbox se rendía sobre un emulador que estaba a punto de estar listo, y el
   * mensaje —«no respondió en el puerto»— hacía pensar en una avería.
   */
  await waitForPort(LOCAL_PORTS.firebaseAuth, 'Emulador de Firebase Auth', 240_000);

  console.log('Cuentas del sandbox:');
  await seedLocalAccounts(env);

  return env;
}

/** Las credenciales, dichas igual en los dos entornos locales. */
export function printSandboxBanner(url) {
  console.log(`\n  Nextudio (sandbox local)  ${url}`);
  console.log(`  Emulador de Auth          http://127.0.0.1:${LOCAL_PORTS.firebaseUi}`);
  console.log('\n  Docente     docente.sandbox@itdurango.edu.mx / sandbox-local');
  console.log('  Estudiante  20250001@itdurango.edu.mx / sandbox-local');
  console.log('\n  Ni Firebase ni AWS de producción intervienen. Ctrl+C para parar.\n');
}
