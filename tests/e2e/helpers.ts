import { expect, type Page } from '@playwright/test';

/**
 * Lo que necesitan los cuatro recorridos, y nada más.
 *
 * Las credenciales son las del sandbox local (`scripts/lib/local-env.mjs`).
 * Están escritas aquí porque son públicas por diseño: sólo existen dentro del
 * emulador de Firebase del proyecto `demo-uinexus`, que Google no conoce.
 */

export const LOCAL = {
  teacher: { email: 'docente.sandbox@itdurango.edu.mx', password: 'sandbox-local' },
  student: { email: '20250001@itdurango.edu.mx', password: 'sandbox-local' },
  courseId: 'local-course-io',
  courseName: 'Investigación de Operaciones — Sandbox',
  legacyAssignmentId: 'local-assignment-legacy',
  labAssignmentId: 'local-assignment-ventas',
  /**
   * Las dos actividades cuyas entregas el seed borra en cada arranque.
   *
   * Sus recorridos dependen del punto de partida —una parte bloqueada, una
   * actividad sin empezar— así que cada una la usa UNA sola prueba. Ver
   * `RESETTABLE_ASSIGNMENTS` en `scripts/lib/local-seed.mjs`.
   */
  simpleAssignmentId: 'local-assignment-simple',
  processAssignmentId: 'local-assignment-proceso',
  /** Una sola parte que pide un programa, en un lenguaje sin ejecución. */
  codeAssignmentId: 'local-assignment-codigo',
} as const;

/**
 * Entra con correo y contraseña, como lo haría una persona.
 *
 * ## Por qué el envío va dentro de un `toPass`
 *
 * No es «reintentar hasta que pase». Es esperar una condición real que no se
 * puede observar de otra forma: hasta que React no ha hidratado la página, el
 * botón EXISTE, está visible y está habilitado —así que Playwright lo considera
 * listo— pero su `onSubmit` todavía no está enganchado. El clic entonces no
 * hace absolutamente nada, y la prueba se queda mirando un formulario relleno
 * durante todo el plazo.
 *
 * Contra `next dev`, que compila la ruta la primera vez que alguien la pide,
 * esa ventana se estira lo suficiente como para que ocurra de verdad: costó un
 * fallo intermitente en la suite responsive.
 *
 * Lo que se reintenta es el ENVÍO, no la comprobación: si las credenciales
 * fueran malas, el bucle agotaría su plazo y la prueba fallaría igual.
 */
export async function signIn(
  page: Page,
  who: { email: string; password: string }
): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(who.email);
  await page.locator('#password').fill(who.password);

  await expect(async () => {
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    // La sesión está lista cuando la navegación con sesión aparece; esperar por
    // la URL no basta porque Firebase restaura el estado después de la primera
    // pintura.
    await expect(page.getByRole('link', { name: 'Aula' }).first()).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000, intervals: [1_000] });
}

/** Un título distinto en cada ejecución: el sandbox no se resiembra entre pruebas. */
export function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
