import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  findReservedPackageViolation,
  outlineJavaSource,
  resolveJavaEntrypoint,
  stripJavaComments,
} from '../../src/lib/code-engines/java-entrypoint';
import {
  JAVA_LEDGER_PREFIX,
  decodeJavaLedger,
  javaHarnessSource,
} from '../../src/lib/code-engines/java-harness';
import {
  CHEERPJ_BASE_URL,
  CHEERPJ_VERSION,
  ECJ_SHA256,
  ECJ_URL,
  ECJ_VERSION,
  ECJ_VFS_PATH,
  JAVA_BOOTCLASSPATH,
  JAVA_HARNESS_MAIN_CLASS,
  JAVA_MANIFEST_PATH,
  JAVA_NETWORK_ALLOWLIST,
  JAVA_RESERVED_PACKAGE,
  JAVA_RUNTIME_VERSION,
  JAVA_VFS_RUNS_DIR,
  JAVA_VFS_RUNTIME_DIR,
  JAVA_VFS_SESSIONS_DIR,
  isReservedJavaPackage,
  javaHarnessSlotPath,
  javaSourceSlotPath,
} from '../../src/lib/code-engines/java-toolchain';
import { createJavaEngine } from '../../src/lib/code-engines/java-engine';
import { hardenWorkerScope } from '../../src/lib/code-engines/worker-bridge';
import { CODE_WORKER_TYPES, CODE_WORKER_URLS } from '../../src/lib/code-engines/runtime-assets';
import {
  isBrowserExecutableLanguage,
  validateCodeRunRequest,
} from '../../src/lib/code-runner-contract';
import { sanitizeWorkerRun } from '../../src/lib/browser-code-runner-protocol';
import { canRunInBrowser, getBrowserCodeRunner } from '../../src/lib/browser-code-runner';
import { PROGRAMMING_LANGUAGES } from '../../src/lib/constants';

/**
 * Lo que se puede probar de Java SIN un navegador.
 *
 * La división no es arbitraria y conviene decirla: aquí viven los contratos —qué
 * clase hay que ejecutar, cómo se descodifica el registro, qué entra en el
 * mensaje del Worker, qué permite el firewall, qué promete el catálogo—, y todo
 * eso es lógica que se ejecuta igual en Node.
 *
 * Lo que NO está aquí es si Java compila y se ejecuta de verdad. Eso necesita
 * CheerpJ, WebAssembly, un Worker clásico y un sistema de archivos respaldado por
 * IndexedDB; simularlo produciría una prueba verde que no ha ejecutado una línea
 * de Java. Vive en `tests/browser/java-runtime/`, corre en Chromium y se lanza con
 * `npm run test:java`.
 */

// ---------------------------------------------------------------------------

describe('de qué clase es el punto de entrada', () => {
  it('usa el paquete declarado, no el nombre del archivo', () => {
    const entry = resolveJavaEntrypoint({
      files: {
        'src/app/Main.java': `package app;
public class Main {
  public static void main(String[] args) { }
}
`,
      },
      entryFile: 'src/app/Main.java',
    });

    expect(entry).toEqual({ ok: true, className: 'app.Main', packageName: 'app' });
  });

  it('no se deja engañar por comentarios ni por cadenas', () => {
    // Éste es el caso que tumba a una expresión regular: hay tres apariciones de
    // `public class` y sólo una declara algo.
    const entry = resolveJavaEntrypoint({
      files: {
        'Real.java': `// public class Falsa {}
/* public class TambienFalsa { public static void main(String[] a) {} } */
package tarea;
public class Real {
  public static void main(String[] args) {
    System.out.println("public class Mentira { main }");
  }
}
`,
      },
      entryFile: 'Real.java',
    });

    expect(entry).toEqual({ ok: true, className: 'tarea.Real', packageName: 'tarea' });
  });

  it('ignora el main de una clase anidada', () => {
    const outline = outlineJavaSource(`public class Externa {
  static class Interna {
    public static void main(String[] args) { }
  }
  public static void main(String[] args) { }
}
`);

    expect(outline.types).toHaveLength(1);
    expect(outline.types[0]).toEqual({ name: 'Externa', isPublic: true, hasMain: true });
  });

  it('elige la clase que declara main entre varias de primer nivel', () => {
    const entry = resolveJavaEntrypoint({
      files: {
        'Programa.java': `class Ayudante { static int x() { return 1; } }
public class Programa {
  public static void main(String[] args) { }
}
class Otra { }
`,
      },
      entryFile: 'Programa.java',
    });

    expect(entry).toEqual({ ok: true, className: 'Programa', packageName: '' });
  });

  it('reconoce las tres formas de declarar el arreglo de argumentos', () => {
    const forms = [
      'public static void main(String[] args)',
      'public static void main(String args[])',
      'public static void main(String... args)',
      'static public void main(final String[] args)',
    ];

    for (const signature of forms) {
      const outline = outlineJavaSource(`public class C { ${signature} { } }`);
      expect(outline.types[0]?.hasMain, signature).toBe(true);
    }
  });

  it('no acepta un main que no reciba un arreglo de cadenas', () => {
    for (const signature of [
      'public static void main(int n)',
      'public static void main()',
      'public static void main(String texto)',
    ]) {
      const outline = outlineJavaSource(`public class C { ${signature} { } }`);
      expect(outline.types[0]?.hasMain, signature).toBe(false);
    }
  });

  it('no confunde un main de instancia con uno ejecutable', () => {
    const outline = outlineJavaSource(`public class C { public void main(String[] a) { } }`);
    expect(outline.types[0]?.hasMain).toBe(false);
  });

  it('dice qué falta cuando no hay main, nombrando la clase', () => {
    const entry = resolveJavaEntrypoint({
      files: { 'Sin.java': 'public class Sin { void x() { } }\n' },
      entryFile: 'Sin.java',
    });

    expect(entry.ok).toBe(false);
    if (!entry.ok) {
      expect(entry.reason).toContain('Sin');
      expect(entry.reason).toContain('main');
    }
  });

  it('rechaza un archivo de entrada que no es .java', () => {
    const entry = resolveJavaEntrypoint({
      files: { 'notas.txt': 'hola' },
      entryFile: 'notas.txt',
    });
    expect(entry.ok).toBe(false);
  });

  it('rechaza un archivo sin ninguna clase', () => {
    const entry = resolveJavaEntrypoint({
      files: { 'Vacio.java': '// nada que ver\n' },
      entryFile: 'Vacio.java',
    });
    expect(entry.ok).toBe(false);
    if (!entry.ok) expect(entry.reason).toContain('no declara ninguna clase');
  });
});

describe('el fuente sin comentarios conserva las posiciones', () => {
  it('sustituye en vez de borrar, y respeta los saltos de línea', () => {
    const source = 'int a = 1; // nota\nint b = 2;\n';
    const stripped = stripJavaComments(source);

    expect(stripped).toHaveLength(source.length);
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    expect(stripped).toContain('int a = 1;');
    expect(stripped).not.toContain('nota');
  });

  it('una llave dentro de una cadena no descuadra el recuento', () => {
    const outline = outlineJavaSource(`public class C {
  String roto = "} class Falsa {";
  public static void main(String[] args) { }
}
`);
    expect(outline.types).toHaveLength(1);
    expect(outline.types[0]?.hasMain).toBe(true);
  });

  it('una comilla escapada no abre una cadena que no cierra', () => {
    const outline = outlineJavaSource(`public class C {
  String c = "\\"";
  public static void main(String[] args) { }
}
`);
    expect(outline.types[0]?.hasMain).toBe(true);
  });
});

describe('el espacio de nombres reservado', () => {
  it('reconoce el paquete del runtime y sus descendientes', () => {
    expect(isReservedJavaPackage(JAVA_RESERVED_PACKAGE)).toBe(true);
    expect(isReservedJavaPackage(`${JAVA_RESERVED_PACKAGE}.internal`)).toBe(true);
    expect(isReservedJavaPackage('io.nextudio.tarea')).toBe(false);
    expect(isReservedJavaPackage('app')).toBe(false);
  });

  it('mira TODOS los archivos, no sólo el de entrada', () => {
    // Una clase colada en el paquete reservado no sería el punto de entrada y aun
    // así se compilaría junto a las demás.
    const violation = findReservedPackageViolation({
      files: {
        'Main.java': 'public class Main { public static void main(String[] a) { } }\n',
        'Colado.java': `package ${JAVA_RESERVED_PACKAGE}.internal;
public class Colado { }
`,
      },
      entryFile: 'Main.java',
    });

    expect(violation).toBe('Colado.java');
  });

  it('rechaza el punto de entrada si declara el paquete reservado', () => {
    const entry = resolveJavaEntrypoint({
      files: {
        'X.java': `package ${JAVA_RESERVED_PACKAGE}.internal;
public class X { public static void main(String[] a) { } }
`,
      },
      entryFile: 'X.java',
    });
    expect(entry.ok).toBe(false);
    if (!entry.ok) expect(entry.reason).toContain('reservado');
  });
});

// ---------------------------------------------------------------------------

/** Un registro como el que emite el harness, para no repetirlo en cada prueba. */
function ledgerLines(
  status: 'ok' | 'failed',
  truncated: boolean,
  segments: [string, string][],
  chunk = 3000
): string[] {
  const encoded = [
    status,
    truncated ? '1' : '0',
    ...segments.map(([channel, text]) => `${channel}:${Buffer.from(text, 'utf8').toString('base64')}`),
  ].join('|');

  const total = Math.max(1, Math.ceil(encoded.length / chunk));
  return Array.from(
    { length: total },
    (_, index) =>
      `${JAVA_LEDGER_PREFIX}${index}/${total}|${encoded.slice(index * chunk, (index + 1) * chunk)}`
  );
}

describe('el registro que devuelve el harness', () => {
  it('conserva el orden y el canal de cada tramo', () => {
    const ledger = decodeJavaLedger(
      ledgerLines('ok', false, [
        ['O', 'A\n'],
        ['E', 'B\n'],
        ['O', 'C\n'],
      ])
    );

    expect(ledger).toEqual({
      status: 'ok',
      truncated: false,
      segments: [
        { channel: 'stdout', text: 'A\n' },
        { channel: 'stderr', text: 'B\n' },
        { channel: 'stdout', text: 'C\n' },
      ],
    });
  });

  it('distingue el canal de error del de avisos', () => {
    const ledger = decodeJavaLedger(ledgerLines('failed', false, [['X', 'boom\n']]));
    expect(ledger?.segments).toEqual([{ channel: 'error', text: 'boom\n' }]);
    expect(ledger?.status).toBe('failed');
  });

  it('vuelve a unir los trozos aunque lleguen desordenados', () => {
    const lines = ledgerLines('ok', false, [['O', 'x'.repeat(400)]], 64);
    expect(lines.length).toBeGreaterThan(4);

    const shuffled = [...lines].reverse();
    expect(decodeJavaLedger(shuffled)?.segments[0]?.text).toBe('x'.repeat(400));
  });

  it('ignora lo que CheerpJ escriba por su cuenta en la consola', () => {
    const ledger = decodeJavaLedger([
      'CheerpJ runtime ready',
      'Class is loaded, main is starting',
      'JIT failure - please report a bug: algo',
      ...ledgerLines('ok', false, [['O', 'limpio\n']]),
      '',
    ]);
    expect(ledger?.segments).toEqual([{ channel: 'stdout', text: 'limpio\n' }]);
  });

  it('devuelve null si falta un trozo', () => {
    const lines = ledgerLines('ok', false, [['O', 'y'.repeat(300)]], 50);
    expect(decodeJavaLedger(lines.slice(1))).toBeNull();
  });

  it('devuelve null si no hay registro', () => {
    expect(decodeJavaLedger(['CheerpJ runtime ready', ''])).toBeNull();
  });

  it('devuelve null ante un canal que no conoce', () => {
    expect(decodeJavaLedger(ledgerLines('ok', false, [['Z', 'raro']]))).toBeNull();
  });

  it('devuelve null ante un estado que no conoce', () => {
    expect(
      decodeJavaLedger([`${JAVA_LEDGER_PREFIX}0/1|explotado|0|O:aGk=`])
    ).toBeNull();
  });

  it('conserva los acentos: el registro va en bytes, no en caracteres', () => {
    const ledger = decodeJavaLedger(ledgerLines('ok', false, [['O', 'año ñandú 日本\n']]));
    expect(ledger?.segments[0]?.text).toBe('año ñandú 日本\n');
  });

  it('trae la marca de truncado del propio Java', () => {
    expect(decodeJavaLedger(ledgerLines('ok', true, [['O', 'x']]))?.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('la cadena de herramientas está fijada', () => {
  it('nunca usa latest', () => {
    for (const value of [CHEERPJ_VERSION, CHEERPJ_BASE_URL, ECJ_VERSION, ECJ_URL, ECJ_VFS_PATH]) {
      expect(value).not.toContain('latest');
    }
  });

  it('la URL de CheerpJ lleva la versión dentro', () => {
    expect(CHEERPJ_BASE_URL).toBe(`https://cjrtnc.leaningtech.com/${CHEERPJ_VERSION}/`);
    expect(CHEERPJ_BASE_URL.endsWith('/')).toBe(true);
  });

  it('el compilador se autoaloja bajo /runtime/java/ y CheerpJ lo ve por /app', () => {
    expect(ECJ_URL).toBe(`/runtime/java/ecj-${ECJ_VERSION}.jar`);
    expect(ECJ_VFS_PATH).toBe(`/app${ECJ_URL}`);
  });

  it('el SHA-256 de ECJ es el que se verificó en el spike', () => {
    expect(ECJ_VERSION).toBe('3.13.102');
    expect(ECJ_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(ECJ_SHA256).toBe('e6b938338b7bb12388ca32ba8dfe91c6ab1c56bf5bd8dab6d6e6265fec3b9be3');
  });

  it('el alcance es Java 8 y su rt.jar explícito', () => {
    // No es nostalgia: es la única combinación que J0 demostró compilando y
    // ejecutando. Declarar 11, 17 o 21 sería prometer algo sin probarlo.
    expect(JAVA_RUNTIME_VERSION).toBe(8);
    expect(JAVA_BOOTCLASSPATH).toBe('/lt/8/jre/lib/rt.jar');
  });

  it('la lista blanca de red tiene dos entradas exactas y ninguna comodín', () => {
    expect([...JAVA_NETWORK_ALLOWLIST]).toEqual([CHEERPJ_BASE_URL, '/runtime/java/']);
    for (const prefix of JAVA_NETWORK_ALLOWLIST) {
      expect(prefix).not.toContain('*');
    }
  });

  it('los namespaces del sistema de archivos cuelgan todos del mismo prefijo', () => {
    for (const dir of [JAVA_VFS_RUNS_DIR, JAVA_VFS_RUNTIME_DIR, JAVA_VFS_SESSIONS_DIR]) {
      expect(dir.startsWith('/files/nextudio/')).toBe(true);
    }
    // Las sesiones no se usan en J1 y se declaran ya para que «limpiar la
    // ejecución» no pueda llevárselas el día que existan.
    expect(JAVA_VFS_SESSIONS_DIR).not.toBe(JAVA_VFS_RUNS_DIR);
    expect(JAVA_VFS_RUNTIME_DIR.startsWith(JAVA_VFS_RUNS_DIR)).toBe(false);
  });

  it('la ranura del harness se llama como su clase; las del proyecto, no', () => {
    // ECJ rechaza un archivo cuyo nombre no coincida con el tipo público que
    // declara, y el harness es el único que se compila directamente desde /str.
    expect(javaHarnessSlotPath()).toBe('/str/NxRunHarness.java');
    expect(javaSourceSlotPath(0)).toBe('/str/nextudio.src.0');
    expect(javaSourceSlotPath(7)).toBe('/str/nextudio.src.7');
  });

  it('/str es plano: ninguna ruta tiene subcarpetas', () => {
    // CheerpJ responde «Directories are not supported» a cualquier ruta con
    // subcarpetas dentro de /str. Es la razón de que exista el manifiesto.
    for (const slot of [javaHarnessSlotPath(), javaSourceSlotPath(3), JAVA_MANIFEST_PATH]) {
      expect(slot.startsWith('/str/')).toBe(true);
      expect(slot.slice('/str/'.length)).not.toContain('/');
    }
  });
});

describe('el harness, leído como texto', () => {
  const source = javaHarnessSource();

  it('vive en el paquete reservado', () => {
    expect(source.startsWith(`package ${JAVA_RESERVED_PACKAGE}.internal;`)).toBe(true);
    expect(JAVA_HARNESS_MAIN_CLASS).toBe(`${JAVA_RESERVED_PACKAGE}.internal.NxRunHarness`);
  });

  it('compila con el classpath CERRADO', () => {
    // La mitad del aislamiento: lo único resoluble son el JRE y los fuentes del
    // proyecto. Una clase que dejó otra ejecución no entra.
    expect(source).toContain('options.add("-classpath");');
    expect(source).toContain('options.add("");');
    expect(source).toContain(JAVA_BOOTCLASSPATH);
  });

  it('carga el código del alumnado con el cargador de arranque como padre', () => {
    // La otra mitad: desde ese código el harness y ECJ no existen, así que no hay
    // ningún nombre que proteger.
    expect(source).toContain('new URLClassLoader(classpath, null)');
  });

  it('barre los namespaces ajenos al empezar y borra el suyo al terminar', () => {
    // Barrer al empezar es lo único que cubre un Worker.terminate(), que no
    // ejecuta ningún finally.
    expect(source).toContain('sweep(manifest.runId);');
    expect(source).toMatch(/finally\s*\{\s*if \(runDir != null\) delete\(new File\(runDir\)\);/);
  });

  it('aplica el tope de salida MIENTRAS escribe, no al final', () => {
    expect(source).toContain('int room = limit - stored;');
    expect(source).toContain('truncated = true;');
  });

  it('no nombra ninguna credencial ni variable de entorno', () => {
    for (const needle of ['idToken', 'cookie', 'getenv', 'firebase', 'AWS_']) {
      expect(source.includes(needle), needle).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Un CheerpJ de mentira: registra lo que se le pide y devuelve un registro.
 *
 * Guarda el HISTORIAL de escrituras y no sólo el estado final, porque el motor
 * vacía las ranuras de `/str` en su `finally`: leer `files` después de una
 * ejecución sólo enseña cadenas vacías, que es precisamente lo que otra prueba
 * comprueba. `wrote(path)` devuelve lo que se escribió la primera vez.
 */
function fakeCheerpJ(
  options: { onRun?: (className: string, classPath: string, args: string[]) => string[] } = {}
) {
  const files = new Map<string, string>();
  const writes: { path: string; text: string }[] = [];
  const runs: { className: string; classPath: string; args: string[] }[] = [];
  let console: string[] = [];

  const scope = {
    cheerpjInit: vi.fn(async () => {}),
    cheerpOSAddStringFile: (path: string, data: Uint8Array) => {
      const text = new TextDecoder().decode(data);
      writes.push({ path, text });
      files.set(path, text);
    },
    cheerpjRunMain: vi.fn(async (className: string, classPath: string, ...args: string[]) => {
      runs.push({ className, classPath, args });
      console = console.concat(
        options.onRun?.(className, classPath, args) ??
          ledgerLines('ok', false, [['O', 'hola\n']])
      );
      return 0;
    }),
    importScripts: () => {},
  };

  return {
    scope,
    files,
    runs,
    writes,
    /** Lo que se escribió en esa ruta, en orden, sin contar los vaciados. */
    wrote: (path: string): string[] =>
      writes.filter((write) => write.path === path && write.text !== '').map((write) => write.text),
    drainConsole: () => {
      const drained = console;
      console = [];
      return drained;
    },
  };
}

const HELLO = 'public class Hola { public static void main(String[] args) { } }\n';

describe('el motor de Java, sin CheerpJ de verdad', () => {
  it('compila el harness UNA vez por Worker', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.prepare();
    await engine.prepare();
    await engine.run(HELLO, { maxOutputChars: 20_000 });
    await engine.run(HELLO, { maxOutputChars: 20_000 });

    const compilations = fake.runs.filter((run) =>
      run.className.endsWith('batch.Main')
    );
    expect(compilations).toHaveLength(1);
    expect(fake.scope.cheerpjInit).toHaveBeenCalledTimes(1);
  });

  it('arranca CheerpJ sólo cuando hace falta ejecutar', async () => {
    const fake = fakeCheerpJ();
    createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });
    expect(fake.scope.cheerpjInit).not.toHaveBeenCalled();
  });

  it('escribe el manifiesto con la clase de entrada y las rutas reales', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.run(
      '',
      { maxOutputChars: 1234 },
      'isolated',
      undefined,
      {
        files: {
          'src/app/Main.java': `package app;
public class Main { public static void main(String[] a) { } }
`,
          'src/app/Util.java': 'package app;\nclass Util { }\n',
          'LEEME.md': 'no es Java',
        },
        entryFile: 'src/app/Main.java',
      }
    );

    const manifest = fake.wrote(JAVA_MANIFEST_PATH).at(0) ?? '';
    expect(manifest).toContain('entryClass=app.Main');
    expect(manifest).toContain('outputCap=1234');
    expect(manifest).toContain(`file=${javaSourceSlotPath(0)}\tsrc/app/Main.java`);
    expect(manifest).toContain(`file=${javaSourceSlotPath(1)}\tsrc/app/Util.java`);
    // Un README no es asunto del compilador.
    expect(manifest).not.toContain('LEEME.md');
    expect(manifest).toMatch(/^runId=[0-9a-f]{24}$/m);
  });

  it('el identificador de la ejecución es opaco y cambia en cada una', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await engine.run(HELLO, { maxOutputChars: 20_000 });
    }
    const ids = fake
      .wrote(JAVA_MANIFEST_PATH)
      .map((manifest) => /runId=([0-9a-f]+)/.exec(manifest)?.[1] ?? '');

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // No sale del nombre del archivo, del paquete ni de nada que escriba nadie.
    for (const id of ids) expect(id).not.toContain('Hola');
  });

  it('invoca el harness con el classpath del runtime y el manifiesto', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.run(HELLO, { maxOutputChars: 20_000 });
    const run = fake.runs.at(-1);

    expect(run?.className).toBe(JAVA_HARNESS_MAIN_CLASS);
    expect(run?.classPath).toBe(`${JAVA_VFS_RUNTIME_DIR}:${ECJ_VFS_PATH}`);
    expect(run?.args).toEqual([JAVA_MANIFEST_PATH]);
  });

  it('vacía las ranuras de /str al terminar', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.run(HELLO, { maxOutputChars: 20_000 });

    expect(fake.files.get(javaSourceSlotPath(0))).toBe('');
    expect(fake.files.get(JAVA_MANIFEST_PATH)).toBe('');
  });

  it('las vacía también cuando la ejecución falla', async () => {
    const fake = fakeCheerpJ({
      onRun: (className) =>
        className === JAVA_HARNESS_MAIN_CLASS ? ['CheerpJ runtime ready'] : ledgerLines('ok', false, []),
    });
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    // Sin registro descifrable el motor lanza: es una avería del entorno, no un
    // resultado del programa.
    await expect(engine.run(HELLO, { maxOutputChars: 20_000 })).rejects.toThrow();
    expect(fake.files.get(javaSourceSlotPath(0))).toBe('');
  });

  it('devuelve la salida en el orden del registro, con sus canales', async () => {
    const fake = fakeCheerpJ({
      onRun: (className) =>
        className === JAVA_HARNESS_MAIN_CLASS
          ? ledgerLines('ok', false, [
              ['O', 'A\n'],
              ['E', 'B\n'],
              ['O', 'C\n'],
            ])
          : [],
    });
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    const run = await engine.run(HELLO, { maxOutputChars: 20_000 });

    expect(run.status).toBe('ok');
    expect(run.stdout).toBe('A\nC\n');
    expect(run.stderr).toBe('B\n');
    expect(run.outputs.map((entry) => 'text' in entry ? `${entry.stream}:${entry.text.trim()}` : entry.stream)).toEqual([
      'stdout:A',
      'stderr:B',
      'stdout:C',
    ]);
  });

  it('conserva el truncado que marcó Java aunque el texto quepa', async () => {
    const fake = fakeCheerpJ({
      onRun: (className) =>
        className === JAVA_HARNESS_MAIN_CLASS ? ledgerLines('ok', true, [['O', 'poco\n']]) : [],
    });
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    const run = await engine.run(HELLO, { maxOutputChars: 20_000 });
    expect(run.truncated).toBe(true);
  });

  it('rechaza el paquete reservado SIN arrancar CheerpJ', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    const run = await engine.run(
      `package ${JAVA_RESERVED_PACKAGE}.internal;
public class X { public static void main(String[] a) { } }
`,
      { maxOutputChars: 20_000 }
    );

    expect(run.status).toBe('failed');
    expect(run.stderr).toContain('reservado');
    // Ni un megabyte de WebAssembly para decir que no.
    expect(fake.scope.cheerpjInit).not.toHaveBeenCalled();
  });

  it('rechaza un fuente sin main SIN arrancar CheerpJ', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    const run = await engine.run('public class Sin { }\n', { maxOutputChars: 20_000 });

    expect(run.status).toBe('failed');
    expect(run.stderr).toContain('main');
    expect(fake.scope.cheerpjInit).not.toHaveBeenCalled();
  });

  it('un fuente suelto se nombra por su clase, no Main.java a ciegas', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.run(
      `package tarea;
public class Ejercicio { public static void main(String[] a) { } }
`,
      { maxOutputChars: 20_000 }
    );

    const manifest = fake.wrote(JAVA_MANIFEST_PATH).at(0) ?? '';
    expect(manifest).toContain('entryClass=tarea.Ejercicio');
    expect(manifest).toContain('\ttarea/Ejercicio.java');
  });

  it('un arranque fallido no se queda cacheado', async () => {
    let attempts = 0;
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('sin red');
        return fake.scope as never;
      },
      drainConsole: fake.drainConsole,
    });

    await expect(engine.prepare()).rejects.toThrow('sin red');
    await expect(engine.prepare()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('no tiene estado de sesión que vaciar', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await expect(engine.resetSession()).resolves.toBeUndefined();
    expect(fake.scope.cheerpjInit).not.toHaveBeenCalled();
  });

  it('dispose obliga a volver a arrancar y a recompilar el harness', async () => {
    const fake = fakeCheerpJ();
    const engine = createJavaEngine({
      loadRuntime: async () => fake.scope as never,
      drainConsole: fake.drainConsole,
    });

    await engine.prepare();
    await engine.dispose();
    await engine.prepare();

    expect(fake.scope.cheerpjInit).toHaveBeenCalledTimes(2);
    expect(fake.runs.filter((run) => run.className.endsWith('batch.Main'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

/**
 * Un `self` de Worker de mentira, con los globales que la política toca.
 *
 * El endurecimiento es irreversible a propósito —sustituye cada global con
 * `configurable: false` para que el código del alumnado no pueda deshacerlo—, así
 * que se aplica sobre ESTE objeto. Aplicarlo sobre el `globalThis` de vitest
 * dejaría el proceso sin `fetch` para el resto del archivo, y entonces la
 * política no se podría probar en absoluto.
 */
function fakeWorkerScope() {
  const realFetch = vi.fn(async () => new Response('ok'));
  const opened: string[] = [];

  return {
    location: { href: 'https://nextudio.example/aula' },
    fetch: realFetch,
    XMLHttpRequest: class {
      open(_method: string, url: string): void {
        opened.push(url);
      }
    },
    WebSocket: class {},
    EventSource: class {},
    importScripts: () => {},
    indexedDB: { open: () => {} },
    caches: {},
    // No forman parte de la política: están para comprobar que no se tocan.
    realFetch,
    opened,
  } as unknown as Record<string, unknown> & { realFetch: typeof realFetch; opened: string[] };
}

function hardenedJavaScope() {
  const scope = fakeWorkerScope();
  hardenWorkerScope(JAVA_NETWORK_ALLOWLIST, { keepPersistentStorage: true, scope });
  return scope;
}

describe('el firewall del Worker de Java', () => {
  it('deja pasar el CDN fijado de CheerpJ y el compilador del propio origen', async () => {
    const scope = hardenedJavaScope();
    const request = scope.fetch as typeof fetch;

    await expect(request(`${CHEERPJ_BASE_URL}8/jre/lib/rt.jar`)).resolves.toBeDefined();
    await expect(request(ECJ_URL)).resolves.toBeDefined();
    expect(scope.realFetch).toHaveBeenCalledTimes(2);
  });

  it('bloquea /api del MISMO origen: mismo origen no es una regla de permiso', async () => {
    const scope = hardenedJavaScope();
    const request = scope.fetch as typeof fetch;

    for (const url of [
      '/api/private/hit',
      'https://nextudio.example/api/nexbooks/abc',
      // Ni siquiera el runtime de al lado: la lista es de prefijos exactos.
      '/runtime/pyodide/pandas.whl',
      '/runtime/workers/python-runner.worker.js',
      'https://ejemplo.mx/robar',
    ]) {
      await expect(request(url), url).rejects.toThrow('deshabilitado');
    }
    expect(scope.realFetch).not.toHaveBeenCalled();
  });

  it('bloquea otra versión de CheerpJ: el prefijo lleva la versión', async () => {
    const request = hardenedJavaScope().fetch as typeof fetch;

    await expect(request('https://cjrtnc.leaningtech.com/4.4/loader.js')).rejects.toThrow();
    await expect(request('https://cjrtnc.leaningtech.com/loader.js')).rejects.toThrow();
    // Y tampoco un subdominio: la lista no tiene comodines.
    await expect(request('https://otro.leaningtech.com/4.3/loader.js')).rejects.toThrow();
  });

  it('no se deja burlar por una ruta relativa que sube', async () => {
    const request = hardenedJavaScope().fetch as typeof fetch;

    // Se resuelve contra el origen ANTES de comparar, así que esto acaba siendo
    // `/api/private/hit` y se rechaza.
    await expect(request('/runtime/java/../../api/private/hit')).rejects.toThrow();
    await expect(request(`${CHEERPJ_BASE_URL}../otra/cosa`)).rejects.toThrow();
  });

  it('un fetch bloqueado RECHAZA la promesa, no lanza en síncrono', async () => {
    const request = hardenedJavaScope().fetch as typeof fetch;

    /**
     * Es lo que hace que Java reciba su `IOException` en vez de colgarse.
     *
     * La capa de red de CheerpJ hace `fetch(url).then(…)`. Con una excepción
     * síncrona el error se escapaba por un camino que ese código no vigila, el
     * hilo de Java se quedaba esperando para siempre y la ejecución sólo terminaba
     * al agotar el tiempo límite. Se vio en el navegador, no aquí.
     */
    let thrown: unknown = null;
    let promise: unknown = null;
    try {
      promise = request('/api/private/hit');
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeNull();
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toThrow('deshabilitado');
  });

  it('acota XMLHttpRequest con la misma lista en vez de quitarlo', () => {
    // Quitarlo daría un TypeError dentro de CheerpJ, que lo usa para leer `/app`.
    const scope = hardenedJavaScope();
    const Guarded = scope.XMLHttpRequest as new () => XMLHttpRequest;

    expect(() => new Guarded().open('GET', ECJ_URL)).not.toThrow();
    expect(() => new Guarded().open('GET', '/api/private/hit')).toThrow('deshabilitado');
    expect(scope.opened).toEqual([ECJ_URL]);
  });

  it('quita WebSocket, EventSource e importScripts enteros', () => {
    const scope = hardenedJavaScope();

    for (const name of ['WebSocket', 'EventSource', 'importScripts']) {
      expect(() => (scope[name] as () => void)(), name).toThrow('deshabilitado');
    }
  });

  it('Java conserva indexedDB porque /files vive ahí; Python y R no', () => {
    const java = hardenedJavaScope();
    expect(java.indexedDB).toBeDefined();
    expect(java.caches).toBeUndefined();

    const python = fakeWorkerScope();
    hardenWorkerScope('/runtime/pyodide/', { scope: python });
    expect(python.indexedDB).toBeUndefined();
    expect(python.caches).toBeUndefined();
  });

  it('sin lista blanca no hay red de ninguna clase', async () => {
    const scope = fakeWorkerScope();
    hardenWorkerScope(undefined, { scope });

    await expect((scope.fetch as typeof fetch)('/runtime/java/x.jar')).rejects.toThrow();
    expect(() => (scope.XMLHttpRequest as () => void)()).toThrow();
  });

  it('los globales sustituidos no se pueden devolver a su sitio', () => {
    // Es la mitad del argumento: una política que el propio Worker puede deshacer
    // no protege de un runtime que decidiera restaurar `fetch`.
    const scope = hardenedJavaScope();
    expect(Object.getOwnPropertyDescriptor(scope, 'fetch')?.configurable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(scope, 'WebSocket')?.configurable).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Java sigue SIN estar activado en ninguna interfaz', () => {
  it('el catálogo dice browserExecution: false', () => {
    const java = PROGRAMMING_LANGUAGES.find((language) => language.value === 'java');
    expect(java?.capabilities.browserExecution).toBe(false);
  });

  it('isBrowserExecutableLanguage lo niega aunque su Worker exista', () => {
    // Las dos condiciones: hay código (está en BROWSER_RUNTIME_LANGUAGES) y el
    // catálogo no lo promete. Con una sola de las dos, no se ofrece.
    expect(isBrowserExecutableLanguage('java')).toBe(false);
    expect(isBrowserExecutableLanguage('python')).toBe(true);
    expect(isBrowserExecutableLanguage('r')).toBe(true);
  });

  it('el botón de ejecutar no se ofrece y no hay ejecutor público', () => {
    expect(canRunInBrowser('java')).toBe(false);
    expect(getBrowserCodeRunner('java')).toBeNull();
  });

  it('el proveedor de navegador no anuncia Java', async () => {
    const { createBrowserExecutionProvider } = await import('../../src/lib/execution/browser-provider');
    const provider = createBrowserExecutionProvider({
      run: async () => ({
        status: 'ok' as const,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
        truncated: false,
      }),
    } as never);

    const capabilities = await provider.capabilities();
    expect(capabilities.runtimes.map((runtime) => runtime.language)).toEqual(['python', 'r']);
  });

  it('una petición de ejecutar Java se rechaza en la validación', () => {
    const rejected = validateCodeRunRequest(
      { language: 'java', source: HELLO },
      (candidate) => isBrowserExecutableLanguage(candidate)
    );
    expect(rejected?.status).toBe('rejected');
  });

  it('el Worker de Java existe y se sirve del propio origen', () => {
    // Que el runtime exista es justo lo que J1 entrega; que no se ofrezca es lo
    // que comprueban las cuatro pruebas anteriores.
    expect(CODE_WORKER_URLS.java).toBe('/runtime/workers/java-runner.worker.js');
    expect(CODE_WORKER_TYPES.java).toBe('classic');
  });
});

describe('el mensaje que cruza hacia el Worker de Java', () => {
  it('se monta campo a campo: nada más cruza', () => {
    const message = sanitizeWorkerRun(
      7,
      'java',
      HELLO,
      { maxOutputChars: 20_000 },
      'isolated',
      undefined,
      { files: { 'Hola.java': HELLO }, entryFile: 'Hola.java' }
    );

    expect(Object.keys(message).sort()).toEqual([
      'executionOptions',
      'id',
      'language',
      'mode',
      'project',
      'source',
      'type',
    ]);
    expect(message.language).toBe('java');
    expect(message.executionOptions).toEqual({ maxOutputChars: 20_000 });
  });

  it('descarta del proyecto cualquier ruta que no normalice', () => {
    const message = sanitizeWorkerRun(
      1,
      'java',
      HELLO,
      { maxOutputChars: 20_000 },
      'isolated',
      undefined,
      {
        files: { 'Hola.java': HELLO, '../fuera/Otro.java': HELLO, '/abs/Otro.java': HELLO },
        entryFile: 'Hola.java',
      }
    );

    expect(Object.keys(message.project?.files ?? {})).toEqual(['Hola.java']);
  });

  it('el ejecutor rechaza el proyecto entero si trae una ruta insegura', () => {
    // Antes de llegar al Worker. Un proyecto con una ruta que escapa no es un
    // proyecto al que haya que quitarle un archivo: es un proyecto inválido.
    const rejected = validateCodeRunRequest(
      {
        language: 'java',
        source: HELLO,
        files: { 'Hola.java': HELLO, '../fuera/Otro.java': HELLO },
        entryFile: 'Hola.java',
      },
      () => true
    );

    expect(rejected?.status).toBe('rejected');
    expect(rejected?.stderr).toContain('ruta');
  });
});

describe('el empaquetado de los Workers y la tabla de tipos no se separan', () => {
  it('el script emite Java como IIFE y Python/R como ESM', async () => {
    const script = await readFile(
      new URL('../../scripts/copy-code-runtimes.mjs', import.meta.url),
      'utf8'
    );

    expect(script).toMatch(/format: 'iife',\s*entries: \['java-runner\.worker\.ts'\]/);
    expect(script).toMatch(
      /format: 'esm',\s*entries: \['python-runner\.worker\.ts', 'r-runner\.worker\.ts'\]/
    );

    // Y que la tabla del código diga lo mismo.
    expect(CODE_WORKER_TYPES).toEqual({ python: 'module', r: 'module', java: 'classic' });
  });

  it('cada Worker declarado tiene su URL y su tipo', () => {
    expect(Object.keys(CODE_WORKER_URLS).sort()).toEqual(Object.keys(CODE_WORKER_TYPES).sort());
  });
});
