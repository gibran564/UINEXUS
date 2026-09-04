import { assignmentInputSchema } from '@/lib/academic-schemas';
import { canAnswerGroup, getOwnSubmission } from '@/lib/data/academic';
import { workableStepIds } from '@/lib/workflow';
import {
  assertResourcesBelongTo,
  resolveResources,
  resolveStepTools,
} from '@/lib/server/resources';
import { toAssignment, toSubmission } from '@/lib/data/academic-mappers';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import {
  requireAssignmentAccess,
  requireAssignmentTeacher,
  resolveMembers,
} from '@/lib/server/course-access';
import {
  buildWorkflowSteps,
  deleteAssignment,
  updateAssignment,
} from '@/lib/server/academic-writes';

/**
 * Una tarea.
 *
 * GET    → la tarea. Para el alumnado incluye SU entrega, que es lo que la
 *          pantalla necesita para decidir entre «Comenzar» y «Continuar».
 * PATCH  → editar. Sólo docente de la materia.
 * DELETE → borrar la tarea. Las entregas no se borran en cascada: son trabajo
 *          de otras personas (ver `academic-writes.ts`).
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course, role } = await requireAssignmentAccess(actor, assignmentId);

    const own = role === 'teacher' ? null : await getOwnSubmission(assignment.id, actor.uid);

    /**
     * Los conceptos que le tocan a QUIEN PREGUNTA. El alumnado necesita saber
     * cuáles son suyos y no le corresponde la lista completa de quién hace qué,
     * así que se le manda esto en vez de `groupAssignments` (ver
     * `toAssignment` en lib/data/academic-mappers.ts).
     *
     * En modo individual no hay reparto: son todos los conceptos.
     */
    const myGroupIds =
      assignment.collaborationMode === 'shared'
        ? [...new Set(assignment.researchQuestions.map((question) => question.groupId))].filter(
            (groupId) => canAnswerGroup(assignment, groupId, actor.uid)
          )
        : [];

    return Response.json({
      assignment: toAssignment(assignment, { viewerRole: role, roster: course.students }),
      courseName: course.name,
      courseId: course.id,
      viewerRole: role,
      submission: own ? toSubmission(own) : null,
      myGroupIds,
      /**
       * Los pasos que le tocan a quien pregunta. Lo calcula el SERVIDOR y no el
       * navegador: el formulario sólo lo usa para no pintar pasos que de todas
       * formas serían descartados al guardar.
       */
      myStepIds:
        role === 'teacher'
          ? assignment.workflow.map((step) => step.id)
          : [...workableStepIds(assignment.workflow, actor.uid)],
      // Los recursos recomendados se RESUELVEN aquí: la tarea guarda sólo ids
      // (§20 y §27), así que el navegador recibe el contenido vigente y no una
      // copia congelada del día que se creó la tarea.
      resources: await resolveResources(assignment.resources),
      /**
       * Fichas de las herramientas que mencionan los pasos. Sirven para
       * enriquecer —enlace y descripción—, nunca para decidir qué se muestra:
       * el nombre vive en el paso y sobrevive a que el recurso desaparezca.
       */
      stepTools: await resolveStepTools(course.id, assignment.workflow),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course } = await requireAssignmentTeacher(actor, assignmentId);

    const input = await readJson(request, assignmentInputSchema);
    const assignedUids =
      input.assignedHandles == null
        ? null
        : resolveMembers(course, input.assignedHandles).map((member) => member.uid);

    /**
     * El reparto por concepto tambien se traduce de handles a UID contra la
     * lista de la materia. Es la misma defensa que en `assignedHandles`: no se
     * puede repartir trabajo a alguien que no esta inscrito, porque su handle
     * simplemente no resuelve.
     */
    const groupAssignments = input.groupAssignments.map((entry) => ({
      groupId: entry.groupId,
      assignedTo: resolveMembers(course, entry.assignedTo).map((member) => member.uid),
    }));


    // Igual que al crear: los recursos tienen que ser de esta materia.
    const resources = await assertResourcesBelongTo(assignment.courseId, input.resources);


    /**
     * Los responsables de cada paso se traducen de handles a UID contra la
     * lista de la materia, igual que el resto de asignaciones: un handle que no
     * esta inscrito no resuelve, asi que no se puede repartir un paso a alguien
     * de fuera.
     */
    const workflow = buildWorkflowSteps(input.workflow, (handles) =>
      resolveMembers(course, handles).map((member) => member.uid)
    );

    const updated = await updateAssignment(
      assignment,
      { ...input, resources },
      assignedUids,
      groupAssignments,
      workflow
    );

    return Response.json({
      assignment: toAssignment(updated, { viewerRole: 'teacher', roster: course.students }),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    await requireAssignmentTeacher(actor, assignmentId);
    await deleteAssignment(assignmentId);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
