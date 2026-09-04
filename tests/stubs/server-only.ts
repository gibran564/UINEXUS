/**
 * `server-only` sólo existe para que el empaquetador falle si un módulo de
 * servidor acaba importado desde el navegador. En las pruebas no hay
 * empaquetador, así que se sustituye por un módulo vacío.
 */
export {};
