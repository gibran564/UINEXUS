import 'server-only';

import { createHash } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import { NEXBOOK_FORMAT_VERSION } from '../types';
import type {
  NexBook,
  NexBookContext,
  NexBookDocument,
  NexBookRecord,
  NexBookVisibility,
} from '../types';

/**
 * NexBooks: lectura y escritura.
 *
 * ## Comparten tabla con las prácticas de código, y no por comodidad
 *
 * Los dos viven en `uinexus-workspaces` con un `kind` que los distingue. El
 * argumento no es evitar una migración: es que la pantalla de Prácticas tiene
 * que enseñar LOS DOS en una sola lista ordenada por fecha. Con una tabla eso es
 * una `Query`; con dos, son dos consultas que hay que fusionar y reordenar en
 * memoria, y entonces la paginación deja de ser correcta.
 *
 * Los patrones de acceso son idénticos —leer por id, listar los míos por
 * recencia, escribir con condición sobre el dueño— y el ciclo de vida también:
 * privados, sin fecha límite, de quien los escribió.
 *
 * ## La invariante
 *
 * Igual que en `workspaces.ts`: `ownerUid` es obligatorio en todo lo que lee, y
 * «no existe» y «no es tuyo» se responden IGUAL. Distinguirlos convertiría estas
 * funciones en un oráculo de qué documentos existen.
 */

/**
 * El id de una plantilla docente. Determinista por (actividad, paso).
 *
 * Que sea aritmético y no una consulta previa es lo que hace imposible acabar
 * con dos plantillas del mismo paso por una carrera entre dos pestañas.
 */
export function templateNexBookIdFor(assignmentId: string, stepId: string): string {
  return `t${createHash('sha256').update(`nexbook:template:${assignmentId}:${stepId}`).digest('hex').slice(0, 31)}`;
}

/**
 * El id de la copia de un estudiante. Determinista por (actividad, paso, UID).
 *
 * Es un HASH y no una concatenación por la misma razón que en
 * `submissionIdFor`: este id viaja al navegador y pegar el UID en la URL sería
 * justo la fuga que el resto del proyecto evita.
 *
 * De aquí sale además la instanciación perezosa: la primera vez que alguien
 * abre el paso, un solo `GetItem` dice si su copia ya existe. No hace falta
 * crear trescientas copias al publicar la actividad.
 */
export function instanceNexBookIdFor(
  assignmentId: string,
  stepId: string,
  uid: string
): string {
  return `i${createHash('sha256').update(`nexbook:instance:${assignmentId}:${stepId}:${uid}`).digest('hex').slice(0, 31)}`;
}

/** Todo lo persistido se normaliza al leer. No se migra nada. */
export function normalizeNexBook(raw: Partial<NexBookRecord>): NexBookRecord {
  const document = raw.document;

  return {
    id: raw.id ?? '',
    ownerUid: raw.ownerUid ?? '',
    title: raw.title ?? 'NexBook sin título',
    context: raw.context ?? { type: 'personal' },
    /**
     * `private` cuando falta, y no el valor «más útil».
     *
     * Un documento cuyo estado de visibilidad se perdió no puede leerse como
     * público: el error se descubriría por el lado malo.
     */
    visibility: raw.visibility ?? 'private',
    document: {
      formatVersion: document?.formatVersion ?? NEXBOOK_FORMAT_VERSION,
      blocks: document?.blocks ?? [],
      results: document?.results ?? {},
    },
    revision: raw.revision ?? 0,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
  };
}

/** El DTO que viaja al navegador. Sin `ownerUid`. */
export function toNexBook(record: NexBookRecord): NexBook {
  const { ownerUid: _ownerUid, ...nexbook } = record;
  return nexbook;
}

/** El documento, sólo si es de quien pregunta. */
export async function getOwnNexBook(
  nexbookId: string,
  ownerUid: string
): Promise<NexBookRecord | null> {
  const record = await getNexBookRecord(nexbookId);
  if (!record) return null;
  return record.ownerUid === ownerUid ? record : null;
}

/**
 * El documento sin comprobar el dueño.
 *
 * Existe SÓLO para dos casos donde la autorización la da otra cosa: leer la
 * plantilla de una actividad —que pertenece a la docente pero la lee todo el
 * grupo— y revisar una entrega. Quien llame a esto tiene que haber comprobado
 * ya el acceso a la actividad; por eso no es la función por defecto y por eso su
 * nombre no dice «own».
 */
export async function getNexBookRecord(nexbookId: string): Promise<NexBookRecord | null> {
  const client = getDynamo();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.workspaces, Key: { id: nexbookId } })
  );
  if (!result.Item) return null;

  const item = result.Item as Partial<NexBookRecord> & { kind?: string };
  // Un item de la tabla que NO es un NexBook se trata como inexistente: pedir
  // una práctica de código por esta puerta no debe devolver medio documento.
  if (item.kind !== 'nexbook') return null;

  return normalizeNexBook(item);
}

export interface CreateNexBookInput {
  id: string;
  ownerUid: string;
  title: string;
  context: NexBookContext;
  visibility: NexBookVisibility;
  document: NexBookDocument;
}

/**
 * Crea el documento, y sólo si no existía.
 *
 * `attribute_not_exists(id)` es lo que hace segura la instanciación perezosa: si
 * dos pestañas abren el paso a la vez, la segunda recibe el fallo de condición y
 * lee la que ganó, en lugar de sobrescribir su trabajo con un documento vacío.
 */
export async function createNexBook(input: CreateNexBookInput): Promise<NexBookRecord | null> {
  const client = getDynamo();
  if (!client) throw new Error('Sin base de datos configurada.');

  const now = new Date().toISOString();
  const record: NexBookRecord = { ...input, revision: 1, createdAt: now, updatedAt: now };

  try {
    await client.send(
      new PutCommand({
        TableName: TABLES.workspaces,
        Item: { ...record, kind: 'nexbook' },
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return record;
  } catch (caught) {
    if (caught instanceof Error && caught.name === 'ConditionalCheckFailedException') return null;
    throw caught;
  }
}

/** Qué salió mal al guardar. El cliente necesita distinguirlos para reaccionar. */
export type NexBookSaveOutcome =
  | { ok: true; record: NexBookRecord }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'conflict'; current: NexBookRecord };

/**
 * Guarda con concurrencia optimista.
 *
 * El cliente manda la revisión que CREÍA tener y la escritura sólo ocurre si
 * sigue siendo esa. Sin eso, dos pestañas abiertas se pisarían en silencio y
 * ganaría la última en llegar —que no es la última en editar—.
 *
 * Cuando la condición falla hay que distinguir dos cosas muy distintas: que el
 * documento no exista o no sea tuyo, y que exista pero alguien lo haya guardado
 * mientras. En el segundo caso se devuelve la versión actual para que la
 * interfaz pueda decir qué pasó en vez de un «error» genérico.
 */
export async function saveOwnNexBook(
  nexbookId: string,
  ownerUid: string,
  expectedRevision: number,
  changes: { title?: string; document?: NexBookDocument }
): Promise<NexBookSaveOutcome> {
  const client = getDynamo();
  if (!client) return { ok: false, reason: 'missing' };

  const names: Record<string, string> = { '#updatedAt': 'updatedAt', '#revision': 'revision' };
  const values: Record<string, unknown> = {
    ':updatedAt': new Date().toISOString(),
    ':owner': ownerUid,
    ':expected': expectedRevision,
    ':one': 1,
  };
  const sets = ['#updatedAt = :updatedAt', '#revision = #revision + :one'];

  if (changes.title !== undefined) {
    names['#title'] = 'title';
    values[':title'] = changes.title;
    sets.push('#title = :title');
  }
  if (changes.document !== undefined) {
    names['#document'] = 'document';
    values[':document'] = changes.document;
    sets.push('#document = :document');
  }

  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: TABLES.workspaces,
        Key: { id: nexbookId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'ownerUid = :owner AND #revision = :expected',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return { ok: true, record: normalizeNexBook(result.Attributes as Partial<NexBookRecord>) };
  } catch (caught) {
    if (!(caught instanceof Error) || caught.name !== 'ConditionalCheckFailedException') throw caught;

    // Se relee para saber POR QUÉ falló. No es una consulta de más: es la
    // diferencia entre «recarga, alguien más guardó» y «esto no existe».
    const current = await getOwnNexBook(nexbookId, ownerUid);
    if (!current) return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'conflict', current };
  }
}

export async function deleteOwnNexBook(nexbookId: string, ownerUid: string): Promise<boolean> {
  const client = getDynamo();
  if (!client) return false;

  try {
    await client.send(
      new DeleteCommand({
        TableName: TABLES.workspaces,
        Key: { id: nexbookId },
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
