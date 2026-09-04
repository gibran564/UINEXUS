import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Suite separada: necesita un proceso de DynamoDB Local levantado por
 * `scripts/run-integration-tests.mjs`. La configuración unitaria nunca carga
 * este setup ni sustituye Firebase Admin.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/integration/setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
