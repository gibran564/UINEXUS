import 'server-only';

import { createHash } from 'node:crypto';
import { BatchGetCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { INDEXES, TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import { slugify } from '../slug';
import { normalizeStepEvidence, normalizeWorkflow, templateSteps } from '../workflow';
import type {
  AssignmentRecord,
  Course,
  CourseMemberRecord,
  CourseRecord,
  CourseResourceRecord,
  CourseRole,
  PromptTemplateRecord,
  ResearchQuestion,
  ResourceStatus,
  SkillResourceRecord,
  SubmissionRecord,
} from '../types';
import { DEMO_COURSES } from './demo';

/**
 * Lecturas de la capa académica.
 *
 * Vive aparte de `repository.ts` porque responde a otras preguntas: aquélla
 * sirve la galería pública, ésta sirve el aula, que es privada por definición.
 * Ninguna función de este módulo devuelve nada sin que quien llama haya
 * comprobado antes el permiso en `lib/server/course-access.ts`.
 *
 * Compatibilidad con lo que ya estaba guardado: las materias existentes se
 * escribieron antes de que existieran `teachers`, `students`, `code` o
 * `visibility`. `normalizeCourse()` les pone valor por defecto en cada lectura,
 * así que un curso viejo se comporta como uno nuevo sin necesidad de migrar la
 * tabla. Es la razón de que no haya script de migración: la migración es
 * perezosa y ocurre al escribir.
 */

function db() {
  return getDynamo();
}

const EMPTY_COURSE_EXTRAS = {
  code: null,
  academicPeriod: null,
  teachers: [] as CourseMemberRecord[],
  students: [] as CourseMemberRecord[],
  visibility: 'public' as const,
  createdBy: null,
};

/** Rellena los campos que un curso anterior a la iteración 2 no tiene. */
export function normalizeCourse(raw: Course & Partial<CourseRecord>): CourseRecord {
  return {
    ...EMPTY_COURSE_EXTRAS,
    ...raw,
    activities: raw.activities ?? [],
    teachers: raw.teachers ?? [],
    students: raw.students ?? [],
    visibility: raw.visibility ?? 'public',
    code: raw.code ?? null,
    academicPeriod: raw.academicPeriod ?? raw.term ?? null,
    createdBy: raw.createdBy ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    studentCount: raw.students?.length ?? raw.studentCount ?? 0,
  };
}

export async function getCourseRecord(courseId: string): Promise<CourseRecord | null> {
  const client = db();
  if (!client) {
    const demo = DEMO_COURSES.find((course) => course.id === courseId);
    return demo ? normalizeCourse(demo) : null;
  }

  const result = await client.send(
    new GetCommand({ TableName: TABLES.courses, Key: { id: courseId } })
  );
  const item = result.Item as (Course & Partial<CourseRecord>) | undefined;
  return item ? normalizeCourse(item) : null;
}

/**
 * Todas las materias en las que participa una persona, con su rol en cada una.
 *
 * Se resuelve con un Scan a propósito. La tabla de materias es pequeña por
 * naturaleza —decenas por institución, no millones—, `listCourses()` ya la
 * escanea para la galería pública, y la alternativa (guardar
 * `enrolledCourseIds` en el perfil) obliga a mantener sincronizadas dos copias
 * de la misma verdad. Aquí la lista de la materia es la ÚNICA fuente: si
 * alguien está en `students`, está inscrito; no hay un segundo sitio que pueda
 * contradecirlo. Cuando la tabla crezca lo suficiente para que esto duela,
 * la solución es un índice invertido, no una copia.
 */
export async function listCoursesForUser(
  uid: string
): Promise<{ course: CourseRecord; role: CourseRole }[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(new ScanCommand({ TableName: TABLES.courses, Limit: 1000 }));
  const courses = ((result.Items ?? []) as (Course & Partial<CourseRecord>)[]).map(normalizeCourse);

  return courses
    .flatMap((course) => {
      if (course.teachers.some((member) => member.uid === uid)) {
        return [{ course, role: 'teacher' as CourseRole }];
      }
      if (course.students.some((member) => member.uid === uid)) {
        return [{ course, role: 'student' as CourseRole }];
      }
      return [];
    })
    .sort((a, b) => b.course.updatedAt.localeCompare(a.course.updatedAt));
}

/** Materia por su código de acceso. Se compara siempre en mayúsculas. */
export async function findCourseByCode(code: string): Promise<CourseRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new ScanCommand({
      TableName: TABLES.courses,
      FilterExpression: '#c = :code',
      ExpressionAttributeNames: { '#c': 'code' },
      ExpressionAttributeValues: { ':code': code.toUpperCase() },
      Limit: 10,
    })
  );
  const item = (result.Items ?? [])[0] as (Course & Partial<CourseRecord>) | undefined;
  return item ? normalizeCourse(item) : null;
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

/**
 * Identificador estable de un concepto a partir de su nombre.
 *
 * Sólo se usa para RELLENAR investigaciones anteriores a la iteración 3, que
 * únicamente guardaban el texto del grupo. Las nuevas traen su `groupId`
 * explícito desde el constructor y esta función no las toca.
 *
 * Consecuencia conocida y aceptada: dos conceptos distintos con exactamente el
 * mismo nombre en una investigación antigua colapsan en un solo `groupId`. Es
 * preferible a la alternativa, que sería inventar ids nuevos en cada lectura y
 * que el reparto dejara de apuntar a nada.
 */
export function derivedGroupId(group: string | null): string {
  const slug = slugify(group ?? '').slice(0, 50);
  return slug || 'sin-concepto';
}

function normalizeQuestions(
  raw: readonly Partial<ResearchQuestion>[] | undefined
): ResearchQuestion[] {
  return (raw ?? []).map((question, index) => ({
    id: question.id ?? `q${index}`,
    group: question.group ?? null,
    groupId: question.groupId ?? derivedGroupId(question.group ?? null),
    prompt: question.prompt ?? '',
    type: question.type ?? 'long_text',
    required: question.required ?? false,
  }));
}

function normalizeAssignment(raw: Partial<AssignmentRecord>): AssignmentRecord {
  const researchQuestions = normalizeQuestions(raw.researchQuestions);
  const resources = raw.resources ?? [];

  return {
    id: raw.id ?? '',
    courseId: raw.courseId ?? '',
    title: raw.title ?? '',
    description: raw.description ?? '',
    instructions: raw.instructions ?? '',
    type: raw.type ?? 'freeform',
    resourceLinks: raw.resourceLinks ?? [],
    researchQuestions,
    /**
     * Toda tarea es un workflow al leerla. Las anteriores a la iteración 4 no
     * lo tienen guardado y reciben aquí su paso único sintetizado, así que
     * ninguna vista tiene que preguntarse si la tarea es «antigua».
     */
    workflow: normalizeWorkflow(raw, {
      type: raw.type ?? 'freeform',
      title: raw.title ?? '',
      description: raw.description ?? '',
      instructions: raw.instructions ?? '',
      researchQuestions,
      resources,
    }),
    dueDate: raw.dueDate ?? null,
    /**
     * Una tarea anterior a esta iteración no lo tiene. No se migra: se
     * interpreta al usarla (`lib/due-date.ts`), donde está documentado que el
     * día sin hora se cierra de la forma más permisiva posible.
     */
    dueAt: raw.dueAt ?? null,
    // Una tarea sin `collaborationMode` es de antes de la iteración 3, y lo que
    // era es exactamente `individual`. No hay ambigüedad que resolver.
    collaborationMode: raw.collaborationMode ?? 'individual',
    contributionVisibility: raw.contributionVisibility ?? 'group',
    groupAssignments: raw.groupAssignments ?? [],
    resources,
    assignedTo: raw.assignedTo ?? null,
    status: raw.status ?? 'draft',
    createdBy: raw.createdBy ?? '',
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
  };
}

/**
 * ¿Puede esta persona responder a este concepto?
 *
 * Es la regla central de la actividad colaborativa, y está aquí —en una función
 * pura— para que se pueda leer entera y probar sin nube. La aplica el servidor
 * al guardar una entrega; el formulario sólo la usa para no pintar campos que
 * de todas formas serían rechazados.
 *
 *   · Modo individual  → cualquiera responde todo. No hay reparto.
 *   · Concepto SIN responsables → abierto a todo el grupo. Se eligió esta
 *     semántica y no la contraria porque coincide con la que ya usa
 *     `assignedTo: null` en la propia tarea: la ausencia de restricción
 *     significa «para todos», nunca «para nadie». Un olvido al repartir deja el
 *     concepto abierto, que se nota y se arregla; la regla inversa dejaría un
 *     concepto que nadie puede tocar y que nadie sabría por qué.
 *   · Concepto CON responsables → sólo ellos.
 */
export function canAnswerGroup(
  assignment: AssignmentRecord,
  groupId: string,
  uid: string
): boolean {
  if (assignment.collaborationMode !== 'shared') return true;
  const entry = assignment.groupAssignments.find((item) => item.groupId === groupId);
  if (!entry || entry.assignedTo.length === 0) return true;
  return entry.assignedTo.includes(uid);
}

/** Los `questionId` que esta persona tiene derecho a responder. */
export function answerableQuestionIds(
  assignment: AssignmentRecord,
  uid: string
): Set<string> {
  return new Set(
    assignment.researchQuestions
      .filter((question) => canAnswerGroup(assignment, question.groupId, uid))
      .map((question) => question.id)
  );
}

export async function listAssignmentsByCourse(courseId: string): Promise<AssignmentRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.assignments,
      IndexName: INDEXES.assignmentsByCourse,
      KeyConditionExpression: '#c = :courseId',
      ExpressionAttributeNames: { '#c': 'courseId' },
      ExpressionAttributeValues: { ':courseId': courseId },
      ScanIndexForward: false, // createdAt descendente
      Limit: 300,
    })
  );

  return ((result.Items ?? []) as Partial<AssignmentRecord>[]).map(normalizeAssignment);
}

export async function getAssignmentRecord(assignmentId: string): Promise<AssignmentRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.assignments, Key: { id: assignmentId } })
  );
  const item = result.Item as Partial<AssignmentRecord> | undefined;
  return item ? normalizeAssignment(item) : null;
}

/**
 * ¿Le toca esta tarea a esta persona?
 *
 * Es la comprobación que impide que un estudiante lea por URL una tarea que no
 * se le asignó. Se aplica en el servidor, en las rutas de API: ocultar la
 * tarjeta en el panel no protege nada.
 */
export function isAssignedTo(assignment: AssignmentRecord, uid: string): boolean {
  if (assignment.status !== 'published' && assignment.status !== 'closed') return false;
  if (assignment.assignedTo === null) return true;
  return assignment.assignedTo.includes(uid);
}

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------

/**
 * Identificador determinista de una entrega.
 *
 * Una persona tiene UNA entrega por tarea. Derivar el id de (tarea, UID) hace
 * que esa unicidad sea aritmética en vez de depender de una consulta previa
 * más una escritura condicional, que es donde se cuelan las carreras y los
 * duplicados.
 *
 * Es un hash y no una concatenación porque el id viaja al navegador: pegar el
 * UID en la URL de la entrega sería exactamente la fuga que
 * `academic-mappers.ts` está evitando en todo lo demás.
 */
export function submissionIdFor(assignmentId: string, uid: string): string {
  return createHash('sha256').update(`${assignmentId}:${uid}`).digest('hex').slice(0, 32);
}

function normalizeSubmission(raw: Partial<SubmissionRecord>): SubmissionRecord {
  return {
    id: raw.id ?? '',
    assignmentId: raw.assignmentId ?? '',
    courseId: raw.courseId ?? '',
    studentId: raw.studentId ?? '',
    student: raw.student ?? { handle: '', displayName: '', avatarUrl: null },
    type: raw.type ?? 'freeform',
    status: raw.status ?? 'draft',
    submittedAt: raw.submittedAt ?? null,
    reviewedAt: raw.reviewedAt ?? null,
    reviewedBy: raw.reviewedBy ?? null,
    teacherNote: raw.teacherNote ?? '',
    data: raw.data ?? ({} as SubmissionRecord['data']),
    // Igual que arriba: una entrega anterior a la iteración 4 sólo tiene
    // `data`, y se lee como la evidencia del paso único.
    stepEvidence: normalizeStepEvidence(raw),
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function getSubmissionById(submissionId: string): Promise<SubmissionRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.submissions, Key: { id: submissionId } })
  );
  const item = result.Item as Partial<SubmissionRecord> | undefined;
  return item ? normalizeSubmission(item) : null;
}

export function getOwnSubmission(
  assignmentId: string,
  uid: string
): Promise<SubmissionRecord | null> {
  return getSubmissionById(submissionIdFor(assignmentId, uid));
}

export async function listSubmissionsByAssignment(
  assignmentId: string
): Promise<SubmissionRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.submissions,
      IndexName: INDEXES.submissionsByAssignment,
      KeyConditionExpression: '#a = :assignmentId',
      ExpressionAttributeNames: { '#a': 'assignmentId' },
      ExpressionAttributeValues: { ':assignmentId': assignmentId },
      Limit: 500,
    })
  );

  return ((result.Items ?? []) as Partial<SubmissionRecord>[]).map(normalizeSubmission);
}

/** Entregas de una persona. Se filtra por materia al leer, nunca se mezclan. */
export async function listSubmissionsByStudent(
  uid: string,
  courseId?: string
): Promise<SubmissionRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.submissions,
      IndexName: INDEXES.submissionsByStudent,
      KeyConditionExpression: '#s = :uid',
      ExpressionAttributeNames: { '#s': 'studentId' },
      ExpressionAttributeValues: { ':uid': uid },
      ScanIndexForward: false,
      Limit: 500,
    })
  );

  const all = ((result.Items ?? []) as Partial<SubmissionRecord>[]).map(normalizeSubmission);
  return courseId ? all.filter((submission) => submission.courseId === courseId) : all;
}

/** Varias entregas por id, en un solo viaje. Para la exportación selectiva. */
export async function getSubmissionsByIds(ids: readonly string[]): Promise<SubmissionRecord[]> {
  const client = db();
  if (!client || ids.length === 0) return [];

  const unique = [...new Set(ids)];
  const found: SubmissionRecord[] = [];

  // BatchGet admite 100 claves por petición.
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    const result = await client.send(
      new BatchGetCommand({
        RequestItems: { [TABLES.submissions]: { Keys: chunk.map((id) => ({ id })) } },
      })
    );
    const items = (result.Responses?.[TABLES.submissions] ?? []) as Partial<SubmissionRecord>[];
    found.push(...items.map(normalizeSubmission));
  }

  return found;
}

// ---------------------------------------------------------------------------
// Biblioteca de IA de la materia: prompts y skills
//
// Dos tablas y no una. La alternativa —un `uinexus-resources` con un
// discriminador— habría sido más elegante en abstracto, pero `uinexus-prompts`
// ya existe y está ACTIVE en la cuenta: unificar exigía migrar una tabla en
// producción para ahorrar una consulta. Las dos formas además no se parecen
// (una Skill lleva métodos de instalación con pasos anidados; un prompt es
// texto), así que un único elemento acabaría con la mitad de los campos vacíos
// según el `kind`. La pestaña «Recursos IA» hace dos consultas en paralelo.
// ---------------------------------------------------------------------------

/**
 * Autoría y estado de moderación, con valores por defecto seguros.
 *
 * Un recurso creado en la iteración 3 no tiene ninguno de estos campos, y lo
 * que era —algo que escribió la docente y ya estaba en la biblioteca— es
 * exactamente `approved`. Ponerle `proposed` lo haría desaparecer de la
 * biblioteca de todo el mundo, que es justo lo contrario de compatibilidad.
 */
function authorshipOf(raw: {
  status?: ResourceStatus;
  authorHandle?: string;
  authorName?: string;
  approvedByUid?: string | null;
  approvedByName?: string;
  approvedAt?: string | null;
  featured?: boolean;
}) {
  return {
    status: raw.status ?? ('approved' as ResourceStatus),
    authorHandle: raw.authorHandle ?? '',
    authorName: raw.authorName ?? '',
    approvedByUid: raw.approvedByUid ?? null,
    approvedByName: raw.approvedByName ?? '',
    approvedAt: raw.approvedAt ?? null,
    featured: raw.featured ?? false,
  };
}

function normalizeResource(raw: Partial<CourseResourceRecord>): CourseResourceRecord {
  return {
    id: raw.id ?? '',
    courseId: raw.courseId ?? '',
    createdBy: raw.createdBy ?? '',
    type: raw.type ?? 'other',
    title: raw.title ?? '',
    description: raw.description ?? '',
    url: raw.url || null,
    content: raw.content ?? '',
    category: raw.category ?? '',
    tags: raw.tags ?? [],
    // Vacío salvo en las plantillas. Un recurso guardado antes de que existiera
    // este campo se lee sin pasos, que es lo que era.
    workflowSteps: templateSteps({ type: raw.type ?? 'other', workflowSteps: raw.workflowSteps }),
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    ...authorshipOf(raw),
  };
}

/** Recursos generales de la materia: herramientas, enlaces, guías… */
export async function listCourseResources(
  courseId: string
): Promise<CourseResourceRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.resources,
      IndexName: INDEXES.resourcesByCourse,
      KeyConditionExpression: '#c = :courseId',
      ExpressionAttributeNames: { '#c': 'courseId' },
      ExpressionAttributeValues: { ':courseId': courseId },
      ScanIndexForward: false,
      Limit: 300,
    })
  );

  return ((result.Items ?? []) as Partial<CourseResourceRecord>[]).map(normalizeResource);
}

export async function getCourseResource(
  resourceId: string
): Promise<CourseResourceRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.resources, Key: { id: resourceId } })
  );
  const item = result.Item as Partial<CourseResourceRecord> | undefined;
  return item ? normalizeResource(item) : null;
}

function normalizePrompt(raw: Partial<PromptTemplateRecord>): PromptTemplateRecord {
  return {
    id: raw.id ?? '',
    courseId: raw.courseId ?? '',
    teacherId: raw.teacherId ?? '',
    title: raw.title ?? '',
    description: raw.description ?? '',
    prompt: raw.prompt ?? '',
    recommendedProvider: raw.recommendedProvider ?? null,
    recommendedModel: raw.recommendedModel ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    // Los prompts creados en la iteración 2 no lo tienen.
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    ...authorshipOf(raw),
  };
}

export async function listPromptTemplates(courseId: string): Promise<PromptTemplateRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.prompts,
      IndexName: INDEXES.promptsByCourse,
      KeyConditionExpression: '#c = :courseId',
      ExpressionAttributeNames: { '#c': 'courseId' },
      ExpressionAttributeValues: { ':courseId': courseId },
      ScanIndexForward: false,
      Limit: 200,
    })
  );

  return ((result.Items ?? []) as Partial<PromptTemplateRecord>[]).map(normalizePrompt);
}

export async function getPromptTemplate(promptId: string): Promise<PromptTemplateRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.prompts, Key: { id: promptId } })
  );
  const item = result.Item as Partial<PromptTemplateRecord> | undefined;
  return item ? normalizePrompt(item) : null;
}

function normalizeSkill(raw: Partial<SkillResourceRecord>): SkillResourceRecord {
  return {
    id: raw.id ?? '',
    courseId: raw.courseId ?? '',
    createdBy: raw.createdBy ?? '',
    title: raw.title ?? '',
    description: raw.description ?? '',
    repositoryUrl: raw.repositoryUrl || null,
    homepageUrl: raw.homepageUrl || null,
    compatibleTools: raw.compatibleTools ?? [],
    installMethods: raw.installMethods ?? [],
    usageInstructions: raw.usageInstructions ?? '',
    tags: raw.tags ?? [],
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    ...authorshipOf(raw),
  };
}

export async function listSkills(courseId: string): Promise<SkillResourceRecord[]> {
  const client = db();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.skills,
      IndexName: INDEXES.skillsByCourse,
      KeyConditionExpression: '#c = :courseId',
      ExpressionAttributeNames: { '#c': 'courseId' },
      ExpressionAttributeValues: { ':courseId': courseId },
      ScanIndexForward: false,
      Limit: 200,
    })
  );

  return ((result.Items ?? []) as Partial<SkillResourceRecord>[]).map(normalizeSkill);
}

export async function getSkill(skillId: string): Promise<SkillResourceRecord | null> {
  const client = db();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.skills, Key: { id: skillId } })
  );
  const item = result.Item as Partial<SkillResourceRecord> | undefined;
  return item ? normalizeSkill(item) : null;
}

// ---------------------------------------------------------------------------
// Búsqueda de personas para inscribir
// ---------------------------------------------------------------------------

/**
 * Busca personas por handle o nombre. Sólo la usa el profesorado para inscribir
 * gente, y devuelve exclusivamente lo que ya es público en el perfil: handle,
 * nombre y avatar. Ni correo ni UID ni rol.
 */
export async function searchPeople(
  query: string,
  limit = 20
): Promise<CourseMemberRecord[]> {
  const client = db();
  if (!client) return [];

  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const result = await client.send(
    new ScanCommand({
      TableName: TABLES.users,
      ProjectionExpression: '#u, #h, #d, #a, #s',
      ExpressionAttributeNames: {
        '#u': 'uid',
        '#h': 'handle',
        '#d': 'displayName',
        '#a': 'avatarUrl',
        '#s': 'suspended',
      },
      Limit: 1000,
    })
  );

  const people = (result.Items ?? []) as {
    uid?: string;
    handle?: string;
    displayName?: string;
    avatarUrl?: string | null;
    suspended?: boolean;
  }[];

  return people
    .filter(
      (person) =>
        person.uid &&
        person.handle &&
        !person.suspended &&
        (person.handle.includes(needle) ||
          (person.displayName ?? '').toLowerCase().includes(needle))
    )
    .slice(0, limit)
    .map((person) => ({
      uid: person.uid as string,
      handle: person.handle as string,
      displayName: person.displayName ?? (person.handle as string),
      avatarUrl: person.avatarUrl ?? null,
    }));
}
