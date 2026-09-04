# Despliegue — UINexus

UINexus se reparte entre dos proveedores, y el reparto es deliberado:

```
Firebase Authentication   →  identidad (quién eres)
AWS                       →  datos, archivos, ejecución y alojamiento
```

Firebase se queda sólo con lo que hace bien y sale gratis en el plan Spark:
emitir y verificar identidades. Todo lo demás vive en AWS.

## 0. Sin nada (modo demo)

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`. La interfaz completa funciona con datos de
ejemplo y un aviso permanente advierte de que nada se guarda. Sirve para
revisar UX y accesibilidad antes de crear un solo recurso en la nube.

---

## 1. Credenciales de AWS

```bash
aws configure
```

Usa un **usuario IAM**, nunca las claves de la cuenta raíz. Necesita permisos
sobre CloudFormation, DynamoDB, S3, Lambda e IAM. Para un despliegue inicial,
`PowerUserAccess` más `IAMFullAccess` es suficiente; para uso continuado,
conviene recortarlo.

Comprueba que responde:

```bash
aws sts get-caller-identity
```

## 2. La pila de infraestructura

```bash
npm run aws:deploy:infra
npm run aws:deploy:origin
npm run aws:outputs
```

La primera orden crea, mediante `infra/uinexus.cfn.yaml`:

| Recurso | Para qué |
|---|---|
| 5 tablas DynamoDB | usuarios, handles, proyectos, cursos y reportes |
| `uinexus-projects-*` (S3, **privado**) | el código de los alumnos |
| `uinexus-public-*` (S3) | portadas y avatares, públicos sólo bajo `covers/` y `avatars/` |
| CloudFront + Origin Access Control | el origen aislado: lee S3 directamente |
| CloudFront Function + KeyValueStore | traduce `/@handle/slug` a la clave real de S3 |
| Response Headers Policy | CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex` |

La segunda publica el código real de la CloudFront Function y sube la página
de error: la pila la crea con un marcador de posición que devuelve 503 hasta
que se despliega. El código vive en `infra/origin/viewer-request.js` y no
incrustado en el YAML, para que haya una sola copia y se pueda probar.

> **La plantilla es ASCII puro a propósito.** El AWS CLI la lee con el códec
> local del sistema (cp1252 en Windows en español), no con UTF-8, y un solo
> acento la rompe con `'charmap' codec can't decode byte ...`. El razonamiento
> en español correcto está en `infra/README.md`.

La tercera imprime los valores que hay que copiar a `.env.local`.

### Los tres índices de la tabla de proyectos

| Índice | Responde a |
|---|---|
| `byOwner` | "mis proyectos", borradores incluidos |
| `byPath` | la URL pública `/@handle/slug` |
| `byStatus` | la galería |

`byStatus` es **disperso** a propósito: sus dos claves (`statusKey`, `listedAt`)
sólo se escriben cuando el proyecto está publicado y no ocultado. Los
borradores y los `unlisted` no están dentro del índice, así que ninguna
consulta puede devolverlos. Antes, con Firestore, esa garantía dependía de
acordarse de escribir el filtro en cada regla; ahora es estructural.

## 3. Firebase, reducido a identidad

En [console.firebase.google.com](https://console.firebase.google.com), proyecto
`uinexus-f379f`:

1. **Authentication → Sign-in method**: habilitar **Google** y
   **Correo/contraseña**.
   *Teléfono requiere plan Blaze; en Spark no está disponible.*
2. **Authentication → Settings → Authorized domains**: añadir el dominio de la
   plataforma. **No** añadir el dominio de proyectos: el origen aislado no debe
   poder autenticar a nadie. Si apareciera ahí, el HTML de un alumno podría
   montar un inicio de sesión creíble bajo un dominio de UINexus.
3. **Project settings → Service accounts → Generate new private key**. Ese JSON
   es un secreto de verdad: va en `FIREBASE_SERVICE_ACCOUNT_JSON`, en el gestor
   de secretos de Amplify, nunca en el repositorio.

> En App Hosting bastaban las credenciales por defecto de Google. En AWS no
> existen, así que la cuenta de servicio pasa de opcional a **obligatoria**:
> sin ella el servidor no puede verificar ningún token y todas las escrituras
> quedan cerradas.

## 4. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena los seis `NEXT_PUBLIC_FIREBASE_*` desde la consola de Firebase, los
`UINEXUS_*` desde `npm run aws:outputs`, y `FIREBASE_SERVICE_ACCOUNT_JSON` con
la cuenta de servicio.

## 5. La aplicación en Amplify Hosting

1. Consola de AWS → **Amplify** → *Deploy an app* → conecta el repositorio.
2. Amplify detecta Next.js y usa el `next build` del `package.json`.
3. **Environment variables**: todas las de `.env.local`.
   `FIREBASE_SERVICE_ACCOUNT_JSON` como **secreto**, no como variable normal.
4. **IAM**: el rol de servicio del backend necesita, sobre las tablas y los
   buckets de la pila:
   - `dynamodb:GetItem`, `Query`, `Scan`, `PutItem`, `UpdateItem`, `DeleteItem`
   - `s3:PutObject`, `GetObject`, `DeleteObject`, `ListBucket`

   Concédelo acotado a los ARN de la pila, no con comodines de cuenta.

## 6. Los dos orígenes

Este paso **no es opcional**. Sin dos orígenes, el modelo de seguridad no
existe. Ver [SECURITY.md §1](SECURITY.md).

```
uinexus.mx              →  Amplify (la aplicación de confianza)
uinexus-projects.app    →  CloudFront → S3 (el código de los alumnos)
```

El origen aislado tiene que ser un **dominio registrable distinto**, no un
subdominio: `projects.uinexus.mx` podría escribir cookies con
`Domain=.uinexus.mx`.

1. Registra el dominio (Route 53 o donde prefieras).
2. Certificado en ACM, **en us-east-1** (CloudFront sólo acepta certificados de
   esa región).
3. Añade el dominio como *alternate domain name* de la distribución que ya creó
   la pila y asígnale el certificado.
4. `NEXT_PUBLIC_PROJECTS_ORIGIN=https://uinexus-projects.app`.

Mientras no haya dominio propio, el dominio `*.cloudfront.net` de la pila ya es
un origen distinto y sirve para desarrollo y pruebas.

## 7. Comprobaciones antes de dar por bueno el despliegue

- [ ] `https://uinexus.mx` carga la galería **sin sesión**.
- [ ] Crear cuenta con correo, cerrar sesión, volver a entrar.
- [ ] Google Sign-In funciona desde el dominio de producción.
- [ ] Publicar un proyecto de prueba y abrir su URL.
- [ ] Esa URL abre en `uinexus-projects.app`, **no** en `uinexus.mx`.
- [ ] Un `.html` de alumno llega con `Content-Type: text/html` y `nosniff`.
- [ ] Pedir la ruta interna `/projects/<uid>/...` directamente responde 404.
- [ ] El bucket de proyectos responde 403 si se pide sin pasar por CloudFront.
- [ ] Un `unlisted` abre por enlace y **no** aparece en la galería ni en el sitemap.
- [ ] Un borrador de otra persona responde 404, no 403.
- [ ] Pedir `PATCH /api/projects/<id-ajeno>` con un token válido responde 404.
- [ ] El bucket de proyectos **no** es legible públicamente:
      `aws s3 ls s3://uinexus-projects-<cuenta>` sin credenciales debe fallar.

## Costes

A escala de un curso, con DynamoDB y Lambda en pago por petición, el gasto real
ronda cero salvo el dominio y, si se supera la capa gratuita, unos pocos
dólares al mes de S3 y CloudFront. Lo único que puede dispararse es el tráfico
de salida si un proyecto se hace viral: conviene poner una alerta de
presupuesto en Cloud Billing antes de abrir la plataforma a todo el alumnado.
