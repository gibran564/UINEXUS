import { readFileSync } from 'node:fs';

/**
 * Carga la CloudFront Function REAL para poder probarla.
 *
 * Una CloudFront Function no admite modulos propios: solo el `cloudfront`
 * incorporado. Eso impide extraer los helpers a un archivo compartido, asi que
 * la alternativa a duplicar la logica en las pruebas —y que las dos copias se
 * separen— es cargar el fuente que se despliega y sustituir esa unica
 * dependencia por un doble.
 *
 * Se prueba lo que se ejecuta, no una reimplementacion parecida.
 */

const SOURCE_URL = new URL('../../infra/origin/viewer-request.js', import.meta.url);

interface CloudFrontRequest {
  uri: string;
}

interface CloudFrontResponse {
  statusCode: number;
  body?: string;
}

export type HandlerResult = CloudFrontRequest | CloudFrontResponse;

export interface Route {
  /** ownerId */ o: string;
  /** projectId */ p: string;
  /** version */ v: number;
  /** entryFile */ e?: string;
}

interface OriginModule {
  handler: (event: { request: CloudFrontRequest }) => Promise<HandlerResult>;
  normalize: (parts: string[]) => string | null;
}

function load(routes: Record<string, Route>): OriginModule {
  const source = readFileSync(SOURCE_URL, 'utf8').replace(
    /^import cf from 'cloudfront';$/m,
    ''
  );

  const cf = {
    kvs: () => ({
      get: async (key: string) => {
        const value = routes[key];
        // El KeyValueStore real lanza cuando la clave no existe, y de eso
        // depende que un borrador sea inalcanzable. El doble tiene que
        // comportarse igual o la prueba no probaria nada.
        if (!value) throw new Error('KeyNotFound');
        return JSON.stringify(value);
      },
    }),
  };

  const factory = new Function(
    'cf',
    `${source}\nreturn { handler, normalize };`
  ) as (dependency: typeof cf) => OriginModule;

  return factory(cf);
}

/** Handler con un KeyValueStore poblado con las rutas dadas. */
export function originHandler(routes: Record<string, Route> = {}) {
  return load(routes).handler;
}

/** Saneado de rutas, tal y como lo hace la funcion desplegada. */
export function normalizeAssetPath(path: string): string | null {
  return load({}).normalize(path.split('/'));
}

export function isResponse(result: HandlerResult): result is CloudFrontResponse {
  return 'statusCode' in result;
}
