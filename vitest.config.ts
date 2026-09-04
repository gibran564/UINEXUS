import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Pruebas unitarias.
 *
 * Tras la migración a AWS ya no hay reglas de seguridad declarativas que
 * probar contra un emulador: la autorización es código de servidor. Lo que se
 * prueba aquí es la lógica pura y crítica —resolución de rutas del origen
 * aislado y atributos de visibilidad—, que no necesita nube.
 *
 * Lo que NO cubre está anotado en docs/LIMITATIONS.md: la autorización de las
 * rutas de API necesita pruebas de integración contra DynamoDB Local.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Ver tests/stubs/server-only.ts
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
