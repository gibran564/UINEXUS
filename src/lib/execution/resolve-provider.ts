import type { CodeRunRequest } from '../code-runner-contract';
import type {
  ExecutionCapabilities,
  ExecutionPolicy,
  ExecutionProviderId,
  RuntimeCapability,
} from './provider-contract';
import { DEFAULT_EXECUTION_POLICY } from './provider-contract';

export type ExecutionResolution =
  | { kind: 'provider'; providerId: ExecutionProviderId; runtime: RuntimeCapability }
  | { kind: 'unavailable'; reason: string };

/** La prioridad local está en datos para que sumar Bridge no cambie el algoritmo. */
export const LOCAL_FIRST_ORDER: readonly ExecutionProviderId[] = ['browser', 'bridge', 'cloud'];

const POLICY_ORDER: Readonly<Record<ExecutionPolicy, readonly ExecutionProviderId[]>> = {
  'local-first': LOCAL_FIRST_ORDER,
  'browser-only': ['browser'],
  'bridge-required': ['bridge'],
  'cloud-required': ['cloud'],
};

const REQUIRED_PROVIDER_LABEL: Partial<Record<ExecutionPolicy, string>> = {
  'bridge-required': 'Nextudio Bridge',
  'cloud-required': 'la ejecución en la nube',
};

/**
 * Elige sólo a partir de datos ya reunidos: no consulta red, runtimes ni estado
 * global. Así la misma petición y las mismas capacidades siempre dan lo mismo.
 */
export function resolveExecutionProvider(
  request: Pick<CodeRunRequest, 'language' | 'files' | 'entryFile'>,
  capabilities: readonly ExecutionCapabilities[],
  policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY,
  runtimeVersion?: string
): ExecutionResolution {
  const order = POLICY_ORDER[policy];
  const isMultiFile = request.files !== undefined && request.entryFile !== undefined;
  let languageWasDeclared = false;
  let rejectedMultiFile = false;
  let rejectedVersion = false;

  for (const providerId of order) {
    const provider = capabilities.find((candidate) => candidate.provider === providerId);
    if (!provider) continue;

    const runtimes = provider.runtimes.filter((runtime) => runtime.language === request.language);
    languageWasDeclared ||= runtimes.length > 0;

    // Declarar un runtime no autoriza a usarlo: disponibilidad y capacidad son
    // ejes separados, y esta barrera fija esa invariante antes de elegirlo.
    if (!provider.available) continue;

    for (const runtime of runtimes) {
      if (isMultiFile && !runtime.multiFile) {
        rejectedMultiFile = true;
        continue;
      }
      if (runtimeVersion !== undefined && !runtime.versions?.includes(runtimeVersion)) {
        rejectedVersion = true;
        continue;
      }
      return { kind: 'provider', providerId, runtime };
    }
  }

  const requiredLabel = REQUIRED_PROVIDER_LABEL[policy];
  if (requiredLabel) {
    const required = capabilities.find((candidate) => candidate.provider === order[0]);
    const detail = required?.available
      ? `no ofrece ${request.language} con las capacidades pedidas`
      : (required?.unavailableReason?.replace(/[.!?]+$/, '') ?? 'no está disponible');
    return {
      kind: 'unavailable',
      reason: `La actividad exige ${requiredLabel}, pero ${detail}.`,
    };
  }
  if (rejectedMultiFile) {
    return {
      kind: 'unavailable',
      reason: `Ningún proveedor permitido admite proyectos multiarchivo de ${request.language}.`,
    };
  }
  if (rejectedVersion) {
    return {
      kind: 'unavailable',
      reason: `Ningún proveedor permitido ofrece ${request.language} ${runtimeVersion}.`,
    };
  }
  if (policy === 'browser-only') {
    return {
      kind: 'unavailable',
      reason: `Este lenguaje todavía no se ejecuta en el navegador: ${request.language}.`,
    };
  }
  return {
    kind: 'unavailable',
    reason: languageWasDeclared
      ? `Hay un proveedor para ${request.language}, pero todavía no está disponible aquí.`
      : `Este lenguaje todavía no se ejecuta aquí: ${request.language}.`,
  };
}
