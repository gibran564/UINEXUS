import { rejectedCodeRun } from '../code-runner-contract';
import type { ExecutionProvider, ExecutionProviderId } from './provider-contract';

export const BRIDGE_UNAVAILABLE_REASON = 'Nextudio Bridge todavía no existe.';
export const CLOUD_UNAVAILABLE_REASON = 'La ejecución en la nube todavía no está disponible.';

function createUnavailableProvider(
  id: Exclude<ExecutionProviderId, 'browser'>,
  reason: string
): ExecutionProvider {
  return {
    id,
    async capabilities() {
      return { provider: id, available: false, unavailableReason: reason, runtimes: [] };
    },
    async run() {
      // Un placeholder responde de forma explícita y local: no descubre
      // servicios, no toca la red y nunca disfraza la ausencia como éxito.
      return rejectedCodeRun(reason);
    },
  };
}

export function createBridgeExecutionProvider(): ExecutionProvider {
  return createUnavailableProvider('bridge', BRIDGE_UNAVAILABLE_REASON);
}

export function createCloudExecutionProvider(): ExecutionProvider {
  return createUnavailableProvider('cloud', CLOUD_UNAVAILABLE_REASON);
}
