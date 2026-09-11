import { describe, expect, it } from 'vitest';
import {
  canRunInBrowser,
  getBrowserCodeRunner,
  type BrowserCodeRunnerStatus,
} from '../../src/lib/browser-code-runner';
import { CODE_RUN_LIMITS } from '../../src/lib/code-runner-contract';
import type { CodeWorkerRequest } from '../../src/lib/browser-code-runner-protocol';

/**
 * El gobierno del Worker: tiempo límite, parada y reintento.
 *
 * Aquí NO se ejecuta Python ni R. Lo que se prueba es lo que pasa alrededor:
 * que un programa que no termina no cuelga la pestaña, que terminarlo deja el
 * sitio limpio para el siguiente intento, y que al Worker no le llega nada que
 * no debería. Un Worker falso lo hace determinista; los intérpretes de verdad
 * están en `code-engines.test.ts`.
 */

type Listener = (event: { data: unknown }) => void;

/** Un Worker de mentira que responde lo que le digan, o no responde nunca. */
class FakeWorker {
  static created: FakeWorker[] = [];

  readonly received: CodeWorkerRequest[] = [];
  terminated = false;

  private listeners: Record<string, Listener[]> = {};

  constructor(private readonly behaviour: (worker: FakeWorker, message: CodeWorkerRequest) => void) {
    FakeWorker.created.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  postMessage(message: CodeWorkerRequest): void {
    this.received.push(message);
    // Asíncrono como el de verdad: responder en la misma pila escondería
    // cualquier problema de orden.
    queueMicrotask(() => {
      if (!this.terminated) this.behaviour(this, message);
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners.message ?? []) listener({ data });
  }
}

/** Responde a `prepare` y devuelve una salida fija en cada `run`. */
function scripted(reply: (message: Extract<CodeWorkerRequest, { type: 'run' }>) => unknown) {
  return (worker: FakeWorker, message: CodeWorkerRequest) => {
    if (message.type === 'prepare') {
      worker.emit({ type: 'ready', id: message.id });
      return;
    }
    if (message.type === 'reset') {
      worker.emit({ type: 'reset', id: message.id });
      return;
    }
    worker.emit(reply(message));
  };
}

/** Arranca pero no contesta nunca a `run`: el programa que no termina. */
const neverFinishes = (worker: FakeWorker, message: CodeWorkerRequest) => {
  if (message.type === 'prepare') worker.emit({ type: 'ready', id: message.id });
};

function runnerWith(
  behaviour: (worker: FakeWorker, message: CodeWorkerRequest) => void,
  overrides: { timeoutMs?: number; onStatusChange?: (status: BrowserCodeRunnerStatus) => void } = {}
) {
  FakeWorker.created = [];
  const runner = getBrowserCodeRunner('python', {
    createWorker: () => new FakeWorker(behaviour) as unknown as Worker,
    timeoutMs: overrides.timeoutMs ?? 50,
    bootstrapTimeoutMs: 200,
    ...(overrides.onStatusChange ? { onStatusChange: overrides.onStatusChange } : {}),
  });
  if (!runner) throw new Error('Python debería poder ejecutarse.');
  return runner;
}

const okResult = (stdout: string) =>
  scripted((message) => ({
    type: 'result',
    id: message.id,
    status: 'ok',
    stdout,
    stderr: '',
    truncated: false,
  }));

describe('a quién se le ofrece ejecutar', () => {
  it('a R y a Python', () => {
    expect(canRunInBrowser('r')).toBe(true);
    expect(canRunInBrowser('python')).toBe(true);
  });

  it('a nadie más, y sin lenguaje tampoco', () => {
    for (const language of ['javascript', 'sql', 'cpp', null, undefined, '']) {
      expect(canRunInBrowser(language), String(language)).toBe(false);
    }
    expect(getBrowserCodeRunner('javascript')).toBeNull();
    expect(getBrowserCodeRunner('sql')).toBeNull();
  });
});

describe('una ejecución normal', () => {
  it('arranca el runtime, ejecuta y devuelve la salida', async () => {
    const runner = runnerWith(okResult('4\n'));
    const result = await runner.run({ language: 'python', source: 'print(2 + 2)' });

    expect(result.status).toBe('ok');
    expect(result.stdout).toBe('4\n');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('el runtime se prepara UNA vez y se reutiliza', async () => {
    const runner = runnerWith(okResult('ok\n'));
    await runner.run({ language: 'python', source: 'print(1)' });
    await runner.run({ language: 'python', source: 'print(2)' });

    // Volver a arrancar Pyodide en cada ejecución serían trece megas por clic.
    expect(FakeWorker.created).toHaveLength(1);
    expect(FakeWorker.created[0]!.received.filter((m) => m.type === 'prepare')).toHaveLength(1);
  });

  it('el Worker recibe el fuente y el tope de salida, y nada más', async () => {
    const runner = runnerWith(okResult(''));
    await runner.run({ language: 'python', source: 'print(1)' });

    const sent = FakeWorker.created[0]!.received.find((m) => m.type === 'run');
    expect(sent).toMatchObject({
      type: 'run',
      language: 'python',
      source: 'print(1)',
      executionOptions: { maxOutputChars: CODE_RUN_LIMITS.maxOutputChars },
      // Un paso de actividad ejecuta AISLADO aunque haya un NexBook abierto en
      // otra pestaña: lo que se entrega tiene que funcionar por sí solo.
      mode: 'isolated',
    });
    expect(Object.keys(sent!).sort()).toEqual([
      'executionOptions',
      'id',
      'language',
      'mode',
      'source',
      'type',
    ]);
  });

  it('un error del programa llega como fallo, no como avería', async () => {
    const runner = runnerWith(
      scripted((message) => ({
        type: 'result',
        id: message.id,
        status: 'failed',
        stdout: '',
        stderr: 'ValueError: boom\n',
        truncated: false,
      }))
    );
    const result = await runner.run({ language: 'python', source: 'raise ValueError()' });

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('ValueError');
    expect(result.exitCode).toBeNull();
  });

  it('la salida que llega del Worker se vuelve a acotar aquí', async () => {
    // El Worker ya acota, pero acotar otra vez cuesta nada y significa que un
    // fallo allí no puede llenar la memoria de la pestaña.
    const runner = runnerWith(okResult('x'.repeat(CODE_RUN_LIMITS.maxOutputChars + 1_000)));
    const result = await runner.run({ language: 'python', source: 'print("x" * 99999)' });

    expect(result.stdout).toHaveLength(CODE_RUN_LIMITS.maxOutputChars);
    expect(result.truncated).toBe(true);
  });
});

describe('lo que se rechaza sin arrancar nada', () => {
  it('código vacío', async () => {
    const runner = runnerWith(okResult(''));
    const result = await runner.run({ language: 'python', source: '   ' });

    expect(result.status).toBe('rejected');
    expect(FakeWorker.created).toHaveLength(0);
  });

  it('código demasiado grande', async () => {
    const runner = runnerWith(okResult(''));
    const result = await runner.run({
      language: 'python',
      source: 'x'.repeat(CODE_RUN_LIMITS.maxSourceChars + 1),
    });

    expect(result.status).toBe('rejected');
    expect(FakeWorker.created).toHaveLength(0);
  });

  it('un lenguaje que no es el de este ejecutor', async () => {
    const runner = runnerWith(okResult(''));
    const result = await runner.run({ language: 'r', source: 'cat(1)' });

    expect(result.status).toBe('rejected');
    expect(FakeWorker.created).toHaveLength(0);
  });
});

describe('un programa que no termina', () => {
  it('se corta por tiempo en vez de colgar la pestaña', async () => {
    const runner = runnerWith(neverFinishes);
    const result = await runner.run({ language: 'python', source: 'while True: pass' });

    expect(result.status).toBe('timeout');
    expect(result.stderr).toContain('superó el límite de tiempo');
  });

  it('el Worker se termina: el runtime colgado no sobrevive', async () => {
    const runner = runnerWith(neverFinishes);
    await runner.run({ language: 'python', source: 'while True: pass' });

    expect(FakeWorker.created[0]!.terminated).toBe(true);
  });

  it('se puede volver a ejecutar, con un Worker limpio', async () => {
    // Es el caso real: alguien escribe un bucle infinito, lo arregla y vuelve a
    // darle a Ejecutar. Si el ejecutor se quedara inservible, la única salida
    // sería recargar la página y perder lo no guardado.
    let behaviour = neverFinishes;
    const runner = getBrowserCodeRunner('python', {
      createWorker: () => new FakeWorker((worker, message) => behaviour(worker, message)) as unknown as Worker,
      timeoutMs: 50,
      bootstrapTimeoutMs: 200,
    })!;
    FakeWorker.created = [];

    expect((await runner.run({ language: 'python', source: 'while True: pass' })).status).toBe(
      'timeout'
    );

    behaviour = okResult('4\n');
    const second = await runner.run({ language: 'python', source: 'print(2 + 2)' });

    expect(second.status).toBe('ok');
    expect(second.stdout).toBe('4\n');
    expect(FakeWorker.created).toHaveLength(2);
    expect(FakeWorker.created[1]!.terminated).toBe(false);
  });
});

describe('detener a mano', () => {
  it('devuelve «detenido» y termina el Worker', async () => {
    const runner = runnerWith(neverFinishes, { timeoutMs: 5_000 });
    const running = runner.run({ language: 'python', source: 'while True: pass' });

    // Se espera a que el `run` esté realmente en vuelo: interrumpir antes no
    // probaría nada.
    await waitFor(() => FakeWorker.created[0]?.received.some((m) => m.type === 'run') === true);
    await runner.interrupt();

    const result = await running;
    expect(result.status).toBe('stopped');
    expect(FakeWorker.created[0]!.terminated).toBe(true);
  });

  it('detener sin nada en curso no rompe nada', async () => {
    const runner = runnerWith(okResult(''));
    await expect(runner.interrupt()).resolves.toBeUndefined();
  });
});

describe('el estado que ve la interfaz', () => {
  it('pasa por preparando, listo y ejecutando', async () => {
    const seen: BrowserCodeRunnerStatus[] = [];
    const runner = runnerWith(okResult('4\n'), { onStatusChange: (status) => seen.push(status) });

    await runner.run({ language: 'python', source: 'print(2 + 2)' });

    expect(seen).toEqual(['preparing', 'ready', 'running', 'ready']);
  });

  it('tras un tiempo excedido vuelve a inactivo, no a error', async () => {
    // «Error» sugiere que algo se rompió. Lo que pasó es que el programa tardó
    // demasiado, y volver a intentarlo es perfectamente razonable.
    const seen: BrowserCodeRunnerStatus[] = [];
    const runner = runnerWith(neverFinishes, { onStatusChange: (status) => seen.push(status) });

    await runner.run({ language: 'python', source: 'while True: pass' });

    expect(seen.at(-1)).toBe('idle');
  });
});

describe('cerrar el editor', () => {
  it('termina el Worker que quedara vivo', async () => {
    const runner = runnerWith(okResult(''));
    await runner.run({ language: 'python', source: 'print(1)' });
    await runner.dispose();

    expect(FakeWorker.created[0]!.terminated).toBe(true);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('La condición no se cumplió a tiempo.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
