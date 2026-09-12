import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Compilar Nextudio NO puede exigir una base de datos alcanzable.
 *
 * ## El fallo que estas pruebas fijan
 *
 * La compilación en Vercel no lleva credenciales de AWS: el SDK las resuelve en
 * tiempo de PETICIÓN, no de build. Cada página pública prerrenderizada que lee
 * datos —`/courses`, `/courses/[slug]`, `/sitemap.xml`— lanzaba entonces
 * `CredentialsProviderError` y tiraba el despliegue entero con «Failed to
 * collect page data». En una máquina de desarrollo no se veía, porque ahí sí
 * hay credenciales: sólo fallaba en CI.
 *
 * Se arreglaron una a una y cada arreglo destapaba la siguiente —primero
 * `generateStaticParams`, luego el sitemap, luego `/courses`—, que es la señal
 * de que el problema no estaba en ninguna de ellas.
 *
 * ## Lo que NO se está probando
 *
 * Que los errores se traguen. La segunda mitad de cada prueba es la que
 * importa: **fuera del build vuelve a lanzar**. Una consulta que falla mientras
 * se atiende a una persona sigue siendo un error y tiene que verse como tal.
 */

const CREDENTIALS_ERROR = Object.assign(
  new Error('Could not load credentials from any providers'),
  { name: 'CredentialsProviderError' }
);

const send = vi.fn();

vi.mock('../../src/lib/aws/dynamo', () => ({
  getDynamo: () => ({ send }),
}));

/** Importa el repositorio con el módulo de Dynamo ya sustituido. */
async function repository() {
  vi.resetModules();
  return import('../../src/lib/data/repository');
}

const originalPhase = process.env.NEXT_PHASE;

beforeEach(() => {
  send.mockReset();
  send.mockRejectedValue(CREDENTIALS_ERROR);
});

afterEach(() => {
  if (originalPhase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = originalPhase;
});

describe('cuando se compila sin base de datos', () => {
  beforeEach(() => {
    // La variable la pone Next SÓLO durante `next build`. No sirve `NODE_ENV`,
    // que vale `production` también con el servidor ya atendiendo.
    process.env.NEXT_PHASE = 'phase-production-build';
  });

  it('las materias salen vacías en vez de tirar el build', async () => {
    const { listCourses } = await repository();
    await expect(listCourses()).resolves.toEqual([]);
  });

  it('la galería sale vacía en vez de tirar el build', async () => {
    const { listProjects } = await repository();
    const page = await listProjects();
    expect(page.projects).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('el sitemap puede construirse sin proyectos, perfiles ni materias', async () => {
    const { listIndexablePaths, listPublicHandles, listCourses } = await repository();
    await expect(
      Promise.all([listIndexablePaths(), listPublicHandles(), listCourses()])
    ).resolves.toEqual([[], [], []]);
  });

  it('una materia concreta se resuelve a null, y la ruta la servirá bajo demanda', async () => {
    const { getCourseBySlug } = await repository();
    await expect(getCourseBySlug('investigacion-de-operaciones')).resolves.toBeNull();
  });

  it('deja dicho en el log POR QUÉ va vacío', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { listCourses } = await repository();
    await listCourses();

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('Sin base de datos al compilar');
    warn.mockRestore();
  });
});

describe('cuando ya se está atendiendo peticiones', () => {
  beforeEach(() => {
    delete process.env.NEXT_PHASE;
  });

  it('un fallo de la base de datos SIGUE siendo un error', async () => {
    const { listCourses } = await repository();
    await expect(listCourses()).rejects.toThrow('Could not load credentials');
  });

  it('tampoco se traga en la galería', async () => {
    const { listProjects } = await repository();
    await expect(listProjects()).rejects.toThrow('Could not load credentials');
  });

  it('ni en los perfiles públicos', async () => {
    const { listPublicHandles } = await repository();
    await expect(listPublicHandles()).rejects.toThrow('Could not load credentials');
  });
});
