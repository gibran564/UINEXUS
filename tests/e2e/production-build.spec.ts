import { expect, test, type Page } from '@playwright/test';

/**
 * Lo que sólo se puede comprobar sobre la COMPILACIÓN de producción.
 *
 * ```
 * npm run test:e2e:prod
 * ```
 *
 * `next dev` compila bajo demanda, no minifica, reparte los chunks de otra
 * forma y sirve React en modo desarrollo. Todo lo que se prueba contra él
 * demuestra que el código funciona; no demuestra que funcione lo que se
 * despliega. Esta suite sirve la salida real de `next build`.
 *
 * ## Qué NO cubre, y por qué
 *
 * Nada que necesite base de datos: el aula entera, las actividades, las
 * entregas. No es una omisión, es imposible sin debilitar una garantía de
 * seguridad. `lib/aws/config.ts` rechaza cualquier endpoint de DynamoDB que no
 * sea el de AWS cuando `NODE_ENV` es `production`, y `NODE_ENV` en Next es una
 * constante de COMPILACIÓN: webpack la sustituye dentro del bundle, así que en
 * un build de producción la rama que permitiría el endpoint local ya no existe.
 * Arrancar el servidor con otro `NODE_ENV` no cambia nada.
 *
 * Todo lo autenticado vive en la suite de `npm run test:e2e`, contra
 * `dev:local`. Ver `scripts/prod-local.mjs` y `docs/LIMITATIONS.md`.
 */

const PUBLIC_ROUTES = [
  ['portada', '/'],
  ['acerca de', '/about'],
  ['iniciar sesión', '/login'],
  ['crear cuenta', '/register'],
] as const;

/** Errores de consola que NO son un fallo del producto. */
function isNoise(text: string): boolean {
  return (
    // Sin base de datos, las pantallas que listan datos avisan. Es el modo
    // demo funcionando, no un error.
    /failed to load resource: the server responded with a status of 5\d\d/i.test(text) ||
    text.includes('Download the React DevTools')
  );
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isNoise(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('la compilación de producción', () => {
  test('sirve las pantallas públicas sin errores de consola', async ({ page }) => {
    const errors = watchConsole(page);

    for (const [label, path] of PUBLIC_ROUTES) {
      const response = await page.goto(path);
      expect(response?.status(), `${label} no respondió 200`).toBe(200);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main')).toBeVisible();
    }

    expect(errors, `Errores de consola:\n${errors.join('\n')}`).toEqual([]);
  });

  test('sirve bundles compilados, no el servidor de desarrollo', async ({ page }) => {
    /**
     * La prueba de que esto ES el build: los chunks llevan hash en el nombre y
     * no existe el cliente de recarga en caliente. Si alguien apuntara esta
     * suite a `dev:local` por error, fallaría aquí.
     */
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(scripts.some((url) => /\/_next\/static\/chunks\/.*-[0-9a-f]{12,}\.js/.test(url))).toBe(
      true
    );
    expect(scripts.some((url) => url.includes('webpack-hmr') || url.includes('hot-update'))).toBe(
      false
    );
  });

  test('ninguna pantalla pública desborda a lo ancho', async ({ page }) => {
    // El mismo criterio que `responsive.spec.ts`, sobre el CSS compilado: es
    // donde Tailwind purga clases y donde un desbordamiento podría aparecer
    // sólo en producción.
    for (const [label, path] of PUBLIC_ROUTES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      for (const width of [1440, 1280, 768, 390, 375, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(120);
        const report = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          report.scrollWidth,
          `${label} a ${width}px desborda ${report.scrollWidth - report.innerWidth}px`
        ).toBeLessThanOrEqual(report.innerWidth);
      }
    }
  });

  test('el tema oscuro no deja texto ilegible en la portada', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Fondo y texto tienen que venir del tema, no de un blanco fijo.
    const colours = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { background: style.backgroundColor, color: style.color };
    });

    expect(colours.background).not.toBe('rgb(255, 255, 255)');
    expect(colours.color).not.toBe('rgb(0, 0, 0)');
    expect(colours.background).not.toBe(colours.color);
  });

  test('la portada no descarga ningún motor de ejecución', async ({ page }) => {
    /**
     * La misma invariante que se comprueba sobre el manifiesto, pero mirando lo
     * que el navegador PIDE de verdad con el build real. Monaco, Pyodide y webR
     * son decenas de megabytes: cargarlos por visitar la portada sería el peor
     * fallo de rendimiento posible.
     */
    const heavy: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/pyodide|webr|monaco|\.wasm$/i.test(url)) heavy.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(heavy, `La portada pidió: ${heavy.join(', ')}`).toEqual([]);
  });
});
