import 'server-only';

import { getNexBookRecord, instanceNexBookIdFor } from '@/lib/data/nexbooks';
import { canWorkOnStep, hasContent, normalizeEvidence, primaryDeliverable } from '@/lib/workflow';
import type { AssignmentRecord, StepEvidence, SubmissionData } from '@/lib/types';

/**
 * El puente entre «tengo un laboratorio empezado» y «la entrega lo sabe».
 *
 * ## El problema que resuelve
 *
 * Un NexLab se guarda SOLO, en su propio documento y con su propia revisión. La
 * evidencia de la entrega, en cambio, guarda una COPIA congelada de ese
 * documento, y esa copia sólo se escribe cuando el runner la manda. Las dos
 * cosas son correctas por separado y juntas producen dos rarezas:
 *
 *  · Alguien trabaja una hora en su laboratorio, vuelve al día siguiente, y la
 *    pantalla dice «Sin empezar» porque la entrega todavía no tiene ninguna
 *    copia. La barra de progreso mentiría sobre su propio trabajo.
 *
 *  · Alguien trabaja en el laboratorio de la Parte 3, cierra, vuelve, y pulsa
 *    «Entregar» sin volver a abrir esa Parte. El servidor no ve evidencia y
 *    responde «todavía te falta: Parte 3», sobre una Parte que está hecha.
 *
 * ## Qué se hace, y qué NO
 *
 * Se lee la instancia —cuyo identificador es determinista, así que es una
 * lectura por clave y no una búsqueda— para saber si lleva trabajo dentro. La
 * copia se crea de forma perezosa, al abrir la Parte, nunca al publicar; y su
 * REVISIÓN dice si después se guardó algo. Ver `hasWork`.
 *
 * Lo que no se hace es guardar la copia continuamente. La copia es lo que
 * congela la entrega: si se reescribiera sola cada vez que se toca el
 * documento, seguir trabajando después de entregar cambiaría lo que se
 * califica, que es exactamente lo que el snapshot existe para impedir. Sólo se
 * rellena al ENTREGAR, y sólo donde no había nada.
 */

/**
 * ¿Esta copia lleva trabajo dentro?
 *
 * `createNexBook` la crea en revisión **1**, y `saveOwnNexBook` sube la revisión
 * en cada guardado. Así que «revisión mayor que 1» significa exactamente una
 * cosa: se guardó algo después de crearla. Ni una heurística ni una medida de
 * calidad —Nextudio no juzga si un trabajo está bien hecho, eso es calificar—,
 * sino el dato que el propio almacenamiento ya lleva.
 *
 * Antes bastaba con que la copia EXISTIERA, y existir sólo quiere decir que
 * alguien abrió la pestaña: se podía entregar una actividad de laboratorio sin
 * haber escrito nada.
 */
function hasWork(record: { revision: number }): boolean {
  return record.revision > 1;
}

/** Las Partes de laboratorio en las que esta persona ya trabajó. */
export async function startedLabStepIds(
  assignment: AssignmentRecord,
  uid: string
): Promise<string[]> {
  const labSteps = assignment.workflow.filter(
    (step) => primaryDeliverable(step).type === 'nexbook' && canWorkOnStep(step, uid)
  );
  if (labSteps.length === 0) return [];

  const found = await Promise.all(
    labSteps.map(async (step) => {
      const record = await getNexBookRecord(instanceNexBookIdFor(assignment.id, step.id, uid));
      return record && hasWork(record) ? step.id : null;
    })
  );

  return found.filter((id): id is string => id !== null);
}

/**
 * Completa la evidencia de las Partes de laboratorio que se quedaron sin copia.
 *
 * Se llama justo ANTES de comprobar qué falta para entregar, para que la
 * comprobación mire el trabajo real y no el rastro que dejó una pestaña.
 *
 * Muta el objeto que recibe porque es el mismo mapa que la ruta va a
 * persistir; devolverlo copiado obligaría a la ruta a acordarse de reasignarlo,
 * y olvidarse sería un fallo silencioso.
 *
 * La copia que se escribe aquí es la del documento TAL Y COMO ESTÁ al entregar,
 * que es justo lo que habría mandado el navegador de haber tenido la Parte
 * abierta. No hay ninguna ventaja ni ninguna pérdida: hay igualdad entre quien
 * dejó la pestaña abierta y quien no.
 */
export async function fillMissingLabEvidence(
  assignment: AssignmentRecord,
  evidence: Record<string, StepEvidence>,
  uid: string
): Promise<void> {
  const timestamp = new Date().toISOString();

  for (const step of assignment.workflow) {
    if (primaryDeliverable(step).type !== 'nexbook') continue;
    if (!canWorkOnStep(step, uid)) continue;
    if (hasContent(evidence[step.id])) continue;

    const record = await getNexBookRecord(instanceNexBookIdFor(assignment.id, step.id, uid));
    // Una copia recién abierta y sin tocar no es una entrega. Recogerla haría
    // que abrir la pestaña contara como haber hecho la Parte.
    if (!record || !hasWork(record)) continue;

    evidence[step.id] = normalizeEvidence(
      {
        stepId: step.id,
        data: {
          nexbookId: record.id,
          revision: record.revision,
          title: record.title,
          snapshot: record.document,
          submittedAt: timestamp,
        } as unknown as SubmissionData,
        startedAt: evidence[step.id]?.startedAt ?? record.createdAt,
        completedAt: timestamp,
      },
      step.id
    );
  }
}
