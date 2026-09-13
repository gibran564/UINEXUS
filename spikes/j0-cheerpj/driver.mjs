/**
 * Orquestador del spike J0 dentro del navegador.
 *
 * `run-spike.mjs` sirve las fuentes Java bajo /assets/gen/*; este módulo crea
 * Workers, les pide compilar/ejecutar y publica `window.__j0Report`.
 */
const report = {
  meta: {
    date: new Date().toISOString(),
    cheerpj: '4.3',
    ecj: '3.13.102',
    isolation: 'spikes/j0-cheerpj only; Java remains browserExecution:false',
  },
  experiments: [],
};

const status = document.querySelector('#status');
const out = document.querySelector('#out');
function say(text) {
  status.textContent = text;
  out.textContent += `${text}\n`;
}

let requestSequence = 0;
function createWorker() {
  // CheerpJ 4.3 distribuye loader.js como script clásico, y Chromium prohíbe
  // importScripts() desde un Worker de módulo. El Worker sí es un Web Worker,
  // pero debe crearse como clásico para cargar esta distribución del runtime.
  return new Worker('/worker.mjs', {
    name: `j0-cheerpj-${Math.random().toString(36).slice(2)}`,
  });
}
function call(worker, op, args = {}, timeoutMs = 120_000) {
  const requestId = ++requestSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      reject(new Error(`${op} no respondió en ${timeoutMs} ms`));
    }, timeoutMs);
    const onMessage = (event) => {
      if (event.data?.requestId !== requestId) return;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      resolve(event.data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ requestId, op, args });
  });
}

async function materialize(id, className, source) {
  const response = await fetch('/__j0_materialize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, className, source }),
  });
  if (!response.ok) throw new Error(`materialize ${className}: HTTP ${response.status}`);
  return response.json();
}

async function materializeSources(id, sources) {
  return Promise.all(
    Object.entries(sources).map(([className, source]) => materialize(id, className, source))
  );
}

function relevant(text, marker) {
  return text.some((line) => line.includes(marker));
}
function compileSucceeded(result) {
  return result.kind === 'ok' && result.thrown === null && result.exitCode === 0;
}
function runSucceeded(result) {
  return result.kind === 'ok' && result.thrown === null && result.exitCode === 0;
}

const JAVA = {
  Hello: `
import java.util.Arrays;
public class Hello {
  public static void main(String[] args) {
    System.out.println("hello-from-j0");
    System.err.println("j0-warn-on-stderr");
    System.out.println("argv=" + Arrays.toString(args));
    System.err.println("j0-error-two");
    System.out.println("j0-done");
  }
}
`,
  NetProbe: `
import java.net.HttpURLConnection;
import java.net.URL;
public class NetProbe {
  public static void main(String[] args) {
    try {
      URL url = new URL(new URL("http://127.0.0.1:8787"), args[0]);
      HttpURLConnection connection = (HttpURLConnection) url.openConnection();
      connection.setConnectTimeout(2500);
      connection.setReadTimeout(2500);
      int code = connection.getResponseCode();
      System.out.println("NET_GOT_HTTP_" + code);
    } catch (Throwable error) {
      System.out.println("NET_BLOCKED " + error.getClass().getName() + ": " + error.getMessage());
    }
  }
}
`,
  Endless: `
public class Endless {
  public static void main(String[] args) {
    long n = 0;
    while (true) n++;
  }
}
`,
  CaptureHarness: `
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class CaptureHarness {
  private static final String PREFIX = "__J0_CAPTURE_V1__";
  private static final char[] HEX = "0123456789abcdef".toCharArray();

  private static final class Entry {
    final long sequence;
    final char channel;
    final int value;

    Entry(long sequence, char channel, int value) {
      this.sequence = sequence;
      this.channel = channel;
      this.value = value;
    }
  }

  private static final class Recorder {
    private final List<Entry> entries = new ArrayList<Entry>();
    private long sequence;

    synchronized void record(char channel, int value) {
      entries.add(new Entry(++sequence, channel, value & 0xff));
    }

    synchronized void record(char channel, byte[] bytes, int offset, int length) {
      for (int index = offset; index < offset + length; index++) {
        record(channel, bytes[index]);
      }
    }

    synchronized String encode() {
      StringBuilder encoded = new StringBuilder(entries.size() * 10);
      for (Entry entry : entries) {
        encoded.append(entry.sequence).append(':').append(entry.channel).append(':');
        encoded.append(HEX[entry.value >>> 4]).append(HEX[entry.value & 0x0f]).append(';');
      }
      return encoded.toString();
    }
  }

  private static final class TaggedOutputStream extends OutputStream {
    private final Recorder recorder;
    private final char channel;

    TaggedOutputStream(Recorder recorder, char channel) {
      this.recorder = recorder;
      this.channel = channel;
    }

    @Override
    public void write(int value) {
      recorder.record(channel, value);
    }

    @Override
    public void write(byte[] bytes, int offset, int length) {
      recorder.record(channel, bytes, offset, length);
    }
  }

  public static void main(String[] args) throws Throwable {
    if (args.length == 0) throw new IllegalArgumentException("missing target class");

    PrintStream originalOut = System.out;
    PrintStream originalErr = System.err;
    Recorder recorder = new Recorder();
    PrintStream taggedOut = new PrintStream(new TaggedOutputStream(recorder, 'O'), true, "UTF-8");
    PrintStream taggedErr = new PrintStream(new TaggedOutputStream(recorder, 'E'), true, "UTF-8");
    Throwable failure = null;

    try {
      System.setOut(taggedOut);
      System.setErr(taggedErr);
      Class<?> target = Class.forName(args[0]);
      Method main = target.getMethod("main", String[].class);
      String[] targetArgs = Arrays.copyOfRange(args, 1, args.length);
      main.invoke(null, new Object[] { targetArgs });
    } catch (InvocationTargetException error) {
      failure = error.getCause();
    } catch (Throwable error) {
      failure = error;
    } finally {
      taggedOut.flush();
      taggedErr.flush();
      System.setOut(originalOut);
      System.setErr(originalErr);
    }

    originalOut.println(PREFIX + recorder.encode());
    if (failure != null) {
      failure.printStackTrace(originalErr);
      throw failure;
    }
  }
}
`,
};

async function bootExperiment() {
  say('G1 · cargar CheerpJ 4.3 dentro de Worker');
  const worker = createWorker();
  const result = await call(worker, 'boot', {}, 150_000);
  worker.terminate();
  return {
    name: 'G1-boot',
    ok:
      result.kind === 'ok' &&
      result.booted === true &&
      result.api?.cheerpjRunMain === 'function',
    evidence: result,
  };
}

async function javacProbeExperiment() {
  say('G2a · sondear javac en el JRE CheerpJ');
  const worker = createWorker();
  const result = await call(worker, 'probeJavac', {}, 150_000);
  worker.terminate();
  return { name: 'G2a-javac-probe', ok: result.kind === 'ok', evidence: result };
}

async function compileAndRunExperiment() {
  say('G2b/G3 · compilar Hello.java con ECJ y ejecutar main(String[])');
  const id = 'hello';
  await materializeSources(id, {
    Hello: JAVA.Hello,
    CaptureHarness: JAVA.CaptureHarness,
  });
  const worker = createWorker();
  const compile = await call(
    worker,
    'compile',
    { id, classNames: ['Hello', 'CaptureHarness'] },
    180_000
  );
  let rawRun = null;
  if (compileSucceeded(compile)) {
    // Evidencia del comportamiento por defecto: CheerpJ conserva orden total,
    // pero entrega System.out y System.err juntos por console.log.
    rawRun = await call(
      worker,
      'run',
      { id, className: 'Hello', programArgs: ['a1', 'b2'] },
      120_000
    );
  }
  let capturedRun = null;
  if (compileSucceeded(compile)) {
    // CaptureHarness y Hello se compilan juntos dentro del browser y se ejecutan
    // en una única invocación CheerpJ. Así System.setOut/System.setErr modifica
    // el mismo contexto Java que ejecuta el main del usuario.
    capturedRun = await call(
      worker,
      'runCaptured',
      { id, className: 'Hello', programArgs: ['a1', 'b2'] },
      120_000
    );
  }
  worker.terminate();

  const capturedEvents = capturedRun?.capturedEvents ?? [];
  const capturedText = (channel) => capturedEvents
    .filter((event) => event.channel === channel)
    .map((event) => event.text)
    .join('');
  const stdout = capturedText('stdout');
  const stderr = capturedText('stderr');
  const channelsCorrect =
    stdout.includes('hello-from-j0') &&
    stdout.includes('argv=[a1, b2]') &&
    stdout.includes('j0-done') &&
    !stdout.includes('j0-warn-on-stderr') &&
    !stdout.includes('j0-error-two') &&
    stderr.includes('j0-warn-on-stderr') &&
    stderr.includes('j0-error-two') &&
    !stderr.includes('hello-from-j0') &&
    !stderr.includes('j0-done');
  const markerOrder = [
    ['stdout', 'hello-from-j0'],
    ['stderr', 'j0-warn-on-stderr'],
    ['stdout', 'argv=[a1, b2]'],
    ['stderr', 'j0-error-two'],
    ['stdout', 'j0-done'],
  ];
  const capturedInterleaving = markerOrder.map(([channel, marker]) =>
    capturedEvents.find((event) => event.channel === channel && event.text.includes(marker))?.seq ?? null
  );
  const capturedOrderPreserved =
    capturedInterleaving.length === markerOrder.length &&
    capturedInterleaving.every((seq) => seq !== null) &&
    capturedInterleaving.every(
      (seq, index) => index === 0 || capturedInterleaving[index - 1] < seq
    );
  const rawInterleaving = rawRun
    ? ['hello-from-j0', 'j0-warn-on-stderr', 'argv=[a1, b2]', 'j0-error-two', 'j0-done']
        .map((marker) => rawRun.events.find((event) => event.text.includes(marker))?.seq ?? null)
    : [];
  const rawOrderPreserved =
    rawInterleaving.length === 5 &&
    rawInterleaving.every((seq) => seq !== null) &&
    rawInterleaving.every((seq, index) => index === 0 || rawInterleaving[index - 1] < seq);

  return {
    compile: {
      name: 'G2-compile',
      ok: compileSucceeded(compile),
      evidence: compile,
    },
    run: {
      name: 'G3-run-and-capture',
      ok:
        rawRun !== null &&
        runSucceeded(rawRun) &&
        capturedRun?.kind === 'ok' &&
        capturedRun?.thrown === null &&
        capturedRun?.exitCode === 0 &&
        channelsCorrect &&
        capturedOrderPreserved &&
        rawOrderPreserved,
      evidence: {
        rawRun,
        rawOrderPreserved,
        rawInterleaving,
        rawStreamCollapse: {
          observed: rawRun?.stderr.length === 0 &&
            relevant(rawRun?.stdout ?? [], 'j0-warn-on-stderr'),
          note: 'CheerpJ routes both Java streams through console.log',
        },
        capturedRun,
        capturedStdout: stdout,
        capturedStderr: stderr,
        channelsCorrect,
        capturedOrderPreserved,
        capturedInterleaving,
        note:
          'A same-invocation Java harness preserves stream identity and a single global byte sequence before CheerpJ collapses browser console output.',
      },
    },
  };
}

async function compileClass(id, className, source) {
  await materialize(id, className, source);
  const worker = createWorker();
  const compile = await call(worker, 'compile', { id, className, source }, 180_000);
  return { worker, compile };
}

async function firewallExperiment() {
  say('G5 · comparar Java sin y con hardenWorkerScope');
  const before = await (await fetch('/__j0_state')).json();

  const bareBuild = await compileClass('net-bare', 'NetProbe', JAVA.NetProbe);
  let bare = null;
  if (compileSucceeded(bareBuild.compile)) {
    bare = await call(
      bareBuild.worker,
      'firewall',
      { id: 'net-bare', mode: 'bare' },
      120_000
    );
  }
  bareBuild.worker.terminate();
  const afterBare = await (await fetch('/__j0_state')).json();

  const patchedBuild = await compileClass('net-patched', 'NetProbe', JAVA.NetProbe);
  let patched = null;
  if (compileSucceeded(patchedBuild.compile)) {
    patched = await call(
      patchedBuild.worker,
      'firewall',
      { id: 'net-patched', mode: 'patched' },
      120_000
    );
  }
  patchedBuild.worker.terminate();
  const afterPatched = await (await fetch('/__j0_state')).json();

  const bareHits = afterBare.privateHits - before.privateHits;
  const patchedHits = afterPatched.privateHits - afterBare.privateHits;
  const baselineCanReach = bareHits > 0 || Boolean(bare && relevant(bare.stdout, 'NET_GOT_HTTP_200'));
  const patchedCannotReach =
    patchedHits === 0 && Boolean(patched && relevant(patched.stdout, 'NET_BLOCKED'));
  const blockedRuntimeFetches = (patched?.stderr ?? [])
    .filter((line) => line.includes('[j0-firewall]') && line.includes('cjrtnc.leaningtech.com'));

  return {
    name: 'G5-firewall',
    // Exigimos control positivo: sin firewall Java llega; con firewall, no llega.
    ok:
      compileSucceeded(bareBuild.compile) &&
      compileSucceeded(patchedBuild.compile) &&
      baselineCanReach &&
      patchedCannotReach,
    evidence: {
      before,
      bareCompile: bareBuild.compile,
      bare,
      afterBare,
      bareHits,
      baselineCanReach,
      patchedCompile: patchedBuild.compile,
      patched,
      afterPatched,
      patchedHits,
      patchedCannotReach,
      blockedRuntimeFetches,
      runtimeAllowlistRequired: blockedRuntimeFetches.length > 0,
    },
  };
}

async function timeoutExperiment() {
  say('G4 · matar main infinito con Worker.terminate() y reiniciar');
  const id = 'endless';
  const build = await compileClass(id, 'Endless', JAVA.Endless);
  if (!compileSucceeded(build.compile)) {
    build.worker.terminate();
    return {
      name: 'G4-timeout',
      ok: false,
      evidence: { compile: build.compile, error: 'Endless.java no compiló' },
    };
  }
  build.worker.terminate();

  const worker = createWorker();
  let replied = false;
  let reply = null;
  const start = performance.now();
  const inFlight = call(worker, 'runEndless', { id, className: 'Endless' }, 45_000)
    .then((result) => { replied = true; reply = result; })
    .catch((error) => { reply = { rejected: String(error) }; });
  // Incluye boot + carga de la clase; suficientemente largo para entrar a main.
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const terminatedAfterMs = Math.round(performance.now() - start);
  worker.terminate();
  // No esperamos el timeout de `call`; la ausencia de respuesta tras terminate
  // es precisamente el contrato de Worker.terminate().
  await Promise.race([inFlight, new Promise((resolve) => setTimeout(resolve, 500))]);

  // Demostrar que se puede crear un runtime limpio tras matar el anterior.
  const reboot = createWorker();
  const rebootBoot = await call(reboot, 'boot', {}, 150_000);
  reboot.terminate();

  return {
    name: 'G4-timeout',
    ok: !replied && rebootBoot.kind === 'ok' && rebootBoot.booted === true,
    evidence: { compile: build.compile, terminatedAfterMs, replied, reply, rebootBoot },
  };
}

async function main() {
  const experiments = [];
  experiments.push(await bootExperiment());
  experiments.push(await javacProbeExperiment());

  const hello = await compileAndRunExperiment();
  experiments.push(hello.compile, hello.run);

  if (hello.compile.ok) {
    experiments.push(await firewallExperiment());
    experiments.push(await timeoutExperiment());
  } else {
    experiments.push({
      name: 'G5-firewall',
      ok: false,
      evidence: { skipped: 'no compilation capability' },
    });
    experiments.push({
      name: 'G4-timeout',
      ok: false,
      evidence: { skipped: 'no compilation capability' },
    });
  }

  report.experiments = experiments;
  window.__j0Report = report;
  say(`Terminado: ${experiments.filter((e) => e.ok).length}/${experiments.length} experimentos OK`);
}

main().catch((error) => {
  report.experiments.push({
    name: 'driver-fatal',
    ok: false,
    evidence: { error: String(error), stack: String(error?.stack) },
  });
  window.__j0Report = report;
  say(`FALLO FATAL: ${error}`);
});