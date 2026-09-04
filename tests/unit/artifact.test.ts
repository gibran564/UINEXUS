import { afterEach, assert, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ChecksumMismatchError,
  parseSha256Sidecar,
  sha256File,
  verifyArtifact,
} from '../../scripts/lib/artifact.mjs';
import {
  DYNAMODB_LOCAL_SHA256,
  DYNAMODB_LOCAL_URL,
  DYNAMODB_LOCAL_VERSION,
  REQUIRED_JAVA_MAJOR,
  cacheDir,
} from '../../scripts/lib/dynamodb-local.mjs';

/**
 * Verificación del artefacto de DynamoDB Local.
 *
 * Lo que se prueba aquí es la pieza que impide que la suite de integración
 * ejecute un binario que nadie ha comprobado. No descarga nada: trabaja sobre
 * archivos temporales que crea y borra, así que no toca el caché real de quien
 * ejecute las pruebas.
 */

const temporaries: string[] = [];

async function tempFile(contents: string | Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'uinexus-artifact-'));
  temporaries.push(dir);
  const file = path.join(dir, 'artifact.bin');
  await writeFile(file, contents);
  return file;
}

const sha256Of = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('sha256File', () => {
  it('calcula el hash de un archivo', async () => {
    const file = await tempFile('contenido de prueba');
    expect(await sha256File(file)).toBe(sha256Of('contenido de prueba'));
  });

  it('devuelve hexadecimal en minúsculas de 64 caracteres', async () => {
    const hash = await sha256File(await tempFile('x'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('un archivo vacío tiene el hash del vacío', async () => {
    expect(await sha256File(await tempFile(''))).toBe(sha256Of(''));
  });

  it('falla si el archivo no existe', async () => {
    await expect(sha256File(path.join(tmpdir(), 'no-existe-jamas.bin'))).rejects.toThrow();
  });
});

describe('verifyArtifact: hash correcto → permitido', () => {
  it('devuelve el hash cuando coincide', async () => {
    const file = await tempFile('artefacto bueno');
    const result = await verifyArtifact(file, sha256Of('artefacto bueno'));
    expect(result).toBe(sha256Of('artefacto bueno'));
  });

  it('acepta el hash esperado en mayúsculas', async () => {
    // Los `.sha256` de AWS vienen en minúscula, pero otras fuentes no siempre.
    const file = await tempFile('algo');
    await expect(verifyArtifact(file, sha256Of('algo').toUpperCase())).resolves.toBeTruthy();
  });

  it('ignora espacios y saltos alrededor del hash esperado', async () => {
    const file = await tempFile('algo');
    await expect(verifyArtifact(file, `  ${sha256Of('algo')}\n`)).resolves.toBeTruthy();
  });
});

describe('verifyArtifact: hash incorrecto → rechazado', () => {
  it('lanza ChecksumMismatchError', async () => {
    const file = await tempFile('artefacto');
    await expect(verifyArtifact(file, sha256Of('otra cosa'))).rejects.toBeInstanceOf(
      ChecksumMismatchError
    );
  });

  it('el mensaje dice qué se esperaba, qué se obtuvo y que no se ejecutará', async () => {
    const file = await tempFile('artefacto');
    const expected = sha256Of('otra cosa');

    await expect(verifyArtifact(file, expected)).rejects.toThrow(
      /DynamoDB Local checksum mismatch/
    );
    await expect(verifyArtifact(file, expected)).rejects.toThrow(
      /Cached artifact will not be executed/
    );
  });

  it('el error lleva las dos huellas para poder compararlas', async () => {
    const file = await tempFile('artefacto');
    const expected = sha256Of('otra cosa');

    const error = await verifyArtifact(file, expected).catch(
      (caught: unknown) => caught
    );

    // `assert` y no `expect` para que TypeScript estreche el tipo: sin esto, el
    // valor sigue siendo `unknown` y las tres comprobaciones de abajo no
    // compilan.
    assert(error instanceof ChecksumMismatchError);
    expect(error.expected).toBe(expected);
    expect(error.actual).toBe(sha256Of('artefacto'));
    expect(error.filePath).toBe(file);
  });
});

describe('un artefacto alterado se detecta', () => {
  it('cambiar UN byte invalida la verificación', async () => {
    // Es el caso que de verdad importa: un archivo del tamaño correcto, con el
    // nombre correcto y en el sitio correcto, que ya no es el mismo binario.
    const original = Buffer.from('contenido binario de un artefacto largo'.repeat(64));
    const expected = sha256Of(original);

    const tampered = Buffer.from(original);
    tampered[100] = tampered[100]! ^ 0x01;

    const file = await tempFile(tampered);

    expect(tampered.length).toBe(original.length);
    await expect(verifyArtifact(file, expected)).rejects.toBeInstanceOf(ChecksumMismatchError);
  });

  it('NO borra el archivo alterado', async () => {
    // Se prefiere fallar de forma ruidosa a limpiar en silencio: un artefacto
    // que cambió es información —corrupción de disco, o algo peor— y borrarlo
    // la destruye antes de que nadie la vea.
    const file = await tempFile('alterado');
    await verifyArtifact(file, sha256Of('original')).catch(() => {});
    await expect(readFile(file, 'utf8')).resolves.toBe('alterado');
  });
});

describe('el sidecar .sha256 de AWS', () => {
  it('extrae el hash del formato `<hash> *<nombre>`', () => {
    expect(
      parseSha256Sidecar(`${'a'.repeat(64)} *dynamodb_local_2024-11-06.tar.gz\n`)
    ).toBe('a'.repeat(64));
  });

  it('acepta el hash a secas', () => {
    expect(parseSha256Sidecar(`  ${'b'.repeat(64)}  `)).toBe('b'.repeat(64));
  });

  it('rechaza contenido que no lleva un hash', () => {
    expect(() => parseSha256Sidecar('<html>404</html>')).toThrow();
    expect(() => parseSha256Sidecar('abc123')).toThrow();
  });
});

describe('el artefacto está fijado, no es `latest`', () => {
  it('la versión es una fecha concreta', () => {
    expect(DYNAMODB_LOCAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('la URL NO apunta a `latest`', () => {
    // Es la deuda que este bloque cierra: `latest` es mutable y hacía que la
    // misma orden trajera binarios distintos según el día.
    expect(DYNAMODB_LOCAL_URL).not.toContain('latest');
    expect(DYNAMODB_LOCAL_URL).toContain(DYNAMODB_LOCAL_VERSION);
  });

  it('la URL es https y de la línea 2.x, que es la que pide Java 17+', () => {
    expect(DYNAMODB_LOCAL_URL.startsWith('https://')).toBe(true);
    expect(DYNAMODB_LOCAL_URL).toContain('/v2.x/');
    expect(REQUIRED_JAVA_MAJOR).toBe(17);
  });

  it('el hash esperado está fijado en el repositorio', () => {
    expect(DYNAMODB_LOCAL_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('el caché vive fuera del repositorio', () => {
  it('no cae dentro del árbol del proyecto', () => {
    // Un binario de 54 MB no entra en Git, y un caché dentro del árbol acabaría
    // colándose en algún `add .`.
    const projectRoot = path.resolve(__dirname, '..', '..');
    expect(path.relative(projectRoot, cacheDir()).startsWith('..')).toBe(true);
  });

  it('respeta UINEXUS_CACHE_DIR para que CI apunte al suyo', () => {
    const previous = process.env.UINEXUS_CACHE_DIR;
    process.env.UINEXUS_CACHE_DIR = path.join(tmpdir(), 'cache-de-ci');
    try {
      expect(cacheDir()).toBe(path.resolve(path.join(tmpdir(), 'cache-de-ci')));
    } finally {
      if (previous === undefined) delete process.env.UINEXUS_CACHE_DIR;
      else process.env.UINEXUS_CACHE_DIR = previous;
    }
  });
});
