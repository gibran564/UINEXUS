# Nextudio

**Aprende construyendo.**

Espacio académico para programar, construir laboratorios reproducibles,
desarrollar proyectos y entregar el proceso completo del trabajo. Una actividad
empieza como una instrucción, se convierte en código, crece como proyecto y
termina siendo trabajo del estudiante.

```
Docente plantea la actividad → elige lenguaje y código inicial → publica

Estudiante abre la parte que le toca → NexCode o NexLab → ejecuta
→ ve tablas y gráficas → se guarda solo → entrega
→ y lo que construyó sigue siendo suyo: lo copia, lo publica o lo exporta

Docente revisa el código en el mismo editor → lo ejecuta → califica

Proyecto terminado → uinexus.mx/@ana/prototipo-biblioteca → se comparte
```

Sin instalar un entorno, sin configurar nada y sin saber Git, npm, CLI ni DNS.

## Las dos formas de trabajar

```
Nextudio
├── NexCode   un archivo, un lenguaje, el editor      → entidad: Workspace kind 'code'
├── NexLab    un documento por bloques: explicación,  → entidad: NexBook
│             código, hojas de cálculo, imágenes y
│             los resultados de ejecutarlo
└── NexIA     el registro de cómo se usó una IA       → bloque `ai_worklog` de un NexBook
```

Un ejercicio de veinte líneas no necesita NexLab. Un análisis con datos, tablas,
gráficas y conclusiones no cabe en NexCode. Son **experiencias, no productos**:
comparten tabla, editor, motores de ejecución y pantalla de listado. NexIA no es
una entidad nueva ni ejecuta ninguna IA: es un bloque de NexBook con su propio
preset, pensado para documentar lo que se hizo fuera.

## La marca es Nextudio; la infraestructura sigue diciendo `uinexus`

No es un descuido. Lo que **se lee** es la marca —títulos, portada, barra, pie,
mensajes— y cambiarla cuesta editar copy. Lo que **se ejecuta** son
identificadores —tablas `uinexus-*`, variables `UINEXUS_*`, buckets, prefijos de
S3, los dominios y el formato `uinexus-nexbook` de los archivos ya exportados— y
cambiarlos cuesta migrar datos y romper direcciones que ya están repartidas.

La regla operativa, para quien toque copy: sustituir `UINexus` con
**capitalización exacta**; nunca `uinexus` ni `UINEXUS`. Ver
[`docs/NEXTUDIO-ROADMAP.md`](docs/NEXTUDIO-ROADMAP.md) §D2.

## Qué se puede hacer con cada lenguaje

Editar no es ejecutar, y Nextudio no finge lo contrario.

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

`http://localhost:3000`. **Sin configurar nada**, Nextudio arranca en modo demo
con proyectos de ejemplo: la interfaz completa funciona y un aviso permanente
advierte de que nada se guarda.

### Para ver el producto entero, con sesión

El modo demo no tiene aula: sin identidad no hay materias, ni actividades, ni
entregas. Para recorrer eso hay un sandbox completo —identidad y base de datos
locales, sin tocar nada de producción— con dos cuentas ya sembradas:

```bash
npm run dev:local
```

Docente `docente.sandbox@itdurango.edu.mx`, estudiante
`20250001@itdurango.edu.mx`, contraseña `sandbox-local` en los dos. Necesita
Java (para DynamoDB Local) y se explica entero en
[`docs/LOCAL-DEVELOPMENT.md`](docs/LOCAL-DEVELOPMENT.md).

Para conectarlo a Firebase y AWS de verdad: [`docs/DEPLOY.md`](docs/DEPLOY.md).

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
| [`docs/NEXTUDIO-ROADMAP.md`](docs/NEXTUDIO-ROADMAP.md) | Auditoría, decisiones y hoja de ruta de la evolución a Nextudio |
| [`docs/NEXBOOK.md`](docs/NEXBOOK.md) | NexBook y NexLab: bloques, salidas ricas, assets, hojas, kernels, publicación y el formato `.nexbook` |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Aislamiento por origen, capas de validación, cabeceras, y qué **no** resuelve |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Design language, tokens, tipografía, componentes |
| [`docs/UX-AUDIT.md`](docs/UX-AUDIT.md) | Auditoría conceptual previa y auditoría del resultado, con puntuación |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) | Evaluación WCAG 2.2 AA, criterio a criterio |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Despliegue paso a paso y comprobaciones previas |
| [`docs/LOCAL-DEVELOPMENT.md`](docs/LOCAL-DEVELOPMENT.md) | El sandbox local: cuentas, semilla, pruebas E2E y por qué no puede tocar producción |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | Limitaciones reales y mejoras futuras por orden de valor |
| [`CHECKPOINT.md`](CHECKPOINT.md) | Estado del producto, riesgos abiertos y la siguiente decisión |

## Estructura

```
src/
├── app/                    rutas (App Router)
│   ├── globals.css         design system completo: tokens, temas, componentes
│   ├── aula/               materias, actividades, creación y entrega
│   ├── practicas/          Espacios: NexCode y NexLab personales
│   ├── nexbook/[slug]/     un NexBook publicado, en sólo lectura
│   ├── [handle]/           perfil público y ficha del proyecto
│   ├── explore/  courses/  publish/  dashboard/  login/  about/
│   └── api/                rutas de escritura: toda mutación pasa por aquí
├── components/
│   ├── aula/               el aula entera: creador, recorrido, entrega, revisión
│   ├── studio/             NexBook Studio: bloques, hojas, registro de IA
│   ├── search/             la paleta global (Ctrl/Cmd + K)
│   └── app-shell/  auth/  dashboard/  explore/  home/  project/  theme/  ui/
└── lib/
    ├── aws/                config, cliente DynamoDB y firma de subidas a S3
    ├── data/               repositorio (DynamoDB o demo) + mappers de privacidad
    ├── firebase/           config, Auth y Admin SDK — solo identidad
    ├── server/             autorización y escrituras: sustituye a las security rules
    ├── code-engines/       Python (Pyodide) y R (webR) tras un contrato común
    ├── spreadsheet/        hojas, importación de CSV/XLSX y el puente a los motores
    ├── export/             exportación de entregas: Markdown para IA, CSV y JSON
    ├── activity-builder.ts intención docente ⇄ modelo académico
    ├── student-activity.ts estados, progreso y validación de la vista del alumnado
    ├── workflow.ts         el motor académico: normalización, permisos y avance
    └── schemas.ts  slug.ts  urls.ts  types.ts  constants.ts

scripts/                    sandbox local, runtimes, semilla y despliegue
tests/unit/                 lógica pura: 46 archivos
tests/integration/          rutas de API contra DynamoDB Local
tests/e2e/                  Playwright con sesión real contra el sandbox
infra/origin/               origen aislado (CloudFront Function en el borde)
infra/uinexus.cfn.yaml      tablas, buckets, CloudFront, KeyValueStore e IAM
legacy/firebase/            restos de la etapa Firebase; ya no gobiernan nada
```

## Comandos

```bash
npm run dev                 # servidor de desarrollo (modo demo)
npm run dev:local           # sandbox completo: identidad y base de datos locales
npm run prod:local          # el sandbox, pero COMPILADO (next build + next start)
npm run local:reset         # borra los datos del sandbox
npm run build               # build de producción
npm run typecheck           # tsc --noEmit, modo estricto
npm run lint                # ESLint

npm test                    # pruebas unitarias con Vitest
npm run test:integration    # rutas de API contra DynamoDB Local
npm run test:e2e            # Playwright con sesión real contra el sandbox
npm run test:e2e:prod       # lo mismo, contra el sandbox compilado
npm run runtimes            # publica Pyodide, webR y los Workers en public/
npm run runtimes:python     # + numpy, pandas y matplotlib (~16.6 MB, opcional)

npm run aws:deploy:infra    # crea/actualiza la pila de CloudFormation
npm run aws:deploy:origin   # publica el código del origen aislado
npm run aws:outputs         # imprime los valores para .env.local
```

Nextudio usa **Firebase solo para autenticación**; los datos viven en DynamoDB,
los archivos en S3 y el origen aislado es una Lambda. Ver
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Roles

| Rol | Puede |
|---|---|
| **Visitante** | Explorar, buscar, filtrar, abrir proyectos, ver perfiles y cursos, compartir. Sin cuenta |
| **Alumno** | Todo lo anterior, más publicar y editar proyectos; y dentro de sus materias: hacer actividades en NexCode, NexLab y NexIA, guardar, entregar y quedarse con una copia personal |
| **Profesor** | Todo lo anterior, más crear actividades y sus partes, preparar la plantilla de un NexLab antes de publicar, repartir el trabajo, ver el avance, leer las entregas y exportarlas |
| **Admin** | Destacar, ocultar y leer reportes. En el modelo y en las reglas; sin panel propio |

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
