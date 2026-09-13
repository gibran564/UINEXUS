/**
 * Worker del spike J0 — CheerpJ 4.3 dentro de un Web Worker clásico.
 *
 * API pública usada (contrastada con https://cheerpj.com/docs/reference):
 *   cheerpjInit({ version })
 *   cheerpjRunMain(className, classPath, ...args) -> Promise<number>
 *   cjFileBlob(path) -> Promise<Blob> (sólo lectura desde JS)
 *
 * /app  = raíz HTTP del origen, sólo lectura
 * /str  = efímero, JS escribe y Java lee
 * /files = persistente, Java lee/escribe
 *
 * Este archivo pertenece sólo al spike. No importa código de producción.
 */

const CJ = 'https://cjrtnc.leaningtech.com/4.3';
const capture = { events: [] };
let eventBound = 0;
let sequence = 0;

// Captura ANTES de cargar CheerpJ. Conserva un orden total entre stdout/stderr.
const realLog = console.log.bind(console);
const realError = console.error.bind(console);
console.log = (...args) => {
  capture.events.push({ seq: ++sequence, channel: 'stdout', text: formatConsole(args) });
  realLog(...args);
};
console.error = (...args) => {
  capture.events.push({ seq: ++sequence, channel: 'stderr', text: formatConsole(args) });
  realError(...args);
};

function formatConsole(args) {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(' ');
}
function beginCapture() {
  eventBound = capture.events.length;
}
function endCapture() {
  const events = capture.events.slice(eventBound);
  return {
    events,
    stdout: events.filter((e) => e.channel === 'stdout').map((e) => e.text),
    stderr: events.filter((e) => e.channel === 'stderr').map((e) => e.text),
  };
}
function decodeCaptureLedger(encoded) {
  const decoder = new TextDecoder('utf-8');
  const decoded = [];
  let current = null;
  for (const token of encoded.split(';')) {
    if (token === '') continue;
    const match = /^(\d+):([OE]):([0-9a-f]{2})$/.exec(token);
    if (!match) throw new Error(`ledger Java inválido: ${token.slice(0, 80)}`);
    const sequence = Number(match[1]);
    const channel = match[2] === 'O' ? 'stdout' : 'stderr';
    if (!current || current.channel !== channel) {
      current = { seq: sequence, channel, bytes: [] };
      decoded.push(current);
    }
    current.bytes.push(Number.parseInt(match[3], 16));
  }
  return decoded.map(({ seq, channel, bytes }) => ({
    seq,
    channel,
    text: decoder.decode(Uint8Array.from(bytes)),
  }));
}
function post(payload) {
  self.postMessage(payload);
}

let bootPromise;
let bootMs = -1;

function apiSurface() {
  const names = [
    'cheerpjInit',
    'cheerpjRunMain',
    'cheerpjRunJar',
    'cheerpjRunLibrary',
    'cjFileBlob',
    'cjGetRuntimeResources',
  ];
  return Object.fromEntries(names.map((name) => [name, typeof self[name]]));
}

async function bootCheerpJ() {
  if (!bootPromise) {
    bootPromise = (async () => {
      const t0 = performance.now();
      // loader.js es clásico; desde el Worker de módulo se carga con importScripts.
      // NO definir self.cj3LoaderPath: loader.js envuelve toda su definición en
      // `if (!self.cj3LoaderPath)`, de modo que predefinirlo anula el loader.
      self.importScripts(`${CJ}/loader.js`);
      if (typeof self.cheerpjInit !== 'function') {
        throw new Error('loader.js no expuso cheerpjInit en el Worker');
      }
      // Java 8 evita JRT modular: el JRE CheerpJ 8 expone rt.jar en
      // /lt/8/jre/lib/rt.jar, utilizable como bootclasspath explícito por ECJ.
      await self.cheerpjInit({ version: 8 });
      bootMs = Math.round(performance.now() - t0);
      return { booted: true, bootMs, api: apiSurface() };
    })();
  }
  try {
    return await bootPromise;
  } catch (error) {
    bootPromise = undefined;
    return { booted: false, bootMs, api: apiSurface(), error: String(error), stack: String(error?.stack) };
  }
}

function sourcePath(id, className) {
  // El host materializa la fuente en assets/gen/<id>/<Class>.java ANTES de
  // iniciar la compilación. /app mapea esa raíz HTTP en la VFS de CheerpJ.
  return `/app/assets/gen/${id}/${className}.java`;
}
function sourcePaths(id, classNames) {
  return classNames.map((className) => sourcePath(id, className));
}
function outputDir(id) {
  return `/files/j0/${id}/classes`;
}
function classPathFor(id) {
  return outputDir(id);
}

self.onmessage = async (event) => {
  const message = event.data;
  beginCapture();
  try {
    const payload = await dispatch(message.op, message.args ?? {});
    post({ requestId: message.requestId, kind: 'ok', ...payload, ...endCapture() });
  } catch (error) {
    post({
      requestId: message.requestId,
      kind: 'error',
      error: String(error),
      stack: String(error?.stack),
      ...endCapture(),
    });
  }
};

async function dispatch(op, args) {
  switch (op) {
    case 'boot': {
      return { step: 'boot', ...(await bootCheerpJ()) };
    }

    case 'probeJavac': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      let exitCode = null;
      let thrown = null;
      try {
        // classPath vacío es válido para clases del runtime si estuvieran presentes.
        exitCode = await self.cheerpjRunMain('com.sun.tools.javac.Main', '', '-version');
      } catch (error) {
        thrown = String(error);
      }
      return {
        step: 'probeJavac',
        javacPresent: thrown === null && exitCode === 0,
        exitCode,
        thrown,
      };
    }

    case 'compile': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      const classNames = args.classNames ?? [args.className];
      const sources = sourcePaths(args.id, classNames);
      const out = outputDir(args.id);
      const compilerCp = '/app/assets/ecj.jar';
      const compilerArgs = [
        '-proc:none',
        '-nowarn',
        '-source', '8',
        '-target', '8',
        '-encoding', 'UTF-8',
        '-bootclasspath', '/lt/8/jre/lib/rt.jar',
        '-d', out,
        ...(args.compilerArgs ?? []),
        ...sources,
      ];
      const t0 = performance.now();
      let exitCode = null;
      let thrown = null;
      try {
        exitCode = await self.cheerpjRunMain(
          'org.eclipse.jdt.internal.compiler.batch.Main',
          compilerCp,
          ...compilerArgs
        );
      } catch (error) {
        thrown = String(error);
      }
      return {
        step: 'compile',
        id: args.id,
        classNames,
        sourcePaths: sources,
        outputDir: out,
        compilerCp,
        compilerArgs,
        exitCode,
        thrown,
        compileMs: Math.round(performance.now() - t0),
      };
    }

    case 'run': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      const cp = classPathFor(args.id);
      const t0 = performance.now();
      let exitCode = null;
      let thrown = null;
      try {
        exitCode = await self.cheerpjRunMain(args.className, cp, ...(args.programArgs ?? []));
      } catch (error) {
        thrown = String(error);
      }
      return {
        step: 'run',
        id: args.id,
        className: args.className,
        classPath: cp,
        exitCode,
        thrown,
        runMs: Math.round(performance.now() - t0),
      };
    }

    case 'runCaptured': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      const cp = classPathFor(args.id);
      const t0 = performance.now();
      const captureStart = capture.events.length;
      let exitCode = null;
      let thrown = null;
      try {
        // CaptureHarness sustituye los dos PrintStreams y llama por reflexión al
        // main real dentro de ESTA misma ejecución Java. Al final emite un ledger
        // byte a byte con canal y secuencia global, antes de que CheerpJ lo
        // entregue por el canal console.log colapsado.
        exitCode = await self.cheerpjRunMain(
          'CaptureHarness',
          cp,
          args.className,
          ...(args.programArgs ?? [])
        );
      } catch (error) {
        thrown = String(error);
      }
      const consoleEvents = capture.events.slice(captureStart);
      const ledgerLine = consoleEvents
        .map((event) => event.text)
        .find((text) => text.startsWith('__J0_CAPTURE_V1__'));
      const capturedEvents = ledgerLine
        ? decodeCaptureLedger(ledgerLine.slice('__J0_CAPTURE_V1__'.length))
        : [];
      return {
        step: 'runCaptured',
        id: args.id,
        className: args.className,
        classPath: cp,
        exitCode,
        thrown,
        ledgerFound: Boolean(ledgerLine),
        ledgerBytes: ledgerLine?.length ?? 0,
        capturedEvents,
        runMs: Math.round(performance.now() - t0),
      };
    }

    case 'runEndless': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      // Esta Promise no debe resolver. El host aplica el timeout y llama a
      // Worker.terminate(), exactamente como BrowserCodeRunner.destroyWorker().
      const exitCode = await self.cheerpjRunMain(args.className, classPathFor(args.id));
      return { step: 'runEndless', unexpectedReturn: true, exitCode };
    }

    case 'firewall': {
      const boot = await bootCheerpJ();
      if (!boot.booted) throw new Error(boot.error);
      if (args.mode === 'patched') hardenWorkerScope();
      let exitCode = null;
      let thrown = null;
      try {
        exitCode = await self.cheerpjRunMain(
          'NetProbe',
          classPathFor(args.id),
          '/api/private/hit'
        );
      } catch (error) {
        thrown = String(error);
      }
      return { step: 'firewall', id: args.id, mode: args.mode, exitCode, thrown };
    }

    default:
      throw new Error(`operación desconocida: ${op}`);
  }
}

// Réplica intencionadamente literal de la política relevante de
// src/lib/code-engines/worker-bridge.ts: mismo origen + prefijo /runtime.
// Se aplica DESPUÉS de prepare()/cheerpjInit(), igual que en producción.
let hardened = false;
function hardenWorkerScope() {
  if (hardened) return;
  hardened = true;
  const allowed = new URL('/runtime/', self.location.href);
  const isRuntimeAsset = (input) => {
    try {
      const raw = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input?.url;
      const url = new URL(raw, self.location.href);
      return url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname);
    } catch {
      return false;
    }
  };

  const nativeFetch = self.fetch.bind(self);
  self.fetch = (input, init) => {
    if (!isRuntimeAsset(input)) {
      const raw = typeof input === 'string' ? input : input?.url;
      return Promise.reject(new Error(`[j0-firewall] fetch bloqueado: ${raw}`));
    }
    return nativeFetch(input, init);
  };

  const NativeXHR = self.XMLHttpRequest;
  self.XMLHttpRequest = function (...ctorArgs) {
    const xhr = new NativeXHR(...ctorArgs);
    const nativeOpen = xhr.open.bind(xhr);
    xhr.open = (method, url, ...rest) => {
      if (!isRuntimeAsset(url)) {
        throw new Error(`[j0-firewall] XHR bloqueado: ${url}`);
      }
      return nativeOpen(method, url, ...rest);
    };
    return xhr;
  };

  self.WebSocket = function () {
    throw new Error('[j0-firewall] WebSocket bloqueado');
  };
  self.EventSource = function () {
    throw new Error('[j0-firewall] EventSource bloqueado');
  };
  self.importScripts = (...urls) => {
    throw new Error(`[j0-firewall] importScripts bloqueado: ${urls.join(', ')}`);
  };
}