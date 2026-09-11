import 'server-only';

import { createHash } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import { NEXBOOK_FORMAT_VERSION } from '../types';
import type {
  NexBookDocument,
  NexBookPublication,
  NexBookPublicationRecord,
  NexBookPublicVisibility,
} from '../types';

/**
 * Publicaciones de NexBook: lectura y escritura.
 *
 * ## Una publicación es otra COSA, no otro estado
 *
 * No es el mismo item con `visibility` cambiada: es un registro aparte con su
 * propio documento congelado. La diferencia se nota en lo que pasa mientras
 * alguien sigue escribiendo:
 *
 * ```
 * NexBook vivo     revisión 41, 42, 43…   cambia con cada pulsación
 * Publicación      el documento de la 41  no cambia hasta que se diga
 * ```
 *
 * Con un interruptor sobre el documento vivo, publicar habría significado
 * publicar EN DIRECTO: un experimento a medias o una nota personal quedan
 * expuestos sin que nadie lo decida.
 *
 * ## Comparte tabla, otra vez, y por la misma razón que los NexBooks
 *
 * `uinexus-workspaces` con `kind: 'nexbook-publication'`. El patrón de acceso es
 * el mismo —leer por id, listar los míos por recencia— y crear una tabla nueva
 * habría sido crear un recurso de AWS para un tipo de item más. Que el `kind`
 * discrimine ya está probado por las prácticas y los NexBooks.
 *
 * El `slug` ES el id del item. Así la unicidad la garantiza la clave primaria y
 * `attribute_not_exists(id)`, sin una consulta previa donde se cuelen dos
 * publicaciones con la misma dirección.
 */

/**
 * El slug de una publicación. Determinista por (dueño, NexBook).
 *
 * Determinista y no aleatorio para que «actualizar la publicación» encuentre la
 * que ya existe sin guardar un puntero en el documento vivo. Y es un HASH para
 * que no se pueda deducir de él ni el uid ni el id del documento original: el
 * slug viaja en una URL que puede acabar en cualquier parte.
 */
export function publicationSlugFor(ownerUid: string, nexbookId: string): string {
  return createHash('sha256')
    .update(`nexbook:publication:${ownerUid}:${nexbookId}`)
    .digest('hex')
    .slice(0, 24);
}

export function normalizePublication(
  raw: Partial<NexBookPublicationRecord>
): NexBookPublicationRecord {
  return {
    slug: raw.slug ?? '',
    ownerUid: raw.ownerUid ?? '',
    sourceNexbookId: raw.sourceNexbookId ?? '',
    title: raw.title ?? 'NexBook sin título',
    authorName: raw.authorName ?? '',
    // `class` cuando falta, que es lo MENOS abierto de los tres estados
    // publicables. Un registro cuya visibilidad se perdió no puede leerse como
    // público: el error se descubriría por el lado malo.
    visibility: raw.visibility ?? 'class',
    document: {
      formatVersion: raw.document?.formatVersion ?? NEXBOOK_FORMAT_VERSION,
      blocks: raw.document?.blocks ?? [],
      results: raw.document?.results ?? {},
    },
    sourceRevision: raw.sourceRevision ?? 0,
    publishedAt: raw.publishedAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.publishedAt ?? new Date(0).toISOString(),
  };
}

/**
 * Lo que se manda al navegador.
 *
 * Quita `ownerUid` y `sourceNexbookId`. El primero por la regla de siempre —el
 * UID no cruza la frontera—; el segundo porque es la dirección del documento
 * VIVO, y publicar no puede filtrar por dónde se sigue editando.
 */
export function toPublication(record: NexBookPublicationRecord): NexBookPublication {
  const { ownerUid: _ownerUid, sourceNexbookId: _sourceNexbookId, ...publication } = record;
  return publication;
}

export async function getPublication(slug: string): Promise<NexBookPublicationRecord | null> {
  const client = getDynamo();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.workspaces, Key: { id: slug } })
  );
  if (!result.Item) return null;

  const item = result.Item as Partial<NexBookPublicationRecord> & { kind?: string };
  // Un item que no es una publicación se trata como inexistente: pedir un
  // NexBook por esta puerta no puede devolver el documento vivo de nadie.
  if (item.kind !== 'nexbook-publication') return null;

  return normalizePublication({ ...item, slug });
}

export interface PublishInput {
  ownerUid: string;
  nexbookId: string;
  title: string;
  authorName: string;
  document: NexBookDocument;
  visibility: NexBookPublicVisibility;
  sourceRevision: number;
}

/**
 * Publica, o actualiza lo publicado.
 *
 * Es un `Put` completo y deliberadamente destructivo sobre la versión anterior:
 * una publicación no tiene historial. Lo que sí se conserva es `publishedAt` —la
 * primera vez— porque «publicado en marzo, actualizado en mayo» dice algo y
 * «publicado en mayo» borraría la mitad.
 *
 * La condición protege lo único que importa aquí: que el item no sea de otra
 * persona. Sin ella, quien adivinara un slug podría sobrescribir la publicación
 * ajena con su propio documento.
 */
export async function publishNexBook(input: PublishInput): Promise<NexBookPublicationRecord> {
  const client = getDynamo();
  if (!client) throw new Error('Sin base de datos configurada.');

  const slug = publicationSlugFor(input.ownerUid, input.nexbookId);
  const existing = await getPublication(slug);
  const now = new Date().toISOString();

  const record: NexBookPublicationRecord = {
    slug,
    ownerUid: input.ownerUid,
    sourceNexbookId: input.nexbookId,
    title: input.title,
    authorName: input.authorName,
    visibility: input.visibility,
    document: input.document,
    sourceRevision: input.sourceRevision,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  };

  await client.send(
    new PutCommand({
      TableName: TABLES.workspaces,
      Item: { ...record, id: slug, kind: 'nexbook-publication' },
      ConditionExpression: 'attribute_not_exists(id) OR ownerUid = :owner',
      ExpressionAttributeValues: { ':owner': input.ownerUid },
    })
  );

  return record;
}

/** Retira una publicación. El documento vivo no se toca. */
export async function unpublishNexBook(ownerUid: string, nexbookId: string): Promise<boolean> {
  const client = getDynamo();
  if (!client) return false;

  try {
    await client.send(
      new DeleteCommand({
        TableName: TABLES.workspaces,
        Key: { id: publicationSlugFor(ownerUid, nexbookId) },
        ConditionExpression: 'ownerUid = :owner',
        ExpressionAttributeValues: { ':owner': ownerUid },
      })
    );
    return true;
  } catch (caught) {
    if (caught instanceof Error && caught.name === 'ConditionalCheckFailedException') return false;
    throw caught;
  }
}
