# UINexus

**Aprende construyendo.**

Plataforma académica para crear, programar, practicar, entregar y publicar
proyectos dentro de materias y grupos. Una actividad empieza como una
instrucción, se convierte en código, crece como proyecto y termina siendo
trabajo del estudiante.

```
Docente plantea la actividad → elige lenguaje y código inicial → publica

Estudiante abre el paso → programa en el editor o en un NexBook → ejecuta
→ ve tablas y gráficas → se guarda solo → entrega
→ y lo que construyó sigue siendo suyo: lo copia, lo publica o lo exporta

Docente revisa el código en el mismo editor → lo ejecuta → califica

Proyecto terminado → uinexus.mx/@ana/prototipo-biblioteca → se comparte
```

Sin instalar un entorno, sin configurar nada y sin saber Git, npm, CLI ni DNS.

## Qué se puede hacer con cada lenguaje

Editar no es ejecutar, y UINexus no finge lo contrario.

| Lenguaje | Se edita | Se ejecuta | Gráficas y tablas | Dónde |
|---|---|---|---|---|
| Python | ✅ | ✅ | ✅ pandas y matplotlib | Navegador (Pyodide) |
| R | ✅ | ✅ | ✅ `plot()` y data frames | Navegador (webR) |
| Java, C, C++ | ✅ | ❌ | ❌ | Necesitan un sandbox remoto que aún no existe |
| HTML, CSS, JavaScript | ✅ | ❌ | ❌ | Se ven al publicar, en el origen aislado |
| SQL | ✅ | ❌ | ❌ | No hay base de datos que consultar |

El catálogo vive en `lib/constants.ts` y la portada se genera desde él, así que
no puede prometer algo que el producto no haga.

---

## Arrancar

```bash
npm install
npm run dev
```

`http://localhost:3000`. **Sin configurar nada**, UINexus arranca en modo demo
con proyectos de ejemplo: la interfaz completa funciona y un aviso permanente
advierte de que nada se guarda.

Para conectarlo a Firebase: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Stack

Next.js 15 (App Router) · React 19 · TypeScript estricto · Tailwind CSS 4 ·
Firebase Auth (solo identidad) · AWS DynamoDB, S3, CloudFront y Amplify Hosting.

## La decisión que define el proyecto

**Dos orígenes.**

```
uinexus.mx              metadatos, sesión, galería — nunca ejecuta HTML ajeno
uinexus-projects.app    el proyecto del alumno     — aislado por la política de mismo origen
```

Las páginas que suben los estudiantes contienen JavaScript que la plataforma no
controla. Si se ejecutaran en `uinexus.mx`, podrían leer el token de sesión de
quien las está mirando. Al vivir en otro origen, el navegador las aísla por
completo. Todo lo demás —CSP, `nosniff`, `sandbox`, listas blancas de
extensiones, autorización en servidor y permisos de subida firmados— es defensa
en profundidad sobre esa base.

Ver [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura, rutas, modelo de datos, los tres niveles de proyecto |
| [`docs/NEXBOOK.md`](docs/NEXBOOK.md) | NexBook y UINexus Studio: bloques, salidas ricas, assets, hojas, kernels, publicación y el formato `.nexbook` |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Aislamiento por origen, capas de validación, cabeceras, y qué **no** resuelve |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Design language, tokens, tipografía, componentes |
| [`docs/UX-AUDIT.md`](docs/UX-AUDIT.md) | Auditoría conceptual previa y auditoría del resultado, con puntuación |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) | Evaluación WCAG 2.2 AA, criterio a criterio |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Despliegue paso a paso y comprobaciones previas |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | Limitaciones reales y mejoras futuras por orden de valor |

## Estructura

```
src/
├── app/                    rutas (App Router)
│   ├── globals.css         design system completo: tokens, temas, componentes
│   ├── [handle]/           perfil público y ficha del proyecto
│   ├── explore/  courses/  publish/  dashboard/  login/  about/
│   └── sitemap.ts  robots.ts
├── components/
│   ├── app-shell/  auth/  dashboard/  explore/  project/  publish/  theme/  ui/
└── lib/
    ├── aws/                config, cliente DynamoDB y firma de subidas a S3
    ├── data/               repositorio (DynamoDB o demo) + mappers de privacidad
    ├── firebase/           config, Auth y Admin SDK — solo identidad
    ├── server/             autorización y escrituras: sustituye a las security rules
    ├── files.ts            validación de archivos y descompresión de .zip
    ├── preview.ts          vista previa del borrador, sin ejecutar JavaScript
    ├── publish-client.ts   creación de proyectos y versionado de archivos
    └── schemas.ts  slug.ts  urls.ts  types.ts  constants.ts

src/app/api/                rutas de escritura: toda mutación pasa por aquí
infra/origin/               origen aislado (CloudFront Function en el borde)
infra/uinexus.cfn.yaml      tablas, buckets, CloudFront, KeyValueStore e IAM
tests/unit/                 rutas del origen aislado y atributos de visibilidad
legacy/firebase/            restos de la etapa Firebase; ya no gobiernan nada
```

## Comandos

```bash
npm run dev                 # servidor de desarrollo
npm run build               # build de producción
npm run typecheck           # tsc --noEmit, modo estricto
npm run lint                # ESLint

npm test                    # pruebas unitarias con Vitest
npm run test:integration    # rutas de API contra DynamoDB Local
npm run runtimes            # publica Pyodide, webR y los Workers en public/
npm run runtimes:python     # + numpy, pandas y matplotlib (~16.6 MB, opcional)

npm run aws:deploy:infra    # crea/actualiza la pila de CloudFormation
npm run aws:deploy:origin   # publica el código del origen aislado
npm run aws:outputs         # imprime los valores para .env.local
```

UINexus usa **Firebase solo para autenticación**; los datos viven en DynamoDB,
los archivos en S3 y el origen aislado es una Lambda. Ver
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Roles

| Rol | Puede |
|---|---|
| **Visitante** | Explorar, buscar, filtrar, abrir proyectos, ver perfiles y cursos, compartir. Sin cuenta |
| **Alumno** | Todo lo anterior, más publicar, editar, reemplazar archivos sin cambiar la URL, cambiar visibilidad y eliminar sus proyectos |
| **Profesor / admin** | Todo lo anterior, más destacar, ocultar y leer reportes. Preparado en el modelo y en las reglas; sin panel propio en el MVP |

## Estados de un proyecto

| Estado | Aparece en la galería | Accesible por enlace |
|---|---|---|
| `published` | Sí | Sí |
| `unlisted` | No, ni en el sitemap | Sí — útil para entregas |
| `draft` | No | No, sólo su autor |
| `archived` | No | No |

Los `unlisted` no son inalcanzables sólo por convención: el índice `byStatus` de
DynamoDB es **disperso** y no los contiene, así que ninguna consulta puede
devolverlos.

---

Proyecto académico. Los trabajos publicados pertenecen a sus autoras y autores.
