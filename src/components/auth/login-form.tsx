'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getRoleFromInstitutionalEmail, isInstitutionalEmail } from '@/lib/identity';
import type { PhoneChallenge } from '@/lib/firebase/auth';
import { useAuth } from './auth-provider';

type Mode = 'signin' | 'signup' | 'reset' | 'phone';

/** Contenedor del reCAPTCHA invisible que Firebase exige antes de enviar un SMS. */
const RECAPTCHA_ID = 'uinexus-recaptcha';

/**
 * Entrada a la plataforma.
 *
 * Deliberadamente corta: Google primero (es lo que ya tiene todo el mundo con
 * el correo institucional) y correo como alternativa. El teléfono y la
 * recuperación de contraseña están un clic más adentro para no convertir la
 * pantalla en un muro de opciones. Nunca se pide iniciar sesión para explorar.
 */
interface LoginFormProps {
  initialMode?: Mode;
}

export function LoginForm({ initialMode = 'signin' }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    status,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    startPhoneSignIn,
    error,
    clearError,
    isDemo,
  } = useAuth();

  const queryMode = searchParams.get('mode') as Mode | null;
  const [mode, setMode] = useState<Mode>(
    queryMode && ['signin', 'signup', 'reset', 'phone'].includes(queryMode)
      ? queryMode
      : initialMode
  );
  const [emailInput, setEmailInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmedEmail = emailInput.trim();
  const isInstitutional = isInstitutionalEmail(trimmedEmail);
  const detectedRole = isInstitutional
    ? getRoleFromInstitutionalEmail(trimmedEmail)
    : trimmedEmail.length >= 3 && !trimmedEmail.includes('@')
      ? getRoleFromInstitutionalEmail(trimmedEmail)
      : null;

  // Teléfono: primero el número, después el código de seis dígitos.
  const [phoneStep, setPhoneStep] = useState<'number' | 'code'>('number');
  const challengeRef = useRef<PhoneChallenge | null>(null);

  const requestedNext = searchParams.get('next');
  const next =
    requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/dashboard';

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  // El widget de reCAPTCHA sobrevive al desmontaje si no se libera a mano.
  useEffect(() => () => challengeRef.current?.dispose(), []);

  function switchMode(nextMode: Mode): void {
    challengeRef.current?.dispose();
    challengeRef.current = null;
    setPhoneStep('number');
    setNotice(null);
    setLocalError(null);
    clearError();
    setMode(nextMode);
  }

  async function onGoogleClick(): Promise<void> {
    setNotice(null);
    setLocalError(null);
    clearError();
    await signInWithGoogle();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setNotice(null);
    setLocalError(null);
    clearError();

    const rawEmail = String(data.get('email') ?? '').trim();

    if (mode !== 'phone') {
      if (!rawEmail) {
        setLocalError('Ingresa tu correo institucional.');
        return;
      }
      if (!isInstitutionalEmail(rawEmail)) {
        setLocalError('El correo debe pertenecer al dominio institucional (@itdurango.edu.mx) o ser un docente autorizado.');
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === 'reset') {
        await sendPasswordReset(rawEmail);
        setNotice(
          'Si ese correo tiene una cuenta, le acaba de llegar un enlace para crear una contraseña nueva. Revisa también el correo no deseado.'
        );
        return;
      }

      if (mode === 'phone') {
        if (phoneStep === 'number') {
          const challenge = await startPhoneSignIn(
            String(data.get('phone') ?? ''),
            RECAPTCHA_ID
          );
          if (challenge) {
            challengeRef.current = challenge;
            setPhoneStep('code');
            setNotice('Te enviamos un código por SMS. Puede tardar un minuto.');
          }
          return;
        }

        const challenge = challengeRef.current;
        if (!challenge) return;
        try {
          await challenge.confirm(String(data.get('code') ?? ''));
        } catch {
          setNotice('Ese código no es correcto o ya caducó. Pide uno nuevo.');
        }
        return;
      }

      if (mode === 'signup') {
        await registerWithEmail(
          rawEmail,
          String(data.get('password') ?? ''),
          String(data.get('name') ?? '')
        );
      } else {
        await signInWithEmail(
          rawEmail,
          String(data.get('password') ?? '')
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'signup'
      ? 'Crea tu cuenta institucional'
      : mode === 'reset'
        ? 'Recupera tu contraseña'
        : mode === 'phone'
          ? 'Entra con tu teléfono'
          : 'Entra a UINexus';

  const subheading =
    mode === 'signup'
      ? 'Regístrate con tu correo @itdurango.edu.mx para publicar y alojar tus proyectos web.'
      : mode === 'reset'
        ? 'Te enviamos un enlace a tu correo institucional.'
        : mode === 'phone'
          ? 'Recibirás un código por SMS. Puede tener coste según tu operador.'
          : 'Inicia sesión con tu cuenta del Instituto Tecnológico de Durango.';

  const displayError = localError || error;

  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-sm border border-accent/40 bg-accent-soft p-3.5 text-sm text-fg">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className="mt-0.5 shrink-0 text-accent" aria-hidden="true">
          <path d="M10 2L2 7l8 5 8-5-8-5zM4 9.5v5c0 1.5 2.7 3.5 6 3.5s6-2 6-3.5v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <strong className="block font-medium">Comunidad ITD</strong>
          <span className="text-xs text-muted">Acceso exclusivo con correo institucional <strong className="font-semibold text-fg">@itdurango.edu.mx</strong></span>
        </div>
      </div>

      <h1 className="font-display text-h1">{heading}</h1>
      <p className="mt-2 text-muted">{subheading}</p>

      {isDemo && (
        <p className="mt-5 rounded-sm border border-warning/40 bg-warning-soft p-3 text-sm">
          Modo demo: cualquier botón te dará una sesión de ejemplo. Nada se guarda.
        </p>
      )}

      {(mode === 'signin' || mode === 'signup') && (
        <>
          <button
            type="button"
            onClick={() => void onGoogleClick()}
            className="btn btn-secondary btn-lg mt-6 w-full justify-center gap-2.5"
          >
            <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
              />
            </svg>
            {mode === 'signup' ? 'Registrarse con Google' : 'Continuar con Google'}
          </button>

          <p className="my-6 flex items-center gap-3 text-sm text-subtle">
            <span className="h-px flex-1 bg-line" aria-hidden="true" />o con contraseña
            <span className="h-px flex-1 bg-line" aria-hidden="true" />
          </p>
        </>
      )}

      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className={mode === 'signin' || mode === 'signup' ? 'space-y-4' : 'mt-7 space-y-4'}
      >
        {mode === 'signup' && (
          <div>
            <label htmlFor="name" className="label">
              Nombre completo
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              placeholder="Ej. Ana Martínez Soto"
              className="field"
            />
            <p className="hint">Es el nombre de autoría que se mostrará en tus proyectos.</p>
          </div>
        )}

        {mode !== 'phone' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="email" className="label mb-0">
                Correo institucional
              </label>
              {detectedRole && (
                <span
                  className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${
                    detectedRole === 'teacher'
                      ? 'border border-purple-500/30 bg-purple-500/10 text-purple-400'
                      : 'border border-accent/30 bg-accent-soft text-accent'
                  }`}
                >
                  {detectedRole === 'teacher' ? '👨‍🏫 Docente' : '🎓 Estudiante'}
                </span>
              )}
            </div>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value);
                if (localError) setLocalError(null);
              }}
              placeholder="l21040000@itdurango.edu.mx"
              aria-describedby={displayError ? 'auth-error' : undefined}
              className="field"
            />
            <p className="hint">
              {mode === 'signup'
                ? 'Estudiantes: con número de control (ej. l21040000). Docentes: nombre.apellido (sin números).'
                : 'Debe ser tu cuenta terminada en @itdurango.edu.mx'}
            </p>
          </div>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <div>
            <label htmlFor="password" className="label">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="field"
            />
            {mode === 'signup' ? (
              <p className="hint">Mínimo 6 caracteres.</p>
            ) : (
              <p className="hint">
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-accent underline underline-offset-2"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </p>
            )}
          </div>
        )}

        {mode === 'phone' && phoneStep === 'number' && (
          <div>
            <label htmlFor="phone" className="label">
              Teléfono
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="+52 55 1234 5678"
              aria-describedby={displayError ? 'auth-error' : undefined}
              className="field"
            />
            <p className="hint">Con código de país. Si escribes sin él, asumimos México (+52).</p>
          </div>
        )}

        {mode === 'phone' && phoneStep === 'code' && (
          <div>
            <label htmlFor="code" className="label">
              Código recibido
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              className="field"
            />
            <p className="hint">
              <button
                type="button"
                onClick={() => switchMode('phone')}
                className="text-accent underline underline-offset-2"
              >
                Usar otro número
              </button>
            </p>
          </div>
        )}

        {notice && (
          <p role="status" className="rounded-sm border border-line bg-line/20 p-3 text-sm">
            {notice}
          </p>
        )}

        {displayError && (
          <p
            id="auth-error"
            role="alert"
            className="rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm"
          >
            {displayError}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
          {busy
            ? 'Un momento…'
            : mode === 'signup'
              ? 'Crear mi cuenta'
              : mode === 'reset'
                ? 'Enviar enlace de recuperación'
                : mode === 'phone'
                  ? phoneStep === 'number'
                    ? 'Enviarme un código'
                    : 'Entrar'
                  : 'Iniciar sesión'}
        </button>
      </form>

      {/* Firebase monta aquí el reCAPTCHA invisible del envío de SMS. */}
      <div id={RECAPTCHA_ID} />

      {(mode === 'signin' || mode === 'signup') && (
        <p className="mt-6 text-sm text-muted">
          <button
            type="button"
            onClick={() => switchMode('phone')}
            className="text-accent underline underline-offset-2"
          >
            Entrar con mi teléfono
          </button>
        </p>
      )}

      <p className="mt-6 text-sm text-muted">
        {mode === 'signin' && '¿Todavía no tienes cuenta? '}
        {mode === 'signup' && '¿Ya tienes cuenta? '}
        <button
          type="button"
          onClick={() => switchMode(mode === 'signup' ? 'signin' : mode === 'signin' ? 'signup' : 'signin')}
          className="text-accent underline underline-offset-2 font-medium"
        >
          {mode === 'signin' ? 'Crear una cuenta (@itdurango.edu.mx)' : mode === 'signup' ? 'Iniciar sesión' : 'Volver al inicio de sesión'}
        </button>
      </p>

      <p className="mt-8 border-t border-line pt-5 text-sm text-subtle">
        No necesitas cuenta para ver proyectos.{' '}
        <Link href="/explore" className="underline underline-offset-2">
          Ir a la galería
        </Link>
      </p>
    </div>
  );
}
