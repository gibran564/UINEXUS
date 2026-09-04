// =============================================================================
// UINexus - origen aislado: resolucion de rutas en el borde
// =============================================================================
//
// ASCII ONLY y sin dependencias: es una CloudFront Function, no Node. Se
// ejecuta en cada peticion con un presupuesto de 1 ms de CPU y 10 KB de codigo.
//
// Traduce la URL publica a la clave real de S3:
//
//     /@alice/mi-proyecto/assets/app.js
//         -> /projects/{ownerId}/{projectId}/v{n}/assets/app.js
//
// El mapa (handle/slug) -> {ownerId, projectId, version, status, entryFile}
// vive en un CloudFront KeyValueStore que el servidor actualiza al publicar.
//
// Por que aqui y no en una Lambda: la cuenta bloquea lambda:InvokeFunctionUrl,
// pero ademas esto es mejor: sin arranques en frio, sin limite de tamano de
// respuesta y con CloudFront leyendo S3 directamente.
//
// Que NO se pierde al quitar la Lambda:
//  - El Content-Type lo sigue decidiendo el SERVIDOR: se fija como metadato del
//    objeto al firmar la subida, derivado de la extension. El archivo no opina.
//  - Las cabeceras de seguridad las pone una Response Headers Policy.
//  - Los borradores siguen siendo inalcanzables: no estan en el KeyValueStore.

import cf from 'cloudfront';

const kvs = cf.kvs();

var HANDLE = /^[a-z0-9][a-z0-9-]{2,23}$/;
var SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;

function notFound() {
  return {
    statusCode: 404,
    statusDescription: 'Not Found',
    headers: {
      'content-type': { value: 'text/html; charset=utf-8' },
      'cache-control': { value: 'no-store' },
      'x-content-type-options': { value: 'nosniff' },
    },
    body:
      '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>404 UINexus</title><style>' +
      'body{font:16px/1.6 system-ui,sans-serif;background:#f7f5f1;color:#16171b;' +
      'display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}' +
      'main{max-width:36rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}' +
      'p{color:#5c5f6b;margin:0}@media (prefers-color-scheme:dark){' +
      'body{background:#111214;color:#f2f1ee}p{color:#9a9daa}}' +
      '</style></head><body><main><h1>Proyecto no encontrado</h1>' +
      '<p>Este espacio aloja proyectos publicados en UINexus.</p></main></body></html>',
  };
}

// Normaliza la ruta del recurso. Devuelve null si es hostil.
// Mismas reglas que aplicaba la Lambda: nada de subir de nivel, nada oculto.
function normalize(parts) {
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    try {
      seg = decodeURIComponent(seg);
      if (seg.indexOf('%') !== -1) seg = decodeURIComponent(seg);
    } catch (e) {
      return null;
    }
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    if (seg.charAt(0) === '.') return null;
    if (seg.indexOf('\\') !== -1) return null;
    if (seg.length > 200) return null;
    out.push(seg);
  }
  return out.join('/');
}

async function handler(event) {
  var request = event.request;
  var parts = request.uri.split('/');
  // parts[0] es la cadena vacia anterior a la primera barra.
  var rawHandle = parts[1] || '';
  if (rawHandle.substring(0, 3) === '%40') rawHandle = rawHandle.substring(3);
  else if (rawHandle.charAt(0) === '@') rawHandle = rawHandle.substring(1);
  var slug = parts[2] || '';

  if (!HANDLE.test(rawHandle) || !SLUG.test(slug)) return notFound();

  var raw;
  try {
    raw = await kvs.get(rawHandle + '/' + slug);
  } catch (e) {
    // Ausente en el mapa = borrador, archivado, moderado o inexistente.
    // Mismo 404 en todos los casos: no se revela cual.
    return notFound();
  }

  var meta;
  try {
    meta = JSON.parse(raw);
  } catch (e) {
    return notFound();
  }

  var asset = normalize(parts.slice(3));
  if (asset === null) return notFound();
  if (asset === '' || asset.charAt(asset.length - 1) === '/') {
    asset = asset + (meta.e || 'index.html');
  }

  request.uri = '/projects/' + meta.o + '/' + meta.p + '/v' + meta.v + '/' + asset;
  return request;
}
