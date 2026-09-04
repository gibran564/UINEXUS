'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ASSIGNMENT_TYPES,
  DELIVERABLE_LABEL,
  SUBMISSION_STATUS_HELP,
  stepActionLabel,
} from '@/lib/constants';
import {
  deleteAssignment,
  useApi,
  type AssignmentDetail as AssignmentDetailData,
  type SubmissionsPage,
} from '@/lib/aula-client';
import {
  AssignmentStatusBadge,
  AulaScreen,
  Crumbs,
  DueDate,
  Notice,
  SubmissionBadge,
  TypeChip,
} from './aula-ui';
import { CopyButton } from './copy-button';
import { CollaborativeDocument } from './collaborative-view';
import { WorkflowProgress } from './workflow-progress';
import { CourseResourceEditor } from './general-resources';
import { SubmissionsPanel } from './submissions-panel';

/**
 * La tarea, vista por quien la abre.
 *
 * §6 pide que el alumnado sepa QUÉ TIENE QUE HACER nada más entrar: objetivo,
 * instrucciones, tipo de entrega y un único botón que lleva al formulario. Por
 * eso la pantalla del alumnado no tiene pestañas ni secciones plegadas: lo que
 * hay que hacer se lee de arriba abajo y termina en el botón.
 *
 * El profesorado, en cambio, viene a otra cosa: ver quién entregó, filtrar,
 * abrir y exportar. Son dos pantallas distintas bajo la misma URL porque son la
 * misma tarea, y el servidor ya decide qué datos manda a cada uno.
 */
export function AssignmentDetail({
  courseId,
  assignmentId,
}: {
  courseId: string;
  assignmentId: string;
}) {
  const { data, state, error, reload } = useApi<AssignmentDetailData>(
    `/api/assignments/${assignmentId}`
  );

  return (
    <AulaScreen state={state} error={error} next={`/aula/${courseId}/tareas/${assignmentId}`}>
      {data && (
        <>
          <Crumbs
            items={[
              { href: '/aula', label: 'Aula' },
              { href: `/aula/${courseId}`, label: data.courseName },
              { label: data.assignment.title },
            ]}
          />

          {data.viewerRole === 'teacher' ? (
            <TeacherView data={data} courseId={courseId} onChanged={reload} />
          ) : (
            <StudentView data={data} courseId={courseId} />
          )}
        </>
      )}
    </AulaScreen>
  );
}

// ---------------------------------------------------------------------------
// Alumnado
// ---------------------------------------------------------------------------

function StudentView({ data, courseId }: { data: AssignmentDetailData; courseId: string }) {
  const { assignment, submission } = data;
  const typeOption = ASSIGNMENT_TYPES.find((option) => option.value === assignment.type);
  const closed = assignment.status === 'closed';
  const isShared = assignment.collaborationMode === 'shared';
  const isWorkflow = assignment.workflow.length > 1;

  /** Los pasos que le tocan. `myStepIds` lo decide el servidor. */
  const mineSteps = new Set(data.myStepIds);
  const myWorkflowSteps = assignment.workflow.filter((step) => mineSteps.has(step.id));

  /**
   * Los conceptos que le tocan a esta persona. `myGroupIds` lo calcula el
   * SERVIDOR: aquí sólo se traduce a nombres para pintarlos. El navegador no
   * decide qué le corresponde a nadie.
   */
  const mine = new Set(data.myGroupIds);
  const seen = new Set<string>();
  const myConcepts = assignment.researchQuestions
    .filter((question) => mine.has(question.groupId))
    .flatMap((question) => {
      if (seen.has(question.groupId)) return [];
      seen.add(question.groupId);
      return [{ groupId: question.groupId, title: question.group ?? question.prompt }];
    });

  const actionLabel = submission
    ? submission.status === 'draft'
      ? 'Continuar tarea'
      : 'Ver o editar mi entrega'
    : (typeOption?.action ?? 'Comenzar tarea');

  return (
    <article className="mt-4 max-w-3xl">
      <header className="border-b border-line pb-6">
        <h1 className="font-display text-h1">{assignment.title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <TypeChip type={assignment.type} />
          <span>
            Entrega: <DueDate value={assignment.dueDate} />
          </span>
          <SubmissionBadge status={submission?.status ?? null} />
        </p>
      </header>

      {assignment.description && (
        <section className="mt-8">
          <h2 className="font-display text-h3">Objetivo</h2>
          <p className="prose-block mt-2 max-w-prose whitespace-pre-line text-muted">
            {assignment.description}
          </p>
        </section>
      )}

      {assignment.instructions && (
        <section className="mt-8">
          <h2 className="font-display text-h3">Instrucciones</h2>
          <p className="prose-block mt-2 max-w-prose whitespace-pre-line text-muted">
            {assignment.instructions}
          </p>
        </section>
      )}

      {assignment.resourceLinks.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-h3">Recursos</h2>
          <ul className="mt-3 space-y-2">
            {assignment.resourceLinks.map((link) => (
              <li key={link.url}>
                {/*
                  `noopener` y `noreferrer` no son decorativos: son enlaces que
                  escribió otra persona y se abren en otra pestaña.
                */}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  {link.label || link.url} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isWorkflow && (
        <section className="mt-8">
          <h2 className="font-display text-h3">Los pasos</h2>
          <p className="mt-1 text-sm text-muted">
            {myWorkflowSteps.length === assignment.workflow.length
              ? 'Esta actividad tiene varios pasos. Los haces en orden.'
              : `De los ${assignment.workflow.length} pasos, te tocan ${myWorkflowSteps.length}.`}
          </p>
          <ol className="mt-4 space-y-2">
            {myWorkflowSteps.map((step, index) => (
              <li key={step.id} className="panel flex flex-wrap items-center gap-3 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="block text-label text-subtle">
                    {stepActionLabel(step.actionType)}
                    {step.tool.toolNames.length > 0 && ` · ${step.tool.toolNames.join(', ')}`}
                    {' · '}
                    {DELIVERABLE_LABEL[step.deliverables[0]?.type ?? 'none']}
                    {!step.required && ' · opcional'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {isShared && (
        <section className="panel mt-8 p-5">
          <p className="meta">Actividad colaborativa</p>
          <h2 className="mt-2 font-display text-h3">Tu aportación</h2>
          {myConcepts.length === 0 ? (
            <p className="mt-2 text-muted">
              No tienes conceptos asignados. Puedes leer lo que aporte el grupo desde la vista
              conjunta.
            </p>
          ) : (
            <>
              <p className="mt-2 text-muted">
                Te {myConcepts.length === 1 ? 'corresponde' : 'corresponden'}{' '}
                {myConcepts.length} {myConcepts.length === 1 ? 'concepto' : 'conceptos'}.
              </p>
              <ol className="mt-3 list-inside list-decimal space-y-1 text-muted">
                {myConcepts.map((concept) => (
                  <li key={concept.groupId}>{concept.title}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-h3">Tipo de entrega</h2>
        <p className="mt-2 text-muted">{typeOption?.label}</p>
        <p className="mt-1 text-sm text-subtle">{typeOption?.helper}</p>
      </section>

      <RecommendedResources resources={data.resources} courseId={courseId} />

      {submission && (
        <div className="mt-8">
          <Notice tone={submission.status === 'needs_changes' ? 'error' : 'info'}>
            {SUBMISSION_STATUS_HELP[submission.status]}
            {submission.teacherNote && ` — «${submission.teacherNote}»`}
          </Notice>
        </div>
      )}

      <div className="mt-8 border-t border-line pt-6">
        {closed ? (
          <Notice>Esta tarea ya está cerrada. No se admiten más entregas.</Notice>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/aula/${courseId}/tareas/${assignment.id}/entrega`}
              className="btn btn-primary btn-lg"
            >
              {isWorkflow ? 'Comenzar la actividad' : isShared ? 'Comenzar mi parte' : actionLabel}
            </Link>
            {isShared && (
              <Link
                href={`/aula/${courseId}/tareas/${assignment.id}/conjunta`}
                className="btn btn-secondary btn-lg"
              >
                Ver la actividad del grupo
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Prompts y Skills que la docente recomienda para esta tarea (§20, §27).
 *
 * Se pintan aquí, en la pantalla que el alumnado abre ANTES de empezar, porque
 * es donde sirven: mirar el prompt sugerido después de haber escrito el propio
 * no ayuda a nadie.
 */
function RecommendedResources({
  resources,
  courseId,
}: {
  resources: AssignmentDetailData['resources'];
  courseId: string;
}) {
  const total = resources.prompts.length + resources.skills.length;
  if (total === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="font-display text-h3">Recursos recomendados</h2>
      <ul className="mt-4 space-y-3">
        {resources.prompts.map((prompt) => (
          <li key={prompt.id} className="panel p-4">
            <p className="meta">Prompt</p>
            <h3 className="mt-1 font-medium">{prompt.title}</h3>
            {prompt.description && (
              <p className="mt-1 text-sm text-muted">{prompt.description}</p>
            )}
            <pre className="mt-3 max-h-40 overflow-y-auto rounded-sm border border-line bg-sunken p-3 font-mono text-sm whitespace-pre-wrap">
              {prompt.prompt}
            </pre>
            <div className="mt-3">
              <CopyButton value={prompt.prompt} label="Copiar prompt" />
            </div>
          </li>
        ))}

        {resources.skills.map((skill) => (
          <li key={skill.id} className="panel p-4">
            <p className="meta">Skill</p>
            <h3 className="mt-1 font-medium">{skill.title}</h3>
            {skill.compatibleTools.length > 0 && (
              <p className="mt-1 text-sm text-subtle">{skill.compatibleTools.join(' · ')}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/aula/${courseId}/recursos/skills/${skill.id}`}
                className="btn btn-secondary btn-sm"
              >
                Ver instalación
              </Link>
              {skill.repositoryUrl && (
                <a
                  href={skill.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  Abrir repositorio ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Profesorado
// ---------------------------------------------------------------------------

function TeacherView({
  data,
  courseId,
  onChanged,
}: {
  data: AssignmentDetailData;
  courseId: string;
  onChanged: () => void;
}) {
  const { assignment } = data;
  const submissions = useApi<SubmissionsPage>(`/api/assignments/${assignment.id}/submissions`);
  const [confirming, setConfirming] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const isWorkflow = assignment.workflow.length > 1;
  const isShared = assignment.collaborationMode === 'shared';

  const [tab, setTab] = useState<'document' | 'submissions' | 'steps'>(
    isWorkflow ? 'steps' : 'document'
  );

  async function remove(): Promise<void> {
    await deleteAssignment(assignment.id);
    window.location.href = `/aula/${courseId}`;
  }

  const progress = submissions.data?.progress;

  return (
    <div className="mt-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="font-display text-h1">{assignment.title}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <TypeChip type={assignment.type} />
            <AssignmentStatusBadge status={assignment.status} />
            <span>
              Entrega: <DueDate value={assignment.dueDate} />
            </span>
            {!assignment.assignedToAll && (
              <span>Asignada a {assignment.assignedTo?.length ?? 0} estudiantes</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/*
            Guardar el proceso como plantilla (§28). Sólo tiene sentido con
            varios pasos: una tarea de uno es más rápido volver a escribirla que
            buscarla en la biblioteca.
          */}
          {isWorkflow && (
            <button
              type="button"
              onClick={() => setSavingTemplate(true)}
              className="btn btn-secondary btn-sm"
            >
              Guardar como plantilla
            </button>
          )}
          <Link
            href={`/aula/${courseId}/tareas/${assignment.id}/editar`}
            className="btn btn-secondary btn-sm"
          >
            Editar
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="btn btn-ghost btn-sm"
          >
            Borrar
          </button>
        </div>
      </header>

      {savingTemplate && (
        <div className="mt-4">
          <CourseResourceEditor
            courseId={courseId}
            isTeacher
            initialType="workflow"
            /*
              Los pasos van tal cual: el servidor les pondrá ids propios al
              guardarlos, y al crear una tarea desde la plantilla se clonan otra
              vez con ids nuevos. La tarea de la que salió no se toca.
            */
            initialSteps={assignment.workflow}
            onDone={() => {
              setSavingTemplate(false);
              onChanged();
            }}
            onCancel={() => setSavingTemplate(false)}
          />
        </div>
      )}

      {confirming && (
        <div className="panel mt-4 p-4">
          <p className="text-sm">
            Se borra la tarea. Las entregas que ya hizo el alumnado <strong>no</strong> se borran.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void remove()} className="btn btn-danger btn-sm">
              Sí, borrar la tarea
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn btn-ghost btn-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {progress && (
        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Entregaron" value={`${progress.submitted} / ${progress.assigned}`} />
          <Metric label="Pendientes" value={progress.pending} />
          <Metric label="Revisados" value={progress.reviewed} />
        </dl>
      )}

      {isWorkflow || isShared ? (
        <>
          {/*
            En una actividad colaborativa la pestaña que se abre primero es la
            vista conjunta, no la lista de entregas: el documento ES el
            resultado, y la lista de quién entregó qué es el detalle.
          */}
          <div className="mt-8 border-b border-line">
            <div role="tablist" aria-label="Secciones de la actividad" className="flex gap-1">
              {[
                ...(isWorkflow ? [{ value: 'steps' as const, label: 'Avance por paso' }] : []),
                ...(isShared ? [{ value: 'document' as const, label: 'Vista conjunta' }] : []),
                { value: 'submissions' as const, label: 'Entregas' },
              ].map((item) => (
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
            {tab === 'steps' ? (
              <WorkflowProgress assignmentId={assignment.id} courseId={courseId} />
            ) : tab === 'document' ? (
              <CollaborativeDocument assignmentId={assignment.id} />
            ) : (
              <SubmissionsPanel
                assignment={assignment}
                courseId={courseId}
                page={submissions.data}
                state={submissions.state}
                onReviewed={() => {
                  submissions.reload();
                  onChanged();
                }}
              />
            )}
          </div>
        </>
      ) : (
        <div className="mt-8">
          <SubmissionsPanel
            assignment={assignment}
            courseId={courseId}
            page={submissions.data}
            state={submissions.state}
            onReviewed={() => {
              submissions.reload();
              onChanged();
            }}
          />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="mt-1 font-display text-h2 tabular-nums">{value}</dd>
    </div>
  );
}
