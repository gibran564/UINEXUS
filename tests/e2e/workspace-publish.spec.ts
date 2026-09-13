import { expect, test, type Page } from '@playwright/test';
import { LOCAL, signIn, uniqueTitle } from './helpers';

/**
 * Publicar un NexCode web.
 *
 * ## Hasta dónde llega esta prueba, y por qué
 *
 * El sandbox local NO tiene S3 —está dicho en `scripts/lib/local-env.mjs`— y
 * `isFirebaseConfigured` es cierto aquí, así que `publish-client` toma el camino
 * REAL y no el simulado. Consecuencia: la subida y el finalize no se pueden
 * ejercitar en local sin inventar un acceso a AWS que esta suite no debe tener.
 *
 * Lo que sí se comprueba es todo lo que ocurre ANTES de tocar la red, que es
 * justo donde vive la lógica que N5 añadió: a quién se le ofrece publicar, qué
 * bloquea la publicación y con qué nombre, y que el formulario no deje mandar
 * metadata que el esquema va a rechazar.
 *
 * La subida y el finalize los cubren las pruebas del publisher, que ya existían
 * antes de que NexCode pudiera publicar.
 */

async function replaceEditorSource(page: Page, accessibleName: string, source: string) {
  const editor = page.getByRole('textbox', { name: accessibleName });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

async function createFile(page: Page, path: string) {
  await page.getByRole('button', { name: 'Crear nuevo archivo' }).click();
  await page.getByRole('textbox', { name: 'Ruta del archivo' }).fill(path);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
}

async function newNexCode(page: Page, title: string, language: string) {
  await page.goto('/practicas');
  await page.getByRole('button', { name: '+ Nuevo NexCode' }).click();
  await page.getByLabel('Nombre').fill(title);
  await page.getByLabel('Lenguaje').selectOption(language);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(title) }).click();
}

test('un NexCode web ofrece publicar y valida antes de tocar la red', async ({ page }) => {
  const title = uniqueTitle('Publicar web');
  await signIn(page, LOCAL.student);
  await newNexCode(page, title, 'html');

  await page.getByRole('button', { name: 'Renombrar solucion.html' }).click();
  await page.getByRole('textbox', { name: 'Renombrar solucion.html' }).fill('index.html');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await replaceEditorSource(
    page,
    'Archivo index.html en HTML',
    '<h1>Sitio</h1><link rel="stylesheet" href="styles.css">'
  );

  await createFile(page, 'styles.css');
  await replaceEditorSource(page, 'Archivo styles.css en CSS', 'h1 { color: teal; }');

  // La vista previa de N4 sigue en pie: publicar no la sustituye.
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Vista previa del proyecto"]').locator('h1')
  ).toHaveText('Sitio');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();

  const publish = page.getByRole('button', { name: 'Publicar', exact: true });
  await expect(publish).toBeVisible();
  await publish.click();

  // El esquema del publisher pide una descripción de verdad; el formulario no
  // deja mandarla corta para que el rechazo no llegue desde el servidor.
  await expect(page.getByRole('button', { name: 'Publicar proyecto' })).toBeDisabled();
  await page.getByLabel('Descripción').fill('Un sitio de prueba para la clase.');
  await expect(page.getByRole('button', { name: 'Publicar proyecto' })).toBeEnabled();
});

test('un archivo que el publisher no admite bloquea y se dice cuál es', async ({ page }) => {
  const title = uniqueTitle('Publicar bloqueo');
  await signIn(page, LOCAL.student);
  await newNexCode(page, title, 'html');

  await page.getByRole('button', { name: 'Renombrar solucion.html' }).click();
  await page.getByRole('textbox', { name: 'Renombrar solucion.html' }).fill('index.html');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await replaceEditorSource(page, 'Archivo index.html en HTML', '<h1>Sitio</h1>');

  await createFile(page, 'notas.py');

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();

  /**
   * La aserción va acotada al aviso, no a la página: `notas.py` también sale en
   * el explorador y en su pestaña, y lo que se comprueba aquí es que el BLOQUEO
   * lo nombra. Nombrado y no descartado en silencio: descubrir que falta un
   * archivo después de publicar el sitio es el peor momento para enterarse.
   */
  const aviso = page.getByRole('alert').filter({ hasText: 'Todavía no se puede publicar' });
  await expect(aviso).toBeVisible();
  await expect(aviso.getByText('notas.py')).toBeVisible();
  await expect(aviso).toContainText('.py');
  await expect(page.getByRole('button', { name: 'Publicar proyecto' })).toHaveCount(0);
});

test('un NexCode que no es web no ofrece publicar', async ({ page }) => {
  const title = uniqueTitle('Publicar python');
  await signIn(page, LOCAL.student);
  await newNexCode(page, title, 'python');

  await expect(page.getByRole('textbox', { name: /Archivo solucion\.py/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vista previa', exact: true })).toHaveCount(0);
});
