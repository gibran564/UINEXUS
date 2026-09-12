# Estrategia de seguridad — Nextudio

El problema de fondo: **Nextudio aloja y ejecuta código que no controla**, subido
por decenas de estudiantes, algunos de los cuales lo generaron con IA sin leerlo.
Todo lo demás se deriva de ahí.

## 1. Aislamiento por origen — la defensa principal

Todo lo demás en este documento es defensa en profundidad. Esto es la defensa.

```
uinexus.mx                  →  sesión de Firebase Auth, tokens en IndexedDB
uinexus-projects.web.app    →  HTML y JavaScript de alumnos
```

Si el HTML de un alumno se sirviera desde `uinexus.mx`, su JavaScript tendría
el mismo origen que la sesión de quien lo está mirando: podría leer el token de
Firebase de IndexedDB, publicar en nombre de esa persona, borrarle proyectos y
reconstruir la interfaz para pedirle la contraseña. Nada de eso lo impide una
CSP; lo impide la política de mismo origen.

**Decisión: dominio registrable distinto, no subdominio.** Se descartó
`projects.uinexus.mx` a propósito. Un subdominio comparte el dominio padre y
puede escribir cookies con `Domain=.uinexus.mx` ("cookie tossing"): hoy Nextudio
no usa cookies de sesión —Firebase Auth guarda el token en IndexedDB, aislado
por origen completo— pero el día que se añada una, el subdominio se convierte
en un agujero y la migración ya no será barata. Se elige el límite correcto
ahora, cuando no cuesta nada.

`web.app` está en la [Public Suffix List](https://publicsuffix.org/), así que
`uinexus-projects.web.app` **ya es un dominio registrable distinto** de
`uinexus.mx`: el navegador no permite cookies compartidas entre ambos. Sirve
para producción sin comprar nada. Si se prefiere una marca propia, registrar
`uinexus-projects.app` y apuntarlo al mismo sitio de Hosting.

**Limitación conocida:** los proyectos comparten origen entre sí. El proyecto A
puede leer el `localStorage` que dejó el proyecto B. Para un contexto académico
es aceptable; el aislamiento por proyecto exigiría un subdominio por proyecto
con certificado comodín. Está anotado en [LIMITATIONS.md](LIMITATIONS.md).

## 2. Capas, y quién manda en cada una

| Capa | Dónde | Qué hace | ¿Es autoridad? |
|---|---|---|---|
| Formulario | Navegador (`lib/files.ts`) | Mensajes de error entendibles antes de subir | **No** |
| ID token de Firebase | `lib/server/session.ts` | Demuestra **quién** pide algo | **Sí** |
| Autorización | `lib/server/session.ts` | Decide **si puede**: perfil, rol, suspensión, propiedad | **Sí** |
| Invariantes de escritura | `lib/server/writes.ts` | Campos inmutables, campos de staff, coherencia del índice | **Sí** |
| Permiso de subida firmado | `lib/aws/s3.ts` + S3 | Ruta, extensión, Content-Type y tamaño máximo | **Sí** |
| IAM / OAC | AWS | Sólo CloudFront puede leer el bucket de proyectos | **Sí** |
| Metadato del objeto | S3 | El Content-Type se fija al subir, derivado de la extensión | **Sí** |
| Origen aislado | CloudFront Function + KeyValueStore | Resolución de rutas y estado publicado | **Sí** |
| Response Headers Policy | CloudFront | CSP, `nosniff`, `Referrer-Policy`, `noindex` | **Sí** |

La validación del navegador nunca decide nada. Si alguien la salta con la
consola abierta, tropieza con las mismas comprobaciones en el servidor.

## 3. Cabeceras del contenido de alumnos

Las aplica una **Response Headers Policy** de CloudFront a todo el origen aislado:

| Cabecera | Valor | Qué evita |
|---|---|---|
| `Content-Type` | De una **lista blanca por extensión del servidor** | Que un `.txt` con etiquetas se ejecute como HTML |
| `X-Content-Type-Options` | `nosniff` | Que el navegador reinterprete el tipo |
| `Content-Security-Policy` | `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'self' https://uinexus.mx` | Plugins, reescritura de rutas base, formularios de phishing hacia fuera, clickjacking |
| `Referrer-Policy` | `no-referrer` | Fuga de la URL del proyecto |
| `Permissions-Policy` | cámara, micrófono, ubicación, pagos, USB desactivados | Que un proyecto pida permisos del dispositivo |
| `Cross-Origin-Resource-Policy` | `cross-origin` | (permite embeber; documentado a propósito) |
| `X-Robots-Tag` | `noindex, nofollow` en **todo** el origen | Que el HTML crudo compita con la ficha del proyecto y que un enlace privado acabe en Google |

La CSP es deliberadamente permisiva con recursos externos: los alumnos usan
CDNs de tipografías y librerías, y romperlos convertiría la plataforma en
inservible. Cierra en cambio lo que daña a terceros. El aislamiento por origen
es lo que hace aceptable esa permisividad.

## 4. Vistas previas dentro de la plataforma

Dos situaciones distintas y dos tratamientos distintos:

**Proyecto ya publicado** (`ProjectPreview`)
`<iframe src="https://uinexus-projects.web.app/…" sandbox="allow-scripts allow-popups allow-forms">`
Sin `allow-same-origin`: el documento recibe un **origen opaco**, sin cookies ni
almacenamiento propio. Además **no se carga hasta que la persona pulsa**: abrir
una ficha no debería ejecutar el código de nadie.

**Borrador, antes de publicar** (`lib/preview.ts`)
Los archivos todavía están en el navegador, así que no hay origen aislado donde
ponerlos. Se compone un documento autocontenido —CSS, imágenes y JS locales
incrustados— y se muestra con `sandbox="allow-scripts"`.

La garantía la da lo que **no** está en ese atributo. Sin `allow-same-origin` el
documento recibe un **origen opaco**: sin cookies, sin `localStorage`, sin
acceso al documento padre. El JavaScript se ejecuta y no tiene nada de Nextudio
que leer. Tampoco puede navegar la ventana de arriba ni abrir ventanas, porque
`allow-top-navigation` y `allow-popups` tampoco están.

Hasta septiembre de 2026 el sandbox era `""`, que además prohíbe los scripts.
Se cambió porque el coste era desproporcionado: una página que se dibuja con
JavaScript —casi todas— aparecía como un rectángulo blanco, y una vista previa
que no enseña la página no cumple su función. La restricción tampoco compraba
gran cosa frente al riesgo real: **quien mira el borrador es quien acaba de
subir el archivo**. El caso peligroso, alguien viendo el proyecto de otra
persona, ocurre en el origen aislado, que ya ejecuta con `allow-scripts`.

Los scripts que apuntan a una CDN se cargan de la red; los locales se incrustan,
porque los archivos aún no están servidos en ninguna parte.

## 5. Archivos

**Lista blanca de extensiones**, no lista negra. Repetida en tres sitios que
deben cambiar juntos: `lib/constants.ts`, `storage.rules`, `functions/src/index.ts`.
Permitido: `html htm css js mjs json map txt md csv xml svg png jpg jpeg gif webp
avif ico bmp woff woff2 ttf otf mp4 webm ogg mp3 wav pdf`.

**Path traversal.** `sanitizeRelativePath()` en el cliente y
`normalizeAssetPath()` en la función rechazan `..`, rutas absolutas, dobles
barras, bytes nulos, segmentos que empiezan por `.` (`.git`, `.env`,
`.htaccess`) y caracteres de control. La función además **decodifica dos veces**
para atrapar `%252e%252e`. Las reglas de Storage repiten el patrón.

**Límites.** 10 MB por archivo, 50 MB y 300 archivos por versión, 30 MB por
`.zip`, 3 MB por portada. Storage aplica los límites por objeto y
`finalizeProjectVersion` vuelve a enumerar y validar la versión completa antes
de publicarla. Los totales que envía el navegador no son autoridad.

**Descompresión.** El `.zip` se abre en el navegador de quien sube, no en el
servidor: una bomba de descompresión afecta a su propia pestaña, no a la
infraestructura, y cada entrada se valida antes de subirse.

## 6. Autorización: de reglas declarativas a código de servidor

Éste es **el cambio más importante de la migración a AWS**, y conviene no
suavizarlo.

Con Firestore, el navegador escribía directamente en la base de datos y las
reglas eran la única autoridad. Una regla es difícil de olvidar: se aplica
sola, a toda escritura, la escriba quien la escriba.

En AWS el navegador no tiene credenciales de DynamoDB ni de S3. Pide, y el
servidor decide. Eso cierra por completo una clase de ataque —ya no existe una
superficie de escritura directa que un cliente manipulado pueda explorar— pero
abre otra: **una comprobación en código es fácil de olvidar**, porque hay que
escribirla en cada ruta nueva.

La defensa contra ese riesgo es estructural:

1. **Un solo sitio donde mirar.** Toda decisión de autorización vive en
   `lib/server/session.ts`. Las rutas no improvisan comprobaciones.
2. **Las escrituras enumeran los campos que tocan.** `lib/server/writes.ts`
   nunca vuelca el objeto que llegó por la red. Ese detalle es lo que hace
   imposible cambiar `ownerId` mandándolo en el cuerpo.
3. **El identificador del dueño sale del token, no de la petición.** Al crear
   un proyecto, `ownerId` y `ownerHandle` se toman del actor verificado. No hay
   ningún campo del cuerpo capaz de influir en ellos.
4. **La visibilidad es un índice, no un filtro.** Ver más abajo.

### Lo que sigue estando garantizado

- **Nadie se auto-asciende.** El rol se lee de la tabla de usuarios, nunca del
  token ni del cuerpo. El esquema del endpoint de perfil ni siquiera acepta el
  campo `role`.
- **Nadie se auto-destaca.** `featured`, `hiddenByAdmin`, `reportCount` y
  `views` no aparecen en ningún esquema de entrada del alumnado.
- **La URL es inmutable.** `ownerId`, `ownerHandle`, `slug` y `createdAt` no se
  reasignan nunca después de crear el proyecto. Una entrega académica conserva
  su enlace.
- **Los borradores ajenos responden 404, no 403.** Confirmar la existencia de
  un borrador ajeno ya sería filtrar información.
- **Los `unlisted` son inalcanzables por consulta.** El índice `byStatus` es
  **disperso**: sus claves sólo se escriben en proyectos publicados y no
  ocultados. Un `unlisted` no está *dentro* del índice, así que ninguna
  consulta puede devolverlo — ni por error de programación ni a propósito.
  Esto es **más fuerte** que la regla de Firestore que sustituye, que dependía
  de que quien escribiera la consulta se acordara de filtrar.
- **Las subidas no eligen su ruta.** El navegador manda un nombre relativo; la
  clave de S3 la construye el servidor con el uid del token. El límite de
  tamaño lo aplica S3 mediante la condición `content-length-range` del POST
  firmado, no una promesa del cliente.
- **Los reportes requieren sesión.** `reporterId` sale del token y el estado
  nace siempre `open`: quien reporta no resuelve su propio reporte.

### Lo que se perdió por el camino

Las reglas venían con una suite de pruebas que las ejercitaba contra un
emulador. Esa suite se ha eliminado porque probaba un sistema que ya no existe.
La autorización actual **no tiene todavía pruebas de integración
equivalentes**; sólo se prueba la lógica pura. Está anotado como regresión real
en [LIMITATIONS.md](LIMITATIONS.md), y es lo primero que habría que recuperar.

## 7. Privacidad

Nunca salen del servidor: el correo, el teléfono, el UID de Firebase, las
rutas internas de S3 y `entryFile`.

Con Firestore hacía falta mantener colecciones `publicProfiles` y
`publicProjects` duplicadas, porque una regla puede conceder o negar un
documento entero pero no ocultar campos sueltos. Aquí el navegador no lee la
base de datos: lee lo que devuelve el servidor, y `toPublicProject()`
(`lib/data/mappers.ts`) es la única frontera. La duplicación desaparece, y con
ella el riesgo de que las dos copias se desincronicen.

La identidad pública de una persona es su `handle`. El perfil sólo muestra lo
que esa persona escribió.

## 8. Lo que este diseño NO resuelve

Honestamente:

1. **Proyectos entre sí.** Comparten origen; A puede leer el `localStorage` de B.
2. **Phishing visual.** Un proyecto puede dibujar una pantalla de login idéntica
   a la de Nextudio. No obtendría credenciales reales (`form-action 'self'`
   impide enviarlas fuera, y no hay campos reales que capturar), pero la
   apariencia es imitable. Mitigación real: moderación y reportes.
3. **Contenido ilegal o abusivo.** Se resuelve con personas, no con cabeceras:
   reportes, ocultación por staff y suspensión de cuenta.
4. **Cuota histórica por cuenta.** Cada versión tiene límites duros, pero no se
   suma el almacenamiento de todos los proyectos de una persona.
5. **Rate limiting real.** App Check está integrado en el cliente, pero la
   aplicación obligatoria se debe activar sólo después de observar métricas en
   producción. No hay un límite propio por usuario y minuto.

Ver [LIMITATIONS.md](LIMITATIONS.md) para el plan sobre cada punto.


## Permisos del aula (iteración 2)

Toda la autorización de materias, tareas y entregas vive en
`src/lib/server/course-access.ts`. Un único archivo, por la misma razón que
`session.ts`: una comprobación repartida por veinte rutas es una comprobación
que alguien olvidará en la veintiuna.

| Quién | Puede | No puede |
|---|---|---|
| Estudiante | ver sus materias, las tareas publicadas que se le asignaron, y sus propias entregas; editar su borrador; entregar | ver entregas de otros, crear o modificar tareas, exportar resultados, ver la lista de sus compañeros |
| Docente de la materia | administrar tareas, ver la lista, leer entregas, revisar, exportar | tocar materias que no imparte |
| Docente de OTRA materia | nada sobre esta | igual que un desconocido: 404 |
| Administración | lo que ya tenía; entra como docente para resolver incidencias | — |

Cuatro invariantes que se sostienen en código y no en la interfaz:

1. **404, no 403.** Confirmar que una materia o una tarea existe pero no es tuya
   ya permite enumerarlas.
2. **El tipo de entrega lo dicta la TAREA**, nunca el cuerpo de la petición. Es
   lo que impide mandar un AI Worklog donde se pidió una investigación.
3. **No hay dónde escribir «de quién».** El id de la entrega se deriva del UID
   del token verificado, así que «editar la entrega de otro» no es algo
   prohibido: es algo que no se puede expresar.
4. **Toda URL guardada se valida** y sólo se acepta `http`/`https`. Un
   `javascript:` almacenado y luego pintado en un enlace es XSS almacenado, y
   aquí se guardan enlaces que otra persona va a abrir. `z.string().url()` no
   basta: lo acepta.

El CSV exportado antepone `'` a las celdas que empiezan por `= + - @`: son
respuestas escritas por terceros y Excel las evaluaría como fórmulas al abrir
el archivo.


## Actividad colaborativa y Skills (iteración 3)

### Quién puede escribir qué apartado

La regla vive en `canAnswerGroup()` (`src/lib/data/academic.ts`) y la aplica el
servidor en `guardCollaborativeAnswers()` (`src/lib/server/academic-writes.ts`)
antes de guardar:

- Modo individual → cualquiera responde todo.
- Concepto **sin** responsables → abierto a todo el grupo. La ausencia de
  restricción significa «para todos», nunca «para nadie», igual que
  `assignedTo: null` en la propia tarea.
- Concepto **con** responsables → sólo ellos.

Las respuestas a apartados ajenos se **descartan en silencio** en lugar de
rechazar la petición entera. Es intencionado: un formulario legítimo puede
arrastrar el `questionId` de un concepto que la docente reasignó mientras el
alumno tenía la pestaña abierta, y responder 422 lo dejaría sin poder guardar lo
que sí es suyo. Lo que no le corresponde no se guarda; lo que sí, se guarda
entero.

Nótese que esto no protege la entrega de otra persona —eso ya es imposible,
porque el id de una entrega se deriva del UID de quien la manda—, sino algo más
sutil: contestar apartados ajenos **dentro de la entrega propia**, que
ensuciaría la vista conjunta con aportaciones que nadie pidió.

### Visibilidad entre estudiantes

`canSeeOthers()` decide, y el filtrado ocurre **antes de serializar**: con
visibilidad «sólo la propia», las aportaciones ajenas no llegan al navegador, no
es que lleguen y se oculten.

### Skills: por qué los comandos no se sanean

Nextudio no ejecuta nunca el contenido de una Skill. No hay `exec`, ni shell, ni
PowerShell, ni terminal remota, ni instalación automática, ni descarga de
ejecutables. Los comandos se guardan tal cual y se pintan como código con un
botón de copiar.

Sanearlos sería seguridad de mentira: estropearía comandos legítimos y sugeriría
una defensa sobre algo que no corre. Lo que **sí** se valida, en servidor y con
el mismo esquema que el resto del proyecto, son los **enlaces** —repositorio,
sitio oficial y pasos de tipo `link`—, porque ésos sí se pintan como `href` y sí
puede pulsarlos alguien: sólo `http` y `https`, y siempre con
`rel="noopener noreferrer"`.

### Recursos acotados a su materia

`assertResourcesBelongTo()` comprueba al guardar que un prompt o una Skill
referenciados pertenecen a la materia de la tarea. Sin esa comprobación, conocer
un id bastaría para colgar en una tarea el prompt de otro grupo, y la biblioteca
de una materia dejaría de ser suya. Se aplica también a los recursos que un
AI Worklog declara haber usado.

### El registro de uso de IA no abre superficie nueva (iteración 12)

El bloque `ai_worklog` de un NexBook (NexIA) **no ejecuta nada**: no llama a
ningún modelo, no guarda claves de API y no transmite prompts a ningún servicio.
Lo que sí hace es viajar por las tres fronteras por las que un documento sale de
la plataforma —snapshot de entrega, publicación y `.nexbook`—, así que se le
aplica la misma regla que a todo lo demás:

- **`publishableWorklogBlock` lo reconstruye campo a campo.** Ni `{ ...block }`
  ni `{ ...worklog }`. Un campo que alguien añada al modelo mañana **no** sale
  hasta que se añada ahí, y añadirlo es el momento de preguntarse si debería.
- **`resourcesUsed` sale vacío.** Son ids internos de Skills, prompts y recursos
  de una materia: fuera de ella no significan nada y dentro son un mapa de qué
  existe. Vacío y no ausente, para que lo exportado siga validando.
- **`conversationUrl` pasa por `safeMarkdownUrl`**: sólo `http` y `https`. No se
  inspeccionan los parámetros de servicios externos buscando «secretos» —no se
  puede saber cuáles lo son, y la persona decidió registrar ese enlace—. Una URL
  firmada de Nextudio no puede llegar ahí: ese campo lo escribe quien rellena el
  formulario, y el esquema exige HTTP(S).
- **Las capturas son referencias, nunca bytes**, y usan el almacén de assets de
  siempre: misma clave por persona, mismos MIME (PNG, JPEG, WebP; **sin SVG**) y
  la misma regla de que **la autorización de lectura la da el DOCUMENTO que
  referencia el asset**, no el asset. `collectAssetIds` e `imageMimeTypeFor`
  conocen el sitio nuevo: si no lo conocieran, una publicación serviría de llave
  para leer imágenes que no forman parte de ella.

Lo fijan pruebas que inyectan un UID, un token de Firebase, una credencial de
AWS, una cookie y una URL firmada dentro del bloque y comprueban que ninguno
aparece en la publicación ni en el archivo exportado.

### Datos del NexBook dentro del sandbox (iteración 13)

El código del alumnado puede leer hojas, imágenes y outputs del documento
(`nex.sheet`, `nex.image`, `nex.output`). Eso amplía **qué** puede leer un
Worker; no amplía **hasta dónde** puede llegar.

```
correcto:   S3 → ruta autorizada → navegador con sesión → Data Bridge → Worker
prohibido:  Worker → fetch → S3 / internet
```

- **El Worker sigue sin red.** `jsglobals` es un objeto vacío y congelado, así
  que `js.fetch`, `js.XMLHttpRequest`, `js.WebSocket` y `js.EventSource` no
  existen para Python; en R siguen enmascarados `install.packages`,
  `download.file`, `url()` y `webr::install`. Hay una prueba que prepara datos y
  comprueba que **con ellos delante** la red sigue sin existir.
- **Nunca cruza una URL firmada ni una clave de S3.** No es que se filtren: el
  tipo `LabDataset` **no tiene ese campo**. Los bytes de una imagen los descarga
  el hilo principal por `/api/nexbooks/:id/assets/:assetId`, que comprueba que el
  documento sea de quien pregunta **y** que lo referencie.
- **`sanitizeWorkerRun` reconstruye el dataset campo a campo**, igual que el
  resto del mensaje, aunque venga de una función que ya lo construye. Una
  garantía que depende de que la función de al lado siga comportándose bien no es
  una garantía.
- **El Data Bridge no es una puerta lateral.** Sólo expone lo que la celda
  referenció explícitamente: no hay forma de leer el DOM, el estado de React,
  cookies, el token de Firebase, otro NexBook, otro usuario ni el sistema de
  archivos. La superficie de `nex` es exactamente nueve métodos, y hay una prueba
  que la enumera.
- **Importar un `.xlsx` no abre la red.** El lector es propio (`fflate`) y sólo
  decodifica `workbook.xml`, `styles.xml`, `sharedStrings.xml` y las hojas.
  Macros, VBA, Power Query, conexiones externas y enlaces a otros libros **no se
  abren**: se detectan por el nombre de la entrada para poder avisar, y nada más.
  Sin parser de XML general, XXE y la expansión de entidades no tienen dónde
  ocurrir; una prueba mete un `<!ENTITY>` y comprueba que se queda como texto.


## Workflows y recursos colaborativos (iteración 4)

### Evidencia por paso

Al guardar una entrega con pasos, el servidor:

1. Descarta cualquier `stepId` que no exista en la tarea.
2. Descarta cualquier paso que no le corresponda a quien la manda
   (`canWorkOnStep`).
3. Valida el contenido contra el entregable **que pide el paso**
   (`deliverableSchemaFor`), no contra lo que diga el cuerpo.
4. Acepta `toolId` sólo si está entre los del paso. El NOMBRE de la herramienta
   sí es libre: cuando el paso permite elegir, es el único dato que hay.

Lo ajeno se descarta **en silencio** y no con un 422: la docente puede reasignar
un paso mientras alguien tiene el formulario abierto, y rechazar la petición
entera lo dejaría sin poder guardar lo que sí es suyo.

### Moderación de recursos

El estado (`draft`/`proposed`/`approved`/`rejected`/`archived`) **no se lee
nunca del cuerpo de la petición**. Lo fija `initialAuthorship()` a partir del
rol —el profesorado crea aprobado, el alumnado propone— y lo cambia
`applyModeration()`, que exige ser docente de ESA materia.

Un recurso no aprobado sólo lo ven el profesorado y quien lo propuso; el
filtrado ocurre antes de serializar. Quien propuso algo puede editarlo mientras
siga pendiente, no después: una vez aprobado, cambiarlo por debajo dejaría a la
docente respaldando algo que ya no leyó.

Rechazar y archivar **no borran**. Quien propuso algo tiene derecho a saber qué
pasó con lo suyo.

### Enlaces externos

Nextudio **no visita** las URL que se pegan. Pedir metadatos a un sitio arbitrario
convierte al servidor en un cliente de peticiones arbitrarias (SSRF). El dominio
de una tarjeta se calcula en el navegador a partir del texto.

Tampoco se promete iframe: la mayoría de herramientas lo bloquean con
`X-Frame-Options` o `frame-ancestors`, y prometer un embed que casi nunca
funciona convierte el caso normal en un error aparente. El nivel por defecto es
enlace y tarjeta, siempre con `rel="noopener noreferrer"`.


## Plantillas, enlaces y archivos (iteración 4, segunda parte)

### Plantillas de workflow

Instanciar una plantilla exige ser docente de la materia y que la plantilla esté
**aprobada**: usar una propuesta pendiente la publicaría sin pasar por revisión.
El clonado ocurre en el servidor, de modo que los identificadores nuevos son una
propiedad de la respuesta y no algo que el cliente deba aplicar.

Los responsables se limpian al clonar. Una plantilla puede venir de otra materia
y esos UID no existirían en la actual.

### Recursos referenciados

`assertResourcesBelongTo` exige que el recurso sea de la materia **y** esté
aprobado. Es lo que impide que una tarea recomiende una propuesta pendiente y la
publique por la puerta de atrás.

### Enlaces externos: por qué el servidor no los visita

`describeLink()` reconoce el proveedor mirando el TEXTO de la URL. No hay
`fetch`, ni DNS, ni timeouts. Pedir metadatos a una dirección que elige un
tercero convierte al servidor en un cliente de peticiones arbitrarias (SSRF), con
alcance a servicios internos y al endpoint de metadatos de la nube.

El embed sólo se ofrece para proveedores con URL de incrustación documentada y
cuando la URL concreta tiene la forma correcta: construir el `src` de un iframe a
partir de texto sin comprobar sería inyectar en la página lo que escriba un
tercero. El `sandbox` no concede `allow-top-navigation` ni `allow-modals`, así
que el contenido ajeno no puede sacar a nadie de Nextudio ni abrir diálogos que
parezcan de la plataforma.

### Archivos académicos

Van al bucket **privado**, bajo `academic/{courseId}/{uid}/{assignmentId}/{stepId}/`.

- **La clave la construye el servidor** con datos que ya verificó. El nombre que
  propone el navegador sólo se guarda como etiqueta: si entrara en la ruta, se
  podría escribir en la carpeta de otra persona.
- Sólo se sube a un paso propio (`canWorkOnStep`).
- El límite y los tipos admitidos los dicta el **entregable del paso**, no el
  cuerpo de la petición. Pedir subir un video a un paso que pide una imagen no
  concede el límite de video.
- El tamaño se aplica con `content-length-range` en el POST firmado. Es lo único
  que lo convierte en un límite y no en una promesa del cliente.
- Leer exige una URL firmada de 5 minutos y que el archivo esté **citado en una
  entrega real** de esa tarea. No basta con conocer la clave.
- Sólo se firman claves del prefijo `academic/`: el mismo endpoint no puede
  usarse para leer el código de los proyectos.

Nada se borra en cascada. Ver la tabla de retención en CHECKPOINTS.md.

---

## Identidad institucional (iteración 5)

### Un token válido de Firebase NO es una autorización

Firebase Authentication acepta cualquier cuenta de Google. Nextudio, no: la
comunidad son los correos `@itdurango.edu.mx` más una allowlist docente
explícita (`ALLOWED_SPECIAL_EMAILS`). La regla vive en **un solo sitio**,
`lib/identity.ts`, y la aplican los dos lados:

| Dónde | Qué hace |
|---|---|
| `lib/server/session.ts` · `requireIdentity` | Tras verificar el token, comprueba `decoded.email` y responde **403** antes de leer perfil o tocar nada académico. |
| `lib/auth-session.ts` · `resolveRestoredSession` | Comprueba el correo **antes** de `ensureUserProfile`; si no procede, cierra la sesión de Firebase y lleva a `/login?reason=invalid-domain`. |

El servidor es la garantía; el cliente es la experiencia. Que el navegador
cierre la sesión evita una plataforma inutilizable, pero incluso si no lo
hiciera, ninguna ruta respondería con datos.

### El fallo que esto corrige

La validación vivía sólo en los métodos explícitos de login. Firebase **persiste
la sesión**: al recargar, `onAuthStateChanged` devuelve el usuario sin pasar por
ninguno de ellos. Una cuenta ajena quedaba restaurada como autenticada, con
perfil creado y con todas las llamadas al aula respondiendo 403 desde el otro
lado. Técnicamente había sesión; funcionalmente no había plataforma, y sin
ninguna salida visible.

Por eso la comprobación está en `requireIdentity` y no repartida por las rutas:
es el único punto por el que pasan todas —`requireActor`, `requireWriter`,
`requireStaff`, `requireAdmin` se apoyan en él—, y una comprobación repetida en
treinta endpoints es una comprobación que en alguno se olvida.

### Acceso por teléfono: retirado

Nextudio autoriza sobre el CORREO institucional. Un número de teléfono no puede
demostrar pertenencia a `@itdurango.edu.mx`, y una sesión creada por SMS llegaba
sin correo: exactamente el caso que la política no puede evaluar. Se retiró
—no se deshabilitó a medias— del proveedor de sesión, del formulario y de
`firebase/auth.ts`. El servidor lo rechazaría igualmente, porque un token sin
correo no pasa `isInstitutionalEmail`.

Volvería como **segundo factor** de una cuenta institucional ya verificada
(`linkWithPhoneNumber` sobre el usuario actual), nunca como forma de entrar.

---

## Materiales de la tarea (iteración 5)

Los archivos que el profesorado reparte son un concepto **distinto** de las
entregas, y tienen su propia ruta (`/api/assignments/[id]/materials`) porque sus
dos preguntas de autorización son las contrarias:

|  | Entrega (`/files`) | Material (`/materials`) |
|---|---|---|
| Escribe | El alumnado, en su paso | Sólo docente de la materia |
| Lee | Su autor y el profesorado | Cualquiera con acceso a la tarea |
| Prefijo en S3 | `academic/{materia}/{uid}/{tarea}/{paso}/` | `academic/materials/{materia}/{tarea}/` |

**No se levantó** la restricción que impide al profesorado usar la ruta de
entregas. Fundir las dos en una función habría mezclado dos preguntas de
permiso distintas, que es donde después se cuela el permiso equivocado.

Garantías, en orden de importancia:

- **La clave la construye el servidor.** El nombre del archivo no entra en la
  ruta; sólo se le lee la extensión.
- **Registrar exige una clave de ESTA tarea** (`isAssignmentMaterialKeyFor`).
  Las dos formas de ruta —entrega y material— no pueden confundirse, así que el
  permiso de lectura de una nunca sirve para la otra.
- **Descargar se pide por `id`, nunca por clave.** El servidor toma la clave de
  la propia tarea. Aceptar una clave del cliente convertiría el endpoint en un
  firmador de lecturas para cualquier objeto del espacio académico.
- **Lista blanca por extensión**, con el `Content-Type` fijado por el servidor
  en la condición del POST firmado. Sin `.exe`, `.bat`, `.sh`, `.js`, `.html` ni
  `.svg`: los tres primeros son ejecutables y los dos últimos, contenido activo.
- **Límite de 25 MB** aplicado con `content-length-range`, y un máximo de
  archivos por tarea.
- Los objetos **no se hacen públicos**: se leen con URLs firmadas de 5 minutos.

### Por qué se decide por extensión y no por el `Content-Type` declarado

Para un `.R` el navegador manda el tipo vacío o `application/octet-stream`. Si
decidiera el tipo declarado no habría forma de admitir un fuente de R sin
admitir a la vez cualquier binario. La extensión sólo elige una entrada de una
**tabla cerrada**, y el tipo con el que el objeto acaba guardado lo fija el
servidor a partir de esa misma tabla. Un tipo declarado que no pertenece a la
clase —`text/html` en un documento— se rechaza igualmente.

Formatos legacy (`.doc`, `.xls`, `.ppt`) **quedan fuera**: son contenedores OLE
con macros y no aportan nada que no cubra su equivalente moderno. Es una
decisión, no un olvido.

---

## Código del alumnado (iteración 5)

Nextudio **no ejecuta** el código que se entrega. Ni `exec`, ni `spawn`, ni
`Rscript` en el host de Next.js. Ejecutar código arbitrario en el mismo proceso
que firma las subidas a S3 y lee la base de datos es regalar la plataforma a
quien entregue el `system()` correcto —y un entorno académico es justo donde más
gente va a probarlo—.

Lo que hay es un **adaptador** (`lib/code-runner.ts`) que define qué tendría que
cumplir un sandbox externo: fuera del host, tiempo máximo, salida acotada, sin
red, sin acceso a las variables de entorno de Nextudio, y **sin ningún hueco
donde quepa un comando** —el cliente elige qué código, nunca qué se ejecuta—.
Sin `UINEXUS_CODE_RUNNER_URL` y `UINEXUS_CODE_RUNNER_TOKEN` no hay ejecutor, la
interfaz no ofrece ejecutar y la tarea se entrega igual. La ejecución nunca es
requisito para entregar.

Un `.R` entregado se guarda y se sirve como `text/plain` desde el bucket privado
y otro origen. Es texto que se muestra; no es un programa que corra.

## Ejecución de R y Python (iteración 6)

El código del alumnado ahora **se ejecuta**. Sigue sin ejecutarse en ningún
servidor de Nextudio.

### Dónde corre, y por qué eso es la defensa

En el navegador de quien lo escribió, con Pyodide (Python) y webR (R), dentro de
un Web Worker. El peor programa imaginable sólo puede estropear **su propia
pestaña**. No hay proceso compartido, no hay sistema de archivos del servidor,
no hay red interna, no hay nada de otra persona al alcance.

Lo que el servidor sigue sin hacer —y `tests/unit/code-execution-boundary.test.ts`
lo comprueba leyendo el código fuente, para que nadie pueda añadirlo sin que la
suite se ponga roja—: `child_process`, `exec`, `spawn`, `Rscript`, `python3`,
`subprocess`. Ninguno aparece en `src/`.

### Lo que llega al Worker

Exactamente esto, y el tipo es cerrado:

```ts
{ type: 'run', id, language, source, executionOptions: { maxOutputChars } }
```

No hay hueco para un token de Firebase, una cookie, una credencial de AWS, una
variable de entorno ni el perfil de nadie. `sanitizeWorkerRun()` construye el
mensaje **campo a campo** en vez de reenviar un objeto que venga de arriba,
porque un `...spread` descuidado es la forma exacta en que estos contratos se
rompen. Probado en `code-runner-contract.test.ts`.

### Red: tres capas, y cuál es cuál

**Python.** Pyodide expone JavaScript a Python por UN solo objeto, el que se
pasa como `jsglobals`. Aquí se pasa un objeto vacío y congelado, así que
`js.fetch`, `js.XMLHttpRequest`, `js.WebSocket` y `js.EventSource` no están
«bloqueados»: **no existen** para el programa. Eso arrastra a `urllib` y
`requests`, que en Pyodide van contra `js.fetch`. Es la barrera que se puede
probar, y está probada en `code-engines.test.ts` con Python de verdad.

**R.** El prólogo de `r-engine.ts` enmascara `install.packages()`,
`download.file()`, `url()` y `webr::install()` recorriendo la ruta de búsqueda
entera y los espacios de nombres. Esto es **claridad**, no la barrera: el error
dice por qué en vez de un «no se pudo conectar».

> Detalle que costó encontrarlo: la primera versión enmascaraba sólo en
> `package:base`. Parecía bien y no lo estaba —`install.packages` y
> `download.file` viven en `package:utils`—, así que seguían intactas. Se vio
> comprobándolo en el navegador: `download.file` llegó a imprimir «trying URL
> 'https://example.com'», es decir, **intentó salir a la red**. Por eso ahora se
> recorre `search()` y `asNamespace()`.

**Las dos.** El Worker se endurece tras arrancar el runtime
(`hardenWorkerScope()`): `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` e
`importScripts` pasan a lanzar, e `indexedDB` y `caches` desaparecen. Se hace
*después* de arrancar porque arrancar es justo lo que necesita `fetch` para
traerse el WebAssembly; a partir de ahí no queda ninguna descarga legítima.

### Paquetes

Biblioteca estándar de Python y R base. Nada más. No se llama a `loadPackage`,
no se instala `micropip`, y `install.packages()` está enmascarada. NumPy, pandas
o lpSolve el día que hagan falta serán una **lista blanca declarada en el
código**, nunca un `pip install` que escriba quien entrega la tarea.

### Los runtimes son del propio origen

Pyodide y webR se sirven desde `/runtime/`, no desde `cdn.jsdelivr.net` ni desde
`webr.r-wasm.org`. Monaco se carga del paquete instalado y no del CDN que trae
por defecto `@monaco-editor/react`. Tres razones, por orden: la CSP puede
quedarse en `'self'`; una clase no depende de que un dominio ajeno esté vivo esa
mañana; y la versión que se ejecuta es la que fija `package-lock.json`. Hay una
prueba que falla si alguien vuelve a meter un CDN.

### CSP: qué se auditó y qué se decidió

**La plataforma (`uinexus.mx`) no envía `Content-Security-Policy` hoy, y esta
iteración no la ha introducido.** El resultado de la auditoría es que ejecutar R
y Python **no exige relajar nada**:

- Monaco sale del paquete instalado → ningún `script-src` de terceros.
- Pyodide y webR salen de `/runtime/` → ningún `connect-src` de terceros.
- Los Workers son rutas absolutas del propio origen → `worker-src 'self'` basta.

Es decir: no había ninguna CSP que ajustar, y la funcionalidad no pide abrir
ningún permiso. Escribir la CSP completa de la plataforma —cubriendo Firebase
Auth, S3, las imágenes de Google y los scripts en línea de Next— es un cambio
con su propio riesgo y su propia validación, y no era este sprint. **Queda
pendiente**, anotado en docs/LIMITATIONS.md.

Cuando se active, las directivas que este código necesita son:

```
script-src  'self' 'wasm-unsafe-eval'   ← sin 'wasm-unsafe-eval' no arranca ningún WebAssembly
worker-src  'self' blob:
connect-src 'self'                      ← los .wasm y el vfs de webR salen de /runtime/
```

La única no obvia es `'wasm-unsafe-eval'`. `connect-src 'self'` es además lo que
cierra el repositorio de paquetes de webR: es la barrera real detrás del
enmascarado de `install.packages()`.

Lo que **no** hay que hacer, por si alguien tiene prisa: `script-src *` o
`connect-src *`.

### Los dos sandboxes no son el mismo, y no deben confundirse

| | Publicación de proyectos | Ejecución académica |
| --- | --- | --- |
| Qué corre | HTML/JS que escribió el alumnado | R y Python de una tarea |
| Dónde | `projects.uinexus.mx`, origen aislado | Web Worker del navegador de quien programa |
| Quién lo ve | cualquiera con el enlace | sólo esa persona (y la docente al revisar) |
| CSP | la permisiva de `functions/src/index.ts` | la del origen de la plataforma |

La separación de orígenes de §1 sigue intacta. Una tarea de R **no** publica
nada en `projects.uinexus.mx`, y una página publicada **no** obtiene un
intérprete de Python. Que las dos cosas se llamen «ejecutar» no las hace la
misma, y mezclarlas —servir los runtimes desde el origen aislado, o publicar
proyectos desde la plataforma— rompería las dos garantías a la vez.

### Revisión docente

La docente ve el código en el mismo editor, en sólo lectura, y puede ejecutarlo.
**Ejecutar no modifica la entrega**, y no es una promesa: no hay por dónde. El
editor de la vista de revisión va sin `onChange` y sin `beforeExecute`, así que
no existe ninguna ruta desde ese componente hacia una escritura. La salida se
pinta y se olvida.

El lenguaje lo impone el **servidor** a partir del paso
(`submission/route.ts`): mandar `language: 'python'` en el cuerpo de un paso de
R no lo convierte en Python. Probado en integración.

## Prácticas de programación (iteración 7)

### Una práctica es privada, y eso no lo decide un `if`

`data/workspaces.ts` no tiene **ninguna** función que devuelva prácticas de otra
persona. `ownerUid` es parámetro obligatorio en todas las que leen, así que «ver
la práctica de otro» no está prohibido: es que no hay ninguna firma donde quepa
pedirlo. Es la misma decisión que en `/api/assignments/:id/submission`, donde el
UID sale del token y no del cuerpo.

Tres capas, y las tres se prueban:

1. **El esquema no acepta dueño.** `workspaceInputSchema` descarta `ownerUid`,
   `id`, `context` y `createdAt` si llegan en el cuerpo. El dueño sale del token
   verificado, el id lo genera el servidor y `context` es `personal` porque es lo
   único que existe.
2. **La lectura comprueba el dueño.** `getOwnWorkspace(id, ownerUid)` lee por id y
   devuelve `null` si no coincide.
3. **La escritura lo comprueba en DynamoDB.** `updateOwnWorkspace` y
   `deleteOwnWorkspace` llevan `ConditionExpression: ownerUid = :owner`, así que
   la condición la aplica la base de datos y no el proceso que la llama.

### «No existe» y «no es tuya» se responden igual

Las dos son 404, con el mismo cuerpo. Distinguirlas convertiría la ruta en un
oráculo: probando ids se podría averiguar qué prácticas existen aunque no se
pudieran leer. Está probado comparando las dos respuestas byte a byte
(`tests/integration/workspace-routes.test.ts`).

**No hay ningún rol que abra una práctica ajena.** Ni un compañero de la misma
materia, ni el profesorado, ni un administrador. Una práctica no se revisa; el
camino para enseñar una es convertirla en entrega o en proyecto, no un permiso.

### Java y C: qué significa «no se ejecutan»

Significa que **no hay código que los ejecute**, en ninguna parte. No es un
interruptor apagado: no existe un compilador de Java ni de C en el navegador, y
no se invoca ninguno en el servidor —eso sigue comprobado leyendo el código
fuente en `tests/unit/code-execution-boundary.test.ts`, que falla si alguien
introduce `child_process`, `exec`, `spawn`, `Rscript` o `python3`—.

`languageCapabilities()` devuelve `EDITOR_ONLY` para un lenguaje desconocido,
así que un valor guardado por una versión futura tampoco se ejecuta por
accidente. Y `isBrowserExecutableLanguage` exige **dos** condiciones: que el
catálogo lo declare y que exista un Worker de verdad para él. Marcar Java como
ejecutable por error no arrancaría nada.

### `.html` y `.js` en un paso de código no son una brecha

Ahora se admiten adjuntos en un entregable de código, y siguen guardándose y
sirviéndose como `text/plain` desde el bucket **privado** y a través del origen
aislado. Es texto que se muestra, nunca algo que se sirva para ejecutarse.
Publicar un proyecto sigue pasando por `projects/`, otro prefijo y otro dominio.

Lo que sigue rechazado es lo que un sistema operativo sabría arrancar solo:
`.exe`, `.sh`, `.bat`, `.dll`, `.jar`.

### El código de la portada no ejecuta nada

`components/home/workspace-preview.tsx` es HTML estático con los tokens del
sistema de diseño. No es una captura retocada ni un Monaco de verdad: una captura
promete cosas que el producto puede dejar de hacer, y cargar Monaco en la portada
serían 3 MB para alguien que aún no ha decidido si le interesa el producto.

## NexBook (iteración 8)

### La sesión persistente no relajó ningún aislamiento

Un kernel de NexBook usa el **mismo** Worker, el mismo Pyodide y el mismo webR
que un paso de actividad. Lo único que cambia es un campo del mensaje. Sigue
intacto todo lo de la iteración anterior: `jsglobals` vacío en Python, el prólogo
que enmascara la red y los paquetes en R, el endurecimiento del scope del Worker,
y el payload que sólo lleva `{ language, source, executionOptions, mode }`.

El mensaje creció en un campo y la prueba que cuenta sus claves creció con él.
`mode` por defecto es `isolated`: si fuera `session`, un paso de actividad
empezaría a ver variables de un NexBook abierto en otra pestaña y alguien
entregaría un programa que sólo funciona en su navegador.

Los límites de ejecución son los mismos. Persistente **no** significa `while
True` sin freno: el tiempo excedido sigue terminando el Worker, y por tanto la
sesión. Eso se dice en la interfaz en lugar de dejar un kernel en un estado que
nadie ha inspeccionado.

### Ownership: tres capas, otra vez

1. **El esquema no acepta dueño.** `nexBookPatchSchema` descarta `ownerUid`,
   `id`, `context`, `visibility` y `createdAt` si llegan en el cuerpo. Probado
   comprobando las claves que sobreviven al parseo.
2. **La lectura comprueba el dueño.** `getOwnNexBook(id, ownerUid)`.
3. **La escritura lo comprueba en DynamoDB.** `ConditionExpression` con
   `ownerUid`, así que la condición la aplica la base de datos y no el proceso
   que la llama.

«No existe» y «no es tuyo» son el **mismo 404 con el mismo cuerpo**, comparado
byte a byte en las pruebas. Distinguirlos convertiría la ruta en un oráculo de
qué documentos existen.

### La única lectura sin dueño está acotada

`getNexBookRecord` lee sin comprobar propietario, y existe para dos casos donde
la autorización la da otra cosa: la **plantilla** de una actividad —que pertenece
a la docente pero la lee todo el grupo— y la revisión de una entrega. Quien la
llama ha pasado antes por `requireAssignmentAccess`. Por eso no es la función por
defecto y por eso su nombre no dice «own».

Además comprueba `kind === 'nexbook'`: pedir una práctica de código por esa puerta
devuelve «no existe» en lugar de medio documento.

### Una copia por persona, y de nadie más

El id de la copia se deriva de `(actividad, paso, uid)` y es un hash: no se puede
adivinar la de otro a partir de la propia, y el id no lleva el UID dentro aunque
viaje en la URL. Probado: dos estudiantes de la misma materia trabajan en el
mismo paso y ninguno puede leer, escribir ni borrar la copia del otro; tampoco la
docente.

### La docente no lee el documento vivo del estudiante

Lee el **snapshot** que viajó en la evidencia. Abrir el NexBook vivo de alguien
da 404, y está probado. Dos consecuencias buenas: se califica lo que se entregó y
no lo que haya ahora, y no existe una ruta por la que la revisión pueda escribir
en el trabajo de nadie.

La vista de revisión monta Studio con `editable: false`, que deja el documento sin
botones de añadir, mover ni borrar y sin `onChange` en los editores. Ejecutar una
celda sí se puede —hace falta para comprobar la salida— y no toca nada.

### Markdown: sin HTML crudo

Los bloques de texto se renderizan con el mismo `MarkdownContent` de las
entregas: `skipHtml`, sin `rehype-raw`, URLs por lista blanca HTTP(S) y las
imágenes remotas como enlace. Un documento que una docente reparte a treinta
personas no puede ejecutar el JavaScript de quien lo escribió, y una plantilla
que vuelve como copia de trescientas personas tampoco.

No hay ningún `dangerouslySetInnerHTML` en el proyecto.

### Un documento no puede reventar el item

`documentBytes` (300 KB) se comprueba sobre el JSON serializado, antes de
escribir. Sin ese tope, cien bloques que pasan su límite individual suman cuatro
megas y la escritura falla con «item too large» cuando ya hay noventa bloques
escritos —es decir, con el trabajo hecho y sin poder guardarlo—.

### El formato `.nexbook` todavía no exporta nada

Está diseñado y no implementado, así que **no hay tests de que no filtre
secretos**: una prueba de que un exportador inexistente no filtra nada no prueba
nada. La lista de lo que nunca debe contener está en docs/NEXBOOK.md, y las
pruebas se escribirán con el exportador.

## NexBook modular (iteración 9)

La iteración añadió tres superficies nuevas —binarios que suben, documentos que
salen y archivos que entran— y cambió una garantía existente. Esto último
primero, porque es lo que no se puede pasar por alto.

### `fetch` en el Worker: de «nada» a «sólo lo suyo»

Hasta ahora, al terminar de arrancar el runtime se sustituía `fetch` por una
función que siempre lanzaba. Era correcto **mientras no quedara ninguna descarga
legítima pendiente**, y dejó de serlo al permitir `numpy`, `pandas` y
`matplotlib`: sus ruedas se cargan cuando una celda las importa, no al arrancar,
porque cuál hace falta depende del código.

La regla nueva:

```
✓  /runtime/pyodide/pandas-3.0.2-….whl    mismo origen, prefijo del runtime
✗  https://ejemplo.mx/robar               otro origen
✗  /api/nexbooks/abc                      mismo origen, fuera del prefijo
```

La URL se **resuelve** contra el origen del Worker antes de comparar. Comparar el
texto sin resolver dejaría pasar `https://evil.mx/../runtime/pyodide/x`, que es
la forma clásica de burlar una comprobación de prefijo.

`XMLHttpRequest`, `WebSocket`, `EventSource` e `importScripts` siguen
desapareciendo enteros, y `indexedDB` y `caches` también. Lo que queda alcanzable
son archivos estáticos públicos que ese mismo Worker ya descargó para arrancar:
no hay forma de sacar datos ni de tocar la API de Nextudio.

Sigue sin ser la primera capa. La primera es que Python recibe un `jsglobals`
vacío y congelado, así que el código del alumnado no tiene ni siquiera un `fetch`
al que llamar.

Esto **se descubrió en el navegador**, y sólo ahí: las pruebas del motor no pasan
por el endurecimiento, que sólo tiene sentido dentro de un Worker de verdad.

### Los paquetes de Python no amplían nada

La lista blanca está en el código (`python-packages.ts`), no en lo que escriba
quien resuelve una tarea. `micropip` sigue sin instalarse y `pip` sigue sin
existir dentro del intérprete.

El análisis de imports es deliberadamente simple y **sólo puede equivocarse por
defecto**: un `importlib.import_module("pandas")` no se detecta y el import falla.
Por exceso no puede, que es lo que importaría: sólo devuelve nombres de la lista.

La integridad de las ruedas **no la da la CDN**. Cada una se verifica contra el
`sha256` del `pyodide-lock.json` que instala npm, fijado por `package-lock.json`.
Si la CDN devolviera un archivo distinto, el script para en seco en vez de
publicar código que se va a ejecutar en el navegador de alguien.

Y el lockfile que se publica va recortado a las ruedas presentes: lo que no está
en el directorio no existe para el runtime.

### Subidas de imágenes

| Control | Dónde se aplica |
| --- | --- |
| La ruta | La construye el servidor con el uid del token |
| El tipo | Lista blanca; el servidor fija el `Content-Type` de la subida |
| El tamaño | S3, con `content-length-range` del POST firmado |
| Cuántas | 100 por NexBook, en el esquema del documento |

El tamaño declarado por el cliente **no es la defensa**: sirve para dar un error
legible antes de gastar una subida. La defensa es la condición que aplica S3
sobre los bytes de verdad.

**SVG no se acepta**, y es una decisión y no un olvido. Es XML que puede llevar
`<script>`, `<foreignObject>` y manejadores `on*`; servirlo desde el mismo origen
y pintarlo sería ejecutar código de quien subió el archivo en la sesión de quien
lo mira. Y una publicación la abre cualquiera. Aceptarlo exige un saneador de SVG
que este proyecto no tiene.

### Quién puede leer un asset

No lo decide el asset: lo decide el **documento que lo referencia**.

```
/api/nexbooks/:id/assets/:assetId              hace falta poder abrir ESE NexBook
/api/nexbooks/published/:slug/assets/:assetId  hace falta poder ver ESA publicación
                                               Y que el documento publicado lo use
```

La segunda condición es la que impide que una publicación sirva de llave para
leer cualquier imagen de su autor: sólo salen las que forman parte de lo que se
publicó. Si el autor quita una imagen y actualiza la publicación, esa imagen deja
de poder leerse aunque siga en el bucket.

El `ownerUid` con el que se construye la clave sale del registro, **nunca de la
petición**. Y el identificador de asset se valida como UUID antes de tocar nada:
acaba formando parte de una clave de S3, y una cadena libre del cliente dentro de
una ruta es la forma clásica de escribir donde no se debe.

La URL que ve la página es estable; lo que caduca es la firma de cinco minutos
que hay detrás. Guardar una URL firmada dentro del documento habría convertido un
permiso temporal en permanente, y además habría viajado en cada exportación.

### Lo que sale de la plataforma

`publishableDocument` reconstruye el documento **campo a campo**. No copia y
borra: construye. La diferencia está en el futuro —con una lista negra, un campo
nuevo en el modelo sale publicado sin que nadie haga nada— y es la misma decisión
que toma `sanitizeWorkerRun` con el mensaje del Worker.

Lo usan publicar **y** exportar: los dos sacan el documento fuera de su contexto,
y dos implementaciones habrían acabado discrepando.

Probado con documentos deliberadamente contaminados —`ownerUid`, `lastEditorUid`,
`storageKey`, `apiKey`, `authorization`, `cookie`, `signedUrl` con
`X-Amz-Signature`— y con la publicación de extremo a extremo contra DynamoDB
Local: nada de eso aparece en el resultado, y lo que sí debe salir sale.

Una publicación tampoco lleva el **id del documento vivo**. Importa tanto como el
uid: es la dirección donde esa persona sigue editando.

### Una entrega no se publica

El servidor lo rechaza: sólo se publica un NexBook de contexto `personal`. El
documento de un paso puede llevar instrucciones internas de la materia, datos que
repartió el profesorado o retroalimentación. El camino es «Copiar a mis
prácticas» y publicar la copia.

### `link` no promete lo que no cumple

`link` y `public` se sirven igual. Lo que los distingue es si la dirección se
anuncia, no quién puede leer: el slug es un hash de 24 caracteres. Presentar
`link` como «más privado» sería la promesa que lleva a poner ahí algo que no
debería estar. La interfaz lo dice tal cual: «quien tenga la dirección puede
abrirlo».

### Importar: un contenedor ajeno es hostil

| Amenaza | Defensa |
| --- | --- |
| Zip slip | Lista blanca de rutas —tres formas, nada más— aplicada **antes** de descomprimir |
| ZIP bomb | Tope al envío, al número de entradas y a la suma de tamaños **declarados** |
| ZIP que declara menos de lo que trae | fflate reserva la salida con el tamaño declarado y falla si el flujo produce más |
| Imagen que no lo es | Número mágico de los bytes, no el tipo del manifiesto |
| Versión del futuro | Se rechaza antes de interpretar el contenido |
| Dueño falsificado | El dueño sale del token; el del archivo ni se lee |
| Contexto falsificado | Lo importado nace `personal` y `private` |

Las dos mentiras posibles sobre el tamaño quedan cubiertas: declarar mucho lo
filtra la cabecera, declarar poco lo revienta la descompresión.

Nextudio no escribe estas entradas en un disco —van a S3 con una clave que
construye el servidor—, así que hoy el zip slip no tendría dónde aterrizar. Se
rechaza igual: una defensa que depende de que nadie cambie el destino en el
futuro no es una defensa.

### Las fórmulas de una hoja no son código

Las escribe el alumnado y se guardan en un documento que otra persona abre.
Convertirlas en JavaScript y evaluarlas sería ejecución de código de terceros en
la sesión de quien lo lee.

El intérprete sólo hace aritmética y llama a funciones de una lista cerrada. No
hay acceso a variables, ni a objetos del navegador, ni forma de escribir una
llamada que no esté en la lista. Probado con `=globalThis`, `=constructor`,
`=fetch(...)`, `=process`, `=require("fs")` y
`=[].constructor.constructor("return 1")()`.

### Lo que NO cambió

Sigue intacto todo lo anterior: `jsglobals` vacío en Python, el prólogo que
enmascara la red y los paquetes en R, el payload del Worker montado campo a
campo, `mode` por defecto `isolated`, el tiempo límite que termina el Worker,
ownership en tres capas, el 404 indistinguible, Markdown sin HTML crudo y la
separación `uinexus.mx` / `projects.uinexus.mx`.

El mensaje que viaja al Worker no creció: sigue llevando `{ language, source,
executionOptions, mode }` y su prueba de conteo de claves sigue en pie.

---

## La evolución a Nextudio (fases 1–6)

Ninguna de las seis fases introdujo un modelo de seguridad nuevo. Lo que sigue
son las fronteras que se AÑADIERON, y una revisión de las que ya estaban.

### Búsqueda global (Fase 2)

La paleta no es una fuente de datos: consulta las mismas rutas que ya existían,
con los mismos permisos. Un recurso que no se podía leer por su ruta tampoco
aparece aquí, porque la búsqueda no tiene una ruta propia que saltárselos.

Lo que se buscó explícitamente al revisarla: que un resultado no revele la
EXISTENCIA de algo que no se puede abrir. Como los resultados se construyen
sobre lecturas ya autorizadas, no hay ninguna consulta que devuelva títulos de
cosas ajenas.

### NexIA: la publicación va por lista blanca (Fase 3)

Publicar un NexBook con un registro de uso de IA no serializa el bloque: lo
RECONSTRUYE campo por campo (`publishableDocument`). Es una lista blanca, no un
filtro de exclusión, y la diferencia importa: un campo nuevo en el modelo no se
publica por defecto —hay que añadirlo a la lista— en vez de filtrarse hasta que
alguien se acuerde de excluirlo.

Lo que NO sale, y hay pruebas para cada uno:

```
resourcesUsed        qué prompts y skills de la materia se usaron
ownerUid             y ningún otro identificador interno
conclusionMode       la política académica no es del documento público
propiedades ajenas   lo que no está en la lista, no viaja
```

`conclusionMode` merece su propia línea. La política la pone el profesorado en
la parte; se lee de la definición de la actividad, **nunca** del cuerpo que
manda el navegador. Enviar `conclusionMode: 'none'` en la evidencia no salta la
regla —el esquema acepta el campo porque es legítimo en un documento, y el
servidor lo ignora al decidir—. También se comprueba borrar el bloque: tampoco
es la forma de no contestarlo.

### Data Interop: el puente no abrió el sandbox (Fase 3.5)

Los datos de una hoja se inyectan en el preludio del Worker antes de ejecutar.
El código del alumnado sigue sin poder salir: `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, el DOM, `localStorage`, el token de Firebase y
cualquier cliente de AWS siguen fuera de su alcance, y siguen probados.

Lo que el puente añade es un objeto con datos ya resueltos. No añade una vía de
lectura: el código no puede pedir la hoja de otro documento porque no hay
ninguna función que reciba un identificador ajeno.

**XLSX.** El lector es propio y abre exactamente tres partes del ZIP: el libro,
las hojas y las cadenas compartidas. Macros, VBA, Power Query, enlaces externos
y cualquier otra parte se ignoran sin abrirse. No hay `DOMParser`, así que no
hay XXE. Lo no soportado se avisa; nunca se inventa.

### El sandbox local no puede tocar producción (Fase 3.5)

Dos guardianes, y cada función pública de la semilla llama al suyo:

```
requireLocalSandbox()    prefijo de tablas reservado Y endpoint HTTP loopback
requireLocalFirebase()   proyecto demo-* Y emulador declarado Y sin cuenta de servicio
```

El interruptor que abre el endpoint local exige además
`NODE_ENV === 'development'`. Y `NODE_ENV` en Next es una constante de
COMPILACIÓN: webpack la sustituye dentro del bundle, así que en un build de
producción la rama que permitiría otro endpoint **no existe en el código**. No
es una comprobación que se pueda desactivar en caliente; es una rama eliminada.

Alcance exacto de esa garantía: cubre la variable de Nextudio. El SDK de AWS
honra además las suyas (`AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_DYNAMODB`), que
este código no lee y no puede desactivar sin romper despliegues legítimos —un
endpoint de PrivateLink se configura exactamente así—. No se intenta cerrar
porque no hay nada que cerrar: quien escribe variables de entorno en un
despliegue ya controla ese despliegue. Lo que la guarda impide es lo otro, y sí
importa: que un interruptor pensado para desarrollo, presente en el repositorio
y fácil de copiar por error, redirija la base de datos de producción.

### La plantilla y la copia del estudiante (fases 4 y 5)

```
plantilla docente     t + sha256(assignmentId, stepId)
copia del estudiante  i + sha256(assignmentId, stepId, uid)
```

Los dos identificadores son deterministas, así que «una copia por persona y
paso» es aritmética y no una consulta seguida de una escritura, que es donde se
cuelan los duplicados.

Quién recibe qué lo decide el **servidor** por el rol, no el navegador: la misma
URL devuelve la plantilla al profesorado y su copia al alumnado. Pedir la URL de
la plantilla como estudiante devuelve su copia; escribir en ella responde 404,
indistinguible de «no existe».

Al entregar, el servidor puede recoger el laboratorio que el navegador no mandó
(`lib/server/student-labs.ts`). Sólo mira los de **quien entrega** y sólo los
pasos que le corresponden: sin esa comprobación, la copia de otra persona podría
acabar dentro de una entrega ajena. Hay una prueba que lo intenta.

### La entrega congela una copia (Fase 5)

Lo que se califica es el snapshot que viajó en la evidencia, no el documento
vivo. Seguir trabajando después de entregar cambia el NexLab y no cambia la
entrega. Está probado por integración y por un recorrido de navegador en el que
el estudiante edita después de entregar y la docente sigue viendo lo entregado.

La copia NO se reescribe de forma continua, y ésa es la razón: un autoguardado
del snapshot haría que el congelado dejara de existir sin que nadie lo notara.

### Lo que se volvió a comprobar y sigue igual

| Invariante | Dónde vive |
|---|---|
| Un estudiante sólo escribe en SU entrega | el id se deriva del UID del token |
| «No existe» y «no es tuyo» responden lo mismo | 404 en NexBooks, workspaces y proyectos |
| Concurrencia optimista | `revision` + `ConditionExpression` + 409 con la versión que ganó |
| Markdown sin HTML crudo | `MarkdownContent`; `javascript:` y `data:` rechazados por esquema |
| Archivos por lista blanca | extensión, tipo declarado y tamaño, antes de firmar |
| Claves de S3 que emitió este servidor | `isAcademicFileKeyFor` al guardar una entrega |
| El profesorado no entrega sus propias tareas | 403 explícito en la ruta |
| Fecha límite con el reloj del SERVIDOR | `assertOpenForSubmission` |
