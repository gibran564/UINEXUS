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
import { LEGACY_STEP_ID } from '@/lib/types';
import {
  activityState,
  humanizeSubmitError,
  type StudentWork,
} from '@/lib/student-activity';
import { formatDueLabel, isPastDue } from '@/lib/due-date';
import { AulaScreen, Crumbs, DueDate, Notice } from './aula-ui';
import { ActivityStateChip } from './student-work';
import { WorkflowRunner } from './workflow-runner';
import {
  FreeformFields,
  LinkFields,
  ProjectFields,
  ResearchFields,
  WorklogFields,
} from './deliverable-fields';

/**
 * Hacer y entregar una actividad.
 *
 * La pantalla empieza por lo que hay que hacer —qué actividad es, para cuándo,
 * por dónde va— y termina en la entrega. No empieza por un formulario: alguien
 * que abre esto desde el móvil en el pasillo tiene que poder situarse en dos
 * segundos.
 *
 * ## Qué recorrido se usa
 *
 * Una actividad con partes PROPIAS se hace con el recorrido por partes, aunque
 * tenga una sola. El formulario de siempre no sabe pintar lo que pide una
 * parte: dispone según el TIPO de la actividad —investigación, registro de IA,
 * proyecto, enlace, entrega libre— y una actividad por partes no es ninguno de
 * esos cinco. Antes esto se decidía por `workflow.length > 1`, y una actividad
 * de una sola parte que pidiera un laboratorio o código se quedaba sin nada que
 * rellenar. La señal canónica es `assignment.type`.
 *
 * El formulario de siempre se conserva íntegro para las actividades anteriores,
 * que son exactamente las que sabe pintar.
 *
 * ## Guardar y entregar son cosas distintas
 *
 * Y se dice, no se deja adivinar: guardar sólo lo ve quien escribe, entregar se
 * lo manda al profesorado y congela una copia. Entregar pide confirmación; una
 * entrega que sale sin querer no se puede «des-entregar» sin volver a
 * trabajarla.
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
  const [confirming, setConfirming] = useState(false);

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
      setConfirming(false);
      setMessage({
        tone: 'success',
        text: 'Guardado. Sólo lo ves tú. Puedes cerrar y seguir en otro momento.',
      });
      reload();
    } catch (caught) {
      setConfirming(false);
      setMessage({
        tone: 'error',
        text: humanizeSubmitError(
          caught instanceof Error ? caught.message : 'No se pudo guardar.'
        ),
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
              { label: 'Mi trabajo' },
            ]}
          />

          <header className="mt-4 border-b border-line pb-5">
            <h1 className="font-display text-h1">{assignment.title}</h1>
            <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
              <ActivityStateChip
                state={activityState({
                  status: data.submission?.status ?? null,
                  submittedAt: data.submission?.submittedAt ?? null,
                  dueAt: assignment.dueAt,
                  // Sólo las partes de quien mira: su estado es el suyo, no el
                  // del grupo. `myStepIds` lo decide el servidor.
                  parts: assignment.workflow.filter((part) => data.myStepIds.includes(part.id)),
                  work: workFrom(data, payload),
                })}
              />
              <span>
                Entrega: <DueDate value={assignment.dueDate} dueAt={assignment.dueAt} />
              </span>
            </p>
            {data.submission?.teacherNote && (
              <div className="mt-4">
                <Notice tone={data.submission.status === 'needs_changes' ? 'error' : 'info'}>
                  Comentario de tu docente: «{data.submission.teacherNote}»
                </Notice>
              </div>
            )}
            {/*
              Las instrucciones siguen a mano mientras se trabaja, pero plegadas:
              quien ya las leyó en la ficha no necesita volver a recorrerlas cada
              vez que abre esta pantalla, y quien las necesita no debería tener
              que ir a buscarlas a otra página.
            */}
            {(assignment.description || assignment.instructions) && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-accent">
                  Ver el objetivo y las instrucciones
                </summary>
                <div className="mt-3 space-y-3 border-l-2 border-line pl-4">
                  {assignment.description && (
                    <p className="prose-block max-w-prose whitespace-pre-line text-sm text-muted">
                      {assignment.description}
                    </p>
                  )}
                  {assignment.instructions && (
                    <p className="prose-block max-w-prose whitespace-pre-line text-sm text-muted">
                      {assignment.instructions}
                    </p>
                  )}
                </div>
              </details>
            )}
          </header>

          {closed && (
            <div className="mt-6">
              <Notice tone="error">
                Entrega cerrada. La fecha límite fue el {formatDueLabel(assignment)}.
              </Notice>
            </div>
          )}

          {assignment.type === 'workflow' ? (
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
                setConfirming(true);
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
                  conclusionMode={
                    assignment.workflow[0]?.deliverables[0]?.conclusionMode ?? 'optional'
                  }
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

              <section aria-labelledby="entregar" className="border-t border-line pt-6">
                <h2 id="entregar" className="font-display text-h3">
                  Entregar
                </h2>
                <p className="mt-1 max-w-prose text-sm text-muted">
                  Guardar deja tu trabajo a medias y sólo lo ves tú. Entregar se lo manda a tu
                  docente.
                </p>

                {confirming ? (
                  <div className="panel mt-4 p-4">
                    <p className="text-sm">
                      <strong>¿Entregar esta actividad?</strong> Se guarda una copia de tu trabajo
                      tal y como está ahora, y eso es lo que verá tu docente.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void save('submit')}
                        className="btn btn-primary"
                      >
                        {busy ? 'Entregando…' : 'Sí, entregar'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(false)}
                        className="btn btn-ghost"
                      >
                        Todavía no
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="submit" disabled={busy || closed} className="btn btn-primary">
                      {closed ? 'Entrega cerrada' : 'Entregar actividad'}
                    </button>
                    <button
                      type="button"
                      disabled={busy || closed}
                      onClick={() => void save('draft')}
                      className="btn btn-secondary"
                    >
                      {busy ? 'Guardando…' : 'Guardar y seguir después'}
                    </button>
                    <Link
                      href={`/aula/${courseId}/tareas/${assignmentId}`}
                      className="btn btn-ghost"
                    >
                      Volver a la actividad
                    </Link>
                  </div>
                )}
              </section>
            </form>
          )}
        </div>
      )}
    </AulaScreen>
  );
}

/**
 * Lo hecho, mirado igual venga del recorrido por partes o del formulario de
 * siempre.
 *
 * En el formulario de siempre lo escrito vive en `payload` y todavía no es
 * evidencia de ninguna parte, así que se envuelve bajo `LEGACY_STEP_ID`, que es
 * justo el identificador que la lectura le da al paso sintetizado. Así el
 * estado de la actividad se calcula con la misma función en los dos casos en
 * vez de con dos reglas que acabarían discrepando.
 */
function workFrom(data: AssignmentDetail, payload: Record<string, unknown>): StudentWork {
  if (data.assignment.type === 'workflow') {
    return { evidence: data.submission?.stepEvidence ?? {}, labs: new Set(data.myLabs) };
  }

  return {
    evidence: {
      [LEGACY_STEP_ID]: {
        stepId: LEGACY_STEP_ID,
        toolId: null,
        toolName: '',
        startedAt: null,
        completedAt: null,
        data: payload as never,
        note: '',
      },
    },
  };
}
