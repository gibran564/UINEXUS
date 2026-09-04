import {
  dataSchemaFor,
  deliverableSchemaFor,
  submissionInputSchema,
  workflowSubmissionInputSchema,
} from '@/lib/academic-schemas';
import { getOwnSubmission } from '@/lib/data/academic';
import {
  canWorkOnStep,
  missingRequiredSteps,
  normalizeEvidence,
  primaryDeliverable,
} from '@/lib/workflow';
import { toSubmission } from '@/lib/data/academic-mappers';
import {
  HttpError,
  errorResponse,
  readJson,
  requireWriter,
  type Actor,
} from '@/lib/server/session';
import { requireAssignmentAccess } from '@/lib/server/course-access';
import { assertOpenForSubmission } from '@/lib/server/deadline';
import { upsertSubmission } from '@/lib/server/academic-writes';
import { assertResourcesBelongTo } from '@/lib/server/resources';
import { LEGACY_STEP_ID } from '@/lib/types';
import { isAcademicFileKeyFor } from '@/lib/aws/s3';
import type {
  AIWorklogData,
  AssignmentRecord,
  MediaData,
  StepEvidence,
  SubmissionData,
  SubmissionRecord,
} from '@/lib/types';

/**
 * MI entrega de esta tarea.
 *
 * Singular en la URL a propósito: sólo existe una por persona y tarea, y no hay
 * ningún hueco donde escribir de quién. El UID sale del token verificado y el
 * identificador de la entrega se deriva de él (`submissionIdFor`), así que
 * «editar la entrega de otro» no es algo que esté prohibido: es algo que no se
 * puede expresar.
 *
 * GET → el borrador guardado, para reabrir el formulario donde se dejó.
 * PUT → guarda borrador (`intent: 'draft'`) o entrega (`intent: 'submit'`).
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    await requireAssignmentAccess(actor, assignmentId);

    const own = await getOwnSubmission(assignmentId, actor.uid);
    return Response.json({ submission: own ? toSubmission(own) : null });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, role } = await requireAssignmentAccess(actor, assignmentId);

    // El profesorado no entrega sus propias tareas. Si alguna vez hiciera falta
    // (una demostración en clase), sería una función distinta y explícita.
    if (role === 'teacher') {
      throw new HttpError(403, 'El profesorado no entrega sus propias tareas.');
    }

    /**
     * La fecha límite se aplica AQUÍ, con la hora del servidor. Deshabilitar el
     * botón en el navegador es cortesía; esto es lo que de verdad cierra la
     * entrega. Cubre también el borrador: pasada la hora no se modifica nada.
     */
    assertOpenForSubmission(assignment);

    const body: unknown = await request.clone().json().catch(() => null);

    /**
     * Dos formas de cuerpo, y se distinguen por su forma y no por el tipo de la
     * tarea: `{ steps: [...] }` es una entrega por pasos y `{ data: {...} }` la
     * de siempre.
     *
     * Se hace así para que un formulario antiguo siga funcionando contra una
     * tarea que hoy se lee como workflow de un paso. Romper ese contrato habría
     * obligado a desplegar cliente y servidor a la vez.
     */
    const isStepped = Boolean(body && typeof body === 'object' && 'steps' in body);

    const saved = isStepped
      ? await saveSteppedSubmission(request, actor, assignment)
      : await saveSingleSubmission(request, actor, assignment);

    return Response.json({ submission: toSubmission(saved) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

/**
 * Entrega de una tarea de un solo paso. Es el camino de siempre, intacto.
 *
 * También guarda la evidencia bajo `LEGACY_STEP_ID` para que la capa de
 * workflow lea lo mismo venga de donde venga.
 */
async function saveSingleSubmission(
  request: Request,
  actor: Actor,
  assignment: AssignmentRecord
): Promise<SubmissionRecord> {
  const input = await readJson(request, submissionInputSchema);

  /**
   * El tipo de entrega lo dicta la TAREA, nunca el cuerpo de la petición.
   * Es lo que impide mandar un AI Worklog donde se pidió una investigación y
   * acabar con entregas que la vista no sabe pintar ni la exportación leer.
   */
  const parsed = dataSchemaFor(assignment.type).safeParse(input.data);
  if (!parsed.success) {
    throw new HttpError(422, parsed.error.issues[0]?.message ?? 'Datos no válidos.');
  }

  const data = await scopeResources(assignment, parsed.data as SubmissionData);

  return upsertSubmission({
    assignment,
    actor,
    data,
    intent: input.intent,
    stepEvidence: {
      [LEGACY_STEP_ID]: normalizeEvidence({ data, stepId: LEGACY_STEP_ID }, LEGACY_STEP_ID),
    },
  });
}

/**
 * Entrega de una tarea de varios pasos.
 *
 * Tres cosas ocurren aquí y las tres son la seguridad de §52:
 *
 *  1. Un paso que no existe en la tarea se descarta. No se puede inventar.
 *  2. Un paso que no le corresponde a esta persona se descarta (`canWorkOnStep`).
 *     Se descarta en silencio en vez de rechazar la petición entera: la docente
 *     puede haber reasignado un paso mientras alguien tenía el formulario
 *     abierto, y devolver 422 lo dejaría sin poder guardar lo que sí es suyo.
 *  3. El contenido se valida contra el ENTREGABLE QUE PIDE EL PASO, no contra
 *     lo que diga el cuerpo.
 */
async function saveSteppedSubmission(
  request: Request,
  actor: Actor,
  assignment: AssignmentRecord
): Promise<SubmissionRecord> {
  const input = await readJson(request, workflowSubmissionInputSchema);

  const stepsById = new Map(assignment.workflow.map((step) => [step.id, step]));
  const existing = await getOwnSubmission(assignment.id, actor.uid);
  const evidence: Record<string, StepEvidence> = { ...(existing?.stepEvidence ?? {}) };

  for (const incoming of input.steps) {
    const step = stepsById.get(incoming.stepId);
    if (!step) continue;
    if (!canWorkOnStep(step, actor.uid)) continue;

    const deliverable = primaryDeliverable(step);
    const parsed = deliverableSchemaFor(deliverable.type).safeParse(incoming.data);
    if (!parsed.success) {
      throw new HttpError(
        422,
        `${step.title}: ${parsed.error.issues[0]?.message ?? 'datos no válidos'}`
      );
    }

    const parsedData = parsed.data as SubmissionData;
    if (['file', 'image', 'video'].includes(deliverable.type)) {
      assertOwnedAcademicFile(parsedData as MediaData, {
        courseId: assignment.courseId,
        uid: actor.uid,
        assignmentId: assignment.id,
        stepId: step.id,
      });
    }

    const data = await scopeResources(assignment, parsedData);
    const previous = evidence[incoming.stepId];

    evidence[incoming.stepId] = normalizeEvidence(
      {
        stepId: incoming.stepId,
        /**
         * `toolId` sólo se acepta si la herramienta es una de las que el paso
         * ofrece. El NOMBRE sí es libre: cuando el paso permite elegir
         * herramienta (§24) el nombre es el único dato que hay, y §47 pide
         * registrarlo sin comprobar nada más.
         */
        toolId:
          incoming.toolId && step.tool.toolIds.includes(incoming.toolId)
            ? incoming.toolId
            : null,
        toolName: incoming.toolName,
        note: incoming.note,
        data,
        startedAt: previous?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      incoming.stepId
    );
  }

  /**
   * No se puede entregar con pasos obligatorios sin hacer. Se dice CUÁLES
   * faltan: «te faltan 2 pasos» obliga a buscarlos, «te falta el paso 3, Miro»
   * no.
   */
  if (input.intent === 'submit') {
    const missing = missingRequiredSteps(assignment.workflow, evidence, actor.uid);
    if (missing.length > 0) {
      throw new HttpError(
        409,
        `Todavía te falta: ${missing.map((step) => step.title).join(', ')}.`
      );
    }
  }

  /**
   * `data` se mantiene sincronizado con el primer paso propio. No es
   * duplicación gratuita: la exportación, el visor docente y la vista conjunta
   * leen `data`, están probados, y no tenían por qué reescribirse para que
   * exista el workflow.
   */
  const first = assignment.workflow.find(
    (step) => canWorkOnStep(step, actor.uid) && evidence[step.id]
  );

  return upsertSubmission({
    assignment,
    actor,
    data: first ? evidence[first.id]!.data : (existing?.data ?? ({} as SubmissionData)),
    intent: input.intent,
    stepEvidence: evidence,
  });
}

function assertOwnedAcademicFile(
  data: MediaData,
  owner: { courseId: string; uid: string; assignmentId: string; stepId: string }
): void {
  if (data.storageKey && !isAcademicFileKeyFor(owner, data.storageKey)) {
    throw new HttpError(422, 'La referencia del archivo no pertenece a esta entrega.');
  }
}

/**
 * Acota a la materia los recursos que un AI Worklog dice haber usado.
 *
 * No comprueba que el estudiante instalara nada —eso no se puede comprobar y
 * §28 dice que no hace falta—, sino que el registro apunte a un recurso real de
 * SU materia y no a un id cualquiera.
 */
async function scopeResources(
  assignment: AssignmentRecord,
  data: SubmissionData
): Promise<SubmissionData> {
  const worklog = data as AIWorklogData;
  if (!Array.isArray(worklog.resourcesUsed)) return data;

  return {
    ...worklog,
    resourcesUsed: await assertResourcesBelongTo(assignment.courseId, worklog.resourcesUsed),
  };
}
