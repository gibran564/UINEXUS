# UINexus — Checkpoints

> Este archivo es el punto de entrada para cualquier agente que retome el
> trabajo. Se actualiza al cerrar cada bloque, no al final.
>
> **Regla para cualquier agente futuro:** el prompt define alcance y dirección;
> este archivo define el progreso real; el código es la verdad final. Lee este
> archivo primero y continúa desde donde quedó.

## Dirección de producto

UINexus es un entorno académico orientado a procesos de trabajo modernos,
especialmente actividades apoyadas por IA.

Una tarea puede consistir en uno o varios pasos y utilizar cualquier
combinación de herramientas, prompts, skills, recursos, enlaces, archivos y
evidencias.

El sistema no está ligado a proveedores concretos.

Docentes y estudiantes pueden construir una biblioteca colectiva de recursos.
Las aportaciones estudiantiles requieren aprobación docente antes de formar
parte de la biblioteca oficial de la materia.

UINexus busca sustituir documentos colaborativos y entregas aisladas por
procesos estructurados, trazables y reutilizables.

---

## Estado actual

**Iteración 5 — Experiencia de producto.** URLs públicas de proyectos bajo el
dominio UINexus, Project Shell con iframe aislado, vista previa docente en el
editor de tareas, resumen compacto antes de publicar, cierre de la autoría de
actividades —prompt libre y fecha límite con hora— e Inicio autenticado con
muro académico.

Pasan **363 pruebas unitarias + 38 pruebas de integración**. Typecheck, lint y
build también pasan.

| # | Bloque | Estado |
|---|---|---|
| P0 | Modelo modular: workflow, pasos, entregables, compatibilidad | ✅ |
| P1 | Constructor docente de uno o varios pasos | ✅ |
| P2 | Ejecución del estudiante paso a paso | ✅ |
| P3 | Recursos colaborativos y moderación | ✅ |
| 1 | **Plantillas reutilizables de workflow** | ✅ |
| 2 | **Workflows propuestos por estudiantes** | ✅ |
| 3 | **Catálogo de herramientas conectado a pasos** | ✅ |
| 4 | **Universal Link sin SSRF (niveles 0, 1 y 2)** | ✅ |
| 5 | **Validación de acceso de runtime** | ✅ local · ⚠️ producción |
| 6 | Recorrido real con dos cuentas | ⛔ Bloqueado: no hay credenciales |
| 7 | **Subida real de archivos** | ✅ |
| 8 | **Colaboración avanzada sobre workflows** | ✅ |
| 9 | **Markdown canónico en AI Worklog** | ✅ |
| 10 | **Integración de assignments, submissions y archivos + DynamoDB Local** | ✅ |
| 11 | **DynamoDB Local hermético: versión y SHA-256 fijados** | ✅ |
| 12 | **Auditoría de dependencias de producción** | ✅ 0 altas · 8 moderadas documentadas |
| 13 | **Divergencia de CloudFormation** | ✅ inventariada y documentada · ⛔ reconciliación pendiente |
| 14 | **Análisis de rendimiento** | ✅ documentado, sin optimizar |
| 15 | **URLs públicas UINexus para proyectos (P0 it.5)** | ✅ |
| 16 | **Project Shell con iframe aislado (P0 it.5)** | ✅ |
| 17 | **Vista previa docente como estudiante (P1 it.5)** | ✅ |
| 18 | **Resumen compacto antes de publicar (P2 it.5)** | ✅ |
| 19 | **Prompt de paso sin depender de la biblioteca (P0 cierre)** | ✅ |
| 20 | **Fecha límite con hora, aplicada en el servidor (P1 cierre)** | ✅ |
| 21 | **Inicio autenticado en `/` (P0 muro)** | ✅ |
| 22 | **Priorización de tareas y muro académico (P1–P3 muro)** | ✅ |
| 23 | **Inicio docente y navegación autenticada (P4–P5 muro)** | ✅ |

---

## Terminado en esta sesión

### 1 · Plantillas reutilizables de workflow

- [x] `CourseResource.workflowSteps` guarda el proceso cuando `type === 'workflow'`.
- [x] `cloneWorkflowSteps()` — función pura que **regenera todos los ids** y
      **remapea las dependencias** a los ids nuevos.
- [x] Copia en profundidad: editar la tarea creada no toca la plantilla.
- [x] `GET /api/resources/[id]/instantiate` devuelve los pasos ya clonados.
      El clonado ocurre en el SERVIDOR, no en el navegador.
- [x] «Ver proceso» y «Crear tarea» en la ficha del recurso.
- [x] `?template=<id>` precarga `AssignmentEditor`. **No hay un segundo editor.**
- [x] «Guardar como plantilla» desde una tarea de varios pasos.

### 2 · Workflows propuestos por estudiantes

- [x] Un estudiante propone un proceso desde «Recursos IA» y nace `proposed`.
- [x] La docente aprueba o rechaza con el flujo de moderación que ya existía.
- [x] La autoría se conserva: «Aportado por Christian · Aprobado por…».
- [x] **Sólo se puede crear una tarea desde una plantilla APROBADA.** Usar una
      propuesta pendiente la publicaría por la puerta de atrás.

### 3 · Catálogo de herramientas conectado a pasos

- [x] Se elige una herramienta del catálogo y el paso guarda **id + nombre**.
- [x] Se sigue pudiendo **escribir una herramienta que no existe**: UINexus no
      obliga a darla de alta para usarla.
- [x] Si el nombre escrito coincide con una del catálogo, se aprovecha el id.
- [x] `resolveStepTools()` devuelve ficha y enlace de las que existen; el
      **nombre a mostrar sale siempre del paso**.
- [x] Aviso no bloqueante: «no está en la biblioteca, puedes usarla igualmente».

### 4 · Universal Link sin SSRF

- [x] `describeLink()` — **función pura, cero red**. Reconoce el proveedor por
      el texto de la URL.
- [x] Niveles 0 (enlace), 1 (tarjeta) y 2 (embed) donde el proveedor lo permite:
      YouTube, Vimeo, Loom, Figma, Miro.
- [x] 15 proveedores reconocidos; **los desconocidos funcionan igual** en nivel 1.
- [x] `iframe` con `sandbox` acotado, `referrerPolicy="no-referrer"` y carga
      perezosa.
- [x] Rechaza `javascript:`, `data:`, `file:` y texto que no es URL.
- [x] La tarjeta sin embed **se explica como comportamiento normal**, no error.

### 5 · Acceso de runtime

- [x] `scripts/check-runtime-access.mjs` — replica la resolución de credenciales
      de la aplicación y ejercita todas las tablas e índices.
- [x] Verificado en local: las 8 comprobaciones de lectura y el ciclo de
      escritura pasan, incluida `uinexus-resources · byCourse`.

### 7 · Subida real de archivos

- [x] Prefijo propio `academic/{courseId}/{uid}/{assignmentId}/{stepId}/{uuid}.{ext}`
      en el bucket **privado**. No se reutiliza el espacio de portadas.
- [x] **La clave la construye el servidor.** El nombre que propone el navegador
      sólo se guarda como etiqueta.
- [x] POST firmado: el archivo va **directo a S3**, sin pasar por Next.js.
- [x] Límites separados por tipo: imagen 8 MB, documento 25 MB, video 200 MB.
- [x] Lista blanca de MIME por clase; la extensión sale del `Content-Type`.
- [x] Lectura con URL firmada de 5 minutos, y **sólo si el archivo está citado
      en una entrega real** de esa tarea.
- [x] El enlace externo (§19) sigue funcionando: subir y enlazar son
      alternativas.

### 8 · Resultado colaborativo del workflow

- [x] `buildWorkflowGroupView(assignment, course, submissions)` es pura y la
      vista nunca se persiste.
- [x] La audiencia nace de tarea + paso, por lo que incluye a quien no empezó.
- [x] Cada aportación conserva autoría, estado, evidencia, herramienta,
      timestamps y `submissionId`, sin exponer UID.
- [x] El estado agregado reutiliza la escala de colaboración y representa a la
      persona menos avanzada.
- [x] La vista docente ofrece «Avance por paso» y «Resultado del grupo», con
      pasos expandibles y evidencia real.
- [x] Los archivos privados se abren sólo mediante la ruta firmada existente.

### 9 · Ciclos de dependencias

- [x] `assertAcyclicWorkflow()` detecta ciclos directos e indirectos.
- [x] Los esquemas de tarea y plantilla rechazan ciclos con 422 antes de
      persistir.
- [x] `buildWorkflowSteps()` repite la defensa para callers internos.

### 10 · Markdown canónico para resultados de IA

- [x] `AIWorklogData.result?: { content, format }` convive con
      `responseSummary` legacy, sin migración.
- [x] Detección conservadora de headings, listas, tablas, fences, citas y links.
- [x] «Resultado de la IA» conserva el pegado, ofrece Editar/Vista previa,
      Copiar resultado y Copiar AI Worklog.
- [x] Renderer `react-markdown` + `remark-gfm`, sin HTML crudo y con enlaces
      limitados a HTTP(S).
- [x] La exportación Markdown inserta la fuente sin JSON, escapes ni compactar
      sus saltos.
- [x] `stepEvidence` guarda el mismo resultado; la vista grupal lo renderiza.
- [x] Los pasos dependientes muestran cada entrada textual propia por separado,
      con Ver resultado y Copiar Markdown. No se envía nada automáticamente.

### 11 · Harness de integración de rutas

- [x] `npm run test:integration` levanta DynamoDB Local en memoria sobre un
      puerto loopback libre y lo detiene al terminar.
- [x] Tablas `users`, `courses`, `assignments` y `submissions` con índices
      reales y prefijo único por ejecución; no usa AWS real.
- [x] La frontera test-only sustituye sólo `verifyIdToken`; bearer, perfiles,
      roles, autorización y persistencia ejecutan el código real.
- [x] POST/PATCH cubren ciclos directos e indirectos, workflow válido,
      orden/dependencias/responsables persistidos, atomicidad y permisos de
      docente/estudiante/outsider.
- [x] Submissions cubre evidencia válida, paso ajeno/inexistente, dependencia
      aún bloqueada, submit incompleto y AI Worklog Markdown sin alteración.
- [x] Archivos cubre policy del POST firmado, MIME/tamaño, roles, cita previa,
      descarga temporal y propiedad de la clave. Las firmas se generan offline.

---

### 12 · DynamoDB Local hermético

- [x] Artefacto **fijado**: versión `2024-11-06` de la línea 2.x, URL concreta y
      SHA-256 en el repositorio. Se eliminó `dynamodb_local_latest.tar.gz`.
- [x] `scripts/lib/artifact.mjs` — `sha256File` y `verifyArtifact`, puros y
      probados.
- [x] `scripts/lib/dynamodb-local.mjs` — caché fuera del repo, descarga atómica
      (`.tmp` → verificar → renombrar), extracción sólo tras verificar,
      comprobación de Java 17+ **antes** de descargar nada.
- [x] Se sustituyó el paquete `dynamodb-local@0.0.38` por este módulo; `tar`
      pasó a ser devDependency explícita.
- [x] `scripts/verify-dynamodb-artifact.mjs` contrasta a mano la constante con
      el `.sha256` oficial de AWS.
- [x] Arranque con `spawn` y argumentos separados: rutas con espacios de Windows
      sin comillas ni escapes. Base **en memoria**, puerto libre de loopback.
- [x] 21 pruebas unitarias nuevas, incluida la del **byte alterado**.

### 13 · Auditoría de dependencias

- [x] Informe clasificado en «Auditoría de dependencias»: paquete, severidad,
      ruta, directa o transitiva, versión parcheada, si exige salto mayor y
      alcanzabilidad probable.
- [x] **11 → 8 vulnerabilidades; 2 altas → 0**, sin ningún salto mayor.
- [x] Lo que queda es un único aviso transitivo (`uuid@9`) documentado con su
      razonamiento de alcanzabilidad. No se aplicó `npm audit fix --force`.

### 14 · Divergencia de infraestructura y rendimiento

- [x] [`docs/INFRASTRUCTURE-DRIFT.md`](docs/INFRASTRUCTURE-DRIFT.md): inventario
      de las diez tablas, cuáles tienen datos, por qué `aws:deploy:infra` falla
      hoy y la secuencia segura de importación. **No se reconcilió nada.**
- [x] `docs/LIMITATIONS.md` §6: para cada consulta cara, qué hace, su coste, el
      umbral aproximado donde empezaría a doler y qué hacer entonces. **No se
      añadió ningún índice especulativo.**

### Cierre de autoría de actividades

**Prompt de un paso.** `WorkflowStep.prompt` (`mode`, `title`, `text`,
`resourceId`) representa las tres formas sin exigir un recurso en ninguna:

- [x] **Escribir aquí** es lo predeterminado. El prompt vive en la actividad y
      publicar no depende de que exista en la biblioteca.
- [x] **Elegir de biblioteca** sigue guardando la referencia y no una copia. El
      servidor comprueba que el prompt sea de ESA materia y esté aprobado
      (`scopeStepPrompts`); si no resuelve, el paso queda sin prompt en vez de
      volverse inguardable.
- [x] **Generar prompt** compone uno con lo que la actividad ya dice
      (`lib/prompt-generator.ts`, puro, sin servicios externos) desde un diálogo
      montado DENTRO del editor: el borrador es estado de React vivo y no se
      desmonta, así que no se pierde nada al abrirlo o cerrarlo.
- [x] **Guardar en biblioteca** desde el editor reutiliza `POST
      /api/courses/:id/prompts`. Es opcional: no bloquea publicar.
- [x] Un paso anterior a esta iteración se lee sin prompt. No se migró nada.
- [x] El paso enseña su prompt al alumnado con botón de copiar; el de biblioteca
      se resuelve contra el recurso vigente en el `GET` de la tarea.

**Fecha límite con hora.** `Assignment.dueAt` es el instante ISO en UTC, junto al
`dueDate` de siempre:

- [x] El editor captura fecha y hora LOCALES y compone el instante en el
      navegador (`composeDueAt`), que es donde se conoce la zona horaria. El
      servidor guarda el instante, no adivina zonas.
- [x] La interfaz dice la consecuencia: «Se aceptarán entregas hasta el …».
- [x] Todo el mundo ve la fecha con `formatDueLabel` («11 sep 2026 · 23:59»),
      nunca el instante crudo en UTC.
- [x] El cierre es de SERVIDOR: `assertOpenForSubmission` responde 409 en
      `PUT /api/assignments/:id/submission` y en la concesión de subida de
      archivos, con su propio reloj. El frontend deshabilita la acción y explica
      la fecha, pero no es la barrera.
- [x] Compatibilidad: sin fecha límite se entrega siempre; una tarea con sólo
      `dueDate` se interpreta como el final de su día en la zona más tardía del
      planeta —fallback deliberadamente permisivo, documentado en
      `lib/due-date.ts`— y se muestra sin inventarle una hora.
- [x] No se implementó ninguna política de entrega tardía: ni tolerancia, ni
      prórrogas, ni reapertura. Alcanzada la hora, cerrado.

### Inicio autenticado y muro académico

**`/` según la sesión.** El visitante sigue viendo la portada pública, servida
desde el servidor y con su HTML completo. Quien tiene sesión ve su Inicio sin
pasar por el escaparate:

- [x] `HomeGate` reparte por estado de sesión (`homeViewFor`). NO hay redirect
      server-side y no puede haberlo: la sesión es un ID token en memoria del
      navegador, no una cookie, así que el servidor de `/` no sabe quién pide.
- [x] `SessionScript` evita el destello. Una marca en `localStorage` —«la última
      vez había sesión»— oculta la portada antes de la primera pintura, con la
      misma técnica que el tema. No es una credencial y no autoriza nada: se
      corrige sola en cuanto Firebase responde.
- [x] El landing no se duplicó: se extrajo a `components/home/landing.tsx` y
      sigue siendo la misma pantalla. `/about` y `/explore` siguen donde estaban.

**Prioridad y muro** (`lib/home-feed.ts`, puro y probado sin nube):

- [x] Orden determinista y explicable: devuelta → vencida → hoy → pronto → en
      progreso → nueva → programada → sin fecha → cerrada. Lo entregado NO entra
      en la lista, así que no puede desplazar a lo pendiente.
- [x] El vencimiento se decide con `dueAt`, no con el día suelto.
- [x] La llamada a la acción dice qué va a pasar: Comenzar, Continuar, Entregar,
      Ver mi entrega, Ver el resultado. Y «Paso 2 de 4 · <siguiente paso>» cuando
      la actividad tiene workflow.
- [x] Muro derivado de lo que ya existe —actividades, prompts, Skills, recursos y
      proyectos publicados—. Sin event sourcing, sin tabla de eventos, sin colas.
- [x] Los avisos de la docente son un `CourseResource` de tipo `announcement`:
      una entidad nueva habría repetido materia, autor, contenido, fecha y
      moderación que esa tabla ya tenía.
- [x] «Desde tu última visita» se deriva contando eventos contra una marca del
      propio navegador. Nadie registra qué mira quién.
- [x] Nada de likes, comentarios, seguidores ni ranking. Sólo eventos con valor
      académico: lo que alguien publicó, no por dónde pasó.

**Inicio docente.** Cierra hoy → entregas por revisar → aportaciones por
aprobar, con «21 de 31 entregaron» calculado sobre la audiencia REAL de cada
actividad. Un compositor de avisos y accesos a las pantallas de creación que ya
existen; ningún editor duplicado dentro del muro.

**Privacidad, en `/api/home`.** Sólo materias propias; sólo actividades
publicadas y asignadas; sólo recursos aprobados; los proyectos salen del índice
disperso de publicados. De las entregas ajenas no sale nada: ni estado, ni nota,
ni si alguien entregó. Hay pruebas de integración para cada una de esas cinco
fronteras.

**Navegación.** Con sesión: Inicio · Aula · Explorar. Sin sesión: Explorar ·
Cursos · Acerca de. No se crearon pantallas globales de «Tareas» ni «Recursos»:
ambas viven dentro de una materia y duplicarlas sólo habría servido para cumplir
un nombre.

---

## En progreso

- [ ] Nada. El harness, submissions y archivos quedaron integrados y verdes.

---

## Pendiente

- [ ] **Dar credenciales de AWS al entorno Preview de Vercel.** Es lo único que
      bloquea el Preview de un PR, y no es un fallo del código. Diagnóstico
      cerrado: ver «El Preview de Vercel falla por configuración, no por
      código» más abajo.
- [ ] **Recorrido real con dos cuentas** (bloque 6). Ver «Infraestructura».
- [ ] **Verificar el acceso con las credenciales de PRODUCCIÓN.** Una orden.
      Ver «Próximo agente».
- [ ] Reconciliar la pila de CloudFormation con la cuenta. **Lee antes
      [`docs/INFRASTRUCTURE-DRIFT.md`](docs/INFRASTRUCTURE-DRIFT.md):** cuatro
      tablas ya tienen datos de producción y ninguna pertenece a la pila.
- [ ] Revisar `uuid@9` cuando Firebase Admin publique una cadena actualizada.
- [ ] Nivel 1 completo (título y favicon automáticos). Necesita metadatos, y
      obtenerlos con seguridad exige un servicio con allowlist. **Seguridad >
      favicon bonito**: hoy la descripción la escribe quien pega el enlace.
- [ ] Clipboard enriquecido HTML → Markdown. Diferido: el pegado principal ya
      conserva Markdown/plain text y no se justifica guardar HTML arbitrario.

---

## Decisiones técnicas de esta sesión

### Los ids de los pasos se regeneran al clonar, y las dependencias con ellos

La evidencia se indexa por `stepId` (`Submission.stepEvidence`). Si dos tareas
creadas desde la misma plantilla conservaran los ids de la plantilla,
compartirían claves: lo que alguien escribiera en un paso de la primera
aparecería como escrito en el mismo paso de la segunda. Es corrupción
silenciosa de trabajo académico.

`cloneWorkflowSteps` regenera los ids **y** traduce `dependsOnStepIds` en la
misma pasada. Una dependencia que apunte fuera de la plantilla se descarta:
dejarla con el id viejo bloquearía ese paso para siempre sin que se viera por
qué.

### El clonado ocurre en el servidor

`cloneWorkflowSteps` es pura y está disponible en ambos lados, pero si el
clonado dependiera del navegador, la garantía de ids nuevos dependería de que el
cliente la aplicara. Siendo del servidor es una propiedad de la respuesta.

### Una plantilla no lleva responsables

`assignedTo` se limpia al clonar y al guardar la plantilla. Una plantilla puede
reutilizarse en otra materia, donde esos UID no existen; copiarlos produciría
pasos asignados a gente que no está en el grupo. Repartir es una decisión de
cada tarea.

### Sólo se puede referenciar lo aprobado

`assertResourcesBelongTo` exige ahora `status === 'approved'`, además de que el
recurso sea de la materia. Recomendar una propuesta pendiente en una tarea la
publicaría sin pasar por revisión. El selector tampoco las ofrece.

*(Esto cerró una fuga real: `/api/courses/[id]/resources` devolvía prompts y
Skills sin filtrar por estado. Esa ruta se eliminó y el selector usa
`/library`, que sí filtra.)*

### El nombre de la herramienta es la información durable

Un paso guarda `toolIds` **y** `toolNames`. El nombre se muestra siempre; el id
sólo añade ficha y enlace mientras el recurso exista. Borrar la herramienta del
catálogo deja la tarea diciendo «usa Perplexity» en vez de dejarla muda. Es §50
hecho estructura, y tiene prueba.

### Los enlaces se reconocen por su texto, nunca visitándolos

`describeLink` no hace `fetch`, no resuelve DNS y no tiene timeouts que
ajustar. De las tres opciones que ofrecía el encargo —allowlist, servicio de
metadatos endurecido, metadatos escritos por la persona— se tomó la primera
porque es la única que cuesta **cero** riesgo de SSRF.

El embed es la excepción: sólo proveedores con URL de incrustación documentada,
y sólo cuando la URL concreta tiene la forma correcta. Construir el `src` de un
iframe con texto sin comprobar sería meter en la página lo que escriba un
tercero.

### El archivo no pasa por Next.js

Un video de 200 MB por una función serverless es tiempo pagado, memoria y un
límite de cuerpo que no da. El navegador sube al bucket con un permiso que el
servidor firmó, acotado a ruta, tipo y tamaño. El `content-length-range` del
POST firmado es lo único que convierte el límite en un límite y no en una
promesa del cliente.

### Leer un archivo exige que esté citado en una entrega

No basta con que la clave contenga el UID —eso sería fácil de imitar—: el
servidor busca la evidencia que la referencia. Sólo firma la lectura de un
archivo que está realmente citado en una entrega de esa tarea.

### Retención de archivos (§«Retención»)

Decidido y documentado, **sin borrado destructivo automático**:

| Qué pasa | Qué se hace con el archivo |
|---|---|
| Se borra la tarea | **Se conserva.** Igual que las entregas, que tampoco se borran en cascada. |
| Se reemplaza el archivo de un paso | **Se conserva el anterior.** La entrega deja de citarlo, así que deja de ser legible por la ruta de lectura. |
| Se archiva la materia | **Se conserva.** Archivar no destruye trabajo. |
| Se borra a alguien de la materia | **Se conserva.** Pierde el acceso, no el trabajo. |

La consecuencia es que quedan objetos huérfanos ocupando el bucket. Es
deliberado: perder trabajo académico por un clic no tiene vuelta atrás, y
ocupar unos megas de más sí. La limpieza necesita una tarea de mantenimiento
que cruce las claves del prefijo `academic/` con las evidencias que las citan;
está en «Pendiente» y **no debe hacerse con un borrado ciego por antigüedad**.

### La vista del grupo es derivada y conserva aportaciones independientes

`buildWorkflowGroupView` compone cada lectura desde `Assignment + Course +
Submissions`. No existe una copia grupal que pueda separarse de las entregas.
Un paso para tres personas produce tres aportaciones con autoría propia,
incluida la aportación «sin iniciar». La audiencia se calcula antes de mirar las
entregas; `assignedTo = null` conserva la semántica «todo el grupo».

### Markdown como formato canónico de resultados textuales de IA

Los resultados de AI Worklog pueden conservar Markdown como su representación
textual canónica en `result: { content, format }`.

UINexus no reescribe ni resume el contenido. Sólo conserva y renderiza su
estructura de forma segura.

Esto permite mantener títulos, listas, tablas, enlaces, citas y código
producidos por ChatGPT, Claude, Perplexity, Gemini, NotebookLM u otras
herramientas, y reutilizarlos como entrada de otros pasos del workflow.

`responseSummary` no se elimina: un Worklog anterior sin `result` se lee desde
ese campo como `plain_text`. Al editar el resultado legacy se escribe el campo
canónico y se vacía la copia antigua para no crear dos verdades. La ausencia de
`format` en un `result` nuevo activa `detectTextFormat`; la heurística exige una
señal estructural clara y prefiere falsos negativos.

El renderer usa `react-markdown` con `remark-gfm`. No se habilita `rehype-raw`
ni `dangerouslySetInnerHTML`; el HTML pegado no se interpreta. Los enlaces
navegables sólo aceptan `http:`/`https:`, abren con `target="_blank"` y
`rel="noopener noreferrer"`. Las imágenes Markdown remotas se muestran como
enlace, no se cargan automáticamente, para evitar tracking al revisar.

La exportación y «Copiar AI Worklog» insertan `result.content` directamente
bajo «Resultado»: no lo serializan como JSON, no lo envuelven en otro fence y
no compactan saltos internos. `Submission.stepEvidence[stepId].data` usa el
mismo `AIWorklogData`; la vista grupal y los pasos dependientes consumen esa
fuente común.

El clipboard enriquecido HTML → Markdown queda diferido. No se lee el
portapapeles automáticamente ni se guarda HTML arbitrario; pegar Markdown o
texto plano cubre el caso principal con menor superficie de ataque.

### Los ciclos se rechazan en dos fronteras

`assignmentInputSchema` y `courseResourceInputSchema` aplican la validación
acíclica para devolver 422 a una petición manual. `buildWorkflowSteps` vuelve a
comprobarla como defensa en profundidad antes de construir el registro. No se
confía en que el constructor frontend sólo ofrezca pasos anteriores.

### Pruebas de integración de rutas

Existe un harness reproducible contra DynamoDB Local que ejercita peticiones
`Request` y handlers reales de Next, autenticación, autorización, esquemas y
persistencia. Las pruebas unitarias siguen siendo la primera línea para lógica
pura; las de integración garantizan que las rutas conectan esas piezas.

`npm run test:integration` usa `dynamodb-local@0.0.38`, Java 17+, un puerto libre
de `127.0.0.1`, base en memoria, telemetría deshabilitada y un prefijo único por
proceso. Crea las formas reales de `users`, `courses`, `assignments` y
`submissions`, incluidos `byHandle`, `byCourse`, `byAssignment` y `byStudent`.
Cada test limpia y siembra fixtures controlados; al finalizar elimina tablas y
detiene Java.

Firebase Admin es la única frontera sustituida, sólo en la config de Vitest de
integración: `verifyIdToken` traduce tokens ficticios a UID/email, nunca a rol.
El bearer, el perfil y rol almacenados en DynamoDB, el acceso a materia y los
handlers son reales. `UINEXUS_DYNAMODB_ENDPOINT` exige simultáneamente
`NODE_ENV=test`, `UINEXUS_INTEGRATION_TESTS=true` y HTTP loopback; no puede
redirigir el runtime normal.

Las firmas S3 se calculan localmente con bucket y credenciales ficticios; no hay
peticiones a AWS ni se sube un objeto. La limitación restante es la firma
criptográfica real de Firebase y el transporte de un servidor Next levantado,
que pertenecen al recorrido con cuentas/emulador, no a esta suite de handlers.

---

### DynamoDB Local usa un artefacto fijado y verificado

La suite de integración no depende de una distribución mutable `latest`.

El runner descarga una versión oficial concreta —`2024-11-06` de la línea 2.x,
la que necesita Java 17+—, valida su SHA-256 antes de extraerla o ejecutarla y
conserva un caché externo al repositorio. Los runs posteriores verifican de
nuevo el hash antes de reutilizar el caché y pueden ejecutarse sin red.

El orden es lo que hace que la garantía sea real:

```
¿hay caché? → verificar SHA-256 → extraer → ejecutar
¿no hay?    → descargar a .tmp  → verificar → renombrar → extraer → ejecutar
```

Nunca «descargar, extraer y después verificar»: para cuando se comprueba, el
contenido ya está en el disco.

**El hash no se descarga en cada ejecución.** Pedirle el hash al mismo servidor
que sirve el binario no verifica nada, porque quien pudiera alterar uno
alteraría el otro. La constante vive en el repositorio;
`scripts/verify-dynamodb-artifact.mjs` la contrasta a mano con el `.sha256`
oficial al subir de versión.

**Un artefacto alterado no se borra.** Se falla de forma ruidosa. Un archivo que
cambió es información —corrupción de disco, o algo peor— y borrarlo en silencio
la destruye antes de que nadie la vea.

**Cuidado al tocar la URL.** AWS publica dos artefactos con la misma fecha y
distinto contenido: `s3.us-west-2.amazonaws.com/dynamodb-local/` es la línea
1.x (Java 8) y el CloudFront `/v2.x/` es la 2.x. Cambiar de uno a otro sin
darse cuenta rompería el requisito de Java documentado.

### Los overrides de `postcss` y `sharp` son deliberados

`package.json` fija ambos por encima de lo que resuelve Next. No es limpieza
cosmética: son las dos únicas vulnerabilidades **altas** que había, y ambas se
cerraron sin ningún salto mayor. Ver «Auditoría de dependencias».

---

## Auditoría de dependencias

`npm audit --omit=dev`, ejecutado y clasificado en esta sesión.

### Antes → después

| | Moderadas | Altas | Total |
|---|---|---|---|
| Al empezar | 9 | 2 | **11** |
| Al terminar | 8 | **0** | **8** |

Sin ningún salto mayor de versión, y con typecheck, lint, 302 unitarias, 18 de
integración y build verdes después.

### Lo que se arregló

| Paquete | Sev. | Cómo | Por qué era seguro |
|---|---|---|---|
| `postcss` | **alta** | `devDependencies` a `^8.5.28` + `overrides: {"postcss": "$postcss"}` | Next 15 fijaba `8.4.31` anidado. El salto es dentro de 8.x. Build verificado. |
| `next` | moderada | (efecto del anterior) | El aviso venía sólo de su `postcss` anidado. |
| `sharp` | **alta** | `overrides: {"sharp": "^0.35.0"}` | CVEs heredadas de libvips. Además **`next/image` no se usa en ninguna parte**, así que no era alcanzable. Build verificado. |

### Lo que queda, y por qué no se toca

Las 8 restantes son **el mismo aviso**, propagado por la cadena de Firebase
Admin:

```
uuid@9.0.1  ·  moderada  ·  missing buffer bounds check en v3/v5/v6 cuando se pasa `buf`
   └── gaxios · google-gax · teeny-request · retry-request
       └── @google-cloud/firestore · @google-cloud/storage
           └── firebase-admin@13.10.0  (directa)
```

| Criterio | Evaluación |
|---|---|
| Directa o transitiva | **Transitiva**. La directa es `firebase-admin`, ya en `13.10.0`, la última de su rango. |
| Versión parcheada | `uuid@>=11.1.1`. Depende de que Google publique sus librerías con esa versión. |
| ¿Requiere salto mayor? | El arreglo que sugiere npm es **`firebase-admin@10.3.0`**, que es un **DOWNGRADE** desde 13.10.0. La sugerencia es sencillamente incorrecta. |
| Alcanzable en runtime | **Improbable.** El fallo está en `uuid` v3/v5/v6 cuando se pasa un búfer de destino; estas librerías generan identificadores de petición con **v4**, sin `buf`. UINexus no llama a `uuid` en ningún sitio. |

**Decisión:** no se aplica nada. Ni el downgrade que propone npm, ni un
`override` de `uuid` a la 11 —cuya API es distinta y rompería a `google-gax`—.
Se revisa cuando Firebase Admin publique una versión con la cadena actualizada.

### Cómo reproducir el informe

```bash
npm audit --omit=dev
npm ls uuid --omit=dev
```

---

## Seguridad

Invariantes nuevas de esta sesión, sobre las que ya existían.

| Regla | Dónde vive |
|---|---|
| Sólo se instancian plantillas **aprobadas** | `GET /api/resources/[id]/instantiate` |
| Instanciar una plantilla exige ser docente de la materia | `requireCourseTeacher` |
| Sólo se referencian recursos **aprobados** y de la propia materia | `assertResourcesBelongTo` |
| El selector no ofrece lo que no está aprobado | `ResourcePicker` |
| `toolId` sólo se acepta si pertenece a un recurso accesible | `resolveStepTools` |
| Sólo `http`/`https`; nunca `javascript:` ni `data:` | `describeLink`, `httpUrlSchema` |
| El iframe va con `sandbox` sin navegación ni diálogos | `EMBED_SANDBOX` |
| El servidor **nunca** visita una URL que pegue un usuario | Ausencia deliberada de `fetch` |
| La clave S3 la construye el servidor, no el cliente | `academicFileKey` |
| Sólo se sube a un paso propio | `canWorkOnStep` en la ruta de archivos |
| El límite y el MIME los dicta el **entregable del paso** | `FILE_CLASS_BY_DELIVERABLE` |
| El tamaño se aplica en el POST firmado | `content-length-range` |
| Sólo se firma la lectura de un archivo citado en una entrega | `evidenceCites` |
| Una clave citada debe pertenecer a materia + alumno + tarea + paso | `isAcademicFileKeyFor` al guardar evidencia |
| Sólo se firman claves del prefijo `academic/` | `presignAcademicDownload` |
| Un workflow cíclico se rechaza antes de persistir | esquemas + `buildWorkflowSteps` |
| Markdown no interpreta HTML crudo | `MarkdownContent` sin `rehype-raw` |
| Links Markdown sólo `http`/`https` | `safeMarkdownUrl` |
| Links externos aíslan la pestaña nueva | `target=_blank`, `rel=noopener noreferrer` |
| Imágenes Markdown remotas no cargan automáticamente | renderer `img` como enlace |
| El endpoint Dynamo alternativo sólo existe en integración + loopback | `config.ts` + runner aislado |

---

## Cambios de base de datos

Ninguna tabla nueva. Campos nuevos, todos opcionales y normalizados al leer:

- `uinexus-resources`: `workflowSteps[]` (sólo en los de tipo `workflow`).
- `uinexus-submissions`: `stepEvidence[*].data.storageKey` en los entregables
  de archivo.
- `uinexus-submissions`: `data.result` y/o
  `stepEvidence[*].data.result` para AI Worklog, con `{ content, format }`.

Las pruebas crean las cuatro tablas anteriores bajo un prefijo efímero; no son
cambios de esquema ni recursos de producción y se eliminan al terminar.

**Sin migración.** Un recurso sin `workflowSteps` se lee con lista vacía; una
evidencia sin `storageKey` se lee como enlace externo; un AI Worklog sin
`result` se lee desde `responseSummary` como `plain_text`.

### S3

Prefijo nuevo `academic/` en el bucket **privado**
(`uinexus-projects-<cuenta>`). No toca `projects/`, `covers/` ni `avatars/`.

---

## Infraestructura validada

Comprobado **contra la cuenta real de AWS** (`us-east-1`, cuenta
`705822375607`) en esta sesión:

- [x] `scripts/check-runtime-access.mjs --write`: **8 de 8** comprobaciones de
      lectura correctas sobre las seis tablas académicas y sus índices, más el
      ciclo `Put` → `Delete` sobre `uinexus-resources`.
- [x] **Ciclo completo de archivo académico contra S3 real**: POST firmado
      (`204`), subida directa al prefijo `academic/`, lectura con URL firmada
      (`200`, contenido correcto) y borrado. La política permite
      `PutObject`/`GetObject` sobre ese prefijo.
- [x] `ensure-academic-tables.mjs --dry-run`: `uinexus-resources` y
      `uinexus-skills` ya existen y están `ACTIVE`.
- [x] Las páginas del aula renderizan sin errores de consola.
- [x] **Inventario de las diez tablas `uinexus-*`** con su recuento de
      elementos y su pertenencia a CloudFormation. Ninguna lleva etiquetas
      `aws:cloudformation:*`, y cuatro ya tienen datos. Detalle completo en
      [`docs/INFRASTRUCTURE-DRIFT.md`](docs/INFRASTRUCTURE-DRIFT.md).

### El artefacto de DynamoDB Local, comprobado en los tres casos

- [x] **Caso A · caché limpio.** Descarga la versión fijada, verifica el
      SHA-256, extrae y arranca. `18/18` integraciones verdes.
- [x] **Caso B · sin red.** Con el caché válido y `globalThis.fetch` sustituido
      por una función que lanza, `ensureArtifact` resuelve desde el caché sin
      intentar ninguna petición.
- [x] **Caso C · caché alterado.** Sobre una COPIA del artefacto real con un
      byte invertido, la verificación lanza `ChecksumMismatchError`
      **antes de ejecutar Java**. El archivo alterado no se borra.
- [x] `node scripts/verify-dynamodb-artifact.mjs`: el hash fijado en el
      repositorio coincide con el `.sha256` que publica AWS.

### Lo que NO se validó, y por qué exactamente

**Las credenciales de producción.** `.env.local` **no define**
`UINEXUS_AWS_ACCESS_KEY_ID` ni `UINEXUS_AWS_SECRET_ACCESS_KEY`, así que en local
la aplicación cae a la cadena por defecto del SDK —el perfil de la máquina—, que
es lo que se acaba de comprobar. En producción la aplicación usa esas dos
variables desde el entorno de Vercel, **que no son visibles desde aquí y pueden
tener otra política**. No se declara validado lo que no se ha ejecutado.

Se volvió a comprobar en esta sesión tanto el entorno del proceso como
`.env.local`: ambas variables de producción siguen ausentes.

**El recorrido con dos cuentas.** Requiere credenciales de dos cuentas de
Firebase Auth —una que el sistema clasifique como docente y otra como
estudiante— que no existen en este entorno. Ninguna ruta de API se ha ejercido
con un token real. Sólo hay configuración del proyecto y service account; no
hay email/password de identidades de prueba.

### CloudFormation

Las tablas de la cuenta **no tienen etiquetas `aws:cloudformation:*`**: no las
creó la pila. La plantilla las declara todas y sigue siendo la fuente
declarativa de verdad, pero pila y cuenta divergen.

### DynamoDB Local

Validado el proceso Java real en memoria: creación de tablas/índices, Get, Put,
Query, Scan, BatchWrite y borrado. Se ejecutó la suite completa varias veces y
no quedó ningún proceso Java ni dato persistente. **No se contactó AWS real.**

---

## Pruebas

**302 unitarias + 18 de integración = 320 pruebas.** En esta fase se añadieron
21 unitarias sobre la verificación del artefacto de DynamoDB Local.

| Archivo | Qué cubre |
|---|---|
| `artifact.test.ts` (21) | SHA-256 de archivo, hash correcto → permitido, incorrecto → rechazado, **un byte alterado se detecta**, el archivo alterado NO se borra, la URL no apunta a `latest`, el caché vive fuera del repositorio |
| `workflow-templates.test.ts` (25) | Clonado, ids nuevos, remapeo de dependencias, inmutabilidad de la plantilla, propuestas de estudiantes |
| `tool-catalog.test.ts` (11) | id + nombre, herramienta fuera del catálogo, borrar el recurso no cambia el nombre |
| `link-preview.test.ts` (21) | Protocolos peligrosos, proveedor desconocido, embed sólo donde procede, sandbox |
| `academic-files.test.ts` (20) | Clave segura y propiedad exacta, límites por tipo, lista blanca de MIME, autorización por paso |
| `collaborative.test.ts` (30; 4 nuevas) | Audiencia real, aportaciones independientes, ausentes, autoría, peor estado, ausencia de UID |
| `workflow.test.ts` (37; 3 nuevas) | Ciclos de dos/tres nodos y cadena acíclica, además del workflow previo |
| `ai-worklog-markdown.test.ts` (19) | Detección, legacy/new, seguridad GFM, exportación, stepEvidence, dependencias y vista grupal |
| `assignment-workflow-routes.test.ts` (9 integración) | POST/PATCH, ciclos 422 sin escritura, persistencia, atomicidad, roles y tokens |
| `workflow-submission-route.test.ts` (5 integración) | Evidencia, paso ajeno, dependencia, submit, Markdown exacto y roles |
| `academic-files-route.test.ts` (4 integración) | Firma offline, policy, validación, cita, propiedad de clave y descarga autorizada |

No se borró ni debilitó ninguna prueba anterior.

---

## Riesgos / deuda técnica

1. **Las credenciales de producción no están comprobadas** (arriba).
2. **Archivos huérfanos en S3.** Consecuencia aceptada de no borrar en cascada.
   Falta la tarea de mantenimiento, y **no debe ser un borrado por antigüedad**:
   un archivo viejo puede ser la única copia de un trabajo entregado.
3. **Firebase criptográfico y transporte Next no están emulados.** Las pruebas
   sustituyen sólo `verifyIdToken` y llaman los handlers con `Request`; el
   recorrido real con dos cuentas sigue bloqueado por credenciales.
4. **La primera ejecución de integración necesita red y Java 17+.** Es lo único
   que queda de aquel riesgo: el artefacto ya está fijado y verificado (ver
   «Decisiones técnicas»). Con el caché presente, la suite no hace ninguna
   petición.
5. **La lectura de un archivo recorre las entregas de la tarea.** Con muchas
   entregas es una consulta por cada apertura de archivo.
6. **`hasContent` decide si un paso está hecho por heurística.** Si se añade un
   entregable con más campos por defecto, hay que añadirlos a `STRUCTURAL_KEYS`.
7. **Sigue habiendo `Scan`** en `listCoursesForUser` y `findCourseByCode`.
8. **La pila de CloudFormation y la cuenta divergen.**
9. **Entradas de otro participante.** Los pasos dependientes muestran resultados
   de la entrega propia. Compartir automáticamente evidencia ajena necesita una
   política de visibilidad y una API explícitas; no se infirió ese acceso.
10. **8 vulnerabilidades moderadas transitivas, todas del mismo aviso.**
   `uuid@9.0.1` («missing buffer bounds check in v3/v5/v6 when buf is
   provided») bajo la cadena de Firebase Admin. Ver «Auditoría de
   dependencias»: no es alcanzable —esas librerías usan v4— y arreglarla
   depende de que Google publique versiones con `uuid@11`. Las 2 altas y una
   moderada se cerraron en esta sesión.

---

## Fuera de alcance por decisión

- Importación DOCX, MarkItDown, Google Drive API, Google Docs API
- Editor colaborativo en tiempo real, CRDT, transformación operacional
- Rúbricas, calificaciones complejas, comentarios hilados
- Exportación DOCX/PDF
- APIs comerciales de IA, agentes internos, análisis automático
- Ejecución o instalación de Skills desde UINexus
- Marketplace de Skills: ratings, estrellas, rankings, scraping de repositorios
- Leer conversaciones privadas, iniciar sesión en servicios externos
- `fetch` del servidor a URLs arbitrarias (SSRF)

---

## Próximo agente: comienza aquí

Todo lo que quedaba de deuda técnica interna está cerrado. Lo que sigue
depende de accesos externos que no existen en este entorno.

### 1. Validar el acceso con las credenciales de PRODUCCIÓN

Es **una orden** y es lo único que bloquea declarar la infraestructura
verificada de extremo a extremo.

```bash
UINEXUS_AWS_ACCESS_KEY_ID=... UINEXUS_AWS_SECRET_ACCESS_KEY=... node scripts/check-runtime-access.mjs --write
```

Comprobado en esta sesión: esas dos variables **no están** ni en el entorno del
proceso ni en `.env.local`, así que en local la aplicación cae a la cadena por
defecto del SDK. Eso sí se validó (8/8 lecturas + escritura). Producción usa
otras credenciales, que pueden tener otra política.

Si alguna línea dice `FALLA … AccessDenied`, faltan permisos. Lo que hay que
poder alcanzar:

- Las diez tablas `uinexus-*` con sus índices `byCourse`, `byPath`,
  `byStatus`, `byOwner`, `byHandle`, `byAssignment` y `byStudent`.
- `s3:PutObject` y `s3:GetObject` sobre
  `arn:aws:s3:::uinexus-projects-*/academic/*`.

### 2. Recorrido real con dos cuentas

Necesita una cuenta docente y una estudiante (`src/lib/identity.ts`: correo
institucional con dígitos → estudiante; sin dígitos → docente). Ninguna ruta se
ha ejercido nunca con un token de Firebase real.

El recorrido y lo que hay que mirar con atención está en
«Infraestructura validada → Lo que NO se validó».

### 3. Reconciliar CloudFormation

**No lo hagas sin leer `docs/INFRASTRUCTURE-DRIFT.md` primero.** Ninguna de las
diez tablas pertenece a la pila, y cuatro ya tienen datos de producción
(`-users`, `-handles`, `-projects`, `-courses`). El documento tiene el
inventario, por qué `aws:deploy:infra` falla hoy, y la secuencia segura:
copia de seguridad → comparar declaración contra realidad → importar primero
las tablas vacías.

### 4. Revisar `uuid@9` cuando Firebase Admin lo actualice

Las 8 vulnerabilidades moderadas que quedan son el mismo aviso transitivo. Ver
«Auditoría de dependencias»: no es alcanzable y el arreglo que sugiere npm es
un downgrade. Volver a mirar cuando salga una versión de `firebase-admin` cuya
cadena traiga `uuid@>=11.1.1`.

### El Preview de Vercel falla por configuración, no por código

Diagnosticado con el log del despliegue `dpl_GzMtwZgtDaGxK1TKpXjtEJsmwghb`
(PR #3). El build local, los tests y el build de Producción pasan; el de Preview
no, y siempre por lo mismo:

```
Error [CredentialsProviderError]: Could not load credentials from any providers
  at Object.n [as generateStaticParams] (.next/server/app/courses/[slug]/page.js)
```

La causa exacta, comprobada con `vercel env ls`:

| Variable | Environments |
|---|---|
| `UINEXUS_AWS_ACCESS_KEY_ID` | **Production sólo** |
| `UINEXUS_AWS_SECRET_ACCESS_KEY` | **Production sólo** |
| `UINEXUS_TABLE_PREFIX` | Production **y Preview** |
| `UINEXUS_PROJECTS_BUCKET` | Production **y Preview** |

Y la cadena que eso dispara:

1. `isAwsConfigured` (lib/aws/config.ts) mira `UINEXUS_TABLE_PREFIX` o
   `UINEXUS_PROJECTS_BUCKET`. En Preview los dos existen, así que da `true` y
   **el modo demo queda desactivado**.
2. `generateStaticParams` de `/courses/[slug]` llama a `listCourses()`, que va a
   DynamoDB de verdad.
3. `awsCredentials` es `undefined` porque faltan las dos claves, así que el SDK
   cae a su cadena por defecto.
4. En el contenedor de compilación de Vercel esa cadena no encuentra nada, y el
   build entero se cae.

**Arreglo (una acción en Vercel, no en el repositorio):** añadir las dos
credenciales al environment Preview.

```bash
vercel env add UINEXUS_AWS_ACCESS_KEY_ID preview
vercel env add UINEXUS_AWS_SECRET_ACCESS_KEY preview
```

Conviene que sean unas credenciales **de sólo lectura** y con el mismo prefijo
de tablas: un Preview no debería poder escribir en los datos de producción.

**Mejora no bloqueante, anotada y NO implementada:** `isAwsConfigured` se deduce
de variables que no son credenciales, así que un entorno a medio configurar
apaga el modo demo y después se estrella en el build en vez de degradarse. Si se
quiere que un Preview sin credenciales compile igualmente, ahí está el sitio.

### Antes de cerrar cualquier sesión

```bash
npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build
```

Y actualiza este archivo. No marques como terminado nada que sólo esté
diseñado: la frontera entre «Terminado» y «Pendiente» es lo único que hace útil
este documento.
