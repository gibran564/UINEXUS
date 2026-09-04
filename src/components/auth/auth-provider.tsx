'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { UserRole } from '@/lib/types';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import type { PhoneChallenge } from '@/lib/firebase/auth';

export interface SessionUser {
  uid: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
}

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
  /** Inicia el reto por SMS. Devuelve null si no se pudo enviar el código. */
  startPhoneSignIn: (
    phoneNumber: string,
    recaptchaContainerId: string
  ) => Promise<PhoneChallenge | null>;
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
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDemo = !isFirebaseConfigured;

  const clearError = useCallback(() => setError(null), []);

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
      const [{ getClientAuth }, { onAuthStateChanged }, { ensureUserProfile }] = await Promise.all([
        import('@/lib/firebase/client'),
        import('firebase/auth'),
        import('@/lib/firebase/profile'),
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

        const profile = await ensureUserProfile(firebaseUser);
        if (!active) return;

        setUser({
          uid: firebaseUser.uid,
          handle: profile.handle,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          role: profile.role,
        });
        setStatus('authenticated');
      });
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isDemo]);

  /**
   * Reintento explicito de `ensureUserProfile`. Existe porque el perfil se crea
   * en una peticion que puede fallar, y cuando falla la sesion queda con handle
   * vacio: usable para explorar, incapaz de escribir. Sin una forma de
   * reintentar, la unica salida era cerrar sesion y volver a entrar.
   */
  const refreshProfile = useCallback(async (): Promise<boolean> => {
    if (isDemo) return true;
    const [{ getClientAuth }, { ensureUserProfile }] = await Promise.all([
      import('@/lib/firebase/client'),
      import('@/lib/firebase/profile'),
    ]);
    const firebaseUser = getClientAuth()?.currentUser;
    if (!firebaseUser) return false;

    const profile = await ensureUserProfile(firebaseUser);
    if (!profile.handle) return false;

    setUser({
      uid: firebaseUser.uid,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
    });
    return true;
  }, [isDemo]);

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

  const startPhoneSignIn = useCallback(
    async (phoneNumber: string, recaptchaContainerId: string): Promise<PhoneChallenge | null> => {
      setError(null);

      if (isDemo) {
        return {
          confirm: async () => {
            startDemoSession();
            return null as never;
          },
          dispose: () => {},
        };
      }

      try {
        const {
          startPhoneSignIn: start,
          normalizePhoneNumber,
          isValidPhoneNumber,
        } = await import('@/lib/firebase/auth');

        const normalized = normalizePhoneNumber(phoneNumber);
        if (!isValidPhoneNumber(normalized)) {
          setError(
            'Ese número no parece válido. Escríbelo con código de país, por ejemplo +52 55 1234 5678.'
          );
          return null;
        }
        return await start(normalized, recaptchaContainerId);
      } catch (caught) {
        const { authErrorMessage } = await import('@/lib/firebase/auth');
        setError(authErrorMessage(caught));
        return null;
      }
    },
    [isDemo, startDemoSession]
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
      startPhoneSignIn,
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
      startPhoneSignIn,
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
