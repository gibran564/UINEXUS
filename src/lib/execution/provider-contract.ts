import type { CodeRunRequest, CodeRunResult } from '../code-runner-contract';
import type { ProgrammingLanguage } from '../types';

export type ExecutionProviderId = 'browser' | 'bridge' | 'cloud';

/** Lo que un proveedor puede ejecutar de un lenguaje concreto. */
export interface RuntimeCapability {
  language: ProgrammingLanguage;
  /**
   * Versiones concretas que el proveedor garantiza.
   *
   * Ausente significa que no garantiza ninguna versión concreta, no «cualquiera».
   * Por eso, si se pide `runtimeVersion`, sólo satisface la petición un runtime
   * que declare explícitamente esa versión.
   */
  versions?: string[];
  multiFile: boolean;
  gui: boolean;
  interactive: boolean;
}

export interface ExecutionCapabilities {
  provider: ExecutionProviderId;
  /**
   * Declarado NO es lo mismo que utilizable. Bridge sin instalar y Cloud
   * apagado se describen igual y no ejecutan ninguno.
   */
  available: boolean;
  /** Por qué no está disponible, para poder decirlo sin inventarlo. */
  unavailableReason?: string;
  runtimes: RuntimeCapability[];
  /** Sólo Bridge, cuando exista: qué versión del puente respondió. */
  bridgeVersion?: string;
}

export interface ExecutionProvider {
  readonly id: ExecutionProviderId;
  capabilities(): Promise<ExecutionCapabilities>;
  /**
   * En N6.0, `run()` representa únicamente una ejecución batch y finalizable:
   * se lanza, termina y devuelve un `CodeRunResult`.
   *
   * `gui` e `interactive` describen capacidades previstas para fases futuras;
   * declararlas no significa que `run()` pueda sostener hoy una sesión persistente.
   * Cuando lleguen Java GUI o los procesos interactivos usarán un contrato de sesión
   * separado, con ciclo de vida propio, arranque y parada, porque `CodeRunResult`
   * describe un resultado terminado y no una sesión viva. Ese contrato todavía no
   * existe en N6.0.
   */
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}

/**
 * La política pertenece a la actividad, no al dispositivo.
 *
 * Por eso el proveedor sólo declara capacidades y NO recibe la política en un
 * `canRun`: mezclar ambas cosas haría que el mismo dispositivo respondiera de
 * forma distinta a lo que puede hacer según quién formule la pregunta.
 */
export type ExecutionPolicy =
  | 'local-first'
  | 'browser-only'
  | 'bridge-required'
  | 'cloud-required';

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = 'local-first';
