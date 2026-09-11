import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Publica en `public/runtime/pyodide/` las ruedas de Python que UINexus permite.
 *
 * ## El problema que resuelve
 *
 * El paquete npm `pyodide` trae el intérprete y la biblioteca estándar, pero NO
 * las ruedas de numpy, pandas ni matplotlib: sólo el `pyodide-lock.json` que las
 * describe. En tiempo de ejecución, `loadPackage("pandas")` las pide a
 * `indexURL`, que en UINexus es `/runtime/pyodide/` del propio origen. Sin este
 * paso, esa petición es un 404 y `import pandas` falla.
 *
 * ## Por qué NO es «acceso a la red»
 *
 * La descarga ocurre aquí, al preparar el despliegue, y nunca en el navegador de
 * nadie. En ejecución, el Worker sigue con `fetch` inutilizado tras el arranque y
 * la CSP sigue en `'self'`: las ruedas se sirven desde el mismo origen que el
 * resto del runtime.
 *
 * ## La integridad NO la da la CDN
 *
 * Cada rueda se verifica contra el `sha256` que trae el `pyodide-lock.json` del
 * paquete instalado, que a su vez está fijado por `package-lock.json`. Si la CDN
 * devolviera un archivo distinto —comprometida, envenenada o simplemente
 * equivocada— el hash no cuadra y el script falla. Lo que se confía es el
 * lockfile del repositorio, no el servidor del que se descarga.
 *
 * ## Es opcional a propósito
 *
 * No lo llama `prebuild`. Un `npm run build` sin red tiene que seguir
 * funcionando, y una compilación que dependa de que una CDN esté viva es una
 * compilación que falla los días malos. Sin ruedas, UINexus funciona igual y
 * `import pandas` da un error explicado. Ver docs/NEXBOOK.md.
 *
 *   npm run runtimes:python
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public', 'runtime', 'pyodide');

/**
 * Lo que se publica, por nombre de paquete.
 *
 * Tiene que coincidir con `PYTHON_PACKAGE_ALLOWLIST` en
 * `src/lib/code-engines/python-packages.ts`: aquélla dice qué se PUEDE importar
 * y ésta qué está PUBLICADO. Las dependencias las resuelve el propio lockfile,
 * así que aquí sólo van los nombres de primer nivel.
 */
const ALLOWED = ['numpy', 'pandas', 'matplotlib'];

async function resolvePyodideDir() {
  const entry = fileURLToPath(await import.meta.resolve('pyodide'));
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    try {
      await fs.access(path.join(dir, 'pyodide-lock.json'));
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('No se encontró pyodide-lock.json en el paquete pyodide.');
}

/** El cierre transitivo de dependencias, según el propio lockfile. */
function closureOf(packages, names) {
  const byLowerName = new Map(Object.keys(packages).map((key) => [key.toLowerCase(), key]));
  const seen = new Set();
  const pending = [...names];

  while (pending.length > 0) {
    const wanted = pending.pop();
    const key = byLowerName.get(String(wanted).toLowerCase());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const dependency of packages[key].depends ?? []) pending.push(dependency);
  }

  return [...seen].map((key) => packages[key]);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function alreadyPublished(file, expected) {
  try {
    return sha256(await fs.readFile(file)) === expected;
  } catch {
    return false;
  }
}

async function main() {
  const pyodideDir = await resolvePyodideDir();
  const lock = JSON.parse(await fs.readFile(path.join(pyodideDir, 'pyodide-lock.json'), 'utf8'));
  const version = JSON.parse(
    await fs.readFile(path.join(pyodideDir, 'package.json'), 'utf8')
  ).version;

  const wheels = closureOf(lock.packages ?? {}, ALLOWED);
  if (wheels.length === 0) throw new Error('El lockfile de Pyodide no describe esos paquetes.');

  const base = process.env.UINEXUS_PYODIDE_CDN ?? `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
  await fs.mkdir(target, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;

  for (const wheel of wheels) {
    const file = path.join(target, wheel.file_name);
    bytes += 0;

    if (await alreadyPublished(file, wheel.sha256)) {
      skipped += 1;
      continue;
    }

    const response = await fetch(new URL(wheel.file_name, base));
    if (!response.ok) {
      throw new Error(`No se pudo descargar ${wheel.file_name}: HTTP ${response.status}.`);
    }

    const content = Buffer.from(await response.arrayBuffer());
    const digest = sha256(content);
    if (digest !== wheel.sha256) {
      /**
       * Aquí se para en seco, y no se avisa y se sigue.
       *
       * Una rueda cuyo hash no cuadra es código Python que se va a ejecutar en
       * el navegador de quien use la plataforma. Publicarla «porque casi
       * seguro que está bien» es exactamente la decisión que convierte una CDN
       * comprometida en un problema de UINexus.
       */
      throw new Error(
        `${wheel.file_name} no coincide con el hash del lockfile.\n` +
          `  esperado: ${wheel.sha256}\n  recibido: ${digest}`
      );
    }

    await fs.writeFile(file, content);
    downloaded += 1;
    bytes += content.byteLength;
  }

  /**
   * El `pyodide-lock.json` publicado NO se escribe aquí.
   *
   * Lo genera `copy-code-runtimes.mjs`, recortándolo a las ruedas que de verdad
   * están en el directorio. Un solo escritor evita la carrera obvia: si los dos
   * scripts escribieran ese archivo, ejecutarlos en el orden «equivocado»
   * dejaría publicado un lockfile que promete paquetes inexistentes, y el
   * síntoma sería un 404 en mitad de un `import`.
   */
  console.log(
    `Ruedas de Python en public/runtime/pyodide: ${wheels.length} ` +
      `(${downloaded} descargadas, ${skipped} ya estaban, ${(bytes / 1024 / 1024).toFixed(1)} MB nuevos).\n` +
      'Ejecuta `npm run runtimes` para publicar el lockfile con estos paquetes.'
  );
}

await main();
