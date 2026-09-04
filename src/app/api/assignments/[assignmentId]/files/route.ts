import { z } from 'zod';
import { FILE_CLASS_BY_DELIVERABLE } from '@/lib/constants';
import { getOwnSubmission, listSubmissionsByAssignment } from '@/lib/data/academic';
import {
  UploadRejected,
  presignAcademicDownload,
  presignAcademicUpload,
} from '@/lib/aws/s3';
import { canWorkOnStep, primaryDeliverable } from '@/lib/workflow';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { requireAssignmentAccess } from '@/lib/server/course-access';
import type { MediaData } from '@/lib/types';

/**
 * Archivos académicos de una tarea.
 *
 * POST → permiso de subida (POST firmado). El cliente sube DIRECTAMENTE a S3.
 * GET  → URL de lectura temporal de un archivo ya subido.
 *
 * ## Por qué el archivo no pasa por Next.js
 *
 * Un video de 200 MB a través de una función serverless es tiempo de ejecución
 * pagado, memoria y un límite de cuerpo que no da. El navegador sube al bucket
 * con un permiso que este servidor firmó, acotado a una ruta, un tipo y un
 * tamaño concretos. Es exactamente lo que ya hace la publicación de proyectos.
 *
 * ## Lo que el cliente NO decide
 *
 * La clave en S3 la construye el servidor con datos que ya verificó: la
 * materia, el UID del token, la tarea y el paso. El nombre del archivo que
 * propone el navegador sólo se guarda como etiqueta para mostrarlo. Si la ruta
 * saliera del cliente, se podría escribir en la carpeta de otra persona.
 */

const uploadSchema = z.object({
  stepId: z.string().trim().min(1).max(40),
  contentType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  /** Sólo para mostrarlo. No entra en la ruta. */
  fileName: z.string().trim().max(200).default(''),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course, role } = await requireAssignmentAccess(actor, assignmentId);

    if (role === 'teacher') {
      throw new HttpError(403, 'El profesorado no entrega archivos en sus propias tareas.');
    }

    const input = await readJson(request, uploadSchema);

    const step = assignment.workflow.find((item) => item.id === input.stepId);
    if (!step) throw new HttpError(404, 'Ese paso no existe en esta tarea.');

    // La misma regla que al guardar evidencia: sólo se sube a un paso propio.
    if (!canWorkOnStep(step, actor.uid)) {
      throw new HttpError(403, 'Ese paso no te corresponde.');
    }

    /**
     * La clase de límite la dicta el ENTREGABLE DEL PASO, no el cuerpo. Pedir
     * subir un video a un paso que pide una imagen no da el límite de video.
     */
    const deliverable = primaryDeliverable(step);
    const fileClass = FILE_CLASS_BY_DELIVERABLE[
      deliverable.type as 'file' | 'image' | 'video'
    ];
    if (!fileClass) {
      throw new HttpError(409, 'Este paso no pide un archivo.');
    }

    const { post, key } = await presignAcademicUpload({
      courseId: course.id,
      uid: actor.uid,
      assignmentId,
      stepId: step.id,
      fileClass,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    return Response.json({ upload: post, storageKey: key, fileName: input.fileName });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}

/**
 * URL de lectura de un archivo entregado.
 *
 * Quién puede: el profesorado de la materia y quien lo subió. Y no se comprueba
 * mirando la clave —que contiene el UID y sería fácil de imitar— sino buscando
 * la evidencia que la referencia: sólo se firma la lectura de un archivo que
 * está REALMENTE citado en una entrega de esta tarea.
 *
 * Sin esa comprobación, conocer una clave bastaría para leer el trabajo de
 * cualquiera.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { role } = await requireAssignmentAccess(actor, assignmentId);

    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!key) throw new HttpError(422, 'Falta la referencia del archivo.');

    const cited =
      role === 'teacher'
        ? await citedInAnySubmission(assignmentId, key)
        : await citedInOwnSubmission(assignmentId, actor.uid, key);

    if (!cited) throw new HttpError(404, 'Ese archivo no existe.');

    return Response.json({ url: await presignAcademicDownload(key) });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}

/** ¿Cita la entrega de esta persona ese archivo? */
async function citedInOwnSubmission(
  assignmentId: string,
  uid: string,
  key: string
): Promise<boolean> {
  const submission = await getOwnSubmission(assignmentId, uid);
  return submission ? evidenceCites(submission.stepEvidence, key) : false;
}

/** Igual, pero sobre cualquier entrega de la tarea. Sólo para el profesorado. */
async function citedInAnySubmission(assignmentId: string, key: string): Promise<boolean> {
  const submissions = await listSubmissionsByAssignment(assignmentId);
  return submissions.some((submission) => evidenceCites(submission.stepEvidence, key));
}

function evidenceCites(
  evidence: Record<string, { data: unknown }>,
  key: string
): boolean {
  return Object.values(evidence).some(
    (entry) => (entry.data as MediaData | undefined)?.storageKey === key
  );
}
