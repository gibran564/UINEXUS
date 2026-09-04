import 'server-only';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PUBLISHED_KEY, awsClientConfig, isAwsConfigured } from './config';
import type { ProjectRecord } from '../types';

/**
 * Cliente de DynamoDB. Una sola instancia, perezosa: el modo demo no debe
 * pagar el coste de crearla ni fallar por falta de credenciales.
 *
 * Las credenciales las resuelve la cadena por defecto del SDK: en local, el
 * perfil de `aws configure`; en Amplify/Lambda, el rol de ejecución. Nunca hay
 * claves en el repositorio ni en variables de entorno de la aplicación.
 */

let cached: DynamoDBDocumentClient | null | undefined;

export function getDynamo(): DynamoDBDocumentClient | null {
  if (cached !== undefined) return cached;

  if (!isAwsConfigured) {
    cached = null;
    return cached;
  }

  cached = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig), {
    marshallOptions: {
      // Firestore guardaba `null` en varios campos opcionales (cover, courseId,
      // publishedAt). Mantenerlos evita tener que distinguir "ausente" de
      // "vacío" en toda la capa de vistas.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
  return cached;
}

export const isDynamoConfigured = (): boolean => getDynamo() !== null;

/**
 * Clave del índice `byPath`, que resuelve la URL pública `/@handle/slug`.
 * Es la razón por la que `ownerHandle` y `slug` son inmutables: cambiarlos
 * movería la entrega académica de sitio.
 */
export function pathKey(handle: string, slug: string): string {
  return `${handle}/${slug}`;
}

/**
 * Atributos derivados que hacen cumplir la política de visibilidad a nivel de
 * ÍNDICE, no de consulta.
 *
 * `statusKey` sólo existe cuando el proyecto es públicamente listable. Como
 * `byStatus` es un índice DISPERSO, los `unlisted`, los borradores y los
 * ocultados por moderación no están dentro: ninguna consulta puede devolverlos
 * ni por error ni a propósito. Es la traducción estructural de la garantía que
 * antes daba la regla `allow list` de Firestore, y es más fuerte, porque no
 * depende de que quien escriba la consulta se acuerde de filtrar.
 */
export function visibilityAttributes(
  record: Pick<ProjectRecord, 'status' | 'hiddenByAdmin' | 'publishedAt'>
): { statusKey?: string; listedAt?: string } {
  const listable = record.status === 'published' && !record.hiddenByAdmin;
  if (!listable) return {};
  return { statusKey: PUBLISHED_KEY, listedAt: record.publishedAt ?? new Date().toISOString() };
}

/**
 * Nombres de los atributos que sólo existen para alimentar el índice. Al
 * despublicar hay que BORRARLOS, no ponerlos a null: un elemento con la clave
 * presente sigue estando en el índice, y una clave de ordenación no admite
 * null. Por eso `listedAt` es un atributo aparte de `publishedAt`, que sí es
 * dato de la aplicación y sí puede ser null.
 */
export const VISIBILITY_ATTRIBUTES = ['statusKey', 'listedAt'] as const;
