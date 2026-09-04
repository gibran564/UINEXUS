# Estrategia de seguridad — UINexus

El problema de fondo: **UINexus aloja y ejecuta código que no controla**, subido
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
puede escribir cookies con `Domain=.uinexus.mx` ("cookie tossing"): hoy UINexus
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
acceso al documento padre. El JavaScript se ejecuta y no tiene nada de UINexus
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
   a la de UINexus. No obtendría credenciales reales (`form-action 'self'`
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

UINexus no ejecuta nunca el contenido de una Skill. No hay `exec`, ni shell, ni
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

UINexus **no visita** las URL que se pegan. Pedir metadatos a un sitio arbitrario
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
que el contenido ajeno no puede sacar a nadie de UINexus ni abrir diálogos que
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
