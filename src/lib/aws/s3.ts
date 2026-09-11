import 'server-only';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  AWS_REGION,
  PROJECTS_BUCKET,
  PUBLIC_BUCKET,
  awsClientConfig,
  isAwsConfigured,
} from './config';
import { ACADEMIC_FILE_LIMITS, LIMITS, NEXBOOK_LIMITS } from '../constants';
import { allowedExtensionsFor, resolveAcademicUpload } from '../academic-files';
import { contentTypeFor, isAllowedExtension, sanitizeRelativePath } from '../files';
import type { AcademicFileClass } from '../types';

/**
 * Acceso a S3.
 *
 * Lo que antes hacían las reglas de Storage lo hace ahora este módulo, con una
 * diferencia importante: el navegador ya no habla con el almacenamiento. Pide
 * al servidor un permiso de subida acotado (presigned POST) y el servidor
 * decide la ruta, el tipo y el tamaño máximo. El cliente no elige nada.
 *
 * Se usa POST firmado y no PUT firmado a propósito: sólo el POST admite la
 * condición `content-length-range`, que es lo único que impide de verdad que
 * alguien suba cinco gigas. Con PUT el límite sería una promesa del cliente.
 */

let cached: S3Client | null | undefined;

export function getS3(): S3Client | null {
  if (cached !== undefined) return cached;
  cached = isAwsConfigured ? new S3Client(awsClientConfig) : null;
  return cached;
}

/** Ruta canónica de un archivo dentro de una versión publicada. */
export function projectObjectKey(
  ownerId: string,
  projectId: string,
  version: number,
  relativePath: string
): string {
  return `projects/${ownerId}/${projectId}/v${version}/${relativePath}`;
}

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/**
 * Firma la subida de UN archivo del proyecto.
 *
 * Valida en el servidor lo mismo que validaba `storage.rules`: propiedad
 * (implícita: la clave se construye con el uid del token, no con lo que mande
 * el cliente), ruta sin traversal ni archivos ocultos, extensión en la lista
 * blanca y tamaño máximo. El Content-Type lo decide el servidor a partir de la
 * extensión, nunca el cliente: es la misma regla que aplica el origen aislado
 * al servir.
 */
export async function presignProjectUpload(params: {
  ownerId: string;
  projectId: string;
  version: number;
  relativePath: string;
  sizeBytes: number;
}): Promise<{ post: PresignedPost; key: string; contentType: string }> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');

  const safePath = sanitizeRelativePath(params.relativePath);
  if (!safePath) throw new UploadRejected(`Ruta no admitida: ${params.relativePath}`);
  if (!isAllowedExtension(safePath)) {
    throw new UploadRejected(`Tipo de archivo no permitido: ${safePath}`);
  }
  if (params.sizeBytes > LIMITS.maxFileBytes) {
    throw new UploadRejected(`El archivo ${safePath} supera el límite por archivo.`);
  }
  if (!Number.isInteger(params.version) || params.version < 1) {
    throw new UploadRejected('Versión no válida.');
  }

  const key = projectObjectKey(params.ownerId, params.projectId, params.version, safePath);
  const contentType = contentTypeFor(safePath);

  const post = await createPresignedPost(s3, {
    Bucket: PROJECTS_BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 0, LIMITS.maxFileBytes],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: 300,
  });

  return { post, key, contentType };
}

/** Firma la subida de una portada o un avatar al bucket público. */
export async function presignImageUpload(params: {
  ownerId: string;
  kind: 'cover' | 'avatar';
  projectId?: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ post: PresignedPost; key: string; publicUrl: string }> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');

  const allowed: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  const extension = allowed[params.contentType];
  if (!extension) throw new UploadRejected('La imagen debe ser PNG, JPEG, WebP o AVIF.');

  const maxBytes = params.kind === 'cover' ? LIMITS.maxCoverBytes : 1 * 1024 * 1024;
  if (params.sizeBytes > maxBytes) throw new UploadRejected('La imagen pesa demasiado.');

  const key =
    params.kind === 'cover'
      ? `covers/${params.ownerId}/${params.projectId}/cover.${extension}`
      : `avatars/${params.ownerId}/avatar.${extension}`;

  const post = await createPresignedPost(s3, {
    Bucket: PUBLIC_BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 0, maxBytes],
      ['eq', '$Content-Type', params.contentType],
    ],
    Fields: { 'Content-Type': params.contentType },
    Expires: 300,
  });

  return { post, key, publicUrl: publicImageUrl(key) };
}

/** URL pública de una imagen del bucket de lectura abierta. */
export function publicImageUrl(key: string): string {
  const base = process.env.UINEXUS_PUBLIC_BASE_URL?.replace(/\/$/, '');
  return base
    ? `${base}/${key}`
    : `https://${PUBLIC_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Borra todos los objetos bajo un prefijo. Se usa al eliminar un proyecto y al
 * limpiar una versión abandonada: si no, el bucket acumula el trabajo de
 * generaciones de alumnos que ya se graduaron.
 */
export async function deletePrefix(bucket: string, prefix: string): Promise<number> {
  const s3 = getS3();
  if (!s3) return 0;

  let deleted = 0;
  let token: string | undefined;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    const objects = (listed.Contents ?? []).map((item) => ({ Key: item.Key! }));

    if (objects.length > 0) {
      // DeleteObjects acepta 1000 claves por llamada.
      for (let index = 0; index < objects.length; index += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects.slice(index, index + 1000), Quiet: true },
          })
        );
      }
      deleted += objects.length;
    }

    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);

  return deleted;
}

export function deleteProjectFiles(ownerId: string, projectId: string): Promise<number> {
  return deletePrefix(PROJECTS_BUCKET, `projects/${ownerId}/${projectId}/`);
}

// ---------------------------------------------------------------------------
// Archivos académicos (iteración 4)
// ---------------------------------------------------------------------------

export type { AcademicFileClass };

/**
 * Prefijo de los archivos académicos.
 *
 * Estructura propia y NO el espacio de portadas ni el de proyectos: son datos
 * de otra naturaleza —trabajo entregado, no material publicado— y mezclarlos
 * haría imposible razonar sobre retención o sobre a quién pertenece cada byte.
 *
 * La clave la construye SIEMPRE el servidor a partir de datos que ya verificó:
 * la materia, la persona del token, la tarea y el paso. El nombre que el
 * navegador propone no entra en la ruta, sólo se guarda como etiqueta para
 * mostrarlo. Confiar en él permitiría escribir en `../` de otro.
 */
interface AcademicFileOwner {
  courseId: string;
  uid: string;
  assignmentId: string;
  stepId: string;
}

function safeAcademicSegment(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'x'
  );
}

/** Prefijo canónico que vincula una clave con tarea, persona y paso. */
export function academicFilePrefix(params: AcademicFileOwner): string {
  return [
    'academic',
    safeAcademicSegment(params.courseId),
    safeAcademicSegment(params.uid),
    safeAcademicSegment(params.assignmentId),
    safeAcademicSegment(params.stepId),
    '',
  ].join('/');
}

/** Comprueba propiedad antes de aceptar una clave dentro de una entrega. */
export function isAcademicFileKeyFor(params: AcademicFileOwner, key: string): boolean {
  return key.startsWith(academicFilePrefix(params));
}

export function academicFileKey(params: AcademicFileOwner & {
  extension: string;
}): string {
  /**
   * Un segmento de la ruta, saneado.
   *
   * Quitar la barra ya impide la travesía —S3 no resuelve rutas, una clave es
   * una cadena opaca—, pero un segmento como `....otro` es un nombre que
   * confunde a cualquiera que mire el bucket y a cualquier herramienta que sí
   * interprete puntos. Se colapsan las secuencias de puntos y se recortan los
   * de los extremos, de modo que ningún segmento pueda parecerse a `..`.
   */
  return `${academicFilePrefix(params)}${randomUUID()}.${params.extension}`;
}

/**
 * Permiso de subida de un archivo académico.
 *
 * Va al bucket PRIVADO. Un trabajo entregado no es contenido público: se lee
 * con una URL firmada de corta duración (`presignAcademicDownload`), no por
 * tener la dirección.
 */
export async function presignAcademicUpload(params: {
  courseId: string;
  uid: string;
  assignmentId: string;
  stepId: string;
  fileClass: AcademicFileClass;
  contentType: string;
  sizeBytes: number;
  /** Sólo se le lee la extensión. Nunca entra en la ruta. */
  fileName?: string;
}): Promise<{ post: PresignedPost; key: string; contentType: string }> {
  const resolved = assertUploadable(params.fileClass, params);
  const key = academicFileKey({ ...params, extension: resolved.extension });

  const post = await signAcademicPost(key, params.fileClass, resolved.contentType);
  return { post, key, contentType: resolved.contentType };
}

/**
 * Tipo y tamaño, decididos por el servidor.
 *
 * Se comprueban juntos porque juntos son la política: qué puede entrar y cuánto
 * puede pesar. Devolver el `Content-Type` canónico —y no el que mandó el
 * cliente— es lo que hace que el objeto guardado no pueda acabar con un tipo
 * distinto del autorizado.
 */
function assertUploadable(
  fileClass: AcademicFileClass,
  input: { contentType: string; sizeBytes: number; fileName?: string }
): { extension: string; contentType: string } {
  const resolved = resolveAcademicUpload(fileClass, input);
  if (!resolved) {
    throw new UploadRejected(
      `Ese tipo de archivo no se admite aquí. Se admiten: ${allowedExtensionsFor(fileClass).join(', ')}.`
    );
  }

  const maxBytes = ACADEMIC_FILE_LIMITS[fileClass];
  if (input.sizeBytes > maxBytes) {
    throw new UploadRejected(
      `El archivo supera el límite de ${Math.round(maxBytes / (1024 * 1024))} MB.`
    );
  }

  return resolved;
}

async function signAcademicPost(
  key: string,
  fileClass: AcademicFileClass,
  contentType: string
): Promise<PresignedPost> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');

  return createPresignedPost(s3, {
    Bucket: PROJECTS_BUCKET,
    Key: key,
    Conditions: [
      // El tamaño se aplica AQUÍ. Es la única forma de que sea un límite y no
      // una promesa del cliente: sólo el POST firmado admite esta condición.
      ['content-length-range', 0, ACADEMIC_FILE_LIMITS[fileClass]],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: 600,
  });
}

// ---------------------------------------------------------------------------
// Materiales de la tarea
// ---------------------------------------------------------------------------

/**
 * Prefijo de los archivos que reparte el profesorado.
 *
 * Espacio SEPARADO del de las entregas, y ésa es toda la seguridad de la
 * separación: una clave de entrega es
 * `academic/<materia>/<uid>/<tarea>/<paso>/…` y una de material es
 * `academic/materials/<materia>/<tarea>/…`. Las dos formas no pueden confundirse
 * ni ser aceptadas la una por la otra, así que nadie puede citar el material de
 * la clase como si fuera su entrega, ni al revés.
 *
 * Sigue bajo `academic/` porque `presignAcademicDownload` sólo firma la lectura
 * de ese espacio: es el mismo bucket privado y la misma política de lectura.
 */
export function assignmentMaterialPrefix(params: {
  courseId: string;
  assignmentId: string;
}): string {
  return [
    'academic',
    'materials',
    safeAcademicSegment(params.courseId),
    safeAcademicSegment(params.assignmentId),
    '',
  ].join('/');
}

export function assignmentMaterialKey(params: {
  courseId: string;
  assignmentId: string;
  extension: string;
}): string {
  return `${assignmentMaterialPrefix(params)}${randomUUID()}.${params.extension}`;
}

/** ¿Esta clave es de ESTA tarea? Impide registrar el material de otra. */
export function isAssignmentMaterialKeyFor(
  params: { courseId: string; assignmentId: string },
  key: string
): boolean {
  return key.startsWith(assignmentMaterialPrefix(params));
}

/**
 * Permiso de subida de un material.
 *
 * Mismo bucket privado y mismo mecanismo que una entrega: el navegador sube
 * DIRECTAMENTE a S3 con un permiso acotado a una ruta, un tipo y un tamaño. Un
 * `.xlsx` de 20 MB a través de una función serverless sería tiempo pagado para
 * nada.
 */
export async function presignAssignmentMaterialUpload(params: {
  courseId: string;
  assignmentId: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
}): Promise<{ post: PresignedPost; key: string; contentType: string }> {
  const resolved = assertUploadable('material', params);
  const key = assignmentMaterialKey({ ...params, extension: resolved.extension });

  const post = await signAcademicPost(key, 'material', resolved.contentType);
  return { post, key, contentType: resolved.contentType };
}

/**
 * Borra UN objeto académico.
 *
 * Se usa al quitar un material: a diferencia de una entrega —que es trabajo de
 * otra persona y no se borra en cascada— un material lo puso quien lo quita, y
 * dejar el objeto huérfano en el bucket sólo acumula bytes que nadie va a
 * reclamar.
 */
export async function deleteAcademicObject(key: string): Promise<void> {
  const s3 = getS3();
  if (!s3) return;
  if (!key.startsWith('academic/')) {
    throw new UploadRejected('Esa ruta no es un archivo académico.');
  }
  await s3.send(new DeleteObjectCommand({ Bucket: PROJECTS_BUCKET, Key: key }));
}

// ---------------------------------------------------------------------------
// Assets de NexBook (iteración 9)
// ---------------------------------------------------------------------------

/**
 * Dónde viven las imágenes de un NexBook.
 *
 * ```
 * nexbook/<ownerUid>/<assetId>.<ext>
 * ```
 *
 * Bucket PRIVADO y prefijo propio, no `academic/`. La separación no es
 * cosmética: `presignAcademicDownload` firma la lectura de cualquier cosa bajo
 * `academic/`, y un asset de NexBook no debe poder leerse por esa puerta —su
 * autorización es otra: la da el documento que lo referencia, no la materia—.
 *
 * ## Por qué la clave NO lleva el id del NexBook
 *
 * Porque un asset sobrevive a copias. El documento se duplica al menos en tres
 * sitios —publicar, entregar, «crear copia»— y si la clave llevara el id del
 * documento, cada copia apuntaría a un objeto que no existe bajo su propio
 * prefijo. Habría que duplicar los bytes en cada copia, y entonces publicar un
 * documento con diez imágenes sería copiar cuarenta megas en S3.
 *
 * Colgar de la PERSONA conserva lo que de verdad importa: la clave la construye
 * el servidor con el uid del token, así que la propiedad sigue siendo
 * estructural y nadie puede escribir en el espacio de otro. Qué se puede leer lo
 * decide aparte el documento que referencia el asset.
 */
export function nexBookAssetPrefix(ownerUid: string): string {
  return `nexbook/${safeAcademicSegment(ownerUid)}/`;
}

export function nexBookAssetKey(params: {
  ownerUid: string;
  assetId: string;
  extension: string;
}): string {
  return `${nexBookAssetPrefix(params.ownerUid)}${safeAcademicSegment(
    params.assetId
  )}.${safeAcademicSegment(params.extension)}`;
}

/** Los tipos de imagen que se admiten, y su extensión canónica. */
const NEXBOOK_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

/**
 * SVG NO está en la lista, y es una decisión de seguridad.
 *
 * Un SVG es un documento XML que puede llevar `<script>`, `<foreignObject>` y
 * manejadores `on*`. Servirlo desde el mismo origen y pintarlo sería ejecutar
 * código de quien subió el archivo en la sesión de quien lo mira —un NexBook
 * publicado lo abre cualquiera—. Aceptarlo exige un saneador de SVG que este
 * proyecto no tiene, así que no se acepta. Ver docs/SECURITY.md.
 */
export function nexBookImageExtension(contentType: string): string | null {
  return NEXBOOK_IMAGE_TYPES[contentType] ?? null;
}

/**
 * Permiso de subida de una imagen de NexBook.
 *
 * Mismo mecanismo que una entrega: POST firmado, con el tamaño aplicado por S3
 * mediante `content-length-range` y el `Content-Type` fijado por el servidor. El
 * navegador no elige ni la ruta, ni el tipo, ni cuánto puede pesar.
 */
export async function presignNexBookAssetUpload(params: {
  ownerUid: string;
  assetId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ post: PresignedPost; key: string; contentType: string }> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');

  const extension = nexBookImageExtension(params.contentType);
  if (!extension) {
    throw new UploadRejected('La imagen debe ser PNG, JPEG o WebP.');
  }
  if (params.sizeBytes > NEXBOOK_LIMITS.maxAssetBytes) {
    throw new UploadRejected(
      `La imagen supera el límite de ${Math.round(NEXBOOK_LIMITS.maxAssetBytes / (1024 * 1024))} MB.`
    );
  }

  const key = nexBookAssetKey({ ...params, extension });

  const post = await createPresignedPost(s3, {
    Bucket: PROJECTS_BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 0, NEXBOOK_LIMITS.maxAssetBytes],
      ['eq', '$Content-Type', params.contentType],
    ],
    Fields: { 'Content-Type': params.contentType },
    Expires: 300,
  });

  return { post, key, contentType: params.contentType };
}

/**
 * URL de lectura temporal de un asset.
 *
 * Corta a propósito y NUNCA se guarda en el documento. Quien pinta la imagen
 * pasa por `/api/nexbooks/:id/assets/:assetId`, que comprueba el permiso en CADA
 * petición y redirige aquí. Guardar la URL firmada dentro del documento
 * convertiría un permiso temporal en uno permanente, y además viajaría dentro de
 * cada exportación.
 */
export async function presignNexBookAssetDownload(key: string): Promise<string> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');
  if (!key.startsWith('nexbook/')) {
    throw new UploadRejected('Esa ruta no es un asset de NexBook.');
  }

  return getSignedUrl(s3, new GetObjectCommand({ Bucket: PROJECTS_BUCKET, Key: key }), {
    expiresIn: 300,
  });
}

/** Los bytes de un asset. Lo usa el exportador para meterlos en el ZIP. */
export async function readNexBookAsset(
  key: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const s3 = getS3();
  if (!s3) return null;
  if (!key.startsWith('nexbook/')) {
    throw new UploadRejected('Esa ruta no es un asset de NexBook.');
  }

  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: PROJECTS_BUCKET, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return null;
    return { bytes, contentType: result.ContentType ?? 'application/octet-stream' };
  } catch {
    // Un asset que el documento menciona y que no está en el bucket no es un
    // fallo del exportador: se omite y el resto del archivo se genera igual.
    return null;
  }
}

/** Sube bytes directamente. Lo usa el importador, que ya los tiene en memoria. */
export async function putNexBookAsset(params: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<boolean> {
  const s3 = getS3();
  if (!s3) return false;
  if (!params.key.startsWith('nexbook/')) {
    throw new UploadRejected('Esa ruta no es un asset de NexBook.');
  }
  if (!nexBookImageExtension(params.contentType)) {
    throw new UploadRejected('Ese tipo de imagen no se admite.');
  }
  if (params.bytes.byteLength > NEXBOOK_LIMITS.maxAssetBytes) {
    throw new UploadRejected('La imagen pesa demasiado.');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: PROJECTS_BUCKET,
      Key: params.key,
      Body: params.bytes,
      ContentType: params.contentType,
    })
  );
  return true;
}

/**
 * Borra UN asset.
 *
 * Y no «los de este NexBook», que es lo que pediría el nombre obvio. Con las
 * claves colgando de la persona y no del documento, los assets se COMPARTEN
 * entre un documento y sus copias: borrar en cascada al eliminar un NexBook
 * dejaría rota la publicación que salió de él y la entrega que ya se calificó.
 *
 * La consecuencia se asume y está anotada: un asset cuyo bloque se borró deja de
 * poder leerse —ningún documento lo referencia— pero sus bytes siguen en el
 * bucket. Ver «assets huérfanos» en docs/LIMITATIONS.md.
 */
export async function deleteNexBookAsset(ownerUid: string, key: string): Promise<void> {
  const s3 = getS3();
  if (!s3) return;
  if (!key.startsWith(nexBookAssetPrefix(ownerUid))) {
    throw new UploadRejected('Ese asset no es tuyo.');
  }
  await s3.send(new DeleteObjectCommand({ Bucket: PROJECTS_BUCKET, Key: key }));
}

/**
 * URL de lectura temporal de un archivo académico.
 *
 * Corta de duración a propósito: se pide cuando alguien va a mirar el archivo,
 * no se guarda en la entrega. Así el enlace que quede en un historial deja de
 * servir enseguida, y quién puede leer se decide en cada petición contra la
 * materia y no una vez para siempre.
 */
export async function presignAcademicDownload(key: string): Promise<string> {
  const s3 = getS3();
  if (!s3) throw new UploadRejected('El almacenamiento no está disponible.');

  // Sólo claves del espacio académico. Sin esto, el mismo endpoint firmaría la
  // lectura de cualquier objeto del bucket, incluido el código de proyectos.
  if (!key.startsWith('academic/')) {
    throw new UploadRejected('Esa ruta no es un archivo académico.');
  }

  return getSignedUrl(s3, new GetObjectCommand({ Bucket: PROJECTS_BUCKET, Key: key }), {
    expiresIn: 300,
  });
}
