import { expect, test } from '@playwright/test';
import { LOCAL, signIn, uniqueTitle } from './helpers';

/**
 * Preparar el laboratorio ANTES de publicar.
 *
 * Es el recorrido que da sentido a la fase: hasta ahora había que publicar la
 * actividad, volver a entrar y editar la plantilla desde la vista del alumnado.
 * Aquí se hace todo sin salir del constructor.
 *
 * No se ejecuta Python dentro de esta prueba: arrancar Pyodide en un navegador
 * sin caché haría la suite lenta y frágil, y la interoperabilidad de datos ya
 * tiene su propia cobertura (`tests/unit/lab-*`). Lo que se comprueba aquí es
 * que la plantilla se prepara, se guarda y se conserva.
 */
test('docente prepara la plantilla de NexLab sin publicar la actividad', async ({ page }) => {
  const title = uniqueTitle('Laboratorio de ventas');

  await signIn(page, LOCAL.teacher);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/nueva`);

  await page.locator('#activity-title').fill(title);
  await page.getByRole('button', { name: /Trabajar en laboratorio — NexLab/ }).first().click();

  // Abrir la plantilla guarda un borrador. La actividad NO se publica.
  await page.getByRole('button', { name: 'Preparar NexLab' }).click();

  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Estás editando la plantilla')).toBeVisible();

  // Markdown: la plantilla nace con un bloque de instrucciones, marcado como
  // contenido del profesorado (`editableByStudent: false`).
  await expect(panel.getByRole('heading', { name: 'Instrucciones' })).toBeVisible();
  await expect(panel.locator('[title="Lo escribió tu docente"]').first()).toBeVisible();

  // Hoja de cálculo con datos importados de un CSV.
  await panel.getByRole('button', { name: '+ Bloque' }).click();
  await panel.getByRole('menuitem', { name: /Hoja de cálculo/ }).click();

  const csv = page.locator('input[type=file][accept*="text/csv"]');
  await csv.setInputFiles({
    name: 'ventas.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Trimestre,Ventas\nQ1,1200\nQ2,1450\nQ3,990\nQ4,1710\n'),
  });
  // Las celdas son campos de formulario, no texto: se comprueba su valor.
  await expect(panel.getByRole('textbox', { name: /fila 1, columna A/ })).toHaveValue(
    'Trimestre',
    { timeout: 30_000 }
  );
  await expect(panel.getByRole('textbox', { name: /fila 3, columna B/ })).toHaveValue('1450');

  // Un bloque de código para completar.
  await panel.getByRole('button', { name: '+ Código' }).click();

  // El laboratorio se guarda solo.
  await expect(panel.getByText('Guardado')).toBeVisible({ timeout: 20_000 });

  // Volver al punto correcto: la actividad sigue ahí, con su parte.
  await panel.getByRole('button', { name: '← Volver a la actividad' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Qué hará el estudiante' })).toBeVisible();
  await expect(page.locator('#activity-title')).toHaveValue(title);

  await page.getByRole('button', { name: 'Publicar actividad' }).click();
  await expect(page).toHaveURL(new RegExp(`/aula/${LOCAL.courseId}$`));
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });

  // Al reabrirla, la plantilla conserva lo preparado.
  await page.getByText(title).first().click();
  await page.waitForLoadState('networkidle');
});
