import { describe, expect, it } from 'vitest';
import {
  CODE_RUN_LIMITS,
  clampCodeOutput,
  clampCodeRunResult,
  isBrowserExecutableLanguage,
  rejectedCodeRun,
  validateCodeRunRequest,
} from '../../src/lib/code-runner-contract';
import { ACADEMIC_LIMITS } from '../../src/lib/constants';
import { sanitizeWorkerRun } from '../../src/lib/browser-code-runner-protocol';
import { LimitedOutput } from '../../src/lib/code-engines/engine-contract';

/**
 * El contrato de ejecución, sin ningún runtime de por medio.
 *
 * Todo lo que se comprueba aquí se aplica ANTES de arrancar nada: qué lenguajes
 * pueden ejecutarse, qué se rechaza sin gastar 13 MB de WebAssembly en decir
 * que no, y hasta dónde puede crecer la salida.
 */

const always = () => true;

describe('qué lenguajes se pueden ejecutar', () => {
  it('R y Python, que son los que tienen runtime', () => {
    expect(isBrowserExecutableLanguage('r')).toBe(true);
    expect(isBrowserExecutableLanguage('python')).toBe(true);
  });

  it('ninguno de los que el modelo admite pero la interfaz no ofrece', () => {
    // El modelo guarda cualquier lenguaje (`ProgrammingLanguage` es abierto).
    // Poder GUARDARLO no es poder EJECUTARLO, y la diferencia se comprueba
    // contra el catálogo, no contra una lista escrita a mano en otro sitio.
    for (const language of ['javascript', 'java', 'cpp', 'sql', 'rust', '']) {
      expect(isBrowserExecutableLanguage(language), language).toBe(false);
    }
  });
});

describe('lo que se rechaza antes de arrancar un runtime', () => {
  it('un lenguaje que este ejecutor no atiende', () => {
    const rejected = validateCodeRunRequest(
      { language: 'python', source: 'print(1)' },
      (language) => language === 'r'
    );
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.stderr).toContain('no se puede ejecutar');
  });

  it('código vacío, y también el que sólo tiene espacios', () => {
    for (const source of ['', '   ', '\n\n\t']) {
      const rejected = validateCodeRunRequest({ language: 'python', source }, always);
      expect(rejected?.status, JSON.stringify(source)).toBe('rejected');
    }
  });

  it('código por encima del límite del entregable', () => {
    // El tope de ejecución es el MISMO que el de la entrega: poder escribir
    // algo que no se puede ejecutar sería una trampa silenciosa.
    expect(CODE_RUN_LIMITS.maxSourceChars).toBe(ACADEMIC_LIMITS.codeMax);

    const tooLong = 'x'.repeat(CODE_RUN_LIMITS.maxSourceChars + 1);
    expect(validateCodeRunRequest({ language: 'r', source: tooLong }, always)?.status).toBe(
      'rejected'
    );
  });

  it('nada más: el código válido pasa', () => {
    expect(validateCodeRunRequest({ language: 'r', source: 'cat(1)' }, always)).toBeNull();
  });
});

describe('los límites de tiempo y de salida', () => {
  it('la ejecución se corta en diez segundos y el arranque tiene su propio plazo', () => {
    expect(CODE_RUN_LIMITS.timeoutMs).toBe(10_000);
    // Arrancar Pyodide o webR la primera vez tarda más que cualquier programa
    // de clase. Medirlos con el mismo reloj haría imposible ejecutar nada.
    expect(CODE_RUN_LIMITS.bootstrapTimeoutMs).toBeGreaterThan(CODE_RUN_LIMITS.timeoutMs);
  });

  it('la salida se corta y se DICE que se cortó', () => {
    const long = 'x'.repeat(CODE_RUN_LIMITS.maxOutputChars + 500);
    const clamped = clampCodeOutput(long);

    expect(clamped.text).toHaveLength(CODE_RUN_LIMITS.maxOutputChars);
    expect(clamped.truncated).toBe(true);
  });

  it('una salida corta se deja intacta', () => {
    expect(clampCodeOutput('4\n')).toEqual({ text: '4\n', truncated: false });
  });

  it('el resultado completo arrastra la marca de truncado desde cualquier flujo', () => {
    const clamped = clampCodeRunResult({
      status: 'ok',
      stdout: 'x'.repeat(CODE_RUN_LIMITS.maxOutputChars + 1),
      stderr: '',
      exitCode: 0,
      durationMs: 5,
      truncated: false,
    });
    expect(clamped.truncated).toBe(true);
    expect(clamped.stdout).toHaveLength(CODE_RUN_LIMITS.maxOutputChars);
  });
});

describe('el acumulador de salida', () => {
  it('reparte el tope entre los dos flujos', () => {
    // El límite es del PROGRAMA, no de cada flujo por separado: si no, un
    // programa que escribe en los dos podría gastar el doble.
    const output = new LimitedOutput(10);
    output.append('stdout', 'abcdef');
    output.append('stderr', 'ghijkl');

    expect(output.stdout).toBe('abcdef');
    expect(output.stderr).toBe('ghij');
    expect(output.truncated).toBe(true);
  });

  it('una vez lleno no acumula nada más', () => {
    const output = new LimitedOutput(2);
    output.append('stdout', 'ab');
    output.append('stdout', 'cdefgh');

    expect(output.stdout).toBe('ab');
    expect(output.truncated).toBe(true);
  });

  it('sin pasarse, no marca truncado', () => {
    const output = new LimitedOutput(100);
    output.line('stdout', '4');
    expect(output.toRun('ok')).toEqual({
      status: 'ok',
      stdout: '4\n',
      stderr: '',
      truncated: false,
      // Las dos cadenas planas y la secuencia salen del MISMO registro, así que
      // no pueden contradecirse: es la garantía que permite que la consola de
      // una actividad y un NexBook lean lo mismo de formas distintas.
      outputs: [{ seq: 0, stream: 'stdout', text: '4\n' }],
    });
  });

  it('conserva el ORDEN REAL entre stdout y stderr', () => {
    /**
     * Hasta la iteración 8 esto era imposible: el acumulador guardaba dos
     * cadenas y quien las pintaba ponía primero todo stdout. Un programa que
     * imprime, avisa y vuelve a imprimir salía contado al revés de como pasó.
     *
     * La información estaba ahí —Pyodide llama según se escribe y `captureR`
     * devuelve un array ordenado— y se tiraba al separarla en dos montones.
     */
    const output = new LimitedOutput(100);
    output.append('stdout', 'primero ');
    output.append('stderr', 'aviso ');
    output.append('stdout', 'después');

    expect(output.outputs()).toEqual([
      { seq: 0, stream: 'stdout', text: 'primero ' },
      { seq: 1, stream: 'stderr', text: 'aviso ' },
      { seq: 2, stream: 'stdout', text: 'después' },
    ]);
    // Y las cadenas planas siguen siendo las de siempre.
    expect(output.stdout).toBe('primero después');
    expect(output.stderr).toBe('aviso ');
  });

  it('funde trozos consecutivos del mismo flujo', () => {
    // Pyodide llama una vez por línea. Sin fundir, un bucle de cien `print`
    // produciría cien entradas con su objeto y su clave dentro del documento,
    // que es mucho JSON para decir lo mismo. El orden no se toca: sólo se une
    // lo que ya era contiguo.
    const output = new LimitedOutput(100);
    output.line('stdout', 'uno');
    output.line('stdout', 'dos');

    expect(output.outputs()).toEqual([{ seq: 0, stream: 'stdout', text: 'uno\ndos\n' }]);
  });
});

describe('el mensaje que llega al Worker', () => {
  /**
   * Ésta es la prueba de seguridad del sprint.
   *
   * El código del alumnado es hostil por defecto. Lo que decide si puede
   * robar algo no es lo que el Worker haga, sino lo que le llegue: si el
   * mensaje nunca lleva un token, no hay token que filtrar.
   */
  it('lleva exactamente cinco cosas, y ninguna es una credencial', () => {
    const message = sanitizeWorkerRun(7, 'python', 'print(1)', { maxOutputChars: 100 });

    expect(Object.keys(message).sort()).toEqual([
      'executionOptions',
      'id',
      'language',
      'mode',
      'source',
      'type',
    ]);
    expect(Object.keys(message.executionOptions)).toEqual(['maxOutputChars']);
  });

  it('por defecto la ejecución es AISLADA, no de sesión', () => {
    // El modo tiene que ser explícito para conservar estado. Si el valor por
    // defecto fuera `session`, un paso de actividad empezaría a ver variables
    // de un NexBook abierto en otra pestaña y entregaría un programa que sólo
    // funciona en ese navegador.
    expect(sanitizeWorkerRun(1, 'python', 'x = 1', { maxOutputChars: 10 }).mode).toBe('isolated');
    expect(
      sanitizeWorkerRun(1, 'python', 'x = 1', { maxOutputChars: 10 }, 'session').mode
    ).toBe('session');
  });

  it('descarta cualquier campo extra de las opciones', () => {
    const contaminated = {
      maxOutputChars: 100,
      idToken: 'firebase-id-token',
      cookie: 'session=abc',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      uid: 'uid-christian',
    };

    const message = sanitizeWorkerRun(1, 'r', 'cat(1)', contaminated);
    const serialized = JSON.stringify(message);

    for (const secret of ['firebase-id-token', 'session=abc', 'AKIA', 'uid-christian']) {
      expect(serialized, secret).not.toContain(secret);
    }
  });
});

describe('un rechazo', () => {
  it('se explica y no inventa una salida', () => {
    const rejected = rejectedCodeRun('No hay ejecutor.');
    expect(rejected).toMatchObject({
      status: 'rejected',
      stdout: '',
      stderr: 'No hay ejecutor.',
      exitCode: null,
      truncated: false,
    });
  });
});
