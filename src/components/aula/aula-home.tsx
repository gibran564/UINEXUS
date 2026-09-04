'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { EmptyState } from '@/components/ui/empty-state';
import {
  AulaScreen,
  DueDate,
  Notice,
  SubmissionBadge,
  TypeChip,
} from './aula-ui';
import { createCourse, joinCourse, useApi, type AulaHome as AulaHomeData } from '@/lib/aula-client';

/**
 * Portada del aula.
 *
 * Dos públicos en una pantalla, sin duplicar la ruta. Se decide por el rol que
 * la persona tiene EN SUS MATERIAS, no por el rol global del perfil: quien da
 * clase de una materia y cursa otra ve las dos cosas, que es el caso real de
 * un ayudante de cátedra.
 *
 * §19 pide explícitamente que esto no se convierta en un panel saturado. Lo que
 * hay es: lo que toca hacer, y las materias. Nada de gráficas ni de "actividad
 * reciente", que es información que nadie usa para decidir nada.
 */
export function AulaHome() {
  const { user } = useAuth();
  const { data, state, error, reload } = useApi<AulaHomeData>('/api/aula');

  const teaching = data?.courses.filter((card) => card.role === 'teacher') ?? [];
  const studying = data?.courses.filter((card) => card.role === 'student') ?? [];
  const canCreate = data?.role === 'teacher' || data?.role === 'admin';

  return (
    <AulaScreen state={state} error={error} next="/aula">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-h1">
            Hola, {data?.displayName?.split(' ')[0] ?? user?.displayName ?? 'de nuevo'}
          </h1>
          <p className="mt-1 text-muted">Tus materias, tus tareas y tus entregas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <JoinByCode onJoined={reload} />
          {canCreate && <CreateCourse onCreated={reload} />}
        </div>
      </header>

      {data && data.pending.length > 0 && (
        <section aria-labelledby="pendientes" className="mt-10">
          <h2 id="pendientes" className="section-mark font-display text-h2">
            Pendientes
          </h2>
          <ul className="mt-5 space-y-3">
            {data.pending.map((item) => (
              <li
                key={item.assignment.id}
                className="panel flex flex-wrap items-center gap-4 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="meta">{item.courseName}</p>
                  <p className="mt-1 font-medium">{item.assignment.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                    <TypeChip type={item.assignment.type} />
                    {item.myConcepts !== null && (
                      <span>
                        Actividad colaborativa · te {item.myConcepts === 1 ? 'corresponde' : 'corresponden'}{' '}
                        {item.myConcepts} {item.myConcepts === 1 ? 'concepto' : 'conceptos'}
                      </span>
                    )}
                    <span>
                      Entrega: <DueDate value={item.assignment.dueDate} />
                    </span>
                  </p>
                  {(item.resources.prompts > 0 || item.resources.skills > 0) && (
                    <p className="mt-1 text-label text-subtle">
                      Incluye{' '}
                      {[
                        item.resources.prompts > 0 &&
                          `${item.resources.prompts} ${item.resources.prompts === 1 ? 'prompt' : 'prompts'}`,
                        item.resources.skills > 0 &&
                          `${item.resources.skills} ${item.resources.skills === 1 ? 'Skill' : 'Skills'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <SubmissionBadge status={item.status} />
                <Link
                  href={`/aula/${item.courseId}/tareas/${item.assignment.id}`}
                  className="btn btn-primary btn-sm"
                >
                  {item.status === 'draft' ? 'Continuar' : 'Comenzar'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {teaching.length > 0 && (
        <CourseSection
          id="imparto"
          title="Materias que impartes"
          cards={teaching}
          countLabel="tareas"
          attentionLabel="entregas sin revisar"
        />
      )}

      {studying.length > 0 && (
        <CourseSection
          id="curso"
          title="Tus materias"
          cards={studying}
          countLabel="tareas asignadas"
          attentionLabel="por entregar"
        />
      )}

      {data && data.courses.length === 0 && (
        <div className="mt-10">
          <EmptyState
            title="Todavía no estás en ninguna materia"
            description={
              canCreate
                ? 'Crea tu primera materia y comparte su código con el grupo para que se inscriban.'
                : 'Pide a tu docente el código de la materia y únete con el botón de arriba.'
            }
            action={{ href: '/explore', label: 'Explorar proyectos mientras tanto' }}
          />
        </div>
      )}
    </AulaScreen>
  );
}

function CourseSection({
  id,
  title,
  cards,
  countLabel,
  attentionLabel,
}: {
  id: string;
  title: string;
  cards: AulaHomeData['courses'];
  countLabel: string;
  attentionLabel: string;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="section-mark font-display text-h2">
        {title}
      </h2>
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <li key={card.course.id}>
            <Link
              href={`/aula/${card.course.id}`}
              className="panel block h-full p-5 no-underline transition-colors hover:border-line-strong"
            >
              <p className="meta">{card.course.academicPeriod ?? card.course.term}</p>
              <h3 className="mt-2 font-display text-h3">{card.course.name}</h3>
              <p className="mt-3 text-sm text-muted tabular-nums">
                {card.role === 'teacher' && `${card.course.studentCount} estudiantes · `}
                {card.assignments} {countLabel}
              </p>
              {card.collaborative && (
                <p className="mt-3 text-sm text-muted tabular-nums">
                  <span className="block text-fg">{card.collaborative.title}</span>
                  {card.collaborative.done} / {card.collaborative.total} apartados terminados
                </p>
              )}
              {card.attention > 0 && (
                <p className="mt-3 text-sm font-medium text-accent tabular-nums">
                  {card.attention} {attentionLabel}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Autoinscripción con el código que la docente dicta en clase. */
function JoinByCode({ onJoined }: { onJoined: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinCourse(code);
      setOpen(false);
      setCode('');
      onJoined();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo unir.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
        Unirme con código
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-wrap items-end gap-2 p-3">
      <label className="block">
        <span className="label">Código de la materia</span>
        <input
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ABC234"
          className="field w-32 font-mono uppercase"
        />
      </label>
      <button type="submit" disabled={busy || code.length !== 6} className="btn btn-primary">
        {busy ? 'Entrando…' : 'Unirme'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
        Cancelar
      </button>
      {error && (
        <div className="w-full">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </form>
  );
}

function CreateCourse({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [period, setPeriod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCourse({
        name,
        description: '',
        academicPeriod: period || null,
        institution: 'Instituto Tecnológico de Durango',
        visibility: 'public',
      });
      setOpen(false);
      setName('');
      setPeriod('');
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        + Nueva materia
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="panel flex flex-wrap items-end gap-2 p-3">
      <label className="block">
        <span className="label">Nombre de la materia</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Diseño Centrado en el Usuario"
          className="field w-64"
        />
      </label>
      <label className="block">
        <span className="label">Periodo</span>
        <input
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          placeholder="Ago–Dic 2026"
          className="field w-36"
        />
      </label>
      <button type="submit" disabled={busy || name.trim().length < 3} className="btn btn-primary">
        {busy ? 'Creando…' : 'Crear'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
        Cancelar
      </button>
      {error && (
        <div className="w-full">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </form>
  );
}
