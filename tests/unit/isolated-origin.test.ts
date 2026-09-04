import { describe, expect, it } from 'vitest';
import { isResponse, normalizeAssetPath, originHandler, type Route } from './origin-helpers';

/**
 * Origen aislado: resolucion de rutas en el borde.
 *
 * Es la superficie mas expuesta de UINexus: recibe peticiones anonimas y decide
 * que objeto de S3 devolver. Un fallo aqui no es un bug de producto, es leer
 * los archivos de otra persona.
 *
 * Se ejercita la CloudFront Function real (ver origin-helpers.ts).
 */

const ALICE: Route = { o: 'uid-alice', p: 'p1', v: 3, e: 'index.html' };

const routes = { 'alice/mi-proyecto': ALICE };

async function resolve(uri: string, table: Record<string, Route> = routes) {
  return originHandler(table)({ request: { uri } });
}

async function uriFor(path: string): Promise<string | null> {
  const result = await resolve(path);
  return isResponse(result) ? null : result.uri;
}

async function statusFor(path: string, table?: Record<string, Route>): Promise<number | null> {
  const result = await resolve(path, table);
  return isResponse(result) ? result.statusCode : null;
}

describe('normalizacion de rutas', () => {
  it('acepta rutas normales', () => {
    expect(normalizeAssetPath('index.html')).toBe('index.html');
    expect(normalizeAssetPath('assets/css/main.css')).toBe('assets/css/main.css');
  });

  it('rechaza subir de nivel', () => {
    expect(normalizeAssetPath('../secreto.html')).toBeNull();
    expect(normalizeAssetPath('a/../../b')).toBeNull();
  });

  it('rechaza el traversal codificado, incluso doblemente', () => {
    expect(normalizeAssetPath('%2e%2e/x.html')).toBeNull();
    expect(normalizeAssetPath('%252e%252e/x.html')).toBeNull();
  });

  it('rechaza archivos y carpetas ocultos', () => {
    expect(normalizeAssetPath('.env')).toBeNull();
    expect(normalizeAssetPath('.git/config')).toBeNull();
    expect(normalizeAssetPath('assets/.htaccess')).toBeNull();
  });

  it('rechaza barras invertidas', () => {
    expect(normalizeAssetPath('..\\windows')).toBeNull();
  });

  it('colapsa separadores redundantes en vez de confundirse', () => {
    expect(normalizeAssetPath('a//b///c.css')).toBe('a/b/c.css');
    expect(normalizeAssetPath('./a/./b.js')).toBe('a/b.js');
  });

  it('rechaza segmentos absurdamente largos', () => {
    expect(normalizeAssetPath(`${'x'.repeat(201)}.html`)).toBeNull();
  });
});

describe('resolucion de la URL publica', () => {
  it('sirve el archivo de entrada en la raiz del proyecto', async () => {
    expect(await uriFor('/@alice/mi-proyecto')).toBe('/projects/uid-alice/p1/v3/index.html');
  });

  it('acepta el handle con @ codificado', async () => {
    expect(await uriFor('/%40alice/mi-proyecto')).toBe('/projects/uid-alice/p1/v3/index.html');
  });

  it('acepta el handle sin @', async () => {
    expect(await uriFor('/alice/mi-proyecto')).toBe('/projects/uid-alice/p1/v3/index.html');
  });

  it('apunta siempre a la version publicada', async () => {
    expect(await uriFor('/@alice/mi-proyecto/assets/app.js')).toBe(
      '/projects/uid-alice/p1/v3/assets/app.js'
    );
  });

  it('usa el archivo de entrada del proyecto, no un index fijo', async () => {
    const table = { 'alice/otro': { o: 'uid-alice', p: 'p9', v: 1, e: 'inicio.html' } };
    expect(await uriFor('/@alice/otro')).toBe(null); // no esta en la tabla por defecto
    const result = await originHandler(table)({ request: { uri: '/@alice/otro' } });
    expect(isResponse(result) ? null : result.uri).toBe('/projects/uid-alice/p9/v1/inicio.html');
  });
});

describe('lo que NO se sirve', () => {
  it('un proyecto ausente del mapa devuelve 404', async () => {
    // Los borradores, los archivados y los moderados no tienen entrada. Que
    // sean inalcanzables no depende de un filtro: dependen de no existir aqui.
    expect(await statusFor('/@alice/borrador')).toBe(404);
  });

  it('devuelve el MISMO 404 exista o no el proyecto', async () => {
    // Distinguir "no existe" de "no puedes" seria un oraculo para descubrir
    // que borradores tiene otra persona.
    expect(await statusFor('/@alice/borrador')).toBe(404);
    expect(await statusFor('/@nadie/nada')).toBe(404);
  });

  it('rechaza handles y slugs mal formados sin consultar el mapa', async () => {
    expect(await statusFor('/@AL!CE/x')).toBe(404);
    expect(await statusFor('/@alice')).toBe(404);
    expect(await statusFor('/')).toBe(404);
    expect(await statusFor('/@ab/x')).toBe(404); // handle demasiado corto
  });

  it('rechaza el traversal aunque el proyecto exista', async () => {
    expect(await statusFor('/@alice/mi-proyecto/../../otro/index.html')).toBe(404);
    expect(await statusFor('/@alice/mi-proyecto/.env')).toBe(404);
  });

  it('nunca deja escapar la ruta fuera del prefijo del proyecto', async () => {
    const uri = await uriFor('/@alice/mi-proyecto/a/b/../c.css');
    expect(uri).toBeNull(); // '..' se rechaza entero, no se colapsa
  });

  it('la respuesta de error no se cachea y va con nosniff', async () => {
    const result = await resolve('/@alice/borrador');
    if (!isResponse(result)) throw new Error('se esperaba una respuesta');
    const headers = (result as unknown as {
      headers: Record<string, { value: string } | undefined>;
    }).headers;
    expect(headers['cache-control']?.value).toBe('no-store');
    expect(headers['x-content-type-options']?.value).toBe('nosniff');
  });
});
