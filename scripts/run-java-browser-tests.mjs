#!/usr/bin/env node
/**
 * Ejecuta las pruebas del runtime de Java en Chromium de verdad.
 *
 * ## Por qué tiene su propio ejecutor y no entra en `tests/e2e`
 *
 * `playwright.config.ts` levanta `npm run dev:local`: DynamoDB Local, el emulador
 * de Firebase, la siembra del aula y Next compilando bajo demanda. Nada de eso
 * hace falta para comprobar si CheerpJ compila una clase, y pagarlo convertiría
 * una prueba de cinco minutos en una de veinte. Lo que Java necesita del servidor
 * es exactamente tres cosas:
 *
 *   1. `public/runtime/` servido tal cual, con soporte de rangos HTTP —CheerpJ lee
 *      el JAR de ECJ por trozos—;
 *   2. una página y un Worker en el MISMO origen;
 *   3. un endpoint privado que cuente visitas, para poder demostrar que Java no
 *      llega a él.
 *
 * Un servidor de cincuenta líneas da las tres. Y el aislamiento es una ventaja:
 * si esta suite falla, el fallo es de Java y no del aula sembrada.
 *
 * Usa el Chromium de Playwright, que ya es una dependencia del proyecto. Firefox y
 * Safari quedan para la fase de matriz de navegadores; está anotado en
 * `docs/LIMITATIONS.md`.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.UINEXUS_JAVA_TEST_PORT ?? 8793);
const origin = `http://127.0.0.1:${port}`;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.jar': 'application/java-archive',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
};

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Java runtime · pruebas de navegador</title>
<h1>Java runtime</h1>
<pre id="log"></pre>
<script src="/__driver.js"></script>
`;

let privateHits = 0;
/** Los hitos que marca el guion, para poder ordenarlos con las peticiones. */
const marks = [];

/** El guion de las pruebas, empaquetado con el alias `@/` del proyecto. */
async function bundleDriver(outDir) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'tests', 'browser', 'java-runtime', 'driver.ts')],
    outfile: path.join(outDir, 'driver.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    logLevel: 'silent',
    tsconfigRaw: { compilerOptions: { target: 'es2022', useDefineForClassFields: true } },
    alias: { '@': path.join(root, 'src') },
  });
  if (result.errors.length > 0) {
    throw new Error(`No se pudo empaquetar el guion:\n${JSON.stringify(result.errors)}`);
  }
  return path.join(outDir, 'driver.js');
}

function serveFile(req, res, file) {
  return stat(file).then((info) => {
    if (!info.isFile()) throw new Error('no es un archivo');
    const headers = {
      'accept-ranges': 'bytes',
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] === '' ? 0 : Number(range[1]);
      const end = range[2] === '' ? info.size - 1 : Math.min(Number(range[2]), info.size - 1);
      if (!Number.isSafeInteger(start) || start > end || start >= info.size) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${info.size}`,
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': info.size });
    createReadStream(file).pipe(res);
  });
}

const CHEERPJ_PINNED_PREFIX = 'https://cjrtnc.leaningtech.com/4.3/';

/**
 * Lo que sólo se puede comprobar viendo la red del navegador entera.
 *
 * Tres cosas, y ninguna se puede observar desde la propia página:
 *
 *  1. que construir el ejecutor NO descargue CheerpJ —la carga es perezosa—;
 *  2. que la ejecución sí lo descargue, o la comprobación anterior no valdría
 *     nada;
 *  3. que no se cuele ningún origen de terceros que no esté en la lista blanca.
 */
function networkChecks(requests) {
  const boundary = marks.find((mark) => mark.name === 'before-first-run');
  const cheerpj = requests.filter((request) => request.url.startsWith(CHEERPJ_PINNED_PREFIX));
  const early = boundary
    ? cheerpj.filter((request) => request.at < boundary.at)
    : cheerpj;

  const thirdParty = [
    ...new Set(
      requests
        .map((request) => new URL(request.url).origin)
        .filter((host) => host !== origin && host !== 'https://cjrtnc.leaningtech.com')
    ),
  ];

  return [
    {
      name: 'lazy-boot-no-cdn-before-first-run',
      ok: boundary !== undefined && early.length === 0,
      detail: { boundary, earlyRequests: early.map((request) => request.url).slice(0, 5) },
    },
    {
      name: 'cheerpj-cdn-actually-used',
      ok: cheerpj.length > 0,
      detail: { requests: cheerpj.length, sample: cheerpj.slice(0, 3).map((r) => r.url) },
    },
    {
      name: 'no-unexpected-origins',
      ok: thirdParty.length === 0,
      detail: { thirdParty },
    },
  ];
}

async function main() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'uinexus-java-'));
  const driver = await bundleDriver(scratch);

  try {
    await stat(path.join(publicDir, 'runtime', 'workers', 'java-runner.worker.js'));
  } catch {
    throw new Error('Falta el Worker de Java. Ejecuta: npm run runtimes');
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      return;
    }
    if (url.pathname === '/__driver.js') {
      void serveFile(req, res, driver).catch(() => res.writeHead(500).end('driver'));
      return;
    }
    if (url.pathname.startsWith('/__mark/')) {
      marks.push({ name: url.pathname.slice('/__mark/'.length), at: Date.now() });
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (url.pathname === '/__private_hits') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ hits: privateHits })
      );
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      // El control positivo de la prueba de firewall. Si Java llega aquí, el
      // contador lo dice y la prueba falla.
      privateHits += 1;
      res.writeHead(200, { 'content-type': 'text/plain' }).end('PRIVATE_ENDPOINT_REACHED');
      return;
    }

    const file = path.resolve(publicDir, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    if (!file.startsWith(publicDir + path.sep)) {
      res.writeHead(403).end('prohibido');
      return;
    }
    void serveFile(req, res, file).catch(() => res.writeHead(404).end('no encontrado'));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  let browser;
  let report = null;
  const consoleLines = [];
  const pageErrors = [];
  /**
   * Las peticiones de red, INCLUIDAS las del Worker.
   *
   * `performance.getEntriesByType('resource')` de la página no ve lo que pide un
   * Worker, así que el arranque perezoso y el uso del CDN de CheerpJ no se pueden
   * comprobar desde el guion. Playwright sí las ve todas.
   */
  const requests = [];

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('request', (request) => requests.push({ url: request.url(), at: Date.now() }));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      consoleLines.push(line);
      if (process.env.UINEXUS_JAVA_TEST_VERBOSE) process.stdout.write(`${line}\n`);
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__javaReport !== undefined, null, {
      timeout: 20 * 60 * 1000,
    });
    report = await page.evaluate(() => window.__javaReport);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }

  const checks = [...(report?.checks ?? []), ...networkChecks(requests)];
  const output = {
    generatedAt: new Date().toISOString(),
    privateHits,
    marks,
    checks,
    pageErrors,
    consoleLines: consoleLines.slice(-400),
  };
  const reportPath = path.join(root, 'tests', 'browser', 'java-runtime', 'report.json');
  await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const failed = output.checks.filter((check) => !check.ok);
  for (const check of output.checks) {
    process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}\n`);
  }
  process.stdout.write(
    `\n${output.checks.length - failed.length}/${output.checks.length} comprobaciones; informe en ${path.relative(root, reportPath)}\n`
  );

  if (output.checks.length === 0 || failed.length > 0) {
    for (const check of failed) {
      process.stderr.write(`\nFAIL ${check.name}\n${JSON.stringify(check.detail, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

await main();
