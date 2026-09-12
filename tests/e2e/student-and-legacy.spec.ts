import { expect, test } from '@playwright/test';
import { LOCAL, signIn } from './helpers';

/**
 * Lo que ve el estudiante, y lo que pasa con una actividad antigua.
 *
 * Dos comprobaciones que no puede hacer una prueba de integración: que el
 * runner sigue leyendo lo que escribe el constructor nuevo, y que la pantalla
 * docente no se le ofrece a quien no lo es.
 */

test('el estudiante ve la actividad y puede abrir su NexLab, sin opciones docentes', async ({
  page,
}) => {
  await signIn(page, LOCAL.student);

  await page.goto(`/aula/${LOCAL.courseId}`);
  await expect(page.getByRole('heading', { name: LOCAL.courseName, level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  // La actividad sembrada con un laboratorio. Se abre por su id y no
  // buscándola en «Tareas recientes»: el sandbox conserva lo que se crea entre
  // ejecuciones, así que esa lista no es estable y la prueba no va de eso.
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}`);
  await page.waitForLoadState('networkidle');

  // La ficha dice qué hay que hacer, con el nombre humano de la parte.
  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Trabajar en laboratorio — NexLab').first()).toBeVisible();

  // Y desde ahí entra a hacerla: su NexLab, no la plantilla.
  await page.getByRole('link', { name: /Empezar|Continuar|Ver o cambiar/ }).first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Tu NexLab').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Plantilla de la actividad')).toHaveCount(0);

  // …y NO ve nada de la pantalla docente.
  await expect(page.getByRole('link', { name: /Editar actividad|Editar tarea/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preparar NexLab' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publicar actividad' })).toHaveCount(0);
});

test('el estudiante no puede abrir el constructor por URL directa', async ({ page }) => {
  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.legacyAssignmentId}/editar`);

  /**
   * Se espera a que la pantalla DIGA que no, y sólo después se comprueba que no
   * hay formulario.
   *
   * El orden importa y costó un fallo real: afirmar primero la ausencia del
   * formulario pasa mientras la página todavía está cargando, así que la prueba
   * daba por bueno un caso que no había llegado a ocurrir. Cuando el servidor de
   * desarrollo tuvo la ruta ya compilada, el formulario apareció dentro del
   * plazo y se vio que el estudiante SÍ lo veía.
   */
  await expect(page.getByText('Esta pantalla es para el profesorado')).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByRole('heading', { name: 'Qué hará el estudiante' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publicar actividad' })).toHaveCount(0);
  await expect(page.locator('#activity-title')).toHaveCount(0);
});

test('una actividad del formato anterior se abre, se edita y se guarda igual', async ({ page }) => {
  await signIn(page, LOCAL.teacher);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.legacyAssignmentId}/editar`);

  await expect(page.locator('#activity-title')).not.toHaveValue('', { timeout: 30_000 });

  // Se representa con UNA parte, bajo la opción humana que le corresponde.
  await expect(page.getByText('Responder · Campos que tú defines').first()).toBeVisible();

  // Y la pantalla dice, en llano, que se guardará como lo que ya era.
  await expect(page.getByText('Se guardará en su forma sencilla de siempre.').first()).toBeVisible();

  const before = await page.locator('#activity-title').inputValue();
  const renamed = `${before.replace(/ \(rev \d+\)$/, '')} (rev ${Date.now() % 1000})`;
  await page.locator('#activity-title').fill(renamed);
  await page.getByRole('button', { name: 'Publicar actividad' }).click();
  await expect(page).toHaveURL(new RegExp(`/aula/${LOCAL.courseId}$`));

  // Al reabrirla sigue siendo la misma actividad, con sus campos.
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.legacyAssignmentId}/editar`);
  await expect(page.locator('#activity-title')).toHaveValue(renamed, { timeout: 30_000 });
  await expect(page.getByText('Responder · Campos que tú defines').first()).toBeVisible();
  await expect(
    page.getByText('Se guardará en su forma sencilla de siempre.').first()
  ).toBeVisible();
});
