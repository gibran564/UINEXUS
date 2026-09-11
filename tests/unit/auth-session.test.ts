import { describe, expect, it, vi } from 'vitest';
import { resolveRestoredSession } from '../../src/lib/auth-session';
import {
  ALLOWED_SPECIAL_EMAILS,
  INVALID_DOMAIN_REASON,
  LOGIN_INVALID_DOMAIN_PATH,
} from '../../src/lib/identity';

/**
 * La restauración de una sesión de Firebase.
 *
 * Éste es el fallo que la iteración vino a cerrar. La validación del dominio
 * vivía sólo en los métodos explícitos de login, pero Firebase PERSISTE la
 * sesión: al recargar la página, `onAuthStateChanged` devuelve el usuario sin
 * pasar por ninguno de ellos. Una cuenta ajena quedaba restaurada como
 * autenticada, con perfil creado y con todas las llamadas al aula respondiendo
 * 403 desde el otro lado.
 *
 * Lo que se afirma aquí no es sólo «se rechaza», es CUÁNDO: `ensureProfile` no
 * puede llegar a llamarse nunca con un correo no autorizado. Si se llamara,
 * quedaría un perfil en la base de datos de alguien que la plataforma no
 * reconoce.
 */

function harness(email: string | null) {
  const ensureProfile = vi.fn(async () => ({
    handle: 'christian',
    displayName: 'Christian González',
    avatarUrl: null,
    role: 'student' as const,
  }));
  const signOut = vi.fn(async () => {});

  return {
    ensureProfile,
    signOut,
    resolve: () =>
      resolveRestoredSession({ uid: 'uid-1', email }, { ensureProfile, signOut }),
  };
}

describe('sesión restaurada: quién entra', () => {
  it('un correo @itdurango.edu.mx entra y obtiene su perfil', async () => {
    const { resolve, ensureProfile, signOut } = harness('l21040123@itdurango.edu.mx');
    const outcome = await resolve();

    expect(outcome.kind).toBe('authenticated');
    if (outcome.kind === 'authenticated') {
      expect(outcome.user).toMatchObject({ uid: 'uid-1', handle: 'christian', role: 'student' });
    }
    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('un correo docente de la allowlist entra igual', async () => {
    // La allowlist no puede perderse por el camino: es la única forma de que
    // entre un docente cuyo correo no es del dominio.
    const [special] = ALLOWED_SPECIAL_EMAILS;
    const { resolve, ensureProfile } = harness(special!);

    expect((await resolve()).kind).toBe('authenticated');
    expect(ensureProfile).toHaveBeenCalledTimes(1);
  });

  it('acepta el correo institucional aunque venga con mayúsculas y espacios', async () => {
    const { resolve } = harness('  ALUMNO@ITDURANGO.EDU.MX ');
    expect((await resolve()).kind).toBe('authenticated');
  });
});

describe('sesión restaurada: quién NO entra', () => {
  it('un Gmail personal se rechaza', async () => {
    const { resolve } = harness('cualquiera@gmail.com');
    const outcome = await resolve();

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toBe(INVALID_DOMAIN_REASON);
      expect(outcome.redirectTo).toBe(LOGIN_INVALID_DOMAIN_PATH);
      expect(outcome.message).toContain('itdurango.edu.mx');
    }
  });

  it('NUNCA se crea el perfil de un correo no autorizado', async () => {
    // La invariante de fondo: si `ensureProfile` se llegara a llamar, quedaría
    // en la base de datos un usuario que la plataforma no reconoce.
    const { resolve, ensureProfile } = harness('cualquiera@gmail.com');
    await resolve();
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it('la sesión de Firebase se cierra al rechazarla', async () => {
    // Sin esto, la próxima recarga volvería a restaurar exactamente lo mismo:
    // un bucle silencioso de sesión inutilizable.
    const { resolve, signOut } = harness('cualquiera@gmail.com');
    await resolve();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('una sesión SIN correo se rechaza: es el caso del acceso por teléfono', async () => {
    // UINexus autoriza sobre el correo institucional. Un teléfono no puede
    // demostrarlo, así que una sesión sin correo no es una sesión académica.
    const { resolve, ensureProfile, signOut } = harness(null);
    const outcome = await resolve();

    expect(outcome.kind).toBe('rejected');
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('rechaza dominios parecidos al institucional', async () => {
    for (const email of [
      'alguien@itdurango.edu',
      'alguien@itdurango.mx',
      'alguien@no-itdurango.edu.mx.attacker.com',
    ]) {
      const { resolve } = harness(email);
      expect((await resolve()).kind).toBe('rejected');
    }
  });

  it('el rechazo no lanza aunque falle cerrar la sesión de Firebase', async () => {
    // Si el rechazo se convirtiera en una excepción, el proveedor se quedaría
    // sin decidir nada y la sesión quedaría a medias: ni autenticada ni cerrada.
    const ensureProfile = vi.fn();
    const signOut = vi.fn(async () => {
      throw new Error('sin red');
    });

    const outcome = await resolveRestoredSession(
      { uid: 'uid-1', email: 'ajeno@gmail.com' },
      { ensureProfile, signOut }
    );

    expect(outcome.kind).toBe('rejected');
    expect(ensureProfile).not.toHaveBeenCalled();
  });
});
