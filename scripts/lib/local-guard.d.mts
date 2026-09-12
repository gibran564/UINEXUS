/**
 * Tipos de `local-guard.mjs`.
 *
 * El módulo es JavaScript plano porque lo ejecutan scripts de Node sin paso de
 * compilación; esta declaración existe para que las pruebas —que sí son
 * TypeScript— comprueben sus contratos con tipos y no con `any`.
 */

export declare const LOCAL_TABLE_PREFIX: string;

export declare class NotLocalError extends Error {
  constructor(message: string);
}

export declare function isLoopbackEndpoint(endpoint: string | undefined): boolean;

export declare function requireLocalSandbox(env?: Record<string, string | undefined>): {
  endpoint: string;
  prefix: string;
  region: string;
};

export declare function requireLocalFirebase(env?: Record<string, string | undefined>): {
  projectId: string;
};
