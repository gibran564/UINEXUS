# Limitaciones conocidas y mejoras futuras

Lo que sigue son limitaciones reales del código tal y como está, no una lista de
deseos. Cada una dice qué se rompe, cuándo y qué haría falta.

## 1. Limitaciones que importan

### 1.1 La búsqueda no escala

`listProjects()` lee los 500 proyectos publicados más recientes y filtra en
memoria. Con una materia, con diez materias, incluso con un par de años de
historia, funciona bien. Al pasar de ~500 proyectos, la búsqueda deja de
encontrar los antiguos.

**Cuándo importa:** a partir de unos 500 proyectos publicados.
**Qué hace falta:** un índice de texto externo (Algolia, Typesense, o la
extensión de búsqueda de Firebase) alimentado por un trigger de Firestore. La
interfaz no cambia: `ExplorePage` ya devuelve la misma forma.

### 1.2 Los proyectos comparten origen entre sí

Todos viven en `uinexus-projects.web.app/@usuario/proyecto/`. El proyecto A puede
leer el `localStorage` que dejó el proyecto B, porque para el navegador son el
mismo origen.

**Cuándo importa:** si alguien sube un proyecto deliberadamente hostil hacia
otro proyecto. No afecta a la plataforma ni a las sesiones.
**Qué hace falta:** un subdominio por proyecto (`ana-prototipo.uinexus.app`) con
certificado comodín. Es un cambio de infraestructura, no de código: sólo
`liveProjectUrl()` y el enrutado de la función tendrían que cambiar.

### 1.3 No hay cuota acumulada por cuenta

Las reglas de Storage limitan cada archivo (10 MB) y el cliente limita cada
proyecto (50 MB), pero nada suma cuánto ha subido una persona en total.

**Cuándo importa:** una cuenta podría acumular decenas de gigas publicando y
borrando proyectos.
**Qué hace falta:** una función programada que recorra `projects` por
`ownerId`, sume `totalBytes` y marque `suspended` o bloquee nuevas subidas al
pasar un umbral. El campo `suspended` ya existe y ya lo comprueban las reglas.

### 1.4 App Check aún no aplica bloqueo

El SDK inicializa App Check con reCAPTCHA Enterprise cuando recibe una clave de
sitio. El proyecto todavía no tiene esa clave ni la aplicación obligatoria
activada, y no hay límite de "N subidas por minuto y usuario".

**Qué hace falta:** registrar la Web App, observar las métricas, aplicar App
Check por producto y añadir un contador server-side si el patrón de abuso lo
requiere. App Check reduce clientes automatizados; no reemplaza las reglas.

### 1.5 La vista previa del borrador no ejecuta JavaScript

Es una decisión de seguridad deliberada ([SECURITY.md §4](SECURITY.md)), no un
defecto — pero tiene consecuencia real: un proyecto cuyo contenido se genera
enteramente con JS aparece vacío en el paso 3. La interfaz lo dice con todas las
letras, y al publicar se ve completo.

**Qué haría falta para mejorarlo:** un origen aislado que sirva borradores con
un token firmado de corta vida. Es viable; se dejó fuera del MVP porque añade
autenticación a la función de servido.

### 1.6 El `.zip` se descomprime en el navegador

Un `.zip` de 30 MB con miles de entradas puede congelar la pestaña de quien
sube. Que el coste caiga en su propia pestaña y no en la infraestructura es
intencionado, pero la experiencia puede ser mala en un equipo lento.

**Qué hace falta:** mover `stageZipFile()` a un Web Worker. Es un cambio
contenido: la función ya es pura sobre un `File`.

### 1.7 La vista previa reescribe HTML con expresiones regulares

`lib/preview.ts` incrusta CSS e imágenes con regex, no con un parser. Falla en
HTML malformado o en referencias construidas dinámicamente. Sólo afecta a la
vista previa del borrador; lo publicado se sirve intacto.

### 1.8 Desnormalización del autor

`author.displayName` está copiado en cada proyecto. Cambiar el nombre público no
actualiza los proyectos ya publicados.

**Qué hace falta:** un trigger `onUpdate` sobre `users/{uid}` que propague el
cambio. Es raro que ocurra, y por eso no está en el MVP.

### 1.9 El rol de profesor está preparado, no desarrollado

El modelo, las reglas y la interfaz distinguen `teacher` y `admin`, y ambos
pueden ocultar proyectos, destacar y leer reportes desde la consola de Firebase.
Pero **no existe `/admin`**. Se dejó así a propósito: el enunciado pedía no
sobrediseñar esta parte durante el MVP.

### 1.10 La autorización perdió su red de seguridad

Es la regresión más seria de la migración a AWS, y no conviene disimularla.

Con Firestore, la autorización era declarativa: las reglas se aplicaban solas a
toda escritura, y `tests/rules/` las ejercitaba contra el emulador con ~50
escenarios positivos y negativos. Al mover los datos a DynamoDB esas reglas
dejaron de existir, y con ellas sus pruebas.

Hoy la autorización es código de servidor (`lib/server/session.ts` y
`lib/server/writes.ts`). Está concentrada a propósito en un solo sitio, pero
**una comprobación en código es fácil de olvidar en una ruta nueva**, mientras
que una regla no lo era.

Lo que sí se prueba (`tests/unit/`): la resolución de rutas del origen aislado
—path traversal, doble encoding, archivos ocultos, lista blanca de
extensiones— y los atributos de visibilidad que hacen disperso el índice de la
galería. Son lógica pura, y son la parte donde un fallo es directamente un
agujero.

**Lo primero que habría que recuperar:** pruebas de integración de las rutas de
API contra [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html),
con los mismos escenarios que cubrían las reglas: un visitante no lee
borradores, nadie edita el proyecto de otro, nadie cambia `ownerId`, nadie se
asciende a `admin`, nadie enumera los `unlisted`.

### 1.11 El mapa de rutas es un segundo sitio donde vive la verdad

El origen aislado no consulta DynamoDB: lee un CloudFront KeyValueStore que el
servidor actualiza al publicar. Es lo que permite servir desde el borde sin
Lambda, pero introduce dos copias del estado de visibilidad.

Se sincroniza **después** de que la escritura en DynamoDB haya terminado, así
que el fallo posible es acotado y en la dirección segura: si la sincronización
falla, CloudFront se queda con la versión anterior —o sin ruta— mientras la
plataforma ya muestra la nueva. Nunca al revés: no puede quedar publicado algo
que la plataforma cree despublicado.

Aun así, **no hay reconciliación periódica**. Si una escritura al KeyValueStore
falla de forma persistente, la divergencia no se corrige sola. Lo que habría
que añadir: una tarea que recorra los proyectos y reponga las rutas que falten.

## 2. Mejoras futuras, por orden de valor

### Corto plazo

1. **Completar el aprovisionamiento.** Activar Blaze, crear el bucket de
   Storage, habilitar Auth y desplegar Functions, reglas y App Hosting.
2. **Aplicar App Check por etapas.** Registrar la clave, observar métricas y
   activar el bloqueo servicio por servicio.
3. **`/admin` para el profesorado.** Bandeja de reportes, destacar, ocultar,
   suspender. La mitad del trabajo (modelo y reglas) ya está hecha.
4. **Actividades vinculadas a entregas.** El modelo `courses/{id}/activities` ya
   existe; falta que un proyecto pueda declarar `activityId` y que la página del
   curso agrupe las entregas por actividad.
5. **Captura automática de portada.** Una función con Puppeteer que renderice el
   proyecto publicado y guarde la imagen en `covers/`. Hoy hay que subirla a
   mano o conformarse con la portada generada.
6. **Pruebas con lector de pantalla y con estudiantes reales.**

### Medio plazo

7. **Búsqueda con índice externo** (limitación 1.1).
8. **Restaurar una versión anterior.** Las versiones ya se guardan sin
   sobrescribirse; falta el botón que mueva el puntero hacia atrás.
9. **Informe de accesibilidad del proyecto del alumno.** Ejecutar axe sobre cada
   proyecto publicado y devolver el resultado a su autor. Para una materia de
   diseño centrado en el usuario, esto convierte la plataforma en una
   herramienta de enseñanza, no sólo de exhibición.
10. **Exportar la galería de un curso** a PDF o a un sitio estático, para el
   archivo del departamento.

### Largo plazo

11. **UINexus Apps.** Proyectos con backend en contenedores aislados sobre Cloud
   Run, con cuotas duras de CPU y red y sin acceso a la red interna. La
   arquitectura ya lo contempla: `projectType` es un enum extensible y la ficha
   ya está separada de la ejecución.
12. **Un subdominio por proyecto** (limitación 1.2).
13. **Colaboración en un proyecto.** Un `collaborators[]` en el documento y una
    regla de escritura más ancha. Se dejó fuera porque el MVP asume autoría
    individual.

## 3. Lo que se decidió NO hacer

Y se mantiene: chat, mensajería, seguidores, feed algorítmico, comentarios,
"me gusta", insignias, gamificación, editor de código integrado, ejecución
arbitraria de Node.js, microservicios, Kubernetes.

UINexus publica y exhibe proyectos. Cada una de esas funciones tiene un producto
mejor que la haría, y ninguna hace que un alumno publique su página más rápido.


## 4. Limitaciones de la capa académica (iteración 2)

1. **Las rutas de API del aula no tienen pruebas de extremo a extremo.** Se
   prueban las funciones puras donde vive la decisión (`isAssignedTo`, los
   mappers, `resolveMembers`, `progressOf`, la exportación). Comprobar que cada
   `route.ts` llama a la comprobación correcta necesita DynamoDB Local. Es la
   misma limitación que ya existía tras salir de Firestore.
2. **`listCoursesForUser` y `findCourseByCode` hacen `Scan`.** Correcto a escala
   de una institución. Cuando duela, la solución es un índice invertido
   `userId → courseIds`, no una copia de la inscripción en el perfil: dos copias
   de la misma verdad se desincronizan.
3. **El panel de la materia hace una consulta por tarea.** Con 6 tareas son 6
   consultas; el límite por materia está en 200. Si se acerca, hay que paginar o
   precalcular.
4. **Borrar una tarea deja sus entregas huérfanas.** Es deliberado —son trabajo
   de otras personas y un clic no debería destruirlo— pero falta la tarea de
   mantenimiento que las recoja.
5. **La búsqueda de personas para inscribir la puede usar cualquier `teacher`**,
   no sólo docentes de alguna materia. Devuelve únicamente lo que ya es público
   en un perfil.

El estado completo, con lo terminado y lo pendiente, está en
[CHECKPOINTS.md](../CHECKPOINTS.md).


## 5. Limitaciones de la iteración 3

1. **La vista conjunta se recalcula en cada lectura.** Es lo correcto —evita una
   copia desincronizada— pero con muchos conceptos y muchos estudiantes son una
   consulta de entregas y un recorrido en memoria por apertura. Si pesa, la
   solución es caché de lectura, no persistir el documento.
2. **Dos personas que comparten un concepto producen dos aportaciones
   separadas**, no un texto común. Es deliberado (ver docs/ARCHITECTURE.md §10),
   pero conviene saberlo antes de repartir un concepto entre varias personas
   esperando un único párrafo.
3. **Un prompt editado cambia para las tareas que ya lo recomendaban.** El
   AI Worklog guarda por separado el prompt realmente usado, así que el dato que
   se analiza no se pierde; lo que no se conserva es qué recomendaba la docente
   el día de la entrega. Versionar los recursos queda para más adelante.
4. **Las referencias a recursos borrados quedan en el registro** aunque dejen de
   pintarse.
5. **La pila de CloudFormation y la cuenta divergen**: las tablas no tienen
   etiquetas de CloudFormation. Ver CHECKPOINTS.md, «Infraestructura validada».

El estado completo está en [CHECKPOINTS.md](../CHECKPOINTS.md).


## 6. Rendimiento: dónde está el techo (análisis, no optimización)

Nada de esto se ha optimizado, y es deliberado: a la escala actual —una
institución, decenas de materias, treinta y pico personas por grupo— ninguna de
estas rutas duele, y añadir índices especulativos cuesta complejidad hoy a
cambio de un problema que quizá no llegue. Lo que sigue es dónde empezaría a
doler, para que quien lo vea venir sepa qué mirar.

### `listCoursesForUser` — Scan sobre `uinexus-courses`

**Qué hace.** Escanea la tabla entera y filtra en memoria quién está en
`teachers` o `students`.

**Coste.** Lineal en el número de MATERIAS de la institución, no de personas.
Se ejecuta al abrir `/aula` y al leer el perfil.

**Umbral.** Con 50 materias es imperceptible. Con ~1.000 empieza a notarse
(varios MB por Scan, y DynamoDB pagina cada 1 MB). Ese número corresponde a
unos diez años de una facultad mediana.

**Cuando duela.** Un índice invertido `userId → courseIds`, no una copia de la
inscripción en el perfil: dos copias de la misma verdad se desincronizan, y la
que se desincroniza es siempre la que nadie mira.

### `findCourseByCode` — Scan con filtro

**Qué hace.** Escanea buscando el código de 6 caracteres al autoinscribirse.

**Coste.** Igual que el anterior, pero se ejecuta **una vez por persona y
materia**, no en cada pantalla. Treinta y un estudiantes uniéndose a un grupo
son treinta y un Scan en total, repartidos a lo largo de una clase.

**Cuando duela.** Un GSI sobre `code`. Es un índice de una sola clave y sin
proyección extra; sería barato. No se ha hecho porque hoy no hay nada que
arreglar.

### Lectura de un archivo académico — recorre las entregas

**Qué hace.** Antes de firmar la URL de lectura, `GET
/api/assignments/[id]/files` comprueba que la clave esté **citada en una
entrega real**. Para el profesorado eso significa leer las entregas de esa
tarea.

**Coste.** Una consulta al índice `byAssignment` por cada archivo que se abre.
Con 31 entregas es una consulta de unos pocos KB.

**Umbral.** Si una docente abre veinte archivos seguidos revisando, son veinte
consultas. Sigue siendo irrelevante; empezaría a molestar con cientos de
entregas por tarea.

**Cuando duela.** Un índice de claves de archivo, o incluir el `storageKey` en
un atributo consultable de la entrega. **No** sustituirlo por comprobar el UID
dentro de la clave: eso es exactamente lo que la comprobación evita, porque una
clave se puede escribir a mano.

### `buildRoster` y `buildCourseOverview` — una consulta por tarea

**Qué hacen.** Recorren las tareas de la materia y consultan las entregas de
cada una.

**Coste.** Tantas consultas como tareas publicadas, no como estudiantes. Con 6
tareas son 6 consultas; el límite por materia está en 200.

**Umbral.** Una materia con más de ~50 tareas publicadas haría lenta la
apertura del panel.

**Cuando duela.** Precalcular los recuentos al escribir una entrega, o paginar
las tareas. Precalcular introduce un dato derivado que puede desincronizarse:
sólo merece la pena si el panel se vuelve realmente lento.

### `buildWorkflowGroupView` — se recalcula en cada lectura

**Qué hace.** Compone el resultado del grupo a partir de la tarea y las
entregas, sin persistir nada.

**Coste.** Una consulta de entregas más un recorrido en memoria por apertura.

**Cuando duela.** Caché de lectura con invalidación por `updatedAt`. **Nunca**
persistir el documento compuesto: sería una segunda copia del mismo contenido,
y la segunda copia siempre acaba diciendo algo distinto de la primera.
