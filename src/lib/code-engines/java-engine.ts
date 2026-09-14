import {
  LimitedOutput,
  type CodeEngine,
  type CodeEngineRun,
  type CodeExecutionMode,
} from './engine-contract';
import {
  decodeJavaLedger,
  javaHarnessSource,
  type JavaLedger,
} from './java-harness';
import { findReservedPackageViolation, resolveJavaEntrypoint } from './java-entrypoint';
import {
  CHEERPJ_LOADER_URL,
  ECJ_VFS_PATH,
  JAVA_BOOTCLASSPATH,
  JAVA_HARNESS_MAIN_CLASS,
  JAVA_MANIFEST_PATH,
  JAVA_RUNTIME_VERSION,
  JAVA_VFS_RUNTIME_DIR,
  javaHarnessSlotPath,
  javaSourceSlotPath,
} from './java-toolchain';
import type { BrowserExecutionOptions } from '../browser-code-runner-protocol';
import type { CodeProject } from '../code-runner-contract';
import type { LabDataset } from '../lab/dataset';

/**
 * Java dentro del navegador, con CheerpJ 4.3 y ECJ.
 *
 * ## El flujo, de arriba abajo
 *
 * ```text
 *   prepare()                       una vez por Worker
 *     importScripts(loader.js)      CheerpJ 4.3, CDN oficial, versión fijada
 *     cheerpjInit({ version: 8 })
 *     compila el harness            /files/nextudio/runtime/harness
 *
 *   run(project)                    una vez por ejecución
 *     resuelve la clase de entrada   en TypeScript, probado en Node
 *     escribe las fuentes           /str/nextudio.src.N  (JS -> Java)
 *     escribe el manifiesto         /str/nextudio.manifest
 *     cheerpjRunMain(harness)       compila + ejecuta + limpia, en una JVM
 *     decodifica el registro        orden global, canal por canal
 *     vacía las ranuras de /str
 * ```
 *
 * Una sola invocación de Java por ejecución. El harness compila, ejecuta y borra
 * su namespace dentro de la misma JVM, así que los diagnósticos del compilador y
 * la salida del programa comparten un único orden y una única limpieza. Ver
 * `java-harness.ts` para el porqué de cada una de esas tres cosas.
 *
 * ## Lo que este motor NO hace
 *
 * No lleva reloj. Un `while (true)` no se puede parar desde dentro, así que el
 * tiempo límite lo aplica `lib/browser-code-runner.ts` terminando el Worker,
 * igual que con Python y R. El harness barre los restos al empezar la siguiente
 * ejecución, porque un `terminate()` no ejecuta ningún `finally`.
 *
 * No tiene sesión. `executionMode: 'session'` no cambia nada aquí: cada
 * ejecución compila desde cero en su propio namespace. Java con estado entre
 * celdas es una fase posterior, y el hueco donde viviría está declarado
 * (`JAVA_VFS_SESSIONS_DIR`) para que la limpieza de hoy no lo pise mañana.
 */

/** Lo que CheerpJ pone en `self` cuando `loader.js` termina de arrancar. */
interface CheerpJScope {
  cheerpjInit: (options: { version: number }) => Promise<void>;
  cheerpjRunMain: (className: string, classPath: string, ...args: string[]) => Promise<number>;
  cheerpOSAddStringFile: (path: string, data: Uint8Array) => void;
  importScripts: (...urls: string[]) => void;
  cjFileBlob?: (path: string) => Promise<Blob | null>;
}

export interface JavaEngineOptions {
  /**
   * Cómo se carga CheerpJ. Inyectable SÓLO para las pruebas.
   *
   * En el navegador no se pasa: el Worker hace `importScripts(loader.js)` y
   * CheerpJ se instala en `self`. En Node no hay `importScripts` ni WebAssembly
   * de CheerpJ, así que las pruebas de contrato pasan un doble y las de verdad
   * —las que ejecutan Java— corren en Chromium. Ver
   * `tests/browser/java-runtime/`.
   */
  loadRuntime?: () => Promise<CheerpJScope>;
  /**
   * Las líneas que CheerpJ escribió en la consola durante la última llamada.
   *
   * El registro del harness sale por `System.out`, y CheerpJ entrega `System.out`
   * por `console.log`. Quien sabe capturar la consola es el Worker —parchearla
   * desde aquí envenenaría el proceso de pruebas—, así que el motor la pide.
   */
  drainConsole: () => string[];
}

export function createJavaEngine(options: JavaEngineOptions): CodeEngine {
  let booting: Promise<CheerpJScope> | null = null;
  let harnessReady = false;

  async function boot(): Promise<CheerpJScope> {
    if (booting) return booting;

    booting = (async () => {
      const scope = await (options.loadRuntime ?? loadCheerpJFromLoader)();
      await scope.cheerpjInit({ version: JAVA_RUNTIME_VERSION });
      return scope;
    })();

    try {
      return await booting;
    } catch (caught) {
      // Un arranque fallido no puede quedar cacheado: descargar 20 MB puede
      // fallar por la red de un aula y el siguiente intento debe poder probar.
      booting = null;
      throw new JavaRuntimeError('runtime', describe(caught));
    }
  }

  /**
   * El harness se compila UNA vez por Worker.
   *
   * Es la única compilación que este proyecto hace de código propio, y no puede
   * hacerse antes porque el único compilador de Java que existe aquí es ECJ
   * dentro de CheerpJ. Compilarla en `prepare()` en vez de en el primer `run()`
   * hace que el coste se pague donde ya se espera —arrancar el entorno— y que un
   * fallo del compilador se distinga de un fallo del programa del alumnado.
   */
  async function prepareHarness(scope: CheerpJScope): Promise<void> {
    if (harnessReady) return;

    options.drainConsole();
    scope.cheerpOSAddStringFile(javaHarnessSlotPath(), encode(javaHarnessSource()));

    // El harness llega por /str, que es PLANO, así que se compila desde la
    // ranura y ECJ lo coloca en su paquete a partir del `package` declarado.
    const exitCode = await scope.cheerpjRunMain(
      'org.eclipse.jdt.internal.compiler.batch.Main',
      ECJ_VFS_PATH,
      '-proc:none',
      '-nowarn',
      '-source',
      String(JAVA_RUNTIME_VERSION),
      '-target',
      String(JAVA_RUNTIME_VERSION),
      '-encoding',
      'UTF-8',
      '-bootclasspath',
      JAVA_BOOTCLASSPATH,
      '-classpath',
      '',
      '-d',
      JAVA_VFS_RUNTIME_DIR,
      javaHarnessSlotPath()
    );

    if (exitCode !== 0) {
      throw new JavaRuntimeError(
        'compiler',
        `El compilador no pudo preparar el entorno de Java (código ${exitCode}).\n${options
          .drainConsole()
          .join('\n')}`
      );
    }
    harnessReady = true;
  }

  return {
    language: 'java',

    async prepare(): Promise<void> {
      await prepareHarness(await boot());
    },

    async run(
      source: string,
      runOptions: BrowserExecutionOptions,
      mode: CodeExecutionMode = 'isolated',
      lab?: LabDataset,
      project?: CodeProject
    ): Promise<CodeEngineRun> {
      // Java no tiene ni sesión ni API de laboratorio en esta fase. Se nombran
      // los dos parámetros para que el contrato siga siendo el mismo que el de
      // Python y R, y se ignoran a la vista en vez de por descuido.
      void mode;
      void lab;

      const output = new LimitedOutput(runOptions.maxOutputChars);
      const resolved = project ?? singleFileProject(source);

      const reserved = findReservedPackageViolation(resolved);
      if (reserved) {
        output.line(
          'error',
          `${reserved} declara un paquete reservado para el runtime de Nextudio.`
        );
        return output.toRun('failed');
      }

      const entry = resolveJavaEntrypoint(resolved);
      if (!entry.ok) {
        output.line('error', entry.reason);
        return output.toRun('failed');
      }

      const scope = await boot();
      await prepareHarness(scope);

      const slots = writeRunInput(scope, resolved, {
        runId: opaqueRunId(),
        entryClass: entry.className,
        outputCap: runOptions.maxOutputChars,
      });
      options.drainConsole();

      try {
        await scope.cheerpjRunMain(
          JAVA_HARNESS_MAIN_CLASS,
          `${JAVA_VFS_RUNTIME_DIR}:${ECJ_VFS_PATH}`,
          JAVA_MANIFEST_PATH
        );

        const ledger = decodeJavaLedger(options.drainConsole());
        if (!ledger) {
          throw new JavaRuntimeError(
            'internal',
            'El entorno de Java no devolvió la salida de la ejecución.'
          );
        }
        return replay(ledger, output);
      } finally {
        // /str es efímero pero vive tanto como el Worker: dejar el fuente de una
        // ejecución ahí no lo hace alcanzable —el manifiesto de la siguiente no
        // lo nombra— y aun así se vacía, porque no hay ninguna razón para que la
        // memoria del Worker conserve el programa de alguien.
        clearSources(scope, slots);
      }
    },

    /**
     * No hay estado de sesión que vaciar.
     *
     * Cada ejecución compila en su propio namespace y lo borra al terminar, así
     * que «reiniciar el kernel» ya es el comportamiento por defecto. Se declara
     * igual porque el contrato lo pide y porque decirlo aquí es más honesto que
     * dejar que alguien lo deduzca del silencio.
     */
    async resetSession(): Promise<void> {},

    async dispose(): Promise<void> {
      booting = null;
      harnessReady = false;
    },
  };
}

interface JavaRunInput {
  runId: string;
  entryClass: string;
  outputCap: number;
}

/**
 * Las fuentes y el manifiesto, escritos en `/str` antes de llamar al harness.
 *
 * `/str` es el buzón de JavaScript hacia Java que documenta CheerpJ: JS escribe,
 * Java lee, y no hay servidor en medio. Es PLANO —CheerpJ contesta «Directories
 * are not supported» a cualquier ruta con subcarpetas—, así que cada archivo va
 * a una ranura numerada y el manifiesto dice qué ruta real le corresponde. El
 * harness reconstruye el árbol dentro de su namespace, que es donde ECJ necesita
 * que los nombres coincidan con las clases públicas.
 *
 * Devuelve las ranuras escritas para poder vaciarlas después.
 */
function writeRunInput(
  scope: CheerpJScope,
  project: CodeProject,
  input: JavaRunInput
): string[] {
  const written: string[] = [];
  const entries: string[] = [];
  let index = 0;

  for (const [path, text] of Object.entries(project.files)) {
    // Un proyecto puede traer un README o un .csv; al compilador sólo le
    // interesan los .java, y mandarle el resto sería un error de compilación
    // que no tiene nada que ver con el programa.
    if (!path.endsWith('.java')) continue;
    const slot = javaSourceSlotPath(index);
    scope.cheerpOSAddStringFile(slot, encode(text));
    written.push(slot);
    entries.push(`file=${slot}\t${path}`);
    index += 1;
  }

  const manifest = [
    `runId=${input.runId}`,
    `entryClass=${input.entryClass}`,
    `outputCap=${input.outputCap}`,
    ...entries,
    '',
  ].join('\n');

  scope.cheerpOSAddStringFile(JAVA_MANIFEST_PATH, encode(manifest));
  written.push(JAVA_MANIFEST_PATH);
  return written;
}

/**
 * El fuente suelto, visto como el proyecto de un archivo que es.
 *
 * El ejecutor de una actividad manda `source` sin `files`. Java necesita un
 * nombre de archivo para compilar —ECJ exige que el archivo se llame como la
 * clase pública—, así que se deduce del propio fuente en vez de inventar
 * `Main.java` y fallar con «The public type X must be defined in its own file»,
 * que no le dice nada a quien programa.
 */
function singleFileProject(source: string): CodeProject {
  const outline = resolveJavaEntrypoint({ files: { 'Main.java': source }, entryFile: 'Main.java' });
  const simple = outline.ok ? (outline.className.split('.').at(-1) as string) : 'Main';
  const directory = outline.ok && outline.packageName ? `${outline.packageName.replaceAll('.', '/')}/` : '';
  const path = `${directory}${simple}.java`;
  return { files: { [path]: source }, entryFile: path };
}

/**
 * El identificador de la ejecución, creado por Nextudio.
 *
 * No sale del nombre del archivo, ni del paquete, ni de nada que escriba el
 * alumnado: un identificador que dependiera del fuente permitiría que dos
 * ejecuciones compartieran namespace a propósito, que es justo la contaminación
 * que este diseño evita.
 */
function opaqueRunId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function clearSources(scope: CheerpJScope, slots: readonly string[]): void {
  for (const slot of slots) {
    try {
      scope.cheerpOSAddStringFile(slot, new Uint8Array(0));
    } catch {
      // La ranura se sobrescribe en la siguiente ejecución de todos modos.
    }
  }
}

/**
 * El registro del harness, vertido en el acumulador con tope de Nextudio.
 *
 * El tope se aplicó ya DENTRO de Java —eso es lo que impide que un bucle infinito
 * de `println` llene la memoria—, y se vuelve a aplicar aquí porque
 * `LimitedOutput` es el mismo acumulador que usan Python y R y la consola cuenta
 * caracteres, no bytes. Las dos cuentas pueden diferir con acentos, así que se
 * conserva el `truncated` de cualquiera de las dos.
 */
function replay(ledger: JavaLedger, output: LimitedOutput): CodeEngineRun {
  for (const segment of ledger.segments) {
    output.append(segment.channel, segment.text);
  }
  const run = output.toRun(ledger.status);
  return { ...run, truncated: run.truncated || ledger.truncated };
}

/** Carga CheerpJ desde el CDN oficial. Sólo funciona dentro de un Worker. */
async function loadCheerpJFromLoader(): Promise<CheerpJScope> {
  const scope = globalThis as unknown as CheerpJScope;
  if (typeof scope.importScripts !== 'function') {
    throw new Error('El runtime de Java sólo puede cargarse dentro de un Worker clásico.');
  }

  /**
   * NO definir `self.cj3LoaderPath` antes de esto.
   *
   * `loader.js` envuelve toda su definición en `if (!self.cj3LoaderPath)`, así
   * que predefinirlo —lo obvio si se quiere fijar la ruta— anula el loader
   * entero y deja `cheerpjInit` sin definir. Costó una tarde en J0.
   */
  scope.importScripts(CHEERPJ_LOADER_URL);

  if (typeof scope.cheerpjInit !== 'function') {
    throw new Error('loader.js no expuso cheerpjInit.');
  }
  return scope;
}

/**
 * Los fallos del ENTORNO, separados de los fallos del programa.
 *
 * Un programa que no compila es un resultado (`failed`) y se le enseña al
 * alumnado; que no se pueda descargar CheerpJ es una avería y se le enseña otra
 * cosa. Mezclarlos haría que un problema de red pareciera un error de sintaxis.
 */
export class JavaRuntimeError extends Error {
  constructor(
    readonly stage: 'runtime' | 'compiler' | 'internal',
    message: string
  ) {
    super(message);
    this.name = 'JavaRuntimeError';
  }
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
