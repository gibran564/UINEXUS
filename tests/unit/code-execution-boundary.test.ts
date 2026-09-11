import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Dónde NO se ejecuta el código del alumnado.
 *
 * Estas pruebas leen el código fuente. Es deliberado: la garantía que dan no es
 * «hoy no se llama a `exec`», es «nadie puede añadir esa llamada sin que la
 * suite se ponga roja». Un entorno académico es exactamente el sitio donde
 * alguien va a entregar un `system("cat /etc/passwd")` para ver qué pasa, y la
 * respuesta tiene que seguir siendo «nada» dentro de un año.
 *
 * El servidor de UINexus firma subidas a S3 y lee la base de datos. Ejecutar
 * ahí un programa que escribió otra persona no es un atajo: es regalar la
 * plataforma.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * Formas de arrancar un proceso.
 *
 * `exec(` a secas queda fuera a propósito: `/regex/.exec(texto)` es JavaScript
 * corriente y una prueba que se queje de eso acaba desactivada. Lo que no tiene
 * ninguna lectura inocente es importar `child_process` o llamar a sus funciones
 * por su nombre completo.
 */
const PROCESS_SPAWNERS = [
  'child_process',
  'execSync',
  'execFileSync',
  'spawnSync',
  'spawn(',
  'execFile(',
];

/** Intérpretes que alguien podría tener la tentación de invocar. */
const INTERPRETER_COMMANDS = ['Rscript', 'python3', 'subprocess'];

/**
 * El código, sin los comentarios.
 *
 * Sin esto la prueba castiga la documentación: explicar POR QUÉ no se llama a
 * `Rscript` la haría fallar, y el arreglo obvio —borrar la explicación— deja el
 * proyecto peor. Lo que se audita es lo que se ejecuta.
 *
 * El `//` de una URL se respeta comprobando que no venga precedido de `:`.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    })
  );
  return files.flat();
}

async function readAllSources(): Promise<{ file: string; text: string }[]> {
  const files = await sourceFiles(SRC);
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(SRC, file).replaceAll('\\', '/'),
      text: stripComments(await readFile(file, 'utf8')),
    }))
  );
}

describe('el servidor no ejecuta código de nadie', () => {
  it('no arranca procesos por ninguna vía', async () => {
    const sources = await readAllSources();

    const offenders = sources.flatMap(({ file, text }) =>
      PROCESS_SPAWNERS.filter((needle) => text.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );

    expect(offenders).toEqual([]);
  });

  it('no invoca Rscript, python3 ni subprocess', async () => {
    const sources = await readAllSources();

    const offenders = sources.flatMap(({ file, text }) =>
      INTERPRETER_COMMANDS.filter((needle) => text.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );

    expect(offenders).toEqual([]);
  });

  it('el adaptador de servidor no tiene por dónde recibir un comando', async () => {
    // `lib/code-runner.ts` habla con un sandbox EXTERNO que hoy no existe. Lo
    // que importa de su contrato es lo que NO admite: el cliente elige qué
    // código y en qué lenguaje, nunca qué comando.
    const text = stripComments(
      await readFile(new URL('../../src/lib/code-runner.ts', import.meta.url), 'utf8')
    );

    for (const needle of ['command', 'args', 'image', 'entrypoint']) {
      expect(text.includes(`${needle}:`), needle).toBe(false);
    }
  });
});

describe('los runtimes se sirven desde el propio origen', () => {
  it('nadie apunta a un CDN de Pyodide, webR o Monaco', async () => {
    // Un CDN de terceros obligaría a abrir `script-src` y `connect-src` de toda
    // la plataforma —la misma que firma las subidas a S3— y ataría una clase a
    // que ese dominio esté vivo esa mañana.
    const sources = await readAllSources();
    const cdns = ['cdn.jsdelivr.net', 'unpkg.com', 'webr.r-wasm.org', 'repo.r-wasm.org'];

    const offenders = sources.flatMap(({ file, text }) =>
      cdns.filter((host) => text.includes(host)).map((host) => `${file}: ${host}`)
    );

    expect(offenders).toEqual([]);
  });

  it('los Workers se cargan del propio origen, nunca de una URL absoluta ajena', async () => {
    const { CODE_WORKER_URLS } = await import('../../src/lib/code-engines/runtime-assets');

    // Rutas relativas a la raíz: con `worker-src 'self'` basta y no hay ningún
    // tercero que autorizar.
    for (const url of Object.values(CODE_WORKER_URLS)) {
      expect(url.startsWith('/runtime/workers/'), url).toBe(true);
    }

    const text = stripComments(
      await readFile(new URL('../../src/lib/browser-code-runner.ts', import.meta.url), 'utf8')
    );
    expect(text).not.toMatch(/new Worker\(\s*['"`]https?:/);
  });

  it('los Workers se piden como módulos: en uno clásico Pyodide no arranca', async () => {
    // Un Worker clásico no tiene `import()` dinámico, que es como Pyodide y
    // webR cargan su WebAssembly. Pyodide lo detecta y falla en el arranque, así
    // que perder este `type` rompe la ejecución entera.
    const text = stripComments(
      await readFile(new URL('../../src/lib/browser-code-runner.ts', import.meta.url), 'utf8')
    );

    expect(text).toMatch(/type:\s*'module'/);
  });
});

describe('los Workers no reciben nada de la sesión', () => {
  it('ni el protocolo ni los Workers nombran credenciales', async () => {
    const files = [
      '../../src/lib/browser-code-runner.ts',
      '../../src/lib/browser-code-runner-protocol.ts',
      '../../src/lib/code-engines/worker-bridge.ts',
      '../../src/workers/python-runner.worker.ts',
      '../../src/workers/r-runner.worker.ts',
    ];

    // La garantía real es el tipo cerrado de `CodeWorkerRequest` y
    // `sanitizeWorkerRun` (ver code-runner-contract.test.ts). Esto es la red de
    // seguridad: que nadie meta un `idToken` por el camino sin notarlo.
    const forbidden = [
      'idToken',
      'getIdToken',
      'document.cookie',
      'firebase',
      'AWS_',
      'accessKey',
      'process.env',
      'localStorage',
    ];

    for (const relative of files) {
      const text = stripComments(await readFile(new URL(relative, import.meta.url), 'utf8'));
      for (const needle of forbidden) {
        expect(text.includes(needle), `${relative}: ${needle}`).toBe(false);
      }
    }
  });
});
