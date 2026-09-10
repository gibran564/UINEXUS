import { randomUUID } from 'node:crypto';
import { ACADEMIC_FILE_LIMITS, ACADEMIC_LIMITS } from '@/lib/constants';
import { resolveAcademicUpload } from '@/lib/academic-files';
import {
  materialConfirmSchema,
  materialPatchSchema,
  materialUploadRequestSchema,
} from '@/lib/academic-schemas';
import {
  UploadRejected,
  deleteAcademicObject,
  isAssignmentMaterialKeyFor,
  presignAcademicDownload,
  presignAssignmentMaterialUpload,
} from '@/lib/aws/s3';
import { setAssignmentMaterials } from '@/lib/server/academic-writes';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import {
  requireAssignmentAccess,
  requireAssignmentTeacher,
} from '@/lib/server/course-access';
import type { AssignmentMaterialRecord } from '@/lib/types';

/**
 * Los archivos que el profesorado reparte con la tarea.
 *
 * POST   → permiso de subida. El navegador sube DIRECTAMENTE a S3.
 * PUT    → registra el archivo ya subido. Es el paso que persiste el metadato.
 * PATCH  → renombra o recategoriza un material que ya existe.
 * DELETE → lo quita de la tarea y borra el objeto.
 * GET    → URL de lectura temporal, por `id` del material.
 *
 * ## Por qué una ruta propia y no la de entregas
 *
 * La ruta de archivos académicos (`/files`) responde 403 al profesorado a
 * propósito: allí un archivo pertenece a UNA persona y a UN paso, y la
 * autorización se resuelve preguntando si quien pide es su dueño. Un material no
 * tiene dueño individual —lo lee toda la clase— y su permiso de escritura es el
 * contrario: sólo el profesorado. Levantar aquella restricción para meter los
 * materiales habría fundido dos preguntas de autorización distintas en una sola
 * función, que es exactamente donde después se cuela el permiso equivocado.
 *
 * ## Subida en dos tiempos
 *
 * Se firma primero y se registra después de que S3 confirme. El orden importa:
 * al revés, un fallo de red dejaría en la tarea un archivo que no existe y un
 * botón de descarga que siempre falla. Así el peor caso es un objeto huérfano en
 * el bucket, que no rompe ninguna pantalla.
 */

interface MaterialContext {
  courseId: string;
  assignmentId: string;
}

function materialsOf(materials: readonly AssignmentMaterialRecord[]): AssignmentMaterialRecord[] {
  return materials.map((material) => ({ ...material }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course } = await requireAssignmentTeacher(actor, assignmentId);

    if (assignment.materials.length >= ACADEMIC_LIMITS.maxMaterialsPerAssignment) {
      throw new HttpError(
        409,
        `Una tarea admite hasta ${ACADEMIC_LIMITS.maxMaterialsPerAssignment} archivos.`
      );
    }

    const input = await readJson(request, materialUploadRequestSchema);

    const { post, key, contentType } = await presignAssignmentMaterialUpload({
      courseId: course.id,
      assignmentId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      fileName: input.fileName,
    });

    return Response.json({ upload: post, storageKey: key, contentType });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}

/** Registra el archivo ya subido. Sólo docente de la materia. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment, course } = await requireAssignmentTeacher(actor, assignmentId);

    const input = await readJson(request, materialConfirmSchema);
    const context: MaterialContext = { courseId: course.id, assignmentId };

    /**
     * La clave tiene que ser una que ESTA ruta emitió para ESTA tarea. Sin esta
     * comprobación, conocer la forma del prefijo bastaría para colgar en una
     * tarea el material de otra materia y conseguir que el servidor firmara su
     * lectura para todo el grupo.
     */
    if (!isAssignmentMaterialKeyFor(context, input.storageKey)) {
      throw new HttpError(422, 'Esa referencia no pertenece a esta tarea.');
    }

    if (assignment.materials.some((material) => material.storageKey === input.storageKey)) {
      throw new HttpError(409, 'Ese archivo ya está en la tarea.');
    }
    if (assignment.materials.length >= ACADEMIC_LIMITS.maxMaterialsPerAssignment) {
      throw new HttpError(
        409,
        `Una tarea admite hasta ${ACADEMIC_LIMITS.maxMaterialsPerAssignment} archivos.`
      );
    }

    /**
     * El tipo se vuelve a derivar del nombre en vez de creerle al cliente: es la
     * misma resolución que decidió el `Content-Type` con el que S3 guardó el
     * objeto, así que el metadato no puede describirlo como otra cosa.
     */
    const resolved = resolveAcademicUpload('material', { fileName: input.fileName });
    if (!resolved) throw new HttpError(422, 'Ese tipo de archivo no se admite aquí.');

    const material: AssignmentMaterialRecord = {
      id: randomUUID(),
      kind: input.kind,
      displayName: input.displayName.trim() || input.fileName,
      fileName: input.fileName,
      storageKey: input.storageKey,
      contentType: resolved.contentType,
      // Se acota al límite de la clase: un tamaño inventado sólo serviría para
      // pintar «900 MB» junto a un archivo de dos.
      sizeBytes: Math.min(input.sizeBytes, ACADEMIC_FILE_LIMITS.material),
      createdAt: new Date().toISOString(),
      uploadedBy: actor.uid,
      uploadedByName: actor.profile.displayName,
    };

    const updated = await setAssignmentMaterials(assignment, [
      ...materialsOf(assignment.materials),
      material,
    ]);

    return Response.json({ materials: toDto(updated.materials) }, { status: 201 });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}

/** Cambia el nombre visible o la clase. No toca el archivo. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment } = await requireAssignmentTeacher(actor, assignmentId);

    const input = await readJson(request, materialPatchSchema);
    const target = assignment.materials.find((material) => material.id === input.id);
    if (!target) throw new HttpError(404, 'Ese archivo no está en la tarea.');

    const updated = await setAssignmentMaterials(
      assignment,
      assignment.materials.map((material) =>
        material.id === input.id
          ? {
              ...material,
              displayName:
                input.displayName === undefined
                  ? material.displayName
                  : input.displayName.trim() || material.fileName,
              kind: input.kind ?? material.kind,
            }
          : material
      )
    );

    return Response.json({ materials: toDto(updated.materials) });
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
    const { assignment } = await requireAssignmentTeacher(actor, assignmentId);

    const id = new URL(request.url).searchParams.get('id') ?? '';
    const target = assignment.materials.find((material) => material.id === id);
    if (!target) throw new HttpError(404, 'Ese archivo no está en la tarea.');

    const updated = await setAssignmentMaterials(
      assignment,
      assignment.materials.filter((material) => material.id !== id)
    );

    /**
     * El objeto se borra DESPUÉS de quitarlo de la tarea. Si el borrado falla,
     * queda un objeto huérfano —invisible y sin coste real— en vez de un
     * material que se ve y no se puede descargar.
     */
    try {
      await deleteAcademicObject(target.storageKey);
    } catch (caught) {
      console.error('[uinexus] No se pudo borrar el objeto de un material:', caught);
    }

    return Response.json({ materials: toDto(updated.materials) });
  } catch (caught) {
    return errorResponse(caught);
  }
}

/**
 * URL de lectura de un material.
 *
 * Quién puede: cualquiera con acceso a la tarea, que es justo para quien se
 * reparte. Se pide por `id` y NUNCA por clave: aceptar una clave del cliente
 * convertiría este endpoint en un firmador de lecturas para cualquier objeto del
 * espacio académico. La clave la pone el servidor, tomándola de la propia tarea.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { assignmentId } = await params;
    const { assignment } = await requireAssignmentAccess(actor, assignmentId);

    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!id) return Response.json({ materials: toDto(assignment.materials) });

    const material = assignment.materials.find((item) => item.id === id);
    if (!material) throw new HttpError(404, 'Ese archivo no existe.');

    return Response.json({
      url: await presignAcademicDownload(material.storageKey),
      fileName: material.fileName,
    });
  } catch (caught) {
    if (caught instanceof UploadRejected) {
      return Response.json({ error: caught.message }, { status: 422 });
    }
    return errorResponse(caught);
  }
}

/** Sin el UID de quien lo subió: es la misma frontera que en el resto del aula. */
function toDto(materials: readonly AssignmentMaterialRecord[]) {
  return materials.map(({ uploadedBy: _uploadedBy, ...material }) => material);
}
