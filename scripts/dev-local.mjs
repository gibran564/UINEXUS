#!/usr/bin/env node
import path from 'node:path';
import { LOCAL_PORTS, PROJECT_ROOT } from './lib/local-env.mjs';
import {
  installShutdownHandlers,
  printSandboxBanner,
  registerChild,
  shutdown,
  spawnNode,
  startSandbox,
} from './lib/local-services.mjs';

/**
 * El sandbox local completo, con un comando.
 *
 * ```
 * npm run dev:local
 * ```
 *
 * Levanta, en este orden y esperando a cada uno:
 *
 * ```
 *   DynamoDB Local  ·  127.0.0.1:8100   (datos, en disco, borrables)
 *   Auth Emulator   ·  127.0.0.1:9099   (identidad, proyecto demo-uinexus)
 *   next dev        ·  127.0.0.1:3000   (la aplicación)
 * ```
 *
 * Los tres primeros pasos viven en `lib/local-services.mjs` porque los comparte
 * con `npm run prod:local`, que monta el mismo sandbox pero con un `next build`
 * + `next start` encima.
 *
 * ## Por qué un orquestador y no cinco comandos en el README
 *
 * Porque el paso que se olvida es siempre el mismo —sembrar— y el síntoma es
 * «entro y no veo ninguna materia», que no apunta a nada. Y porque el orden
 * importa: sembrar antes de que DynamoDB responda falla, y arrancar `next dev`
 * antes de sembrar deja a alguien mirando una pantalla vacía mientras el seed
 * termina.
 *
 * ## Lo que NO hace, a propósito
 *
 * No toca `.env.local`. Ese archivo apunta a Firebase y AWS reales porque hace
 * falta para trabajar contra producción, y reescribirlo sería destruir la
 * configuración de alguien. El sandbox gana por precedencia de variables de
 * entorno: ver `childEnv()` en `lib/local-env.mjs`.
 *
 * No hay S3 local. Las imágenes de un NexBook necesitan S3 y aquí no lo hay, así
 * que subir una imagen falla con un error legible. Está documentado en
 * `docs/LOCAL-DEVELOPMENT.md`; no se finge que funcione.
 *
 * ## Banderas
 *
 * ```
 *   --reset       borra los datos locales antes de arrancar
 *   --no-serve    prepara el sandbox y sale (para CI y Playwright)
 * ```
 */

const RESET = process.argv.includes('--reset');
const SERVE = !process.argv.includes('--no-serve');

installShutdownHandlers();

try {
  const env = await startSandbox({ reset: RESET, env: { NODE_ENV: 'development' } });

  if (!SERVE) {
    console.log('\nSandbox preparado. `--no-serve`: no se arranca next dev.');
    shutdown(0);
  }

  printSandboxBanner(`http://localhost:${LOCAL_PORTS.next}`);

  // `next dev` directamente y no `npm run dev`: el `predev` que copia los
  // runtimes ya se ejecutó arriba, y meter npm en medio añade otro proceso que
  // hay que matar bien al salir.
  const next = registerChild(
    spawnNode(
      path.join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
      ['dev', '--port', String(LOCAL_PORTS.next)],
      env,
      'inherit'
    )
  );

  next.once('exit', (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  shutdown(1);
}
