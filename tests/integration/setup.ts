import { afterEach, vi } from 'vitest';

// El runner fija estos valores antes de que Vitest cargue la aplicación. Este
// setup falla cerrado si alguien intenta ejecutar la config directamente.
if (!process.env.UINEXUS_DYNAMODB_ENDPOINT || !process.env.UINEXUS_TABLE_PREFIX) {
  throw new Error('Usa `npm run test:integration` para iniciar DynamoDB Local de forma segura.');
}

/**
 * Los correos son INSTITUCIONALES a propósito.
 *
 * `requireIdentity` aplica la política del ITD sobre `decoded.email` antes de
 * mirar el perfil, así que un token con un correo cualquiera ya no sirve para
 * ejercer ninguna ruta. Ese cambio es la corrección de esta iteración, y por eso
 * existe además `token-outsider-domain`: un token perfectamente válido para
 * Firebase cuyo correo no pertenece a la comunidad. Sirve para comprobar que la
 * API lo rechaza, que es justo lo que antes no ocurría.
 */
const authState = vi.hoisted(() => {
  const identities = new Map([
    ['token-teacher-a', { uid: 'uid-teacher-a', email: 'teacher.a@itdurango.edu.mx', email_verified: true }],
    ['token-teacher-b', { uid: 'uid-teacher-b', email: 'teacher.b@itdurango.edu.mx', email_verified: true }],
    ['token-student-a', { uid: 'uid-student-a', email: 'l21040001@itdurango.edu.mx', email_verified: true }],
    ['token-student-b', { uid: 'uid-student-b', email: 'l21040002@itdurango.edu.mx', email_verified: true }],
    [
      'token-student-outsider',
      { uid: 'uid-student-outsider', email: 'l21040003@itdurango.edu.mx', email_verified: true },
    ],
    // Cuenta autenticada por Firebase pero ajena a la institución.
    [
      'token-outsider-domain',
      { uid: 'uid-outsider-domain', email: 'cualquiera@gmail.com', email_verified: true },
    ],
    // Sesión sin correo: es lo que producía el acceso por teléfono.
    ['token-no-email', { uid: 'uid-no-email', email: undefined, email_verified: false }],
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
