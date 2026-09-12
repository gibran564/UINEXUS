import { expect, test } from '@playwright/test';
import { LOCAL, signIn, uniqueTitle } from './helpers';

/**
 * El recorrido más corto: una actividad de una parte, de principio a fin.
 *
 * Es el que decide si la fase cumplió su promesa. Si crear «responde con tres
 * conclusiones» sigue obligando a pasar por un constructor de procesos, el
 * rediseño no sirvió de nada.
 */
test('docente crea una actividad sencilla sin tocar nada del modelo', async ({ page }) => {
  const title = uniqueTitle('Tres conclusiones');

  await signIn(page, LOCAL.teacher);

  await page.goto(`/aula/${LOCAL.courseId}/tareas/nueva`);
  await expect(page.getByRole('heading', { name: 'Nueva actividad' })).toBeVisible();

  // La palabra del modelo no aparece en ninguna parte de la pantalla.
  await expect(page.locator('body')).not.toContainText(/workflow/i);

  await page.locator('#activity-title').fill(title);

  // Una sola pregunta: qué debe hacer el estudiante.
  await expect(page.getByText('¿Qué debe hacer el estudiante?').first()).toBeVisible();
  await page.getByRole('button', { name: /^Responder/ }).click();
  await page.getByRole('button', { name: 'Una respuesta escrita' }).click();

  await expect(page.getByRole('heading', { name: 'Qué hará el estudiante' })).toBeVisible();
  await expect(page.getByText('Responder', { exact: false }).first()).toBeVisible();

  // Vista previa: no crea nada.
  await page.getByRole('button', { name: 'Vista previa como estudiante' }).click();
  await expect(page.getByText('Así lo verá el estudiante')).toBeVisible();
  await expect(page.getByRole('button', { name: /Comenzar actividad/ })).toBeDisabled();
  await page.getByRole('button', { name: '← Volver al editor' }).click();

  await page.getByRole('button', { name: 'Publicar actividad' }).click();

  // Vuelve a la materia y la actividad está ahí.
  await expect(page).toHaveURL(new RegExp(`/aula/${LOCAL.courseId}$`));
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
});

test('docente crea una actividad de varias partes y las reordena con teclado', async ({ page }) => {
  const title = uniqueTitle('Proceso de tres partes');

  await signIn(page, LOCAL.teacher);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/nueva`);

  await page.locator('#activity-title').fill(title);

  await page.getByRole('button', { name: /^Responder/ }).click();
  await page.getByRole('button', { name: 'Una respuesta escrita' }).click();

  await page.getByRole('button', { name: '+ Añadir parte' }).click();
  await page.getByRole('button', { name: /Programar — NexCode/ }).click();

  await page.getByRole('button', { name: '+ Añadir parte' }).click();
  await page.getByRole('button', { name: /Continuar proceso/ }).click();

  const parts = page.locator('ol > li.panel');
  await expect(parts).toHaveCount(3);

  // Reordenar SIN arrastrar: los botones se alcanzan con el teclado.
  await page.getByRole('button', { name: 'Mover arriba la parte 3' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mover arriba la parte 2' })).toBeVisible();

  await page.getByRole('button', { name: 'Publicar actividad' }).click();
  await expect(page).toHaveURL(new RegExp(`/aula/${LOCAL.courseId}$`));
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
});
