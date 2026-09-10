'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { resolveRestoredSession, type SessionUser } from '@/lib/auth-session';
import { isFirebaseConfigured } from '@/lib/firebase/config';

export type { SessionUser };

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** true cuando no hay Firebase configurado y la sesión es simulada. */
  isDemo: boolean;
  /** Reintenta crear o leer el perfil. Devuelve false si sigue sin poder. */
  refreshProfile: () => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string) => Promise<void>;
  /** Envía el correo de recuperación. Devuelve false sólo si falló el envío. */
  sendPasswordReset: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_SESSION: SessionUser = {
  uid: 'demo-uid-christian',
  handle: 'christian',
  displayName: 'Christian González',
  avatarUrl: null,
  role: 'student',
};

const DEMO_KEY = 'uinexus-demo-session';

/**
 * Sesión de UINexus.
 *
 * Toda la conversación con Firebase Auth pasa por `lib/firebase/auth.ts`: este
 * componente decide QUÉ hacer con la sesión, no CÓMO hablar con Firebase. Así
 * hay un único sitio donde se traducen los errores y el bundle de
 * `firebase/auth` sólo lo descarga quien realmente inicia sesión.
 *
 * El perfil de Firestore se crea o sincroniza en el primer inicio de sesión
 * (`ensureUserProfile`), no al publicar: el handle es la identidad pública y
 * debe existir desde el minuto uno.
 *
 * ## La política institucional se aplica AQUÍ, no sólo al iniciar sesión
 *
 * Firebase persiste la sesión: al recargar la página, `onAuthStateChanged`
 * devuelve el usuario sin volver a pasar por `signInWithGoogle` ni por ningún
 * otro método. Por eso la comprobación del correo institucional vive en
 * `lib/auth-session.ts` y se ejecuta en CADA restauración, antes de crear el
 * perfil. Sin eso, una cuenta ajena que hubiera entrado una vez quedaría
 * restaurada para siempre como autenticada, con todas las llamadas al aula
 * respondiendo 403 y sin ninguna salida visible.
 *
 * El acceso por teléfono se retiró de la sesión: un número no demuestra
 * pertenencia a `@itdurango.edu.mx`, que es sobre lo que UINexus autoriza. Ver
 * CHECKPOINTS.md para cómo volvería, ya como segundo factor de una cuenta
 * institucional verificada.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDemo = !isFirebaseConfigured;

  const clearError = useCallback(() => setError(null), []);

  /**
   * Descarta una sesión que Firebase autenticó pero UINexus no admite.
   *
   * La sesión de Firebase ya se cerró en `resolveRestoredSession`; aquí sólo se
   * limpia el estado local y se lleva a `/login` con el motivo en la URL. La
   * comprobación de dónde estamos evita el bucle login → logout → login: si ya
   * se está en el formulario, no hay a dónde ir.
   */
  const rejectSession = useCallback(
    (outcome: { message: string; redirectTo: string }) => {
      setUser(null);
      setStatus('anonymous');
      setError(outcome.message);
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        router.replace(outcome.redirectTo);
      }
    },
    [router]
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    if (isDemo) {
      try {
        const stored = sessionStorage.getItem(DEMO_KEY);
        setUser(stored ? (JSON.parse(stored) as SessionUser) : null);
        setStatus(stored ? 'authenticated' : 'anonymous');
      } catch {
        setStatus('anonymous');
      }
      return;
    }

    void (async () => {
      const [{ getClientAuth }, { onAuthStateChanged }, { ensureUserProfile }, firebaseAuth] =
        await Promise.all([
          import('@/lib/firebase/client'),
          import('firebase/auth'),
          import('@/lib/firebase/profile'),
          import('@/lib/firebase/auth'),
        ]);

      const auth = getClientAuth();
      if (!auth) {
        if (active) setStatus('anonymous');
        return;
      }

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (!active) return;
        if (!firebaseUser) {
          setUser(null);
          setStatus('anonymous');
          return;
        }

        /**
         * AQUÍ está la segunda barrera, y la que de verdad cierra el fallo: una
         * sesión RESTAURADA no pasa por ningún método de login, así que si la
         * política no se aplicara en este punto no se aplicaría nunca. El correo
         * se comprueba antes de crear o leer el perfil (ver `auth-session.ts`).
         */
        const outcome = await resolveRestoredSession(firebaseUser, {
          ensureProfile: ensureUserProfile,
          signOut: firebaseAuth.signOut,
        });
        if (!active) return;

        if (outcome.kind === 'rejected') {
          rejectSession(outcome);
          return;
        }

        setUser(outcome.user);
        setStatus('authenticated');
      });
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isDemo, rejectSession]);

  /**
   * Reintento explicito de `ensureUserProfile`. Existe porque el perfil se crea
   * en una peticion que puede fallar, y cuando falla la sesion queda con handle
   * vacio: usable para explorar, incapaz de escribir. Sin una forma de
   * reintentar, la unica salida era cerrar sesion y volver a entrar.
   */
  const refreshProfile = useCallback(async (): Promise<boolean> => {
    if (isDemo) return true;
    const [{ getClientAuth }, { ensureUserProfile }, firebaseAuth] = await Promise.all([
      import('@/lib/firebase/client'),
      import('@/lib/firebase/profile'),
      import('@/lib/firebase/auth'),
    ]);
    const firebaseUser = getClientAuth()?.currentUser;
    if (!firebaseUser) return false;

    // El reintento pasa por la MISMA puerta: si no, sería un segundo camino
    // hacia `ensureUserProfile` sin comprobar el correo.
    const outcome = await resolveRestoredSession(firebaseUser, {
      ensureProfile: ensureUserProfile,
      signOut: firebaseAuth.signOut,
    });

    if (outcome.kind === 'rejected') {
      rejectSession(outcome);
      return false;
    }
    if (!outcome.user.handle) return false;

    setUser(outcome.user);
    return true;
  }, [isDemo, rejectSession]);

  const startDemoSession = useCallback(() => {
    setUser(DEMO_SESSION);
    setStatus('authenticated');
    try {
      sessionStorage.setItem(DEMO_KEY, JSON.stringify(DEMO_SESSION));
    } catch {
      /* sin almacenamiento: la sesión dura lo que la pestaña */
    }
  }, []);

  /** Ejecuta una operación de Auth traduciendo el error a lenguaje humano. */
  const run = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    setError(null);
    try {
      await operation();
      return true;
    } catch (caught) {
      const { authErrorMessage } = await import('@/lib/firebase/auth');
      setError(authErrorMessage(caught));
      return false;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (isDemo) {
      startDemoSession();
      return;
    }
    await run(async () => {
      const { signInWithGoogle: signIn } = await import('@/lib/firebase/auth');
      await signIn();
    });
  }, [isDemo, run, startDemoSession]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (isDemo) {
        startDemoSession();
        return;
      }
      await run(async () => {
        const { signInWithEmail: signIn } = await import('@/lib/firebase/auth');
        await signIn(email, password);
      });
    },
    [isDemo, run, startDemoSession]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, name: string) => {
      if (isDemo) {
        startDemoSession();
        return;
      }
      await run(async () => {
        const { registerWithEmail: register } = await import('@/lib/firebase/auth');
        await register(email, password, name);
      });
    },
    [isDemo, run, startDemoSession]
  );

  const sendPasswordReset = useCallback(
    async (email: string): Promise<boolean> => {
      if (isDemo) return true;
      return run(async () => {
        const { sendPasswordReset: reset } = await import('@/lib/firebase/auth');
        await reset(email, `${window.location.origin}/login`);
      });
    },
    [isDemo, run]
  );

  const signOut = useCallback(async () => {
    if (isDemo) {
      setUser(null);
      setStatus('anonymous');
      try {
        sessionStorage.removeItem(DEMO_KEY);
      } catch {
        /* ignorado */
      }
      return;
    }
    const { signOut: firebaseSignOut } = await import('@/lib/firebase/auth');
    await firebaseSignOut();
  }, [isDemo]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isDemo,
      refreshProfile,
      signInWithGoogle,
      signInWithEmail,
      registerWithEmail,
      sendPasswordReset,
      signOut,
      error,
      clearError,
    }),
    [
      status,
      user,
      isDemo,
      refreshProfile,
      signInWithGoogle,
      signInWithEmail,
      registerWithEmail,
      sendPasswordReset,
      signOut,
      error,
      clearError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return context;
}
