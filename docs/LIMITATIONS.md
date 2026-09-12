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

11. **Nextudio Apps.** Proyectos con backend en contenedores aislados sobre Cloud
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

Nextudio publica y exhibe proyectos. Cada una de esas funciones tiene un producto
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

## 7. Limitaciones de la ejecución de R y Python (iteración 6)

### La ejecución es del navegador, con lo que eso implica

- **No es corrección automática.** Cada estudiante ejecuta en su máquina, con su
  CPU y su memoria. La salida no se guarda, no se compara con nada y no influye
  en la entrega. Quien quiera evaluar el resultado tiene que ejecutarlo al
  revisar.
- **El primer arranque cuesta.** Pyodide son ~13 MB y webR ~46 MB de
  WebAssembly. La primera ejecución de una sesión tarda entre unos segundos y
  bastante más con red lenta; por eso el runtime se carga sólo cuando alguien
  pulsa Ejecutar, y no al abrir la tarea.
- **Tras un tiempo excedido se paga otro arranque.** Terminar el Worker es la
  única forma fiable de recuperar un bucle infinito, y se lleva el runtime por
  delante. Es preferible a una pestaña congelada en mitad de una clase, pero
  significa que el intento siguiente vuelve a esperar.
- **Sólo biblioteca estándar.** Python estándar y R base. Ni NumPy, ni pandas,
  ni lpSolve. Añadirlos será una lista blanca declarada en el código.
- **Sin gráficos.** `plot()` y `matplotlib` no pintan nada: la consola muestra
  texto. No estaba en el alcance.
- **Sin entrada estándar.** `input()` y `readline()` no tienen de dónde leer.
- **Nada de terminal.** No hay shell, ni sistema de archivos persistente, ni
  procesos.

### Suelo de navegador

webR corre dentro de un Worker anidado (el nuestro arranca el suyo). Eso pide
**Safari 16.4 o posterior**; Chrome y Firefox lo soportan desde hace años. En un
navegador más viejo, R fallará al preparar el runtime —la entrega sigue
funcionando: ejecutar nunca ha sido requisito para entregar—.

### La suite no ejecuta R

Python se ejecuta **de verdad** en las pruebas: `print(2 + 2)` imprime `4` o
`tests/unit/code-engines.test.ts` falla.

R no. webR arranca su Worker pasándole una ruta de Windows a `new Worker`, que
Node rechaza; es un fallo de webR en esta plataforma y no se puede rodear desde
aquí. En consecuencia:

- El motor de R se prueba contra un webR falso, y lo que se comprueba es **todo
  lo que este proyecto escribió**: el canal elegido, el prólogo que bloquea la
  instalación de paquetes, la traducción de `captureR` a stdout y stderr, el
  refugio que se purga siempre y el cierre en `dispose`.
- Lo que no cubre la suite —que webR sepa sumar— se verificó **a mano en el
  navegador** durante la iteración: `cat(2 + 2)` → `4`; un bucle infinito
  cortado a los 10,7 s y ejecutable de nuevo después; `install.packages()`,
  `download.file()` y `url()` rechazados con el mensaje propio.

Ninguna prueba está silenciada. La forma correcta de cerrar este hueco es una
suite de navegador (Playwright), anotada abajo como mejora.

### CSP de la plataforma: pendiente

`uinexus.mx` no envía `Content-Security-Policy`. Esta iteración auditó el asunto
y concluyó que ejecutar R y Python **no exige relajar nada** —Monaco, Pyodide,
webR y los Workers salen todos del propio origen—, así que no había nada que
ajustar. Escribir la CSP completa de la plataforma sigue pendiente; las
directivas concretas que este código necesita están listadas en docs/SECURITY.md
para que quien la escriba no tenga que volver a deducirlas.

### Detalle de despliegue que puede morder

`public/runtime/` **no está en git**: lo genera `npm run runtimes` antes de `dev`
y de `build`. Un despliegue que se salte ese paso arranca bien, publica bien y
falla sólo al pulsar Ejecutar, con un error de preparación del runtime.

Del mismo modo, editar `src/workers/**` o `src/lib/code-engines/**` no se
recarga solo en `next dev`: esos módulos los compila esbuild aparte. Hay que
volver a ejecutar `npm run runtimes`.

## 8. Limitaciones de las prácticas y del soporte por lenguaje (iteración 7)

### Java, C y C++ no se ejecutan

Se escriben, se guardan y se entregan con el mismo editor y el mismo resaltado,
pero no hay compilador. Hace falta el `RemoteRunner`, que no existe. La interfaz
lo dice con el motivo concreto y no pinta el botón de ejecutar.

### Proyectos con frameworks: no implementado, y a propósito

React, Vue, Next o Vite en el navegador siguen sin soporte. La evaluación completa
—WebContainers, Sandpack, build remoto— y por qué ninguna encaja hoy está en
docs/ARCHITECTURE.md §14. El resumen: WebContainers exige COOP/COEP en toda la
página, lo que rompería Firebase Auth; Sandpack manda el código a un tercero o
exige alojar su empaquetador; y el build remoto es el **mismo** sandbox que
necesitan Java y C, así que tiene sentido resolverlo una vez y no dos.

Clasificación honesta: **Planeado**. No «Experimental», porque no hay nada que
probar todavía.

### El workspace es de un solo archivo

`files` está en el modelo y se conserva si un registro ya lo trae, pero el editor
no sabe escribirlo y el esquema de entrada no lo acepta. Una práctica es un
archivo. Multi-archivo necesita, además del modelo: un árbol de archivos en la
interfaz, decidir cuál es el de entrada, y que los runners sepan resolver
`import utils` entre ellos. Nada de eso está hecho.

### Las prácticas no se comparten

Son privadas y no hay interruptor de visibilidad. No se puede enseñar una a la
docente ni convertirla en entrega con un clic: hay que copiar el código al paso
de la actividad. «De práctica a proyecto» describe hoy un recorrido conceptual,
no un botón.

### `context` sólo tiene un valor real

`activity` y `project` están declarados en el tipo pero **no** implementados. Las
actividades siguen guardando su código en `stepEvidence`, que es donde funciona y
está probado. Unificarlos sería migrar entregas ya calificadas.

### Sin ejecución para HTML, CSS y JavaScript dentro del editor

Se editan con resaltado, pero no hay vista previa en vivo en el editor académico.
Para ver un proyecto web hay que publicarlo, que es lo que lo lleva al origen
aislado. Una vista previa en la propia página de Nextudio sería ejecutar HTML del
alumnado en el origen privilegiado, que es exactamente lo que §1 prohíbe.

### La tabla `uinexus-workspaces` hay que crearla

`npm run aws:deploy:infra` la crea desde la plantilla, y
`scripts/ensure-academic-tables.mjs` también. Un despliegue que se salte los dos
deja la sección de prácticas devolviendo error mientras el resto funciona.

### El recorrido autenticado de prácticas no se probó a mano

La API está cubierta por 16 pruebas de integración contra DynamoDB Local
—creación, lectura, escritura parcial, borrado, y que conocer el id no sirve para
leer, escribir ni borrar la de otro—. El recorrido completo en navegador con una
cuenta real necesita Firebase y AWS, y sigue pendiente como el resto de V.2.

## 9. Limitaciones de NexBook V1 (iteración 8)

La lista completa de lo que NexBook no hace está en docs/NEXBOOK.md. Aquí lo que
más probablemente sorprenda.

### El tiempo excedido mata la sesión

Un notebook persistente sigue teniendo tiempo límite (10 s), y la única forma
fiable de recuperar un bucle infinito es terminar el Worker. Eso se lleva la
sesión: **las variables de las celdas anteriores se pierden** y hay que volver a
ejecutarlas. La interfaz lo dice —«El kernel se reinició»— en lugar de dejar que
la celda siguiente falle con un `NameError` inexplicable.

Reiniciar a mano es distinto y sí es baratísimo: vacía el espacio de nombres sin
volver a descargar el runtime.

### Un documento por pestaña, y un aviso en vez de una fusión

Si el mismo NexBook se edita desde dos sitios, la segunda pestaña recibe un 409 y
**deja de guardar**. No se intenta fusionar: combinar dos versiones por bloques
exige decidir qué hacer con un mismo bloque editado en los dos lados, y cualquier
respuesta automática pierde trabajo de alguien. Hay que copiar lo que haga falta y
recargar.

### El orden real de stdout y stderr no se conserva

El runner devuelve los dos flujos ya separados, así que un `print` y un
`sys.stderr.write` intercalados salen agrupados: primero todo stdout, luego
stderr. El modelo (`NexBookOutput.seq`) ya está preparado para el orden real; lo
que falta es que el motor emita eventos en vez de dos cadenas.

### Los outputs se guardan, y ocupan

Se persisten para que reabrir un documento no obligue a reejecutarlo todo, con un
tope de 8 000 caracteres por celda. Un documento con cien celdas muy ruidosas
puede acercarse al presupuesto de 300 KB y entonces el guardado se rechaza con un
mensaje que pide borrar salidas antiguas. No hay botón de «limpiar todas las
salidas» todavía: hay que borrar los bloques o reducirlos.

### Sin gráficos, sin stdin, sin terminal

`plot()` y `matplotlib` no pintan nada: la consola es texto. `input()` y
`readline()` no tienen de dónde leer. No hay shell.

### Bloques: sólo texto y código

No hay `ImageBlock`, `SpreadsheetBlock`, `TableBlock`, `ChartBlock` ni
`AIWorklogBlock`, y tampoco están declarados en el tipo. Un tipo que ninguna
pantalla sabe pintar produce documentos que nadie puede abrir.

*(Vigente en la iteración 8. `image` y `spreadsheet` llegaron en la 9 y
`ai_worklog` en la 12; `ChartBlock` sigue fuera.)*

### Se mueven con botones, no arrastrando

Y es deliberado: un arrastre accesible por teclado es bastante más trabajo que lo
que aporta en un documento de diez bloques. Los botones ↑/↓ funcionan con el
teclado desde el primer día.

### Publicación: modelo sí, interfaz no

`visibility` admite `class`, `link` y `public`, pero **sólo `private` está
implementado** y es lo único que la interfaz ofrece. Cuando llegue, publicar será
un snapshot y para una entrega institucional habrá que «crear una copia
publicable», no publicar la entrega: puede llevar instrucciones internas, datos de
la materia o retroalimentación.

### Reentrega: el esquema la admite, la interfaz no la enseña

Cada entrega escribe su propio snapshot con su revisión y su fecha. Hoy la
evidencia del paso guarda **la última**; conservar el historial completo es añadir
una lista, no cambiar el esquema. No hay interfaz de historial.

### El formato `.nexbook` no existe todavía

Diseñado y versionado desde V1 (`formatVersion`), sin importar ni exportar. Y por
tanto sin tests de que no filtre secretos: probar que un exportador inexistente no
filtra nada no prueba nada.

### El recorrido autenticado no se probó a mano

Las rutas están cubiertas por 18 pruebas de integración contra DynamoDB Local
—privacidad, concurrencia, plantilla frente a copia, aislamiento entre
estudiantes, snapshot inmutable—. Lo que sí se verificó en navegador real fue
Studio y el kernel: bloques, Markdown renderizado, «Ejecución no disponible» en
Java, estado entre celdas (`x = 10` → `print(x * 2)` → `20`) y que reiniciar lo
borra (`NameError`). El recorrido completo con cuentas reales necesita Firebase y
AWS, y sigue pendiente.

### Editar workers o motores no recarga en `next dev`

Ya estaba anotado, y en esta iteración costó tiempo: el navegador puede servir un
Worker viejo desde su caché HTTP después de `npm run runtimes`, y el síntoma es
que el código nuevo «no hace nada». Recarga forzada o comprobar el bundle servido.

## 10. Limitaciones de NexBook modular (iteración 9)

La §9 sigue vigente salvo en tres puntos, que esta iteración resolvió:

- **El orden de stdout y stderr SÍ se conserva** ahora. La información ya estaba
  en los motores y se tiraba al separarla en dos cadenas.
- **Hay botón de limpiar salidas**, por celda y global.
- **`plot()` y `matplotlib` SÍ pintan**, y las tablas de un `data.frame` o un
  `DataFrame` salen estructuradas.

Lo que sigue siendo cierto —y lo nuevo— está aquí.

### Los assets huérfanos no se recogen

Borrar un bloque de imagen, o un NexBook entero, **no borra sus bytes**. Y es
deliberado: las claves cuelgan de la persona y no del documento, así que los
assets se comparten entre un documento y sus copias —una publicación, una entrega
ya calificada—. Borrar en cascada dejaría rota la copia de otro.

La consecuencia buena es que un asset huérfano **deja de poder leerse** en cuanto
ningún documento lo referencia: las rutas de contenido resuelven el tipo leyendo
el documento, y sin referencia devuelven 404. La mala es que los bytes siguen
ocupando sitio en S3 hasta que exista una limpieza periódica, que no existe.

### Los paquetes de Python hay que publicarlos a mano

`npm run runtimes:python` no forma parte de `prebuild`. Un `npm run build` sin
red tiene que seguir funcionando, y una compilación que dependa de que una CDN
esté viva falla los días malos.

El precio: **si nadie lo ejecuta, el despliegue no tiene pandas ni matplotlib**.
`import pandas` falla con un mensaje que lo explica, no a medias, pero falla. Es
un paso de despliegue que hay que recordar.

### La lista de paquetes es corta y no la amplía nadie desde dentro

`numpy`, `pandas`, `matplotlib` y lo que arrastran. No hay `scipy`, `sympy`,
`scikit-learn`, `seaborn` ni `plotly`. Añadir uno son megas que alguien descarga
en la red de un aula, así que se hace con una razón concreta y editando el código.

### La hoja de cálculo es pequeña a propósito

200 filas × 40 columnas, 2 000 celdas con contenido. No hay virtualización, ni
congelar paneles, ni formato de celda, ni gráficos de hoja, ni tablas dinámicas,
ni importación de XLSX, ni macros.

Univer se evaluó y se descartó para esta versión —los números y el motivo están
en docs/NEXBOOK.md—; el que decide es que dibuja en un canvas, y un canvas no
tiene celdas que un lector de pantalla pueda anunciar.

Las fórmulas cubren aritmética, comparaciones, rangos y una veintena de
funciones. **No hay referencias entre hojas**, ni matrices, ni fechas.

### La hoja SÍ habla con Python y con R, con tres condiciones

Desde la Fase 3.5 existe `nex.sheet("Ventas")` en Python y `nex_sheet("Ventas")`
en R, más `nex.image(...)` y `nex.output(...)`. Lo que **no** hace:

**1 · Las referencias tienen que ser LITERALES.** Esto funciona:

```python
ventas = nex.sheet("Ventas")
```

y esto no:

```python
nombre = "Ventas"
ventas = nex.sheet(nombre)      # error explicado, no datos vacíos
```

Los datos se preparan **antes** de ejecutar, leyendo el fuente de la celda: es
lo que permite transferir sólo lo que hace falta en vez de serializar el NexBook
entero hacia el Worker. La alternativa —que el Worker pida datos a mitad de
ejecución— exige `SharedArrayBuffer` y `Atomics.wait`, que a su vez exigen
aislamiento por origen (COOP/COEP) que Nextudio no tiene.

**2 · No hay recálculo automático.** Editar la hoja **no** vuelve a ejecutar
nada. El modelo es explícito: editas los datos, ejecutas el bloque, y ese bloque
lee el estado actual. No hay grafo reactivo y no va a haberlo.

**3 · Un nombre duplicado es un error, no una elección.** Dos hojas llamadas
«Datos» hacen que `nex.sheet("Datos")` falle nombrando a las dos. Elegir la
primera en silencio significaría que añadir una hoja cambia el resultado de una
celda que nadie tocó. `nex.sheet_by_id("...")` nunca es ambiguo.

### El lector de XLSX es propio, y no cubre todo Excel

Está escrito sobre `fflate` en vez de delegarse a una biblioteca (la auditoría
de SheetJS, ExcelJS y `read-excel-file` está en `lib/spreadsheet/xlsx.ts`). Lee
hojas, texto, números, booleanos, fechas, celdas vacías y las fórmulas que el
motor propio sabe evaluar.

**Lo que NO hace, y avisa de ello al importar:** macros y VBA, Power Query,
tablas dinámicas, conexiones externas, enlaces a otros libros, gráficas
embebidas y objetos. Nada de eso se ejecuta ni se decodifica: esas partes del
archivo sencillamente no se abren. **Importar un `.xlsx` no genera tráfico de
red.**

Una fórmula que no se puede convertir **no se inventa ni se evalúa**: se guarda
el último valor que calculó Excel —el `.xlsx` distingue `<f>` de `<v>`— y se
avisa de que ese valor **no se actualizará** si cambian sus datos.

Tampoco se admiten `.xls` antiguos, `.ods`, ni codificaciones distintas de UTF-8
en CSV.

### Un texto que diga «verdadero» llega al código como booleano

Al cruzar hacia Python o R, las celdas cuyo texto sea `VERDADERO`, `FALSO`,
`TRUE` o `FALSO` se convierten en booleanos. Es lo que hace útil una columna
importada de Excel, y el precio es que una celda cuyo contenido sea literalmente
esa palabra también se convierte. La hoja sigue mostrando el texto: la
inferencia ocurre sólo en el puente, no en el motor de fórmulas.

### El código recibe hasta 5 000 filas de una hoja o de un output

Más que suficiente para una práctica y muy por debajo de lo que costaría
serializar una hoja entera hacia el Worker en cada ejecución. El tope de la hoja
en sí sigue siendo 200 filas; éste acota lo que **cruza**.

### Las gráficas dependen de que la subida funcione

Una imagen de salida se guarda como asset. Si la subida falla, el output se queda
sin `assetId` y **se descarta al guardar**: el esquema exige un UUID, y un
documento con una imagen a medias bloquearía todo el autoguardado. La celda lo
dice —«la gráfica se generó pero no se pudo guardar»— y conserva su texto.

### Publicar no tiene historial

Actualizar una publicación **sobrescribe** la anterior. Se conserva `publishedAt`
—«publicado en marzo, actualizado en mayo» dice algo— pero no hay forma de volver
a una versión publicada antes.

### La vista pública no ejecuta

Enseña los resultados que el autor guardó. No hay botón de ejecutar, porque
ofrecerlo significaría descargar un runtime en el navegador de cualquiera que
abra un enlace.

### NexIA registra; no ejecuta IA

El bloque `ai_worklog` **no llama a ningún modelo**. No hay proveedor, no hay
clave de API, no hay BYOK, no hay streaming, no hay RAG y no hay agentes.
Tampoco hay detección automática de uso de IA ni cálculo de «porcentaje
generado»: esas dos cosas no se pueden medir de forma fiable, y una cifra
inventada en un expediente académico es peor que no tener ninguna.

### El registro de IA sólo admite texto, imagen y enlace

Como evidencia de la respuesta se aceptan texto/Markdown, hasta ocho capturas
PNG/JPEG/WebP y un enlace HTTP(S) a la conversación. **No se admite archivo
genérico** —PDF, DOCX, ZIP—: exigiría otra lista blanca de MIME, otro límite de
tamaño y otra decisión sobre cómo se sirve al publicar. Está pendiente, no
improvisado.

### `resourcesUsed` pierde su significado al exportar

`AIWorklogData.resourcesUsed` guarda ids internos de Skills, prompts y recursos
de **una materia**. Al publicar o exportar un NexBook, la lista blanca lo emite
**vacío**: fuera de esa materia esos ids no significan nada, y dentro son un mapa
de qué existe en ella.

La consecuencia honesta es que **esa información semántica no viaja**. Convertir
los ids a nombres legibles exigiría resolverlos contra la materia dentro de la
frontera de publicación —con qué permisos, qué pasa con un recurso borrado, qué
pasa si el documento se exporta años después— y eso es una decisión aparte. Hoy
se pierde, y se dice.

### La vista docente de una entrega no pinta las imágenes del snapshot

Es anterior a NexIA y afecta a **todos** los bloques con imagen: `ImageBlock`,
las gráficas de una ejecución y las capturas de un registro de IA. La vista
docente (`NexBookEvidence`) recibe el snapshot sin forma de resolver assets,
porque los bytes cuelgan del prefijo del estudiante y la ruta de lectura
(`/api/nexbooks/:id/assets/:assetId`) exige ser su dueño. Servirlas al
profesorado necesita una ruta autorizada nueva, y ésa es una decisión de
seguridad con su propio diseño.

Lo que sí hace el registro de IA es **decirlo**: donde hay una captura que no se
puede pintar aquí, se escribe su texto alternativo y el aviso, en vez de dejar el
hueco vacío y hacer creer que no había ninguna.

### `ChartBlock` no existe

Una gráfica generada por código se guarda como **imagen**, no como datos. Eso
significa que no se puede cambiar el tipo de gráfico, ni el rango, ni los colores
sin volver a ejecutar la celda.

### `.nexbook` no interopera con nadie más

Se exporta e importa a sí mismo. No hay `.ipynb`, ni `.qmd`, ni Markdown, ni PDF.
Y un `.nexbook` importado no trae `data/` ni `outputs/`: el contenedor los
contempla y la implementación sólo usa `assets/`.

### El sandbox local no tiene S3

`npm run dev:local` levanta DynamoDB Local y el emulador de Firebase Auth, pero
AWS no tiene emulador de S3 aquí. Consecuencia: **subir imágenes a un NexBook
falla en el sandbox**, y con ellas `nex.image(...)` desde el código. Todo lo que
no toca S3 —hojas, código, outputs, entregas, publicaciones— funciona. Ver
`docs/LOCAL-DEVELOPMENT.md`.

### webR no arranca en cualquier navegador embebido

webR crea un Worker **anidado**, y no todos los navegadores incrustados lo
admiten: fallan con «An error occurred initialising the webR PostMessageChannel
worker», también con código R plano. Es la misma razón por la que R tampoco se
puede ejecutar bajo Node en la suite.

> **Comprobado al cerrar la Fase 6.** En un navegador basado en Chromium el
> Worker anidado arranca y R corre: se ejecutó `r-runner.worker.js` contra un
> `LabDataset` de una hoja y `nex_sheet("Ventas")` devolvió un `data.frame` con
> sus tres filas, `sum(df$total)` dio 360 y `nex_sheets()` listó el catálogo.
> En la misma ejecución `download.file()`, `install.packages()` y `url()`
> siguieron enmascarados con su mensaje. El fallo de arriba es de ciertos
> navegadores incrustados, no del producto.

### Los recorridos autenticados: resuelto en la Fase 3.5

> **Esta sección describía el estado hasta la iteración 12 y se conserva como
> historial.** Desde la Fase 3.5 existe `npm run dev:local`, que levanta el
> emulador de Firebase Auth y DynamoDB Local con una cuenta docente y otra de
> estudiante, y con él ya se recorrieron a mano Aula, la materia, la actividad y
> NexLab ejecutando código sobre datos reales. Ver `docs/LOCAL-DEVELOPMENT.md`.
>
> Lo que sigue siendo cierto: **Playwright no se añadió**, y S3 no está emulado.

Las rutas están cubiertas por **51 pruebas de integración** contra DynamoDB Local
—privacidad, concurrencia, plantilla frente a copia, aislamiento entre
estudiantes, snapshot inmutable, publicación congelada, importación hostil—.

Lo verificado en un navegador real fue Studio y los kernels, con un harness
temporal que montaba el editor sin API. Lo que ese harness **no** cubre: el
autoguardado contra el servidor, la subida real a S3, el conflicto 409, la vista
de publicación servida y el recorrido de entrega. Siguen necesitando Firebase y
AWS.

No se añadió Playwright. Habría hecho falta un entorno de autenticación
controlado que esta suite no tiene, y montarlo a medias —con credenciales de
prueba contra servicios reales— habría sido peor que no tenerlo.

### Editar workers o motores sigue sin recargar en `next dev`

Y volvió a costar tiempo en esta iteración. Tras `npm run runtimes` el navegador
puede seguir sirviendo el Worker anterior desde su caché. La comprobación que
funciona es pedir el bundle con un parámetro que rompa la caché y buscar dentro
el cambio esperado, antes de concluir nada sobre el comportamiento.

---

## 12. Limitaciones del creador docente (Fase 4)

### Una actividad de una parte puede guardarse de dos formas distintas

Y eso es deliberado, no un descuido. Si la parte cabe entera en la
representación anterior —responder, campos, registro de IA, proyecto, enlace— la
actividad se guarda como se guardaba antes, para que abrir y volver a guardar
una tarea de 2025 no la convierta en otra cosa. Si no cabe —laboratorio, código,
archivo, imagen, video, sin entrega— se guarda como actividad por partes.

La consecuencia visible: dos actividades que al profesorado le parecen igual de
simples pueden tener `type` distinto. El resumen previo a publicar lo dice en
llano («Se guardará en su forma sencilla de siempre» / «como una actividad de N
partes») en vez de esconderlo.

La consecuencia invisible, y la que costó una regresión: **la pantalla del
estudiante tiene que decidir por `assignment.type`, no contando pasos.** La
lectura sintetiza un paso para las actividades anteriores, así que contar
confunde «una parte» con «ninguna».

### El título de una parte se completa solo

`workflowStepSchema` exige un título por paso. La interfaz lo ofrece como
opcional, porque pedírselo a quien sólo quiso decir «que trabajen en el
laboratorio» sería pedir dos veces lo mismo. `namedForWorkflow` lo rellena al
guardar: con el título de la actividad si hay una sola parte, con el nombre de su
intención si hay varias. La pantalla avisa de cuál va a ser antes de publicar.

### Un proceso no puede volver a ser una actividad sencilla

Aunque se quede con una sola parte. La evidencia de lo entregado se indexa por el
id de la parte, y devolverla a la forma anterior la haría leerse con el paso
sintético `main`: todo lo entregado dejaría de encontrarse. No hay interfaz para
hacerlo y `deriveActivity` lo impide.

### `resource_reference` ya no se puede elegir

Sigue siendo un entregable válido del modelo y las actividades que lo usan
abren, se editan y se guardan sin perderlo; simplemente dejó de merecer una
tarjeta en el catálogo. Se muestra etiquetado como «versión anterior». Si alguien
elige otra cosa en ese desplegable, lo cambia: es una acción explícita, no una
conversión silenciosa.

### La vista previa no monta el laboratorio

Describe lo que el estudiante encontrará —que se abrirá un NexLab con la
plantilla, y que los bloques marcados como no editables se leen pero no se
tocan—, pero no lo renderiza. Montarlo obligaría a pedirle al servidor la
plantilla, y una vista previa no debería crear nada. La plantilla real se ve
desde «Preparar NexLab», que es donde se edita.

### Las pruebas E2E del aula dependen de `next dev`

> **Matizado en la Fase 6.** Desde entonces existe además
> `npm run test:e2e:prod`, que sirve la compilación real; lo que no puede
> cubrir es el aula, y la razón está en §14.

`npm run test:e2e` corre contra el sandbox local, que sirve con `next dev` y
compila bajo demanda. Es más lento que un `next start` y por eso los plazos son
holgados, pero prueba el mismo entorno en el que se desarrolla. No cubre
producción, y no cubre nada que necesite S3 —imágenes de NexLab, materiales
subidos— porque el sandbox no tiene almacén de objetos.

### La barra de navegación desborda 3 px a 375 px

Hallazgo de esta fase, **anterior a ella y fuera de su alcance**: a 375 px de
ancho, `app-shell/navbar.tsx` deja el documento con `scrollWidth` de 378 px por
el botón del menú. Afecta a todas las pantallas, no sólo al creador. El creador
en sí no desborda: medido, `main` termina exactamente en 375 px.

---

## 13. Limitaciones de la experiencia del estudiante (Fase 5)

### Una Parte de laboratorio se completa por EXISTIR, no por tener contenido

Abrir el NexLab de una Parte crea la copia del estudiante, y eso ya cuenta como
«Completada». Es la misma regla que aplica el servidor al dejar entregar, y
mantenerla igual en los dos sitios es lo que impide que el botón de entregar y
el estado de la Parte se contradigan.

Exigir «suficiente contenido» sería decidir cuándo un trabajo está bien hecho, y
eso es calificar. Nextudio no califica.

### «Ya la hice» se guarda en la nota de la Parte

Una Parte que no pide entrega no tiene forma de completarse sola, así que la
casilla escribe una frase en `note` —el campo que ya existía para lo que quiera
decir quien la hace, y el único que la entrega ya contaba como contenido—.

Consecuencia: borrar la nota devuelve la Parte a «Sin empezar». La casilla no
pisa una nota escrita a mano, pero tampoco puede distinguir «la borré por error»
de «ya no la he hecho».

### El progreso no es un porcentaje

Es un conteo: «2 de 4 partes completadas». Las Partes no tienen peso, así que un
50 % sería una precisión inventada. Si alguna vez existe ponderación real, el
conteo se sustituye; hasta entonces, dice sólo lo que se sabe.

### A un estudiante no se le dice QUIÉN hace las otras Partes

En una actividad repartida, las Partes que no le tocan se ven —existen y forman
parte de la actividad— pero sin estado y sin nombre: «La hace otra persona». No
es una decisión de esta fase: el servidor nunca manda al alumnado los
responsables de un paso (ver `toAssignment`), y esta pantalla no iba a ser la
excepción que abriera ese dato.

### La conclusión obligatoria DENTRO de un NexLab sólo la comprueba el servidor

Un bloque de registro de IA marcado como obligatorio en la plantilla de la
docente se exige al entregar, leyendo la plantilla. El navegador no la tiene, así
que ese rechazo llega del servidor y no aparece en «Todavía falta» antes de
intentarlo. El mensaje dice la Parte y qué falta.

La conclusión de una Parte de NexIA —que es otra cosa— sí se comprueba en los
dos sitios, y las dos cuentas están fijadas por pruebas.

### ~~La barra de navegación sigue desbordando 3 px a 375 px~~ — RESUELTO en la Fase 6

> Se conserva el enunciado porque explica de dónde venía. La causa era la barra
> global, no el contenido del estudiante: `main` terminaba exactamente en
> 375 px. Corregido en la Fase 6; ver §14.

---

## 14. Cierre: qué está resuelto y qué queda (Fase 6)

La última fase del roadmap revisó todo lo anterior. Esta sección dice en qué
quedó cada cosa, para que nadie tenga que reconstruirlo leyendo commits.

### Resuelto en la Fase 6

**El desbordamiento de 375 px.** La barra de navegación dejaba el documento con
`scrollWidth` de 378 px en TODAS las pantallas, porque la barra es global. Con
sesión conviven ahí la marca, la búsqueda, publicar, la cuenta y el menú, y en
un teléfono de 360 px eso sumaba 18 px más de los que hay. Corregido en la
causa: menos separación por debajo de `sm` y la marca sin su nombre por debajo
de 400 px —el enlace lo sigue diciendo para quien no ve la pantalla—. Lo vigila
`tests/e2e/responsive.spec.ts`, que mide ocho anchos en dieciséis pantallas.

**El avance docente rechazaba una actividad de una sola Parte.** La pestaña
«Avance por parte» se ofrecía para cualquier actividad por partes y el servidor
respondía 409 «esta actividad no tiene varios pasos» cuando sólo había una.
Contaba pasos en vez de mirar el tipo. Corregido.

**La exportación se quedaba vacía en una actividad por partes.**
`flattenSubmission` sólo conocía los cinco tipos anteriores, así que el Markdown
para IA, el CSV y el visor docente devolvían «Respuesta: (sin respuesta)» encima
de un laboratorio entero. Ahora lee cada Parte con el aplanador de su entregable.

**Una variable de origen vacía tiraba la compilación.** `NEXT_PUBLIC_*_ORIGIN`
se leía con `??`, que sólo cae en `undefined`: una cadena vacía —lo que deja un
panel de despliegue al borrar un valor— llegaba a `new URL('')` y reventaba con
`Invalid URL`, un error que no nombra la variable. Lo encontró el sandbox
compilado.

**`isSingleStep()` se retiró.** Devolvía `workflow.length <= 1` y ya no
respondía a la pregunta que su nombre sugiere. No lo usaba nadie; dejarlo era
dejar la trampa cargada.

**R22 se cerró con una señal real.** Una Parte de laboratorio ya no se completa
por existir la copia, sino por llevar trabajo dentro: la copia nace en revisión
1 y sólo sube al guardar. No es una heurística ni una medida de calidad —eso
sería calificar—, es el dato que el almacenamiento ya llevaba.

### Aceptado: se queda así, y por qué

**«Ya la hice» vive en `note` (R23).** Una Parte que no pide entrega no tiene
forma de completarse sola. La marca se guarda en `note`, el único campo del
modelo que ya contaba como contenido y que pertenece a quien hace la Parte.

Consecuencia, y está probada para que sea decisión y no sorpresa: **borrar la
nota devuelve la Parte a «Sin empezar»**. La casilla no pisa una nota escrita a
mano —se deshabilita— pero no puede distinguir «la borré por error» de «ya no la
he hecho». Inventar un campo persistido para una casilla habría sido añadir
estado al modelo para no aceptar una consecuencia menor.

**El título de una Parte se completa solo (R20).** El modelo exige un título por
paso; la interfaz lo ofrece como opcional. `namedForWorkflow` lo rellena al
guardar: con el título de la actividad si hay una sola Parte, con el nombre de
su intención si hay varias. **Nunca pisa un título escrito**, y volver a guardar
no renombra —el relleno es idempotente—. Probado.

**El progreso es un conteo, no un porcentaje.** Las Partes no tienen peso.

**A un estudiante no se le dice quién hace las otras Partes.** Las ve, sin
estado y sin nombre. El servidor nunca le manda los responsables de un paso.

**La conclusión obligatoria DENTRO de un NexLab sólo la comprueba el servidor.**
Exige leer la plantilla docente, que el navegador no tiene. Ese rechazo llega al
entregar y no aparece antes en «Todavía falta». La conclusión de una Parte de
NexIA —que es otra cosa— sí se comprueba en los dos sitios.

**Las vulnerabilidades de `npm audit` no se arreglaron.** Son 21, y todas las
correcciones disponibles son saltos mayores: `tar` 6→7, `vitest` 3→5,
`firebase-tools` 14→15, `firebase-admin` 13→14, `next` 15→16. Ninguna afecta a
código de producción por una vía alcanzable: `tar` y `firebase-tools` son de
desarrollo (descarga de DynamoDB Local y emuladores), `vitest` es el runner, y
las de `firebase-admin` vienen de clientes de Google Cloud que este proyecto no
usa —Firebase aquí sólo verifica identidad—. Actualizar cinco dependencias
mayores en la fase de endurecimiento introduce más riesgo del que elimina. Queda
anotado para decidirlo como trabajo propio.

### Pendiente, después del roadmap

**Las referencias del laboratorio tienen que ser literales (R16).** Los datos se
preparan ANTES de ejecutar, leyendo el fuente, así que `nex_sheet(nombre)` con
una variable sólo encuentra la hoja si ese texto aparece literal en alguna parte
de la celda. Comprobado en navegador al cerrar la Fase 6: con un nombre
construido (`paste0("Ven", "tas")`) no devuelve datos vacíos ni silencio, lanza
«No se preparó ningún dato para "Ventas". Las referencias tienen que ser texto
literal…». Resolverlo de otra forma exigiría `SharedArrayBuffer` + COOP/COEP,
que Nextudio no tiene.

**La suite compilada no cubre el aula.** `npm run test:e2e:prod` sirve la
compilación real pero sin base de datos, porque con `NODE_ENV=production` la
guarda de `lib/aws/config.ts` queda inlineada por webpack y rechaza el endpoint
local. Cubrir el aula contra un build de producción exigiría un DynamoDB
alcanzable con credenciales reales —es decir, infraestructura— o debilitar la
guarda. Lo primero es una decisión de coste; lo segundo no se hace.

**No hay S3 local.** Las imágenes de un NexBook y los materiales subidos siguen
sin poder probarse en el sandbox. Fallan con un error legible, no en silencio.

**La barra de navegación no se rediseñó.** Se corrigió el desbordamiento donde
estaba la causa, pero a 360 px la barra sigue apretada: marca, búsqueda,
publicar, cuenta y menú. Si crece un control más, volverá a no caber.
