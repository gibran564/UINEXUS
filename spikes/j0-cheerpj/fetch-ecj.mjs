#!/usr/bin/env node
/**
 * Descarga el compilador Eclipse (ECJ) a spikes/j0-cheerpj/assets/ecj.jar.
 *
 * ECJ es un único jar autosuficiente (sólo Java) y es la estrategia B de J0:
 * javac (`com.sun.tools.javac.Main`) vive en el módulo `jdk.compiler`, que un
 * JRE embarcado —y CheerpJ, previsiblemente— no incluye. ECJ 3.13.102 es la
 * última release anterior a Java 9; acepta el rt.jar de CheerpJ 8 como
 * `-bootclasspath` y se fija para que el spike sea reproducible.
 *
 * El jar se auto-aloja en el origen del spike (como Pyodide/webR en
 * producción): la licencia Community de CheerpJ prohíbe auto-alojar el RUNTIME,
 * pero ECJ es EPL y no tiene esa restricción.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'assets', 'ecj.jar');
const EXPECTED_SHA256 = 'e6b938338b7bb12388ca32ba8dfe91c6ab1c56bf5bd8dab6d6e6265fec3b9be3';

const candidates = [
  'https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.13.102/ecj-3.13.102.jar',
  'https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.13.102/ecj-3.13.102.jar',
];

let downloaded = false;
for (const url of candidates) {
  process.stdout.write(`Descargando ${url}\n`);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      process.stdout.write(`  -> HTTP ${res.status}\n`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== EXPECTED_SHA256) {
      process.stdout.write(`  -> SHA-256 inesperado: ${sha}\n`);
      continue;
    }
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, buf);
    process.stdout.write(`OK ${OUT} (${buf.length} bytes, sha256 ${sha})\n`);
    downloaded = true;
    break;
  } catch (err) {
    process.stdout.write(`  -> ${err.message}\n`);
  }
}
if (!downloaded) {
  process.stderr.write('No se pudo descargar ECJ. Revisa red o Maven Central.\n');
  process.exit(1);
}