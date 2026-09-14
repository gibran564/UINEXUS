#!/usr/bin/env node
/**
 * Publica el compilador de Java del navegador en `public/runtime/java/`.
 *
 * ## Qué se autoaloja y qué no
 *
 * ECJ —el compilador de Eclipse— SÍ. Es un único JAR de Java puro, licencia
 * EPL-2.0, y se sirve del propio origen como Pyodide y webR, con su SHA-256
 * verificado byte a byte antes de escribirlo.
 *
 * CheerpJ NO. La edición Community se sirve desde `cjrtnc.leaningtech.com` y
 * autoalojar el runtime requiere licencia comercial, así que este script no lo
 * descarga y `public/` no lo contiene. Es la única dependencia de terceros que
 * este proyecto carga desde un CDN ajeno, y está documentada como tal en
 * `docs/SECURITY.md`.
 *
 * ## Por qué no es un paquete de npm
 *
 * Hay envoltorios de ECJ en npm, pero ninguno oficial del proyecto Eclipse. Un
 * JAR con su SHA-256 fijado y dos réplicas de Maven Central es una dependencia
 * más pequeña y más verificable que un paquete intermedio que hay que auditar.
 *
 * Se ejecuta solo antes de `dev` y de `build`, y es idempotente: si el archivo ya
 * está y su huella coincide, no descarga nada.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Las constantes se leen del módulo de la cadena de herramientas.
 *
 * Es un `.ts` y este script es `.mjs`, así que se extraen del texto en vez de
 * importarlo: montar esbuild sólo para leer cuatro cadenas sería peor. Lo que
 * importa es que la versión y la huella vivan en UN sitio —
 * `src/lib/code-engines/java-toolchain.ts`— y que este script falle si dejan de
 * estar donde dice.
 */
export async function javaToolchain() {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'code-engines', 'java-toolchain.ts'),
    'utf8'
  );
  const read = (name) => {
    const match = new RegExp(`export const ${name} = '([^']+)'`).exec(source);
    if (!match) throw new Error(`No se encontró ${name} en java-toolchain.ts.`);
    return match[1];
  };
  return {
    cheerpj: read('CHEERPJ_VERSION'),
    version: read('ECJ_VERSION'),
    sha256: read('ECJ_SHA256'),
    license: read('ECJ_LICENSE'),
  };
}

export async function publishJavaToolchain() {
  const { cheerpj, version, sha256, license } = await javaToolchain();
  const name = `ecj-${version}.jar`;
  const target = path.join(root, 'public', 'runtime', 'java', name);
  /** Lo que se anota en el manifiesto, para poder verificar un despliegue. */
  const published = {
    engine: 'cheerpj',
    version: cheerpj,
    // CheerpJ Community Edition no se autoaloja: sale del CDN de Leaning
    // Technologies. Ver docs/SECURITY.md.
    hosted: 'cdn',
    java: 8,
    compiler: { engine: 'ecj', version, license, sha256, path: `/runtime/java/${name}` },
  };

  try {
    const existing = await readFile(target);
    if (createHash('sha256').update(existing).digest('hex') === sha256) {
      console.log(`Compilador de Java en public/runtime/java: ${name} sin cambios.`);
      return published;
    }
    console.log(`${name} no coincide con su SHA-256 esperado: se vuelve a descargar.`);
  } catch {
    // No estaba. Se descarga.
  }

  const urls = [
    `https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/${version}/${name}`,
    `https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/${version}/${name}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        console.log(`  ${url} -> HTTP ${response.status}`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== sha256) {
        // No se escribe NADA. Un JAR con otra huella es otro compilador, y da
        // igual si es más nuevo: la versión que se ejecuta es la que se fijó.
        console.log(`  ${url} -> SHA-256 inesperado ${digest}`);
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      console.log(
        `Compilador de Java publicado: ${name} (${bytes.length} bytes, sha256 verificado).`
      );
      return published;
    } catch (caught) {
      console.log(`  ${url} -> ${caught.message}`);
    }
  }

  throw new Error(
    `No se pudo publicar ${name} con el SHA-256 esperado. Java no se podrá ejecutar en el navegador; Python y R no se ven afectados.`
  );
}

/** Ejecutado directamente (`npm run runtimes:java`), un fallo es un fallo. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishJavaToolchain();
}
