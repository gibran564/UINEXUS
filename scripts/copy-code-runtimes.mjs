import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Copia los runtimes de Python y R desde `node_modules` a `public/runtime`.
 *
 * ## Por qué existe este paso
 *
 * Pyodide y webR se sirven desde el propio origen (ver
 * `src/lib/code-engines/runtime-assets.ts`). Eso deja la CSP en `'self'` y
 * quita de en medio dos dominios de terceros, pero los archivos tienen que
 * llegar a `public/` de alguna forma.
 *
 * Copiarlos aquí, y no comprometerlos, es deliberado: son ~60 MB de
 * WebAssembly que cambian sólo cuando cambia `package.json`. Meterlos en el
 * historial de git haría el repositorio inmanejable a cambio de nada, porque la
 * fuente de verdad ya está fijada por el `package-lock.json`.
 *
 * Se ejecuta solo antes de `dev` y de `build`. Es idempotente: si el destino ya
 * tiene el mismo archivo, no lo vuelve a escribir.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public', 'runtime');

/**
 * Sólo lo que Pyodide pide en tiempo de ejecución desde su `indexURL`.
 *
 * `pyodide-lock.json` NO está en la lista: no se copia, se GENERA recortado a
 * las ruedas que de verdad estén publicadas. Ver `writePyodideLock`.
 */
const PYODIDE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
];

/**
 * Publica el lockfile de Pyodide recortado a las ruedas presentes.
 *
 * Pyodide lee este archivo desde `indexURL` para saber qué puede cargar. Copiar
 * el original haría que `loadPackage` aceptara cualquiera de sus 356 paquetes y
 * fallara con un 404 confuso al buscar una rueda que nadie publicó. Recortarlo
 * convierte la lista blanca del código en una lista blanca que el runtime
 * entiende: lo que no está en el directorio no existe.
 *
 * Las ruedas las trae `scripts/vendor-python-packages.mjs`, que es opcional. Sin
 * él, el lockfile publicado no ofrece ningún paquete y `import pandas` falla con
 * un error claro, que es justo lo que debe pasar.
 */
async function writePyodideLock(pyodideDir, destination) {
  const original = JSON.parse(
    await fs.readFile(path.join(pyodideDir, 'pyodide-lock.json'), 'utf8')
  );

  const present = new Set(
    (await fs.readdir(destination).catch(() => [])).filter((name) => name.endsWith('.whl'))
  );

  const packages = Object.fromEntries(
    Object.entries(original.packages ?? {}).filter(([, entry]) => present.has(entry.file_name))
  );

  await fs.writeFile(
    path.join(destination, 'pyodide-lock.json'),
    `${JSON.stringify({ ...original, packages })}
`,
    'utf8'
  );

  return Object.keys(packages).length;
}

/**
 * De webR se copia el `dist` entero menos lo que no se sirve nunca.
 *
 * La lista es de EXCLUSIÓN a propósito: webR resuelve su sistema de archivos
 * virtual (`vfs/`) por rutas que no están declaradas en ningún índice, y una
 * lista de inclusión se rompería en silencio —con R arrancando a medias— en
 * cuanto webR reorganizara un directorio.
 */
const WEBR_SKIP_DIRS = new Set(['repl', 'tests', 'webR']);
const WEBR_SKIP_EXTENSIONS = ['.d.ts', '.map'];

async function copyIfChanged(from, to) {
  const source = await fs.stat(from);
  try {
    const existing = await fs.stat(to);
    if (existing.size === source.size && existing.mtimeMs >= source.mtimeMs) return false;
  } catch {
    // No estaba. Se copia.
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return true;
}

async function copyTree(from, to, filter) {
  let copied = 0;
  const entries = await fs.readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);

    if (entry.isDirectory()) {
      if (!filter.directory(entry.name)) continue;
      copied += await copyTree(source, destination, filter);
      continue;
    }
    if (!entry.isFile() || !filter.file(entry.name)) continue;
    if (await copyIfChanged(source, destination)) copied += 1;
  }

  return copied;
}

/**
 * La raíz de un paquete instalado.
 *
 * No se resuelve `<paquete>/package.json` porque no todo paquete lo exporta
 * —webr no lo hace— y fallar por eso sería fallar por un detalle de su mapa de
 * exports. Se resuelve su entrada real y se sube hasta el `package.json` que la
 * declara.
 */
async function resolvePackageDir(specifier) {
  const entry = fileURLToPath(await import.meta.resolve(specifier));
  let dir = path.dirname(entry);

  while (dir !== path.dirname(dir)) {
    try {
      await fs.access(path.join(dir, 'package.json'));
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error(`No se encontró la raíz del paquete ${specifier}.`);
}

/**
 * Compila los Workers de ejecución a módulos ESM independientes.
 *
 * ## Por qué NO los empaqueta Next
 *
 * Se intentó primero: `new Worker(new URL('./x.worker.ts', import.meta.url),
 * { type: 'module' })`. Webpack lo acepta, emite el chunk… y lo carga como
 * Worker CLÁSICO, porque emitir Workers de tipo módulo exige `output.module`
 * en toda la compilación y Next no lo permite. Pyodide detecta ese caso y se
 * niega a arrancar con un «Classic web workers are not supported» —tiene razón:
 * en un Worker clásico no hay `import()` dinámico, que es justo como se cargan
 * su WebAssembly y el de webR—.
 *
 * Compilarlos aquí resuelve eso de raíz y de paso quita ~60 MB del grafo de
 * webpack: los Workers salen ESM de verdad, del propio origen, y cargan sus
 * runtimes desde `/runtime/` en tiempo de ejecución.
 *
 * El precio, y conviene saberlo: editar `src/workers/**` o `src/lib/code-engines/**`
 * NO se recarga solo en `next dev`. Hay que volver a ejecutar `npm run runtimes`.
 */
async function buildWorkers(sourceDir, outDir) {
  const entries = ['python-runner.worker.ts', 'r-runner.worker.ts'].map((name) =>
    path.join(sourceDir, name)
  );

  const result = await esbuild.build({
    entryPoints: entries,
    outdir: outDir,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    // Los runtimes se cargan por URL en tiempo de ejecución (ver
    // `code-engines/*-engine.ts`); empaquetarlos aquí sería duplicarlos.
    external: ['pyodide', 'webr'],
    minify: true,
    sourcemap: false,
    logLevel: 'silent',
    entryNames: '[name]',
    tsconfigRaw: { compilerOptions: { target: 'es2022', useDefineForClassFields: true } },
    // `@/…` es el alias del proyecto; esbuild no lee `tsconfig.paths` aquí.
    alias: { '@': path.join(sourceDir, '..') },
  });

  if (result.errors.length > 0) {
    throw new Error(`No se pudieron compilar los Workers:\n${JSON.stringify(result.errors)}`);
  }
  return entries.length;
}

/**
 * Una huella del contenido copiado, para poder verificar despliegues.
 *
 * No es seguridad —quien pueda escribir en `public/` puede escribir también
 * este archivo—, es diagnóstico: dice qué versión de cada runtime está
 * realmente publicada sin tener que descargar 60 MB para comprobarlo.
 */
async function writeManifest(entries) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    runtimes: entries,
  };
  await fs.writeFile(
    path.join(target, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function versionOf(dir) {
  const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.version ?? 'desconocida';
}

async function main() {
  const pyodideDir = await resolvePackageDir('pyodide');
  const webrDir = path.join(await resolvePackageDir('webr'), 'dist');

  let copied = 0;

  for (const name of PYODIDE_FILES) {
    const from = path.join(pyodideDir, name);
    try {
      if (await copyIfChanged(from, path.join(target, 'pyodide', name))) copied += 1;
    } catch (caught) {
      throw new Error(
        `Falta ${name} en el paquete pyodide. ¿Cambió su contenido al actualizar? (${caught.message})`
      );
    }
  }

  const pythonPackages = await writePyodideLock(pyodideDir, path.join(target, 'pyodide'));

  copied += await copyTree(webrDir, path.join(target, 'webr'), {
    directory: (name) => !WEBR_SKIP_DIRS.has(name),
    file: (name) => !WEBR_SKIP_EXTENSIONS.some((extension) => name.endsWith(extension)),
  });

  // Los Workers se recompilan siempre: son pequeños y detectar si su código
  // fuente cambió costaría más que rehacerlos.
  const workers = await buildWorkers(path.join(root, 'src', 'workers'), path.join(target, 'workers'));

  await writeManifest({
    python: { engine: 'pyodide', version: await versionOf(pyodideDir), path: '/runtime/pyodide/' },
    r: { engine: 'webr', version: await versionOf(path.dirname(webrDir)), path: '/runtime/webr/' },
  });

  console.log(
    `Runtimes de código en public/runtime: ${
      copied === 0 ? 'assets sin cambios' : `${copied} assets actualizados`
    }, ${workers} Workers compilados, ${
      pythonPackages === 0
        ? 'sin paquetes de Python (ejecuta `npm run runtimes:python` para numpy, pandas y matplotlib)'
        : `${pythonPackages} paquetes de Python publicados`
    }.`
  );
}

await main();
