#!/usr/bin/env node
import path from 'node:path';
import { LOCAL_PORTS, PROJECT_ROOT } from './lib/local-env.mjs';
import {
  installShutdownHandlers,
  portInUse,
  registerChild,
  runNode,
  shutdown,
  spawnNode,
  startSandbox,
  waitForPort,
} from './lib/local-services.mjs';

/**
 * La compilación de producción, servida en local.
 *
 * ```
 * npm run prod:local
 * ```
 *
 * ```
 *   next build   ·  el build REAL, minificado y con sus chunks
 *   next start   ·  127.0.0.1:3000
 * ```
 *
 * ## Para qué
 *
 * Porque `next dev` no es el producto. Compila bajo demanda, no minifica, no
 * parte los bundles igual, sirve React en modo desarrollo y no ejecuta la
 * prerenderización. Probar contra `next dev` demuestra que el código funciona;
 * no demuestra que funcione lo que se despliega.
 *
 * ## LO QUE ESTO NO ES, Y POR QUÉ
 *
 * No es el sandbox completo. **Aquí NO hay base de datos**, y no por descuido:
 * es imposible sin romper una garantía de seguridad que vale más que esta
 * prueba.
 *
 * `lib/aws/config.ts` sólo admite un endpoint de DynamoDB que no sea el de AWS
 * cuando `NODE_ENV` no es `production`. Y `NODE_ENV` en Next **es una constante
 * de compilación**: `next build` lo fija a `production` y webpack sustituye
 * cada lectura por su valor dentro del bundle del servidor. Es decir, en un
 * build de producción la comparación ya no lee ninguna variable —la rama está
 * literalmente eliminada del código—, así que arrancar el servidor con otro
 * `NODE_ENV` no cambia nada: la guarda sigue rechazando el endpoint local.
 * Comprobado: el servidor arranca y cada ruta que toca datos responde 500 con
 * ese mismo error.
 *
 * Eso hace la garantía MÁS fuerte, no más débil: en un despliegue no existe ni
 * siquiera un camino en tiempo de ejecución hacia otra base de datos. La forma
 * de saltárselo sería leer `NODE_ENV` de manera que webpack no pueda
 * sustituirlo, y eso es exactamente lo contrario de lo que hay que hacer.
 *
 * Así que este entorno arranca en el MODO DEMO que la aplicación ya soporta
 * (`isAwsConfigured === false`): sirve la compilación real sin base de datos.
 * Lo que se puede comprobar aquí es lo que no depende de datos —que el build
 * arranca, que las pantallas públicas se pintan con los bundles de verdad, que
 * no hay errores de consola, que el responsive y el tema oscuro se comportan—.
 * Todo lo autenticado sigue viviendo en `npm run test:e2e`, contra `dev:local`.
 *
 * El emulador de Auth SÍ se levanta: no está detrás de ninguna guarda de
 * `NODE_ENV` y sirve para comprobar que la pantalla de acceso funciona con la
 * compilación real.
 *
 * ## Por qué compila en otro directorio
 *
 * `next dev`, `next build` y `next start` comparten `.next` y se pisan. Aquí se
 * usa `.next-local` vía `UINEXUS_DIST_DIR`, que `next.config.ts` lee; en
 * producción esa variable no existe y el directorio sigue siendo `.next`. Así
 * se puede tener el servidor de desarrollo abierto y compilar esto al lado sin
 * que ninguno rompa al otro.
 *
 * ## Banderas
 *
 * ```
 *   --reset       borra los datos locales antes de arrancar
 *   --no-build    reutiliza la compilación anterior de `.next-local`
 * ```
 */

const RESET = process.argv.includes('--reset');
const BUILD = !process.argv.includes('--no-build');

/** El directorio de compilación del sandbox. Nunca el de producción. */
const DIST_DIR = '.next-local';

installShutdownHandlers();

try {
  if (await portInUse(LOCAL_PORTS.next)) {
    throw new Error(
      `El puerto ${LOCAL_PORTS.next} ya está ocupado. ` +
        'Para el sandbox de desarrollo (`npm run dev:local`) antes de arrancar éste: ' +
        'los dos sirven Nextudio en el mismo puerto.'
    );
  }

  const sandbox = await startSandbox({
    reset: RESET,
    env: { NODE_ENV: 'production', UINEXUS_DIST_DIR: DIST_DIR },
  });

  /**
   * Ni al compilar ni al servir se pasa nada que apunte a una base de datos.
   *
   * Es la consecuencia de la guarda explicada en la cabecera: con un build de
   * producción no hay forma de hablar con DynamoDB Local sin debilitarla. En
   * vez de fingir que la hay, se arranca en el modo sin base de datos que la
   * aplicación ya soporta, y se dice.
   *
   * Quitar también las credenciales importa: dejarlas sin el endpoint haría que
   * el SDK intentara hablar con AWS de verdad, y `generateStaticParams` de
   * `/courses/[slug]` fallaría con `UnrecognizedClientException`.
   */
  const env = { ...sandbox };
  for (const key of [
    'UINEXUS_DYNAMODB_ENDPOINT',
    'UINEXUS_TABLE_PREFIX',
    'UINEXUS_PROJECTS_BUCKET',
    'UINEXUS_PUBLIC_BUCKET',
    'UINEXUS_AWS_ACCESS_KEY_ID',
    'UINEXUS_AWS_SECRET_ACCESS_KEY',
    'UINEXUS_LOCAL_SANDBOX',
  ]) {
    delete env[key];
  }

  const nextBin = path.join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

  if (BUILD) {
    console.log(`\nCompilando Nextudio en ${DIST_DIR}/ (puede tardar)…`);
    /**
     * La compilación hereda las `NEXT_PUBLIC_*` del sandbox, y eso importa: se
     * INCRUSTAN en el bundle al compilar. Una compilación hecha con las
     * variables de producción y servida en local hablaría con Firebase de
     * verdad desde el navegador de quien la abriera.
     */
    await runNode(nextBin, ['build'], env, 'inherit');
  } else {
    console.log(`\n\`--no-build\`: se reutiliza lo que haya en ${DIST_DIR}/.`);
  }

  console.log(`\n  Nextudio compilado  http://localhost:${LOCAL_PORTS.next}`);
  console.log(`  Emulador de Auth    http://127.0.0.1:${LOCAL_PORTS.firebaseUi}`);
  console.log('\n  `next build` + `next start`, SIN base de datos: ver la cabecera de');
  console.log('  este archivo. El aula no funciona aquí; para eso, `npm run dev:local`.\n');

  const next = registerChild(
    spawnNode(nextBin, ['start', '--port', String(LOCAL_PORTS.next)], env, 'inherit')
  );
  next.once('exit', (code) => shutdown(code ?? 0));

  await waitForPort(LOCAL_PORTS.next, 'Nextudio compilado', 120_000);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  shutdown(1);
}
