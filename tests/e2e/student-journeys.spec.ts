import { expect, test, type Page } from '@playwright/test';
import { LOCAL, signIn } from './helpers';

/**
 * Los recorridos del estudiante, con sesión real.
 *
 * Cada prueba usa SU actividad sembrada y no la de otra: el sandbox conserva lo
 * que se escribe entre ejecuciones, y dos pruebas sobre la misma actividad
 * dejarían a la segunda mirando el estado que dejó la primera. Las dos
 * actividades cuyo punto de partida importa —una sin empezar, una con la Parte
 * 2 bloqueada— tienen sus entregas borradas al sembrar; ver
 * `RESETTABLE_ASSIGNMENTS` en `scripts/lib/local-seed.mjs`.
 *
 * No se ejecuta Python en ninguna: la interoperabilidad de datos ya tiene su
 * propia cobertura y arrancar un runtime aquí haría la suite frágil sin probar
 * nada nuevo sobre la experiencia.
 */

/** Un sello distinto en cada ejecución, para no confundirse con la anterior. */
const stamp = (): string => Date.now().toString(36);

/** Lo que se lee en pantalla, sin atributos ni clases. */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).toLowerCase();
}

// ---------------------------------------------------------------------------
// A · Una actividad sencilla
// ---------------------------------------------------------------------------

test('una actividad sencilla se entiende, se guarda y se entrega', async ({ page }) => {
  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.simpleAssignmentId}`);

  // Lo primero que se ve dice qué es, de quién y para cuándo.
  await expect(
    page.getByRole('heading', { name: 'Tres conclusiones sobre el método símplex', level: 1 })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(LOCAL.courseName).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible();
  await expect(page.getByText('Sin empezar').first()).toBeVisible();

  // Y no aparece una sola palabra del modelo.
  const ficha = await visibleText(page);
  for (const palabra of ['workflow', 'deliverable', 'actiontype', 'stepid', 'snapshot']) {
    expect(ficha).not.toContain(palabra);
  }

  await page.getByRole('link', { name: 'Empezar' }).click();
  await page.waitForLoadState('networkidle');

  const respuesta = page.getByRole('textbox', { name: 'Tu respuesta' });
  await respuesta.fill(`Tres conclusiones ${stamp()}.`);

  // Guardar NO entrega, y se dice.
  await page.getByRole('button', { name: 'Guardar y seguir después' }).click();
  await expect(page.getByText('Sólo lo ves tú')).toBeVisible();

  // Entregar es otro botón, y pide confirmación antes de congelar nada.
  await page.getByRole('button', { name: 'Entregar actividad' }).click();
  await expect(page.getByText('¿Entregar esta actividad?')).toBeVisible();
  await page.getByRole('button', { name: 'Sí, entregar' }).click();

  // Y la confirmación es una pantalla, no un mensaje que se desvanece.
  await expect(page).toHaveURL(
    new RegExp(`/tareas/${LOCAL.simpleAssignmentId}$`)
  );
  await expect(page.getByRole('heading', { name: 'Actividad entregada' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Entregaste el/)).toBeVisible();
  await expect(page.getByText('Qué puedes hacer ahora')).toBeVisible();
});

// ---------------------------------------------------------------------------
// B · Una actividad por partes con UNA sola parte, de laboratorio
//     (más reanudación y copia entregada)
// ---------------------------------------------------------------------------

/**
 * Los dos lados del mismo recorrido, en dos pruebas.
 *
 * Se parten porque son dos personas: reutilizar la misma pestaña para entrar
 * como docente después de haber trabajado como estudiante deja una sesión a
 * medio cambiar, y lo que se quiere comprobar —que lo entregado no cambió— no
 * tiene nada que ver con eso. `serial` mantiene el orden y evita ejecutar la
 * comprobación docente si el trabajo del estudiante no llegó a existir.
 */
const MARCA = `ENTREGADO-${stamp()}`;
const DESPUES = `DESPUES-${stamp()}`;

test.describe.serial('un laboratorio de una sola parte', () => {
test('se hace, sobrevive a una recarga y se entrega', async ({ page }) => {
  const marca = MARCA;

  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}`);

  // Una sola parte, y es de laboratorio. Éste es el caso que la fase anterior
  // rompió al decidir el recorrido contando partes.
  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Trabajar en laboratorio — NexLab').first()).toBeVisible();

  await page.getByRole('link', { name: /Empezar|Continuar|Ver o cambiar/ }).click();
  await page.waitForLoadState('networkidle');

  // El laboratorio se abre DENTRO de la actividad, no en otra aplicación.
  await expect(page.getByText('Tu NexLab').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Plantilla de la actividad')).toHaveCount(0);

  // Un bloque nuevo nace en modo lectura: se escribe pulsando «Editar», que es
  // el camino con teclado. El bloque se añade al final, de ahí el `last()`.
  await page.getByRole('button', { name: '+ Texto' }).first().click();
  await page.getByRole('button', { name: 'Editar' }).last().click();
  const bloque = page.getByRole('textbox', { name: /en Markdown/ }).last();
  await bloque.fill(marca);
  await bloque.blur();
  await expect(page.getByText('Guardado').first()).toBeVisible({ timeout: 30_000 });

  // Reanudar: se cierra y se vuelve. El trabajo sigue ahí y el progreso también.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(marca).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Completada').first()).toBeVisible();

  await page.getByRole('button', { name: 'Entregar actividad' }).click();
  await page.getByRole('button', { name: 'Sí, entregar' }).click();
  await expect(page.getByRole('heading', { name: 'Actividad entregada' })).toBeVisible({
    timeout: 60_000,
  });

  /**
   * Y ahora lo que da sentido a que la entrega guarde una COPIA: se sigue
   * trabajando en el laboratorio, que es de quien lo hizo, y lo entregado no se
   * mueve.
   */
  await page.getByRole('link', { name: /Ver o cambiar/ }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Tu NexLab').first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Editar' }).last().click();
  const texto = page.getByRole('textbox', { name: /en Markdown/ }).last();
  await texto.fill(DESPUES);
  await texto.blur();
  await expect(page.getByText('Guardado').first()).toBeVisible({ timeout: 30_000 });
});

test('y lo que la docente abre sigue siendo lo que se entregó', async ({ page }) => {
  await signIn(page, LOCAL.teacher);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.labAssignmentId}`);

  await page.getByRole('tab', { name: 'Entregas' }).click();
  await page.getByRole('button', { name: 'Abrir' }).first().click();

  await expect(page.getByText(MARCA).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DESPUES)).toHaveCount(0);
});
});

// ---------------------------------------------------------------------------
// B bis · Una sola parte de NexCode, en un lenguaje que no se ejecuta aquí
// ---------------------------------------------------------------------------

test('una actividad de una sola parte de NexCode se abre, y dice qué se puede y qué no', async ({
  page,
}) => {
  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.codeAssignmentId}`);

  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Programar — NexCode').first()).toBeVisible();

  await page.getByRole('link', { name: /Empezar|Continuar|Ver o cambiar/ }).click();
  await page.waitForLoadState('networkidle');

  // El lenguaje se dice, y el código inicial de la docente ya está puesto.
  await expect(page.getByText(/Esta entrega es en/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Java').first()).toBeVisible();

  /**
   * Y lo que no se puede, se dice. La actividad pide ejecución y Java no se
   * ejecuta en el navegador: en vez de un botón muerto, una explicación.
   */
  await expect(page.getByText('Ejecución no disponible')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Guardar y entregar funciona con normalidad/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Ejecutar/ })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// C + D · Varias partes: dependencia y conclusión obligatoria
// ---------------------------------------------------------------------------

test('en una actividad de varias partes, una parte se desbloquea y otra exige su conclusión', async ({
  page,
}) => {
  await signIn(page, LOCAL.student);
  await page.goto(`/aula/${LOCAL.courseId}/tareas/${LOCAL.processAssignmentId}`);

  await expect(page.getByRole('heading', { name: 'Tu trabajo' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('0 de 3 partes completadas')).toBeVisible();

  // La Parte 2 empieza bloqueada, y se dice POR QUÉ y con qué nombre.
  await expect(page.getByText('Bloqueada').first()).toBeVisible();
  await expect(page.getByText(/Completa primero:/).first()).toBeVisible();
  await expect(page.getByText(/«Preparar los datos»/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Empezar' }).click();
  await page.waitForLoadState('networkidle');

  // Parte 1.
  await expect(page.getByRole('heading', { name: 'Preparar los datos', level: 2 })).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole('textbox', { name: 'Tu respuesta' })
    .fill('Comparo el método símplex con el gráfico.');
  await page.getByRole('button', { name: 'Guardar y seguir después' }).click();
  await expect(page.getByText('Sólo lo ves tú')).toBeVisible();

  // La Parte 2 ya no está bloqueada: se puede abrir.
  await page.getByRole('button', { name: /Registrar uso de IA/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Registrar uso de IA', level: 2 })).toBeVisible();

  // Se rellena el registro… y se deja la conclusión sin escribir.
  await page.getByRole('textbox', { name: 'Objetivo' }).fill('Comparar los dos métodos.');
  await page.getByRole('textbox', { name: 'Prompt utilizado' }).fill('Compara símplex y gráfico.');
  await expect(page.getByText('Tu conclusión (requerida)')).toBeVisible();

  // Parte 3, para que lo único que falte sea la conclusión.
  await page.getByRole('button', { name: /Escribir tu conclusión/ }).first().click();
  await page
    .getByRole('textbox', { name: 'Tu respuesta' })
    .fill('Me quedo con el símplex por escala.');

  // El bloqueo se explica: qué parte, qué falta y cómo llegar.
  await expect(page.getByRole('heading', { name: 'Todavía falta' })).toBeVisible();
  await expect(
    page.getByText('Falta tu conclusión sobre el uso de IA. Esta actividad la pide.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entregar actividad' })).toBeDisabled();

  // Y desde ahí se va a la parte que falta.
  await page.getByRole('button', { name: 'Ir a esta parte' }).click();
  await page
    .getByRole('textbox', { name: 'Tu conclusión (requerida)' })
    .fill('La IA se equivocó en el segundo caso; el símplex escala mejor.');

  await expect(page.getByText('Todas tus partes están completas')).toBeVisible();

  /**
   * Se espera a que el botón se habilite ANTES de pulsarlo.
   *
   * No cambia lo que se prueba —`click()` ya espera a que esté habilitado—,
   * cambia lo que se lee cuando falla. El botón está
   * `disabled={busy || closed || missing.length > 0}`, y con las partes
   * completas lo único que queda es `busy`: un autoguardado en vuelo. Las
   * partes de texto y de IA no tienen indicador visible de guardado —sólo lo
   * tienen los entregables de código—, así que no hay otra señal que esperar.
   *
   * Con la máquina cargada ese guardado se estira, y entonces `click()` agotaba
   * los 180 s del plazo y reportaba «locator.click: Test timeout», que no dice
   * nada. Así falla diciendo que el botón siguió deshabilitado, que es el dato.
   */
  await expect(page.getByRole('button', { name: 'Entregar actividad' })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Entregar actividad' }).click();
  await page.getByRole('button', { name: 'Sí, entregar' }).click();

  await expect(page.getByRole('heading', { name: 'Actividad entregada' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('3 de 3 partes completadas')).toBeVisible();
});
