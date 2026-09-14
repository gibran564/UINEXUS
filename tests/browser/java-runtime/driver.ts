/**
 * El guion de las pruebas de Java EN UN NAVEGADOR DE VERDAD.
 *
 * ## Por qué esto no es una prueba de vitest
 *
 * Porque no se puede. CheerpJ es WebAssembly que se carga con `importScripts`
 * dentro de un Worker clásico, compila Java con ECJ y escribe en un sistema de
 * archivos respaldado por IndexedDB. Simular todo eso en jsdom o en un Worker de
 * Node produciría una prueba que pasa sin haber ejecutado una sola línea de Java,
 * que es peor que no tenerla: daría confianza falsa exactamente sobre la parte
 * que nadie más cubre.
 *
 * Así que lo que hay aquí es el ejecutor REAL —`getInternalBrowserCodeRunner`, el
 * mismo Worker que se publica, el mismo motor, el mismo CheerpJ del CDN— movido
 * por Chromium. Los dobles siguen sirviendo para los contratos y viven en
 * `tests/unit/`.
 *
 * `scripts/run-java-browser-tests.mjs` empaqueta este archivo, lo sirve junto a
 * `public/`, cuenta los accesos a `/api/private/hit` y decide el resultado.
 */

import { getInternalBrowserCodeRunner } from '@/lib/browser-code-runner';
import type { BrowserCodeRunner } from '@/lib/browser-code-runner';
import { CODE_RUN_LIMITS } from '@/lib/code-runner-contract';
import type { CodeRunResult } from '@/lib/code-runner-contract';

interface Check {
  name: string;
  ok: boolean;
  detail: unknown;
}

declare global {
  interface Window {
    __javaReport?: { checks: Check[] };
  }
}

const checks: Check[] = [];
const say = (text: string): void => {
  const node = document.querySelector('#log');
  if (node) node.textContent += `${text}\n`;
};

function record(name: string, ok: boolean, detail: unknown): void {
  checks.push({ name, ok, detail });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

function createRunner(options: { timeoutMs?: number } = {}): BrowserCodeRunner {
  return getInternalBrowserCodeRunner('java', {
    timeoutMs: options.timeoutMs ?? 120_000,
    bootstrapTimeoutMs: 240_000,
  });
}

function project(files: Record<string, string>, entryFile: string) {
  return { language: 'java' as const, source: files[entryFile] ?? '', files, entryFile };
}

const HELLO = `public class Hello {
  public static void main(String[] args) {
    System.out.println("Hola Java");
    System.out.println("args=" + args.length);
  }
}
`;

const INTERLEAVED = `public class Mixed {
  public static void main(String[] args) {
    System.out.println("A");
    System.err.println("B");
    System.out.println("C");
  }
}
`;

const ENDLESS = `public class Endless {
  public static void main(String[] args) {
    long n = 0;
    while (true) n++;
  }
}
`;

const FLOOD = `public class Flood {
  public static void main(String[] args) {
    StringBuilder line = new StringBuilder();
    for (int i = 0; i < 200; i++) line.append('A');
    for (int i = 0; i < 100000; i++) System.out.println(line.toString());
  }
}
`;

// ---------------------------------------------------------------------------

async function runtimeChecks(): Promise<void> {
  const runner = createRunner();

  try {
    say('Run 1 · Hello World');
    const hello = await runner.run({ language: 'java', source: HELLO });
    record(
      'hello-world',
      hello.status === 'ok' &&
        hello.stdout.includes('Hola Java') &&
        hello.stdout.includes('args=0'),
      summary(hello)
    );

    say('argv · main recibe un arreglo vacío, nunca null');
    record('argv-empty-not-null', hello.stdout.includes('args=0'), hello.stdout);

    say('Run 2 · multiarchivo con paquete');
    const multi = await runner.run(
      project(
        {
          'src/app/Main.java': `package app;
public class Main {
  public static void main(String[] args) {
    System.out.println(Greeter.greet("clase"));
  }
}
`,
          'src/app/Greeter.java': `package app;
class Greeter {
  static String greet(String who) { return "hola " + who; }
}
`,
        },
        'src/app/Main.java'
      )
    );
    record(
      'multi-file-package',
      multi.status === 'ok' && multi.stdout.includes('hola clase'),
      summary(multi)
    );

    say('entrypoint · la clase es app.Main, no Main');
    const nested = await runner.run(
      project(
        {
          'Otra.java': `public class Otra { }\n`,
          'app/Programa.java': `package app;
public class Programa {
  static class Interna { public static void main(String[] a) { System.out.println("NO"); } }
  public static void main(String[] args) { System.out.println("SI"); }
}
`,
        },
        'app/Programa.java'
      )
    );
    record(
      'entrypoint-resolution',
      nested.status === 'ok' && nested.stdout.includes('SI') && !nested.stdout.includes('NO'),
      summary(nested)
    );

    say('Run 3 · error de compilación');
    const broken = await runner.run({
      language: 'java',
      source: `public class Roto {
  public static void main(String[] args) {
    int x = "no soy un número"
  }
}
`,
    });
    record(
      'compile-error',
      broken.status === 'failed' && broken.stderr.length > 0,
      summary(broken)
    );

    say('excepción en tiempo de ejecución');
    const throws = await runner.run({
      language: 'java',
      source: `public class Explota {
  public static void main(String[] args) {
    System.out.println("antes");
    throw new IllegalStateException("a propósito");
  }
}
`,
    });
    record(
      'runtime-exception',
      throws.status === 'failed' &&
        throws.stdout.includes('antes') &&
        throws.stderr.includes('IllegalStateException'),
      summary(throws)
    );

    say('Run 4 · stdout y stderr conservan el orden');
    const mixed = await runner.run({ language: 'java', source: INTERLEAVED });
    const order = (mixed.outputs ?? []).map((entry) =>
      entry.stream === 'stdout' || entry.stream === 'stderr' || entry.stream === 'error'
        ? `${entry.stream}:${entry.text.trim()}`
        : entry.stream
    );
    record(
      'interleaving',
      mixed.status === 'ok' &&
        order.join('|') === 'stdout:A|stderr:B|stdout:C' &&
        mixed.stdout === 'A\nC\n' &&
        mixed.stderr === 'B\n',
      { order, ...summary(mixed) }
    );

    say('paquete reservado rechazado');
    const reserved = await runner.run({
      language: 'java',
      source: `package io.nextudio.runtime.internal;
public class Colision { public static void main(String[] a) { } }
`,
    });
    record(
      'reserved-namespace',
      reserved.status === 'failed' && reserved.stderr.includes('reservado'),
      summary(reserved)
    );

    say('ruta con escape rechazada');
    const traversal = await runner.run(
      project({ '../fuera/Main.java': HELLO, 'Hello.java': HELLO }, 'Hello.java')
    );
    // `validateCodeRunRequest` la rechaza antes de arrancar nada: el proyecto
    // entero es inválido, no sólo el archivo.
    record(
      'path-traversal-rejected',
      traversal.status === 'rejected' && traversal.stderr.includes('ruta'),
      summary(traversal)
    );

    say('Run 8 · una clase de otra ejecución no se resuelve');
    const ghostBuilt = await runner.run({
      language: 'java',
      source: `public class Ghost {
  public static int value() { return 42; }
  public static void main(String[] args) { System.out.println("ghost listo"); }
}
`,
    });
    const ghostUsed = await runner.run({
      language: 'java',
      source: `public class Usa {
  public static void main(String[] args) { System.out.println(Ghost.value()); }
}
`,
    });
    record(
      'stale-class-isolation',
      ghostBuilt.status === 'ok' && ghostUsed.status === 'failed',
      { built: summary(ghostBuilt), used: summary(ghostUsed) }
    );

    say('salida enorme truncada sin agotar memoria');
    const flooded = await runner.run({ language: 'java', source: FLOOD });
    record(
      'huge-stdout-truncated',
      flooded.truncated &&
        flooded.stdout.length <= CODE_RUN_LIMITS.maxOutputChars &&
        flooded.stdout.startsWith('AAA'),
      { ...summary(flooded), length: flooded.stdout.length }
    );

    say('dispose');
    await runner.dispose();
    const afterDispose = await runner.run({ language: 'java', source: HELLO });
    record(
      'run-after-dispose',
      afterDispose.status === 'ok' && afterDispose.stdout.includes('Hola Java'),
      summary(afterDispose)
    );
  } finally {
    await runner.dispose();
  }
}

async function lifecycleChecks(): Promise<void> {
  say('Run 5 · tiempo límite mata el Worker');
  /**
   * 40 segundos, y no 8.
   *
   * El tiempo límite de este ejecutor mide la invocación del harness, que COMPILA
   * antes de ejecutar: unos cinco segundos de ECJ dentro de CheerpJ en esta
   * máquina. Con ocho segundos la prueba «la siguiente ejecución funciona»
   * fallaba por el reloj y no por el runtime, que es el peor tipo de prueba roja.
   * Lo que se comprueba aquí es el mecanismo —terminar el Worker y recuperarse—,
   * no cuál es el número.
   */
  const timed = createRunner({ timeoutMs: 40_000 });
  const started = performance.now();
  const timeout = await timed.run({ language: 'java', source: ENDLESS });
  const elapsed = Math.round(performance.now() - started);
  record('timeout', timeout.status === 'timeout', { ...summary(timeout), elapsed });

  say('Run 6 · la siguiente ejecución funciona igual');
  const revived = await timed.run({ language: 'java', source: HELLO });
  record(
    'run-after-timeout',
    revived.status === 'ok' && revived.stdout.includes('Hola Java'),
    summary(revived)
  );
  await timed.dispose();

  say('interrupt · detener deja status stopped');
  const stoppable = createRunner();
  const pending = stoppable.run({ language: 'java', source: ENDLESS });
  /**
   * Treinta segundos de espera, y son necesarios.
   *
   * Interrumpir antes de que el programa esté dentro de `main` sí devolvería
   * `stopped` —`interrupt()` también corta un arranque en curso— y no probaría lo
   * que importa, que es detener un bucle infinito ya en marcha. El registro del
   * harness sólo sale al FINAL, así que no hay ninguna señal de «ya empecé» que
   * esperar: hay que darle tiempo a arrancar CheerpJ y compilar.
   */
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await stoppable.interrupt();
  const stopped = await pending;
  record('interrupt', stopped.status === 'stopped', summary(stopped));
  await stoppable.dispose();
}

async function securityChecks(): Promise<void> {
  say('Run 7 · Java no alcanza /api/private/hit');
  const before = await privateHits();
  const runner = createRunner();
  /**
   * Cuatro caminos distintos, no sólo `HttpURLConnection`.
   *
   * El spike J0 sólo probó uno, y eso no demuestra nada sobre los demás: lo que
   * hay que enseñar es que el código del alumnado no alcanza `/api/*` por ninguna
   * de las vías que Java 8 ofrece dentro de CheerpJ.
   *
   * Cada resultado se imprime con un marcador `[N]` propio. La primera versión de
   * esta prueba usaba el nombre de la vía y pasaba EN FALSO: «URLConnection ->
   * BLOQUEADO» es una subcadena de «HttpURLConnection -> BLOQUEADO», así que una
   * vía que no se bloqueaba se daba por bloqueada. Un número por vía quita esa
   * ambigüedad.
   *
   * `URLConnection` merece una nota: `connect()` por sí solo dice que funcionó
   * —CheerpJ no pide nada hasta que alguien lee—, así que la prueba LEE.
   */
  const probe = await runner.run({
    language: 'java',
    source: `import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;

public class Red {
  static final String TARGET = "${location.origin}/api/private/hit";

  public static void main(String[] args) {
    intenta(1);
    intenta(2);
    intenta(3);
    intenta(4);
  }

  static void intenta(int via) {
    try {
      if (via == 1) {
        HttpURLConnection connection = (HttpURLConnection) new URL(TARGET).openConnection();
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(2500);
        System.out.println("[1] HTTP " + connection.getResponseCode());
        return;
      }
      if (via == 2) {
        URLConnection connection = new URL(TARGET).openConnection();
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(2500);
        connection.connect();
        InputStream stream = connection.getInputStream();
        int first = stream.read();
        stream.close();
        System.out.println("[2] leido " + first);
        return;
      }
      if (via == 3) {
        InputStream stream = new URL(TARGET).openStream();
        int first = stream.read();
        stream.close();
        System.out.println("[3] leido " + first);
        return;
      }
      Object content = new URL(TARGET).getContent();
      System.out.println("[4] contenido " + (content == null ? "null" : "presente"));
    } catch (Throwable error) {
      System.out.println("[" + via + "] BLOQUEADO " + error.getClass().getName());
    }
  }
}
`,
  });
  const after = await privateHits();

  record(
    'private-api-blocked',
    // El contador del servidor es la evidencia que no se puede maquillar: si una
    // sola de las cuatro vías hubiera llegado, `after` sería mayor que `before`.
    after === before && [1, 2, 3, 4].every((via) => probe.stdout.includes(`[${via}] BLOQUEADO`)),
    { before, after, ...summary(probe) }
  );

  say('los recursos permitidos de CheerpJ siguen funcionando');
  /**
   * La evidencia de que la lista blanca no cierra de más.
   *
   * Que este programa COMPILE y EJECUTE después de aplicar el firewall significa
   * que ECJ se leyó de `/runtime/java/` y el JRE 8 del CDN de CheerpJ. Si la
   * lista blanca estuviera mal, esto fallaría igual que la petición a `/api`.
   *
   * Quien cuenta las peticiones al CDN es el ejecutor de la prueba y no este
   * guion: `performance.getEntriesByType('resource')` de la PÁGINA no ve lo que
   * pide un Worker, así que contar aquí habría dado cero siempre y la prueba
   * habría pasado sin comprobar nada.
   */
  const stillWorks = await runner.run({ language: 'java', source: HELLO });
  record('allowed-runtime-resources', stillWorks.status === 'ok', summary(stillWorks));

  say('campos inesperados en el mensaje del Worker se ignoran');
  const smuggled = await runner.run({
    language: 'java',
    source: HELLO,
    // Campos que el protocolo NO declara. `sanitizeWorkerRun` monta el mensaje
    // campo a campo, así que nada de esto puede cruzar.
    ...({ idToken: 'no', cookie: 'no', classpath: '/files', args: ['x'] } as object),
  });
  record(
    'unexpected-fields-ignored',
    smuggled.status === 'ok' && smuggled.stdout.includes('args=0'),
    summary(smuggled)
  );

  await runner.dispose();
  await rawSocketCheck();
}

/**
 * Un socket crudo, aparte y con su propio reloj.
 *
 * Va en su propia comprobación porque su desenlace es distinto al de las cuatro
 * vías de `java.net.URL`: CheerpJ acepta `new Socket()` y `connect()` sin pedir
 * nada al navegador, y luego el primer `read()` NO VUELVE. Se comprobó que pasa
 * igual sin ningún firewall aplicado, así que es comportamiento de CheerpJ —su
 * capa de sockets necesita un proxy que este despliegue no tiene— y no algo que
 * introduzca esta fase.
 *
 * Por eso lo que se exige no es una forma concreta de fallar, que sería exigir un
 * detalle de CheerpJ, sino la garantía: que el servidor no reciba NADA. Cómo
 * acabe la ejecución —excepción, `-1` o tiempo límite— da igual, y meterlo en la
 * prueba anterior habría borrado la evidencia de las otras cuatro vías, porque un
 * tiempo límite no devuelve salida.
 */
async function rawSocketCheck(): Promise<void> {
  say('un socket crudo tampoco alcanza /api');
  const before = await privateHits();
  const runner = createRunner({ timeoutMs: 30_000 });

  const result = await runner.run({
    language: 'java',
    source: `import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;

public class Crudo {
  public static void main(String[] args) {
    try {
      URL url = new URL("${location.origin}/api/private/hit");
      int port = url.getPort() == -1 ? 80 : url.getPort();
      Socket socket = new Socket();
      socket.connect(new InetSocketAddress(url.getHost(), port), 2500);
      socket.setSoTimeout(2500);
      OutputStream out = socket.getOutputStream();
      out.write(("GET " + url.getPath() + " HTTP/1.1\\r\\nHost: " + url.getHost() + ":" + port
          + "\\r\\nConnection: close\\r\\n\\r\\n").getBytes("UTF-8"));
      out.flush();
      int first = socket.getInputStream().read();
      socket.close();
      System.out.println("primer byte " + first);
    } catch (Throwable error) {
      System.out.println("BLOQUEADO " + error.getClass().getName());
    }
  }
}
`,
  });

  const after = await privateHits();
  record(
    'raw-socket-reaches-nothing',
    after === before && !result.stdout.includes('primer byte 72'),
    { before, after, ...summary(result) }
  );
  await runner.dispose();
}

// ---------------------------------------------------------------------------

function summary(result: CodeRunResult) {
  return {
    status: result.status,
    stdout: result.stdout.slice(0, 600),
    stderr: result.stderr.slice(0, 900),
    truncated: result.truncated,
    durationMs: result.durationMs,
  };
}

/**
 * Una marca temporal que el ejecutor de la prueba puede correlacionar.
 *
 * Lo que hace falta demostrar es un ORDEN: que no hubo ninguna petición al CDN de
 * CheerpJ antes de la primera ejecución. Las peticiones de un Worker las ve
 * Playwright y no esta página, así que la página marca los hitos y quien cruza
 * las dos listas es `scripts/run-java-browser-tests.mjs`.
 */
async function mark(name: string): Promise<void> {
  await fetch(`/__mark/${name}`);
}

async function privateHits(): Promise<number> {
  const response = await fetch('/__private_hits');
  const body = (await response.json()) as { hits: number };
  return body.hits;
}

async function main(): Promise<void> {
  say('arranque perezoso · construir el ejecutor no descarga CheerpJ');
  const idle = createRunner();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await mark('before-first-run');
  await idle.dispose();

  await runtimeChecks();
  await lifecycleChecks();
  await securityChecks();
  window.__javaReport = { checks };
  say(`Terminado: ${checks.filter((check) => check.ok).length}/${checks.length}`);
}

main().catch((error: unknown) => {
  record('driver-fatal', false, { error: String(error) });
  window.__javaReport = { checks };
});
