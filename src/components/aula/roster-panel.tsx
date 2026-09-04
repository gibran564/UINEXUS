'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { MemberChip, Notice } from './aula-ui';
import {
  enrollStudents,
  removeStudent,
  searchPeople,
  useApi,
  type RosterRow,
} from '@/lib/aula-client';
import type { CourseMember } from '@/lib/types';

type Filter = 'all' | 'submitted' | 'pending' | 'reviewed' | 'unreviewed';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'submitted', label: 'Entregó' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'reviewed', label: 'Revisado' },
  { value: 'unreviewed', label: 'Sin revisar' },
];

/**
 * Panel «Materia > Estudiantes» (§4).
 *
 * Los recuentos son SIEMPRE de esta materia: vienen calculados del servidor a
 * partir de las tareas de esta materia y nada más. Es lo que evita el error
 * clásico de un panel académico, que es enseñar «12 entregas» sumando el
 * trabajo que esa persona hizo para otro docente.
 *
 * El filtro se aplica sobre la lista ya cargada porque un grupo son decenas de
 * filas: pedir al servidor una consulta por filtro añadiría latencia a cada
 * clic sin ahorrar nada.
 */
export function RosterPanel({
  courseId,
  onChanged,
}: {
  courseId: string;
  onChanged: () => void;
}) {
  const { data, state, reload } = useApi<{ students: RosterRow[]; teachers: CourseMember[] }>(
    `/api/courses/${courseId}/students`
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();

  const students = (data?.students ?? [])
    .filter(
      (row) =>
        !needle ||
        row.displayName.toLowerCase().includes(needle) ||
        row.handle.includes(needle)
    )
    .filter((row) => {
      switch (filter) {
        case 'submitted':
          return row.submitted > 0;
        case 'pending':
          return row.pending > 0;
        case 'reviewed':
          return row.reviewed > 0;
        case 'unreviewed':
          // Entregó algo que todavía no se ha revisado. Es la cola de trabajo
          // real del profesorado, y por eso es un filtro y no un dato suelto.
          return row.submitted > row.reviewed;
        case 'all':
        default:
          return true;
      }
    });

  async function remove(handle: string): Promise<void> {
    setError(null);
    try {
      await removeStudent(courseId, handle);
      reload();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo quitar.');
    }
  }

  return (
    <div>
      <EnrollBox
        courseId={courseId}
        onEnrolled={() => {
          reload();
          onChanged();
        }}
      />

      <div className="mt-8 flex flex-wrap items-end gap-4">
        <label className="min-w-56 flex-1">
          <span className="label">Buscar</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre o usuario"
            className="field"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar estudiantes">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className="chip"
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {selected.size > 0 && (
        <div className="panel mt-4 flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-sm tabular-nums">
            {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
          </p>
          <div className="flex flex-wrap gap-2">
            {/*
              Lleva al formulario NORMAL de creación de tareas con la gente ya
              marcada (§17). No es un segundo sistema de «tareas rápidas»:
              termina creando el mismo Assignment de siempre, y por eso el resto
              del flujo —tipos, conceptos, recursos, publicar— es idéntico.
            */}
            <Link
              href={`/aula/${courseId}/tareas/nueva?students=${[...selected].join(',')}`}
              className="btn btn-primary btn-sm"
            >
              Crear tarea para seleccionados
            </Link>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="btn btn-ghost btn-sm"
            >
              Quitar selección
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {state === 'loading' && <p className="py-8 text-center text-muted">Cargando…</p>}

        {state === 'ready' && students.length === 0 && (
          <EmptyState
            title={needle || filter !== 'all' ? 'Nadie coincide' : 'Todavía no hay estudiantes'}
            description={
              needle || filter !== 'all'
                ? 'Prueba con otro nombre o quita el filtro.'
                : 'Comparte el código de la materia con el grupo, o inscribe a alguien por su nombre de usuario.'
            }
          />
        )}

        {students.length > 0 && (
          <>
            <label className="mb-2 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={students.every((row) => selected.has(row.handle))}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(students.map((row) => row.handle)) : new Set()
                  )
                }
              />
              Seleccionar todo lo visible
            </label>

            <ul className="divide-y divide-line border-y border-line">
              {students.map((row) => (
                <li key={row.handle} className="flex flex-wrap items-center gap-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(row.handle)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(row.handle)) next.delete(row.handle);
                        else next.add(row.handle);
                        return next;
                      })
                    }
                    aria-label={`Seleccionar a ${row.displayName}`}
                  />
                  <div className="min-w-48 flex-1">
                    <Link
                      href={`/aula/${courseId}/estudiantes/${row.handle}`}
                      className="no-underline"
                    >
                      <MemberChip
                        handle={row.handle}
                        displayName={row.displayName}
                        avatarUrl={row.avatarUrl}
                      />
                    </Link>
                  </div>

                  <dl className="flex gap-6 text-sm tabular-nums">
                    <Count label="Entregó" value={`${row.submitted}/${row.assigned}`} />
                    <Count label="Pendiente" value={row.pending} />
                    <Count label="Revisado" value={row.reviewed} />
                    <Count label="Worklogs" value={row.worklogs} />
                  </dl>

                  <div className="flex gap-2">
                    <Link
                      href={`/aula/${courseId}/estudiantes/${row.handle}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Ver
                    </Link>
                    <button
                      type="button"
                      onClick={() => void remove(row.handle)}
                      className="btn btn-ghost btn-sm"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

/**
 * Inscripción por nombre de usuario.
 *
 * Convive con el código de la materia y no lo sustituye: el código sirve para
 * los 31 de golpe, esto para el que llegó tarde o se cambió de grupo.
 */
function EnrollBox({ courseId, onEnrolled }: { courseId: string; onEnrolled: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function find(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { people } = await searchPeople(query);
      setResults(people);
      if (people.length === 0) setMessage({ tone: 'error', text: 'Nadie coincide con eso.' });
    } catch (caught) {
      setMessage({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'No se pudo buscar.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function enroll(handle: string): Promise<void> {
    setMessage(null);
    try {
      await enrollStudents(courseId, [handle]);
      setResults((current) => current.filter((person) => person.handle !== handle));
      setMessage({ tone: 'success', text: `@${handle} quedó inscrito.` });
      onEnrolled();
    } catch (caught) {
      setMessage({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'No se pudo inscribir.',
      });
    }
  }

  return (
    <section aria-labelledby="inscribir" className="panel p-5">
      <h2 id="inscribir" className="font-display text-h3">
        Inscribir a alguien
      </h2>
      <p className="mt-1 text-sm text-muted">
        Busca por nombre o por su usuario de UINexus. Para el grupo entero es más rápido el
        código de la materia.
      </p>

      <form onSubmit={find} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1">
          <span className="sr-only">Buscar personas</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ana, Christian González…"
            className="field"
          />
        </label>
        <button type="submit" disabled={busy || query.trim().length < 2} className="btn btn-secondary">
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-4 space-y-2">
          {results.map((person) => (
            <li key={person.handle} className="flex items-center justify-between gap-3">
              <MemberChip
                handle={person.handle}
                displayName={person.displayName}
                avatarUrl={person.avatarUrl}
              />
              <button
                type="button"
                onClick={() => void enroll(person.handle)}
                className="btn btn-secondary btn-sm"
              >
                Inscribir
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
