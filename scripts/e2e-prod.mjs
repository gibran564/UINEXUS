#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * La suite de Playwright contra el sandbox COMPILADO.
 *
 * ```
 * npm run test:e2e:prod
 * ```
 *
 * Existe por una razón boba y real: hay que poner una variable de entorno antes
 * de llamar a Playwright, y `VAR=x comando` no funciona en el `cmd` de Windows.
 * La alternativa sería añadir `cross-env` como dependencia; veinte líneas de
 * Node hacen lo mismo sin ampliar la superficie del proyecto.
 *
 * Lo que cambia con la variable está en `playwright.config.ts`: el servidor pasa
 * a ser `npm run prod:local` —`next build` + `next start`— en vez de
 * `npm run dev:local`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, UINEXUS_E2E_MODE: 'prod' },
  }
);

child.once('exit', (code) => process.exit(code ?? 0));
child.once('error', (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
