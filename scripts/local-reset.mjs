#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { childEnv, LOCAL_DB_DIR } from './lib/local-env.mjs';
import { requireLocalSandbox } from './lib/local-guard.mjs';

/**
 * Borra los datos del sandbox local.
 *
 * ```
 * npm run local:reset
 * ```
 *
 * ## Por qué borra el DIRECTORIO y no las tablas
 *
 * Borrar tablas exige que DynamoDB Local esté levantado, y el momento en que
 * alguien quiere resetear es normalmente justo después de pararlo todo porque
 * algo se quedó raro. Borrar el directorio funciona siempre y no deja mitades:
 * la siguiente ejecución de `dev:local` vuelve a crear tablas y a sembrar.
 *
 * ## El guardián se llama igual
 *
 * Aunque este comando no hable con ningún endpoint, se valida el entorno antes
 * de borrar nada. Es deliberado: el día que alguien añada aquí un
 * `DeleteTableCommand` «que es más limpio», la comprobación ya está puesta y no
 * hay que acordarse de ponerla.
 */

const env = childEnv({ NODE_ENV: 'development' });
requireLocalSandbox(env);

await rm(LOCAL_DB_DIR, { recursive: true, force: true });

console.log(`Datos del sandbox borrados: ${LOCAL_DB_DIR}`);
console.log('La próxima vez que ejecutes `npm run dev:local` se crearán y sembrarán de nuevo.');
console.log('\nLas cuentas del emulador de Firebase viven en memoria y desaparecen al pararlo.');
