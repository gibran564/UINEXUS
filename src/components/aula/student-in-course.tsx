'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ProjectGrid } from '@/components/project/project-grid';
import { UserAvatar } from '@/components/ui/user-avatar';
import { reviewSubmission, useApi, type StudentInCourse as StudentInCourseData } from '@/lib/aula-client';
import { profilePath } from '@/lib/urls';
import type { Assignment, ContributionState, Submission } from '@/lib/types';
import {
  AulaScreen,
  Crumbs,
  DueDate,
  Stat,
  SubmissionBadge,
  TypeChip,
} from './aula-ui';
import { SubmissionViewer } from './submission-viewer';

const CONCEPT_LABEL: Record<ContributionState, string> = {
  missing: 'Sin iniciar',
  draft: 'Borrador',
  submitted: 'Entregado',
  reviewed: 'Revisado',
  needs_changes: 'Requiere cambios',
};

const CONCEPT_TONE: Record<ContributionState, string> = {
  missing: 'text-subtle',
  draft: 'text-warning',
  submitted: 'text-success',
  reviewed: 'text-success',
  needs_changes: 'text-danger',
};

/**
 * «Materia > Estudiantes > Christian» (§14).
 *
 * Todo lo que se ve aquí está acotado a ESTA materia: las tareas son las de
 * esta materia, las entregas también, y los proyectos son los que esa persona
 * publicó asociados a ella. §4 lo pide de forma explícita —«no mezclar
 * automáticamente trabajos de diferentes materias»— y el filtro lo aplica el
 * servidor, no esta pantalla: aquí no llega nada de otras materias que se
 * pudiera enseñar por error.
 */
export function StudentInCourse({ courseId, handle }: { courseId: string; handle: string }) {
  const { data, state, error, reload } = useApi<StudentInCourseData>(
    `/api/courses/${courseId}/students/${handle}`
  );
  const [open, setOpen] = useState<{ submission: Submission; assignment: Assignment } | null>(null);

  return (
    <AulaScreen state={state} error={error} next={`/aula/${courseId}/estudiantes/${handle}`}>
      {data && (
        <>
          <Crumbs
            items={[
              { href: '/aula', label: 'Aula' },
              { href: `/aula/${courseId}`, label: data.courseName },
              { label: data.student.displayName },
            ]}
          />

          <header className="mt-4 flex flex-wrap items-center gap-4 border-b border-line pb-6">
            <UserAvatar
              name={data.student.displayName}
              src={data.student.avatarUrl}
              size={56}
            />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-h1">{data.student.displayName}</h1>
              <p className="mt-1 text-sm text-muted">
                <Link
                  href={profilePath(data.student.handle)}
                  className="font-mono no-underline hover:text-fg"
                >
                  @{data.student.handle}
                </Link>{' '}
                · {data.courseName}
              </p>
            </div>
          </header>

          {data.academicProfile &&
            (data.academicProfile.enrollmentNumber ||
              data.academicProfile.semester ||
              data.academicProfile.career) && (
              <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
                {data.academicProfile.enrollmentNumber && (
                  <div>
                    <dt className="meta">Matrícula</dt>
                    <dd className="mt-1 font-mono">{data.academicProfile.enrollmentNumber}</dd>
                  </div>
                )}
                {data.academicProfile.semester && (
                  <div>
                    <dt className="meta">Semestre</dt>
                    <dd className="mt-1">{data.academicProfile.semester}</dd>
                  </div>
                )}
                {data.academicProfile.career && (
                  <div>
                    <dt className="meta">Carrera</dt>
                    <dd className="mt-1">{data.academicProfile.career}</dd>
                  </div>
                )}
              </dl>
            )}

          <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
            <Stat label="Entregas" value={data.totals.submitted} />
            <Stat label="Pendientes" value={data.totals.pending} />
            <Stat label="Revisadas" value={data.totals.reviewed} />
            <Stat label="AI Worklogs" value={data.totals.worklogs} />
            <Stat label="Proyectos" value={data.projects.length} />
          </dl>

          <section aria-labelledby="tareas" className="mt-12">
            <h2 id="tareas" className="section-mark font-display text-h2">
              Tareas de esta materia
            </h2>

            {data.assignments.length === 0 ? (
              <p className="mt-4 text-muted">
                Esta persona todavía no tiene tareas asignadas en la materia.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-line border-y border-line">
                {data.assignments.map(({ assignment, submission }) => (
                  <li key={assignment.id} className="flex flex-wrap items-center gap-4 py-3">
                    <div className="min-w-40 flex-1">
                      <Link
                        href={`/aula/${courseId}/tareas/${assignment.id}`}
                        className="font-medium text-fg no-underline hover:underline"
                      >
                        {assignment.title}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                        <TypeChip type={assignment.type} />
                        <DueDate value={assignment.dueDate} dueAt={assignment.dueAt} />
                      </p>
                    </div>

                    <SubmissionBadge status={submission?.status ?? null} />

                    {submission && submission.status !== 'draft' && (
                      <button
                        type="button"
                        onClick={() => setOpen({ submission, assignment })}
                        className="btn btn-secondary btn-sm"
                      >
                        Abrir entrega
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.collaborative.length > 0 && (
            <section aria-labelledby="colaborativas" className="mt-12">
              <h2 id="colaborativas" className="section-mark font-display text-h2">
                Aportaciones colaborativas
              </h2>
              <ul className="mt-5 space-y-4">
                {data.collaborative.map((activity) => (
                  <li key={activity.assignmentId} className="panel p-4">
                    <Link
                      href={`/aula/${courseId}/tareas/${activity.assignmentId}`}
                      className="font-medium text-fg no-underline hover:underline"
                    >
                      {activity.assignmentTitle}
                    </Link>
                    <ul className="mt-3 space-y-1.5">
                      {activity.concepts.map((concept) => (
                        <li
                          key={concept.groupId}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span>{concept.title}</span>
                          <span className={CONCEPT_TONE[concept.state]}>
                            {CONCEPT_LABEL[concept.state]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="worklogs" className="mt-12">
            <h2 id="worklogs" className="section-mark font-display text-h2">
              AI Worklogs
            </h2>
            {data.totals.worklogs === 0 ? (
              <p className="mt-4 text-muted">Todavía no ha entregado ningún AI Worklog aquí.</p>
            ) : (
              <ul className="mt-5 space-y-2">
                {data.assignments
                  .filter(
                    (row) =>
                      row.submission?.type === 'ai_worklog' && row.submission.status !== 'draft'
                  )
                  .map((row) => (
                    <li key={row.assignment.id} className="panel flex items-center gap-3 p-3">
                      <span className="min-w-0 flex-1">{row.assignment.title}</span>
                      <SubmissionBadge status={row.submission?.status ?? null} />
                      <button
                        type="button"
                        onClick={() =>
                          row.submission &&
                          setOpen({ submission: row.submission, assignment: row.assignment })
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        Abrir
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="proyectos" className="mt-12">
            <h2 id="proyectos" className="section-mark font-display text-h2">
              Proyectos publicados en esta materia
            </h2>
            <div className="mt-5">
              {data.projects.length === 0 ? (
                <p className="text-muted">
                  Todavía no ha publicado ningún proyecto asociado a esta materia.
                </p>
              ) : (
                <ProjectGrid
                  projects={data.projects}
                  label={`Proyectos de ${data.student.displayName}`}
                />
              )}
            </div>
          </section>

          {open && (
            <SubmissionViewer
              submission={open.submission}
              assignment={open.assignment}
              onClose={() => setOpen(null)}
              onReview={async (status, teacherNote) => {
                await reviewSubmission(open.submission.id, { status, teacherNote });
                setOpen(null);
                reload();
              }}
            />
          )}
        </>
      )}
    </AulaScreen>
  );
}
