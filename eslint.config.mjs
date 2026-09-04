import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * Configuración de ESLint (flat config).
 *
 * `next lint` está deprecado y desaparece en Next.js 16, así que el script
 * `npm run lint` invoca directamente la CLI de ESLint. `FlatCompat` traduce la
 * configuración clásica de `eslint-config-next`, que todavía no publica una
 * versión plana.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'functions/lib/**',
      'functions/node_modules/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // El proyecto ya usa `import type` en todas partes; que un olvido sea un
      // error y no una advertencia mantiene la frontera cliente/servidor nítida.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Las variables descartadas al desestructurar se nombran con guión bajo
      // (ver lib/data/mappers.ts): es intencional, no código muerto.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // CloudFront Functions: no son codigo de la aplicacion. `handler` es el
    // punto de entrada que invoca CloudFront —nadie lo llama desde aqui— y el
    // runtime del borde no admite `catch {}` sin enlazar la excepcion.
    files: ['infra/origin/**/*.js'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
];

export default config;
