import {
  ECJ_BATCH_COMPILER_CLASS,
  JAVA_BOOTCLASSPATH,
  JAVA_HARNESS_CLASS_NAME,
  JAVA_HARNESS_PACKAGE,
  JAVA_RUNTIME_VERSION,
  JAVA_VFS_RUNS_DIR,
} from './java-toolchain';

/**
 * El harness: la ÚNICA pieza de Java en la que este proyecto confía.
 *
 * ## Qué problema resuelve
 *
 * CheerpJ entrega `System.out` y `System.err` por el mismo `console.log`. Se
 * puede conservar el orden parcheando la consola, pero no la identidad del
 * flujo: todo llega como si fuera salida normal, y un aviso pintado en verde es
 * una mentira pequeña que en una clase de programación importa.
 *
 * J0 demostró la salida: sustituir los dos `PrintStream` DENTRO de la misma
 * invocación de la JVM y llevar un registro compartido. Este archivo convierte
 * esa demostración en producción y le añade tres cosas que el spike no tenía:
 *
 *  1. **compila él mismo.** ECJ se invoca en proceso, así que los diagnósticos
 *     del compilador pasan por los mismos flujos etiquetados y quedan en el
 *     mismo orden que la salida del programa. Antes hacía falta una invocación
 *     aparte y filtrar los mensajes que CheerpJ escribe por su cuenta.
 *  2. **classpath cerrado.** El código del alumnado se carga con un
 *     `URLClassLoader` cuyo padre es el cargador de ARRANQUE. No es que el
 *     harness y ECJ estén protegidos: es que no existen para ese código, y
 *     tampoco existe ninguna clase que otra ejecución dejara suelta.
 *  3. **limpieza pase lo que pase.** Un `finally` borra el namespace de la
 *     ejecución aunque el compilador falle, aunque `main` lance y aunque lance
 *     el propio harness. Lo que NO puede cubrir es `Worker.terminate()`, que no
 *     ejecuta `finally`: para eso el harness barre los namespaces ajenos al
 *     EMPEZAR, antes de crear el suyo.
 *
 * ## El tope de salida se aplica mientras se escribe
 *
 * `while (true) System.out.println(...)` no puede llenar la memoria de nadie. El
 * registro deja de ALMACENAR al llegar al tope y marca `truncated`, pero sigue
 * aceptando escrituras: cortar con una excepción cambiaría el comportamiento del
 * programa, y dejar de aceptar haría que un `println` se bloqueara. El programa
 * sigue corriendo —y sigue siendo terminable desde fuera— sin que la salida
 * crezca.
 *
 * ## Por qué es una cadena de TypeScript y no un archivo .java
 *
 * Porque no hay JDK en ninguna parte de este proyecto: ni en la máquina de quien
 * desarrolla ni en el despliegue. El único compilador de Java disponible es ECJ
 * DENTRO del navegador, así que el harness se compila ahí, una vez por Worker,
 * y se guarda en `/files/nextudio/runtime/harness`. Guardarlo como `.java` en
 * `src/` sólo conseguiría que ESLint y TypeScript no lo vieran y que el script
 * de copia tuviera que aprender una extensión más.
 */

/**
 * La marca de las líneas de registro. Nada más del programa la lleva.
 *
 * `NX` y no el nombre del producto en mayúsculas: la suite de marca prohíbe
 * escribirlo así en el código, y tiene razón —una marca con dos grafías acaba
 * apareciendo con las dos en la interfaz—. De paso el prefijo es más corto, que
 * en un registro troceado son bytes que no se pagan.
 */
export const JAVA_LEDGER_PREFIX = '__NX_JAVA_LEDGER_V1__';

export type JavaLedgerChannel = 'stdout' | 'stderr' | 'error';

export interface JavaLedgerSegment {
  channel: JavaLedgerChannel;
  text: string;
}

export interface JavaLedger {
  status: 'ok' | 'failed';
  truncated: boolean;
  segments: JavaLedgerSegment[];
}

/**
 * El texto del harness, con las constantes de la cadena de herramientas dentro.
 *
 * Se genera en vez de escribirse literal para que no haya dos sitios donde diga
 * `io.nextudio.runtime.internal` o `/lt/8/jre/lib/rt.jar`.
 */
export function javaHarnessSource(): string {
  return `package ${JAVA_HARNESS_PACKAGE};

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.FileInputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class ${JAVA_HARNESS_CLASS_NAME} {
  private static final String PREFIX = "${JAVA_LEDGER_PREFIX}";
  private static final int CHUNK = 3000;
  private static final String RUNS_DIR = "${JAVA_VFS_RUNS_DIR}";
  private static final String BOOTCLASSPATH = "${JAVA_BOOTCLASSPATH}";
  private static final String SOURCE_LEVEL = "${JAVA_RUNTIME_VERSION}";
  private static final String BATCH_COMPILER = "${ECJ_BATCH_COMPILER_CLASS}";

  /** Un tramo contiguo de un mismo canal. El orden es el del registro. */
  private static final class Segment {
    final char channel;
    final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();

    Segment(char channel) {
      this.channel = channel;
    }
  }

  /**
   * El registro compartido por los dos flujos.
   *
   * Sincronizado porque un programa con hilos escribe desde varios a la vez y el
   * orden observado tiene que ser UNO, no uno por hilo.
   */
  private static final class Recorder {
    private final List<Segment> segments = new ArrayList<Segment>();
    private final int limit;
    private int stored;
    private boolean truncated;

    Recorder(int limit) {
      this.limit = limit;
    }

    synchronized void write(char channel, byte[] data, int offset, int length) {
      if (length <= 0) return;
      int room = limit - stored;
      if (room <= 0) {
        truncated = true;
        return;
      }
      int take = length;
      if (take > room) {
        take = room;
        truncated = true;
      }
      Segment last = segments.isEmpty() ? null : segments.get(segments.size() - 1);
      if (last == null || last.channel != channel) {
        last = new Segment(channel);
        segments.add(last);
      }
      last.bytes.write(data, offset, take);
      stored += take;
    }

    synchronized void write(char channel, int value) {
      write(channel, new byte[] { (byte) value }, 0, 1);
    }

    synchronized boolean truncated() {
      return truncated;
    }

    synchronized List<Segment> segments() {
      return new ArrayList<Segment>(segments);
    }
  }

  private static final class Tagged extends OutputStream {
    private final Recorder recorder;
    private final char channel;

    Tagged(Recorder recorder, char channel) {
      this.recorder = recorder;
      this.channel = channel;
    }

    @Override
    public void write(int value) {
      recorder.write(channel, value);
    }

    @Override
    public void write(byte[] data, int offset, int length) {
      recorder.write(channel, data, offset, length);
    }
  }

  private static final class Manifest {
    String runId = "";
    String entryClass = "";
    int outputCap = 20000;
    final List<String> slots = new ArrayList<String>();
    final List<String> paths = new ArrayList<String>();
    final List<String> args = new ArrayList<String>();
  }

  public static void main(String[] argv) {
    PrintStream originalOut = System.out;
    PrintStream originalErr = System.err;
    Recorder recorder = new Recorder(20000);
    String runDir = null;
    boolean ok = false;

    try {
      if (argv.length < 1) throw new IllegalArgumentException("missing manifest path");
      Manifest manifest = readManifest(argv[0]);
      recorder = new Recorder(manifest.outputCap);

      // Barrer ANTES de crear el propio namespace: si la ejecución anterior
      // murió por Worker.terminate(), su finally no corrió y sus clases siguen
      // en /files. Esta línea es lo que impide que se resuelvan por accidente.
      sweep(manifest.runId);

      runDir = RUNS_DIR + "/" + manifest.runId;
      File sourceDir = new File(runDir + "/src");
      File classesDir = new File(runDir + "/classes");
      sourceDir.mkdirs();
      classesDir.mkdirs();

      List<String> sourcePaths = materialize(manifest, sourceDir);

      PrintStream taggedOut = new PrintStream(new Tagged(recorder, 'O'), true, "UTF-8");
      PrintStream taggedErr = new PrintStream(new Tagged(recorder, 'E'), true, "UTF-8");
      try {
        System.setOut(taggedOut);
        System.setErr(taggedErr);
        ok = compile(sourcePaths, classesDir, taggedOut, taggedErr)
            && invoke(manifest, classesDir, recorder);
      } finally {
        taggedOut.flush();
        taggedErr.flush();
        System.setOut(originalOut);
        System.setErr(originalErr);
      }
    } catch (Throwable failure) {
      byte[] text = bytes(describe(failure));
      recorder.write('X', text, 0, text.length);
      ok = false;
    } finally {
      if (runDir != null) delete(new File(runDir));
      emit(originalOut, recorder, ok);
    }
  }

  // -------------------------------------------------------------------------
  // Manifiesto
  // -------------------------------------------------------------------------

  /**
   * El manifiesto llega por /str, que es plano y de sólo lectura para Java.
   *
   * Formato de líneas y no JSON porque Java 8 sin dependencias no trae un
   * analizador de JSON y escribir uno aquí sería código no confiable dentro de
   * la pieza confiable.
   */
  private static Manifest readManifest(String path) throws IOException {
    Manifest manifest = new Manifest();
    String text = readAll(path);
    String[] lines = text.split("\\n");
    for (int index = 0; index < lines.length; index++) {
      String line = lines[index];
      int equals = line.indexOf('=');
      if (equals <= 0) continue;
      String key = line.substring(0, equals);
      String value = line.substring(equals + 1);
      if ("runId".equals(key)) manifest.runId = value;
      else if ("entryClass".equals(key)) manifest.entryClass = value;
      else if ("outputCap".equals(key)) manifest.outputCap = Integer.parseInt(value);
      else if ("arg".equals(key)) manifest.args.add(value);
      else if ("file".equals(key)) {
        int tab = value.indexOf('\\t');
        if (tab <= 0) throw new IOException("malformed file entry");
        manifest.slots.add(value.substring(0, tab));
        manifest.paths.add(value.substring(tab + 1));
      }
    }
    if (manifest.runId.length() == 0) throw new IOException("manifest without runId");
    if (manifest.entryClass.length() == 0) throw new IOException("manifest without entryClass");
    return manifest;
  }

  private static String readAll(String path) throws IOException {
    InputStream input = new FileInputStream(path);
    try {
      java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = input.read(chunk)) > 0) buffer.write(chunk, 0, read);
      return new String(buffer.toByteArray(), "UTF-8");
    } finally {
      input.close();
    }
  }

  /**
   * Copia cada ranura de /str a su ruta real dentro de src/.
   *
   * Las rutas ya vienen validadas por la autoridad de Nextudio para las rutas de
   * un proyecto, y aun así se vuelven a comprobar aquí: esta clase es la última
   * frontera antes de un «new File(...)», y una comprobación que depende de que
   * la de arriba siga comportándose bien no es una comprobación.
   */
  private static List<String> materialize(Manifest manifest, File sourceDir) throws IOException {
    List<String> written = new ArrayList<String>();
    String root = sourceDir.getCanonicalPath();

    for (int index = 0; index < manifest.slots.size(); index++) {
      String relative = manifest.paths.get(index);
      if (relative.startsWith("/") || relative.indexOf('\\\\') >= 0) {
        throw new IOException("unsafe path: " + relative);
      }
      String[] parts = relative.split("/");
      for (int part = 0; part < parts.length; part++) {
        if (parts[part].length() == 0 || ".".equals(parts[part]) || "..".equals(parts[part])) {
          throw new IOException("unsafe path: " + relative);
        }
      }

      File target = new File(sourceDir, relative);
      String resolved = target.getCanonicalPath();
      if (!resolved.startsWith(root + "/") && !resolved.equals(root)) {
        throw new IOException("path escapes the run namespace: " + relative);
      }

      File parent = target.getParentFile();
      if (parent != null) parent.mkdirs();

      InputStream input = new FileInputStream(manifest.slots.get(index));
      OutputStream output = new FileOutputStream(target);
      try {
        byte[] chunk = new byte[8192];
        int read;
        while ((read = input.read(chunk)) > 0) output.write(chunk, 0, read);
      } finally {
        input.close();
        output.close();
      }
      written.add(resolved);
    }
    return written;
  }

  // -------------------------------------------------------------------------
  // Compilar y ejecutar
  // -------------------------------------------------------------------------

  /**
   * ECJ en proceso, con «-classpath» VACÍO.
   *
   * El classpath vacío es la mitad del aislamiento: lo único que el compilador
   * puede resolver son las clases del JRE (por «-bootclasspath») y los fuentes
   * que se le pasan. Una clase que dejó otra ejecución en /files no entra, y por
   * eso un proyecto que usa «Ghost» sin incluir «Ghost.java» FALLA en vez de
   * compilar con los restos de antes.
   */
  private static boolean compile(
      List<String> sources, File classesDir, PrintStream out, PrintStream err) throws Exception {
    List<String> options = new ArrayList<String>();
    options.add("-proc:none");
    options.add("-nowarn");
    options.add("-source");
    options.add(SOURCE_LEVEL);
    options.add("-target");
    options.add(SOURCE_LEVEL);
    options.add("-encoding");
    options.add("UTF-8");
    options.add("-bootclasspath");
    options.add(BOOTCLASSPATH);
    options.add("-classpath");
    options.add("");
    options.add("-d");
    options.add(classesDir.getPath());
    options.addAll(sources);

    Class<?> batch = Class.forName(BATCH_COMPILER);
    Method compile = batch.getMethod(
        "compile", String[].class, PrintWriter.class, PrintWriter.class,
        Class.forName("org.eclipse.jdt.core.compiler.CompilationProgress"));
    PrintWriter outWriter = new PrintWriter(out, true);
    PrintWriter errWriter = new PrintWriter(err, true);
    Object result = compile.invoke(
        null, options.toArray(new String[options.size()]), outWriter, errWriter, null);
    outWriter.flush();
    errWriter.flush();
    return Boolean.TRUE.equals(result);
  }

  /**
   * «main» del proyecto, con el cargador de clases más pobre que Java admite.
   *
   * «null» como padre significa el cargador de ARRANQUE: «java.lang.String» sí,
   * este harness no, ECJ no, y nada de ninguna otra ejecución. Es el aislamiento
   * estructural que hace innecesario confiar en que un nombre de paquete sea
   * poco probable.
   */
  private static boolean invoke(Manifest manifest, File classesDir, Recorder recorder) {
    URLClassLoader loader = null;
    try {
      URL[] classpath = new URL[] { classesDir.toURI().toURL() };
      loader = new URLClassLoader(classpath, null);
      Class<?> target = Class.forName(manifest.entryClass, true, loader);
      Method main = target.getMethod("main", String[].class);
      if (!Modifier.isStatic(main.getModifiers())) {
        throw new NoSuchMethodException("main no es static en " + manifest.entryClass);
      }
      String[] args = manifest.args.toArray(new String[manifest.args.size()]);
      main.invoke(null, new Object[] { args });
      return true;
    } catch (InvocationTargetException wrapper) {
      Throwable cause = wrapper.getCause() == null ? wrapper : wrapper.getCause();
      byte[] text = bytes(describe(cause));
      recorder.write('X', text, 0, text.length);
      return false;
    } catch (Throwable failure) {
      byte[] text = bytes(describe(failure));
      recorder.write('X', text, 0, text.length);
      return false;
    } finally {
      if (loader != null) {
        try {
          loader.close();
        } catch (IOException ignored) {
          // Cerrar el cargador es higiene; el namespace se borra igual.
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Limpieza
  // -------------------------------------------------------------------------

  /** Borra los namespaces de ejecuciones que no son la de ahora. */
  private static void sweep(String keep) {
    File runs = new File(RUNS_DIR);
    String[] names = runs.list();
    if (names == null) return;
    for (int index = 0; index < names.length; index++) {
      if (names[index].equals(keep)) continue;
      delete(new File(runs, names[index]));
    }
  }

  private static void delete(File entry) {
    String[] names = entry.list();
    if (names != null) {
      for (int index = 0; index < names.length; index++) {
        delete(new File(entry, names[index]));
      }
    }
    entry.delete();
  }

  // -------------------------------------------------------------------------
  // El registro, de vuelta a JavaScript
  // -------------------------------------------------------------------------

  /**
   * El registro sale por el «System.out» ORIGINAL, en trozos con su índice.
   *
   * CheerpJ entrega la consola línea a línea; partirlo evita depender de que una
   * línea de treinta kilobytes llegue entera y hace que el orden de los trozos
   * sea comprobable en lugar de supuesto.
   */
  private static void emit(PrintStream original, Recorder recorder, boolean ok) {
    StringBuilder payload = new StringBuilder();
    payload.append(ok ? "ok" : "failed");
    payload.append('|');
    payload.append(recorder.truncated() ? "1" : "0");
    List<Segment> segments = recorder.segments();
    for (int index = 0; index < segments.size(); index++) {
      Segment segment = segments.get(index);
      payload.append('|');
      payload.append(segment.channel);
      payload.append(':');
      payload.append(base64(segment.bytes.toByteArray()));
    }

    String text = payload.toString();
    int total = (text.length() + CHUNK - 1) / CHUNK;
    if (total == 0) total = 1;
    for (int index = 0; index < total; index++) {
      int from = index * CHUNK;
      int to = Math.min(text.length(), from + CHUNK);
      original.println(PREFIX + index + "/" + total + "|" + text.substring(from, to));
    }
    original.flush();
  }

  /**
   * Base64 a mano.
   *
   * «java.util.Base64» existe desde Java 8, pero esta clase tiene que compilar
   * con «-bootclasspath» apuntando al «rt.jar» que empaqueta CheerpJ y no a un
   * JDK que nadie ha inspeccionado. Veinte líneas propias valen menos que un
   * fallo de compilación del harness en el navegador de alguien.
   */
  private static String base64(byte[] data) {
    final char[] alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
    StringBuilder encoded = new StringBuilder(((data.length + 2) / 3) * 4);
    int index = 0;
    while (index + 2 < data.length) {
      int chunk = ((data[index] & 0xff) << 16) | ((data[index + 1] & 0xff) << 8)
          | (data[index + 2] & 0xff);
      encoded.append(alphabet[(chunk >>> 18) & 0x3f]);
      encoded.append(alphabet[(chunk >>> 12) & 0x3f]);
      encoded.append(alphabet[(chunk >>> 6) & 0x3f]);
      encoded.append(alphabet[chunk & 0x3f]);
      index += 3;
    }
    int remaining = data.length - index;
    if (remaining == 1) {
      int chunk = (data[index] & 0xff) << 16;
      encoded.append(alphabet[(chunk >>> 18) & 0x3f]);
      encoded.append(alphabet[(chunk >>> 12) & 0x3f]);
      encoded.append("==");
    } else if (remaining == 2) {
      int chunk = ((data[index] & 0xff) << 16) | ((data[index + 1] & 0xff) << 8);
      encoded.append(alphabet[(chunk >>> 18) & 0x3f]);
      encoded.append(alphabet[(chunk >>> 12) & 0x3f]);
      encoded.append(alphabet[(chunk >>> 6) & 0x3f]);
      encoded.append('=');
    }
    return encoded.toString();
  }

  private static byte[] bytes(String text) {
    try {
      return text.getBytes("UTF-8");
    } catch (java.io.UnsupportedEncodingException impossible) {
      return text.getBytes();
    }
  }

  /** La excepción tal y como la vería quien programa: clase, mensaje y traza. */
  private static String describe(Throwable failure) {
    java.io.StringWriter buffer = new java.io.StringWriter();
    PrintWriter writer = new PrintWriter(buffer);
    failure.printStackTrace(writer);
    writer.flush();
    String text = buffer.toString();
    return text.endsWith("\\n") ? text : text + "\\n";
  }
}
`;
}

/**
 * El registro, de vuelta a tipos de TypeScript.
 *
 * Se separa del motor para poder probarlo sin navegador: decodificar mal el
 * orden de la salida es exactamente el tipo de fallo que una prueba de Node
 * detecta y una del navegador tapa.
 */
export function decodeJavaLedger(lines: readonly string[]): JavaLedger | null {
  const chunks = new Map<number, string>();
  let expected = -1;

  for (const line of lines) {
    const at = line.indexOf(JAVA_LEDGER_PREFIX);
    if (at === -1) continue;
    const rest = line.slice(at + JAVA_LEDGER_PREFIX.length);
    const header = /^(\d+)\/(\d+)\|/.exec(rest);
    if (!header) continue;
    const index = Number(header[1]);
    const total = Number(header[2]);
    if (expected !== -1 && expected !== total) return null;
    expected = total;
    chunks.set(index, rest.slice(header[0].length));
  }

  if (expected === -1) return null;
  const ordered: string[] = [];
  for (let index = 0; index < expected; index += 1) {
    const chunk = chunks.get(index);
    if (chunk === undefined) return null;
    ordered.push(chunk);
  }

  const [status, truncated, ...rest] = ordered.join('').split('|');
  if (status !== 'ok' && status !== 'failed') return null;

  const segments: JavaLedgerSegment[] = [];
  for (const piece of rest) {
    const channel = piece.slice(0, 1);
    if (piece.slice(1, 2) !== ':') return null;
    const stream = LEDGER_CHANNELS[channel];
    if (!stream) return null;
    segments.push({ channel: stream, text: decodeBase64Utf8(piece.slice(2)) });
  }

  return { status, truncated: truncated === '1', segments };
}

const LEDGER_CHANNELS: Readonly<Record<string, JavaLedgerChannel | undefined>> = {
  O: 'stdout',
  E: 'stderr',
  X: 'error',
};

/**
 * Base64 a bytes y de ahí a texto UTF-8.
 *
 * `atob` existe en el Worker pero devuelve una cadena de bytes latin-1: pasar de
 * ahí a UTF-8 sin `TextDecoder` convertiría cada acento en dos símbolos. Y
 * `TextDecoder` existe igual en Node, así que la misma función vale para la
 * prueba y para el navegador.
 */
function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
