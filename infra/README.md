# Infraestructura

```
uinexus.cfn.yaml          tablas, buckets, CloudFront, KeyValueStore e IAM
origin/viewer-request.js  la CloudFront Function del origen aislado
```

Se despliega con:

```bash
npm run aws:deploy:infra    # crea o actualiza la pila
npm run aws:deploy:origin   # publica el código de la función y la página de error
npm run aws:outputs         # imprime los valores para .env.local
```

## Por qué la plantilla está en ASCII puro

El AWS CLI lee el archivo de plantilla con el **códec local del sistema**, no
con UTF-8. En un Windows en español eso es cp1252, y un solo carácter acentuado
hace fallar el despliegue entero con:

```
'charmap' codec can't decode byte 0x8d in position 1510: character maps to <undefined>
```

(0x8D es el segundo byte de `Í` en UTF-8.) No es un problema que se pueda
arreglar con una variable de entorno de forma fiable: el CLI v2 es un binario
empaquetado. Una plantilla de infraestructura viaja a otras máquinas y a CI con
locales desconocidos, así que la solución robusta es no depender de la
codificación. Por eso los comentarios del YAML van sin acentos y el
razonamiento en español correcto vive aquí.

Lo mismo aplica a `origin/viewer-request.js`: es ASCII porque se incrusta en
una CloudFront Function.

## El origen aislado, sin Lambda

```
GET /@alice/mi-proyecto/assets/app.js
        │
        ▼
  CloudFront Function (viewer-request)
        │  consulta el KeyValueStore: "alice/mi-proyecto"
        │  → {o: ownerId, p: projectId, v: 3, e: "index.html"}
        ▼
  reescribe a /projects/{ownerId}/{projectId}/v3/assets/app.js
        │
        ▼
  S3 (privado, Origin Access Control)
        │
        ▼
  Response Headers Policy: CSP, nosniff, Referrer-Policy, noindex…
```

### Por qué no hay una Lambda en el camino

La versión anterior servía los archivos desde una Lambda con respuesta en
streaming. Se descartó por dos razones, en este orden:

1. **La cuenta bloquea `lambda:InvokeFunctionUrl`.** Una función trivial con
   política de recursos correcta también devuelve 403, igual que una invocada
   por CloudFront con OAC y firma SigV4. `aws lambda invoke` sí funciona, y una
   HTTP API de API Gateway pública también, así que la restricción es
   específica de las Function URLs.
2. **Este diseño es mejor de todos modos.** Sin arranques en frío, sin el
   límite de tamaño de respuesta de Lambda, sin coste por invocación y con
   CloudFront leyendo S3 directamente.

### Qué NO se perdió al quitar la Lambda

- **El Content-Type lo sigue decidiendo el servidor.** Se fija como metadato del
  objeto al firmar la subida (`lib/aws/s3.ts`), derivado de la extensión y de
  una lista blanca. El archivo del alumno no opina sobre cómo se interpreta.
- **Las cabeceras de seguridad** las aplica una Response Headers Policy a todo
  el origen.
- **Los borradores siguen siendo inalcanzables.** No están en el
  KeyValueStore: no es que se filtren, es que no existen para CloudFront.
- **El saneado de rutas** (traversal, doble encoding, archivos ocultos) lo hace
  la función en el borde, y está cubierto por `tests/unit/isolated-origin.test.ts`,
  que ejercita el archivo real que se despliega.

### `X-Robots-Tag: noindex` en todo el origen

Es deliberado. La página indexable de un proyecto es su **ficha en la
plataforma**, que lleva título, descripción, autoría y curso. El HTML crudo del
alumno servido desde el origen aislado sería contenido duplicado y sin
contexto, y competiría con la ficha en los resultados de búsqueda.

## Los dos mapas de visibilidad

No son lo mismo y la diferencia importa:

| | Qué contiene | Para qué |
|---|---|---|
| GSI `byStatus` (DynamoDB) | sólo `published` | la **galería**: lo que se puede enumerar |
| KeyValueStore | `published` **y** `unlisted` | el **acceso por enlace** |

Un `unlisted` tiene que abrirse por su URL y no aparecer en ninguna lista. Por
eso está en el segundo y no en el primero.

## Concurrencia en el KeyValueStore

Cada escritura exige el ETag actual del almacén **entero**, no el de la clave.
Con una clase publicando a la vez los choques son normales, así que
`lib/aws/routes.ts` reintenta en lugar de fallar.

La sincronización ocurre **después** de que la escritura en DynamoDB haya
terminado. El fallo posible queda así acotado y en la dirección segura: puede
quedar sin publicar algo que la plataforma ya da por publicado, nunca al revés.
