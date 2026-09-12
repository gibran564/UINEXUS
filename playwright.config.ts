import { defineConfig, devices } from '@playwright/test';
import { isLoopbackEndpoint } from './scripts/lib/local-guard.mjs';

/**
 * Pruebas de extremo a extremo, SÓLO contra el sandbox local.
 *
 * ## La condición que no se negocia
 *
 * Estas pruebas crean actividades, escriben plantillas y entran con cuentas
 * reales del emulador. Ejecutarlas contra producción sería escribir en la
 * materia de alguien. Por eso el destino se comprueba aquí mismo, antes de que
 * Playwright arranque nada, con la MISMA función que usan el seed y el reset
 * (`isLoopbackEndpoint`): no se confía en el nombre del script.
 *
 * ## Por qué levanta `dev:local` y no `next dev`
 *
 * `npm run dev:local` es lo que garantiza que el proceso hable con DynamoDB
 * Local y con el emulador de Firebase, y no con AWS y Firebase reales. Arrancar
 * `next dev` a secas leería `.env.local`, que en una máquina de desarrollo
 * apunta a producción. Ver `scripts/lib/local-env.mjs`.
 *
 * ## Los dos modos
 *
 * ```
 *   npm run test:e2e        next dev      el producto entero, con sesión y datos
 *   npm run test:e2e:prod   next build    lo compilado, sin base de datos
 * ```
 *
 * El segundo compila de verdad y sirve con `next start`, así que ejercita la
 * minificación, el reparto de bundles y React en modo producción. A cambio no
 * tiene base de datos, y no por comodidad: con `NODE_ENV=production` la guarda
 * de `lib/aws/config.ts` —que webpack deja inlineada en el bundle— rechaza el
 * endpoint local, y relajarla para poder probar sería cambiar una garantía de
 * seguridad por una prueba. Así que cada modo cubre lo suyo y se dice cuál.
 *
 * El modo compilado NO reutiliza un servidor levantado: encontrarse un
 * `next dev` abierto y darlo por bueno sería exactamente el fallo que este modo
 * existe para evitar.
 *
 * ## Alcance
 *
 * Los recorridos que no se pueden probar sin navegador, no una suite
 * exhaustiva: crear una actividad sencilla y una por partes, preparar un
 * NexLab, compatibilidad con una actividad antigua, y los del estudiante
 * —entregar, reanudar tras una recarga, una parte que se desbloquea, una
 * conclusión que se exige y una copia entregada que no cambia—. Lo que se puede
 * probar sin navegador ya está probado sin navegador.
 */

const BASE_URL = process.env.UINEXUS_E2E_BASE_URL ?? 'http://127.0.0.1:3000';

/** `npm run test:e2e:prod` lo pone. Ver `scripts/e2e-prod.mjs`. */
const PRODUCTION_LIKE = process.env.UINEXUS_E2E_MODE === 'prod';

if (!isLoopbackEndpoint(BASE_URL)) {
  throw new Error(
    `Las pruebas E2E sólo pueden apuntar al sandbox local. Recibido: ${BASE_URL}`
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * En modo compilado sólo corre la suite que NO necesita base de datos.
   *
   * Un build de producción no puede hablar con DynamoDB Local —la guarda de
   * `lib/aws/config.ts` queda inlineada por webpack con `NODE_ENV=production`—,
   * así que lanzar ahí los recorridos del aula sólo produciría fallos que no
   * dicen nada del producto. Lo que sí se comprueba está en
   * `production-build.spec.ts`; el resto sigue corriendo contra `dev:local`.
   */
  ...(PRODUCTION_LIKE ? { testMatch: '**/production-build.spec.ts' } : {}),
  /** Y al revés: la suite de producción no tiene sentido contra `next dev`. */
  ...(PRODUCTION_LIKE ? {} : { testIgnore: '**/production-build.spec.ts' }),
  // En serie: los recorridos comparten la materia sembrada y el mismo usuario
  // docente. En paralelo se pisarían entre ellos, y un fallo intermitente en una
  // suite de humo es peor que no tenerla.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  /**
   * Tiempos holgados a propósito.
   *
   * Estas pruebas corren contra `next dev`, que compila bajo demanda y escribe
   * en DynamoDB Local. Apretar los tiempos no hace la suite más estricta: la
   * hace intermitente, y una suite de humo intermitente es peor que ninguna.
   * `globalSetup` calienta las rutas para que esto sea margen y no la norma.
   */
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    locale: 'es-MX',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: PRODUCTION_LIKE ? 'npm run prod:local' : 'npm run dev:local',
    url: BASE_URL,
    // El sandbox tarda en levantar DynamoDB Local, sembrar y arrancar Next. En
    // modo compilado hay que sumarle el `next build` entero.
    timeout: PRODUCTION_LIKE ? 600_000 : 240_000,
    reuseExistingServer: PRODUCTION_LIKE ? false : !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
