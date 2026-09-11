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

## Sprint — Identidad, materiales y proceso de materia (2026-09-09)

**Objetivo.** Cerrar el fallo de autenticación que dejaba sesiones inutilizables,
dar al profesorado una forma de repartir archivos con la tarea, hacer evidente la
entrega de documentos del alumnado, y añadir el proceso académico de
Investigación de Operaciones sin construir un LMS paralelo.

### Lo que se implementó, por prioridad

**P0 · Identidad institucional.** La regla de `lib/identity.ts` se aplica ahora
en los dos puntos que faltaban: al RESTAURAR la sesión de Firebase
(`lib/auth-session.ts`, antes de crear el perfil) y en `requireIdentity`, que es
el único punto por el que pasan todas las rutas. El acceso por SMS se retiró: un
teléfono no puede demostrar pertenencia a `@itdurango.edu.mx`.

**P0 · Materiales de la tarea.** `AssignmentMaterial` con su propia ruta, su
propio prefijo en S3 (`academic/materials/…`) y las dos preguntas de
autorización invertidas respecto a una entrega. Subida en dos tiempos: firmar →
subir a S3 → registrar.

**P0 · Entregables de archivo.** `MediaFields` pasa a subir primero y enlazar
después, con zona de arrastre sobre un `<input type="file">` real, aviso previo
de formato y tamaño, y el archivo entregado visible con su botón de abrir.

**P1 · Cinco plantillas de Investigación de Operaciones.** Modelado matemático,
Programación lineal/Simplex, Transporte/Asignación, Redes PERT-CPM y Caso
práctico con software. Son DATOS sobre el motor de workflows que ya existía.

**P1 · Onboarding docente.** Estado vacío inteligente en `/aula` con la regla
correcta (`canCreate && teaching.length === 0`), no `courses.length === 0`.

**P2 · Programación, empezando por R.** Entregable `code` con lenguaje, código
pegado y `.R` adjunto, legible por el profesorado sin descargar nada. Interfaz
de ejecutor externo documentada y NO conectada.

### Archivos principales

```
NUEVOS
src/lib/auth-session.ts                     restauración de sesión con política institucional
src/lib/academic-files.ts                   resolución de tipo/extensión, pura y compartida
src/lib/workflow-templates.ts               las cinco plantillas de IO, como datos
src/lib/aula-onboarding.ts                  cuándo se ofrece crear el primer grupo
src/lib/code-runner.ts                      interfaz del ejecutor externo (sin implementación viva)
src/app/api/assignments/[id]/materials/     POST · PUT · PATCH · DELETE · GET
src/components/aula/assignment-materials.tsx
src/components/aula/workflow-template-picker.tsx

MODIFICADOS
src/lib/identity.ts                         motivo del rechazo y textos del aviso
src/lib/server/session.ts                   requireIdentity aplica la política
src/components/auth/auth-provider.tsx       usa resolveRestoredSession; sin teléfono
src/components/auth/login-form.tsx          aviso de cuenta no autorizada; sin teléfono
src/lib/firebase/auth.ts                    retirado el acceso por SMS
src/lib/types.ts                            AssignmentMaterial, CodeData, ProgrammingLanguage
src/lib/constants.ts                        listas blancas por extensión, lenguajes, etiquetas
src/lib/academic-schemas.ts                 codeData, material*, language en el entregable
src/lib/data/academic.ts                    normalizeMaterials
src/lib/data/academic-mappers.ts            materiales sin UID
src/lib/server/academic-writes.ts           setAssignmentMaterials
src/lib/aws/s3.ts                           claves de material, borrado, resolución por extensión
src/lib/workflow.ts                         language en el entregable; `language` es estructural
src/components/aula/{assignment-editor,assignment-detail,deliverable-fields,
                     workflow-builder,workflow-runner,workflow-progress,aula-home}.tsx
```

### Decisiones arquitectónicas

1. **La política de identidad vive en `requireIdentity`, no en las rutas.** Es el
   único punto por el que pasan todas; repetirla en treinta endpoints garantiza
   que a alguno se le olvide. Responde 403 y no 401: volver a entrar con la misma
   cuenta no arreglaría nada.
2. **Los materiales NO reutilizan la ruta de entregas.** No se levantó la
   restricción que impide al profesorado usar `/files`. Sus permisos son los
   contrarios (escribe sólo docente, lee todo el grupo) y fundirlos habría
   mezclado dos preguntas de autorización distintas.
3. **Los materiales no viajan en el cuerpo de la tarea.** Se escriben con
   `UpdateCommand` sobre un atributo, así que editar el enunciado no puede
   borrarlos ni al revés.
4. **Descargar un material se pide por `id`, nunca por `storageKey`.** Aceptar
   una clave del cliente convertiría el endpoint en un firmador de lecturas para
   cualquier objeto académico.
5. **El tipo de archivo lo decide la EXTENSIÓN, no el `Content-Type` declarado.**
   Para un `.R` el navegador manda el tipo vacío; con la regla contraria no
   habría forma de admitirlo sin admitir cualquier binario. La extensión sólo
   elige una entrada de una tabla cerrada y el servidor fija el tipo del objeto.
6. **Las plantillas de materia son datos, no un motor.** Pasan por
   `cloneWorkflowSteps`, del que heredan la garantía de identificadores nuevos.
   Añadir colas o inventarios es una entrada más en `workflow-templates.ts`.
7. **Las dependencias de una plantilla encadenan con el anterior OBLIGATORIO.**
   Encadenar con el anterior a secas dejaría bloqueado todo lo que sigue a un
   paso opcional sin rellenar, que es para lo que existe lo opcional.
8. **El lenguaje es un valor sobre una unión abierta, no un `isR`.** Encender
   Python es cambiar un `enabled`; las entregas guardadas no se tocan.
9. **UINexus no ejecuta código.** Sólo hay un adaptador con sus condiciones
   escritas. Sin runner configurado no aparece ningún botón y la tarea se entrega
   igual.
10. **Adjuntar archivos exige que la tarea exista**, así que el editor ofrece
    «Guardar borrador y adjuntar» en vez de inventar un almacén intermedio en el
    navegador que se perdería con cualquier recarga.

### Pruebas

- **467 unitarias** (antes 371) y **92 de integración** (antes 53). Typecheck,
  lint y build de producción en verde.
- Nuevas suites: `auth-session`, `operations-research-templates`,
  `assignment-materials`, `code-deliverable`, `aula-onboarding`,
  `identity-policy-route`, `assignment-materials-route`,
  `code-submission-route`.
- Los correos de las identidades de integración pasaron a ser institucionales, y
  se añadieron dos tokens válidos que la política rechaza: uno de Gmail y uno
  sin correo (el caso del acceso por teléfono).

### Pendientes y riesgos conocidos

| Tema | Estado |
|---|---|
| Recorridos manuales con cuentas reales | **NO ejecutados.** Necesitan Firebase y AWS reales; ninguna ruta se ha ejercido con un token de Firebase de verdad (ver «Lo que NO se validó»). |
| Ejecución de R | Interfaz y configuración listas, **sin ejecutor conectado**. `UINEXUS_CODE_RUNNER_*` documentadas en `.env.example`. |
| Exportación de tareas de varios pasos | Sigue leyendo `Submission.data` (el primer paso). El código entregado se revisa en «Avance por paso», no en el export. Es un hueco anterior a esta iteración, ahora más visible. |
| Objetos huérfanos en S3 | Quitar un material borra su objeto; si el borrado falla se registra y se sigue. Sin política de ciclo de vida en el bucket. |
| Formatos legacy de Office | `.doc`, `.xls`, `.ppt` **fuera** de la lista blanca: contenedores OLE con macros. Decisión, no olvido. |
| Teléfono como segundo factor | Retirado por completo. Volvería como `linkWithPhoneNumber` sobre una cuenta institucional verificada. |
| Materiales al borrar una tarea | No se limpian en cascada, igual que las entregas. Misma tarea de mantenimiento pendiente. |

## Sprint — Publicación académica unificada (2026-09-04)

- Compositor en Inicio: anuncio y editores reales de Prompt, Skill y Recurso; compartir contenido existente y páginas/proyectos mediante referencias.
- Una publicación con audiencia de uno, varios o todos los grupos docentes; propuestas estudiantiles para un grupo inscrito, con moderación existente y autoría conservada.
- Filtros docentes independientes de la audiencia, aplicados antes del límite del feed; proyectos sólo mediante una acción explícita de compartir.
- Permisos del servidor y rutas antiguas protegidos; creación y aprobación del contenido inline y su publicación en transacciones, reutilizando las tablas existentes.
- Verificación: 371 unitarias y 53 de integración; typecheck y lint verdes. Build validado al cerrar este sprint.
- UI cubierta con renderizado y callbacks; la prueba visual con cuentas reales y Vercel Preview queda para revisión del usuario.

## Estado actual

**Iteración 5 — Experiencia de producto.** URLs públicas de proyectos bajo el
dominio UINexus, Project Shell con iframe aislado, vista previa docente en el
editor de tareas, resumen compacto antes de publicar, cierre de la autoría de
actividades —prompt libre y fecha límite con hora— e Inicio autenticado con
muro académico.

Pasan **371 pruebas unitarias + 53 pruebas de integración**. Typecheck, lint y
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

## Sprint — Monaco Editor + ejecución de R y Python (2026-09-10)

**Objetivo.** Que una actividad de programación deje de ser «pega tu código y
que alguien lo ejecute en su equipo» y pase a ser: la docente configura el paso,
el alumnado escribe en un editor de verdad, ejecuta, ve la salida, y la docente
revisa y vuelve a ejecutar. Sin ejecutar nada en el servidor.

### Lo que se implementó

**Editor.** Un solo `CodeEditor` (`components/aula/code-editor.tsx`) para todos
los lenguajes, con Monaco cargado por `next/dynamic` sin SSR. Números de línea,
resaltado, emparejado de llaves, búsqueda, deshacer, ajuste de línea, minimapa
apagado, tema claro/oscuro de UINEX y Ctrl/Cmd + Enter para ejecutar. Si Monaco
no carga en diez segundos queda un `<textarea>` con el mismo valor y el mismo
`onChange`: entregar no puede depender de un editor de 3 MB. **No** hay
`REditor` ni `PythonEditor` — el lenguaje es un parámetro.

**Ejecución.** R con webR y Python con Pyodide, cada uno en un Web Worker, en el
navegador de quien programa. La UI no conoce ninguno de los dos: pide
`runner.run({ language, source })`. El runtime se arranca en la PRIMERA
ejecución, no al abrir la tarea («Preparando Python…» → «Python listo»).

**Límites.** Fuente ≤ 60 KB, salida ≤ 20 000 caracteres, ejecución ≤ 10 s,
arranque ≤ 120 s. Un programa que no termina se corta terminando el Worker —lo
único que funciona con un bucle infinito— y la ejecución siguiente arranca
limpia. Hay botón de Detener.

**Persistencia.** El fuente vive donde ya vivía: `CodeData.code` dentro de
`stepEvidence[stepId]`. Autoguardado con 800 ms de espera, y guardado forzoso
antes de ejecutar, de cambiar de paso y de entregar. El editor manda SÓLO el
paso que cambió y la ruta fusiona por paso, así que dos pasos de código no se
pisan.

**Modalidades.** `editor` (Monaco, sin archivo obligatorio), `upload` (el flujo
de archivo de siempre) y `either` (las dos, más importar un `.R`/`.py` al
editor). Un paso guardado antes de que existieran se lee como `either`, que es
exactamente lo que ofrecía. Los nuevos nacen en `editor`.

**Código inicial.** Viaja en el PASO, no en la entrega. La copia del alumnado se
siembra la primera vez que abre el paso; cambiar la plantilla después no pisa
nada. Botón «Restablecer código inicial», que pregunta sólo si hay algo que
perder.

**Constructor.** `Deliverable → Código` ofrece lenguaje (R / Python), modalidad,
«Permitir ejecución» y un editor para el código inicial. Nada hardcodea
Investigación de Operaciones: esas plantillas simplemente eligen un entregable
de código.

**Revisión docente.** El código se ve en el mismo editor, en sólo lectura, con
el lenguaje del paso, y se puede ejecutar. Ejecutar **no** modifica la entrega y
no hay por dónde: ese editor va sin `onChange` y sin `beforeExecute`.

### Terminado

- [x] E1 · `CodeEditor` único por `ProgrammingLanguage`, con respaldo a textarea
- [x] E2 · Monaco desde el paquete instalado, nunca desde un CDN
- [x] E3 · `browser-code-runner.ts`: reloj, terminación y estados
- [x] E4 · Worker + motor de Python (Pyodide), probado ejecutando de verdad
- [x] E5 · Worker + motor de R (webR), verificado en navegador
- [x] E6 · Tiempo límite, Detener, y volver a ejecutar tras un corte
- [x] E7 · Autoguardado por paso, con guardado forzoso antes de ejecutar/entregar
- [x] E8 · Modalidades `editor` / `upload` / `either` con compatibilidad hacia atrás
- [x] E9 · Código inicial y «Restablecer»
- [x] E10 · Configuración del paso de código en el constructor
- [x] E11 · Vista docente en sólo lectura, ejecutable
- [x] E12 · Red y paquetes bloqueados en los dos runtimes
- [x] E13 · `scripts/copy-code-runtimes.mjs`: assets + Workers, fuera de git
- [x] E14 · 83 pruebas nuevas (79 unitarias + 4 de integración)
- [x] V.1 · typecheck · lint · 550 unitarias · 98 de integración · build

### Pendiente, y por qué

- [ ] **CSP de la plataforma.** `uinexus.mx` no envía `Content-Security-Policy`.
      Se auditó: ejecutar R y Python **no exige relajar nada** (Monaco, Pyodide,
      webR y los Workers salen del propio origen), así que no había nada que
      ajustar. Escribirla entera —Firebase Auth, S3, imágenes, scripts en línea
      de Next— es un cambio con su propio riesgo y no era este sprint. Las
      directivas concretas que este código necesita están en docs/SECURITY.md.
- [ ] **Ejecución real de R en la suite.** webR no arranca bajo Node en Windows
      (le pasa una ruta de Windows a `new Worker`). El motor se prueba contra un
      doble; que webR sepa sumar se verificó a mano en el navegador. Lo correcto
      es una suite de Playwright. Ver docs/LIMITATIONS.md.
- [ ] **Recorridos manuales con cuentas reales.** Necesita Firebase y AWS.

### Trampas que costó encontrar, para no repetirlas

1. **Webpack emite Workers CLÁSICOS** aunque se pida `{ type: 'module' }`:
   emitir módulos exige `output.module` en toda la compilación y Next no lo
   permite. Pyodide lo detecta y se niega a arrancar. Por eso los Workers los
   compila esbuild aparte, a `public/runtime/workers/`.
2. **De webR hay que cargar `webr.js`, no `webr.mjs`.** La segunda es su
   compilación para Node y conserva un `require` de `"module"`; el navegador
   falla con un «Failed to resolve module specifier "module"» que no se parece
   en nada a su causa.
3. **`install.packages` y `download.file` viven en `package:utils`, no en
   `base`.** Enmascararlas sólo en `base` las dejaba intactas, y `download.file`
   llegó a INTENTAR salir a la red. Ahora el prólogo recorre `search()` y los
   espacios de nombres.
4. **`captureConditions: false` convertía un error de R en «Finalizado»** con el
   error escondido en stderr. Con `true`, webR lanza y la ejecución falla de
   verdad.
5. **`import('monaco-editor')` resuelve el paquete AMD de `min/`**, que webpack
   no empaqueta. La entrada ESM es `monaco-editor/editor/editor.main.js`.

Las cinco se descubrieron ejecutando la aplicación en un navegador, no leyendo
código. Ninguna habría salido de `npm run build`.

## Sprint — Reposicionamiento y workspace académico (2026-09-10)

**Objetivo.** UINexus dejó de ser un publicador de HTML hace dos iteraciones, pero
el producto seguía presentándose como uno: la portada decía «Diseña. Publica.
Comparte.» y explicaba cómo subir un `index.html`. Este sprint alinea el discurso
con lo que la plataforma hace, y añade el sitio que faltaba para programar sin
entregar nada.

### Lo que se implementó

**Capacidades por lenguaje.** El catálogo tenía UN booleano, `enabled`, que
mezclaba «se puede escribir» con «se puede ejecutar». Ahora cada lenguaje declara
`LanguageCapabilities`, y eso es lo que permite ofrecer Java con su resaltado y su
`.java` mientras la interfaz dice «Ejecución no disponible» con el motivo —y no
pinta el botón—. Entraron Java, C, C++, HTML y CSS al catálogo.

**La portada se genera desde el catálogo.** `language-support.tsx` recorre
`PROGRAMMING_LANGUAGES`: si mañana alguien apaga la ejecución de R, la portada
deja de anunciarla el mismo día. Una lista escrita a mano habría envejecido sola.

**Landing nuevo.** Hero «Aprende construyendo», el recorrido de una actividad, el
editor (con una representación hecha con los tokens del sistema, no una captura),
lenguajes, «de práctica a proyecto», estudiantes, docentes, y publicar como último
paso en lugar de identidad. Sin cuadrícula de tarjetas: divisores y jerarquía
tipográfica, con tarjetas sólo donde de verdad hay una cuadrícula.

**Prácticas.** Tabla propia `uinexus-workspaces`, entidad `Workspace` con
`context`, rutas `/api/workspaces` y `/api/workspaces/:id`, páginas `/practicas` y
`/practicas/:id`. Privadas por definición, con autoguardado y reutilizando el
`CodeEditor` existente sin envolverlo en nada.

**Navegación.** `Prácticas` y `Proyectos` entran en la barra —`/dashboard` sólo se
alcanzaba por el menú de la cuenta—, `Cursos` pasa a `Materias`, y la acción
principal para quien no ha entrado deja de ser «Publicar» para ser «Crear cuenta».

**Textos.** README, `SITE` (title y Open Graph de todo el sitio) y `/about`.

### Terminado

- [x] R1 · `LanguageCapabilities`: editar y ejecutar dejan de ser un booleano
- [x] R2 · Java, C, C++, HTML y CSS editables con resaltado y extensión propia
- [x] R3 · «Ejecución no disponible» con motivo, y sin botón fantasma
- [x] R4 · `LEGACY_CODE_LANGUAGE`: el default nuevo no reinterpreta lo guardado
- [x] R5 · Landing reposicionado, con la tabla de lenguajes generada del catálogo
- [x] R6 · README, `SITE`, `/about` y navegación
- [x] R7 · Modelo `Workspace` con `files` opcional, compatible hacia adelante
- [x] R8 · Tabla, índice `byOwner`, CFN y script de tablas
- [x] R9 · API de prácticas con privacidad comprobada en tres capas
- [x] R10 · `/practicas` y `/practicas/:id` con autoguardado
- [x] R11 · 37 pruebas nuevas (21 unitarias + 16 de integración)
- [x] V.1 · typecheck · lint · 575 unitarias · 114 de integración · build

### Pendiente, y por qué

- [ ] **`RemoteRunner`.** Es la pieza que desbloquea Java, C **y** los proyectos
      con frameworks a la vez. El contrato ya existe y la UI ya no conoce a su
      proveedor. Ver docs/ARCHITECTURE.md §14 para la evaluación de
      WebContainers y Sandpack, y por qué ninguna encaja hoy.
- [ ] **Multi-archivo.** El modelo lo admite; el editor no lo escribe. Falta
      árbol de archivos, archivo de entrada y resolución de `import` entre ellos.
- [ ] **Convertir una práctica en entrega.** Hoy se copia el código a mano.
- [ ] **CSP de la plataforma.** Sigue igual que en la iteración anterior.
- [ ] **Recorridos manuales con cuentas reales.** Necesita Firebase y AWS.

### Trampas de esta iteración

1. **Cambiar `DEFAULT_PROGRAMMING_LANGUAGE` casi rompió la compatibilidad.**
   `normalizeDeliverable` cae al default cuando el paso no trae lenguaje, así que
   pasar de `r` a `python` habría reinterpretado en silencio actividades de R ya
   entregadas. De ahí `LEGACY_CODE_LANGUAGE`, y la separación entre caminos de
   lectura y de creación.
2. **Un test viejo protegía algo real.** «Un paso de código NO admite un
   ejecutable» rechazaba `.js`, que ahora es un lenguaje académico legítimo. Se
   reescribió para mantener la garantía que importaba —binarios y scripts de
   shell fuera, todo lo admitido como `text/plain`— en vez de borrarlo.
3. **`ensure-academic-tables.mjs` se ejecutó sin querer** al usar un `import()`
   como comprobación de sintaxis, y creó `uinexus-workspaces` en la cuenta de AWS
   real. Es la tabla que esta función necesita y está vacía (PAY_PER_REQUEST),
   pero la lección es usar `node --check` para comprobar sintaxis.

## Sprint — NexBook y UINexus Studio (2026-09-10)

**Objetivo.** Dar a UINexus un formato de documento computacional propio: texto,
código ejecutable y resultados en un documento reproducible que sirva como
laboratorio personal y como entregable de una actividad. Sin convertir toda
actividad en un notebook y sin degradar nada de lo anterior.

Documentación completa: [`docs/NEXBOOK.md`](docs/NEXBOOK.md).

### Lo que se implementó

**Modelo.** `NexBook` con `context` (personal / workflow+rol), `visibility`,
`document { blocks, results }` y `revision`. Un solo tipo, no cuatro: lo que
cambia entre una plantilla, una copia y un laboratorio es el contexto y el dueño.
`NEXBOOK_FORMAT_VERSION` viaja en cada documento desde V1.

**Bloques.** `markdown` y `code`, y sólo esos dos declarados. El lenguaje es una
PROPIEDAD del bloque, así que un documento mezcla Python y R sin tipos nuevos.
`editableByStudent` permite que una plantilla bloquee sus instrucciones.

**Outputs ≠ bloques.** Viven en `results`, indexados por `blockId`, con `seq`
para el orden. Una gráfica del alumnado no se convierte en un bloque editable:
eso haría imposible saber al revisar qué escribió cada persona.

**Kernels.** `NotebookKernel` sobre el MISMO Worker y el MISMO Pyodide que
`CodeRunner`; lo único que cambia es `mode` en el mensaje. Un kernel por lenguaje
y perezoso: un documento con Python y R no arranca 59 MB al abrirse.

**Estado entre celdas.** En Python se ejecuta contra `__main__` y el modo aislado
lo vacía antes y después; en R, que ya persistía, el aislado hace
`rm(list = ls(all.names = TRUE))`. Simétrico y observable desde el propio
intérprete.

**Concurrencia.** Primera entidad con revisión: `ConditionExpression` sobre
`ownerUid` Y `revision`. Un 409 trae el documento que ganó, y el editor deja de
guardar en vez de fusionar a ciegas.

**Persistencia.** Comparte `uinexus-workspaces` con las prácticas de un archivo,
discriminado por `kind`. Presupuesto de 300 KB por documento comprobado sobre el
JSON serializado, que es lo que DynamoDB va a medir.

**Workflow.** Entregable `nexbook` nuevo, `code` intacto. Plantilla docente e
instancia por estudiante con ids deterministas e instanciación perezosa. La
entrega es un SNAPSHOT: seguir trabajando después no cambia lo que se califica.
La docente lee el snapshot en Studio de sólo lectura y puede ejecutar celdas.

### Terminado

- [x] N1 · Modelo `NexBook`, bloques, outputs, contexto, visibilidad, revisión
- [x] N2 · Límites explícitos en `NEXBOOK_LIMITS`, presupuesto sobre JSON real
- [x] N3 · CRUD con ownership en tres capas y 404 indistinguible
- [x] N4 · Concurrencia optimista con 409 que devuelve el documento actual
- [x] N5 · UINexus Studio: bloques, orden, añadir/eliminar, foco tras insertar
- [x] N6 · MarkdownBlock con el renderer sanitizado ya existente
- [x] N7 · CodeBlock sobre Monaco, lenguaje por bloque
- [x] N8 · `NotebookKernel` con sesión, restart, interrupt y estado por lenguaje
- [x] N9 · Python conserva estado entre celdas (verificado en navegador)
- [x] N10 · R con sesión y aislamiento simétrico
- [x] N11 · Autoguardado con 800 ms y estados que nunca ocultan un error
- [x] N12 · Laboratorios personales en `/practicas`, lista unificada
- [x] N13 · Entregable `nexbook` en Workflow, sin tocar `CodeData`
- [x] N14 · Plantilla docente e instancia perezosa por estudiante
- [x] N15 · Snapshot de entrega y vista docente de sólo lectura
- [x] N16 · 50 pruebas nuevas (32 unitarias + 18 de integración)
- [x] N17 · `docs/NEXBOOK.md`
- [x] V.1 · typecheck · lint · 616 unitarias · 132 de integración · build

### Pendiente, y por qué

- [ ] **Import/export `.nexbook`.** Formato diseñado y versionado; sin
      implementar. Sus tests de «no filtra secretos» se escribirán con el
      exportador: probarlo antes no probaría nada.
- [ ] **Publicación.** `visibility` admite cuatro estados y sólo `private` está
      implementado. La interfaz no ofrece los otros tres.
- [ ] **Outputs ricos** (tabla, imagen, HTML). Entran como valores nuevos de
      `stream`, sin romper documentos guardados.
- [ ] **Orden real de stdout/stderr.** `seq` está listo; falta que el motor emita
      eventos en vez de dos cadenas.
- [ ] **Historial de reentregas.** El esquema lo admite; la interfaz guarda la
      última.
- [ ] **Project Workspace.** Otro `kind`, previsto y no empezado.
- [ ] **`RemoteRunner`** para Java y C. Sin cambios respecto a la iteración
      anterior.
- [ ] **CSP de la plataforma.** Sin cambios.
- [ ] **Recorridos con cuentas reales.** Necesita Firebase y AWS.

### Trampas de esta iteración

1. **Un Worker en caché me hizo perseguir un bug que no existía.** Tras
   `npm run runtimes`, el navegador siguió sirviendo el bundle anterior del
   Worker, así que «reiniciar el kernel» parecía no borrar el estado. Perdí un
   buen rato rediseñando el aislamiento de Python por una evidencia falsa. El
   rediseño se quedó porque es mejor —vaciar `__main__` es observable desde
   Python, y queda simétrico con R—, pero la conclusión de la que partí era
   equivocada y está corregida en el comentario del código.
2. **Mi propia verificación en navegador estaba mal.** Esperaba «a que la salida
   exista» en vez de «a que cambie», así que leía el resultado anterior y
   concluía que el reset fallaba. Con el método correcto pasa a la primera.
3. **`del` sobre la variable de un bucle falla si el bucle no se ejecutó.** La
   primera versión de la limpieza de `__main__` usaba `for` + `del`, que revienta
   con un espacio ya vacío. Una comprensión no deja variable suelta y es
   idempotente.
4. **Un test viejo protegía algo real, otra vez.** El que cuenta las claves del
   mensaje del Worker falló al añadir `mode`. Se actualizó manteniendo la
   garantía —ninguna credencial— y se añadió uno nuevo: que el valor por defecto
   sea `isolated`, porque `session` por defecto haría que un paso de actividad
   viera variables de un NexBook abierto en otra pestaña.

### Estado del repositorio al cerrar

**HEAD sigue en `8aef472`.** Las tres últimas iteraciones —Monaco/R-Python,
reposicionamiento y NexBook— viven en el working tree sin commitear, por
instrucción expresa. Hay un punto recuperable etiquetado:

```bash
git tag -l pre-nexbook-checkpoint     # estado previo a esta iteración
git checkout pre-nexbook-checkpoint -- .
```

Conviene commitear antes de la siguiente fase.

### Antes de cerrar cualquier sesión

```bash
npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build
```

Y actualiza este archivo. No marques como terminado nada que sólo esté
diseñado: la frontera entre «Terminado» y «Pendiente» es lo único que hace útil
este documento.

## Sprint — NexBook modular (2026-09-10)

**Objetivo.** Llevar NexBook de «Markdown + código» a un documento computacional
modular: que produzca tablas y gráficas, que contenga imágenes y hojas de
cálculo, que se publique y que se intercambie. Sin degradar nada de lo anterior.

Documentación completa: [`docs/NEXBOOK.md`](docs/NEXBOOK.md).

### Lo que se implementó

**Salidas ricas.** `table`, `image` y `json` entraron como valores NUEVOS de
`stream`, que es exactamente lo que V1 dejó preparado. La consecuencia es que
`NEXBOOK_FORMAT_VERSION` sigue en 1 y no hubo migración: un documento de la
iteración 8 valida sin tocar un byte.

**El orden real, que se daba por imposible.** La iteración anterior lo documentó
como pendiente de «rediseñar los runtimes». No hacía falta: Pyodide ya llamaba a
`stdout` según el programa escribía y `captureR` ya devolvía un array ordenado.
La información estaba ahí y se tiraba al separarla en dos cadenas. Un acumulador
que respeta la secuencia lo resolvió, y las dos cadenas planas siguen saliendo
del mismo registro.

**Python con pandas y matplotlib, sin red en ejecución.** Las ruedas se publican
en `/runtime/pyodide/` —propio origen— verificadas contra el `sha256` del
lockfile instalado. La lista blanca vive en el código; `micropip` sigue sin
existir. Las tablas se detectan POR PATO, así que una lista de diccionarios ya
produce una tabla sin instalar nada.

**R con gráficas y data frames.** webR trae su dispositivo de canvas; estaba
apagado porque hasta ahora la salida era texto. El `ImageBitmap` se convierte a
PNG con `OffscreenCanvas`, que es la forma de hacerlo dentro de un Worker.

**Assets.** Los binarios salen del documento y van a S3 con clave por PERSONA, no
por documento: es lo que hace que publicar, entregar o copiar un documento con
diez imágenes no mueva un byte. Quién puede leer un asset lo decide el DOCUMENTO
que lo referencia, no el asset.

**Hoja de cálculo propia.** Univer se evaluó con números —9.9 MB sólo el preset
de hojas, 22 presets en el meta-paquete, una capa HTTP en el árbol— y se descartó
por el render en canvas: un canvas no tiene celdas que un lector de pantalla
pueda anunciar. Lo que hay es una `<table>` real y un intérprete de fórmulas que
NO es `eval`.

**Publicación.** Publicar CONGELA: crea un registro aparte con una copia. El
autor sigue editando y lo publicado no se mueve hasta que lo diga. Una entrega no
se publica —el servidor lo rechaza—; el camino es «Copiar a mis prácticas».

**`.nexbook`.** ZIP con manifiesto, documento y assets, con las referencias
reescritas a rutas del propio archivo. Lo que sale pasa por una lista BLANCA que
reconstruye el documento campo a campo.

### Terminado

- [x] M1 · Salidas ricas tipadas, sin subir la versión del formato
- [x] M2 · Orden REAL de stdout y stderr
- [x] M3 · Limpiar salida por celda y global
- [x] M4 · Python: tablas por pato, sin exigir pandas
- [x] M5 · Python: pandas y matplotlib desde el propio origen
- [x] M6 · Ruedas verificadas contra el sha256 del lockfile
- [x] M7 · R: `plot()` capturado como PNG
- [x] M8 · R: `data.frame` como tabla estructurada
- [x] M9 · Assets en S3, clave por persona, sin tabla nueva
- [x] M10 · `ImageBlock` con alt, pie, arrastrar, pegar y reemplazar
- [x] M11 · `SpreadsheetBlock` con motor de fórmulas propio
- [x] M12 · `SpreadsheetBridge` desacoplado de los kernels
- [x] M13 · Publicar como snapshot, con actualización explícita
- [x] M14 · Vista pública sin runtimes
- [x] M15 · Exportar `.nexbook`
- [x] M16 · Importar `.nexbook` con defensas
- [x] M17 · Lista blanca de exportación, con pruebas de secretos
- [x] M18 · «Copiar a mis prácticas»
- [x] M19 · Barra de Studio y menú de bloques
- [x] M20 · Aviso de tamaño al 80 %
- [x] M21 · 112 pruebas nuevas (82 unitarias + 30 de integración)
- [x] V.1 · typecheck · lint · 698 unitarias · 162 de integración · build

### Pendiente, y por qué

- [ ] **`AIBlock`.** Diseñado y documentado; no declarado. Falta el modelo de
      credenciales, y una credencial dentro del documento viajaría en cada
      exportación, publicación y entrega.
- [ ] **`ChartBlock`.** Una gráfica se guarda como imagen, no como datos.
- [ ] **Puente hoja ↔ Python/R.** La abstracción existe y está probada; conectarla
      a los kernels no se hizo.
- [ ] **Playwright.** Habría hecho falta un entorno de autenticación controlado
      que esta suite no tiene.
- [ ] **Recolección de assets huérfanos.** Consecuencia asumida de compartir
      assets entre copias.
- [ ] **Historial de publicaciones.** Actualizar sobrescribe.
- [ ] **`.ipynb`, `.qmd`, PDF.** NexBook es el modelo canónico; serán
      importadores y exportadores alrededor.
- [ ] **Project Workspace**, **`RemoteRunner`** y **CSP**: sin cambios.

### Trampas de esta iteración

1. **Mi propio endurecimiento del Worker rompió los paquetes de Python.** Tras
   arrancar el runtime, `fetch` quedaba muerto; `loadPackage` lo necesita DURANTE
   una ejecución, porque qué rueda hace falta depende del código de la celda. Se
   vio en el navegador y sólo ahí: las pruebas del motor no pasan por el
   endurecimiento. La regla pasó de «no puede pedir nada» a «sólo puede pedir sus
   propios assets», con la URL resuelta contra el origen antes de comparar.
2. **Una prueba encontró un fallo real en el motor de fórmulas.** Las celdas con
   literales se calculaban pero no se guardaban en la memoria compartida, así que
   quien leía la hoja entera veía una columna de datos escritos a mano llena de
   `null` mientras las fórmulas de al lado funcionaban.
3. **El build falló por una caché de `.next` corrupta, no por el código.** El
   error —`WasmHash._updateWithBuffer`, leyendo `length` de `undefined`— no se
   parece en nada a su causa. Borrar `.next` lo resolvió; conviene descartarlo
   antes de buscar en el propio cambio.
4. **Volví a caer en el Worker cacheado**, que ya costó tiempo la iteración
   anterior. Ahora la comprobación que funciona está anotada: pedir el bundle con
   un parámetro que rompa la caché y buscar dentro el cambio esperado ANTES de
   concluir nada.
5. **Dos expectativas mías estaban mal, no el código.** Un rechazo de subida daba
   422 —el esquema, antes de tocar la base— y yo esperaba 400; y el saneador de
   nombres de archivo conservaba la letra al quitar el acento, que es mejor que
   lo que yo había escrito en la prueba.

### Estado del repositorio al cerrar

**HEAD sigue en `8aef472`.** Las cuatro últimas iteraciones —Monaco/R-Python,
reposicionamiento, NexBook y NexBook modular— viven en el working tree sin
commitear, por instrucción expresa. El punto recuperable sigue etiquetado:

```bash
git tag -l pre-nexbook-checkpoint
git checkout pre-nexbook-checkpoint -- .
```

Commitear antes de la siguiente fase dejó de ser una recomendación: son cuatro
iteraciones de trabajo sostenidas por un solo tag.
