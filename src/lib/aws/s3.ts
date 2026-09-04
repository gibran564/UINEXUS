import 'server-only';

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  AWS_REGION,
  PROJECTS_BUCKET,
  PUBLIC_BUCKET,
  awsClientConfig,
  isAwsConfigured,
} from './config';
import { LIMITS } from '../constants';
import { contentTypeFor, isAllowedExtension, sanitizeRelativePath } from '../files';

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
