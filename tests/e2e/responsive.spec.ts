import { expect, test, type Page } from '@playwright/test';
import { LOCAL, signIn } from './helpers';

/**
 * Que ninguna pantalla empuje el documento a lo ancho.
 *
 * ## Qué se mide y por qué ésta y no una captura
 *
 * `scrollWidth <= innerWidth` en el elemento raíz. Es una sola pregunta, se
 * responde igual en ocho anchos, y falla exactamente cuando algo desborda —que
 * es lo que se quiere impedir—. Una comparación de capturas fallaría también
 * cada vez que cambie una sombra.
 *
 * ## Lo que NO cuenta como desbordamiento
 *
 * Un editor de código, una hoja de cálculo o una tabla ancha necesitan scroll
 * horizontal. Lo que no pueden es llevárselo el documento entero: su scroll
 * tiene que quedarse dentro del componente. Por eso se mide el documento y no
 * cada caja.
 *
 * ## Por qué en serie y con las dos sesiones
 *
 * La mitad de las pantallas de Nextudio no existe sin sesión. Comprobar sólo
 * las públicas dejaría fuera justo donde vive el producto.
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
] as const;

const PUBLIC_ROUTES = [
  ['landing', '/'],
  ['acerca de', '/about'],
  ['iniciar sesión', '/login'],
  ['crear cuenta', '/register'],
  ['explorar', '/explore'],
  ['materias', '/courses'],
] as const;

const STUDENT_ROUTES = [
  ['aula', `/aula`],
  ['materia', `/aula/${LOCAL.courseId}`],
  ['ficha de actividad', `/aula/${LOCAL.courseId}/tareas/${LOCAL.processAssignmentId}`],
  ['mi trabajo', `/aula/${LOCAL.courseId}/tareas/${LOCAL.processAssignmentId}/entrega`],
  ['laboratorio', `/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}/entrega`],
  ['programa', `/aula/${LOCAL.courseId}/tareas/${LOCAL.codeAssignmentId}/entrega`],
  ['espacios', '/practicas'],
] as const;

const TEACHER_ROUTES = [
  ['creador', `/aula/${LOCAL.courseId}/tareas/nueva`],
  ['revisión docente', `/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}`],
  ['editar actividad', `/aula/${LOCAL.courseId}/tareas/${LOCAL.legacyAssignmentId}/editar`],
] as const;

/** Quién desborda, para que el fallo diga qué arreglar y no sólo que falla. */
async function overflowReport(
  page: Page
): Promise<{ scrollWidth: number; innerWidth: number; offenders: string[] }> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > width + 0.5)
      .slice(0, 4)
      .map((element) => {
        const name = typeof element.className === 'string' ? element.className.slice(0, 60) : '';
        return `${element.tagName}.${name} → ${Math.round(element.getBoundingClientRect().right)}px`;
      });

    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: width,
      offenders,
    };
  });
}

/**
 * Se abre la pantalla UNA vez y después sólo se cambia el ancho.
 *
 * Volver a navegar en cada uno de los ocho anchos multiplicaba por ocho el
 * trabajo —y en una pantalla con laboratorio eso agotaba el plazo de la
 * prueba—. Cambiar el tamaño es además lo que de verdad pasa cuando alguien
 * gira el teléfono: el navegador vuelve a maquetar con el CSS que ya tiene, que
 * es exactamente lo que se está midiendo.
 */
async function assertNoOverflow(page: Page, label: string, path: string): Promise<void> {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // El contenido del aula llega por API después de la primera pintura; medir
  // antes daría una pantalla vacía por buena.
  await page.waitForTimeout(500);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);

    const report = await overflowReport(page);
    expect(
      report.scrollWidth,
      `${label} a ${viewport.width}px desborda ${report.scrollWidth - report.innerWidth}px. ` +
        (report.offenders.length > 0 ? `Culpables: ${report.offenders.join(' · ')}` : '')
    ).toBeLessThanOrEqual(report.innerWidth);
  }
}

test.describe('ninguna pantalla desborda a lo ancho', () => {
  test('las pantallas públicas', async ({ page }) => {
    for (const [label, path] of PUBLIC_ROUTES) {
      await assertNoOverflow(page, label, path);
    }
  });

  test('las pantallas del estudiante', async ({ page }) => {
    await signIn(page, LOCAL.student);
    for (const [label, path] of STUDENT_ROUTES) {
      await assertNoOverflow(page, label, path);
    }
  });

  test('las pantallas del profesorado', async ({ page }) => {
    await signIn(page, LOCAL.teacher);
    for (const [label, path] of TEACHER_ROUTES) {
      await assertNoOverflow(page, label, path);
    }
  });

  test('el menú de móvil abierto tampoco', async ({ page }) => {
    // Un menú desplegable es contenido nuevo encima de la barra, y es donde más
    // fácil se cuela un ancho fijo.
    await signIn(page, LOCAL.student);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/aula/${LOCAL.courseId}`);
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await expect(page.getByRole('navigation', { name: /móvil/ })).toBeVisible();

    const report = await overflowReport(page);
    expect(report.scrollWidth, `El menú desborda. ${report.offenders.join(' · ')}`).toBeLessThanOrEqual(
      report.innerWidth
    );
  });
});
