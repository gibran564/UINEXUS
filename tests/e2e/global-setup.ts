import type { FullConfig } from '@playwright/test';

/**
 * Calienta las rutas antes de la primera prueba.
 *
 * `npm run dev:local` levanta `next dev`, que compila cada ruta LA PRIMERA VEZ
 * que alguien la pide. Sin esto, la primera prueba paga la compilación de
 * `/login`, `/aula`, `/aula/[courseId]` y el constructor —decenas de segundos en
 * total— y falla por tiempo aunque el producto esté bien. Es ruido de entorno,
 * no un defecto que merezca un `retry`.
 *
 * No autentica nada: pedir la ruta basta para que Next la compile. Las que
 * necesitan sesión responden su versión pública o un 401, y da igual: lo que
 * interesa es que el bundle quede hecho.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;

  const routes = [
    '/',
    '/login',
    '/aula',
    '/aula/local-course-io',
    '/aula/local-course-io/tareas/nueva',
    '/aula/local-course-io/tareas/local-assignment-legacy/editar',
    '/aula/local-course-io/tareas/local-assignment-ventas',
    '/aula/local-course-io/tareas/local-assignment-ventas/entrega',
  ];

  for (const route of routes) {
    try {
      // 120 s por ruta: compilar el constructor con Monaco en frío no es rápido.
      await fetch(new URL(route, baseURL), { signal: AbortSignal.timeout(120_000) });
    } catch {
      // Una ruta que no responde no debe impedir la suite: si de verdad está
      // rota, la prueba que la use lo dirá con su propio mensaje.
    }
  }
}
