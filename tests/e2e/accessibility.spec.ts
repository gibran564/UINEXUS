import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LOCAL, signIn } from './helpers';

/**
 * Accesibilidad medida, no prometida.
 *
 * ## Qué comprueba axe y qué no
 *
 * Axe encuentra lo que se puede decidir mirando el DOM: contraste insuficiente,
 * un control sin nombre, un `aria-*` que no corresponde a su papel, una
 * jerarquía de encabezados rota. No puede decir si el orden de tabulación tiene
 * sentido ni si un mensaje de error se entiende. Esas dos cosas se comprueban
 * abajo, a mano y con el teclado.
 *
 * Por eso esto NO es «cero incidencias de una herramienta» como objetivo: es
 * una red que atrapa las regresiones evidentes, y el criterio sigue siendo
 * humano.
 *
 * ## Las reglas que se piden
 *
 * Las etiquetas WCAG 2.1 A y AA, que son las que este proyecto dice cumplir.
 * Se dejan fuera las reglas «best-practice» de axe: son recomendaciones, no
 * criterios, y mezclarlas convierte el resultado en una lista de opiniones.
 */

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.html.slice(0, 120)),
  }));
}

/** Falla diciendo QUÉ hay que arreglar, no sólo que algo falla. */
function expectClean(found: Awaited<ReturnType<typeof violations>>, label: string): void {
  expect(
    found,
    `${label}: ${found.map((item) => `${item.id} (${item.impact}) — ${item.help} · ${item.nodes.join(' | ')}`).join('\n')}`
  ).toEqual([]);
}

test.describe('las pantallas principales pasan axe', () => {
  test('las públicas', async ({ page }) => {
    for (const [label, path] of [
      ['landing', '/'],
      ['iniciar sesión', '/login'],
      ['crear cuenta', '/register'],
      ['acerca de', '/about'],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expectClean(await violations(page), label);
    }
  });

  test('las del estudiante', async ({ page }) => {
    await signIn(page, LOCAL.student);
    for (const [label, path] of [
      ['aula', '/aula'],
      ['materia', `/aula/${LOCAL.courseId}`],
      ['ficha de actividad', `/aula/${LOCAL.courseId}/tareas/${LOCAL.processAssignmentId}`],
      ['mi trabajo', `/aula/${LOCAL.courseId}/tareas/${LOCAL.processAssignmentId}/entrega`],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expectClean(await violations(page), label);
    }
  });

  test('el creador docente', async ({ page }) => {
    await signIn(page, LOCAL.teacher);
    await page.goto(`/aula/${LOCAL.courseId}/tareas/nueva`);
    await page.waitForLoadState('networkidle');
    expectClean(await violations(page), 'creador');
  });

  test('el laboratorio', async ({ page }) => {
    await signIn(page, LOCAL.student);
    await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}/entrega`);
    await expect(page.getByText('Tu NexLab').first()).toBeVisible({ timeout: 60_000 });
    expectClean(await violations(page), 'NexLab');
  });
});

/**
 * Lo que axe no puede ver: que se pueda trabajar sin ratón.
 *
 * Se recorre una actividad entera con teclado —tabular hasta la Parte, abrirla
 * con Enter, escribir, y llegar al botón de entregar—. Si alguna vez aparece una
 * trampa de foco o un control que sólo responde al clic, esto lo encuentra.
 */
test('una actividad se puede hacer sin tocar el ratón', async ({ page }) => {
  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.simpleAssignmentId}`);
  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible({ timeout: 60_000 });

  // Del principio de la página hasta el enlace que abre el trabajo, tabulando.
  const cta = page.getByRole('link', { name: /Empezar|Continuar|Ver o cambiar/ });
  await expect(cta).toBeVisible();

  let reached = false;
  for (let step = 0; step < 40 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await cta.evaluate((element) => element === document.activeElement);
  }
  expect(reached, 'No se llegó al botón de empezar tabulando').toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');

  // El campo de respuesta también se alcanza con teclado, y se escribe en él.
  const answer = page.getByRole('textbox', { name: 'Tu respuesta' });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await answer.focus();
  await page.keyboard.type('Escrito sin ratón.');
  await expect(answer).toHaveValue('Escrito sin ratón.');

  // Y el foco se ve. Un anillo de foco invisible es lo mismo que no tenerlo.
  const outline = await answer.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`;
  });
  expect(outline).not.toBe('none 0px none');
});

/**
 * El foco entra en el diálogo y vuelve al salir.
 *
 * Es la mitad de la accesibilidad de un modal que ninguna herramienta
 * automática comprueba: que quien lo abre con teclado no se quede fuera, y que
 * al cerrarlo no acabe al principio de la página.
 */
test('el diálogo del laboratorio recibe el foco y lo devuelve', async ({ page }) => {
  await signIn(page, LOCAL.teacher);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/nueva`);

  await page.locator('#activity-title').fill('Laboratorio accesible');
  await page.getByRole('button', { name: /Trabajar en laboratorio — NexLab/ }).first().click();

  const open = page.getByRole('button', { name: 'Preparar NexLab' });
  await open.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  // El foco está DENTRO del diálogo, no en la página de detrás.
  const inside = await page.evaluate(() => {
    const element = document.activeElement;
    return Boolean(element?.closest('[role="dialog"]'));
  });
  expect(inside, 'El foco se quedó fuera del diálogo').toBe(true);

  // Escape cierra: es lo que espera cualquiera que abra algo encima.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
