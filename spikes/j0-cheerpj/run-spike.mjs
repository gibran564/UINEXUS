#!/usr/bin/env node
/**
 * Ejecuta J0 en Chromium y escribe report.json.
 *
 * Servidor deliberadamente aislado: sólo expone spikes/j0-cheerpj, permite al
 * driver materializar sus fuentes Java, y cuenta accesos a /api/private/hit.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.J0_PORT ?? 8787);
const REPORT = path.join(HERE, 'report.json');
const ASSETS = path.join(HERE, 'assets');
let privateHits = 0;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.java': 'text/x-java; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jar': 'application/java-archive',
};

function safeSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}
async function readBody(req, max = 256_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/__j0_state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ privateHits }));
    return;
  }
  if (url.pathname === '/api/private/hit') {
    privateHits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('PRIVATE_ENDPOINT_REACHED');
    return;
  }
  if (url.pathname === '/__j0_materialize' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!safeSegment(body.id) || !safeSegment(body.className) || typeof body.source !== 'string') {
        res.writeHead(400);
        res.end('invalid source envelope');
        return;
      }
      const dir = path.join(ASSETS, 'gen', body.id);
      const file = path.join(dir, `${body.className}.java`);
      await mkdir(dir, { recursive: true });
      await writeFile(file, body.source, 'utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: `/assets/gen/${body.id}/${body.className}.java` }));
    } catch (error) {
      res.writeHead(400);
      res.end(String(error));
    }
    return;
  }

  const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'host.html';
  const file = path.resolve(HERE, relative);
  if (!file.startsWith(HERE + path.sep) && file !== HERE) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const commonHeaders = {
      'accept-ranges': 'bytes',
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    };
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` });
        res.end();
        return;
      }
      const start = match[1] === '' ? 0 : Number(match[1]);
      const end = match[2] === '' ? info.size - 1 : Math.min(Number(match[2]), info.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...commonHeaders,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${info.size}`,
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...commonHeaders, 'content-length': info.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await mkdir(ASSETS, { recursive: true });
// Cada ejecución genera sus fuentes de prueba desde constantes del driver. No se
// conserva bytecode ni JARs de host: la compilación aceptada ocurre en CheerpJ.
await rm(path.join(ASSETS, 'gen'), { recursive: true, force: true });
try {
  await stat(path.join(ASSETS, 'ecj.jar'));
} catch {
  process.stderr.write('Falta assets/ecj.jar. Ejecuta: node spikes/j0-cheerpj/fetch-ecj.mjs\n');
  process.exit(2);
}

await new Promise((resolve, reject) => {
  http.once('error', reject);
  http.listen(PORT, '127.0.0.1', resolve);
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleLines = [];
  const pageErrors = [];
  page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`http://127.0.0.1:${PORT}/host.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__j0Report !== undefined, null, {
    timeout: 15 * 60 * 1000,
  });
  const report = await page.evaluate(() => window.__j0Report);
  report.server = { privateHits };
  report.browser = { consoleLines, pageErrors };
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const byName = Object.fromEntries(report.experiments.map((entry) => [entry.name, entry]));
  const expected = [
    'G1-boot',
    'G2a-javac-probe',
    'G2-compile',
    'G3-run-and-capture',
    'G4-timeout',
    'G5-firewall',
  ];
  const missing = expected.filter((name) => !byName[name]);
  const failed = expected.filter((name) => byName[name] && !byName[name].ok);
  if (missing.length || failed.length) {
    process.stderr.write(
      `J0 FAIL — missing=${missing.join(',') || 'none'}; failed=${failed.join(',') || 'none'}\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('J0 PASS — todos los objetivos tienen evidencia ejecutable.\n');
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => http.close(resolve));
}