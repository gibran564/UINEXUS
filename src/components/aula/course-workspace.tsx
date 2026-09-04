'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { CopyField } from '@/components/ui/copy-field';
import { ProjectGrid } from '@/components/project/project-grid';
import {
  AssignmentStatusBadge,
  AulaScreen,
  Crumbs,
  DueDate,
  Stat,
  SubmissionBadge,
  TypeChip,
} from './aula-ui';
import { ResourcesPanel } from './resources-panel';
import { RosterPanel } from './roster-panel';
import { useApi, type CourseOverview } from '@/lib/aula-client';
import type { Project } from '@/lib/types';

type Tab = 'overview' | 'assignments' | 'students' | 'projects' | 'resources';

const TABS: readonly Tab[] = ['overview', 'assignments', 'students', 'projects', 'resources'];

/**
 * El espacio de trabajo de una materia.
 *
 * Las pestañas que se ven dependen del rol dentro de la materia, y no porque se
 * oculten: al alumnado no se le pintan «Estudiantes» ni el avance del grupo
 * porque el servidor no se los manda. Si se forzara la pestaña por la URL, no
 * habría datos que enseñar, que es exactamente lo que debe pasar.
 */
export function CourseWorkspace({ courseId }: { courseId: string }) {
  const { data, state, error, reload } = useApi<CourseOverview>(`/api/courses/${courseId}`);

  /**
   * La pestaña inicial puede venir en la URL (`?tab=resources`). Es lo que
   * permite que «crea un prompt y vuelve» desde el editor de tareas aterrice
   * donde debe en vez de en el resumen.
   */
  const params = useSearchParams();
  const requested = params.get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.includes(requested as Tab) ? (requested as Tab) : 'overview'
  );

  const isTeacher = data?.course.viewerRole === 'teacher';

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Resumen' },
    { value: 'assignments', label: 'Tareas' },
    ...(isTeacher ? [{ value: 'students' as Tab, label: 'Estudiantes' }] : []),
    { value: 'projects', label: 'Proyectos' },
    { value: 'resources', label: 'Recursos IA' },
  ];

  const statusByAssignment = new Map(
    (data?.myStatus ?? []).map((entry) => [entry.assignmentId, entry.status])
  );
  const progressByAssignment = new Map(
    (data?.progress ?? []).map((entry) => [entry.assignmentId, entry])
  );

  return (
    <AulaScreen state={state} error={error} next={`/aula/${courseId}`}>
      {data && (
        <>
          <Crumbs items={[{ href: '/aula', label: 'Aula' }, { label: data.course.name }]} />

          <header className="mt-4 border-b border-line pb-7">
            <p className="meta">{data.course.academicPeriod ?? data.course.term}</p>
            <h1 className="mt-2 font-display text-h1">{data.course.name}</h1>
            {data.course.description && (
              <p className="mt-3 max-w-prose text-muted">{data.course.description}</p>
            )}

            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
              {isTeacher && <Stat label="Estudiantes" value={data.course.studentCount} />}
              <Stat label="Tareas" value={data.assignments.length} />
              {isTeacher && <Stat label="Entregas sin revisar" value={data.unreviewed} />}
            </dl>
          </header>

          <div className="mt-6 border-b border-line">
            <div role="tablist" aria-label="Secciones de la materia" className="flex gap-1">
              {tabs.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  onClick={() => setTab(item.value)}
                  className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm ${
                    tab === item.value
                      ? 'border-accent font-medium text-accent'
                      : 'border-transparent text-muted hover:text-fg'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8">
            {tab === 'overview' && (
              <Overview
                data={data}
                courseId={courseId}
                isTeacher={Boolean(isTeacher)}
                statusByAssignment={statusByAssignment}
                progressByAssignment={progressByAssignment}
              />
            )}

            {tab === 'assignments' && (
              <AssignmentList
                data={data}
                courseId={courseId}
                isTeacher={Boolean(isTeacher)}
                statusByAssignment={statusByAssignment}
                progressByAssignment={progressByAssignment}
              />
            )}

            {tab === 'students' && isTeacher && (
              <RosterPanel courseId={courseId} onChanged={reload} />
            )}

            {tab === 'projects' && <CourseProjects courseId={courseId} />}

            {tab === 'resources' && <ResourcesPanel courseId={courseId} />}
          </div>
        </>
      )}
    </AulaScreen>
  );
}

type StatusMap = Map<string, string | null>;
type ProgressMap = Map<string, { assigned: number; submitted: number; reviewed: number }>;

function Overview({
  data,
  courseId,
  isTeacher,
  statusByAssignment,
  progressByAssignment,
}: {
  data: CourseOverview;
  courseId: string;
  isTeacher: boolean;
  statusByAssignment: StatusMap;
  progressByAssignment: ProgressMap;
}) {
  const recent = data.assignments.slice(0, 4);

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="recientes">
        <h2 id="recientes" className="font-display text-h3">
          Tareas recientes
        </h2>
        {recent.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Todavía no hay tareas"
              description={
                isTeacher
                  ? 'Crea la primera desde la pestaña Tareas.'
                  : 'Cuando tu docente publique una tarea, aparecerá aquí.'
              }
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {recent.map((assignment) => (
              <AssignmentRow
                key={assignment.id}
                assignment={assignment}
                courseId={courseId}
                isTeacher={isTeacher}
                status={statusByAssignment.get(assignment.id) ?? null}
                progress={progressByAssignment.get(assignment.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <aside className="space-y-6">
        {isTeacher && data.course.code && (
          <div className="panel p-5">
            <h2 className="font-display text-h3">Código de la materia</h2>
            <p className="mt-2 text-sm text-muted">
              Dicta este código en clase. Quien lo escriba queda inscrito como estudiante.
            </p>
            <p className="mt-4 font-mono text-h2 tracking-widest">{data.course.code}</p>
            <div className="mt-3">
              <CopyField value={data.course.code} label="Código de la materia" />
            </div>
          </div>
        )}

        {isTeacher && (
          <div className="panel p-5">
            <h2 className="font-display text-h3">Por revisar</h2>
            <p className="mt-2 tabular-nums text-lead">{data.unreviewed} entregas</p>
            <p className="mt-1 text-sm text-muted">
              Entregas que ya están hechas y todavía no has abierto.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function AssignmentList({
  data,
  courseId,
  isTeacher,
  statusByAssignment,
  progressByAssignment,
}: {
  data: CourseOverview;
  courseId: string;
  isTeacher: boolean;
  statusByAssignment: StatusMap;
  progressByAssignment: ProgressMap;
}) {
  return (
    <>
      {isTeacher && (
        <div className="mb-6 flex justify-end">
          <Link href={`/aula/${courseId}/tareas/nueva`} className="btn btn-primary">
            + Nueva tarea
          </Link>
        </div>
      )}

      {data.assignments.length === 0 ? (
        <EmptyState
          title="Sin tareas todavía"
          description={
            isTeacher
              ? 'Una tarea puede ser una investigación estructurada, un AI Worklog, un proyecto web o un enlace.'
              : 'Cuando tu docente publique una tarea, aparecerá aquí.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.assignments.map((assignment) => (
            <AssignmentRow
              key={assignment.id}
              assignment={assignment}
              courseId={courseId}
              isTeacher={isTeacher}
              status={statusByAssignment.get(assignment.id) ?? null}
              progress={progressByAssignment.get(assignment.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function AssignmentRow({
  assignment,
  courseId,
  isTeacher,
  status,
  progress,
}: {
  assignment: CourseOverview['assignments'][number];
  courseId: string;
  isTeacher: boolean;
  status: string | null;
  progress?: { assigned: number; submitted: number; reviewed: number };
}) {
  return (
    <li className="panel p-4">
      <Link
        href={`/aula/${courseId}/tareas/${assignment.id}`}
        className="flex flex-wrap items-center gap-4 no-underline"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">{assignment.title}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted">
            <TypeChip type={assignment.type} />
            <DueDate value={assignment.dueDate} />
            {isTeacher && !assignment.assignedToAll && (
              <span className="text-subtle">
                Asignada a {assignment.assignedTo?.length ?? 0} estudiantes
              </span>
            )}
          </p>
        </div>

        {isTeacher ? (
          <div className="flex items-center gap-3">
            {progress && (
              <span className="text-sm text-muted tabular-nums">
                Entregaron {progress.submitted} / {progress.assigned}
              </span>
            )}
            <AssignmentStatusBadge status={assignment.status} />
          </div>
        ) : (
          <SubmissionBadge status={(status as never) ?? null} />
        )}
      </Link>
    </li>
  );
}

/**
 * Proyectos publicados de la materia.
 *
 * Reutiliza la galería pública en vez de una vista propia: un proyecto entregado
 * como tarea sigue siendo el mismo proyecto que sale en `/courses`, y duplicar
 * su ficha aquí sería empezar a tener dos verdades sobre lo mismo (§16).
 */
function CourseProjects({ courseId }: { courseId: string }) {
  const { data, state } = useApi<{ projects: Project[] }>(
    `/api/courses/${courseId}/projects`
  );

  if (state === 'loading') return <p className="py-10 text-center text-muted">Cargando…</p>;

  if (!data || data.projects.length === 0) {
    return (
      <EmptyState
        title="Sin proyectos publicados"
        description="Cuando alguien publique un proyecto y lo asocie a esta materia, aparecerá aquí."
        action={{ href: '/publish', label: 'Publicar un proyecto' }}
      />
    );
  }

  return <ProjectGrid projects={data.projects} label="Proyectos de la materia" />;
}
