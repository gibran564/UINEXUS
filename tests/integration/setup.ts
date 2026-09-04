import { afterEach, vi } from 'vitest';

// El runner fija estos valores antes de que Vitest cargue la aplicación. Este
// setup falla cerrado si alguien intenta ejecutar la config directamente.
if (!process.env.UINEXUS_DYNAMODB_ENDPOINT || !process.env.UINEXUS_TABLE_PREFIX) {
  throw new Error('Usa `npm run test:integration` para iniciar DynamoDB Local de forma segura.');
}

const authState = vi.hoisted(() => {
  const identities = new Map([
    ['token-teacher-a', { uid: 'uid-teacher-a', email: 'teacher-a@example.test', email_verified: true }],
    ['token-teacher-b', { uid: 'uid-teacher-b', email: 'teacher-b@example.test', email_verified: true }],
    ['token-student-a', { uid: 'uid-student-a', email: 'student-a@example.test', email_verified: true }],
    ['token-student-b', { uid: 'uid-student-b', email: 'student-b@example.test', email_verified: true }],
    [
      'token-student-outsider',
      { uid: 'uid-student-outsider', email: 'student-outsider@example.test', email_verified: true },
    ],
  ]);

  return {
    verifyIdToken: vi.fn(async (token: string, checkRevoked?: boolean) => {
      if (checkRevoked !== true) throw new Error('La ruta debe comprobar tokens revocados.');
      const identity = identities.get(token);
      if (!identity) throw new Error('Token de integración inválido.');
      return identity;
    }),
  };
});

// Sólo se sustituye la frontera criptográfica externa. El bearer token, el
// perfil/rol en DynamoDB, el acceso a la materia y las rutas permanecen reales.
vi.mock('@/lib/firebase/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminAuth: () => ({ verifyIdToken: authState.verifyIdToken }),
  isAdminConfigured: () => true,
}));

afterEach(() => {
  authState.verifyIdToken.mockClear();
});
