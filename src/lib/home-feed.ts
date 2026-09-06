import { isPastDue, resolveDueInstant, type DueFields } from './due-date';
import type { CourseMember, ProjectCover, SubmissionStatus } from './types';

/**
 * El Inicio autenticado: qué requiere atención y qué está pasando.
 *
 * Módulo PURO —sin red, sin `server-only`— por la misma razón que
 * `lib/workflow.ts`: la regla que decide qué sube arriba del Inicio es la que
 * decide en qué gasta su tiempo un estudiante, y tiene que poder leerse entera
 * y probarse sin nube. El servidor la usa para ordenar y el navegador para
 * pintar exactamente lo mismo.
 *
 * ## La regla que gobierna la pantalla
 *
 * Las tareas ganan espacio al contenido social. SIEMPRE. No hay señal de
 * popularidad, ni recomendación, ni orden aprendido: el orden se deriva de
 * `dueAt`, del estado de la entrega y del avance del workflow, y por eso se
 * puede explicar en una frase a quien pregunte por qué algo está arriba.
 */

// ---------------------------------------------------------------------------
// Atención
// ---------------------------------------------------------------------------

/**
 * Por qué algo pide atención. El ORDEN de esta lista es el orden de la
 * pantalla: el índice de cada valor en `ATTENTION_ORDER` es su prioridad.
 */
export type AttentionReason =
  /** Devuelta por la docente. Es lo único que ya se trabajó y sigue abierto. */
  | 'needs_changes'
  /** Venció y no se entregó. Todavía se puede si no hay cierre duro. */
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  /** Hay borrador guardado: se empezó y quedó a medias. */
  | 'in_progress'
  /** Publicada hace poco y sin abrir. */
  | 'new'
  | 'upcoming'
  | 'no_deadline'
  /** Cerrada sin entrega. No es accionable; se dice para que no sorprenda. */
  | 'closed';

const ATTENTION_ORDER: readonly AttentionReason[] = [
  'needs_changes',
  'overdue',
  'due_today',
  'due_soon',
  'in_progress',
  'new',
  'upcoming',
  'no_deadline',
  'closed',
];

export function attentionRank(reason: AttentionReason): number {
  const rank = ATTENTION_ORDER.indexOf(reason);
  // Un motivo desconocido va al final en vez de arriba: si algún día se añade
  // uno y se olvida ordenarlo, el fallo es que aparece tarde, no que desplaza
  // a una entrega que vence hoy.
  return rank === -1 ? ATTENTION_ORDER.length : rank;
}

/** Umbrales, en milisegundos. Se nombran para que la regla se lea sola. */
const DAY = 24 * 60 * 60 * 1000;
const SOON = 7 * DAY;
/** Cuánto sigue siendo «nueva» una actividad recién publicada. */
const FRESH = 7 * DAY;
/** Cuánto tiempo se sigue avisando de una entrega que se cerró sin entregar. */
const CLOSED_MEMORY = 14 * DAY;

export interface AssignmentSignals extends DueFields {
  /** Cuándo se publicó. Decide si todavía cuenta como «nueva». */
  createdAt: string;
  /** El estado de MI entrega. `null` = nunca se abrió. */
  submissionStatus: SubmissionStatus | null;
}

/**
 * Por qué esta actividad pide atención, o `null` si no pide ninguna.
 *
 * Devuelve `null` para lo ya entregado o revisado: una actividad terminada no
 * puede empujar hacia abajo a una pendiente, y la forma más segura de
 * garantizarlo es que no entre en la lista.
 */
export function attentionReason(
  assignment: AssignmentSignals,
  now: Date = new Date()
): AttentionReason | null {
  if (assignment.submissionStatus === 'needs_changes') return 'needs_changes';
  if (assignment.submissionStatus === 'submitted' || assignment.submissionStatus === 'reviewed') {
    return null;
  }

  const due = resolveDueInstant(assignment);

  if (due && isPastDue(assignment, now)) {
    // Vencida y sin entregar. Se avisa un tiempo y después se deja de repetir:
    // un Inicio que arrastra los fallos de todo el semestre deja de servir para
    // decidir qué hacer hoy.
    return now.getTime() - due.getTime() <= CLOSED_MEMORY ? 'closed' : null;
  }

  if (due) {
    const left = due.getTime() - now.getTime();
    if (left <= DAY) return 'due_today';
    if (left <= SOON) return 'due_soon';
    // Con borrador empezado, «a medias» describe mejor la situación que «falta
    // mucho»: lo que hay que hacer es terminarlo, no empezarlo.
    if (assignment.submissionStatus === 'draft') return 'in_progress';
    return 'upcoming';
  }

  if (assignment.submissionStatus === 'draft') return 'in_progress';

  const age = now.getTime() - new Date(assignment.createdAt).getTime();
  return Number.isFinite(age) && age <= FRESH ? 'new' : 'no_deadline';
}

/** Avance dentro del workflow, cuando la actividad tiene varios pasos. */
export interface AttentionProgress {
  done: number;
  total: number;
  /** El siguiente paso obligatorio que falta. Es el que dice qué hacer ahora. */
  nextStepTitle: string | null;
}

export interface AttentionItem {
  assignmentId: string;
  courseId: string;
  courseName: string;
  title: string;
  reason: AttentionReason;
  dueDate: string | null;
  dueAt: string | null;
  submissionStatus: SubmissionStatus | null;
  progress: AttentionProgress | null;
  /** Cuándo se publicó. Sólo se usa para desempatar. */
  createdAt: string;
}

/**
 * El orden del bloque «Necesita tu atención».
 *
 * Tres criterios encadenados, y ninguno es una puntuación opaca:
 *  1. el motivo, según `ATTENTION_ORDER`;
 *  2. dentro del mismo motivo, lo que vence antes;
 *  3. y a igualdad de todo, lo más reciente primero.
 */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  const byReason = attentionRank(a.reason) - attentionRank(b.reason);
  if (byReason !== 0) return byReason;

  const left = resolveDueInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = resolveDueInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;

  return b.createdAt.localeCompare(a.createdAt);
}

export function sortAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort(compareAttention);
}

/**
 * Lo que dice el botón.
 *
 * Nunca «Ver actividad»: el botón tiene que decir qué va a pasar al pulsarlo, y
 * eso depende de dónde está el trabajo, no de qué pantalla se abre.
 */
export function attentionCta(item: {
  reason: AttentionReason;
  submissionStatus: SubmissionStatus | null;
}): string {
  if (item.reason === 'closed') return 'Ver la actividad';
  switch (item.submissionStatus) {
    case 'needs_changes':
      return 'Corregir y volver a entregar';
    case 'draft':
      return 'Continuar';
    case 'submitted':
      return 'Ver mi entrega';
    case 'reviewed':
      return 'Ver el resultado';
    default:
      return 'Comenzar';
  }
}

/** «Paso 2 de 4 · Continuar con NotebookLM», cuando hay pasos que contar. */
export function progressLabel(progress: AttentionProgress | null): string {
  if (!progress || progress.total <= 1) return '';
  const step = Math.min(progress.done + 1, progress.total);
  const position = `Paso ${step} de ${progress.total}`;
  return progress.nextStepTitle ? `${position} · ${progress.nextStepTitle}` : position;
}

// ---------------------------------------------------------------------------
// Atención del profesorado
// ---------------------------------------------------------------------------

/**
 * `publication` es su propia tarea y no se suma a `moderation` porque se
 * resuelve en otro sitio: las aportaciones a la biblioteca se aprueban dentro
 * de la materia y las publicaciones, en el muro. Un contador que junta las dos
 * manda a la mitad de la gente a la pantalla equivocada.
 */
export type TeacherTaskKind = 'closing' | 'review' | 'moderation' | 'publication';

const TEACHER_ORDER: readonly TeacherTaskKind[] = ['closing', 'review', 'moderation', 'publication'];

export interface TeacherTask {
  kind: TeacherTaskKind;
  courseId: string;
  courseName: string;
  /** La actividad, cuando la tarea se refiere a una. */
  assignmentId: string | null;
  title: string;
  /** Lo que hay que atender: entregas sin revisar, aportaciones, etc. */
  count: number;
  /** Cuántas personas de la audiencia ya entregaron, si aplica. */
  submitted: number | null;
  audience: number | null;
  dueAt: string | null;
  dueDate: string | null;
}

/**
 * El orden del Inicio docente.
 *
 * Lo que se cierra hoy va primero porque es lo único que deja de poder
 * arreglarse: recordar una entrega a las 18:00 sirve; hacerlo mañana, no.
 * Después lo que hay que revisar, y al final lo que hay que moderar.
 */
export function compareTeacherTasks(a: TeacherTask, b: TeacherTask): number {
  const byKind = TEACHER_ORDER.indexOf(a.kind) - TEACHER_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;

  const left = resolveDueInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = resolveDueInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;

  return b.count - a.count;
}

export function sortTeacherTasks(tasks: readonly TeacherTask[]): TeacherTask[] {
  return [...tasks].sort(compareTeacherTasks);
}

// ---------------------------------------------------------------------------
// El muro
// ---------------------------------------------------------------------------

/**
 * Qué puede aparecer en el muro.
 *
 * La lista es CERRADA a propósito. Todo lo que está aquí es algo que alguien
 * publicó para que otros lo usen; nada de esto es telemetría de uso. «Ana abrió
 * una actividad» o «Carlos visitó un recurso» no son eventos: son huellas, y un
 * muro hecho de huellas es vigilancia con otro nombre.
 */
export type FeedEventKind =
  | 'assignment'
  | 'announcement'
  | 'prompt'
  | 'skill'
  | 'resource'
  | 'project';

export interface FeedEvent {
  id: string;
  /** La portada de la página compartida, cuando la publicación trae una. */
  cover?: ProjectCover | null;
  /** La publicación es única aunque llegue por varias membresías. */
  publicationId?: string;
  audienceCourseIds?: string[];
  approvedByName?: string;
  kind: FeedEventKind;
  courseId: string;
  courseName: string;
  /** Quién lo publicó. `null` cuando el dato no conserva a la persona. */
  actor: CourseMember | null;
  title: string;
  /** Una línea de contexto. Nunca el contenido entero. */
  summary: string;
  /** ISO. El muro se ordena por esto y por nada más. */
  at: string;
  href: string;
  ctaLabel: string;
}

/** Lo más reciente arriba. No hay señal de popularidad que pueda alterarlo. */
export function compareEvents(a: FeedEvent, b: FeedEvent): number {
  return b.at.localeCompare(a.at);
}

export function sortEvents(events: readonly FeedEvent[], limit?: number): FeedEvent[] {
  const sorted = [...new Map(events.map((event) => [event.id, event])).values()].sort(compareEvents);
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

/**
 * El muro con las tareas reservadas.
 *
 * Una actividad es lo único del muro que alguien TIENE que hacer, así que no
 * compite por sitio con lo que se publica: un grupo activo que comparte veinte
 * páginas en una tarde no puede empujar fuera del muro la entrega del viernes.
 * Se reserva un cupo propio para las tareas y lo demás se disputa el suyo; el
 * orden final sigue siendo cronológico, sin mezclar bloques.
 */
export function sortEventsReservingAssignments(
  events: readonly FeedEvent[],
  limit: number
): FeedEvent[] {
  const assignments = sortEvents(events.filter((event) => event.kind === 'assignment'), limit);
  const rest = sortEvents(events.filter((event) => event.kind !== 'assignment'), limit);
  return sortEvents([...assignments, ...rest]);
}

/** El filtro de lectura nunca decide la audiencia del compositor. */
export function filterEventsByCourse(events: readonly FeedEvent[], courseId: string): FeedEvent[] {
  return events.filter((event) => !courseId ||
    (event.audienceCourseIds ?? [event.courseId]).includes(courseId));
}

export interface SinceSummary {
  assignments: number;
  resources: number;
  projects: number;
}

/**
 * «Desde tu última visita».
 *
 * Se deriva CONTANDO los eventos que el muro ya trajo, no rastreando lo que
 * alguien miró. La marca de la última visita la guarda el propio navegador; si
 * no hay ninguna —primera vez, otro equipo, almacenamiento limpiado— no se
 * inventa un resumen: se devuelve `null` y la pantalla no lo pinta.
 */
export function summarizeSince(
  events: readonly FeedEvent[],
  since: string | null
): SinceSummary | null {
  if (!since) return null;

  const recent = events.filter((event) => event.at > since);
  if (recent.length === 0) return null;

  return {
    assignments: recent.filter((event) => event.kind === 'assignment').length,
    resources: recent.filter(
      (event) => event.kind === 'prompt' || event.kind === 'skill' || event.kind === 'resource'
    ).length,
    projects: recent.filter((event) => event.kind === 'project').length,
  };
}

/** «hace 25 min», «hace 2 h», «hace 3 días». */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return '';

  const elapsed = now.getTime() - at;
  if (elapsed < 60_000) return 'hace un momento';

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;

  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}
