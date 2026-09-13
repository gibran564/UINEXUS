import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCodeRunner } from '@/lib/browser-code-runner';
import type { CodeRunRequest, CodeRunResult } from '@/lib/code-runner-contract';
import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { createBrowserExecutionProvider } from '@/lib/execution/browser-provider';
import {
  BRIDGE_UNAVAILABLE_REASON,
  CLOUD_UNAVAILABLE_REASON,
  createBridgeExecutionProvider,
  createCloudExecutionProvider,
} from '@/lib/execution/placeholder-providers';
import type {
  ExecutionCapabilities,
  ExecutionProviderId,
  RuntimeCapability,
} from '@/lib/execution/provider-contract';
import {
  LOCAL_FIRST_ORDER,
  resolveExecutionProvider,
} from '@/lib/execution/resolve-provider';
import type { ProgrammingLanguage } from '@/lib/types';

function runtime(
  language: ProgrammingLanguage,
  overrides: Partial<RuntimeCapability> = {}
): RuntimeCapability {
  return {
    language,
    multiFile: true,
    gui: false,
    interactive: false,
    ...overrides,
  };
}

function provider(
  id: ExecutionProviderId,
  runtimes: RuntimeCapability[],
  available = true
): ExecutionCapabilities {
  return { provider: id, available, runtimes };
}

const pythonRequest = { language: 'python' as const };
const rRequest = { language: 'r' as const };
const javaRequest = { language: 'java' as const };

describe('resolveExecutionProvider', () => {
  const browser = provider('browser', [runtime('python'), runtime('r')]);
  const absentBridge = provider('bridge', [], false);
  const absentCloud = provider('cloud', [], false);

  it('mantiene la prioridad local en una constante visible', () => {
    expect(LOCAL_FIRST_ORDER).toEqual(['browser', 'bridge', 'cloud']);
  });

  it.each([
    ['Python', pythonRequest],
    ['R', rRequest],
  ])('%s con local-first usa Browser', (_label, request) => {
    expect(
      resolveExecutionProvider(request, [browser, absentBridge, absentCloud], 'local-first')
    ).toMatchObject({ kind: 'provider', providerId: 'browser' });
  });

  it('Java queda indisponible mientras Bridge y Cloud no existan', () => {
    expect(
      resolveExecutionProvider(javaRequest, [browser, absentBridge, absentCloud], 'local-first')
    ).toEqual({
      kind: 'unavailable',
      reason: 'Este lenguaje todavía no se ejecuta aquí: java.',
    });
  });

  it('elige Bridge cuando puede ejecutar Java', () => {
    const bridge = provider('bridge', [runtime('java')]);
    expect(resolveExecutionProvider(javaRequest, [browser, bridge, absentCloud])).toMatchObject({
      kind: 'provider',
      providerId: 'bridge',
    });
  });

  it('cae a Cloud cuando Bridge no está y Cloud puede ejecutar Java', () => {
    const cloud = provider('cloud', [runtime('java')]);
    expect(resolveExecutionProvider(javaRequest, [browser, absentBridge, cloud])).toMatchObject({
      kind: 'provider',
      providerId: 'cloud',
    });
  });

  it('browser-only no usa Bridge aunque esté disponible y sea capaz', () => {
    const bridge = provider('bridge', [runtime('java')]);
    expect(resolveExecutionProvider(javaRequest, [browser, bridge], 'browser-only')).toEqual({
      kind: 'unavailable',
      reason: 'Este lenguaje todavía no se ejecuta en el navegador: java.',
    });
  });

  it('browser-only permite Python cuando Browser está disponible', () => {
    expect(resolveExecutionProvider(pythonRequest, [browser], 'browser-only')).toMatchObject({
      kind: 'provider',
      providerId: 'browser',
    });
  });

  it('bridge-required explica que falta el proveedor exigido', () => {
    const result = resolveExecutionProvider(javaRequest, [browser, absentBridge], 'bridge-required');
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('exige Nextudio Bridge');
  });

  it('cloud-required explica que falta el proveedor exigido', () => {
    const result = resolveExecutionProvider(javaRequest, [browser, absentCloud], 'cloud-required');
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('exige la ejecución en la nube');
  });

  it('cloud-required elige Cloud aunque Browser también pudiera', () => {
    const browserWithJava = provider('browser', [runtime('java')]);
    const cloud = provider('cloud', [runtime('java')]);
    expect(
      resolveExecutionProvider(javaRequest, [browserWithJava, cloud], 'cloud-required')
    ).toMatchObject({ kind: 'provider', providerId: 'cloud' });
  });

  it('local-first elige Browser cuando los tres pueden', () => {
    const all = LOCAL_FIRST_ORDER.map((id) => provider(id, [runtime('python')]));
    expect(resolveExecutionProvider(pythonRequest, all)).toMatchObject({
      kind: 'provider',
      providerId: 'browser',
    });
  });

  it('no elige un runtime sin soporte multiarchivo para un proyecto', () => {
    const singleFileBrowser = provider('browser', [runtime('python', { multiFile: false })]);
    const request = {
      language: 'python' as const,
      files: { 'main.py': 'print(1)', 'helper.py': 'value = 1' },
      entryFile: 'main.py',
    };
    expect(resolveExecutionProvider(request, [singleFileBrowser], 'browser-only')).toMatchObject({
      kind: 'unavailable',
    });
  });

  it('no elige un runtime que no ofrece la versión pedida', () => {
    const bridge = provider('bridge', [runtime('java', { versions: ['21'] })]);
    expect(resolveExecutionProvider(javaRequest, [bridge], 'bridge-required', '17')).toMatchObject({
      kind: 'unavailable',
    });
  });

  it('no elige un runtime sin versiones cuando se pide una concreta', () => {
    const bridge = provider('bridge', [runtime('java')]);
    expect(resolveExecutionProvider(javaRequest, [bridge], 'bridge-required', '21')).toMatchObject({
      kind: 'unavailable',
    });
  });

  it('nunca elige un proveedor no disponible aunque declare el lenguaje', () => {
    const unavailable = provider('bridge', [runtime('java')], false);
    expect(resolveExecutionProvider(javaRequest, [unavailable], 'bridge-required')).toMatchObject({
      kind: 'unavailable',
    });
  });

  it('puede expresar Java 21 multiarchivo y con GUI para el Bridge futuro', () => {
    // Esta forma es el contrato que N6.1/N6.3 deberán declarar cuando exista el
    // Bridge; describirla hoy no significa que el placeholder pueda ejecutarla.
    const futureBridge: ExecutionCapabilities = {
      provider: 'bridge',
      available: true,
      bridgeVersion: '1.0.0',
      runtimes: [
        {
          language: 'java',
          versions: ['21'],
          multiFile: true,
          gui: true,
          interactive: false,
        },
      ],
    };
    const multiFileJavaRequest = {
      language: 'java' as const,
      files: {
        'Main.java': 'class Main { public static void main(String[] args) {} }',
        'Window.java': 'class Window {}',
      },
      entryFile: 'Main.java',
    };

    expect(
      resolveExecutionProvider(multiFileJavaRequest, [browser, futureBridge], 'local-first')
    ).toEqual({
      kind: 'provider',
      providerId: 'bridge',
      runtime: {
        language: 'java',
        versions: ['21'],
        multiFile: true,
        gui: true,
        interactive: false,
      },
    });
    expect(
      resolveExecutionProvider(multiFileJavaRequest, [browser, futureBridge], 'local-first', '21')
    ).toMatchObject({ kind: 'provider', providerId: 'bridge' });
    expect(
      resolveExecutionProvider(multiFileJavaRequest, [browser, futureBridge], 'local-first', '17')
    ).toMatchObject({ kind: 'unavailable' });
  });
});

describe('BrowserProvider', () => {
  const result: CodeRunResult = {
    status: 'ok',
    stdout: 'uno',
    stderr: '',
    exitCode: 0,
    durationMs: 4,
    truncated: false,
  };

  function runnerDouble(run = vi.fn(async () => result)): BrowserCodeRunner {
    return {
      name: 'browser',
      language: 'python',
      supports: (language) => language === 'python',
      run,
      interrupt: vi.fn(async () => undefined),
      resetSession: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
  }

  it('declara Python y R desde el catálogo, pero no Java', async () => {
    const capabilities = await createBrowserExecutionProvider(runnerDouble()).capabilities();
    expect(capabilities.runtimes.map(({ language }) => language)).toEqual(['python', 'r']);
    expect(capabilities.runtimes).not.toContainEqual(expect.objectContaining({ language: 'java' }));
  });

  it('no declara ningún lenguaje que el catálogo marque sin ejecución en navegador', async () => {
    const capabilities = await createBrowserExecutionProvider(runnerDouble()).capabilities();
    for (const declared of capabilities.runtimes) {
      const catalogLanguage = PROGRAMMING_LANGUAGES.find(
        (language) => language.value === declared.language
      );
      expect(catalogLanguage?.capabilities.browserExecution).toBe(true);
    }
  });

  it.each<{ label: string; request: CodeRunRequest }>([
    { label: 'legacy', request: { language: 'python', source: 'print(1)' } },
    {
      label: 'multiarchivo',
      request: {
        language: 'python',
        source: 'from helper import value',
        files: { 'main.py': 'from helper import value', 'helper.py': 'value = 1' },
        entryFile: 'main.py',
      },
    },
  ])('delega la misma petición $label y devuelve el mismo resultado', async ({ request }) => {
    const run = vi.fn(async (_request: CodeRunRequest) => result);
    const provider = createBrowserExecutionProvider(runnerDouble(run));
    const received = await provider.run(request);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(request);
    expect(run.mock.calls[0]?.[0]).toBe(request);
    expect(received).toBe(result);
  });
});

describe('proveedores placeholder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Bridge', createBridgeExecutionProvider, BRIDGE_UNAVAILABLE_REASON],
    ['Cloud', createCloudExecutionProvider, CLOUD_UNAVAILABLE_REASON],
  ] as const)('%s rechaza con su razón sin tocar la red', async (_name, create, reason) => {
    const fetch = vi.fn(() => {
      throw new Error('Un placeholder no debe tocar la red.');
    });
    vi.stubGlobal('fetch', fetch);
    const provider = create();

    expect(await provider.capabilities()).toMatchObject({
      provider: provider.id,
      available: false,
      unavailableReason: reason,
      runtimes: [],
    });
    expect(await provider.run({ language: 'java', source: 'class Main {}' })).toMatchObject({
      status: 'rejected',
      stderr: reason,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
