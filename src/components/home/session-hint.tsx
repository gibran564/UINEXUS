/**
 * La pista de sesión.
 *
 * Una marca en `localStorage` que dice «la última vez que este navegador estuvo
 * aquí, había sesión iniciada». Sirve para UNA sola cosa: ocultar la portada
 * pública antes de la primera pintura para quien va a ver su Inicio.
 *
 * ## Lo que NO es
 *
 * No es una credencial y no autoriza nada. La sesión real sigue siendo el ID
 * token de Firebase, y todo lo que hay detrás de `/api/*` la exige. Quien
 * escriba esta marca a mano no obtiene datos: obtiene un marcador de carga y,
 * un instante después, la portada. Por eso puede vivir en el navegador sin más
 * ceremonia.
 */

const KEY = 'uinexus-session';

export function rememberSession(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem(KEY, 'in');
      document.documentElement.dataset.session = 'in';
    } else {
      localStorage.removeItem(KEY);
      delete document.documentElement.dataset.session;
    }
  } catch {
    /* sin almacenamiento: se ve la portada un instante y no pasa nada */
  }
}

/**
 * Oculta la portada antes de la primera pintura cuando había sesión.
 *
 * Se ejecuta síncrono en `<head>`, con la misma técnica que el script del tema
 * y por el mismo motivo: sin él, el reparto sólo puede ocurrir después de
 * hidratar, y eso son unos cientos de milisegundos de escaparate para quien
 * venía a ver sus tareas.
 */
const script = `(function(){
  try {
    if (localStorage.getItem('${KEY}') === 'in') {
      document.documentElement.dataset.session = 'in';
    }
  } catch (error) {
    /* sin almacenamiento: la portada aparece un instante */
  }
})();`;

export function SessionScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
