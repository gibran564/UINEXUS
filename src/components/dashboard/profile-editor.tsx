'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { profileSchema } from '@/lib/schemas';
import { profilePath } from '@/lib/urls';

/**
 * Perfil público.
 *
 * Sólo se pide lo que se va a mostrar. El correo no aparece en ningún campo
 * porque no se publica nunca: se usa para identificarse y nada más. Cada
 * campo dice literalmente quién lo verá.
 */
export function ProfileEditor() {
  const { status, user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState('');
  const [program, setProgram] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    if (!isFirebaseConfigured) return;
    let active = true;
    void (async () => {
      try {
        const { apiFetch } = await import('@/lib/api-client');
        const profile = await apiFetch<{
          displayName: string;
          bio: string | null;
          program: string | null;
        }>('/api/profile');
        if (!active) return;
        setDisplayName(profile.displayName || user.displayName);
        setBio(profile.bio ?? '');
        setProgram(profile.program ?? '');
      } catch {
        // El formulario conserva los datos de Authentication si la API falla.
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (status === 'anonymous') {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <h1 className="font-display text-h2">Entra para editar tu perfil</h1>
        <Link href="/login?next=/dashboard/profile" className="btn btn-primary mt-6 w-full">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = profileSchema.safeParse({ displayName, bio, program });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }

    setErrors({});
    setState('saving');

    if (!isFirebaseConfigured || !user) {
      setTimeout(() => setState('saved'), 400);
      return;
    }

    try {
      // El handle, el rol y el contador de proyectos no viajan: el servidor
      // sólo acepta los campos que su dueño puede cambiar, y la proyección
      // pública la deriva él a partir del registro guardado.
      const { updateProfile } = await import('@/lib/projects-client');
      await updateProfile(parsed.data);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <nav aria-label="Ruta">
        <Link href="/dashboard" className="text-sm text-muted no-underline hover:text-fg">
          ← Tus proyectos
        </Link>
      </nav>

      <h1 className="mt-4 font-display text-h1">Tu perfil</h1>
      <p className="mt-2 text-muted">
        Esto es lo único que se muestra públicamente.{' '}
        {user?.handle && (
          <>
            Tu página es{' '}
            <Link href={profilePath(user.handle)} className="font-mono text-accent underline underline-offset-2">
              uinexus.mx/@{user.handle}
            </Link>
            .
          </>
        )}
      </p>

      <form onSubmit={(event) => void save(event)} noValidate className="mt-8 space-y-6">
        <div>
          <label htmlFor="displayName" className="label">
            Nombre
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby={errors.displayName ? 'displayName-error' : 'displayName-hint'}
            className="field"
          />
          {errors.displayName ? (
            <p id="displayName-error" role="alert" className="hint text-danger">
              {errors.displayName}
            </p>
          ) : (
            <p id="displayName-hint" className="hint">
              Aparece como autoría en todos tus proyectos.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="bio" className="label">
            Sobre ti <span className="font-normal text-subtle">(opcional)</span>
          </label>
          <textarea
            id="bio"
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={280}
            aria-describedby="bio-hint"
            className="field"
          />
          <p id="bio-hint" className="hint">
            Una o dos líneas. <span className="tabular-nums">{bio.length}/280</span>
          </p>
        </div>

        <div>
          <label htmlFor="program" className="label">
            Carrera o grupo <span className="font-normal text-subtle">(opcional)</span>
          </label>
          <input
            id="program"
            value={program}
            onChange={(event) => setProgram(event.target.value)}
            maxLength={80}
            className="field"
          />
        </div>

        <div className="panel bg-sunken p-4 text-sm text-muted">
          <h2 className="font-medium text-fg">Lo que nunca se publica</h2>
          <p className="mt-1">
            Tu correo, tu identificador interno de cuenta y cualquier dato académico que no
            hayas escrito aquí. Sólo tú y el profesorado del curso ven esa información.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={state === 'saving'}>
            {state === 'saving' ? 'Guardando…' : 'Guardar perfil'}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {state === 'saved' && <span className="text-success">Perfil actualizado.</span>}
            {state === 'error' && (
              <span className="text-danger">No se pudo guardar. Inténtalo otra vez.</span>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
