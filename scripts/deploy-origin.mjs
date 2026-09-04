/**
 * Publica el codigo real de la CloudFront Function y la pagina de error.
 *
 * La plantilla de CloudFormation crea la funcion con un marcador de posicion:
 * mantener el codigo en un `.js` de verdad —y no incrustado en el YAML— evita
 * tener dos copias que se desincronizan y permite probarlo.
 *
 * Publicar una CloudFront Function son tres pasos: leer el ETag actual,
 * actualizar el codigo y publicar. Sin el ETag, AWS rechaza la escritura.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STACK = process.env.UINEXUS_STACK ?? 'uinexus';

function aws(args, { json = true } = {}) {
  const out = execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
  return json && out.trim() ? JSON.parse(out) : out.trim();
}

function output(key) {
  return aws(
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      STACK,
      '--query',
      `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
      '--output',
      'text',
    ],
    { json: false }
  );
}

const functionName = output('ResolveFunctionName');
const bucket = output('ProjectsBucketName');

// --- 1. Codigo de la funcion -------------------------------------------------

const staging = mkdtempSync(join(tmpdir(), 'uinexus-origin-'));

try {
  const codePath = join(staging, 'viewer-request.js');
  writeFileSync(
    codePath,
    readFileSync(new URL('../infra/origin/viewer-request.js', import.meta.url))
  );

  const described = aws([
    'cloudfront',
    'describe-function',
    '--name',
    functionName,
    '--stage',
    'DEVELOPMENT',
  ]);

  const updated = aws([
    'cloudfront',
    'update-function',
    '--name',
    functionName,
    '--if-match',
    described.ETag,
    '--function-code',
    `fileb://${codePath}`,
    '--function-config',
    JSON.stringify({
      Comment: 'Traduce /@handle/slug a la clave de S3',
      Runtime: 'cloudfront-js-2.0',
      KeyValueStoreAssociations: {
        Quantity: 1,
        Items: [{ KeyValueStoreARN: output('ProjectRoutesStoreArn') }],
      },
    }),
  ]);

  aws(['cloudfront', 'publish-function', '--name', functionName, '--if-match', updated.ETag]);
  console.log(`Publicada la funcion ${functionName}.`);

  // --- 2. Pagina de error ----------------------------------------------------
  // Vive bajo projects/ para quedar cubierta por la misma politica de bucket
  // que el resto del contenido; no hace falta abrir otro prefijo.
  const errorPath = join(staging, '404.html');
  writeFileSync(
    errorPath,
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 &middot; UINexus</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;background:#f7f5f1;color:#16171b;
       display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
  main{max-width:36rem;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .5rem}
  p{color:#5c5f6b;margin:0}
  @media (prefers-color-scheme:dark){body{background:#111214;color:#f2f1ee}p{color:#9a9daa}}
</style></head>
<body><main><h1>Archivo no encontrado</h1>
<p>Este espacio aloja proyectos publicados en UINexus.</p></main></body></html>`
  );

  execFileSync(
    'aws',
    [
      's3api',
      'put-object',
      '--bucket',
      bucket,
      '--key',
      'projects/_errors/404.html',
      '--body',
      errorPath,
      '--content-type',
      'text/html; charset=utf-8',
    ],
    { stdio: 'ignore' }
  );
  console.log(`Subida la pagina de error a s3://${bucket}/projects/_errors/404.html`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
