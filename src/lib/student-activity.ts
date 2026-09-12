import { partActionLabel } from './activity-builder';
import { hasContent, primaryDeliverable } from './workflow';
import type {
  AIWorklogData,
  StepEvidence,
  SubmissionStatus,
  WorkflowStep,
} from './types';

/**
 * Lo que el estudiante ve de una actividad, calculado sin React y sin red.
 *
 * ## Por qué existe este módulo
 *
 * La pantalla del alumnado responde cinco preguntas —qué tengo que hacer, dónde
 * lo hago, qué llevo, qué me falta, qué voy a entregar— y las cuatro últimas son
 * DERIVACIONES del mismo dato: la actividad y la evidencia guardada. Tenerlas
 * aquí, en funciones puras, permite probar las reglas una a una en vez de a
 * través de una pantalla, que es donde se esconden los desacuerdos.
 *
 * ## No hay estados nuevos guardados
 *
 * Nada de lo que hay aquí se persiste. El ciclo de vida sigue siendo el de
 * `Submission` (`draft → submitted → reviewed / needs_changes`) y el avance
 * dentro del borrador sigue siendo `stepEvidence`. Lo que este módulo aporta es
 * TRADUCCIÓN: de «hay evidencia en la clave `paso-3`» a «la Parte 3 está en
 * progreso».
 *
 * ## La regla que no se puede romper
 *
 * Lo que aquí se llama «lista para entregar» tiene que coincidir exactamente con
 * lo que el servidor deja entregar (`missingRequiredSteps` y
 * `assertConclusionsWritten` en la ruta de entrega). Si esta capa fuera más
 * permisiva, el botón se habilitaría para acabar en un 409; si fuera más
 * estricta, bloquearía una entrega que el servidor sí acepta. Por eso
 * `partIsComplete` replica las dos reglas del servidor y ninguna más, y por eso
 * la única comprobación que NO se replica —los bloques de conclusión obligatoria
 * dentro de una plantilla de NexLab, que exigen leer la plantilla— se declara
 * aquí como lo que es: un rechazo que sólo puede llegar del servidor, y que por
 * eso hay que saber contar (`humanizeSubmitError`).
 */

// ---------------------------------------------------------------------------
// Estado de una Parte
// ---------------------------------------------------------------------------

export type PartStatus = 'locked' | 'not_started' | 'in_progress' | 'done';

export const PART_STATUS_LABEL: Readonly<Record<PartStatus, string>> = {
  locked: 'Bloqueada',
  not_started: 'Sin empezar',
  in_progress: 'En progreso',
  done: 'Completada',
};

/**
 * La marca que acompaña al texto.
 *
 * Va SIEMPRE con su palabra al lado (WCAG 1.4.1): el color y el símbolo son
 * refuerzo, nunca el único portador del estado.
 */
export const PART_STATUS_MARK: Readonly<Record<PartStatus, string>> = {
  locked: '·',
  not_started: '○',
  in_progress: '◐',
  done: '✓',
};

/**
 * Lo que hace falta para saber por dónde va alguien.
 *
 * `labs` son los identificadores de Parte en cuyo NexLab esta persona YA
 * GUARDÓ algo. Viene del servidor y no se deduce de la evidencia, porque el
 * laboratorio se guarda solo en su propio documento: alguien puede haber
 * trabajado una hora en él sin que la entrega tenga todavía ninguna copia. Sin
 * este dato, volver al día siguiente mostraría «Sin empezar» sobre una hora de
 * trabajo, que es la peor mentira que puede decir una pantalla de progreso.
 *
 * «Guardó algo» y no «abrió la pestaña»: lo decide la revisión del documento
 * (ver `hasWork` en `lib/server/student-labs.ts`), y por eso abrir un
 * laboratorio y no escribir nada no completa la Parte.
 */
export interface StudentWork {
  evidence: Readonly<Record<string, StepEvidence>>;
  labs?: ReadonlySet<string>;
}

/** ¿Hay algo hecho en esta Parte? Incluye el laboratorio abierto aparte. */
export function partHasWork(part: WorkflowStep, work: StudentWork): boolean {
  if (hasContent(work.evidence[part.id])) return true;
  return primaryDeliverable(part).type === 'nexbook' && Boolean(work.labs?.has(part.id));
}

/**
 * ¿Está terminada esta Parte?
 *
 * «Terminada» significa lo que el servidor exige para entregar, ni más ni
 * menos. Hay exactamente dos reglas:
 *
 *  1. Hay contenido (`hasContent`, la misma función que usa la entrega).
 *  2. Si la Parte pide un registro de uso de IA con conclusión OBLIGATORIA, la
 *     conclusión está escrita.
 *
 * No se inventa ninguna tercera. Nextudio no juzga si la respuesta es buena:
 * eso es calificar, y calificar no es esto.
 */
export function partIsComplete(part: WorkflowStep, work: StudentWork): boolean {
  if (!partHasWork(part, work)) return false;

  const deliverable = primaryDeliverable(part);
  if (deliverable.type === 'ai_worklog' && deliverable.conclusionMode === 'required') {
    const written = work.evidence[part.id]?.data as AIWorklogData | undefined;
    return Boolean((written?.studentAnalysis ?? '').trim());
  }

  return true;
}

/**
 * Las Partes que todavía impiden abrir ésta.
 *
 * Se devuelven las Partes y no un número porque la pantalla dice cuáles son:
 * «completa primero “Preparar los datos”» se entiende; «bloqueada» a secas
 * deja a alguien buscando qué le falta.
 */
export function blockedBy(
  parts: readonly WorkflowStep[],
  part: WorkflowStep,
  work: StudentWork
): WorkflowStep[] {
  const byId = new Map(parts.map((item) => [item.id, item]));

  return part.dependsOnStepIds.flatMap((id) => {
    const dependency = byId.get(id);
    // Una dependencia que apunta a una Parte que ya no existe no bloquea nada.
    // Dejarla bloqueando sería condenar la Parte para siempre sin decir por qué.
    if (!dependency) return [];
    return partIsComplete(dependency, work) ? [] : [dependency];
  });
}

export function partStatus(
  parts: readonly WorkflowStep[],
  part: WorkflowStep,
  work: StudentWork
): PartStatus {
  if (partIsComplete(part, work)) return 'done';
  // Con trabajo empezado NO se bloquea, aunque la dependencia se haya reabierto:
  // quitarle a alguien el acceso a lo que ya estaba escribiendo es peor que
  // dejarle terminar.
  if (partHasWork(part, work)) return 'in_progress';
  return blockedBy(parts, part, work).length > 0 ? 'locked' : 'not_started';
}

/**
 * Lo que deja escrito «Marcar como revisada».
 *
 * Una Parte que no pide entrega no tiene forma de completarse sola: sin una
 * acción explícita se quedaría «Sin empezar» para siempre y bloquearía la
 * entrega de toda la actividad. La marca se guarda en `note`, que es el campo
 * que ya existe para lo que el estudiante quiera decir de esa Parte y que
 * `hasContent` ya cuenta como contenido —así el servidor y la pantalla siguen
 * estando de acuerdo sin añadir ningún campo—.
 *
 * No se inventa una entrega: no se escribe nada en `data`.
 */
export const REVIEWED_NOTE = 'Revisada.';

/** ¿La nota es sólo la marca automática? Decide si quitarla puede pisar algo. */
export function isReviewedNote(note: string | undefined): boolean {
  return (note ?? '').trim() === REVIEWED_NOTE;
}

// ---------------------------------------------------------------------------
// Progreso de la actividad
// ---------------------------------------------------------------------------

export interface ActivityProgress {
  total: number;
  done: number;
  /** Frase ya hecha, para no tener que componerla en cada pantalla. */
  label: string;
}

/**
 * Cuántas Partes van.
 *
 * Conteo simple y no porcentaje: las Partes no tienen peso, así que «50 %»
 * sería una precisión inventada. Dos de cuatro es exactamente lo que se sabe.
 */
export function activityProgress(
  parts: readonly WorkflowStep[],
  work: StudentWork
): ActivityProgress {
  const total = parts.length;
  const done = parts.filter((part) => partIsComplete(part, work)).length;

  return {
    total,
    done,
    label:
      total === 1
        ? done === 1
          ? 'Completada'
          : 'Sin completar'
        : `${done} de ${total} partes completadas`,
  };
}

// ---------------------------------------------------------------------------
// Qué falta para entregar
// ---------------------------------------------------------------------------

export interface MissingItem {
  partId: string;
  title: string;
  /** Qué falta, dicho en una frase que se pueda leer en voz alta. */
  message: string;
}

/**
 * Lo que impide entregar, Parte por Parte.
 *
 * Sólo cuentan las Partes OBLIGATORIAS: una opcional sin hacer no bloquea nada,
 * y decir lo contrario convertiría «opcional» en una palabra vacía.
 *
 * El orden es el de la actividad, para que la lista se lea como el recorrido.
 */
export function missingToSubmit(
  parts: readonly WorkflowStep[],
  work: StudentWork
): MissingItem[] {
  return parts.flatMap((part) => {
    if (!part.required || partIsComplete(part, work)) return [];

    const deliverable = primaryDeliverable(part);
    const title = part.title || partActionLabel(part);

    if (
      deliverable.type === 'ai_worklog' &&
      deliverable.conclusionMode === 'required' &&
      partHasWork(part, work)
    ) {
      return [
        {
          partId: part.id,
          title,
          message: 'Falta tu conclusión sobre el uso de IA. Esta actividad la pide.',
        },
      ];
    }

    return [{ partId: part.id, title, message: missingMessageFor(part) }];
  });
}

/** Qué pedir, con el nombre de lo que la Parte espera y no el del modelo. */
function missingMessageFor(part: WorkflowStep): string {
  switch (primaryDeliverable(part).type) {
    case 'nexbook':
      return 'Abre tu laboratorio y trabaja en él.';
    case 'code':
      return 'Escribe tu programa o adjunta el archivo.';
    case 'file':
    case 'image':
    case 'video':
      return 'Falta el archivo.';
    case 'url':
      return 'Falta el enlace.';
    case 'project':
      return 'Falta elegir el proyecto.';
    case 'ai_worklog':
      return 'Falta el registro de uso de IA.';
    case 'structured':
      return 'Faltan campos por responder.';
    case 'none':
      // Una Parte sin entrega que sigue siendo obligatoria se completa dejando
      // constancia. Es la única forma que tiene alguien de decir «ya lo hice».
      return 'Márcala como revisada cuando la hayas hecho.';
    default:
      return 'Falta tu respuesta.';
  }
}

/** ¿Se puede entregar ya? La misma cuenta que hace el servidor. */
export function canSubmit(parts: readonly WorkflowStep[], work: StudentWork): boolean {
  return missingToSubmit(parts, work).length === 0;
}

// ---------------------------------------------------------------------------
// Estado de la actividad entera
// ---------------------------------------------------------------------------

export type ActivityState =
  | 'not_started'
  | 'in_progress'
  | 'ready'
  | 'submitted'
  | 'submitted_late'
  | 'reviewed'
  | 'needs_changes';

export const ACTIVITY_STATE_LABEL: Readonly<Record<ActivityState, string>> = {
  not_started: 'Sin empezar',
  in_progress: 'En progreso',
  ready: 'Lista para entregar',
  submitted: 'Entregada',
  submitted_late: 'Entregada tarde',
  reviewed: 'Revisada',
  needs_changes: 'Requiere cambios',
};

/**
 * En qué punto está la actividad, dicho como se diría en clase.
 *
 * Se DERIVA; no hay ningún campo nuevo en la base de datos. Los cuatro estados
 * del final son los de `Submission`, y los tres primeros describen el borrador,
 * que es donde el ciclo de vida no dice nada y la persona sí necesita saber por
 * dónde va.
 *
 * «Entregada tarde» no es un estado guardado tampoco: es comparar la hora de
 * entrega con la fecha límite. Guardarlo obligaría a recalcularlo cada vez que
 * la docente mueve la fecha, que es justo cuando se equivocaría.
 */
export function activityState(input: {
  status: SubmissionStatus | null;
  submittedAt: string | null;
  dueAt: string | null;
  parts: readonly WorkflowStep[];
  work: StudentWork;
}): ActivityState {
  const { status, submittedAt, dueAt, parts, work } = input;

  if (status === 'reviewed') return 'reviewed';
  if (status === 'needs_changes') return 'needs_changes';
  if (status === 'submitted') {
    return wasLate(submittedAt, dueAt) ? 'submitted_late' : 'submitted';
  }

  if (parts.some((part) => partHasWork(part, work))) {
    return canSubmit(parts, work) ? 'ready' : 'in_progress';
  }
  return 'not_started';
}

function wasLate(submittedAt: string | null, dueAt: string | null): boolean {
  if (!submittedAt || !dueAt) return false;
  const submitted = Date.parse(submittedAt);
  const due = Date.parse(dueAt);
  if (Number.isNaN(submitted) || Number.isNaN(due)) return false;
  return submitted > due;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/**
 * El error de una escritura, dicho para quien lo va a leer.
 *
 * Las reglas académicas del servidor YA hablan en claro —«Todavía te falta:
 * …», «La fecha límite de esta actividad ya terminó (…)»— y esas se dejan tal
 * cual: reescribirlas aquí duplicaría el mensaje en dos sitios que se
 * desincronizarían. Lo que se traduce es lo otro: el conflicto de versiones,
 * las rutas del esquema y el fallo de red, que están escritos para quien
 * programa.
 *
 * El detalle técnico no se pierde: sigue en la consola y en los registros del
 * servidor. Lo que no hace falta es enseñárselo a alguien que está intentando
 * entregar una tarea.
 */
export function humanizeSubmitError(message: string): string {
  const text = message.trim();
  if (!text) return 'No se pudo guardar. Inténtalo otra vez.';

  if (text.includes('otro sitio') || /revision|409 /i.test(text)) {
    return 'Este trabajo cambió en otra pestaña. Recarga para obtener la versión más reciente; lo que tengas escrito aquí cópialo antes.';
  }

  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return 'No hay conexión con Nextudio. Lo que escribiste sigue en pantalla: vuelve a intentarlo cuando tengas red.';
  }

  // Una ruta del modelo («workflow.2.deliverables.0.type») no le dice nada a
  // nadie. Si aparece, se dice lo único cierto y accionable.
  if (/^[a-z]+(\.[a-z0-9_]+)+\b/i.test(text) && !text.includes(' ')) {
    return 'Hay un dato que Nextudio no pudo guardar. Revisa lo que escribiste en esta parte.';
  }

  return text;
}
