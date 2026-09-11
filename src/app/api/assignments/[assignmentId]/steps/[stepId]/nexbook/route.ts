import { emptyNexBookDocument } from '@/lib/academic-schemas';
import {
  createNexBook,
  getNexBookRecord,
  instanceNexBookIdFor,
  templateNexBookIdFor,
  toNexBook,
} from '@/lib/data/nexbooks';
import { primaryDeliverable } from '@/lib/workflow';
import { requireAssignmentAccess } from '@/lib/server/course-access';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';
import type { NexBookBlock, NexBookRecord } from '@/lib/types';

/**
 * EL NexBook de este paso, según quién pregunta.
 *
 * Misma URL, dos documentos distintos:
 *
 * ```
 * docente    → la PLANTILLA de la actividad
 * estudiante → SU copia, creada a partir de la plantilla
 * ```
 *
 * Que sea la misma ruta no es una economía de URLs: es que la pregunta es la
 * misma —«¿en qué documento trabajo yo en este paso?»— y la respuesta la decide
 * el rol, que el servidor ya conoce. Dos rutas habrían obligado al navegador a
 * saber su propio rol para elegir, y a que las dos se mantuvieran en paralelo.
 *
 * ## Instanciación perezosa
 *
 * La copia del estudiante se crea la PRIMERA VEZ que abre el paso, no al
 * publicar la actividad. Publicar para treinta personas no puede costar treinta
 * escrituras de un documento que quizá nadie abra; y en un grupo de trescientas,
 * serían trescientas.
 *
 * El id es determinista (ver `instanceNexBookIdFor`), así que «una copia por
 * persona y paso» es aritmética y no una consulta previa más una escritura, que
 * es donde se cuelan los duplicados. Si dos pestañas abren el paso a la vez, la
 * segunda recibe el fallo de condición y lee la que ganó.
 */

type Params = { params: Promise<{ assignmentId: string; stepId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId, stepId } = await params;
    const { assignment, role } = await requireAssignmentAccess(actor, assignmentId);

    const step = assignment.workflow.find((item) => item.id === stepId);
    if (!step) throw new HttpError(404, 'Ese paso no existe.');

    const deliverable = primaryDeliverable(step);
    if (deliverable.type !== 'nexbook') {
      throw new HttpError(422, 'Ese paso no pide un NexBook.');
    }

    const templateId = templateNexBookIdFor(assignmentId, stepId);

    if (role === 'teacher') {
      const template = await ensureTemplate(templateId, actor.uid, assignmentId, stepId);
      return Response.json({ nexbook: toNexBook(template), role: 'template' });
    }

    /**
     * La plantilla se lee SIN comprobar dueño, y eso es correcto: pertenece a la
     * docente pero la lee todo el grupo. La autorización la dio
     * `requireAssignmentAccess` unas líneas arriba —esta persona está en la
     * materia y el paso existe—, que es la pregunta que de verdad importaba.
     */
    const template = await getNexBookRecord(templateId);
    const instanceId = instanceNexBookIdFor(assignmentId, stepId, actor.uid);

    const existing = await getNexBookRecord(instanceId);
    if (existing) {
      // Ya trabajó aquí. NO se vuelve a copiar la plantilla: eso borraría su
      // trabajo cada vez que abriera el paso.
      if (existing.ownerUid !== actor.uid) throw new HttpError(404, 'Ese NexBook no existe.');
      return Response.json({ nexbook: toNexBook(existing), role: 'instance' });
    }

    const created = await createNexBook({
      id: instanceId,
      ownerUid: actor.uid,
      title: template?.title || step.title,
      context: { type: 'workflow', assignmentId, stepId, role: 'instance' },
      // Una entrega en curso es privada. Publicar una copia de un documento que
      // puede llevar instrucciones internas o datos de la materia será otra
      // función explícita, no un interruptor aquí.
      visibility: 'private',
      document: instanceDocumentFrom(template),
    });

    // `null` = otra pestaña ganó la carrera. Se lee la suya en vez de insistir.
    const instance = created ?? (await getNexBookRecord(instanceId));
    if (!instance || instance.ownerUid !== actor.uid) {
      throw new HttpError(500, 'No se pudo preparar tu NexBook.');
    }

    return Response.json({ nexbook: toNexBook(instance), role: 'instance' });
  } catch (caught) {
    return errorResponse(caught);
  }
}

/** La plantilla existe desde que la docente abre el paso por primera vez. */
async function ensureTemplate(
  templateId: string,
  ownerUid: string,
  assignmentId: string,
  stepId: string
): Promise<NexBookRecord> {
  const existing = await getNexBookRecord(templateId);
  if (existing) return existing;

  const created = await createNexBook({
    id: templateId,
    ownerUid,
    title: 'Plantilla del paso',
    context: { type: 'workflow', assignmentId, stepId, role: 'template' },
    visibility: 'private',
    document: emptyNexBookDocument([
      {
        id: 'instrucciones',
        type: 'markdown',
        source: '# Instrucciones\n\nEscribe aquí lo que el alumnado tiene que hacer.',
        // Las instrucciones se leen, no se editan. Es el caso que justifica que
        // `editableByStudent` exista.
        editableByStudent: false,
      },
    ]),
  });

  const template = created ?? (await getNexBookRecord(templateId));
  if (!template) throw new HttpError(500, 'No se pudo preparar la plantilla.');
  return template;
}

/**
 * La copia del estudiante a partir de la plantilla.
 *
 * Se copian los BLOQUES y NO los resultados: una salida de la docente en la
 * copia de alguien haría parecer ejecutado un código que esa persona no ha
 * ejecutado, que es exactamente lo que no se quiere al revisar.
 *
 * Los ids de bloque se conservan a propósito. Son locales al documento y
 * mantenerlos permite comparar la copia con la plantilla —qué bloques siguen
 * ahí, cuáles se añadieron— sin guardar un mapa aparte.
 */
function instanceDocumentFrom(template: NexBookRecord | null) {
  if (!template) return emptyNexBookDocument();

  const blocks: NexBookBlock[] = template.document.blocks.map((block) => ({ ...block }));
  return emptyNexBookDocument(blocks);
}
