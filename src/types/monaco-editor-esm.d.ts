/**
 * Los tipos de la entrada ESM de Monaco.
 *
 * `monaco-editor` declara tipos para su raíz pero no para `editor/editor.main`,
 * que es la subruta que hay que importar para que webpack empaquete la versión
 * ESM en vez del paquete AMD de `min/` (ver `components/aula/code-editor.tsx`).
 * El módulo es el mismo: reexporta la misma API que la raíz, así que se declara
 * con los tipos de la raíz en lugar de dejarlo en `any`.
 */
declare module 'monaco-editor/editor/editor.main.js' {
  export * from 'monaco-editor';
}
