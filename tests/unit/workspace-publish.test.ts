import { describe, expect, it, vi } from 'vitest';
import {
  planWorkspacePublish,
  publishAndLink,
  resolvePublishTarget,
  retryPublishLink,
  type OwnedProjectsLookup,
  type PublishedLocation,
} from '../../src/lib/workspace-publish';
import { LIMITS } from '../../src/lib/constants';

/**
 * Publicar un NexCode.
 *
 * Lo que se prueba aquí no es que S3 acepte un archivo —eso es del publisher, y
 * ya existía— sino las dos decisiones que N5 añade: qué se puede publicar, y a
 * qué proyecto. Las dos son puras, así que se comprueban sin red.
 */

const WEB_PROJECT = {
  'index.html': '<link rel="stylesheet" href="styles.css"><script src="script.js"></script>',
  'styles.css': 'body { color: teal; }',
  'script.js': 'console.log("hola");',
};

describe('qué se puede publicar', () => {
  it('acepta un proyecto web y conserva rutas y contenido', async () => {
    const result = planWorkspacePublish(WEB_PROJECT, 'index.html');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.entryFile).toBe('index.html');
    expect(result.plan.files.map((file) => file.path).sort()).toEqual([
      'index.html',
      'script.js',
      'styles.css',
    ]);

    const css = result.plan.files.find((file) => file.path === 'styles.css');
    expect(await css?.blob.text()).toBe('body { color: teal; }');
    expect(css?.contentType).toBe('text/css');
  });

  it('sin HTML no hay nada que publicar', () => {
    const result = planWorkspacePublish({ 'main.py': 'print(1)' }, 'main.py');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((blocker) => blocker.reason.includes('archivo HTML'))).toBe(true);
  });

  /**
   * La vista previa descarta callando lo que no sabe pintar. Publicar no puede:
   * encontrar que falta un archivo DESPUÉS de publicar el sitio es el momento
   * más caro para enterarse.
   */
  it('nombra el archivo que el publisher no admite, en vez de descartarlo en silencio', () => {
    const result = planWorkspacePublish({ ...WEB_PROJECT, 'notas.py': 'print(1)' }, 'index.html');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const blocker = result.blockers.find((candidate) => candidate.path === 'notas.py');
    expect(blocker).toBeDefined();
    expect(blocker?.reason).toContain('.py');
  });

  it('bloquea un archivo que excede el maximo por archivo', () => {
    const result = planWorkspacePublish(
      { ...WEB_PROJECT, 'grande.txt': 'x'.repeat(LIMITS.maxFileBytes + 1) },
      'index.html'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((blocker) => blocker.path === 'grande.txt')).toBe(true);
  });

  it('deduce html para una pagina suelta y site cuando hay carpetas', () => {
    const suelta = planWorkspacePublish(WEB_PROJECT, 'index.html');
    const conCarpetas = planWorkspacePublish(
      { 'index.html': '<h1>a</h1>', 'assets/style.css': 'body{}' },
      'index.html'
    );

    expect(suelta.ok && suelta.plan.projectType).toBe('html');
    expect(conCarpetas.ok && conCarpetas.plan.projectType).toBe('site');
  });

  /**
   * El entryFile de EJECUCIÓN y el de publicación son cosas distintas desde N4.
   * Publicar `script.js` como portada del sitio serviría un archivo de texto.
   */
  it('publica el HTML aunque el entryFile de ejecucion sea otra cosa', () => {
    const result = planWorkspacePublish(WEB_PROJECT, 'script.js');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.entryFile).toBe('index.html');
  });

  it('no modifica el mapa de archivos recibido', () => {
    const files = { ...WEB_PROJECT };
    const snapshot = structuredClone(files);

    planWorkspacePublish(files, 'index.html');

    expect(files).toEqual(snapshot);
  });
});

describe('a que proyecto se publica', () => {
  const project = {
    id: 'proj-1',
    slug: 'mi-sitio',
    version: 3,
    author: { handle: 'ana', displayName: 'Ana', avatarUrl: null },
  };
  const found: OwnedProjectsLookup = { ok: true, projects: [project] };

  it('sin vinculo, se crea', () => {
    expect(resolvePublishTarget(undefined, found)).toEqual({ kind: 'create' });
  });

  it('con vinculo vivo, se reemplaza conservando la URL', () => {
    expect(resolvePublishTarget('proj-1', found)).toEqual({
      kind: 'update',
      projectId: 'proj-1',
      version: 3,
      slug: 'mi-sitio',
      handle: 'ana',
    });
  });

  it('un vinculo que la consulta confirma que ya no existe vuelve a crear', () => {
    // La consulta FUNCIONÓ y el proyecto no está: lo borró. Bloquear el botón
    // aquí dejaría a la persona sin forma de volver a publicar nunca.
    expect(resolvePublishTarget('borrado', found)).toEqual({ kind: 'create' });
  });

  /**
   * La invariante que evita el destrozo: una consulta que no llegó NO es una
   * ausencia. Si un 500 o una wifi mala degradaran a `create`, cada reintento
   * publicaría una copia más del mismo sitio, cada una con su URL.
   */
  it.each([
    ['sesion caducada', 'Tu sesión expiró.'],
    ['error del servidor', 'El servidor no respondió.'],
    ['fallo de red', 'Failed to fetch'],
  ])('%s deja el vinculo intacto y NO crea otro proyecto', (_caso, message) => {
    const target = resolvePublishTarget('proj-1', { ok: false, message });

    expect(target).toEqual({ kind: 'unresolved', message });
    expect(target.kind).not.toBe('create');
  });
});

describe('publicar y vincular', () => {
  const location: PublishedLocation = { projectId: 'proj-9', handle: 'ana', slug: 'mi-sitio' };

  it('publica y guarda el vinculo', async () => {
    const link = vi.fn(async () => undefined);
    const outcome = await publishAndLink({ publish: async () => location, link });

    expect(outcome).toEqual({ kind: 'published', location });
    expect(link).toHaveBeenCalledWith('proj-9');
  });

  it('si falla la publicacion no se intenta vincular nada', async () => {
    const link = vi.fn(async () => undefined);
    const outcome = await publishAndLink({
      publish: async () => {
        throw new Error('Esa versión no es la siguiente.');
      },
      link,
    });

    expect(outcome).toEqual({ kind: 'failed', message: 'Esa versión no es la siguiente.' });
    expect(link).not.toHaveBeenCalled();
  });

  /**
   * El caso caro. La publicación EXISTE; lo único que falló es recordar cuál
   * es. Contarlo como fallo haría que el reintento normal creara un SEGUNDO
   * proyecto publicado mientras el primero sigue vivo.
   */
  it('publicacion hecha y vinculo fallido NO es un fallo de publicacion', async () => {
    const outcome = await publishAndLink({
      publish: async () => location,
      link: async () => {
        throw new Error('No se pudo guardar.');
      },
    });

    expect(outcome.kind).toBe('link-failed');
    if (outcome.kind !== 'link-failed') return;
    expect(outcome.location).toEqual(location);
    expect(outcome.message).toBe('No se pudo guardar.');
  });

  it('reintentar el vinculo no vuelve a publicar', async () => {
    const publish = vi.fn(async () => location);
    const link = vi.fn(async () => undefined);

    const outcome = await retryPublishLink(location, link);

    expect(outcome).toEqual({ kind: 'published', location });
    expect(link).toHaveBeenCalledWith('proj-9');
    expect(publish).not.toHaveBeenCalled();
  });

  it('reintentar el vinculo y volver a fallar conserva la publicacion', async () => {
    const outcome = await retryPublishLink(location, async () => {
      throw new Error('Sigue sin guardarse.');
    });

    expect(outcome.kind).toBe('link-failed');
    if (outcome.kind !== 'link-failed') return;
    expect(outcome.location).toEqual(location);
  });

  it('no reescribe un vinculo que ya apunta a ese proyecto', async () => {
    const link = vi.fn(async () => undefined);
    const outcome = await publishAndLink({
      publish: async () => location,
      link,
      alreadyLinkedTo: 'proj-9',
    });

    expect(outcome).toEqual({ kind: 'published', location });
    expect(link).not.toHaveBeenCalled();
  });
});
