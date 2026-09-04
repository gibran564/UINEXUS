'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveSubmission, useApi, type AssignmentDetail } from '@/lib/aula-client';
import type {
  AIWorklogData,
  ExternalLinkData,
  FreeformData,
  ResearchData,
  WebProjectData,
} from '@/lib/types';
import { formatDueLabel, isPastDue } from '@/lib/due-date';
import { AulaScreen, Crumbs, Notice, SubmissionBadge } from './aula-ui';
import { WorkflowRunner } from './workflow-runner';
import {
  FreeformFields,
  LinkFields,
  ProjectFields,
  ResearchFields,
  WorklogFields,
} from './deliverable-fields';

/**
 * El formulario de entrega.
 *
 * Un solo componente para los cinco tipos porque todo lo que los rodea es
 * idéntico —cargar el borrador, guardar, entregar, avisar de errores— y sólo
 * cambian los campos de en medio. Separarlos en cinco pantallas duplicaría esa
 * mecánica cinco veces, que es donde luego aparecen los cinco comportamientos
 * ligeramente distintos.
 *
 * Dos cosas que la pantalla garantiza:
 *
 *  · Guardar borrador y entregar son botones DISTINTOS. Nunca se entrega sin
 *    querer: guardar no manda nada al profesorado.
 *  · Una entrega devuelta («requiere cambios») se puede volver a editar y
 *    entregar. El estado vuelve a «entregado» y la revisión anterior se
 *    invalida, porque lo revisado ya no es esto.
 */
export function SubmissionForm({
  courseId,
  assignmentId,
}: {
  courseId: string;
  assignmentId: string;
}) {
  const router = useRouter();
  const { data, state, error, reload } = useApi<AssignmentDetail>(
    `/api/assignments/${assignmentId}`
  );

  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // El borrador guardado se carga UNA vez. Sin la guarda, cada recarga de la
  // tarea pisaría lo que la persona lleva escrito sin guardar.
  useEffect(() => {
    if (hydrated || !data) return;
    // El contenido guardado es de uno de los cinco tipos de entrega; el
    // formulario lo maneja como un saco de campos y el servidor lo vuelve a
    // validar contra el tipo de la tarea al guardar, que es donde importa.
    setPayload((data.submission?.data as unknown as Record<string, unknown>) ?? {});
    setHydrated(true);
  }, [data, hydrated]);

  const patch = (changes: Record<string, unknown>) =>
    setPayload((current) => ({ ...current, ...changes }));

  async function save(intent: 'draft' | 'submit'): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await saveSubmission(assignmentId, intent, payload);
      if (intent === 'submit') {
        router.push(`/aula/${courseId}/tareas/${assignmentId}`);
        return;
      }
      setMessage({ tone: 'success', text: 'Borrador guardado. Puedes seguir en otro momento.' });
    } catch (caught) {
      setMessage({
        tone: 'error',
        text: caught instanceof Error ? caught.message : 'No se pudo guardar.',
      });
    } finally {
      setBusy(false);
    }
  }

  const assignment = data?.assignment;

  /**
   * Pasada la fecha límite no se entrega ni se guarda borrador. Se calcula con
   * el reloj del navegador para poder decirlo antes de que alguien escriba, y
   * el servidor lo vuelve a comprobar con el suyo al guardar: esto es aviso, no
   * la barrera (§12).
   */
  const closed = assignment ? isPastDue(assignment) : false;

  return (
    <AulaScreen
      state={state}
      error={error}
      next={`/aula/${courseId}/tareas/${assignmentId}/entrega`}
    >
      {assignment && (
        <div className="max-w-3xl">
          <Crumbs
            items={[
              { href: '/aula', label: 'Aula' },
              { href: `/aula/${courseId}`, label: data.courseName },
              { href: `/aula/${courseId}/tareas/${assignmentId}`, label: assignment.title },
              { label: 'Mi entrega' },
            ]}
          />

          <header className="mt-4 border-b border-line pb-5">
            <h1 className="font-display text-h1">{assignment.title}</h1>
            <p className="mt-3">
              <SubmissionBadge status={data.submission?.status ?? null} />
            </p>
            {data.submission?.teacherNote && (
              <div className="mt-4">
                <Notice tone={data.submission.status === 'needs_changes' ? 'error' : 'info'}>
                  Comentario de tu docente: «{data.submission.teacherNote}»
                </Notice>
              </div>
            )}
          </header>

          {/*
            Una actividad de varios pasos se ejecuta con su propio recorrido:
            índice de pasos, estado y evidencia paso a paso. Una de un solo paso
            conserva el formulario de siempre, sin envoltorio (§20).
          */}
          {closed && (
            <div className="mt-6">
              <Notice tone="error">
                Entrega cerrada. La fecha límite fue el {formatDueLabel(assignment)}.
              </Notice>
            </div>
          )}

          {assignment.workflow.length > 1 ? (
            <div className="mt-8">
              <WorkflowRunner
                data={data}
                courseId={courseId}
                assignmentId={assignmentId}
                closed={closed}
                onSaved={reload}
              />
            </div>
          ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save('submit');
            }}
            className="mt-8 space-y-6"
          >
            {assignment.type === 'research' && (
              <ResearchFields
                questions={assignment.researchQuestions}
                /**
                 * En modo colaborativo sólo se pintan los conceptos propios.
                 * `myGroupIds` viene del SERVIDOR, y el servidor descarta al
                 * guardar cualquier respuesta a un apartado ajeno: esto es
                 * comodidad, no la protección (ver §14 y
                 * `guardCollaborativeAnswers`).
                 */
                only={assignment.collaborationMode === 'shared' ? new Set(data.myGroupIds) : null}
                data={payload as unknown as ResearchData}
                onChange={(answers) => patch({ answers })}
              />
            )}

            {assignment.type === 'ai_worklog' && (
              <WorklogFields
                data={payload as unknown as AIWorklogData}
                onChange={patch}
                resources={data.resources}
              />
            )}

            {assignment.type === 'external_link' && (
              <LinkFields data={payload as unknown as ExternalLinkData} onChange={patch} />
            )}

            {assignment.type === 'web_project' && (
              <ProjectFields data={payload as unknown as WebProjectData} onChange={patch} />
            )}

            {assignment.type === 'freeform' && (
              <FreeformFields data={payload as unknown as FreeformData} onChange={patch} />
            )}

            {message && <Notice tone={message.tone}>{message.text}</Notice>}

            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              <button
                type="submit"
                disabled={busy || closed}
                className="btn btn-primary"
              >
                {closed ? 'Entrega cerrada' : busy ? 'Guardando…' : 'Entregar'}
              </button>
              <button
                type="button"
                disabled={busy || closed}
                onClick={() => void save('draft')}
                className="btn btn-secondary"
              >
                Guardar borrador
              </button>
              <Link
                href={`/aula/${courseId}/tareas/${assignmentId}`}
                className="btn btn-ghost"
              >
                Volver a la tarea
              </Link>
            </div>
          </form>
          )}
        </div>
      )}
    </AulaScreen>
  );
}
