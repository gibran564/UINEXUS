# Arquitectura — UINexus

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

La arquitectura deja la puerta abierta a **UINexus Apps** —proyectos con
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

### UINexus no ejecuta Skills

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
