import type {
  Assignment,
  AssignmentRecord,
  CourseResource,
  CourseResourceRecord,
  PromptTemplate,
  PromptTemplateRecord,
  ResourceAuthorship,
  ResourceStatus,
  SkillResource,
  SkillResourceRecord,
  CourseDetail,
  CourseMemberRecord,
  CourseRecord,
  CourseRole,
  Submission,
  SubmissionRecord,
} from '../types';

/**
 * Frontera de privacidad de la capa académica.
 *
 * Es el equivalente de `toPublicProject()` para materias, tareas y entregas, y
 * existe por la misma razón: el UID de Firebase identifica una CUENTA, no a una
 * persona dentro de la clase. La identidad pública es el `handle`, y todo lo
 * que cruza hacia el navegador —incluido el panel del profesorado— habla en
 * handles.
 *
 * La consecuencia práctica es que el cliente no puede pedir «la entrega del
 * UID X»: no conoce ningún UID. El servidor traduce handle → UID contra la
 * lista de la materia, así que una petición sólo puede referirse a alguien que
 * de verdad está inscrito.
 */

const publicMember = (member: CourseMemberRecord) => ({
  handle: member.handle,
  displayName: member.displayName,
  avatarUrl: member.avatarUrl ?? null,
});

export function toCourseDetail(record: CourseRecord, viewerRole: CourseRole): CourseDetail {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    institution: record.institution,
    term: record.term,
    description: record.description,
    teacherName: record.teacherName,
    studentCount: record.students.length,
    projectCount: record.projectCount,
    activities: record.activities ?? [],
    code: record.code,
    academicPeriod: record.academicPeriod,
    teachers: record.teachers.map(publicMember),
    // El alumnado sólo ve la lista de su propio grupo si es docente. Para un
    // estudiante la lista va vacía: saber quién más está inscrito no es
    // necesario para entregar, y sí es dato personal de terceros.
    students: viewerRole === 'teacher' ? record.students.map(publicMember) : [],
    visibility: record.visibility,
    viewerRole,
  };
}

/**
 * Tarea para el navegador.
 *
 * `assignedTo` se traduce de UID a handles y SÓLO para el profesorado: a un
 * estudiante no le corresponde saber a qué compañeros se le asignó también.
 * Cuando quien mira es alumnado, el campo viaja como `null`, que ya significa
 * «esto no te dice nada sobre a quién más se asignó».
 */
export function toAssignment(
  record: AssignmentRecord,
  options: { viewerRole: CourseRole; roster?: readonly CourseMemberRecord[] }
): Assignment {
  const handleByUid = new Map((options.roster ?? []).map((member) => [member.uid, member.handle]));

  return {
    id: record.id,
    courseId: record.courseId,
    title: record.title,
    description: record.description,
    instructions: record.instructions,
    type: record.type,
    resourceLinks: record.resourceLinks ?? [],
    researchQuestions: record.researchQuestions ?? [],
    dueDate: record.dueDate ?? null,
    collaborationMode: record.collaborationMode,
    contributionVisibility: record.contributionVisibility,
    /**
     * El reparto por concepto se traduce a handles y SÓLO se le manda al
     * profesorado. Al alumnado se le dice qué le toca A ÉL con
     * `myGroupIds` en la vista de la tarea; la lista completa de quién hace
     * qué es información de terceros que no necesita para entregar.
     */
    groupAssignments:
      options.viewerRole === 'teacher'
        ? record.groupAssignments.map((entry) => ({
            groupId: entry.groupId,
            assignedTo: entry.assignedTo.flatMap((uid) => {
              const handle = handleByUid.get(uid);
              return handle ? [handle] : [];
            }),
          }))
        : [],
    resources: record.resources ?? [],
    /**
     * Los pasos, con sus responsables traducidos a handles y SÓLO para el
     * profesorado: al alumnado se le dice qué pasos puede hacer él
     * (`myStepIds` en la vista de la tarea), no quién hace cada uno.
     */
    workflow: record.workflow.map((step) => ({
      ...step,
      assignedTo:
        options.viewerRole === 'teacher' && step.assignedTo
          ? step.assignedTo.flatMap((uid) => {
              const handle = handleByUid.get(uid);
              return handle ? [handle] : [];
            })
          : null,
    })),
    assignedToAll: record.assignedTo === null,
    assignedTo:
      options.viewerRole === 'teacher' && record.assignedTo
        ? record.assignedTo.flatMap((uid) => {
            const handle = handleByUid.get(uid);
            // Un UID sin handle es alguien que ya no está en la lista de la
            // materia. Se omite en vez de filtrarse tal cual: devolver el UID
            // rompería justo la invariante que este módulo existe para
            // sostener.
            return handle ? [handle] : [];
          })
        : null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toSubmission(record: SubmissionRecord): Submission {
  const { studentId: _studentId, reviewedBy: _reviewedBy, ...submission } = record;
  return submission;
}

export function toSubmissions(records: readonly SubmissionRecord[]): Submission[] {
  return records.map(toSubmission);
}

// ---------------------------------------------------------------------------
// Biblioteca de IA
// ---------------------------------------------------------------------------

/**
 * Recompone la autoría para el navegador.
 *
 * En la tabla se guarda desnormalizada (`authorHandle` + `authorName`) para
 * poder listar sin ir a buscar a cada persona; aquí vuelve a ser alguien. El
 * UID se queda en el servidor, como en todo lo demás.
 *
 * La autoría se conserva SIEMPRE, también después de aprobar (§9): el recurso
 * sigue diciendo quién lo aportó. Es lo que convierte la biblioteca en
 * conocimiento colectivo de la materia y no en un almacén anónimo.
 */
function authorshipDto(record: {
  status: ResourceStatus;
  authorHandle: string;
  authorName: string;
  approvedByUid: string | null;
  approvedByName: string;
  approvedAt: string | null;
  featured: boolean;
}): ResourceAuthorship {
  return {
    status: record.status,
    author: record.authorHandle
      ? {
          handle: record.authorHandle,
          displayName: record.authorName || record.authorHandle,
          avatarUrl: null,
        }
      : null,
    approvedBy: record.approvedByUid
      ? { handle: '', displayName: record.approvedByName, avatarUrl: null }
      : null,
    approvedAt: record.approvedAt,
    featured: record.featured,
  };
}

/** Quita el UID de quien creó el recurso. El resto es visible para la clase. */
export function toPromptTemplate(record: PromptTemplateRecord): PromptTemplate {
  const {
    teacherId: _teacherId,
    authorHandle: _authorHandle,
    authorName: _authorName,
    approvedByUid: _approvedByUid,
    approvedByName: _approvedByName,
    ...template
  } = record;
  return { ...template, ...authorshipDto(record) };
}

export function toSkillResource(record: SkillResourceRecord): SkillResource {
  const {
    createdBy: _createdBy,
    authorHandle: _authorHandle,
    authorName: _authorName,
    approvedByUid: _approvedByUid,
    approvedByName: _approvedByName,
    ...skill
  } = record;
  return { ...skill, ...authorshipDto(record) };
}

export function toCourseResource(record: CourseResourceRecord): CourseResource {
  const {
    createdBy: _createdBy,
    authorHandle: _authorHandle,
    authorName: _authorName,
    approvedByUid: _approvedByUid,
    approvedByName: _approvedByName,
    ...resource
  } = record;
  return { ...resource, ...authorshipDto(record) };
}
