import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Tipos de `table-definitions.mjs`.
 *
 * El módulo es JavaScript plano porque lo ejecutan scripts de Node sin paso de
 * compilación, pero lo importa además el arnés de integración, que sí es
 * TypeScript. Esta declaración es lo que permite que ese lado siga tipado sin
 * convertir los scripts en un proyecto de TypeScript aparte.
 */

export declare function tableDefinitions(
  tables: Record<string, string>,
  indexes: Record<string, string>
): CreateTableCommandInput[];

export declare function tablePrimaryKeys(tables: Record<string, string>): Map<string, string>;
