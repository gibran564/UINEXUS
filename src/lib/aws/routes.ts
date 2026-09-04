import 'server-only';

/**
 * CloudFront KeyValueStore firma con SigV4a (multi-region), no con SigV4. El
 * SDK no trae esa implementacion: hay que instalarla Y REGISTRARLA, y se
 * registra por efecto secundario de importarla. Sin esta linea el paquete esta
 * en node_modules pero el cliente lanza igualmente
 * "Neither CRT nor JS SigV4a implementation is available".
 *
 * El fallo aparecia al final de publicar, despues de subir los archivos: el
 * proyecto quedaba `published` en DynamoDB y sin ruta en CloudFront, es decir,
 * publicado y con el enlace roto.
 */
import '@aws-sdk/signature-v4a';

import {
  CloudFrontKeyValueStoreClient,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { awsClientConfig } from './config';
import type { ProjectRecord } from '../types';
import { isPubliclyRoutable } from '../project-access';

/**
 * Mapa de rutas publicas del origen aislado.
 *
 * La CloudFront Function que resuelve `/@handle/slug` no puede consultar
 * DynamoDB, asi que el servidor mantiene un KeyValueStore con lo justo para
 * traducir la URL a una clave de S3.
 *
 * Este mapa ES la politica de visibilidad del origen aislado, no un cache de
 * ella: si un proyecto no tiene entrada, es inalcanzable. Un borrador no esta
 * "oculto", simplemente no existe para CloudFront.
 *
 * Ojo con la diferencia respecto al indice `byStatus` de DynamoDB:
 *   byStatus  -> solo `published`. Es la GALERIA: lo que se puede enumerar.
 *   este mapa -> `published` y `unlisted`. Es el ACCESO POR ENLACE.
 * Un `unlisted` tiene que abrirse por su URL y no aparecer en ninguna lista;
 * por eso esta aqui y no alli.
 */

const KVS_ARN = process.env.UINEXUS_ROUTES_KVS_ARN ?? '';

let cached: CloudFrontKeyValueStoreClient | null | undefined;

function getClient(): CloudFrontKeyValueStoreClient | null {
  if (cached !== undefined) return cached;
  cached = KVS_ARN ? new CloudFrontKeyValueStoreClient(awsClientConfig) : null;
  return cached;
}

export function routeKey(handle: string, slug: string): string {
  return `${handle}/${slug}`;
}

/**
 * Nombres de campo de una letra a proposito: el valor de una clave del
 * KeyValueStore esta limitado a 1 KB, y este mapa lo lee una funcion con 1 ms
 * de presupuesto de CPU. `viewer-request.js` los lee con estos mismos nombres.
 */
function routeValue(project: ProjectRecord): string {
  return JSON.stringify({
    o: project.ownerId,
    p: project.id,
    v: project.version,
    e: project.entryFile || 'index.html',
  });
}

/**
 * Escribe o borra con reintento por conflicto de ETag.
 *
 * El KeyValueStore usa concurrencia optimista: cada escritura exige el ETag
 * actual del almacen entero, no el de la clave. Con una clase publicando a la
 * vez, los choques son normales y no un error; por eso se reintenta en vez de
 * fallar.
 */
async function write(
  apply: (client: CloudFrontKeyValueStoreClient, etag: string) => Promise<unknown>
): Promise<void> {
  const client = getClient();
  if (!client) return;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const described = await client.send(
      new DescribeKeyValueStoreCommand({ KvsARN: KVS_ARN })
    );
    try {
      await apply(client, described.ETag!);
      return;
    } catch (error) {
      const name = (error as { name?: string }).name;
      const retriable = name === 'ConflictException' || name === 'PreconditionFailedException';
      if (!retriable || attempt === 4) throw error;
      // Espera creciente y corta: el conflicto se resuelve en milisegundos.
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/** Sincroniza la ruta con el estado real del proyecto. */
export async function syncProjectRoute(project: ProjectRecord): Promise<void> {
  const key = routeKey(project.ownerHandle, project.slug);

  if (!isPubliclyRoutable(project)) {
    await removeProjectRoute(project.ownerHandle, project.slug);
    return;
  }

  await write((client, etag) =>
    client.send(
      new PutKeyCommand({
        KvsARN: KVS_ARN,
        Key: key,
        Value: routeValue(project),
        IfMatch: etag,
      })
    )
  );
}

export async function removeProjectRoute(handle: string, slug: string): Promise<void> {
  await write((client, etag) =>
    client.send(
      new DeleteKeyCommand({ KvsARN: KVS_ARN, Key: routeKey(handle, slug), IfMatch: etag })
    )
  ).catch((error) => {
    // Borrar una clave que no existe no es un fallo: el estado deseado ya se
    // cumple, y despublicar no debe romperse por eso.
    if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
  });
}
