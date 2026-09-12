# Arquitectura — Nextudio

## 0. La marca y los identificadores son dos cosas

El producto se llama **Nextudio** desde la Fase 1 del rediseño. La
infraestructura **sigue diciendo `uinexus`**, y no es un descuido:

| Se lee | Se ejecuta |
|---|---|
| La marca: títulos, portada, barra, pie, mensajes | Los identificadores: tablas, buckets, prefijos, variables, dominios |
| Cambiarla cuesta editar copy | Cambiarlos cuesta migrar datos y romper enlaces ya entregados |
| Es Nextudio | Es `uinexus-*`, `UINEXUS_*`, `uinexus.mx`, `uinexus-nexbook` |

Por eso en este documento —y en el código— conviven las dos formas. La regla
operativa está en `docs/NEXTUDIO-ROADMAP.md` §D2: se sustituye `UINexus` con
capitalización exacta, y **nunca** `uinexus` ni `UINEXUS`.

Los nombres de las experiencias, por si se leen aquí por primera vez:

```
Nextudio            el producto
├── NexLab          el espacio por bloques   →  entidad: NexBook
├── NexCode         el espacio de código     →  entidad: Workspace kind 'code'
└── NexIA           trazabilidad de uso IA   →  entidad: NexBook con un bloque
                                                 `ai_worklog`
```

**NexIA no es una entidad.** No hay `kind: 'nexia'`, ni tabla, ni documento
propio: es un preset que crea un NexBook sembrado, y un bloque más de la unión.
Tampoco ejecuta ninguna IA —no hay proveedor, ni clave de API, ni llamada a
ningún modelo—: lo que hace es **registrar** lo que una persona hizo con una
herramienta de fuera. Ver `docs/NEXBOOK.md`.

## 1. Idea rectora

Dos orígenes, y la frontera entre ellos es la decisión más importante del
sistema.

```
  ┌──────────────────────────────┐        ┌──────────────────────────────┐
  │  uinexus.mx                  │        │  uinexus-projects.app        │
  │  Next.js en Amplify          │        │  CloudFront → S3 (privado)   │
  │                              │        │                              │
  │  · Firebase Auth (identidad) │  ⟂     │  · HTML/JS de alumnos        │
  │  · DynamoDB (metadatos)      │ SOP    │  · Content-Type autoritativo │
  │  · Galería, fichas, panel    │        │  · Bucket privado (OAC)      │
  │  · NUNCA ejecuta HTML ajeno  │        │  · Sin acceso a la sesión    │
  └──────────────────────────────┘        └──────────────────────────────┘
              │                                        │
              └──────────────── S3 ────────────────────┘
                   projects/{uid}/{projectId}/v{n}/**
```

La plataforma guarda **metadatos sociales y académicos**. El origen aislado
**ejecuta el proyecto**. Un proyecto que roba tokens no puede: no comparte
origen con la sesión.

## 2. Piezas

| Pieza | Tecnología | Por qué |
|---|---|---|
| Aplicación | Next.js 15 (App Router), React 19, TypeScript estricto | Server Components para las páginas públicas: la galería es HTML cacheable, no una SPA que descarga la base de datos |
| Autenticación | Firebase Auth (Google y correo/contraseña) | El correo institucional ya es Google en la mayoría de instituciones. Es lo ÚNICO que queda en Firebase |
| Base de datos | DynamoDB | Pago por petición: a escala de un curso cuesta prácticamente cero, sin servidor que dimensionar |
| Archivos | S3 | Subida directa navegador → bucket con POST firmado por el servidor, sin pasar por Next.js |
| Escrituras privilegiadas | Cloud Functions v2 invocables | Finalizan versiones, sincronizan la proyección pública y eliminan en cascada |
| Servido aislado | CloudFront + CloudFront Function + KeyValueStore sobre S3 | Único punto público de lectura del código de alumnos, sin Lambda en el camino |
| Alojamiento | AWS Amplify Hosting | Soporta Next.js con SSR sin configuración apenas |

Todo lo anterior es servicio administrado. No hay contenedores propios, ni
colas, ni caché externa, ni Kubernetes.

## 3. Estructura de rutas

```
src/app/
├── layout.tsx                  AppShell: tema, sesión, navbar, pie
├── page.tsx                    Home (galería, revalidate 300 s)
├── explore/page.tsx            Búsqueda y filtros (estado en la URL)
├── courses/page.tsx
├── courses/[slug]/page.tsx     Galería oficial de una materia (SSG)
├── about/page.tsx
├── login/page.tsx
├── publish/page.tsx            Elegir qué se publica
├── publish/new/page.tsx        Flujo de 5 pasos
├── dashboard/page.tsx
├── dashboard/profile/page.tsx
├── dashboard/[projectId]/edit/page.tsx
├── [handle]/page.tsx           Perfil público  →  /@ana
├── [handle]/[slug]/page.tsx    Ficha del proyecto  →  /@ana/prototipo
├── [handle]/[slug]/preview/    Visor con simulación de dispositivos
├── sitemap.ts   robots.ts   icon.svg
├── not-found.tsx   error.tsx   loading.tsx
```

`[handle]` acepta sólo parámetros que empiezan por `@` (`parseHandleParam`);
cualquier otra cosa cae en `notFound()`, así que también hace de 404 raíz.
Las rutas estáticas (`/explore`, `/courses`…) tienen precedencia sobre
`[handle]`, y esos nombres están además en la lista de handles reservados.

### Qué se renderiza dónde

| Ruta | Modo | Motivo |
|---|---|---|
| `/`, `/courses`, `/courses/[slug]` | Estático + ISR | Contenido público que cambia despacio |
| `/explore`, `/@u`, `/@u/proyecto` | SSR con revalidación | Dependen de consulta o de datos por proyecto |
| `/dashboard*`, `/publish/new` | Cliente | Privado, interactivo, sin valor de indexación |

Las páginas públicas leen **DynamoDB desde el servidor**: el navegador no
descarga ningún SDK de base de datos para ver la galería, y los UID nunca salen
del servidor.

Las escrituras van todas por `/api/*`, que verifica el ID token de Firebase con
el Admin SDK. El navegador **no tiene credenciales de AWS**: ni de DynamoDB ni
de S3. Para subir archivos pide un POST firmado, acotado a una ruta, un tipo y
un tamaño que decide el servidor.

## 4. Modelo de datos

### DynamoDB

Cinco tablas, todas en pago por petición. Se eligieron tablas separadas en vez
del patrón de tabla única porque el coste es idéntico —se paga por petición, no
por tabla— y separadas son mucho más fáciles de leer y de acotar con IAM.

```
uinexus-users      PK uid            GSI byHandle
uinexus-handles    PK handle         reserva atómica del @nombre
uinexus-projects   PK id             GSI byOwner · byPath · byStatus
uinexus-courses    PK id
uinexus-reports    PK id
```

Las proyecciones `publicProfiles` y `publicProjects` que existían en Firestore
**han desaparecido**: hacían falta porque una regla puede conceder o negar un
documento entero, pero no ocultar campos. Aquí el navegador no lee la base de
datos, así que `toPublicProject()` basta como frontera de privacidad.

#### Los tres índices de proyectos

| Índice | Responde a | Nota |
|---|---|---|
| `byOwner` | el panel: mis proyectos, borradores incluidos | ordenado por `updatedAt` |
| `byPath` | la URL pública `/@handle/slug` | por eso handle y slug son inmutables |
| `byStatus` | la galería | **disperso**: los borradores y los `unlisted` no están dentro |

Que `byStatus` sea disperso es la pieza clave. Sus claves (`statusKey`,
`listedAt`) sólo se escriben cuando el proyecto está publicado y no ocultado.
Un `unlisted` no está en el índice, así que ninguna consulta puede devolverlo.
Antes, con Firestore, esa garantía dependía de acordarse de filtrar en la
regla; ahora es estructural.

#### Forma de los elementos

```
users/{uid}
  handle, displayName, avatarUrl, bio, program,
  role: 'student' | 'teacher' | 'admin',
  projectCount, suspended, createdAt, updatedAt

handles/{handle}  ->  { uid }          // unicidad del @nombre

publicProfiles/{handle}
  handle, displayName, avatarUrl, bio, program,
  role, projectCount, createdAt

projectPaths/{handle}/slugs/{slug}
  projectId                              // reserva inmutable de URL

projects/{projectId}
  slug, title, description,
  ownerId, ownerHandle, author { handle, displayName, avatarUrl },
  courseId, courseName, term, group, tags[],
  cover { url, alt } | null,
  projectType: 'html' | 'site' | 'build',
  status:      'draft' | 'published' | 'unlisted' | 'archived',
  brief { problem, goal, process, tools, reflection },
  version, entryFile, fileCount, totalBytes,
  featured, hiddenByAdmin, reportCount, views,
  createdAt, updatedAt, publishedAt

  └── versions/{vN}  { version, entryFile, fileCount, totalBytes, publishedAt }

publicProjects/{projectId}
  slug, title, description, author,
  courseId, courseName, term, group, tags[], cover,
  projectType, status, brief, featured, views, publishedAt, updatedAt

courses/{courseId}
  slug, name, institution, term, description, teacherName,
  studentCount, projectCount, visibility
  └── activities/{id}  { title, description, dueDate }

reports/{reportId}
  projectId, reason, details, reporterId, status, createdAt
```

Tres decisiones que merecen explicación:

- **Los documentos internos no son públicos.** `users`, `handles` y `projects`
  contienen UID, rutas o campos de control. La galería y los perfiles consultan
  `publicProjects` y `publicProfiles`, que son proyecciones sin esos datos.
  `syncPublicProject` vuelve a materializar o retira la proyección ante cualquier
  cambio administrativo del documento interno.
- **La URL tiene una reserva propia.** El alta escribe el borrador y
  `projectPaths/{handle}/slugs/{slug}` en una sola operación. La reserva queda
  como lápida al borrar para que una URL entregada nunca apunte a otro trabajo.

- **`versions` es subcolección, no colección raíz.** Las reglas heredan la
  ruta del proyecto, así que la propiedad se comprueba con un `get` en lugar
  de duplicar `ownerId` en cada versión.
- **El autor se desnormaliza dentro del proyecto.** La galería pinta 24
  tarjetas sin 24 lecturas adicionales de `users`. El precio es reescribir
  proyectos al cambiar el nombre público; es una operación rarísima.
- **`ownerHandle` está además de `author.handle`** para comprobar propiedad y
  construir la URL interna sin depender de la proyección pública.

### S3

```
projects/{uid}/{projectId}/v{n}/**     privado; sólo lo lee la Lambda aislada
covers/{uid}/{projectId}/cover.ext     público, sólo imágenes
avatars/{uid}/**                       público, sólo imágenes
```

Las versiones **no se sobrescriben**: publicar de nuevo escribe en `v{n+1}`.
Después, `POST /api/projects/{id}/finalize` mueve el puntero. Si la subida se
corta, la versión anterior sigue publicada y el cliente pide un `DELETE` sobre
esa misma ruta para limpiar los archivos huérfanos: sin eso, cada intento
fallido dejaría una copia completa del proyecto ocupando el bucket para
siempre.

## 5. Los tres niveles de proyecto

| Nivel | Qué sube | Cómo se procesa |
|---|---|---|
| **1 · Página HTML** | `index.html` suelto, más CSS, JS e imágenes | Se validan uno a uno y se suben tal cual |
| **2 · Sitio completo** | `.zip` | Se descomprime **en el navegador** con `fflate`, se valida cada entrada, se elimina la carpeta raíz común, se localiza el `index.html` más cercano a la raíz |
| **3 · Build estático** | `dist.zip` / `out.zip` de Vite, React, Astro, Svelte… | Idéntico al nivel 2: para la plataforma, un build ya es un sitio estático |

`stripCommonRoot()` existe porque casi todos los `.zip` traen todo dentro de
`mi-sitio/`; sin ese paso el `index.html` quedaría un nivel por debajo y el
proyecto publicado daría 404.

## 6. Node.js: por qué no

No se ejecuta código de servidor de terceros. Aceptarlo abriría ejecución
remota, abuso de CPU, minería, lectura de secretos, procesos persistentes y
toda la superficie de dependencias de npm.

La arquitectura deja la puerta abierta a **Nextudio Apps** —proyectos con
backend desplegados en contenedores aislados sobre Cloud Run— sin que nada del
MVP haya que rehacerse: `projectType` ya es un enum extensible, la ficha ya
está separada de la ejecución, y `liveProjectUrl()` es el único punto que
tendría que aprender a apuntar a otro sitio.

## 7. Sesión, identidad y perfil

```
firebase/config.ts    qué proyecto, qué emuladores, si App Check está activo
firebase/client.ts    una única inicialización perezosa del SDK de cliente
firebase/auth.ts      TODA la conversación con Firebase Auth y sus errores
firebase/profile.ts   creación y sincronización de /users/{uid} y /handles
firebase/functions.ts llamadas tipadas a las operaciones privilegiadas
firebase/admin.ts     Admin SDK, sólo en servidor (`import 'server-only'`)
```

`components/auth/auth-provider.tsx` decide **qué** hacer con la sesión;
`firebase/auth.ts` sabe **cómo** hablar con Firebase. Ningún componente importa
`firebase/auth` directamente: así hay un solo sitio donde traducir los códigos
de error a lenguaje humano, y el bundle del SDK sólo lo descarga quien inicia
sesión de verdad.

El perfil se crea en el **primer inicio de sesión**, no al publicar. Una
transacción crea `users/{uid}`, reserva `handles/{handle}` y materializa
`publicProfiles/{handle}`. Las reglas exigen que las tres escrituras coincidan,
por lo que dos personas no pueden quedarse con el mismo nombre.

La identidad pública es el `handle` (`@christian`). El UID, el correo y el
teléfono se quedan en Authentication: no se copian a DynamoDB ni salen del
servidor (ver `lib/data/mappers.ts`).

## 8. Modo demo

Si faltan las variables de Firebase, `getAdminDb()` devuelve `null` y la capa
de datos sirve el conjunto de ejemplo en memoria. La interfaz completa
funciona, un aviso permanente lo advierte, y ninguna página cambia de código.
Sirve para revisar UX y accesibilidad sin depender de servicios remotos, y para
que cualquiera clone el repositorio y vea algo. En local, `.env.example` apunta
al proyecto reservado `demo-uinexus`; el código rechaza cualquier ID distinto de
ese o de `uinexus-f379f`.


## 9. El aula (iteración 2)

Sobre el hosting de proyectos se monta una capa académica:
`Materia → Grupo → Tareas → Entregas`. No sustituye a nada de lo anterior: una
entrega puede **referenciar** un proyecto ya publicado, y la galería pública
sigue funcionando igual.

```
uinexus-assignments   PK id   GSI byCourse
uinexus-submissions   PK id   GSI byAssignment · byStudent
uinexus-prompts       PK id   GSI byCourse
```

`uinexus-courses` y `uinexus-users` ganan campos, todos opcionales. Las lecturas
los normalizan (`normalizeCourse`), así que un documento escrito antes de esta
iteración se comporta como uno nuevo y **no hay script de migración**.

### Tres decisiones que conviene entender antes de tocar nada

**El `handle` es la moneda de la API del aula.** Igual que en proyectos, el UID
de Firebase no cruza al navegador. El servidor traduce handle → UID contra la
lista de la materia, así que una petición sólo puede referirse a alguien
realmente inscrito. `lib/data/academic-mappers.ts` es la única frontera.

**El id de una entrega es `sha256(assignmentId:uid)` truncado.** Da unicidad
«una entrega por persona y tarea» sin consulta previa ni escritura condicional.
Es un hash y no una concatenación porque el id viaja al navegador.

**Ser `teacher` en el perfil sólo habilita a CREAR materias.** Sobre una materia
concreta manda estar en su lista de docentes. La diferencia entre un rol global
y un permiso por recurso está en `lib/server/course-access.ts`, que es el
`firestore.rules` de esta capa.

### Por qué el aula se pinta en el cliente

El servidor autentica con el ID token de Firebase en la cabecera
`Authorization`, no con una cookie. Un Server Component no tiene ese token, así
que no puede saber quién pide la página. Mientras la sesión sea un token en
memoria del navegador, las pantallas privadas del aula se pintan desde el
cliente contra `/api/*`. La contrapartida: no se indexan ni se prerrenderan,
cosa que a una pantalla privada le da igual.

El aula **no tiene modo demo**: sin identidad no hay materia que enseñar, y las
pantallas lo dicen con todas las letras en vez de fingir datos.


## 10. Aula colaborativa y Recursos IA (iteración 3)

```
uinexus-skills   PK id   GSI byCourse
```

Una tabla nueva. `uinexus-assignments` gana campos, todos opcionales y
normalizados al leer: `collaborationMode`, `contributionVisibility`,
`groupAssignments`, `resources` y un `groupId` estable en cada
`ResearchQuestion`.

### La vista conjunta es DERIVADA

`lib/collaborative.ts` compone el documento a partir de la tarea y de las
entregas, cada vez que se pide. **No hay ningún documento final persistido.**
Guardarlo sería una segunda copia del mismo contenido, y la segunda copia
siempre acaba diciendo algo distinto de la primera.

Es el mismo criterio por el que las proyecciones `publicProjects` de Firestore
desaparecieron al migrar a AWS: si el servidor ya puede componer la vista, la
copia sólo añade formas de desincronizarse.

### No hay edición simultánea, y es deliberado

Cada persona escribe su aportación en su propia `Submission`. Nadie escribe
sobre el registro de nadie, así que no hay conflictos que resolver y no hacen
falta CRDT, transformación operacional ni websockets. Dos personas que
comparten un concepto producen dos aportaciones separadas **con atribución**,
que es justamente lo que un documento compartido de Drive vuelve imposible.

### Los recursos se referencian por id

Una tarea guarda `{kind, id}` y no una copia del prompt o de la Skill. Un
recurso corregido se corrige en todas partes; un recurso borrado deja una
referencia que `lib/server/resources.ts` omite en silencio al resolver, para que
borrar una Skill no vuelva inabrible la tarea que la recomendaba.

### Nextudio no ejecuta Skills

Una Skill es una FICHA. Sus comandos son texto que se muestra y se copia. No
existe en el proyecto ninguna ruta, función ni cola capaz de ejecutar un
comando, y por eso el botón dice «Ver instalación» y nunca «Instalar»: la
etiqueta describe lo que la plataforma hace de verdad.


## 11. Workflows modulares y biblioteca colectiva (iteración 4)

```
uinexus-resources   PK id   GSI byCourse
```

Una tabla nueva. `uinexus-assignments` gana `workflow[]`,
`uinexus-submissions` gana `stepEvidence`, y prompts y skills ganan estado de
moderación y autoría. Todo opcional y normalizado al leer.

### Toda tarea es un workflow al leerla

Es la decisión que sostiene la compatibilidad. `normalizeAssignment` sintetiza
un paso único para cualquier tarea sin `workflow` guardado, derivándolo de su
`type`. El resto del código recorre `workflow` sin preguntarse nunca si la tarea
es «antigua», y por eso **no hay script de migración**.

`LEGACY_STEP_ID` es una constante y no un uuid: la evidencia de las entregas
anteriores se indexa por ese valor, así que cambiarlo dejaría huérfano todo lo
entregado.

Una tarea sencilla se sigue guardando sin `workflow`: sólo se persisten pasos
cuando de verdad hay más de uno. Una tarea creada hoy con el formulario simple
es indistinguible de una creada antes.

### El modelo no conoce las herramientas

`actionType` es una cadena abierta y las herramientas se guardan por NOMBRE
junto al id. No hay `NapkinStep` ni `PerplexityStep`, y una herramienta nueva no
necesita despliegue. Si el catálogo cambia, el paso sigue diciendo «usa
Perplexity», que es lo que necesita entender quien lo lee.

### El cuerpo decide el camino, no el tipo de la tarea

`PUT /api/assignments/[id]/submission` acepta `{ data }` o `{ steps }` y
distingue por la forma. Un formulario antiguo sigue funcionando contra una tarea
que hoy se lee como workflow, sin desplegar cliente y servidor a la vez.

### Biblioteca colectiva

Prompts, Skills y recursos generales viven en tres tablas —sus formas son
distintas y dos ya existían— y se presentan juntos en una sola pestaña. El
alumnado propone, el profesorado aprueba, y la autoría se conserva siempre: una
Skill aprobada sigue diciendo quién la aportó.

## 12. Materiales, plantillas de materia y código (iteración 5)

### Tres conceptos de archivo, no uno

```
Proyecto        projects/{owner}/{id}/v{n}/…          código que se EJECUTA en el origen aislado
Entrega         academic/{materia}/{uid}/{tarea}/…    trabajo de UNA persona, con fecha límite y revisión
Material        academic/materials/{materia}/{tarea}/ lo que REPARTE la docente, lo lee todo el grupo
```

Los materiales cuelgan de la tarea (`Assignment.materials`) y **no viajan en el
cuerpo de la tarea**: se gestionan por su propia ruta. Es lo que hace que
corregir el enunciado no pueda llevarse por delante la plantilla del reporte, y
que subir un archivo mientras alguien edita el título no revierta el título. La
escritura es un `UpdateCommand` sobre un solo atributo, no un `Put` del registro
entero.

Compatibilidad: una tarea sin el campo se lee con `materials: []`. Es la misma
estrategia de siempre —normalizar al leer, migrar al escribir— y por eso no hay
script de migración.

### Las plantillas de materia son DATOS

`lib/workflow-templates.ts` describe procesos —las cinco de Investigación de
Operaciones— como listas de pasos que `templateWorkflowSteps()` convierte en
`WorkflowStep[]` normales. **Nada** en el runner, el constructor o la API sabe
qué es «Investigación de Operaciones»: para todos ellos una tarea creada desde
una plantilla es una tarea de varios pasos como cualquier otra.

Entran en una tarea por un único camino, `instantiateWorkflowTemplate()`, que
delega en el mismo `cloneWorkflowSteps` que las plantillas guardadas en la
biblioteca. De ahí hereda la garantía que importa: **identificadores nuevos**.
`Submission.stepEvidence` se indexa por `stepId`, así que dos tareas que
compartieran ids compartirían la evidencia de sus estudiantes.

Añadir teoría de colas, inventarios o simulación es añadir una entrada a ese
archivo. No hay nada más que tocar.

### El lenguaje de programación es un valor, no un booleano

`StepDeliverable.language` guarda `'r'`, `'python'`, … sobre una unión abierta,
y `PROGRAMMING_LANGUAGES` decide cuál se OFRECE hoy (sólo R). Habilitar el
segundo lenguaje es cambiar un `enabled` y añadir su extensión a
`ACADEMIC_FILE_EXTENSIONS.code`; las entregas ya guardadas no se tocan. Un
`isR` habría obligado a rehacerlas.

`CodeData` guarda el fuente pegado **y** la clave del archivo adjunto, y las dos
conviven: pegarlo es lo que permite revisar sin descargar nada —que es como se
corrigen veinte entregas—, adjuntarlo es lo que permite ejecutarlo. Cada una
resuelve un uso distinto. Nextudio no ejecuta ninguna de las dos (ver
docs/SECURITY.md).

### La política institucional, en un solo sitio

`lib/identity.ts` es la única definición de quién pertenece a la comunidad.
`lib/auth-session.ts` la aplica al restaurar la sesión del navegador —antes de
crear el perfil— y `lib/server/session.ts` la aplica sobre `decoded.email` en
`requireIdentity`, que es el punto por el que pasan todas las rutas. El módulo
de identidad sigue sin declarar lado (ni `'use client'` ni `server-only`) por la
misma razón de siempre: una regla que ambos lados comparten no puede vivir en un
módulo que declara uno.

## 13. Monaco y ejecución de R y Python (iteración 6)

### La decisión de fondo: el navegador, no el servidor

El código del alumnado se ejecuta **en su propio navegador**, con
[Pyodide](https://pyodide.org) para Python y [webR](https://docs.r-wasm.org/webr/)
para R, cada uno dentro de un Web Worker.

Es la única opción que no obliga a elegir entre dos malas. Ejecutarlo en el host
de Next.js —el mismo proceso que firma las subidas a S3 y lee DynamoDB— es
regalar la plataforma al primer `system()` bien puesto. Levantar un servicio de
sandboxes es infraestructura, coste y guardia permanente para una funcionalidad
de clase. En el navegador, el peor programa que alguien pueda escribir sólo
puede estropear **su propia pestaña**, y esa pestaña ya es suya.

El corolario, que conviene tener presente: la ejecución **no es una corrección
automática**. Cada estudiante ejecuta en su máquina, con su CPU y su memoria. La
salida no se guarda ni se compara con nada.

### Un contrato, dos motores, ninguna arquitectura duplicada

```
CodeEditor (UI)                      ← no sabe qué es Pyodide ni webR
  └── browser-code-runner.ts         ← reloj, terminación, estados
        └── Worker (módulo ESM)
              └── worker-bridge.ts   ← traduce mensajes
                    └── python-engine.ts  → Pyodide
                        r-engine.ts       → webR
```

La UI pide `runner.run({ language, source })` y recibe `stdout`, `stderr`,
`status` y una duración. No hay `REditor` ni `PythonEditor`, y no los habrá: el
lenguaje es un **parámetro**, igual que `StepDeliverable.language`. Duplicar el
componente habría duplicado también el autoguardado, el tema, la consola y el
atajo de ejecutar.

`code-runner-contract.ts` es compartido y puro: límites, validación previa y
recorte de salida. Lo usan tanto el ejecutor del navegador como el adaptador de
servidor hacia un sandbox externo (`lib/code-runner.ts`), que sigue sin nadie
detrás y sigue siendo la puerta por si algún día hace falta.

### Por qué el reloj está fuera del Worker

`while True: pass` no atiende mensajes. No existe ningún «cancelar» cooperativo
que funcione en el caso que importa, así que el tiempo límite lo lleva el hilo
principal y su forma de aplicarlo es `worker.terminate()`.

Eso se lleva el runtime entero por delante, y es deliberado: el siguiente
intento paga otro arranque y a cambio empieza en un estado conocido. Con R
además funciona en cascada —webR corre su propio Worker hijo dentro del
nuestro—, que es justo lo que hace terminable un bucle infinito de R.

Límites: fuente ≤ `ACADEMIC_LIMITS.codeMax` (60 KB), salida ≤ 20 000 caracteres,
ejecución ≤ 10 s, arranque ≤ 120 s. El de arranque es aparte porque Pyodide y
webR tardan más en despertar que cualquier programa de clase.

### Los runtimes se sirven desde el propio origen

`scripts/copy-code-runtimes.mjs` copia Pyodide y webR de `node_modules` a
`public/runtime/` antes de `dev` y de `build`, y compila los dos Workers con
esbuild a `public/runtime/workers/`. Son ~60 MB que **no** están en git: la
fuente de verdad ya es `package-lock.json`.

Dos cosas que se descubrieron construyéndolo y que explican esa forma:

- **Los Workers no pasan por webpack.** Next acepta
  `new Worker(new URL(…), { type: 'module' })` y luego lo carga como Worker
  **clásico**, porque emitir módulos exige `output.module` en toda la
  compilación. Pyodide detecta ese caso y se niega a arrancar, con razón: en un
  Worker clásico no hay `import()` dinámico, que es como se cargan los dos
  WebAssembly.
- **De webR hay que cargar `webr.js`, no `webr.mjs`.** La segunda es su
  compilación para Node y conserva un `require` de `"module"` que el navegador
  no resuelve.

El precio de compilar los Workers aparte: editar `src/workers/**` o
`src/lib/code-engines/**` **no** se recarga solo en `next dev`. Hay que volver a
ejecutar `npm run runtimes`.

### El fuente vive en la evidencia de SU paso

Nada nuevo en el modelo: `CodeData.code` dentro de
`Submission.stepEvidence[stepId]`, que es donde ya vivía. Lo que se añadió es el
autoguardado, y lo que lo hace seguro es que la ruta **fusiona por paso** sobre
lo ya guardado: el editor manda sólo el paso que cambió, así que dos pasos de
código no pueden pisarse.

Se guarda con 800 ms de espera tras la última tecla, y **siempre** antes de
ejecutar, de cambiar de paso y de entregar. Ese número decide la frecuencia, no
si se pierde algo.

`StepDeliverable` creció tres campos, todos opcionales y todos normalizados al
leer:

| Campo              | Paso nuevo | Paso guardado antes |
| ------------------ | ---------- | ------------------- |
| `codeMode`         | `editor`   | `either` (lo que ofrecía: fuente pegado + archivo) |
| `starterCode`      | `''`       | `''`                |
| `executionEnabled` | `false`    | `false`             |

El código inicial viaja en el **paso**, no en la entrega. Por eso cambiar la
plantilla no puede pisar el trabajo de quien ya empezó: son dos sitios
distintos, y la copia del alumnado se siembra una sola vez.

## 14. Prácticas, capacidades por lenguaje y reposicionamiento (iteración 7)

### Editar y ejecutar dejan de ser el mismo booleano

Hasta esta iteración el catálogo de lenguajes tenía un solo interruptor,
`enabled`, y era un error de diseño: mezclaba «se puede escribir» con «se puede
ejecutar». Con un único booleano, ofrecer Java en el editor equivalía a prometer
que Java corre, y no corre.

Ahora cada lenguaje declara sus capacidades:

```ts
interface LanguageCapabilities {
  editor: boolean;            // se escribe en Monaco, con su resaltado
  execution: boolean;         // se ejecuta en alguna parte
  browserExecution: boolean;  // ...y esa parte es el navegador (Pyodide, webR)
  remoteExecution: boolean;   // ...o un sandbox remoto que aún no existe
  projects: boolean;          // alimenta un proyecto web publicable
}
```

| Lenguaje | Edición | Ejecución | Runtime | Estado |
| --- | --- | --- | --- | --- |
| Python | ✅ | ✅ | Pyodide, en el navegador | Soportado |
| R | ✅ | ✅ | webR, en el navegador | Soportado |
| Java | ✅ | ❌ | Necesita sandbox remoto | Planeado |
| C, C++ | ✅ | ❌ | Necesita sandbox remoto | Planeado |
| JavaScript, HTML, CSS | ✅ | ❌ | Se ven al publicar el proyecto | Soportado (vía publicación) |
| SQL | ✅ | ❌ | No hay base de datos | Sólo edición |

`languageCapabilities()` devuelve `EDITOR_ONLY` para un valor desconocido. Es lo
prudente ante una tarea guardada por una versión futura: escribir no rompe nada,
ejecutar sí.

**La interfaz dice la verdad.** Cuando una actividad pide ejecución y el lenguaje
no la tiene, el editor muestra «Ejecución no disponible» con el motivo concreto y
**no pinta el botón**. Un botón que no funciona es peor que ningún botón, y una
promesa muda parece una avería.

**La portada se genera desde el catálogo** (`components/home/language-support.tsx`).
Una lista escrita a mano en el landing es una promesa que envejece sola; así, si
alguien apaga la ejecución de R, la portada deja de anunciarla el mismo día.

### El default nuevo no reinterpreta lo viejo

`DEFAULT_PROGRAMMING_LANGUAGE` pasó de `r` a `python`, y por eso hizo falta
`LEGACY_CODE_LANGUAGE = 'r'`: los pasos guardados **sin** lenguaje se crearon
cuando R era el único ofrecido, y leerlos con el nuevo default habría convertido
en Python, de golpe y en silencio, actividades de R ya entregadas. Los caminos de
LECTURA usan el legacy; los de CREACIÓN, el default. Es la misma distinción que
`DEFAULT_CODE_MODE` / `LEGACY_CODE_MODE`.

### Workspace: dónde vive el código que no es una entrega

Hasta ahora todo el código vivía en `stepEvidence[stepId]` de una entrega, lo que
significaba que para probar cinco líneas de Python había que tener una actividad
abierta con fecha límite.

```
Workspace                       tabla propia: uinexus-workspaces
├── ownerUid                    del token verificado, nunca del cuerpo
├── context   personal          activity | project están NOMBRADOS, no implementados
├── language
├── code                        fuente de verdad de un solo archivo
├── files?                      la puerta a varios, opcional
├── courseId                    null si nació suelta
└── createdAt / updatedAt       el índice byOwner ordena por updatedAt
```

**Tabla propia y no una columna en `submissions`** porque no comparten ciclo de
vida: una entrega pertenece a una actividad, tiene fecha límite, se revisa y se
califica; una práctica es de quien la escribió, no caduca y nadie la corrige.
Meterlas juntas obligaría a que cada lectura preguntara «¿esto es entregable?».

**Y no cinco tablas** —`practiceCode`, `editorCode`, `projectCode`…— porque el
concepto general es el mismo: un espacio con un lenguaje y unos archivos. Lo que
cambia es `context`, y hoy sólo existe `personal`. Las actividades siguen
guardando en `stepEvidence` y ahí se quedan: mover eso sería migrar entregas ya
calificadas para ganar una simetría que nadie ha pedido.

### Multi-archivo sin romper nada

`code: string` sigue siendo la fuente de verdad y `files` es **opcional**. Cuando
llegue, `code` será el archivo de entrada —el que se ejecuta— y `files` el resto.
`normalizeWorkspace` **no** inventa `files: {}` al leer: «nunca tuvo varios» y
«los tenía y los borró» son estados distintos, y aplanarlos ahora costaría la
diferencia después.

El esquema de entrada todavía **no** acepta `files`: aceptarlo antes de que el
editor sepa escribirlos crearía registros que ninguna pantalla puede abrir.

### Autoguardado: dos sitios, un contrato

| | Actividad | Práctica |
| --- | --- | --- |
| Dónde | `PUT /api/assignments/:id/submission` | `PATCH /api/workspaces/:id` |
| Granularidad | sólo el paso que cambió | sólo los campos que cambiaron |
| Espera | 800 ms | 800 ms |
| Forzado antes de | ejecutar, cambiar de paso, entregar | ejecutar |

Los dos escriben parcialmente por la misma razón: un `Put` completo desde el
autoguardado sobrescribiría lo que otra pestaña acababa de escribir, y en el caso
del workspace también `createdAt` y `ownerUid`. `updateOwnWorkspace` usa
`UpdateCommand` con `ConditionExpression: ownerUid = :owner`, así que una
práctica ajena no se puede escribir ni por error de programación.

### Proyectos con frameworks: qué se decidió y qué no

Nada. Y es deliberado.

Se evaluaron WebContainers (StackBlitz) y Sandpack (CodeSandbox) para React, Vue
o Vite en el navegador. Las dos funcionan y las dos traen consecuencias que esta
iteración no puede pagar honestamente:

- **WebContainers** ejecuta Node dentro del navegador, pero exige aislamiento por
  origen (COOP/COEP) en toda la página. Eso rompería Firebase Auth, que abre una
  ventana emergente, y el `<iframe>` de la vista previa de proyectos.
- **Sandpack** es más ligero pero empaqueta en un servicio de terceros por
  defecto, o exige alojar el empaquetador propio; lo primero manda el código del
  alumnado a un tercero, lo segundo es infraestructura nueva.
- **Build remoto** es la opción limpia y es exactamente el mismo sandbox remoto
  que necesitan Java y C. Tiene sentido resolverlo **una vez**, no dos.

Conclusión: `RemoteRunner` es la pieza que desbloquea Java, C y los frameworks a
la vez. El contrato ya existe (`CodeRunner` en `code-runner-contract.ts`) y la UI
ya no conoce a su proveedor. Clasificación honesta hoy: **Planeado**, no
«Experimental», porque no hay nada que probar todavía.

## 15. NexBook y NexLab (iteración 8)

La documentación completa está en [`docs/NEXBOOK.md`](NEXBOOK.md). Aquí queda lo
que afecta a la arquitectura general.

> El editor se llamaba **UINexus Studio** hasta la Fase 1 de Nextudio. Hoy el
> nombre visible es **NexLab**; el componente sigue siendo `NexBookStudio` y el
> documento sigue siendo un `NexBook`. Ver `docs/NEXTUDIO-ROADMAP.md` §D3.

### Dónde encaja

```
NexLab (el espacio)
├── NexBook Workspace     ← implementado
└── Project Workspace     ← previsto, no implementado
```

Un NexBook es un `kind` de workspace, no una entidad paralela. Comparte tabla,
índice y patrón de acceso con las prácticas de un solo archivo:

```
uinexus-workspaces (GSI byOwner: ownerUid + updatedAt)
├── kind: 'code'      → title, language, code, files?
└── kind: 'nexbook'   → title, document { blocks, results }, revision, visibility
```

**Una tabla y no dos** porque Prácticas enseña los dos tipos en UNA lista
ordenada por fecha: con dos tablas habría que fusionar y reordenar en memoria y la
paginación dejaría de ser correcta. `kind` ausente se lee como `'code'`, así que
las prácticas guardadas antes siguen abriéndose sin migrar nada.

### El eje nuevo: ejecución con estado

```
CodeRunner       ejecución AISLADA     paso de actividad
NotebookKernel   SESIÓN persistente    celda de NexBook
```

No son dos motores: `NotebookKernel` envuelve al mismo `BrowserCodeRunner`, el
mismo Worker y el mismo Pyodide. Lo único que viaja distinto es `mode` en el
mensaje (`isolated` / `session`), añadido al protocolo sin romperlo —ausente
significa `isolated`, el comportamiento de siempre—.

El aislamiento de Python pasó a implementarse **vaciando `__main__`** antes y
después de cada ejecución aislada, en lugar de pasar un diccionario propio como
`globals`. Es observable desde Python y queda simétrico con el motor de R, que ya
lo hacía así. Un `mode` por defecto distinto de `isolated` habría hecho que un
paso de actividad heredara variables de un NexBook abierto en otra pestaña.

### Concurrencia: la primera entidad con revisión

Es la primera parte de Nextudio con concurrencia optimista. Un NexBook es lo
bastante grande y lo bastante largo de escribir para que «dos pestañas abiertas»
deje de ser un caso raro, y ahí «gana el último en llegar» pierde media hora de
trabajo.

```
PATCH { revision, document }
  ConditionExpression: ownerUid = :owner AND revision = :expected
  → 200  escrito, revision + 1
  → 409  con el documento que ganó dentro
  → 404  no existe, o no es tuyo
```

Las entregas y las prácticas de código siguen con escritura parcial sin revisión:
ahí el conflicto no se da —una entrega se escribe por pasos y un archivo suelto es
un campo— y añadir un contador habría sido ceremonia sin beneficio.

### Ids deterministas para plantillas e instancias

Mismo patrón que `submissionIdFor`, y por las mismas dos razones: la unicidad es
aritmética en vez de «consulta previa más escritura» —donde se cuelan los
duplicados—, y es un hash porque el id viaja en la URL y pegar el UID ahí sería la
fuga que el resto del proyecto evita.

De ahí sale la instanciación perezosa: la copia de cada estudiante se crea la
primera vez que abre el paso, con `attribute_not_exists(id)`, en vez de crear
trescientas al publicar.

### El entregable `nexbook` no sustituye a `code`

```
Step
├── text  file  url  image  video
├── code        ← intacto, con sus modalidades y su starter code
├── nexbook     ← nuevo
└── ai_worklog  structured  project  resource_reference
```

Una actividad que pide veinte líneas de Python sigue usando `code`. `CodeData`
no cambió.

La evidencia de un paso `nexbook` es un **snapshot**, no una referencia: sin eso,
seguir trabajando después de entregar cambiaría lo que se califica.

## 16. NexBook modular (iteración 9)

La documentación completa está en [`docs/NEXBOOK.md`](NEXBOOK.md). Aquí lo que
afecta a la arquitectura general.

### El eje nuevo: cosas que SALEN de la plataforma

Hasta la iteración 8, un NexBook sólo se leía desde dentro. Ahora hay tres
caminos por los que un documento sale, y los tres pasan por el mismo sitio:

```
                      ┌──────────────────────┐
 NexBook vivo  ──────▶│ publishableDocument  │──────▶  publicación
                      │  (lista BLANCA)      │──────▶  archivo .nexbook
                      └──────────────────────┘
```

Reconstruye el documento **campo a campo** en vez de copiar y borrar. Es la misma
decisión que `sanitizeWorkerRun` toma con el mensaje del Worker, y por el mismo
motivo: con una lista negra, un campo nuevo en el modelo sale publicado sin que
nadie haga nada.

La entrega es el cuarto camino y ya existía; su snapshot no pasa por aquí porque
no sale de la plataforma: lo lee la docente de la misma materia.

### Binarios: la primera vez que un documento no se basta a sí mismo

```
NexBook (DynamoDB, ≤300 KB)  ──assetId──▶  S3  nexbook/<ownerUid>/<assetId>.<ext>
```

La clave cuelga de la **persona** y no del documento, y eso es lo que hace
baratas las copias: publicar, entregar o copiar un documento con diez imágenes no
mueve un byte en S3. El precio está anotado en LIMITATIONS: nadie puede borrar en
cascada sin romper la copia de otro.

Quién puede leer un asset **no lo decide el asset**, lo decide el documento que
lo referencia. Es una capacidad, no una propiedad, y es lo que permite que una
publicación enseñe imágenes de otra persona sin darle acceso a nada más.

No hay tabla de assets: todo lo que los identifica cabe en su clave, y una tabla
nueva es un recurso de AWS nuevo.

### Publicaciones: otro `kind` en la misma tabla

```
uinexus-workspaces (GSI byOwner)
├── kind: 'code'                 práctica de un archivo
├── kind: 'nexbook'              documento vivo
└── kind: 'nexbook-publication'  copia congelada          ← nuevo
```

Tercer tipo de item en la tabla y ninguna tabla nueva. El `slug` **es** el id del
item, así que la unicidad la garantiza la clave primaria; y es un hash de
`(dueño, NexBook)` para que «actualizar la publicación» encuentre la que ya
existe sin guardar un puntero en el documento vivo.

La lista de Prácticas filtra este `kind`: si no, cada documento publicado saldría
dos veces y borrar «el segundo» borraría la publicación.

### Las salidas dejaron de ser dos cadenas

```
motor  ──OutputRecorder──▶  secuencia ordenada  ──▶  documento
                        └─▶  stdout / stderr    ──▶  consola de actividad
```

Las dos vistas salen del **mismo registro**, así que no pueden contradecirse. Las
cadenas planas siguen existiendo porque un paso de actividad enseña una consola y
no necesita más; un NexBook lee la secuencia.

El orden real no exigió rediseñar ningún runtime: Pyodide ya llamaba a `stdout`
según el programa escribía y `captureR` ya devolvía un array ordenado. Lo que
faltaba era dejar de tirar esa información.

`NEXBOOK_FORMAT_VERSION` **sigue en 1**: los tipos ricos entraron como valores
nuevos de `stream`, que es lo que V1 dejó preparado.

### El Worker puede volver a pedir cosas, acotadamente

Permitir `numpy`, `pandas` y `matplotlib` rompió una garantía anterior: el
endurecimiento dejaba `fetch` muerto tras arrancar, y `loadPackage` lo necesita
**durante** una ejecución. La regla pasó de «no puede pedir nada» a «sólo puede
pedir sus propios assets», con la URL resuelta contra el origen antes de
comparar. Ver docs/SECURITY.md.

Es el tipo de conflicto que sólo aparece en un navegador: las pruebas del motor
no pasan por el endurecimiento.

### La hoja de cálculo no trae dependencias

Motor de fórmulas y rejilla son código propio. Univer se evaluó y se descartó
—9.9 MB sólo el preset de hojas, 22 presets en el meta-paquete, una capa HTTP en
el árbol y render en canvas— y el criterio que decidió fue la accesibilidad: un
canvas no tiene celdas que un lector de pantalla pueda anunciar.

`SpreadsheetBridge` media entre las hojas y quien las lea, para que conectar
Python y R a una hoja no obligue a que los motores sepan cómo está implementada.
Hoy no están conectados: conectarlos es la **Fase 3.5 — NexLab Data Interop**,
que reutiliza este puente en vez de crear un segundo. Ver
`docs/NEXTUDIO-ROADMAP.md`.

### Leer y editar son dos pantallas

```
NexBookStudio   editar + ejecutar   Monaco, kernel, autoguardado   232 kB
NexBookReader   leer                nada de eso                    167 kB
```

`NexBookReader` no es Studio con `editable: false`. Abrir un enlace público no
puede costar 13 MB de Pyodide ni 46 MB de webR, y un editor de cientos de
kilobytes para enseñar código que nadie va a tocar tampoco.

---

## 17. La evolución a Nextudio (fases 1–6)

Seis fases sobre la base anterior. La regla que las gobierna a todas, y que
conviene leer antes de tocar nada de lo que sigue:

> **Cambia la interfaz, no el motor.**

`Workflow`, `WorkflowStep`, `StepDeliverable`, `StepPrompt`, `StepToolChoice`,
`dependsOnStepIds` y `assignedTo` son los mismos que en la iteración 4. No hubo
`ActivityV2`, ni migración de registros, ni un segundo constructor. Lo que se
añadió fueron **capas de traducción**: módulos puros que convierten entre lo que
una persona quiere decir y lo que el modelo guarda.

```
lib/activity-builder.ts    intención docente  ⇄  modelo académico
lib/student-activity.ts    modelo académico   →  estados y progreso del alumnado
```

Los dos son puros —sin React, sin red— y por eso sus reglas se prueban una a
una en vez de a través de una pantalla.

### 17.1 Las tres experiencias no son tres productos

```
NexCode   Workspace kind 'code'      Monaco sobre un archivo
NexLab    NexBook                    documento por bloques
NexIA     bloque `ai_worklog`        registro de uso de IA, dentro de un NexBook
```

NexIA **no es una entidad**. Es un preset (`lib/nexia-preset.ts`) que crea un
NexBook personal con un bloque de registro, y el mismo bloque puede vivir dentro
de cualquier NexLab. Comparten `AIWorklogData` con el entregable `ai_worklog` de
siempre: un registro es el mismo dato sea la actividad entera o una parte de
cuatro.

### 17.2 NexLab Data Interop: el puente, no un motor nuevo

Una hoja de cálculo se lee desde Python (`nex.sheet("Ventas")`) y desde R
(`nex_sheet("Ventas")`). Lo que hace posible eso es que los datos se preparan
**antes** de ejecutar: el fuente de la celda se analiza en busca de referencias
literales, se resuelven contra `SpreadsheetBridge` y se inyectan en el preludio
del Worker.

De ahí la limitación que no es un descuido: la referencia tiene que ser
literal. `nex.sheet(nombre_variable)` no se puede resolver sin ejecutar primero,
y resolverlo en caliente exigiría `SharedArrayBuffer` con COOP/COEP, que este
origen no tiene. No devuelve datos vacíos: lanza un error que lo explica.

El sandbox de ejecución no se abrió para esto. Ver §17.6 y `docs/SECURITY.md`.

### 17.3 El creador docente: la forma se DERIVA

La pantalla dejó de preguntar por la implementación. No hay «¿un paso o
varios?», ni «tipo de entrega» entre nombres internos: hay **Partes**, y cada
una declara una intención humana del catálogo de `ACTIVITY_ACTIONS`.

Cómo se guarda lo decide `deriveActivity`:

```
ya era un proceso   → proceso            (nunca se degrada)
2 o más partes      → proceso
1 parte que cabe    → su forma antigua
1 parte que no cabe → proceso
```

«Cabe» lo comprueba `legacyEquivalent` campo por campo: la parte no puede
llevar título propio, ni instrucciones, ni prompt, ni herramienta, ni recursos,
ni responsables, ni dependencias, ni pista, ni conclusión obligatoria. Nada de
eso sobreviviría a la lectura antigua, así que su presencia obliga a guardar
como proceso.

Un proceso **no vuelve atrás** aunque se quede con una parte: la evidencia se
indexa por id de parte, y la forma antigua se lee con el paso sintético `main`.

### 17.4 La consecuencia de todo lo anterior, y la que más ha costado

Una actividad `type: 'workflow'` **puede tener una sola Parte**.

```
❌  workflow.length > 1     confunde «una parte» con «ninguna»
✅  assignment.type === 'workflow'
```

Contar partes falla porque la lectura sintetiza una para las actividades
anteriores. Ese error costó tres fallos distintos en tres capas: el formulario
del alumnado se quedaba sin nada que rellenar, el avance docente respondía 409
sobre la pestaña que él mismo ofrecía, y la exportación devolvía «(sin
respuesta)» encima de un laboratorio entero. Por eso `isSingleStep()` se retiró
del código: el nombre invitaba a la decisión equivocada.

### 17.5 La experiencia del estudiante

La pantalla responde cinco preguntas en orden: **qué tengo que hacer → dónde lo
hago → qué llevo → qué me falta → qué voy a entregar.** Nada de lo que se ve
nombra el modelo.

Todos los estados son **derivados**; no hay ningún campo nuevo persistido. El
ciclo de vida sigue siendo el de `Submission`, y el avance dentro del borrador
sigue siendo `stepEvidence`.

La regla que sostiene la capa: *lo que la pantalla llama «lista para entregar»
tiene que coincidir con lo que el servidor deja entregar*. Más permisiva
habilitaría un botón que acaba en 409; más estricta bloquearía una entrega
válida. Hay pruebas que comparan las dos cuentas directamente.

**El laboratorio y la entrega hablan por `lib/server/student-labs.ts`.** Un
NexLab se guarda solo, en su propio documento; la entrega guarda una COPIA
congelada. El servidor dice qué laboratorios llevan trabajo —revisión mayor que
1, que es lo que distingue «abrí la pestaña» de «guardé algo»— y, al entregar,
recoge el que no llegó en el cuerpo. Lo que NO hace es guardar la copia
continuamente: eso destruiría el congelado, que es lo que impide que seguir
trabajando cambie lo que se califica.

### 17.6 El sandbox local

`npm run dev:local` levanta DynamoDB Local, el emulador de Firebase Auth, las
tablas, la semilla y `next dev`. Es lo que permitió por fin probar los
recorridos autenticados, que llevaban siendo deuda desde la primera iteración.

```
requireLocalSandbox()    prefijo de tablas reservado + endpoint loopback
requireLocalFirebase()   proyecto demo-* + emulador declarado
```

El interruptor que abre el endpoint local (`UINEXUS_LOCAL_SANDBOX`) exige
además `NODE_ENV === 'development'`, y `NODE_ENV` en Next es una constante de
COMPILACIÓN: en un build de producción la rama que permitiría otro endpoint
está literalmente eliminada del bundle. De ahí que `npm run prod:local` —la
compilación real servida en local— **no tenga base de datos**: es la
consecuencia de una garantía que vale más que la comodidad de probar.

### 17.7 Qué corre dónde

| | Se carga | Cuándo |
|---|---|---|
| Monaco | NexCode, bloque de código de un NexLab | al abrir el editor |
| Pyodide / webR | al ejecutar una celda | nunca antes |
| Parser de CSV/XLSX | al importar | nunca antes |
| `NexBookStudio` | laboratorio | `next/dynamic`, al abrirlo |

Ninguna ruta los carga de inicio. Lo comprueba el manifiesto de compilación, y
un recorrido de Playwright sobre el build real lo confirma en el navegador.
