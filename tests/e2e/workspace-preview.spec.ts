import { expect, test, type Page } from '@playwright/test';
import { LOCAL, signIn, uniqueTitle } from './helpers';

/**
 * Monaco conserva el valor en su modelo, no en el textarea visible. Escribir
 * como una persona ejercita el mismo onChange que usa el autoguardado y evita
 * inventar una puerta de prueba para sembrar archivos.
 */
async function replaceEditorSource(page: Page, accessibleName: string, source: string) {
  const editor = page.getByRole('textbox', { name: accessibleName });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  /**
   * `focus()` y no `click()`: el textarea real de Monaco queda debajo de sus
   * propias capas y de la cabecera pegajosa, así que un clic lo interceptan
   * ellas y no él. Enfocar no pasa por el puntero, y el teclado que viene
   * después es exactamente el mismo camino que recorre una persona.
   */
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

/**
 * Los localizadores van por ROL y no por etiqueta.
 *
 * El botón que abre cada formulario y el campo que ese formulario muestra
 * comparten nombre accesible a propósito —«Renombrar solucion.html» es el botón
 * Y es la etiqueta del input—, así que `getByLabel` encuentra dos elementos y
 * Playwright se niega a adivinar. El rol es lo que los distingue.
 */
async function createFile(page: Page, path: string) {
  await page.getByRole('button', { name: 'Crear nuevo archivo' }).click();
  await page.getByRole('textbox', { name: 'Ruta del archivo' }).fill(path);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
}

test('un NexCode previsualiza CSS y JavaScript locales y se puede actualizar', async ({
  page,
}) => {
  const title = uniqueTitle('Preview web');
  await signIn(page, LOCAL.student);
  await page.goto('/practicas');

  await page.getByRole('button', { name: '+ Nuevo NexCode' }).click();
  await page.getByLabel('Nombre').fill(title);
  await page.getByLabel('Lenguaje').selectOption('html');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(title) }).click();

  // El NexCode nace legacy. Renombrarlo lo convierte por el flujo real sin
  // migraciones ni escrituras especiales para la prueba.
  await page.getByRole('button', { name: 'Renombrar solucion.html' }).click();
  await page.getByRole('textbox', { name: 'Renombrar solucion.html' }).fill('index.html');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await replaceEditorSource(
    page,
    'Archivo index.html en HTML',
    '<h1 id="styled">Vista web</h1><script src="script.js"></script><link rel="stylesheet" href="styles.css">'
  );

  await createFile(page, 'styles.css');
  await replaceEditorSource(
    page,
    'Archivo styles.css en CSS',
    '#styled { color: rgb(12, 34, 56); font-size: 32px; }'
  );

  await createFile(page, 'script.js');
  await replaceEditorSource(
    page,
    'Archivo script.js en JavaScript',
    'document.body.insertAdjacentHTML("beforeend", "<p id=js-ran>JavaScript listo</p>");'
  );

  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Vista previa del proyecto"]');
  await expect(frame.locator('#js-ran')).toHaveText('JavaScript listo');
  await expect
    .poll(() => frame.locator('#styled').evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(12, 34, 56)');

  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.locator('button[title="styles.css"]').click();
  await replaceEditorSource(
    page,
    'Archivo styles.css en CSS',
    '#styled { color: rgb(90, 80, 70); font-size: 32px; }'
  );
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar vista previa' }).click();

  await expect
    .poll(() => frame.locator('#styled').evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(90, 80, 70)');
});
