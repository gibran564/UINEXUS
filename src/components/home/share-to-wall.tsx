'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { Notice } from '@/components/aula/aula-ui';
import type { PublicationCourse } from '@/lib/publications';

/**
 * Compartir una página ya publicada en el muro de una clase.
 *
 * ## Por qué existe fuera del compositor
 *
 * El compositor del muro sabe compartir cualquier cosa, pero para usarlo hay
 * que estar EN el muro y recordar el título exacto de la página en un
 * desplegable con todo lo compartible del semestre. El momento en que alguien
 * quiere compartir una página es el momento en que acaba de subirla, o el
 * momento en que la está mirando en sus proyectos; en los dos casos ya se sabe
 * cuál es y lo único que falta preguntar es con quién.
 *
 * ## Lo que NO decide esta pantalla
 *
 * Ni la aprobación ni la visibilidad. Quien da clase publica directo; quien
 * estudia propone y su docente aprueba o rechaza, exactamente igual que con un
 * recurso o una Skill —la regla vive en `lib/server/publications.ts` y aquí
 * sólo se anuncia—. Y una página en borrador o no listada no se puede
 * compartir: el muro enseñaría una tarjeta que lleva a un enlace que la clase
 * no puede abrir.
 */
export function ShareToWall({
  projectId,
  published = true,
  preselected = [],
  onShared,
}: {
  projectId: string;
  /** Sólo lo público se comparte: el muro no enseña enlaces rotos. */
  published?: boolean;
  /** Grupos que vienen sugeridos desde el muro (ver `?compartir=` al publicar). */
  preselected?: readonly string[];
  onShared?: () => void;
}) {
  const [courses, setCourses] = useState<PublicationCourse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [role, setRole] = useState<'teacher' | 'student' | null>(null);
  const [mode, setMode] = useState<'selectedGroups' | 'allTeacherGroups'>('selectedGroups');
  const [selected, setSelected] = useState<string[]>([...preselected]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!published) return;
    let active = true;
    setLoadError(null);
    apiFetch<{ courses: PublicationCourse[] }>('/api/publications?options=1')
      .then((result) => {
        if (!active) return;
        setCourses(result.courses);
        // El papel se deduce de dónde puede publicar, no se pregunta dos veces:
        // sólo quien enseña en un grupo y estudia en otro tiene algo que elegir.
        setRole((current) => current ?? (result.courses.some((course) => course.role === 'teacher') ? 'teacher' : 'student'));
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : 'No se pudieron cargar tus grupos.');
      });
    return () => { active = false; };
  }, [published, attempt]);

  if (!published) {
    return (
      <p className="text-sm text-muted">
        Para compartirla en el muro tiene que ser pública: cámbiale la visibilidad a
        «Publicado» y vuelve aquí.
      </p>
    );
  }

  const teaching = (courses ?? []).filter((course) => course.role === 'teacher');
  const studying = (courses ?? []).filter((course) => course.role === 'student');
  const available = role === 'student' ? studying : teaching;
  const groupIds = selected.filter((id) => available.some((course) => course.id === id));
  const valid = (role === 'teacher' && mode === 'allTeacherGroups') || groupIds.length > 0;

  async function share(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/publications', {
        method: 'POST',
        body: {
          reference: { kind: 'project', id: projectId },
          allTeacherGroups: role === 'teacher' && mode === 'allTeacherGroups',
          audienceCourseIds: role === 'teacher' && mode === 'allTeacherGroups' ? [] : groupIds,
        },
      });
      setDone(
        role === 'teacher'
          ? 'Tu página ya está en el muro de la clase.'
          : 'Enviada. Tu docente la revisará antes de que aparezca en el muro.'
      );
      onShared?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo compartir en el muro.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p role="status" className="text-sm text-muted">{done}</p>;
  }

  if (loadError) {
    return (
      <div>
        <Notice tone="error">{loadError}</Notice>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setAttempt((value) => value + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!courses) return <p role="status" className="text-sm text-muted">Cargando tus grupos…</p>;

  if (!courses.length) {
    return (
      <p className="text-sm text-muted">
        Todavía no estás en ninguna materia, así que no hay muro donde compartirla. Únete con el
        código que te dé tu docente y vuelve a intentarlo.
      </p>
    );
  }

  return (
    <form onSubmit={share} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        {teaching.length > 0 && studying.length > 0 && (
          <label className="block">
            <span className="label">Compartir como</span>
            <select
              className="field"
              value={role ?? 'teacher'}
              onChange={(event) => { setRole(event.target.value as 'teacher' | 'student'); setMode('selectedGroups'); setSelected([]); }}
            >
              <option value="teacher">Docente</option>
              <option value="student">Estudiante</option>
            </select>
          </label>
        )}

        <fieldset className="rounded-sm border border-line p-3">
          <legend className="px-1 font-medium">¿Con qué grupo?</legend>
          {role === 'teacher' && (
            <div className="mb-2 flex flex-wrap gap-3">
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="share-audience" checked={mode === 'selectedGroups'} onChange={() => setMode('selectedGroups')} />
                Uno o varios grupos
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="share-audience" checked={mode === 'allTeacherGroups'} onChange={() => setMode('allTeacherGroups')} />
                Todos mis grupos
              </label>
            </div>
          )}
          {mode === 'selectedGroups' && available.map((course) => (
            <label key={course.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type={role === 'teacher' ? 'checkbox' : 'radio'}
                name="share-group"
                checked={groupIds.includes(course.id)}
                onChange={() => setSelected(role === 'student'
                  ? [course.id]
                  : groupIds.includes(course.id) ? groupIds.filter((id) => id !== course.id) : [...groupIds, course.id])}
              />
              {course.name}
            </label>
          ))}
          {!available.length && <p className="mt-1 text-sm text-muted">No tienes grupos con ese papel.</p>}
          {role === 'student' && (
            <p className="mt-2 text-sm text-muted">
              Tu docente recibe el aviso y decide si se publica en el muro.
            </p>
          )}
        </fieldset>

        {error && <Notice tone="error">{error}</Notice>}

        <button type="submit" className="btn btn-primary min-h-11" disabled={!valid}>
          {busy ? 'Compartiendo…' : role === 'teacher' ? 'Compartir en el muro' : 'Enviar para aprobación'}
        </button>
      </fieldset>
    </form>
  );
}
