import type {
  AssignmentRecord,
  CollaborativeSection,
  CollaborativeView,
  Contribution,
  ContributionState,
  CourseMember,
  CourseMemberRecord,
  CourseRecord,
  CourseRole,
  ResearchData,
  ResearchQuestion,
  SubmissionRecord,
  WorkflowGroupView,
} from './types';
import { canWorkOnStep, hasContent } from './workflow';

/**
 * La vista conjunta de una actividad colaborativa.
 *
 * Este módulo es el corazón de la iteración 3 y es DELIBERADAMENTE puro: entra
 * la tarea, la materia y las entregas; sale el documento. No toca red ni base
 * de datos, así que se puede probar entero sin nube.
 *
 * ## Por qué es derivada y no persistida
 *
 * La tentación evidente al sustituir un documento compartido de Drive es
 * guardar «el documento final». Sería un error: ese documento tendría el mismo
 * contenido que las entregas, en otro sitio, y las dos copias se separarían en
 * cuanto alguien editara su parte y algo fallara al propagar. Aquí no hay nada
 * que propagar. La única verdad son las `Submission`, y el documento se compone
 * al leer, cada vez.
 *
 * ## Por qué no hay edición simultánea
 *
 * Cada persona escribe SU aportación, en SU entrega. Nadie escribe sobre el
 * registro de nadie. Eso elimina de raíz los conflictos, la pérdida de texto y
 * la necesidad de CRDT, transformación operacional o websockets: el problema
 * que resuelven no existe cuando dos personas nunca tocan el mismo dato.
 *
 * El precio es que dos estudiantes que compartan un concepto producen dos
 * aportaciones separadas en vez de un texto común. Se decidió que eso es una
 * VENTAJA académica y no una limitación: la docente ve quién escribió qué, que
 * es exactamente lo que un documento compartido de Drive vuelve imposible.
 */

const RANK: Record<ContributionState, number> = {
  missing: 0,
  draft: 1,
  needs_changes: 2,
  submitted: 3,
  reviewed: 4,
};

const publicMember = (member: CourseMemberRecord): CourseMember => ({
  handle: member.handle,
  displayName: member.displayName,
  avatarUrl: member.avatarUrl ?? null,
});

/** El estado menos avanzado, compartido por conceptos y pasos. */
export function aggregateContributionState(
  states: readonly ContributionState[]
): ContributionState {
  if (states.length === 0) return 'missing';
  return states.reduce((worst, current) =>
    RANK[current] < RANK[worst] ? current : worst
  );
}

/** Los conceptos de la actividad, en el orden en que la docente los escribió. */
export function sectionsOf(
  assignment: AssignmentRecord
): { groupId: string; title: string; questions: ResearchQuestion[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, { title: string; questions: ResearchQuestion[] }>();

  for (const question of assignment.researchQuestions) {
    if (!byGroup.has(question.groupId)) {
      order.push(question.groupId);
      byGroup.set(question.groupId, {
        // Un campo suelto sin concepto se muestra bajo su propio enunciado en
        // vez de bajo un encabezado vacío.
        title: question.group ?? question.prompt,
        questions: [],
      });
    }
    byGroup.get(question.groupId)?.questions.push(question);
  }

  return order.map((groupId) => ({ groupId, ...byGroup.get(groupId)! }));
}

/**
 * Estado de una aportación, derivado del estado de la entrega que la contiene.
 *
 * No hay una máquina de estados nueva para los apartados, y es a propósito: el
 * ciclo de vida ya lo lleva `Submission`, y duplicarlo por concepto obligaría a
 * mantener dos verdades sobre lo mismo. Lo único que se añade es `missing`, que
 * no es un estado guardado sino la ausencia de respuesta.
 */
function stateOf(
  submission: SubmissionRecord | undefined,
  answered: boolean
): ContributionState {
  if (!submission || !answered) return 'missing';
  return submission.status;
}

/** ¿Escribió algo esta persona en alguno de los campos de este concepto? */
function hasAnswer(
  submission: SubmissionRecord | undefined,
  questions: readonly ResearchQuestion[]
): boolean {
  if (!submission) return false;
  const answers = (submission.data as ResearchData).answers ?? [];
  const ids = new Set(questions.map((question) => question.id));
  return answers.some((answer) => ids.has(answer.questionId) && answer.value.trim() !== '');
}

function answersFor(
  submission: SubmissionRecord | undefined,
  questions: readonly ResearchQuestion[]
): Contribution['answers'] {
  const stored = new Map(
    ((submission?.data as ResearchData | undefined)?.answers ?? []).map((answer) => [
      answer.questionId,
      answer.value,
    ])
  );
  return questions.map((question) => ({
    questionId: question.id,
    prompt: question.prompt,
    value: stored.get(question.id) ?? '',
  }));
}

export interface CollaborativeInput {
  assignment: AssignmentRecord;
  course: CourseRecord;
  submissions: readonly SubmissionRecord[];
  viewerRole: CourseRole;
  /** UID de quien mira. Decide qué aportaciones ajenas puede ver. */
  viewerUid: string;
}

/**
 * ¿Puede quien mira ver la aportación de otra persona?
 *
 * El profesorado, siempre. Para el alumnado manda `contributionVisibility`:
 *
 *   · `group`        → sí. Es el caso normal de un glosario compartido: el
 *                      valor del ejercicio está justamente en leer al resto.
 *   · `own`          → no. Sólo lo suyo.
 *   · `after_submit` → sólo cuando ya entregó lo suyo. Evita que se copie la
 *                      respuesta del compañero antes de haber pensado la propia,
 *                      sin cerrar la lectura del grupo después.
 */
export function canSeeOthers(input: {
  viewerRole: CourseRole;
  visibility: AssignmentRecord['contributionVisibility'];
  viewerHasSubmitted: boolean;
}): boolean {
  if (input.viewerRole === 'teacher') return true;
  if (input.visibility === 'group') return true;
  if (input.visibility === 'own') return false;
  return input.viewerHasSubmitted;
}

export function buildCollaborativeView(input: CollaborativeInput): CollaborativeView {
  const { assignment, course, submissions, viewerRole, viewerUid } = input;

  const byUid = new Map(submissions.map((submission) => [submission.studentId, submission]));
  const memberByUid = new Map(course.students.map((member) => [member.uid, member]));

  const own = byUid.get(viewerUid);
  const viewerHasSubmitted = Boolean(own && own.status !== 'draft');
  const seesOthers = canSeeOthers({
    viewerRole,
    visibility: assignment.contributionVisibility,
    viewerHasSubmitted,
  });

  const sections: CollaborativeSection[] = sectionsOf(assignment).map((section) => {
    const entry = assignment.groupAssignments.find((item) => item.groupId === section.groupId);
    const responsibleUids = entry?.assignedTo ?? [];

    /**
     * Quién puede aparecer en este apartado. Si hay responsables, ellos; si no,
     * el concepto está abierto y aparece cualquiera que haya escrito algo. No
     * se lista a todo el grupo como «pendiente» en un concepto abierto: sería
     * decir que treinta personas deben doce conceptos cada una.
     */
    const candidates: CourseMemberRecord[] =
      responsibleUids.length > 0
        ? responsibleUids.flatMap((uid) => {
            const member = memberByUid.get(uid);
            return member ? [member] : [];
          })
        : course.students.filter((member) => hasAnswer(byUid.get(member.uid), section.questions));

    const contributions: Contribution[] = candidates
      .filter((member) => seesOthers || member.uid === viewerUid)
      .map((member) => {
        const submission = byUid.get(member.uid);
        const answered = hasAnswer(submission, section.questions);
        return {
          author: publicMember(member),
          state: stateOf(submission, answered),
          updatedAt: submission?.updatedAt ?? null,
          answers: answersFor(submission, section.questions),
        };
      });

    /**
     * Estado del apartado en conjunto: el MENOS avanzado de sus responsables.
     * Si tres personas comparten un concepto y una no ha empezado, el apartado
     * no está terminado. Decir lo contrario haría que el recuento del panel
     * docente mintiera justo sobre lo que se usa para decidir a quién recordar.
     */
    const relevant =
      responsibleUids.length > 0
        ? responsibleUids.map((uid) => {
            const submission = byUid.get(uid);
            return stateOf(submission, hasAnswer(submission, section.questions));
          })
        : candidates.map((member) => {
            const submission = byUid.get(member.uid);
            return stateOf(submission, hasAnswer(submission, section.questions));
          });

    const state = aggregateContributionState(relevant);

    return {
      groupId: section.groupId,
      title: section.title,
      questions: section.questions,
      responsibles: candidates
        .filter(() => responsibleUids.length > 0)
        .map(publicMember),
      contributions,
      state,
    };
  });

  const done = sections.filter(
    (section) => section.state === 'submitted' || section.state === 'reviewed'
  ).length;
  const drafting = sections.filter(
    (section) => section.state === 'draft' || section.state === 'needs_changes'
  ).length;

  return {
    assignmentId: assignment.id,
    title: assignment.title,
    courseName: course.name,
    collaborationMode: assignment.collaborationMode,
    contributionVisibility: assignment.contributionVisibility,
    sections,
    progress: {
      total: sections.length,
      done,
      drafting,
      missing: sections.length - done - drafting,
    },
    viewerRole,
  };
}

/**
 * Resultado grupal de un workflow.
 *
 * Se deriva siempre de tarea + materia + entregas. La audiencia nace de la
 * tarea y del paso, no de quien ya entregó; por eso también aparecen las
 * personas que todavía no tienen evidencia. Cada contribución conserva su
 * autoría y su propia evidencia, sin construir un documento compartido.
 */
export function buildWorkflowGroupView(
  assignment: AssignmentRecord,
  course: CourseRecord,
  submissions: readonly SubmissionRecord[]
): WorkflowGroupView {
  const byUid = new Map(submissions.map((submission) => [submission.studentId, submission]));
  const assignmentAudience =
    assignment.assignedTo === null
      ? course.students
      : course.students.filter((member) => assignment.assignedTo?.includes(member.uid));

  const steps = assignment.workflow.map((step) => {
    const responsibles = assignmentAudience.filter((member) => canWorkOnStep(step, member.uid));
    const contributions = responsibles.map((member) => {
      const submission = byUid.get(member.uid);
      const storedEvidence = submission?.stepEvidence[step.id];
      const answered = hasContent(storedEvidence);

      return {
        author: publicMember(member),
        state: stateOf(submission, answered),
        submissionId: submission?.id ?? null,
        evidence: storedEvidence ?? null,
        submittedAt: submission?.submittedAt ?? null,
        reviewedAt: submission?.reviewedAt ?? null,
        updatedAt: submission?.updatedAt ?? null,
      };
    });

    return {
      id: step.id,
      order: step.order,
      title: step.title,
      description: step.description,
      instructions: step.instructions,
      actionType: step.actionType,
      required: step.required,
      toolNames: step.tool.toolNames,
      deliverables: step.deliverables,
      responsibles: responsibles.map(publicMember),
      state: aggregateContributionState(contributions.map((item) => item.state)),
      expectedParticipants: contributions.length,
      withEvidence: contributions.filter((item) => hasContent(item.evidence ?? undefined)).length,
      contributions,
    };
  });

  return {
    assignmentId: assignment.id,
    title: assignment.title,
    courseName: course.name,
    steps,
  };
}

/**
 * Reparto automático por turnos (§9).
 *
 * Round-robin y nada más: reparte los conceptos entre las personas elegidas en
 * orden. No hay balanceo por carga previa, ni por nota, ni por dificultad
 * estimada del concepto, porque nada de eso se puede calcular bien y todo se
 * puede corregir a mano después, que es lo que la docente va a querer hacer de
 * todas formas.
 *
 * Devuelve el reparto propuesto; NO lo guarda. Publicar es un paso aparte.
 */
export function distributeRoundRobin(
  groupIds: readonly string[],
  handles: readonly string[]
): { groupId: string; assignedTo: string[] }[] {
  if (handles.length === 0) return groupIds.map((groupId) => ({ groupId, assignedTo: [] }));
  return groupIds.map((groupId, index) => ({
    groupId,
    assignedTo: [handles[index % handles.length]!],
  }));
}
