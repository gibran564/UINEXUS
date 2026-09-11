import 'server-only';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { INDEXES, TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import { DEFAULT_PROGRAMMING_LANGUAGE } from '../constants';
import type {
  NexBookRecord,
  Workspace,
  WorkspaceRecord,
  WorkspaceSummary,
} from '../types';

/**
 * Prácticas de programación: lectura y escritura.
 *
 * ## La invariante de esta capa
 *
 * Una práctica es PRIVADA. No hay ninguna función aquí que devuelva prácticas
 * de otra persona, y `ownerUid` es parámetro obligatorio en todas las que
 * leen: «ver la práctica de otro» no está prohibido con un `if`, es que no hay
 * ninguna firma donde quepa pedirlo.
 *
 * `getOwnWorkspace` lee por id Y comprueba el dueño antes de devolver. Podría
 * parecer redundante con la ruta que ya autentica, pero es la diferencia entre
 * una comprobación y una garantía: si mañana alguien llama a esto desde otro
 * sitio, sigue sin poder leer lo que no es suyo.
 */

/** Todo lo persistido se normaliza al leer: los registros viejos no se migran. */
export function normalizeWorkspace(raw: Partial<WorkspaceRecord>): WorkspaceRecord {
  return {
    id: raw.id ?? '',
    ownerUid: raw.ownerUid ?? '',
    /**
     * Ausente significa `code`: las prácticas guardadas antes de los NexBooks
     * se crearon cuando era la única forma que existía. Leerlas como documento
     * convertiría en NexBook algo que nadie escribió como NexBook.
     */
    kind: raw.kind ?? 'code',
    context: raw.context ?? 'personal',
    title: raw.title ?? 'Práctica sin título',
    language: raw.language ?? DEFAULT_PROGRAMMING_LANGUAGE,
    code: raw.code ?? '',
    /**
     * Ausente hoy en todos los registros, y por eso se omite en vez de poner
     * `{}`: un objeto vacío y «no hay varios archivos» son estados distintos, y
     * el día que exista multi-archivo hará falta distinguirlos.
     */
    ...(raw.files ? { files: raw.files } : {}),
    courseId: raw.courseId ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
  };
}

/** El DTO que viaja al navegador. Sin `ownerUid`: es de quien lo pide. */
export function toWorkspace(record: WorkspaceRecord): Workspace {
  const { ownerUid: _ownerUid, ...workspace } = record;
  return workspace;
}

/**
 * Todo lo que esta persona tiene en Prácticas: código y NexBooks, junto.
 *
 * UNA consulta para los dos tipos. Es la razón por la que comparten tabla: con
 * dos tablas habría que fusionar dos listas y reordenarlas en memoria, y en ese
 * momento la paginación deja de ser correcta —no se puede paginar una mezcla de
 * dos cursores—.
 *
 * Devuelve resúmenes, no documentos. Mandar el contenido completo de cada
 * NexBook para pintar una lista de títulos serían cientos de KB por pantalla.
 */
export async function listWorkspaceSummariesForOwner(
  ownerUid: string
): Promise<WorkspaceSummary[]> {
  const client = getDynamo();
  if (!client) return [];

  const result = await client.send(
    new QueryCommand({
      TableName: TABLES.workspaces,
      IndexName: INDEXES.workspacesByOwner,
      KeyConditionExpression: 'ownerUid = :owner',
      ExpressionAttributeValues: { ':owner': ownerUid },
      // Lo último que se tocó, primero.
      ScanIndexForward: false,
      Limit: 200,
    })
  );

  return (result.Items ?? []).flatMap((raw): WorkspaceSummary[] => {
    // `kind` se lee como cadena y no como `WorkspaceKind`: la tabla guarda
    // también publicaciones, que NO son un tipo de workspace. Ver más abajo.
    const item = raw as Partial<Omit<WorkspaceRecord & NexBookRecord, 'kind'>> & { kind?: string };

    /**
     * Las PUBLICACIONES no son workspaces, aunque compartan tabla.
     *
     * Una publicación es una copia congelada de un NexBook que ya está en esta
     * lista; enseñarla aparte haría que cada documento publicado apareciera dos
     * veces, y borrar «el segundo» borraría la publicación sin que nadie lo
     * hubiera pedido. Se filtran aquí, que es el único sitio que lee la tabla por
     * dueño. Ver `data/nexbook-publications.ts`.
     */
    if (item.kind === 'nexbook-publication') return [];

    if (item.kind === 'nexbook') {
      const nexbook = item as Partial<NexBookRecord>;
      /**
       * Las copias de una actividad NO salen aquí.
       *
       * Prácticas es el espacio personal. Una instancia de workflow se abre
       * desde su actividad, y mezclarlas dejaría entregas en curso en la misma
       * lista que los borradores sueltos: la persona ya no sabría qué cuenta.
       */
      if (nexbook.context && nexbook.context.type !== 'personal') return [];
      return [
        {
          id: nexbook.id ?? '',
          kind: 'nexbook' as const,
          title: nexbook.title ?? 'NexBook sin título',
          language: null,
          blockCount: nexbook.document?.blocks?.length ?? 0,
          updatedAt: nexbook.updatedAt ?? '',
        },
      ];
    }

    const workspace = normalizeWorkspace(item as Partial<WorkspaceRecord>);
    if (workspace.context !== 'personal') return [];
    return [
      {
        id: workspace.id,
        kind: 'code' as const,
        title: workspace.title,
        language: workspace.language,
        blockCount: null,
        updatedAt: workspace.updatedAt,
      },
    ];
  });
}

/** La práctica, sólo si es de quien pregunta. `null` cubre las dos negativas. */
export async function getOwnWorkspace(
  workspaceId: string,
  ownerUid: string
): Promise<WorkspaceRecord | null> {
  const client = getDynamo();
  if (!client) return null;

  const result = await client.send(
    new GetCommand({ TableName: TABLES.workspaces, Key: { id: workspaceId } })
  );
  if (!result.Item) return null;

  const record = normalizeWorkspace(result.Item as Partial<WorkspaceRecord>);
  /**
   * No existe y no es tuya se responden IGUAL, con `null`.
   *
   * Distinguirlas convertiría esta función en un oráculo: probando ids se
   * podría averiguar qué prácticas existen aunque no se pudiera leerlas.
   */
  return record.ownerUid === ownerUid ? record : null;
}

export async function putWorkspace(record: WorkspaceRecord): Promise<WorkspaceRecord> {
  const client = getDynamo();
  if (!client) throw new Error('Sin base de datos configurada.');

  await client.send(new PutCommand({ TableName: TABLES.workspaces, Item: record }));
  return record;
}

/**
 * Guarda los campos que cambiaron, no la práctica entera.
 *
 * Un `Put` completo desde el autoguardado sobreescribiría `createdAt` y
 * `ownerUid` con lo que trajera el cliente. Con `UpdateCommand` sólo se toca lo
 * que se nombra, y la condición sobre `ownerUid` hace que una práctica ajena no
 * se pueda escribir ni por error de programación.
 */
export async function updateOwnWorkspace(
  workspaceId: string,
  ownerUid: string,
  changes: { title?: string; code?: string; language?: string }
): Promise<WorkspaceRecord | null> {
  const client = getDynamo();
  if (!client) return null;

  const updatedAt = new Date().toISOString();
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': updatedAt, ':owner': ownerUid };
  const sets = ['#updatedAt = :updatedAt'];

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }

  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: TABLES.workspaces,
        Key: { id: workspaceId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'ownerUid = :owner',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return normalizeWorkspace((result.Attributes ?? {}) as Partial<WorkspaceRecord>);
  } catch (caught) {
    // La condición falló: no existe, o no es de quien pide. Las dos se
    // responden igual, por la misma razón que en `getOwnWorkspace`.
    if (caught instanceof Error && caught.name === 'ConditionalCheckFailedException') return null;
    throw caught;
  }
}

export async function deleteOwnWorkspace(
  workspaceId: string,
  ownerUid: string
): Promise<boolean> {
  const client = getDynamo();
  if (!client) return false;

  try {
    await client.send(
      new DeleteCommand({
        TableName: TABLES.workspaces,
        Key: { id: workspaceId },
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
