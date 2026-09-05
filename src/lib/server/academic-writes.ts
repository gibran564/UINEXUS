import 'server-only';

import { randomUUID } from 'node:crypto';
import { DeleteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import {
  answerableQuestionIds,
  derivedGroupId,
  getOwnSubmission,
  normalizeCourse,
  submissionIdFor,
} from '../data/academic';
import { ACADEMIC_LIMITS } from '../constants';
import type { AssignmentInput, WorkflowStepInput } from '../academic-schemas';
import { slugify } from '../slug';
import { assertAcyclicWorkflow } from '../workflow';
import type {
  AIProvider,
  AssignmentRecord,
  CourseMemberRecord,
  CourseResourceRecord,
  CourseRecord,
  GroupAssignmentRecord,
  PromptTemplateRecord,
  StepEvidence,
  WorkflowStepRecord,
  SkillResourceRecord,
  SubmissionData,
  SubmissionRecord,
  SubmissionStatus,
} from '../types';
import type { ResourceStatus } from '../types';
import { HttpError, type Actor } from './session';

/**
 * Escrituras de la capa académica.
 *
 * Mismo contrato que `writes.ts`: quien llama YA comprobó el permiso con
 * `course-access.ts`; lo que se garantiza aquí es que el dato guardado sea
 * coherente pase lo que pase por la petición.
 *
 * La defensa, igual que en proyectos, es que ninguna escritura vuelca el objeto
 * que llegó por la red: todas construyen el registro campo a campo. Por eso no
 * hay forma de que llegue un `studentId`, un `reviewedBy` o un `status:
 * 'reviewed'` desde el navegador aunque se envíen en el cuerpo.
 */

function db() {
  const client = getDynamo();
  if (!client) throw new HttpError(503, 'La base de datos no está disponible.');
  return client;
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Materias
// ---------------------------------------------------------------------------

/** Periodo académico en curso, con el formato que ya usaban los cursos. */
function currentTerm(): string {
  const now = new Date();
  const half = now.getMonth() < 6 ? 'Ene-Jun' : 'Ago-Dic';
  return `${half} ${now.getFullYear()}`;
}

/**
 * Código de acceso de seis caracteres.
 *
 * Sin I, O, 0 ni 1: el código se dicta en voz alta en un aula y se teclea mal.
 * Quitar los caracteres que se confunden cuesta 4 símbolos de entropía y ahorra
 * la mitad de los «no me deja entrar».
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCourseCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export interface CourseInput {
  name: string;
  code?: string | null;
  description: string;
  academicPeriod?: string | null;
  institution: string;
  visibility: 'public' | 'private';
}

const memberOf = (actor: Actor): CourseMemberRecord => ({
  uid: actor.uid,
  handle: actor.profile.handle,
  displayName: actor.profile.displayName,
  avatarUrl: actor.profile.avatarUrl ?? null,
});

export async function createCourse(actor: Actor, input: CourseInput): Promise<CourseRecord> {
  const timestamp = nowIso();
  const term = input.academicPeriod?.trim() || currentTerm();

  const course: CourseRecord = {
    id: randomUUID(),
    slug: `${slugify(input.name).slice(0, 50)}-${randomUUID().slice(0, 4)}`,
    name: input.name,
    institution: input.institution,
    term,
    academicPeriod: term,
    description: input.description,
    // Se guarda desnormalizado porque la galería pública ya lo pintaba así y no
    // vale la pena reescribir esa vista para una lista que casi siempre tiene
    // un solo elemento.
    teacherName: actor.profile.displayName,
    studentCount: 0,
    projectCount: 0,
    activities: [],
    code: input.code?.trim().toUpperCase() || generateCourseCode(),
    // Quien la crea queda como docente. Es lo que hace que el rol global
    // 'teacher' sólo sirva para CREAR: sobre la materia manda esta lista.
    teachers: [memberOf(actor)],
    students: [],
    visibility: input.visibility,
    createdBy: actor.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.courses,
      Item: course,
      ConditionExpression: 'attribute_not_exists(id)',
    })
  );

  return course;
}

export async function updateCourse(
  course: CourseRecord,
  input: Partial<CourseInput>
): Promise<CourseRecord> {
  const next: CourseRecord = {
    ...course,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.institution !== undefined ? { institution: input.institution } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.code !== undefined ? { code: input.code?.trim().toUpperCase() || course.code } : {}),
    ...(input.academicPeriod
      ? { academicPeriod: input.academicPeriod, term: input.academicPeriod }
      : {}),
    updatedAt: nowIso(),
  };

  await writeCourse(next);
  return next;
}

async function writeCourse(course: CourseRecord): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: TABLES.courses,
      // `studentCount` es dato derivado. Recalcularlo al escribir es lo que
      // impide que la galería pública anuncie 32 estudiantes cuando quedan 30.
      Item: { ...course, studentCount: course.students.length },
      ConditionExpression: 'attribute_exists(id)',
    })
  );
}

/**
 * Inscribe personas en la materia. Idempotente: volver a inscribir a alguien
 * que ya está no lo duplica ni lo saca.
 */
export async function enrollMembers(
  course: CourseRecord,
  people: readonly CourseMemberRecord[],
  role: 'student' | 'teacher'
): Promise<CourseRecord> {
  const list = role === 'teacher' ? course.teachers : course.students;
  const known = new Set(list.map((member) => member.uid));
  const added = people.filter((person) => !known.has(person.uid));

  const merged = [...list, ...added];
  if (merged.length > ACADEMIC_LIMITS.maxStudentsPerCourse) {
    throw new HttpError(409, 'La materia llegó a su límite de personas inscritas.');
  }

  const next: CourseRecord = {
    ...course,
    ...(role === 'teacher' ? { teachers: merged } : { students: merged }),
    updatedAt: nowIso(),
  };

  await writeCourse(next);
  return next;
}

/** Saca a alguien de la materia. No borra sus entregas: sólo el acceso. */
export async function removeMember(
  course: CourseRecord,
  uid: string,
  role: 'student' | 'teacher'
): Promise<CourseRecord> {
  if (role === 'teacher' && course.teachers.length <= 1) {
    throw new HttpError(409, 'La materia se quedaría sin docente.');
  }

  const next: CourseRecord = {
    ...course,
    ...(role === 'teacher'
      ? { teachers: course.teachers.filter((member) => member.uid !== uid) }
      : { students: course.students.filter((member) => member.uid !== uid) }),
    updatedAt: nowIso(),
  };

  await writeCourse(next);
  return next;
}

/** Autoinscripción con el código de la materia. */
export async function joinCourse(actor: Actor, course: CourseRecord): Promise<CourseRecord> {
  if (course.teachers.some((member) => member.uid === actor.uid)) return course;
  if (course.students.some((member) => member.uid === actor.uid)) return course;
  return enrollMembers(normalizeCourse(course), [memberOf(actor)], 'student');
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

/**
 * Normaliza la entrada de una tarea a un registro.
 *
 * Aquí se decide una cosa que luego cuesta cambiar: los campos de investigación
 * sólo se guardan si el tipo es `research`, y los `assignedTo` se traducen a
 * UID contra la lista real de la materia. Guardar campos de un tipo que no es
 * el suyo convierte el registro en algo que hay que interpretar al leerlo, y
 * ahí es donde aparecen las tareas que se pintan medio vacías.
 */
function assignmentFields(
  input: AssignmentInput,
  assignedUids: string[] | null,
  groupAssignments: GroupAssignmentRecord[],
  workflow: WorkflowStepRecord[] = []
): Omit<AssignmentRecord, 'id' | 'courseId' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  /**
   * Sólo una investigación puede ser colaborativa. Un AI Worklog o un enlace no
   * tienen conceptos que repartir, y guardarles `shared` produciría una tarea
   * que dice ser colaborativa y no tiene nada que colaborar. Se normaliza aquí,
   * al escribir, para que ninguna vista tenga que preguntárselo al leer.
   */
  const shared = input.type === 'research' && input.collaborationMode === 'shared';

  const questions =
    input.type === 'research'
      ? input.researchQuestions.map((question, index) => ({
          ...question,
          group: question.group ?? null,
          // Un `groupId` que no llega se deriva del nombre del concepto, igual
          // que al leer una investigación de la iteración 2. El índice es el
          // desempate para campos sueltos sin concepto.
          groupId: question.groupId?.trim() || derivedGroupId(question.group ?? `campo-${index}`),
        }))
      : [];

  const validGroupIds = new Set(questions.map((question) => question.groupId));

  return {
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    type: input.type,
    resourceLinks: input.resourceLinks,
    researchQuestions: questions,
    dueDate: input.dueDate?.trim() ? input.dueDate : null,
    /**
     * El instante se normaliza a ISO en UTC aquí, una sola vez. Lo compone el
     * navegador con la zona horaria de quien crea la tarea; el servidor no
     * intenta adivinarla, sólo guarda el instante que le dan.
     */
    dueAt: input.dueAt?.trim() ? new Date(input.dueAt).toISOString() : null,
    collaborationMode: shared ? 'shared' : 'individual',
    contributionVisibility: input.contributionVisibility,
    // Un reparto que apunta a un concepto que ya no existe se descarta: si no,
    // borrar un concepto dejaría asignaciones colgando que nadie ve y que
    // reaparecerían si el nombre se volviera a usar.
    groupAssignments: shared
      ? groupAssignments.filter((entry) => validGroupIds.has(entry.groupId))
      : [],
    resources: input.resources,
    /**
     * Los pasos se guardan sólo cuando de verdad hay más de uno o cuando la
     * tarea se declara `workflow`. Una tarea sencilla se guarda como siempre y
     * recibe su paso sintetizado al leerla: así el registro no engorda con un
     * paso que no aporta nada, y una tarea creada hoy con el formulario simple
     * es indistinguible de una creada antes de la iteración 4.
     */
    workflow: input.type === 'workflow' || workflow.length > 1 ? workflow : [],
    assignedTo: assignedUids,
    status: input.status,
  };
}

/**
 * Convierte los pasos que llegan del formulario en registros.
 *
 * Vive aquí y no en las rutas porque lo necesitan las dos —crear y editar— y
 * porque concentra dos garantías que no pueden divergir entre ellas: los
 * responsables se resuelven contra la lista de la materia (un handle de fuera
 * no resuelve), y cada campo estructurado recibe su `groupId` estable.
 */
export function buildWorkflowSteps(
  steps: readonly WorkflowStepInput[],
  resolveHandles: (handles: readonly string[]) => string[]
): WorkflowStepRecord[] {
  assertAcyclicWorkflow(steps);
  return steps.map((step, index) => ({
    id: step.id,
    // El orden lo fija la posición en la lista, no lo que mande el cliente: es
    // lo que hace que reordenar en el constructor no dependa de dos números
    // que puedan contradecirse.
    order: index,
    title: step.title,
    description: step.description,
    instructions: step.instructions,
    actionType: step.actionType,
    tool: step.tool,
    resources: step.resources,
    prompt: step.prompt,
    deliverables: step.deliverables.map((deliverable) => ({
      type: deliverable.type,
      required: deliverable.required,
      hint: deliverable.hint,
      questions: deliverable.questions.map((question, position) => ({
        ...question,
        group: question.group ?? null,
        groupId:
          question.groupId?.trim() || derivedGroupId(question.group ?? `campo-${position}`),
      })),
    })),
    required: step.required,
    assignedTo: step.assignedHandles == null ? null : resolveHandles(step.assignedHandles),
    dependsOnStepIds: step.dependsOnStepIds,
  }));
}

export async function createAssignment(
  actor: Actor,
  courseId: string,
  input: AssignmentInput,
  assignedUids: string[] | null,
  groupAssignments: GroupAssignmentRecord[] = [],
  workflow: WorkflowStepRecord[] = []
): Promise<AssignmentRecord> {
  const timestamp = nowIso();
  const assignment: AssignmentRecord = {
    id: randomUUID(),
    courseId,
    ...assignmentFields(input, assignedUids, groupAssignments, workflow),
    createdBy: actor.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.assignments,
      Item: assignment,
      ConditionExpression: 'attribute_not_exists(id)',
    })
  );

  return assignment;
}

export async function updateAssignment(
  assignment: AssignmentRecord,
  input: AssignmentInput,
  assignedUids: string[] | null,
  groupAssignments: GroupAssignmentRecord[] = [],
  workflow: WorkflowStepRecord[] = []
): Promise<AssignmentRecord> {
  const next: AssignmentRecord = {
    ...assignment,
    ...assignmentFields(input, assignedUids, groupAssignments, workflow),
    updatedAt: nowIso(),
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.assignments,
      Item: next,
      ConditionExpression: 'attribute_exists(id)',
    })
  );

  return next;
}

/**
 * Borra la tarea. Las entregas NO se borran en cascada a propósito: son trabajo
 * de otras personas, y perderlas por un clic del profesorado no tiene vuelta
 * atrás. Quedan huérfanas y se limpian con una tarea de mantenimiento, que está
 * anotada en CHECKPOINTS.md.
 */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: TABLES.assignments, Key: { id: assignmentId } }));
}

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------

export interface SubmissionUpsert {
  assignment: AssignmentRecord;
  actor: Actor;
  data: SubmissionData;
  intent: 'draft' | 'submit';
  /** Evidencia paso a paso. Ausente en las entregas de un solo paso. */
  stepEvidence?: Record<string, StepEvidence>;
}

/**
 * Filtra las respuestas que esta persona NO tiene derecho a escribir.
 *
 * Es la protección de §14 y ocurre en el SERVIDOR, que es el único sitio donde
 * cuenta. Que el formulario no pinte los campos de otro es comodidad; esto es
 * la garantía.
 *
 * Se DESCARTAN en silencio en vez de rechazar la petición entera, y la elección
 * importa: un formulario legítimo puede arrastrar el `questionId` de un
 * concepto que la docente reasignó mientras el alumno tenía la pestaña abierta,
 * y responder 422 a esa persona la dejaría sin poder guardar lo que sí es suyo
 * sin entender por qué. Lo que no le corresponde no se guarda; lo que sí, se
 * guarda entero.
 *
 * Nótese que esto NO toca la entrega de nadie más: cada persona escribe en su
 * propio registro, cuyo id se deriva de su UID. Lo que se impide aquí es algo
 * más sutil —contestar apartados ajenos DENTRO de la entrega propia— que
 * ensuciaría la vista conjunta con aportaciones que nadie pidió.
 */
export function guardCollaborativeAnswers(
  assignment: AssignmentRecord,
  uid: string,
  data: SubmissionData
): SubmissionData {
  if (assignment.type !== 'research' || assignment.collaborationMode !== 'shared') return data;

  const allowed = answerableQuestionIds(assignment, uid);
  const answers = (data as { answers?: { questionId: string; value: string }[] }).answers ?? [];

  return { answers: answers.filter((answer) => allowed.has(answer.questionId)) };
}

/**
 * Crea o actualiza la entrega de quien la manda. SIEMPRE la suya: el UID sale
 * del token verificado y el id de la entrega se deriva de él, así que no existe
 * ningún parámetro con el que pedir «guarda esto en la entrega de otro».
 *
 * Sobre el estado: una entrega revisada que se vuelve a mandar pasa a
 * `submitted`, no se queda en `reviewed`. Dejar la marca de revisado sobre un
 * texto que ha cambiado desde entonces es mentir sobre lo que se leyó.
 */
export async function upsertSubmission(input: SubmissionUpsert): Promise<SubmissionRecord> {
  const { assignment, actor } = input;

  if (assignment.status === 'closed') {
    throw new HttpError(409, 'Esta tarea ya está cerrada.');
  }

  const existing = await getOwnSubmission(assignment.id, actor.uid);
  const timestamp = nowIso();

  const data = guardCollaborativeAnswers(assignment, actor.uid, input.data);

  const status: SubmissionStatus = input.intent === 'submit' ? 'submitted' : 'draft';

  const record: SubmissionRecord = {
    id: submissionIdFor(assignment.id, actor.uid),
    assignmentId: assignment.id,
    courseId: assignment.courseId,
    studentId: actor.uid,
    student: {
      handle: actor.profile.handle,
      displayName: actor.profile.displayName,
      avatarUrl: actor.profile.avatarUrl ?? null,
    },
    type: assignment.type,
    status,
    submittedAt: input.intent === 'submit' ? timestamp : (existing?.submittedAt ?? null),
    // Volver a entregar invalida la revisión anterior: lo revisado ya no es
    // esto. Se limpian las dos marcas juntas para que no queden a medias.
    reviewedAt: input.intent === 'submit' ? null : (existing?.reviewedAt ?? null),
    reviewedBy: input.intent === 'submit' ? null : (existing?.reviewedBy ?? null),
    teacherNote: existing?.teacherNote ?? '',
    data,
    // Una entrega de un solo paso también guarda su evidencia bajo
    // `LEGACY_STEP_ID`. Así la capa de workflow lee lo mismo venga de donde
    // venga, y `data` sigue siendo lo que leen la exportación y el visor.
    stepEvidence: input.stepEvidence ?? existing?.stepEvidence ?? {},
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  await db().send(new PutCommand({ TableName: TABLES.submissions, Item: record }));
  return record;
}

/** Revisión del profesorado. No toca el contenido, sólo el estado y la nota. */
export async function reviewSubmission(
  actor: Actor,
  submission: SubmissionRecord,
  input: { status: 'reviewed' | 'needs_changes' | 'submitted'; teacherNote: string }
): Promise<SubmissionRecord> {
  if (submission.status === 'draft') {
    throw new HttpError(409, 'Esa entrega todavía es un borrador del estudiante.');
  }

  const timestamp = nowIso();
  const next: SubmissionRecord = {
    ...submission,
    status: input.status,
    teacherNote: input.teacherNote,
    reviewedAt: input.status === 'submitted' ? null : timestamp,
    reviewedBy: input.status === 'submitted' ? null : actor.uid,
    updatedAt: timestamp,
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.submissions,
      Item: next,
      ConditionExpression: 'attribute_exists(id)',
    })
  );

  return next;
}

// ---------------------------------------------------------------------------
// Biblioteca de prompts (§21)
// ---------------------------------------------------------------------------

/**
 * Autoría inicial de un recurso.
 *
 * El estado lo decide el ROL, no el formulario (§8): el profesorado crea
 * directamente en la biblioteca; el alumnado propone. Un cliente que mandara
 * `status: 'approved'` no conseguiría nada, porque este campo no se lee del
 * cuerpo de la petición en ningún sitio.
 */
export function initialAuthorship(actor: Actor, isCourseTeacher: boolean) {
  const timestamp = nowIso();
  return {
    status: (isCourseTeacher ? 'approved' : 'proposed') as ResourceStatus,
    authorHandle: actor.profile.handle,
    authorName: actor.profile.displayName,
    approvedByUid: isCourseTeacher ? actor.uid : null,
    approvedByName: isCourseTeacher ? actor.profile.displayName : '',
    approvedAt: isCourseTeacher ? timestamp : null,
    featured: false,
  };
}

export interface PromptInput {
  title: string;
  description: string;
  prompt: string;
  recommendedProvider?: AIProvider | null;
  recommendedModel?: string | null;
}

export async function createPromptTemplate(
  actor: Actor,
  courseId: string,
  input: PromptInput,
  isCourseTeacher = true,
  persist = true
): Promise<PromptTemplateRecord> {
  const timestamp = nowIso();
  const template: PromptTemplateRecord = {
    id: randomUUID(),
    courseId,
    teacherId: actor.uid,
    title: input.title,
    description: input.description,
    prompt: input.prompt,
    recommendedProvider: input.recommendedProvider ?? null,
    recommendedModel: input.recommendedModel ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...initialAuthorship(actor, isCourseTeacher),
  };

  if (persist) await db().send(new PutCommand({ TableName: TABLES.prompts, Item: template }));
  return template;
}

/**
 * Edita un prompt EN EL SITIO, sin versionar.
 *
 * Las tareas guardan una referencia por id y no una copia (§20), así que
 * corregir el prompt corrige también lo que ven las tareas que lo recomiendan.
 * Es lo que se quiere: un recurso, una verdad.
 *
 * La contrapartida, y conviene tenerla presente: un AI Worklog entregado hace
 * un mes dice «prompt recomendado: X» aunque X haya cambiado desde entonces.
 * No es un problema real porque el AI Worklog guarda por separado el prompt
 * REALMENTE utilizado (§21), que es el dato que se analiza; el recomendado es
 * contexto. Versionar los prompts para conservar el recomendado exacto de cada
 * entrega sería la solución completa, y es trabajo de otra iteración.
 */
export async function updatePromptTemplate(
  template: PromptTemplateRecord,
  input: PromptInput
): Promise<PromptTemplateRecord> {
  const next: PromptTemplateRecord = {
    ...template,
    title: input.title,
    description: input.description,
    prompt: input.prompt,
    recommendedProvider: input.recommendedProvider ?? null,
    recommendedModel: input.recommendedModel ?? null,
    updatedAt: nowIso(),
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.prompts,
      Item: next,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
  return next;
}

/** Guarda el prompt tal cual. Lo usa la moderación, que ya lo compuso. */
export async function writePromptRaw(template: PromptTemplateRecord): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: TABLES.prompts,
      Item: template,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
}

export async function deletePromptTemplate(promptId: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: TABLES.prompts, Key: { id: promptId } }));
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SkillWriteInput {
  title: string;
  description: string;
  repositoryUrl: string;
  homepageUrl: string;
  compatibleTools: string[];
  installMethods: SkillResourceRecord['installMethods'];
  usageInstructions: string;
  tags: string[];
}

/**
 * Campos de una Skill.
 *
 * Los comandos de los pasos de instalación se guardan TAL CUAL, como texto. No
 * se sanean, no se interpretan y no se validan contra ninguna lista: UINexus no
 * los ejecuta nunca, así que «limpiarlos» sólo estropearía comandos legítimos y
 * daría una falsa sensación de defensa. Lo que sí se valida de verdad son los
 * enlaces, que sí se pintan como `href` y sí puede pulsar alguien.
 */
function skillFields(input: SkillWriteInput) {
  return {
    title: input.title,
    description: input.description,
    repositoryUrl: input.repositoryUrl.trim() || null,
    homepageUrl: input.homepageUrl.trim() || null,
    compatibleTools: input.compatibleTools,
    installMethods: input.installMethods,
    usageInstructions: input.usageInstructions,
    tags: input.tags,
  };
}

export async function createSkill(
  actor: Actor,
  courseId: string,
  input: SkillWriteInput,
  isCourseTeacher = true,
  persist = true
): Promise<SkillResourceRecord> {
  const timestamp = nowIso();
  const skill: SkillResourceRecord = {
    id: randomUUID(),
    courseId,
    createdBy: actor.uid,
    ...skillFields(input),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...initialAuthorship(actor, isCourseTeacher),
  };

  if (persist) await db().send(new PutCommand({ TableName: TABLES.skills, Item: skill }));
  return skill;
}

export async function updateSkill(
  skill: SkillResourceRecord,
  input: SkillWriteInput
): Promise<SkillResourceRecord> {
  const next: SkillResourceRecord = {
    ...skill,
    ...skillFields(input),
    updatedAt: nowIso(),
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.skills,
      Item: next,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
  return next;
}

/** Guarda la Skill tal cual. Lo usa la moderación, que ya la compuso. */
export async function writeSkillRaw(skill: SkillResourceRecord): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: TABLES.skills,
      Item: skill,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
}

export async function deleteSkill(skillId: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: TABLES.skills, Key: { id: skillId } }));
}

// ---------------------------------------------------------------------------
// Ficha académica del perfil
// ---------------------------------------------------------------------------

/**
 * Guarda la ficha académica sin tocar nada más del perfil.
 *
 * Se escribe con `UpdateCommand` y campos enumerados, no con un `Put` del
 * objeto entero: así una petición que traiga `role` o `suspended` de más no
 * tiene por dónde colarse.
 */
export async function updateAcademicProfile(
  actor: Actor,
  input: {
    studentProfile?: Record<string, string | null | undefined>;
    teacherProfile?: Record<string, string | null | undefined>;
  }
): Promise<void> {
  const sets: string[] = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': nowIso() };

  const clean = (raw: Record<string, string | null | undefined>) =>
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, value?.trim() || null])
    );

  if (input.studentProfile) {
    sets.push('#studentProfile = :studentProfile');
    names['#studentProfile'] = 'studentProfile';
    values[':studentProfile'] = clean(input.studentProfile);
  }
  if (input.teacherProfile) {
    sets.push('#teacherProfile = :teacherProfile');
    names['#teacherProfile'] = 'teacherProfile';
    values[':teacherProfile'] = clean(input.teacherProfile);
  }

  if (sets.length === 1) return;

  await db().send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { uid: actor.uid },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(uid)',
    })
  );
}

// ---------------------------------------------------------------------------
// Recursos generales y moderación (iteración 4)
// ---------------------------------------------------------------------------

export interface CourseResourceInput {
  type: CourseResourceRecord['type'];
  title: string;
  description: string;
  url: string;
  content: string;
  category: string;
  tags: string[];
  workflowSteps?: WorkflowStepInput[];
}

/**
 * Los pasos de una plantilla.
 *
 * Sólo se guardan si el recurso ES una plantilla: un enlace con pasos colgando
 * sería un registro que hay que interpretar al leerlo. Los responsables se
 * limpian aquí porque una plantilla no pertenece a ningún grupo —se puede
 * reutilizar en otra materia— y copiar UID ajenos produciría pasos asignados a
 * gente que no está inscrita.
 */
function templateStepsFor(input: CourseResourceInput): WorkflowStepRecord[] {
  if (input.type !== 'workflow') return [];
  return buildWorkflowSteps(input.workflowSteps ?? [], () => []).map((step) => ({
    ...step,
    assignedTo: null,
  }));
}

export async function createCourseResource(
  actor: Actor,
  courseId: string,
  input: CourseResourceInput,
  isCourseTeacher: boolean,
  persist = true
): Promise<CourseResourceRecord> {
  const timestamp = nowIso();
  const resource: CourseResourceRecord = {
    id: randomUUID(),
    courseId,
    createdBy: actor.uid,
    type: input.type,
    title: input.title,
    description: input.description,
    url: input.url.trim() || null,
    content: input.content,
    category: input.category,
    tags: input.tags,
    workflowSteps: templateStepsFor(input),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...initialAuthorship(actor, isCourseTeacher),
  };

  if (persist) await db().send(new PutCommand({ TableName: TABLES.resources, Item: resource }));
  return resource;
}

export async function updateCourseResource(
  resource: CourseResourceRecord,
  input: CourseResourceInput
): Promise<CourseResourceRecord> {
  const next: CourseResourceRecord = {
    ...resource,
    type: input.type,
    title: input.title,
    description: input.description,
    url: input.url.trim() || null,
    content: input.content,
    category: input.category,
    tags: input.tags,
    workflowSteps: templateStepsFor(input),
    updatedAt: nowIso(),
  };

  await db().send(
    new PutCommand({
      TableName: TABLES.resources,
      Item: next,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
  return next;
}

/** Guarda el registro tal cual. Lo usa la moderación, que ya lo compuso. */
export async function updateCourseResourceRaw(
  resource: CourseResourceRecord
): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: TABLES.resources,
      Item: resource,
      ConditionExpression: 'attribute_exists(id)',
    })
  );
}

export async function deleteCourseResource(resourceId: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: TABLES.resources, Key: { id: resourceId } }));
}

export type ModerationAction = 'approve' | 'reject' | 'archive' | 'feature' | 'unfeature';

/**
 * Aplica una decisión de moderación conservando la autoría (§9, §44).
 *
 * Lo que NO hace, y es deliberado: tocar el contenido. La docente aprueba o
 * rechaza; si quiere cambiar el texto usa la edición normal, y aun así el
 * recurso sigue diciendo quién lo aportó. Aprobar algo no lo convierte en tuyo.
 *
 * `rejected` y `archived` no borran nada: quien lo propuso tiene derecho a
 * saber qué pasó con lo suyo, y un recurso que desaparece sin dejar rastro sólo
 * produce la misma propuesta otra vez la semana siguiente.
 */
export function applyModeration(
  actor: Actor,
  current: {
    status: ResourceStatus;
    approvedByUid: string | null;
    approvedByName: string;
    approvedAt: string | null;
    featured: boolean;
  },
  action: ModerationAction
) {
  const timestamp = nowIso();

  switch (action) {
    case 'approve':
      return {
        status: 'approved' as ResourceStatus,
        approvedByUid: actor.uid,
        approvedByName: actor.profile.displayName,
        approvedAt: timestamp,
        featured: current.featured,
      };
    case 'reject':
      return {
        status: 'rejected' as ResourceStatus,
        approvedByUid: actor.uid,
        approvedByName: actor.profile.displayName,
        approvedAt: timestamp,
        // Un recurso rechazado deja de estar destacado, si lo estaba.
        featured: false,
      };
    case 'archive':
      return { ...current, status: 'archived' as ResourceStatus, featured: false };
    case 'feature':
      return { ...current, featured: true };
    case 'unfeature':
    default:
      return { ...current, featured: false };
  }
}
