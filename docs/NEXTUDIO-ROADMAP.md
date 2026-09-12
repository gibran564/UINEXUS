# Nextudio — auditoría y hoja de ruta

Documento de continuidad de la evolución **UINexus → Nextudio**. Se escribió
ANTES de tocar código (Fase 0) y es el sitio donde vive el plan: qué se
encontró, qué se decidió, en qué orden se hace y qué queda fuera.

Se lee junto con `CHECKPOINT.md` (estado por iteración), `docs/ARCHITECTURE.md`,
`docs/NEXBOOK.md`, `docs/SECURITY.md` y `docs/LIMITATIONS.md`. **No los
sustituye ni los duplica**: aquí sólo está lo que cambia con Nextudio.

---

## 0. Estado recibido

| | |
|---|---|
| Rama | `codex/monaco-r-python-runtime` |
| HEAD | `db547e2` — *feat: NexBook, UINexus Studio y ejecución de R/Python en el navegador* |
| Árbol de trabajo | limpio |
| Fecha de la auditoría | 2026-09-11 |

### Suite base, medida antes de tocar nada

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0, sin avisos |
| `npm test` | ✅ 37 archivos · **698 pasadas**, 1 omitida (699) · 30.7 s |
| `npm run test:integration` | ✅ 13 archivos · **162 pasadas** · 39.2 s (DynamoDB Local, Java 21 presente) |
| `npm run build` | ✅ exit 0 |

Ese es el suelo. Cualquier fase que lo baje está incompleta.

---

## 1. Auditoría del estado real

Lo que sigue está **comprobado leyendo el código**, no deducido del encargo.

### 1.1 Lo que ya existe y funciona

| Capacidad | Dónde vive | Estado |
|---|---|---|
| Monaco por lenguaje, con respaldo a `<textarea>` | `components/aula/code-editor.tsx` | ✅ |
| Catálogo de capacidades por lenguaje | `lib/constants.ts` · `PROGRAMMING_LANGUAGES`, `LanguageCapabilities` | ✅ |
| Python (Pyodide) y R (webR) en Web Worker | `lib/code-engines/*`, `src/workers/*` | ✅ |
| `CodeRunner` (aislado) / `NotebookKernel` (sesión) | `lib/browser-code-runner.ts`, `lib/notebook-kernel.ts` | ✅ |
| NexBook: bloques `markdown`, `code`, `image`, `spreadsheet` | `lib/types.ts` `NexBookBlock` | ✅ |
| Outputs ricos `stdout`/`stderr`/`error`/`table`/`image`/`json`, en orden real | `lib/code-engines/output-recorder.ts` | ✅ |
| matplotlib, pandas, gráficas y `data.frame` de R | `lib/code-engines/python-packages.ts`, `r-engine.ts` | ✅ |
| Assets en S3 por persona, sin tabla nueva | `nexbook/<ownerUid>/<assetId>.<ext>` | ✅ |
| Hoja de cálculo con motor de fórmulas propio + `SpreadsheetBridge` | `lib/spreadsheet/*` | ✅ (puente sin conectar a los kernels) |
| Publicación de NexBook por SNAPSHOT | `lib/nexbook-publish.ts`, `data/nexbook-publications.ts` | ✅ |
| Import/export `.nexbook` con defensas (zip slip, bomb, número mágico) | `lib/nexbook-archive.ts` | ✅ |
| Lista **blanca** de exportación (`publishableDocument`) | `lib/nexbook-publish.ts` | ✅ con pruebas de secretos |
| «Copiar a mis prácticas» (evidencia ≠ portafolio) | `components/studio/nexbook-step.tsx` · `CopyForPortfolio` | ✅ |
| NexBook dentro de Workflow: plantilla docente + instancia por estudiante | `api/assignments/[id]/steps/[stepId]/nexbook` | ✅ |
| Snapshot inmutable de entrega | `NexBookSubmissionData` | ✅ |
| Ownership en tres capas + 404 indistinguible | `data/workspaces.ts`, `data/nexbooks.ts` | ✅ |
| Concurrencia optimista con `revision` y 409 | `data/nexbooks.ts` | ✅ |
| Prácticas personales (código y NexBook, una lista) | `components/workspace/practice-list.tsx` | ✅ |
| `Workspace.files?` preparado para multiarchivo | `lib/types.ts` `WorkspaceFiles` | ✅ modelo, ❌ UI |
| AI Worklog como entregable | `AIWorklogData`, `components/aula/deliverable-fields.tsx` · `WorklogFields` | ✅ |
| Vista previa docente «así lo verá el alumnado» | `components/aula/assignment-editor.tsx` · `TeacherPreview` | ✅ parcial |
| Materiales de la tarea, con ruta y prefijo propios | `api/assignments/[id]/materials` | ✅ |
| Prompts inline o de biblioteca | `StepPrompt`, `components/aula/step-prompt-field.tsx` | ✅ |

**Conclusión de esta tabla: no hay que reimplementar nada de lo anterior.**
Nextudio es una capa de producto y de experiencia sobre un motor que ya está.

### 1.2 Arquitectura encontrada

```
Firebase Auth ──▶ identidad (ID token en memoria del navegador)
                     │
Next.js 15 App Router ──▶ /api/*  ──▶ DynamoDB  (uinexus-<tabla>)
                     │                └▶ S3      (projects/, academic/, nexbook/)
                     └──▶ páginas públicas (RSC) y privadas (cliente)

CloudFront + KeyValueStore ──▶ ORIGEN AISLADO del código de alumnado
```

Tablas reales (`lib/aws/config.ts`, prefijo por `UINEXUS_TABLE_PREFIX`):
`users`, `handles`, `projects`, `courses`, `reports`, `assignments`,
`submissions`, `prompts`, `skills`, `resources`, `workspaces`.

`uinexus-workspaces` guarda **tres** clases de item discriminadas por `kind`:
`code`, `nexbook` y `nexbook-publication`.

Rutas de aplicación (las que importan a Nextudio):

```
/                      Inicio: landing si anónimo, muro académico si hay sesión
/explore               búsqueda de PROYECTOS publicados (sólo proyectos)
/courses  /courses/:slug
/aula  /aula/:courseId  …/tareas/nueva  …/tareas/:id[/editar|/entrega|/conjunta]
/practicas             lista de espacios personales (código + NexBook)
/practicas/:workspaceId          editor de código suelto
/practicas/nexbook/:nexbookId    Studio (NexBook)
/nexbook/:slug         publicación de un NexBook (lectura, sin runtimes)
/muro/:id              publicación del muro
/@handle  /@handle/:slug         perfil y ficha de proyecto
/dashboard  /publish  /about  /login  /register
```

### 1.3 Dónde vive la marca hoy

- **`SITE` (`lib/constants.ts:134`) sólo lo consume `app/layout.tsx`.** Es la
  fuente única del `<title>`, la descripción y Open Graph — y de nada más.
- **El resto de la marca está escrito a mano**: `Wordmark`
  (`components/ui/logo.tsx:35`), el `aria-label` del logotipo
  (`navbar.tsx:100`), el pie, `/about`, el landing, `/login`, `/register`,
  mensajes de ejecución, avisos de guardado…
- Recuento: **173 apariciones de `uinexus`/`UINexus`/`UINEXUS` en 81 archivos de
  `src/`**. De ellas, aproximadamente:
  - ~70 en `.tsx` (mitad copy visible, mitad comentarios),
  - ~35 en infraestructura (`lib/aws/config.ts`, `lib/firebase/*`,
    `lib/server/*`) que **no se tocan**,
  - el resto, comentarios de documentación interna.

### 1.4 Problemas de UX encontrados

| # | Problema | Evidencia |
|---|---|---|
| U1 | El producto se presenta como **tres cosas pegadas**: «Prácticas», «Aula», «Proyectos». Nada nombra el conjunto salvo la marca. | `navbar.tsx` `PRIVATE_LINKS` |
| U2 | El editor de NexBook se llama **«UINexus Studio»**, un cuarto nombre que compite con la marca y no dice qué es. | `nexbook-studio.tsx:25`, `practicas/nexbook/[id]/page.tsx:5` |
| U3 | «+ Nuevo NexBook» / «+ Archivo suelto» obliga a conocer el vocabulario interno para elegir. No hay una tercera puerta para «registrar cómo usé IA». | `practice-list.tsx:109-127` |
| U4 | El constructor docente expone **12 botones de atajo planos** (`STEP_ACTIONS`) y un `<select>` con **12 entregables técnicos** (`DELIVERABLE_OPTIONS`), incluido `resource_reference`. La primera decisión es «¿cuántos pasos?» en vez de «¿qué va a hacer el estudiante?». | `workflow-builder.tsx:48-61, 250-264`; `assignment-editor.tsx:425-474` |
| U5 | Un paso de `nexbook` **no se puede preparar desde el constructor**: hay que publicar la actividad y abrirla para editar la plantilla. | `workflow-builder.tsx:474-480` |
| U6 | La **búsqueda global no existe**. El campo de la barra va a `/explore`, que sólo busca proyectos publicados. No hay forma de encontrar un NexBook propio por nombre. | `navbar.tsx:87-92` |
| U7 | Los recursos y materiales **sólo se encuentran entrando a la materia y a la tarea**. Nada los reúne. | `navbar.tsx:19-22` (decisión deliberada anterior) |
| U8 | El landing sigue contando «programa + publica». No menciona laboratorios reproducibles ni trazabilidad de IA, que ya existen. | `components/home/landing.tsx` |
| U9 | «Prácticas» es hoy el único espacio personal y el nombre no cubre «laboratorio», «documento» ni «registro de IA». | `practice-list.tsx:36-41` |
| U10 | El AI Worklog vive **sólo dentro de una entrega**. No se puede llevar un registro trazable de IA fuera de una tarea. | `deliverable-fields.tsx` · `WorklogFields` |

---

## 2. Decisiones

Cada decisión dice **qué se hace y por qué**, y qué alternativa se descartó.

> **Ajustes aprobados al cerrar la Fase 0.** El roadmap quedó aprobado con tres
> correcciones, y son las que manda el texto de abajo:
>
> **A1 · NexIA no aparece en el lanzador.** Ni siquiera deshabilitada. Hasta la
> Fase 3 el lanzador operativo ofrece **NexLab y NexCode**, y nada más. NexIA se
> menciona en el landing como parte de la visión —el registro trazable de uso de
> IA, que hoy ya existe dentro de una actividad— sin ningún botón detrás. Un
> control apagado sigue siendo un control: ocupa sitio, se intenta pulsar y
> promete una fecha que nadie ha dado.
>
> **A2 · `SITE` es la fuente canónica del NOMBRE, no un sistema de plantillas.**
> Alimenta la metadata y las superficies centrales; en una frase normal se
> escribe «Nextudio» tal cual. Interpolar `SITE.name` dentro de cada oración
> construiría un pseudo-i18n alrededor de una constante, que es más frágil y
> mucho menos legible que escribir la palabra.
>
> **A3 · El énfasis del wordmark va en la `x`.** Semántica, metadata y texto
> leen siempre `Nextudio`; el dibujo destaca la equis con peso y color. La
> escritura `NeXtudio` **no existe** como forma normal.

### D1 · La marca visible pasa a ser `Nextudio`

Escritura normal en TODO texto, metadata y nombre accesible: **`Nextudio`**.
Nunca `NEXTUDIO`, `NeXtudio`, `NexTudio` ni `NextUdio` en contenido.

El wordmark **enfatiza gráficamente la `x`** (peso tipográfico y color de
acento) manteniendo **un solo nodo de texto continuo**:

```tsx
<span>Ne</span><span className="font-semibold text-accent">x</span><span>tudio</span>
```

Dos condiciones sostienen que eso siga siendo una palabra para quien navega con
voz, y las dos están escritas en `components/ui/logo.tsx`: los `<span>` van
pegados, sin espacios ni saltos entre ellos, y el de la `x` se queda `display:
inline`. Comprobado en el navegador: el `textContent` del enlace es exactamente
`Nextudio` y su nombre accesible, `Nextudio, ir al inicio`.

No se usa `aria-label` para «arreglar» una palabra partida: si hiciera falta,
estaría mal partida.

`SITE` es la **fuente canónica del nombre** —`SITE.name`, `SITE.tagline`,
`SITE.description`— y de ahí salen metadata, Open Graph y las superficies
centrales. **No** se interpola en cada frase: el copy normal escribe «Nextudio».

- Tagline: **Aprende construyendo.**
- Descripción: «Espacio académico para programar, construir laboratorios
  reproducibles, desarrollar proyectos y entregar el proceso completo de tu
  trabajo. Código, laboratorios, proyectos y clases en un solo espacio.»
  (la anterior decía «crear, programar, practicar, entregar y publicar
  proyectos»: escondía los laboratorios, que ya existían).

### D2 · Lo que NO se renombra, y por qué

La marca visible puede cambiar **sin migrar un byte de infraestructura**.
Quedan intactos:

| Cosa | Valor | Por qué no se toca |
|---|---|---|
| Repositorio | `gibran564/UINEXUS` | Renombrarlo rompe remotos y enlaces |
| Historial de Git | — | No se reescribe |
| Tablas DynamoDB | `uinexus-*` vía `UINEXUS_TABLE_PREFIX` | Renombrarlas es crear tablas nuevas y migrar datos |
| Buckets y prefijos S3 | `projects/`, `academic/`, `nexbook/`, `covers/`, `avatars/` | Las claves están guardadas dentro de registros |
| Variables de entorno | `UINEXUS_AWS_*`, `UINEXUS_PROJECTS_BUCKET`, `UINEXUS_TABLE_PREFIX`… | Cambiarlas rompe el despliegue |
| Proyectos de Firebase | `uinexus-f379f`, `demo-uinexus` | Están comprobados en código (`firebase/config.ts`) |
| Handle reservado | `'uinexus'` en `RESERVED_HANDLES` | Liberarlo permitiría a alguien registrarlo. Se **añade** `'nextudio'`, no se quita el otro |
| **Formato del contenedor `.nexbook`** | `NEXBOOK_ARCHIVE_FORMAT = 'uinexus-nexbook'` | **Es un dato persistido**: viaja dentro de cada archivo exportado y el importador lo compara. Cambiarlo volvería ilegible todo lo exportado hasta hoy |
| Rutas públicas | `/@handle/:slug`, `/nexbook/:slug`, `/muro/:id`, `/practicas`, `/aula` | Hay enlaces entregados |
| `localStorage` `uinexus-home-visit` | — | Cambiar la clave hace que el muro entero aparezca como «nuevo» una vez |
| `name` de `package.json` | `uinexus` | Identificador, no marca |
| `.claude/launch.json` | `"name": "uinexus"` | Configuración local de herramientas, no producto |
| Dominios | `uinexus.mx` y el origen aislado, que sale de `NEXT_PUBLIC_PROJECTS_ORIGIN` | Migración de dominio está fuera de alcance |

`createdWith` del manifiesto **sí** pasó a decir `Nextudio`: es texto humano que
el importador **no** valida, así que un `.nexbook` antiguo que diga `UINexus`
sigue abriéndose igual. Es la única cadena del archivo que se podía cambiar sin
romper nada, y por eso se cambió.

**Regla operativa:** en Fase 1 se busca y sustituye `UINexus` (capitalización
exacta) en copy visible. **Nunca** un reemplazo global sobre `uinexus` en
minúsculas ni sobre `UINEXUS` en mayúsculas: ahí es donde vive la
infraestructura.

### D3 · NexLab, NexCode y NexIA son EXPERIENCIAS, no productos

```
Nextudio            el producto
├── NexLab          experiencia · documento por bloques   → entidad: NexBook
├── NexCode         experiencia · programación rápida     → entidad: Workspace kind:'code'
└── NexIA           experiencia · trazabilidad de IA      → entidad: NexBook con bloques ai_worklog
```

Consecuencias concretas:

- **`NexBook` NO se renombra** a `NexLabDocument`. El tipo, el formato `.nexbook`,
  `NEXBOOK_FORMAT_VERSION`, las tablas y las rutas se quedan igual.
- **«UINexus Studio» desaparece como nombre visible.** El editor pasa a
  llamarse **NexLab**. El componente sigue siendo `NexBookStudio`: es el nombre
  del módulo, no de la marca.
- **NexCode no trae editor nuevo.** Es el `Workspace` + Monaco + `CodeRunner`
  que ya existen.
- **NexIA no es un backend ni una entidad.** Es un *preset* que crea un NexBook
  sembrado con bloques de AI Worklog. No hay `NexIADocument`.

### D4 · Navegación: renombrar, no multiplicar rutas

Nav autenticado propuesto:

```
Inicio · Aula · Espacios · Proyectos · Explorar
```

- `Prácticas` → **`Espacios`**, **conservando la ruta `/practicas`**. El
  encargo es explícito: no se crean rutas nuevas para justificar nombres
  nuevos. Es el mismo criterio por el que `/aula` conserva su nombre.
- **No se añaden `/recursos` ni `/publicaciones` como pestañas globales.** No
  existen esas pantallas, y los recursos viven dentro de una materia por una
  razón documentada (`navbar.tsx:19-22`). El problema que esas pestañas venían
  a resolver —«no encuentro nada»— lo resuelve la **búsqueda global** (Fase 2),
  que es la solución correcta y no un tercer sitio donde repetir listas.
- Dentro de `/practicas` («Espacios») aparecen filtros: **Todos · NexLab ·
  NexCode · Recientes**. «Míos / De clase» se pospone: hoy TODO lo que hay ahí
  es propio y privado, y un filtro que siempre da lo mismo miente.
- **NexIA es una acción de creación**, no una pestaña.

### D5 · `AIWorklogBlock`: un miembro más de la unión, reutilizando `AIWorklogData`

> **Implementado en la Fase 3**, con dos precisiones que el diseño no traía y que
> la implementación obligó a tomar: `conclusionMode: 'required'` se comprueba al
> ENTREGAR y contra la PLANTILLA del paso (no contra el snapshot que manda el
> navegador), y `resourcesUsed` sale de la lista blanca como lista **vacía** en
> vez de ausente. Las dos están razonadas en §3 · Fase 3.

Se descarta crear una tercera arquitectura de documento. La forma propuesta:

```ts
export interface NexBookAIWorklogBlock {
  id: string;
  type: 'ai_worklog';
  /** El registro, con la MISMA forma que el entregable de siempre. */
  worklog: AIWorklogData;
  /** Evidencia visual de la respuesta, POR REFERENCIA. Nunca bytes. */
  responseImages?: NexBookAIWorklogImage[];
  /** Qué exige la docente como reflexión. Se aplica sobre `studentAnalysis`. */
  conclusionMode?: 'none' | 'optional' | 'required';
  editableByStudent?: boolean;
}

interface NexBookAIWorklogImage {
  assetId: string;
  mimeType: NexBookImageMimeType;   // png | jpeg | webp, sin SVG
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}
```

Por qué **anidar** `AIWorklogData` en vez de aplanar sus campos: `provider`,
`model`, `objective`, `prompt`, `result`, `responseSummary`, `studentAnalysis`,
`whatWasUsed`, `whatWasChanged`, `whatWasDiscarded`, `conversationUrl` y
`resourcesUsed` **ya existen con ese nombre y esa semántica**, y
`normalizeAIResult()` y `aiWorklogToMarkdown()` ya saben leerlos. Anidando, un
entregable legacy y un bloque llevan exactamente el mismo objeto: no hay mapeo,
no hay dos verdades y las 19 pruebas de `ai-worklog-markdown.test.ts` siguen
siendo válidas.

- **La conclusión reutiliza `studentAnalysis`.** No se inventa un campo nuevo
  por cambiar el texto de una etiqueta.
- **`resourcesUsed` ya existe** (`ResourceRef[]`). No hace falta nada más para
  «qué recursos utilizó».
- **`NEXBOOK_FORMAT_VERSION` sigue en 1.** Añadir un miembro a una unión
  discriminada no invalida ningún documento guardado.
- **El bloque no se declara hasta que esté completo**: tipo, esquema Zod,
  editor, renderizador de sólo lectura, persistencia, snapshot, exportación
  segura y pruebas. Es la misma regla que dejó fuera a `AIBlock` y `ChartBlock`
  (ver `docs/NEXBOOK.md`).

**Evidencia de respuesta admitida en Fase 3:** texto, Markdown, imagen (por el
almacén de assets que ya existe) y enlace a la conversación. **Archivo genérico
NO**: ampliar `NexBookImageMimeType` a PDFs u ofimática exige otra lista blanca,
otro límite de tamaño y otra decisión sobre cómo se sirve. Es una decisión
aparte y se toma aparte.

**Qué NO sale al exportar ni al publicar:** `resourcesUsed` (son ids internos de
una materia, de la misma familia que `context`). `conversationUrl` sí sale,
saneado a HTTP(S) con `safeMarkdownUrl`. Se añaden pruebas a la lista blanca.

**El entregable `ai_worklog` legacy no se toca.** Sigue abriendo, guardando y
entregándose igual. No hay migración silenciosa de registros antiguos.

### D6 · NexIA no ejecuta IA, y la interfaz lo dice

Sin chat, sin API keys, sin BYOK, sin streaming, sin agentes, sin RAG. El copy
será del tipo «Registra cómo usaste una IA», nunca «Pregúntale a NexIA».
Ninguna pantalla ofrecerá un campo donde escribir un prompt *para Nextudio*.

### D7 · El creador docente se rediseña sobre el MISMO modelo

`Workflow`, `WorkflowStep`, `StepDeliverable`, `StepPrompt`, `StepToolChoice`,
`dependsOnStepIds` y `assignedTo` **no cambian**. Lo que cambia es la interfaz:

```
1 · Lo básico          título · objetivo · instrucciones · fecha y hora · a quién
2 · Qué hará el        lista de PARTES, cada una con «¿qué debe hacer?»
    estudiante         + Añadir parte
3 · Materiales y       archivos, enlaces, prompts, recursos de la materia
    recursos
4 · Vista previa       «Así lo verá el alumnado»
5 · Opciones           dependencias · responsables · modo colaborativo ·
    avanzadas          visibilidad de aportaciones
```

- **«Paso» → «Parte»** en copy visible. `WorkflowStep` sigue llamándose igual.
- El selector técnico de 12 entregables se sustituye por **7 opciones humanas**
  que escriben `actionType` + `deliverables[0].type` por debajo:

  | Opción visible | `actionType` | `DeliverableType` |
  |---|---|---|
  | 📝 Responder | `text_response` / `structured_response` | `text` / `structured` |
  | 📎 Entregar archivo o evidencia | `upload` / `link_submission` / `video` | `file` / `image` / `video` / `url` |
  | `<>` Programar (NexCode) | `code` | `code` |
  | ▦ Trabajar en laboratorio (NexLab) | `code` | `nexbook` |
  | ✦ Registrar uso de IA (NexIA) | `ai_interaction` | `ai_worklog` |
  | 🌐 Entregar proyecto | `project` | `project` |
  | → Continuar proceso | `instruction` | `none` |

  `resource_reference` y los `actionType` que no estén en el catálogo **siguen
  existiendo en el modelo** y siguen apareciendo si una tarea guardada los
  trae. No desaparecen: dejan de ser opciones de primer nivel.

- **`shape: 'single' | 'multi'` deja de preguntarse.** Se deriva:
  `partes.length > 1` → se guarda como `type: 'workflow'`; una sola parte cuyo
  entregable tenga equivalente legacy (`research`, `ai_worklog`, `web_project`,
  `external_link`, `freeform`) se sigue guardando **sin `workflow`**, tal y como
  hoy, para que una tarea creada hoy siga siendo indistinguible de una anterior.
  Una sola parte de `code` o `nexbook` —que no tienen equivalente legacy— se
  guarda como `workflow` de un paso, que el modelo ya admite.
- **La plantilla de NexLab se prepara desde el constructor** (U5): el mismo
  `NexBookStudio` en modo docente, embebido. No hay un editor de plantillas
  aparte.
- **La vista previa ya existe** (`TeacherPreview`) y se amplía; no suplanta
  identidad, no crea `Submission` y no llama a ninguna API.

### D8 · Búsqueda: contexto y consulta, nunca un sistema de archivos

No habrá carpetas, subcarpetas, mover, ni rutas arbitrarias. Habrá `Buscar en
Nextudio…` con `Ctrl/Cmd + K`.

**Arquitectura en dos niveles, sin tabla nueva y sin GSI nuevo en el primer
corte:**

| Nivel | Qué cubre | Cómo |
|---|---|---|
| 1 · instantáneo | **Sólo lo propio**: NexLab y NexCode | `listWorkspaceSummariesForOwner(uid)` — una `Query` a `byOwner`, `Limit 200`, la MISMA que ya se manda entera a `/practicas`. Se filtra en el navegador. Son resúmenes propios; nada ajeno se descarga para buscarlo. |
| 2 · servidor | Actividades, materiales, prompts, Skills y recursos de **las materias de la persona**, más sus proyectos | `GET /api/search`, que reutiliza `listCoursesForUser`, `isAssignedTo`, `resourceVisibleTo` y `listProjectsByOwner`. El filtrado por texto ocurre **en el servidor**. |

**Los dos niveles cubren fuentes DISJUNTAS**, y eso no es un detalle de
implementación: si `/api/search` devolviera también los espacios personales,
cada NexLab aparecería dos veces en la paleta. Lo fija una prueba de
integración.

- **La autorización no se reimplementa.** La búsqueda llama a los mismos
  lectores que ya deciden quién ve qué (`lib/server/course-access.ts`,
  `data/workspaces.ts`). Un resultado que no se puede abrir **no se devuelve**.
- **Nada privado ajeno viaja al navegador.** El nivel 1 es del propio dueño; el
  nivel 2 filtra en el servidor y devuelve sólo metadatos.
- Cada resultado dice: **qué es · dónde pertenece · quién lo creó · cuándo se
  modificó · privacidad**.
- **`Ctrl/Cmd + K` no se registra dentro de Monaco.** Monaco usa `Ctrl+K` como
  prefijo de acorde (`Ctrl+K Ctrl+C`, etc.). El manejador global comprobará que
  el foco no esté dentro del contenedor del editor antes de actuar.
- **Techo documentado:** el nivel 2 cuesta ≈ 1 `Scan` de materias (el que ya
  hace `/aula`) + 2–4 `Query` por materia. Con 6 materias son ~20 consultas por
  búsqueda, por eso se hace con *debounce* y a partir de 2 caracteres, no en
  cada pulsación. **Cuándo duela** (más de ~15 materias por persona, o p95 >
  800 ms): una proyección de metadatos. Ese día habrá que documentar qué
  contiene, qué NO contiene, cómo se autoriza, cómo se sincroniza y cómo se
  borra — y **nunca** convertirla en segunda fuente de verdad.
- **Favoritos: fuera de esta fase.** Son baratos pero exigen una ruta de
  escritura y un campo nuevo; primero hay que ver si con recientes y búsqueda
  alcanza.

### D9 · Entregar y publicar siguen siendo actos distintos

No cambia nada, y por eso se escribe: la entrega es un snapshot inmutable, la
publicación es una copia congelada de un NexBook **personal**, y el camino entre
las dos sigue siendo «Copiar a mis prácticas» → editar → publicar. El servidor
seguirá rechazando publicar un NexBook de contexto `workflow`.

### D10 · Rendimiento: nada nuevo se carga por visitar Nextudio

Se conserva y se comprueba con `npm run build`:

- Pyodide y webR **sólo** al ejecutar la primera celda de ese lenguaje.
- `/nexbook/:slug` sigue sin kernel ni Monaco (167 kB hoy).
- El landing no carga Monaco.
- La búsqueda global no debe arrastrar Monaco ni los motores al bundle común.

---

## 3. Fases

### Dependencias

```
Fase 0  auditoría + roadmap
   │
   ├──▶ Fase 1  marca + shell            (independiente)
   │        │
   │        ├──▶ Fase 2  organización y búsqueda
   │        │
   │        └──▶ Fase 3  NexIA (AIWorklogBlock)
   │                 │
   │                 └──▶ Fase 3.5  NexLab Data Interop
   │                          │
   │                          └──▶ Fase 4  rediseño docente
   │                                   │
   │                                   └──▶ Fase 5  experiencia del estudiante
   │
   └────────────────────────────────────────▶ Fase 6  hardening (al final)
```

La secuencia completa:

```
Fase 0    Auditoría                    ✅
Fase 1    Nextudio + shell             ✅
Fase 2    Espacios + búsqueda          ✅
Fase 3    NexIA                        ✅
Fase 3.5  NexLab Data Interop          ✅
Fase 4    Rediseño docente             ✅
Fase 5    Experiencia estudiante       ✅
Fase 6    Hardening                    ✅
```

**El roadmap está cerrado.** Lo que viene después no está aquí: ver §10.

Fase 2 y Fase 3 eran **paralelizables** y las dos están cerradas. La Fase 3.5
también, así que la 4 ya no tiene nada delante.

**Fase 4 pasa a depender de Fase 3.5, y no sólo de Fase 3.** El motivo es de
producto, no de implementación: el nuevo creador de actividades tiene que poder
ofrecer «Trabajar en laboratorio (NexLab)» con capacidades reales de laboratorio
integrado —una hoja que Python y R puedan leer, datos importados, resultados
reproducibles—. Rediseñar la interfaz docente alrededor de una versión del
laboratorio en la que los bloques están visualmente juntos pero
computacionalmente aislados significaría rehacerla una fase después.

---

### Fase 0 — Auditoría y hoja de ruta *(esta iteración)*

- [x] Rama, HEAD y árbol comprobados
- [x] `CHECKPOINT.md`, `CHECKPOINTS.md` y los cuatro documentos leídos
- [x] Implementación real revisada (NexBook, Studio, Workspace, Workflow,
      Builder, Runner, AI Worklog, publicaciones, recursos, materiales,
      navegación, landing, listados, Monaco, runners, persistencia, S3,
      DynamoDB, autorización)
- [x] Suite base ejecutada y anotada
- [x] `docs/NEXTUDIO-ROADMAP.md`
- [x] Informe al usuario

**Criterio de aceptación:** ningún archivo de producto modificado. ✅

---

### Fase 1 — Marca Nextudio + shell ✅ COMPLETADA

**Qué se hizo**

1. ✅ `SITE` dice `Nextudio`, con el tagline y la descripción de D1. Su
   comentario explica ahora la separación marca ↔ identificadores.
2. ✅ `Wordmark`: énfasis gráfico en la **`x`**, un solo nodo de texto,
   `aria-label` literal. `LogoMark` se conserva —el cruce de la retícula ya hacía
   de aspa— y el pie pasa a usar el mismo `Wordmark` que la barra.
3. ✅ Copy visible: navbar, landing, pie, `/about`, `/login`, `/register`,
   `/publish`, `/courses`, estados vacíos, avisos de ejecución, «Guardado en
   Nextudio», `link-card`, `code-editor`, `skill-*`, `roster`, mensajes de
   `.nexbook`, del kernel y de la política de identidad.
4. ✅ **«UINexus Studio» → «NexLab»** en `nexbook-studio.tsx`,
   `practicas/nexbook/[id]/page.tsx`, `nexbook-page.tsx`, `nexbook-step.tsx`
   («Abrir en NexLab», «Tu NexLab») y `nexbook-reader.tsx`.
5. ✅ **`Prácticas` → `Espacios`** en la barra, en el `<h1>`, en el `<title>`, en
   las migas («← Mis espacios») y en «Copiar a mis espacios». La ruta
   `/practicas` **no cambió**.
6. ✅ **Lanzador de espacios con dos puertas**: «+ Nuevo NexLab» y «+ Nuevo
   NexCode», cada una con su explicación, y la lista etiqueta cada fila como
   `NexLab · N bloques` o `NexCode · Python`. **NexIA no aparece**, ni siquiera
   apagada (ajuste A1).
7. ✅ Landing reescrito: hero Nextudio, «Un espacio para cada forma de
   trabajar» (NexCode / NexLab), «La clase más allá del aula», «Trabajo
   reproducible», «Del aula al portafolio» con entrega ≠ publicación, y los dos
   actores. NexIA se menciona **en prosa y sin botón**. La tabla de lenguajes se
   sigue generando del catálogo.
8. ✅ `README.md` con la sección «La marca es Nextudio; la infraestructura sigue
   diciendo `uinexus`», y `docs/ARCHITECTURE.md` con un §0 equivalente. `docs/`
   rebrandeado; `CHECKPOINT.md` y `CHECKPOINTS.md` **no** se tocaron: son
   historial y decían la verdad cuando se escribieron.
9. ✅ `'nextudio'`, `'nexlab'` y `'nexcode'` añadidos a `RESERVED_HANDLES`, sin
   quitar `'uinexus'`.

**Lo que se decidió distinto de lo previsto**

- **`'nexia'` NO se reservó todavía.** `RESERVED_HANDLES` lo comprueba también el
  esquema del PERFIL, así que reservar retroactivamente una palabra que alguien
  pudiera tener como handle lo dejaría sin poder guardar su propio perfil.
  «Nexia» es un nombre plausible; «nextudio», «nexlab» y «nexcode» no. Se
  reserva en la Fase 3, tras comprobar que no lo tiene nadie.
- **`/about` nombraba un dominio que no existe.** Decía
  `uinexus-projects.web.app` escrito a mano; el origen aislado real sale de
  `NEXT_PUBLIC_PROJECTS_ORIGIN` y en este despliegue es un dominio de CloudFront
  que no lleva ninguna marca. Ahora la página lo lee de la configuración.
- **`/about` describía una autorización que ya no existe.** Decía que «quien
  decide qué se guarda son las reglas de Firestore y de Storage», y esas reglas
  desaparecieron con la migración a AWS. Se corrigió a lo que de verdad pasa.
- **El comentario del `Wordmark` no puede escribir la variante prohibida.** La
  prueba de capitalización la habría encontrado ahí mismo, así que el comentario
  la describe en palabras en vez de deletrearla.

**Qué NO se tocó:** `lib/aws/*`, `lib/firebase/*` y `lib/server/*` sólo cambiaron
en COMENTARIOS. Ni una variable de entorno, ni un nombre de tabla, ni un prefijo
de S3, ni `infra/`, ni `scripts/`, ni ninguna clave persistida.

**Criterios de aceptación**

- ✅ `SITE.name === 'Nextudio'`.
- ✅ Cero apariciones de «UINexus» en `src/` (92 sustituciones en 53 archivos,
  todas con capitalización exacta).
- ✅ Ninguna variante `NEXTUDIO` / `NeXtudio` / `NexTudio` / `NextUdio` en copy.
- ✅ `TABLES`, `INDEXES`, prefijos de S3, variables de entorno y
  `NEXBOOK_ARCHIVE_FORMAT`, idénticos. Lo fija una prueba.
- ✅ Suite verde y build sin regresión de tamaño.

**Pruebas nuevas**

- `tests/unit/branding.test.ts` — **9 pruebas**: `SITE` dice Nextudio; ninguna
  fuente escribe la marca anterior ni una variante de capitalización; las once
  tablas, los índices, el formato `.nexbook`, las variables de entorno y los
  prefijos de S3 siguen intactos; los handles reservados añaden sin liberar.

Las pruebas de `.nexbook` **conservan a propósito** fixtures con
`createdWith: 'UINexus'`: son la comprobación de que un archivo exportado antes
del cambio de marca sigue importándose.

**Validación**

| Comando | Antes (Fase 0) | Después (Fase 1) |
|---|---|---|
| `typecheck` | ✅ | ✅ |
| `lint` | ✅ | ✅ |
| `test` | 698 + 1 omitida | **707** + 1 omitida (38 archivos) |
| `test:integration` | 162 | **162** (sin cambios) |
| `build` | ✅ | ✅ |
| shared JS | 104 kB | **104 kB** |
| `/nexbook/[slug]` | 167 kB | **167 kB** |
| `/practicas/nexbook/[id]` | 232 kB | **232 kB** |

**Navegador:** superficies públicas comprobadas en 1280×900 (claro y oscuro),
390×844 y 375×812, sin desbordamiento horizontal ni errores de consola. Las
superficies detrás de la sesión no se pudieron recorrer: esta instalación apunta
a Firebase y AWS reales y no hay cuenta institucional disponible. Detalle
completo en `CHECKPOINT.md`.

---

### Fase 2 — Organización y descubrimiento ✅ COMPLETADA

**Qué se hizo**

1. ✅ **Filtros en Espacios**: Todos / NexLab / NexCode / Recientes, con el
   número de cada uno a la vista y el estado en la URL (`?tipo=`), mismo patrón
   que `/explore` y el muro. Filtra sobre `WorkspaceSummary`, que ya trae `kind`
   y `updatedAt`: **ni una consulta nueva al servidor**. Cuando el filtro deja la
   lista vacía se dice cuál fue y se ofrece deshacerlo.
2. ✅ Cada fila dice qué es (`NexLab · 4 bloques` / `NexCode · Python`), cuándo
   se guardó y que es **privada**.
3. ✅ **Búsqueda global** con `Ctrl/Cmd + K`, en los dos niveles de D8.
4. ✅ El campo de la barra deja de ir a `/explore` **para quien tiene sesión**:
   pasa a ser el botón que abre la paleta, con su atajo escrito al lado. Para
   quien no la tiene sigue siendo el formulario de siempre, porque `/explore` es
   exactamente lo que puede buscar.

**Lo que se decidió distinto de lo previsto**

- **Los espacios personales NO viajan en `/api/search`.** D8 decía «nivel 1 en el
  navegador, nivel 2 en el servidor», y al implementarlo quedó claro que la
  frontera tenía que ser también de FUENTES: si la ruta devolviera además los
  espacios propios, cada NexLab saldría dos veces en la paleta. La ruta cubre lo
  repartido —actividades, materiales, prompts, Skills, recursos y proyectos
  propios— y el navegador cubre lo suyo, que ya tiene en memoria. Hay una prueba
  de integración que lo fija.
- **La regla de visibilidad de la biblioteca salió a un módulo propio**
  (`lib/server/resource-visibility.ts`). Estaba escrita a mano dentro de
  `api/courses/[id]/library`; copiarla en la búsqueda habría creado dos reglas, y
  la que se olvida de actualizar es siempre la que enseña de más. Ahora las dos
  pantallas llaman a la misma función.
- **La eñe se protege al normalizar.** La descomposición Unicode parte `ñ` en
  `n` + tilde combinante, así que el filtro que quita acentos la habría aplanado
  y «año» sería «ano». Se aparta antes de descomponer y se devuelve después. La
  diéresis sí se quita: «pinguino» tiene que encontrar «pingüino».
- **Faltaba un índice en el arnés de integración.** La tabla de proyectos de
  DynamoDB Local no tenía `byOwner`, aunque en producción sí existe, y
  `listProjectsByOwner` falló con «the table does not have the specified index».
  Se añadió el índice al arnés en vez de esquivarlo desde la ruta: una tabla de
  pruebas que no es la de producción prueba otra cosa.
- **Sin favoritos**, como estaba previsto. Con recientes, filtros y búsqueda, no
  hay todavía evidencia de que hagan falta.

**Criterios de aceptación**

- ✅ Se encuentra un NexLab propio escribiendo parte de su nombre —y sin
  acentos—, sin esperar a la red.
- ✅ Un recurso de una materia a la que no se pertenece **nunca** aparece.
  Probado con el título exacto, que es el caso que de verdad importa.
- ✅ Un borrador del profesorado y una actividad asignada a otra persona tampoco.
- ✅ No existe árbol de carpetas ni operación de «mover».
- ✅ `Ctrl/Cmd + K` no interfiere con Monaco: el manejador se retira si el foco
  está dentro de un `.monaco-editor`, que es donde `Ctrl+K` es prefijo de acorde.

**Pruebas nuevas**

- `tests/unit/search.test.ts` — **14**: normalización (acentos, eñe, diéresis),
  coincidencia por subcadena y por todos los términos, orden por prefijo y
  fecha, y recorte por clase y total.
- `tests/integration/search-route.test.ts` — **12**: 401 sin sesión, 403 con
  dominio ajeno, vacío por debajo del mínimo, borradores y actividades ajenas
  invisibles, materias ajenas invisibles incluso con el título exacto,
  propuestas de la biblioteca visibles sólo para su autor y el profesorado, los
  espacios personales fuera de esta respuesta, y ningún UID en el cuerpo.

**Validación**

| Comando | Fase 1 | Fase 2 |
|---|---|---|
| `typecheck` | ✅ | ✅ |
| `lint` | ✅ | ✅ |
| `test` | 707 + 1 omitida | **721** + 1 omitida (39 archivos) |
| `test:integration` | 162 | **174** (14 archivos) |
| `build` | ✅ | ✅ |
| shared JS | 104 kB | **104 kB** |
| `/nexbook/[slug]` | 167 kB | **167 kB** |
| `/practicas/nexbook/[id]` | 232 kB | **232 kB** |
| `/practicas` | 2.80 kB | 3.39 kB (+0.6 kB: filtros y recuentos) |

**La paleta no engorda la carga común.** Vive dentro de `Navbar`, que ya estaba
en el bundle compartido, y lo que añade son unos kilobytes de componente: los
104 kB de `First Load JS shared by all` no se mueven. Y no arrastra nada pesado:
no importa Monaco, ni los motores, ni ninguna dependencia nueva.

---

### Fase 3 — NexIA integrado ✅ COMPLETADA

**Qué se hizo**

1. ✅ `NexBookAIWorklogBlock` según D5, **completo y en una sola unidad de
   trabajo**: tipo (`lib/types.ts`), esquema (`aiWorklogBlockSchema`), editor
   (`components/studio/nexbook-worklog.tsx`), render de sólo lectura
   (`NexBookWorklogView`, el mismo para vista docente, bloque bloqueado y
   publicación), persistencia, snapshot de entrega, export e import `.nexbook`,
   y su entrada en la lista **blanca** de `publishableDocument`.
2. ✅ `conclusionMode` sobre `studentAnalysis`, aplicado **al entregar** y
   contra la **plantilla** del paso.
3. ✅ Capturas de la respuesta por el almacén de assets existente: mismo
   prefijo, mismo límite, mismos MIME. Sin bucket nuevo.
4. ✅ Preset **NexIA** (`lib/nexia-preset.ts`) y tercera puerta del lanzador de
   Espacios. Produce un NexBook normal, privado y personal.
5. ✅ Entregable `ai_worklog` legacy: **sin tocar**, sin migración.

**Lo que se decidió distinto de lo previsto**

- **`conclusionMode: 'required'` se comprueba contra la PLANTILLA, no contra lo
  que manda el navegador.** D5 no lo precisaba. Al implementarlo quedó claro que
  leerlo del snapshot del estudiante convertía la regla en decorativa: el campo
  es legítimo en un documento, así que bastaba con mandar `'none'` para
  saltársela. El servidor lee la plantilla del paso —que es de la docente— y
  empareja por id de bloque, que la copia conserva (`instanceDocumentFrom`).
  Borrar el bloque tampoco funciona: se exige que exista y esté contestado.
  Cuesta un `GetItem` por paso de NexBook y sólo al entregar.
- **Por eso el selector de «Conclusión del estudiante» sólo aparece en modo
  plantilla** (`templateMode`, que sale del `role` que devuelve el servidor). No
  es la defensa —la defensa está arriba— sino la razón por la que el control no
  se enseña donde no significa nada.
- **La obligatoriedad NO vive en el esquema.** Si viviera, un documento cuya
  reflexión está a medio escribir no se podría autoguardar, que es exactamente
  cuando hace falta guardarlo. Hay una prueba que fija que un borrador
  incompleto sigue siendo válido.
- **`resourcesUsed` sale VACÍO, no ausente.** Omitir el campo produciría un
  documento que no pasa su propio esquema al reimportarlo. La pérdida de
  significado al exportar se documenta en `docs/LIMITATIONS.md` en vez de
  inventarse una conversión silenciosa de ids a nombres.
- **`'nexia'` sigue SIN reservarse como handle.** La Fase 1 lo pospuso a ésta
  «tras comprobar que no lo tiene nadie», y esa comprobación exige consultar la
  tabla de usuarios real, que este entorno no alcanza. Reservarlo a ciegas
  dejaría a quien lo tuviera sin poder guardar su propio perfil
  (`RESERVED_HANDLES` lo valida también el esquema del PERFIL). Queda pendiente
  con su motivo escrito, no olvidado.
- **`AIBlock` deja de estar «previsto».** Lo que se implementó es un registro, y
  la sección de `docs/NEXBOOK.md` que describía un bloque que llamaría a un
  modelo se reescribió para decir qué hay y qué no va a haber por ampliación.
- **El landing mentía al cerrar la fase, y se arregló el mismo día.** Decía que
  el registro «tendrá espacio propio —NexIA— más adelante», que era cierto en la
  Fase 1 (ajuste A1) y dejó de serlo en cuanto NexIA apareció en el lanzador. Una
  promesa cumplida que se sigue anunciando como futura envejece igual de mal que
  una que no se cumple. El copy nuevo describe lo que hace y dice explícitamente
  que Nextudio **no ejecuta** la IA.

**Criterios de aceptación**

- ✅ Un `.nexbook` con bloques de AI Worklog exporta e importa sin perder nada y
  **sin secretos** (probado, incluidas capturas, `conclusionMode` y el bloqueo).
- ✅ Un AI Worklog antiguo sigue abriendo y entregándose; `normalizeAIResult` y
  `aiWorklogToMarkdown` sirven sobre `block.worklog` sin adaptarlas.
- ✅ `NEXBOOK_FORMAT_VERSION === 1` y `NEXBOOK_ARCHIVE_FORMAT ===
  'uinexus-nexbook'`, los dos fijados por una prueba.
- ✅ La interfaz nunca sugiere que NexIA responda preguntas: no existe
  «Pregunta», «Enviar prompt», «Generar» ni «Respuesta de NexIA» en ninguna
  superficie, y el editor lo dice en su primera línea.

**Pruebas nuevas**

- `tests/unit/nexia.test.ts` — **34**: modelo y defaults, rechazo del registro
  aplanado, `conclusionMode`, URL no HTTP(S), capturas (UUID, MIME, tope),
  compatibilidad legacy, assets (`collectAssetIds`, `imageMimeTypeFor`,
  pertenencia), lista blanca (`resourcesUsed`, campos inyectados, saneo de
  enlace, revalidación), roundtrip del contenedor, snapshot inmutable, borrador
  incompleto guardable y preset.
- `tests/integration/nexia-routes.test.ts` — **16**: persistencia por las rutas
  reales, autoguardado de un registro a medias, 404 indistinguible, publicación
  legible sin sesión, `resourcesUsed` fuera sin llevarse nada humano, ausencia de
  UID y de identificadores internos, campo inyectado que no llega, conclusión
  obligatoria al entregar y no al guardar, intento de bajarla a `none` desde el
  navegador, borrado del bloque, actividad sin la exigencia, y el preset como
  NexLab más de la lista.

**Validación**

| Comando | Fase 2 | Fase 3 |
|---|---|---|
| `typecheck` | ✅ | ✅ |
| `lint` | ✅ | ✅ |
| `test` | 721 + 1 omitida (39 archivos) | **755** + 1 omitida (40 archivos) |
| `test:integration` | 174 (14 archivos) | **190** (15 archivos) |
| `build` | ✅ | ✅ |
| shared JS | 104 kB | **104 kB** |
| `/nexbook/[slug]` | 167 kB | 170 kB (+3 kB: el render de sólo lectura) |
| `/practicas/nexbook/[id]` | 232 kB | 235 kB (+3 kB: el editor del bloque) |
| `/practicas` | 3.39 kB | 4.84 kB (+1.45 kB: la tercera puerta y el preset) |

**NexIA no arrastra runtimes a ninguna vista que no los necesite.** Comprobado
sobre el manifiesto de compilación y no de oído: el chunk que contiene el bloque
lo usan exactamente cuatro rutas —la vista de la actividad, la entrega, la
publicación y NexLab—. El landing, `/login` y `/practicas` no lo incluyen, y ni
Pyodide ni webR aparecen en ninguna de ellas.

**Navegador.** Se comprobaron las superficies que no necesitan sesión: el
lanzador de Espacios con sus tres puertas y el copy del formulario de NexIA, en
1280×900 oscuro y 375×812 claro, sin desbordamiento ni errores de consola; y el
landing, donde se encontró y corrigió la frase caducada. Todo lo que hay detrás
de la sesión —el editor del bloque, la plantilla docente, la entrega— sigue sin
poderse recorrer a mano (R9/R11) y queda cubierto por integración.

---

### Fase 3.5 — NexLab Data Interop ✅ COMPLETADA

**Qué se hizo**

0. ✅ **Paso 0 · Sandbox local con dos identidades.** `npm run dev:local`
   levanta DynamoDB Local, el emulador de Firebase Auth y `next dev`, compila
   los Workers, crea las tablas y siembra una materia con docente y estudiante.
   Ver `docs/LOCAL-DEVELOPMENT.md`. Cierra la deuda de recorridos autenticados
   que arrastraban todas las iteraciones (R9/R11).
1. ✅ **`SpreadsheetBridge` auditado y REUTILIZADO.** No se creó un segundo
   puente: `resolveLabDataset` lo llama para leer valores ya calculados.
2. ✅ **NexLab Data Bridge** (`lib/lab/`): escáner de referencias, resolución
   bajo demanda, catálogo sin datos y un tipo CERRADO (`LabDataset`) como única
   cosa que cruza al Worker.
3. ✅ **API del laboratorio**: `nex.sheet`, `nex.sheet_by_id`, `nex.sheets`,
   `nex.image`, `nex.output` y `to_dataframe()` en Python; `nex_sheet`,
   `nex_output`, `nex_image`, `nex_sheets` en R, devolviendo `data.frame`.
4. ✅ **Identidad estable**: `blockId` manda; el nombre es comodidad y un
   duplicado **para con un error** que nombra a los dos candidatos.
5. ✅ **Importación CSV y XLSX**, con parsers propios sobre `fflate`.
6. ✅ **`ImageBlock` → código**: bytes, nunca URL. Los descarga el hilo
   principal por la ruta autorizada.
7. ✅ **Outputs persistidos → código**, incluido `Python → R`.
8. ✅ **R13 resuelto**: `INDEXES.coursesBySlug` era una constante muerta que
   nombraba un índice inexistente. Se **retiró la constante** y **no** se creó
   el índice.

**Lo que se decidió distinto de lo previsto**

- **Las referencias se resuelven por ANÁLISIS DEL FUENTE, no bajo demanda desde
  el Worker.** El plan decía «bajo demanda» sin decir cómo. La forma natural
  —que el Worker pida datos a mitad de ejecución— exige comunicación síncrona
  con el hilo principal, y eso significa `SharedArrayBuffer` + `Atomics.wait`,
  que a su vez exigen aislamiento por origen (COOP/COEP) que Nextudio no tiene.
  Se lee el fuente antes de ejecutar y se prepara **sólo lo referenciado**.
  El precio, documentado: las referencias tienen que ser **literales**.
  `nex.sheet(variable)` no funciona, y lo dice con un error que explica por qué.
- **No se instaló ninguna biblioteca de XLSX.** Se auditaron SheetJS, ExcelJS y
  `read-excel-file`; la tabla con el porqué está en `lib/spreadsheet/xlsx.ts`.
  Decidió que **`fflate` ya es dependencia** —con sus defensas de zip slip y ZIP
  bomb ya escritas— y que escribir el lector da **control total sobre qué partes
  del archivo se abren**: macros, Power Query, conexiones y enlaces externos no
  se filtran, sencillamente no se decodifican. Efecto secundario valioso: sin
  parser de XML general, XXE y la expansión de entidades **no tienen dónde
  ocurrir**.
- **Una hoja de Excel → un `SpreadsheetBlock`.** Es la opción con menor
  incompatibilidad: no cambia `NexBookSheetData`, ni el editor, ni la lista
  blanca, ni el `.nexbook`, y deja a cada hoja con su nombre del libro, que es
  por el que `nex.sheet("Ventas")` la busca.
- **Los booleanos se infieren en el PUENTE, no en el motor de fórmulas.**
  `VERDADERO` es texto para la hoja —lo que se escribe es lo que se ve— y un
  booleano para el código. Ponerlo en `formula.ts` habría cambiado el
  comportamiento de hojas existentes; ponerlo aquí es «tipos razonablemente
  inferidos» sin tocar nada.
- **Se arregló un fallo de producto que sólo el sandbox podía destapar**:
  `api-client.ts` leía `auth.currentUser` sin esperar a que Firebase restaurara
  la sesión, así que abrir una URL directamente con sesión válida respondía
  «Necesitas iniciar sesión». Se añadió `await auth.authStateReady()`.
- **`dev:local` compila los Workers al arrancar.** `next dev` a secas se saltaba
  el `predev`, y el síntoma fue `NameError: name 'nex' is not defined` con el
  código correcto: lo que se ejecutaba era el Worker compilado antes del cambio.

**Validación**

| Comando | Fase 3 | Fase 3.5 |
|---|---|---|
| `typecheck` / `lint` | ✅ | ✅ |
| `test` | 755 + 1 omitida (40 archivos) | **859** + 1 omitida (44 archivos) |
| `test:integration` | 190 (15 archivos) | **190** (15 archivos) |
| `build` | ✅ | ✅ |
| shared JS | 104 kB | 105 kB |
| `/` (landing) | 246 kB | 247 kB |
| `/nexbook/[slug]` | 170 kB | **170 kB** |
| `/practicas` | 4.84 kB | **4.84 kB** |
| `/practicas/nexbook/[id]` | 235 kB | 239 kB |

**Los parsers NO entran en ninguna carga inicial.** Comprobado sobre el
manifiesto: el chunk del lector de XLSX y el del de CSV no los carga de entrada
**ninguna** página —se piden con `import()` dentro del manejador— y el módulo
`nex` de Python no aparece en ningún chunk de cliente, porque vive en el Worker.

**Navegador (con sesión real, por fin)**

Recorrido como docente en el sandbox: acceso con
`docente.sandbox@itdurango.edu.mx`, Aula, la materia sandbox, la actividad
publicada. Y en NexLab, ejecutando de verdad:

```
hoja «Ventas» escrita a mano  →  Python  →  ['producto','unidades','precio']
                                            [['Tornillo',10,2.5], …]
                                            total: 28
```

con la fórmula `=SUMA(B2:B3)` llegando **ya calculada** como `14`. Y el flujo
completo de importación:

```
CSV con «;», comillas y vacíos  →  hoja  →  Python
  ['region','unidades','activo']
  [['Norte',120,True], ['Durango, Dgo.',85,False], ['Sur',None,True]]
```

`Durango, Dgo.` entero dentro de su campo, `120` como número, `True`/`False`
como booleanos y el vacío como `None`.

**Lo que NO se pudo comprobar en el navegador:** `Spreadsheet → R`. webR arranca
un Worker ANIDADO y el navegador embebido de esta herramienta no lo admite:
falla con «An error occurred initialising the webR PostMessageChannel worker»
**también con código R plano sin la API del laboratorio**, así que es ambiental
y no una regresión. El prólogo de R está cubierto por pruebas de su forma y de
su escape; ejecutarlo exige un Chrome o Firefox normales.

Tampoco se probaron las imágenes desde el código en el navegador: el sandbox no
tiene S3. Están cubiertas ejecutando Pyodide de verdad en
`tests/unit/lab-runtime.test.ts`.

---

<details>
<summary><strong>El plan original de la Fase 3.5</strong> (se conserva: es donde están razonadas las decisiones)</summary>

**Por qué esta fase, y por qué ANTES del rediseño docente**

Hoy los bloques de un NexBook viven en el mismo documento pero están
**computacionalmente aislados**: una hoja de cálculo y una celda de Python
comparten pantalla y no comparten datos. La Fase 4 tiene que poder ofrecer al
profesorado «Trabajar en laboratorio (NexLab)» como una actividad real:

```
El profesor proporciona un archivo Excel
        ↓
SpreadsheetBlock
        ↓
Python / R lo consume
        ↓
produce tabla o gráfica
        ↓
el alumno interpreta
        ↓
registra eventualmente su uso de IA
        ↓
entrega el NexBook completo
```

Rediseñar el creador docente alrededor de un laboratorio que todavía no sabe
hacer eso significaría rehacerlo una fase después.

**Objetivo**

Que los bloques de NexLab puedan funcionar como elementos de un mismo laboratorio
computacional, mediante una capa de interoperabilidad **explícita, pequeña y
testeable**:

```
NexBook
│
├── SpreadsheetBlock ─┐
├── ImageBlock ───────┤
├── outputs ──────────┤
├── data/assets ──────┤
│                     ▼
│             NexLab Data Bridge
│                     │
│              NotebookKernel
│              ├── Python
│              └── R
│
└── resultados
```

No se crea comunicación directa entre React y Pyodide/webR.

**Alcance**

1. **`SpreadsheetBridge` se AUDITA y se REUTILIZA.** Ya existe
   (`lib/spreadsheet/bridge.ts`) y está probado. **No se crea un segundo
   puente.**

   ```
   SpreadsheetBlock → SpreadsheetBridge → NexLab Data Bridge → NotebookKernel
   ```

2. **Una API académica estable dentro del código.** El nombre definitivo se
   decide auditando conflictos; conceptualmente:

   ```python
   ventas = nex.sheet("Ventas")            # o .to_dataframe()
   ventas = nex.sheet_by_id("block-…")     # acceso estable por identificador
   ```

   ```r
   ventas <- nex_sheet("Ventas")
   ```

   Lo obligatorio no son los nombres, sino: API explícita, **ids estables**,
   alias humano opcional, errores comprensibles y **ninguna dependencia del
   orden visual del bloque**.

   El código del estudiante **no** debe conocer React, el estado interno,
   DynamoDB, S3, URLs firmadas ni componentes de interfaz.

3. **Referencias por `blockId`, nunca por posición.** «Celda 3» o «bloque 4» no
   son referencias: mover un bloque dentro del documento **no puede** romper
   `Spreadsheet → Python`. Si se admiten nombres humanos, los duplicados se
   resuelven **explícitamente**; nunca se elige el primero en silencio.

4. **Importación `.xlsx` en el `SpreadsheetBlock`.**

   ```
   Hoja de datos
   [ Importar XLSX ] [ Importar CSV ]
   ```

   ```
   .xlsx → parser seguro → modelo SpreadsheetBlock → persistencia normal
   ```

   El archivo **no** se convierte en la fuente viva: después de importar, la
   fuente de verdad es el `SpreadsheetBlock`. Puede conservarse
   `source?: { type: 'xlsx'; originalName: string }` sólo si aporta valor real y
   no obliga a una migración.

   Alcance razonable: hojas, valores, strings, números, booleanos, fechas y
   fórmulas compatibles o convertibles. **No se promete compatibilidad total con
   Excel**: se detecta y se ADVIERTE cuando se ignoran macros, VBA, Power Query,
   tablas dinámicas, conexiones externas, fórmulas no soportadas, objetos
   complejos o gráficos embebidos. **No se ejecutan macros. No se resuelven
   conexiones externas. Importar un `.xlsx` no abre acceso a red.**

5. **Importación CSV**: UTF-8, detección o selección de delimitador, encabezados,
   comillas y valores vacíos. No se construye un ETL.

6. **`ImageBlock` → Python/R.** Se mantiene la distinción que ya existe:
   `ImageBlock` es contenido deliberado, `ImageOutput` es resultado de ejecución.

   ```python
   img = nex.image("Muestra")   # o nex.asset("block-id")
   ```

   El runtime recibe **bytes** o equivalente seguro. **Nunca una URL firmada
   permanente, y nunca acceso del Worker a S3.**

7. **Acceso a outputs persistidos**, si resulta razonable en esa fase:

   ```python
   resultado = nex.output("limpieza")
   ```

   Útil para `Python → R`, para reabrir el documento tras perder la sesión y para
   reutilizar un resultado ya guardado.

**Seguridad, que no se negocia**

```
correcto:   S3 → capa autorizada de Nextudio → NexLab → payload limitado → Worker
prohibido:  Worker → fetch arbitrario → S3 / internet
```

El aislamiento de red actual se conserva entero. Permitir leer datos del NexBook
**no** es permitir internet. Un `CodeBlock` sólo accede a lo que el Data Bridge
expone explícitamente: nada de estado de React, DOM, cookies, token de Firebase,
credenciales, enumeración de S3, otros NexBooks, assets ajenos, `fetch` genérico
ni sistema de archivos arbitrario.

**Kernel persistente ≠ datos persistidos**

`NotebookKernel` ya resuelve `Python → Python` **durante una sesión**. La Fase 3.5
resuelve además `Spreadsheet → Python`, `Spreadsheet → R`, `Image → Python/R` y
`output persistido → otro bloque o kernel`, y permite reabrir el documento sin
depender de memoria volátil.

**Lo que la Fase 3.5 NO hace**

No convierte NexLab en un **grafo reactivo automático**. Nada de «cambia A1 →
ejecuta Python → ejecuta R → recalcula la gráfica → reejecuta dependencias». El
modelo es explícito y enseñable:

```
editar datos → ejecutar bloque → ese bloque lee el estado ACTUAL de sus fuentes
```

**Rendimiento**

Los datos se transfieren **bajo demanda**, sólo cuando una ejecución los
necesita, y acotados por tamaño. **No** se serializan todos los assets del
NexBook hacia cada Worker al arrancarlo, ni se cargan automáticamente todas las
imágenes, hojas, outputs o datasets.

**Compatibilidad**

No se rompe nada: NexBooks existentes, `SpreadsheetBlock` e `ImageBlock`
existentes, `.nexbook` V1, outputs existentes, `NotebookKernel`, `CodeRunner`
aislado, snapshots y publicaciones. Campos **opcionales y backward-compatible**;
`NEXBOOK_FORMAT_VERSION` **no sube** salvo incompatibilidad real. Los metadatos
nuevos que sean portables (`blockId`, alias, metadata de origen) salen por la
lista blanca; nunca URLs firmadas, UIDs internos, credenciales, identificadores de
infraestructura ni rutas privadas de S3.

**Pruebas mínimas de la Fase 3.5**

| Área | Qué se prueba |
|---|---|
| Spreadsheet | hoja → Python; hoja → R; tipos básicos; celdas vacías; nombres duplicados; referencia por id estable; mover el bloque no rompe la referencia |
| XLSX | importación simple; varias hojas; números, texto y fechas; fórmula soportada; fórmula no soportada produce **aviso**; macros NO se ejecutan; archivo inválido rechazado; límite de tamaño |
| CSV | encabezados; delimitadores; comillas; UTF-8; valores vacíos |
| Imágenes | `ImageBlock` → Python; → R cuando el runtime lo permita; MIME permitido; asset ajeno rechazado; **ninguna signed URL dentro del kernel** |
| Outputs | tabla persistida → otro kernel; Python → R; documento reabierto conserva el output |
| Seguridad | `fetch("https://example.com")` sigue sin funcionar; la suite que protege la red sigue verde |

**Criterios de aceptación**

- Una actividad como ésta es **un solo NexBook reproducible**:

  ```
  [ Markdown ] Importa los datos proporcionados.
  [ Spreadsheet ] ventas.xlsx
  [ Python ] Limpia los datos y calcula estadísticas.
  [ Output ] tabla limpia
  [ Python ] Genera una visualización.
  [ Output ] gráfica
  [ AI Worklog ] Si utilizaste IA, registra cómo la usaste.
  [ Markdown ] Interpreta los resultados.
  ```

- Mover un bloque no rompe ninguna referencia.
- El Worker sigue sin poder salir a la red.
- `NEXBOOK_FORMAT_VERSION` sigue en 1.

</details>

---

### Fase 4 — Rediseño del creador docente ✅ COMPLETADA

Se reconstruyó la pantalla de crear y editar una actividad. **El modelo no
cambió**: `Workflow`, `WorkflowStep`, `StepDeliverable`, `StepPrompt`,
`StepToolChoice`, `dependsOnStepIds` y `assignedTo` son los mismos, el runner del
alumnado lee lo mismo, y no hubo migración de registros.

#### Qué se hizo

**La traducción vive en un módulo puro.** `src/lib/activity-builder.ts` es el
único sitio donde una intención humana se convierte en modelo. Sin React y sin
red, así que las reglas —qué produce cada opción, cuándo una actividad se guarda
en su forma antigua, qué pasa al borrar una parte de la que depende otra— se
prueban una a una (`tests/unit/activity-builder.test.ts`).

**El catálogo humano.** Siete intenciones de primer nivel en vez de dos listas de
tipos internos:

| Opción visible | `actionType` | Entregable |
|---|---|---|
| Responder · Una respuesta escrita | `text_response` | `text` |
| Responder · Campos que tú defines | `text_response` | `structured` |
| Entregar archivo o evidencia · Archivo / Imagen / Video / Enlace | `upload` | `file` / `image` / `video` / `url` |
| Programar — NexCode | `code` | `code` |
| Trabajar en laboratorio — NexLab | `code` | `nexbook` |
| Registrar uso de IA — NexIA | `ai_interaction` | `ai_worklog` |
| Entregar proyecto | `project` | `project` |
| Continuar proceso | `instruction` | `none` |

Lo que el catálogo ya no ofrece —hoy `resource_reference`— **no se elimina del
modelo**: se etiqueta como «versión anterior», se conserva al guardar y sólo
cambia si alguien elige otra cosa a propósito.

**La forma no se pregunta, se deriva.** `deriveActivity` decide:

```
ya era un proceso   → proceso            (nunca se degrada)
2 o más partes      → proceso
1 parte que cabe    → su forma antigua
1 parte que no cabe → proceso
```

Un proceso no vuelve nunca a la forma antigua porque la evidencia se indexa por
el id de la parte. Y «cabe» no se decide sólo por el entregable:
`legacyEquivalent` comprueba además que la parte no diga nada que la lectura
antigua no sepa guardar —prompt, herramienta, recursos, responsables,
dependencias, pista, conclusión obligatoria—, porque si no, guardar «como antes»
sería perderlo.

**NexLab desde el constructor.** Elegir «Trabajar en laboratorio» y pulsar
**Preparar NexLab** guarda un borrador —que no publica ni avisa a nadie— y abre
`NexBookStudio` sobre la plantilla real (`role: 'template'`, decidido por el
servidor). No hay un segundo editor. Ya no hace falta publicar primero para poder
preparar.

**NexIA como entregable.** `StepDeliverable.conclusionMode` reutiliza
`NexBookConclusionMode` —el MISMO tipo y el MISMO esquema que
`NexBookAIWorklogBlock`— y se comprueba al entregar contra la definición de la
parte, nunca contra lo que manda el navegador.

**Errores en lenguaje de persona.** `activityProblems` distingue lo que impide
publicar de lo que sólo conviene revisar, y `humanizeSaveError` traduce
`workflow.2.title` a «La Parte 3 necesita un título».

#### Lo que se decidió distinto de lo escrito en el plan

- **El título de la parte es opcional y se completa al guardar.** El modelo lo
  exige (`workflowStepSchema`), pero pedírselo a quien sólo quiso decir «que
  trabajen en el laboratorio» sería pedir dos veces lo mismo. `namedForWorkflow`
  lo rellena con el de la actividad (una parte) o con el de su intención (varias).
  Por eso el aviso de «esta parte no tiene nombre» es informativo y no
  bloqueante: bloquear por algo que se completa solo sería mentir.
- **Una parte nueva no depende de la anterior.** El constructor anterior
  encadenaba los pasos por defecto; eso convertía cualquier actividad de tres
  partes en un proceso bloqueado que había que desmontar desde avanzadas.
- **«Registrar uso de IA» deja la herramienta libre** (`free`) y no `choice`, que
  es lo que hacía el atajo anterior. Quien documenta su uso de IA usó la que usó;
  además coincide con lo que la lectura de las actividades antiguas ya
  sintetizaba, y eso es lo que permite que esa clase de actividad se siga
  guardando en su forma de siempre.

#### Regresión encontrada y corregida

`submission-form.tsx` elegía el recorrido por partes con `workflow.length > 1`.
Con el constructor nuevo, una actividad de UNA parte que pide un laboratorio,
código, un archivo o ninguna entrega se guarda como `type: 'workflow'` con un
solo paso, y caía en el formulario antiguo —que dispone según los cinco tipos
anteriores— quedándose sin nada que rellenar. Ahora la señal es
`assignment.type === 'workflow'`. Cubierto en
`tests/integration/activity-builder-routes.test.ts`.

#### Métrica UX (reproducible)

Definiciones: **interacción** = un clic o un campo rellenado; **decisión técnica**
= una elección cuyo texto nombra el modelo o la implementación (forma, tipo de
entrega, número de pasos); **vueltas** = veces que hay que salir de la pantalla y
volver para terminar.

*Caso 1 — «Responde con tres conclusiones»*

| | Antes | Después |
|---|---|---|
| Interacciones | 4 | 5 |
| Decisiones técnicas | 2 (forma · tipo de entrega entre 5 nombres internos) | 0 |
| Secciones irrelevantes visibles | 2 (modo de actividad y campos de investigación, por venir `research` por defecto) | 0 |
| Vueltas | 0 | 0 |

Una interacción más y dos decisiones técnicas menos. El clic extra es elegir la
forma de respuesta dentro de «Responder», y está en el idioma de quien enseña.

*Caso 2 — NexLab de análisis de ventas (instrucciones + XLSX inicial + Python + conclusión)*

| | Antes | Después |
|---|---|---|
| Decisiones técnicas | 2 (forma · entregable «NexBook» entre 12 nombres internos) | 0 |
| Vueltas | 3 (publicar → volver a la materia → abrir el paso) | 0 |
| ¿Se publica antes de estar lista? | **Sí, obligatoriamente** | No |

Es el cambio que más importa de la fase: la actividad ya no llega al grupo antes
de que su laboratorio exista.

*Cómo reproducirlo*: `npm run dev:local`, entrar como
`docente.sandbox@itdurango.edu.mx` y recorrer los dos casos en
`/aula/local-course-io/tareas/nueva`. El flujo anterior está en el commit previo
a esta fase.

#### Validación

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ ·
`npm run test:integration` ✅ · `npm run build` ✅ · `npm run test:e2e` ✅

Bundles: compartido 105 kB; `/` 247 kB; `/aula` 170 kB; creador
(`tareas/nueva` y `tareas/[id]/editar`) 202 kB —antes 197 kB—;
`/practicas/nexbook/[id]` 239 kB; `/nexbook/[slug]` 170 kB. Comprobado contra el
manifiesto: **ninguna de las 34 rutas** carga de inicio Monaco, Pyodide, webR ni
los parsers de CSV/XLSX. `NexBookStudio` entra por `next/dynamic` sólo al pulsar
«Preparar NexLab».

#### Navegador

Con el sandbox local (`npm run dev:local`), sesión real de docente y de
estudiante. Playwright cubre seis recorridos: actividad sencilla, actividad de
varias partes con reordenado por teclado, preparación de NexLab con importación
de CSV, compatibilidad de una actividad del formato anterior, y dos de permisos
del estudiante. Responsive comprobado a 1280×900, 390×844 y 375×812 en claro y
oscuro; el creador no desborda en horizontal en ninguna.

<details>
<summary>Plan original de la Fase 4</summary>

Según D7. Se reconstruye la pantalla, **no el modelo**.

**Depende de la Fase 3.5**, no sólo de la Fase 3: cuando el profesorado elija
«Trabajar en laboratorio (NexLab)» tiene que poder preparar una plantilla con
instrucciones, hoja, datos importados, código, imágenes, AI Worklog y resultados
reproducibles. Ver la sección anterior.

**Criterios de aceptación**

- Crear una actividad simple con un campo de respuesta cuesta menos pasos que
  hoy (se mide contando interacciones antes y después).
- La palabra «Workflow» no aparece en la interfaz docente.
- Dependencias, responsables, prompts y materiales siguen disponibles.
- Una tarea creada con el editor anterior se abre, se edita y se guarda sin
  perder nada.

</details>

---

### Fase 5 — Experiencia del estudiante ✅ COMPLETADA

La pantalla del alumnado responde cinco preguntas y en ese orden: **qué tengo
que hacer → dónde lo hago → qué llevo → qué me falta → qué voy a entregar.**
Nada de lo que se ve nombra el modelo: no hay «workflow», ni «deliverable», ni
«paso», ni «snapshot». Hay Partes, estados y una entrega.

**El modelo no se tocó.** `Workflow`, `WorkflowStep`, `StepDeliverable`,
`dependsOnStepIds`, `assignedTo` y el ciclo de vida de `Submission` son los
mismos. Lo que se añadió es una capa de TRADUCCIÓN, igual que hizo la Fase 4 con
el constructor.

#### Arquitectura

**`src/lib/student-activity.ts` (nuevo)** — puro, sin React y sin red. Deriva
todo lo que la pantalla enseña:

- `partStatus` → `Bloqueada · Sin empezar · En progreso · Completada`.
- `partIsComplete` → exactamente las dos reglas que el servidor exige para
  entregar, ni una más.
- `blockedBy` → qué Partes faltan para abrir ésta, con sus nombres.
- `activityProgress` → conteo simple, nunca un porcentaje inventado.
- `missingToSubmit` → qué falta, Parte por Parte, dicho como una frase.
- `activityState` → el estado de la actividad entera, DERIVADO.
- `humanizeSubmitError` → el error, dicho para quien lo va a leer.

Ninguno de esos estados se persiste. La regla que sostiene el módulo es que
«lista para entregar» tiene que coincidir con lo que el servidor deja entregar:
hay pruebas que comparan las dos cuentas directamente contra
`missingRequiredSteps`.

**`src/components/aula/student-work.tsx` (nuevo)** — «Tu trabajo»: el índice de
Partes con su estado, el progreso y la lista de lo que falta. La MISMA pieza en
la ficha de la actividad (sólo lectura) y en el recorrido (navegable), para que
las dos pantallas no puedan contar cosas distintas.

**`src/components/aula/evidence-reader.tsx` (nuevo)** — extraído de
`workflow-progress.tsx`. Lo usan las dos pantallas docentes que leen una
entrega.

`workflow-runner.tsx`, `submission-form.tsx` y `assignment-detail.tsx`
reescritos sobre esas piezas. `deliverable-fields.tsx` sólo recibe
`conclusionMode`; los formularios de cada entregable no se tocaron.

#### Dos cosas que faltaban de verdad

**El laboratorio y el progreso no se hablaban.** Un NexLab se guarda solo, en su
propio documento; la entrega guarda una COPIA, y esa copia sólo se escribía
cuando el navegador la mandaba. Consecuencia: trabajar una hora, volver al día
siguiente y leer «Sin empezar»; o pulsar «Entregar» sin reabrir la Parte y que
el servidor contestara «todavía te falta» sobre trabajo hecho.
`lib/server/student-labs.ts` lo cierra por los dos lados: el servidor dice qué
laboratorios existen (`myLabs`) y, **al entregar**, recoge el que no llegó en el
cuerpo. Lo que NO se hace es guardar la copia continuamente: eso destruiría el
congelado de la entrega.

**El visor docente no sabía leer una actividad por partes.** `flattenSubmission`
sólo aplana los cinco tipos anteriores, así que sobre una actividad por partes
devolvía los campos de una entrega libre y la pantalla enseñaba «(sin
respuesta)» encima de un laboratorio entero. Corregido reutilizando
`EvidenceReader`, y fijado por un recorrido de Playwright.

#### Lo que el estudiante ve ahora

| | |
|---|---|
| Encabezado | Materia · docente, título, estado, fecha límite. Ningún control |
| Material para consultar | Con ese título, y dice que **no** es lo que hay que entregar |
| Tu trabajo | Las Partes en orden, con estado y progreso |
| Parte bloqueada | «Completa primero «Preparar los datos»», no un formulario apagado |
| Parte sin entrega | «Ya la hice», que escribe en `note`. No se fabrica una entrega |
| NexIA | «Tu conclusión (requerida)» ANTES de chocar con el botón |
| NexCode | El lenguaje, el código inicial, y «Ejecución no disponible» cuando toca |
| NexLab | Dentro de la Parte; y a pantalla completa CON contexto académico |
| Entregar | Botón distinto de guardar, con confirmación y resumen de lo que falta |
| Después | «Actividad entregada», la fecha, y qué se puede hacer a continuación |

#### Pruebas

- `tests/unit/student-activity.test.ts` — **32**.
- `tests/integration/student-experience-routes.test.ts` — **17**.
- `tests/e2e/student-journeys.spec.ts` — **5 recorridos** nuevos.

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   46 archivos · 973 passed | 1 skipped (974)
npm run test:integration ✅   17 archivos · 232 passed
npm run build            ✅   compilado en 25.5 s
npm run test:e2e         ✅   11 passed
```

Bundles: compartido 105 kB · `/` 247 kB · `/aula` 170 kB · creador 202 kB ·
ficha de actividad 270 kB (antes 265) · entrega 261 kB (antes 254) ·
`/practicas/nexbook/[id]` 243 kB (antes 239). Ninguna de las 88 entradas del
manifiesto carga de inicio Monaco, Pyodide, webR ni los parsers de CSV/XLSX.

<details>
<summary>Plan original de la fase</summary>

Proceso legible («Tu trabajo»), apertura de cada parte en su espacio, NexLab
lateral y a pantalla completa, guardado, entrega, snapshot y reanudación.

</details>

---

### Fase 6 — Endurecimiento final ✅ COMPLETADA

La última fase del roadmap. No añadió capacidades: auditó, corrigió los bordes,
midió, y dejó el proyecto en un estado que otra persona puede continuar con el
repositorio y su documentación.

#### Lo que se corrigió

**Responsive global.** La barra de navegación dejaba el documento con
`scrollWidth` de 378 px a 375 px y 18 px de más a 360 px, en TODAS las pantallas
—la barra es global—. Corregido en la causa: menos separación por debajo de
`sm`, y la marca sin su nombre por debajo de 400 px (el enlace lo sigue diciendo
para quien no ve la pantalla). Ninguna otra pantalla desbordaba.

**Un R19 vivo.** El avance por parte del profesorado rechazaba con un 409 una
actividad de UNA sola parte —contaba pasos— justo en la pestaña que esa misma
pantalla abre por defecto para una actividad de un solo laboratorio.

**Un R24 vivo.** `flattenSubmission` sólo conocía los cinco tipos anteriores, así
que la exportación en Markdown, el CSV y el visor docente devolvían «Respuesta:
(sin respuesta)» sobre un laboratorio entero. Ahora lee cada Parte con el
aplanador de su entregable.

**Una variable de origen vacía tiraba la compilación.** `NEXT_PUBLIC_*_ORIGIN`
se leía con `??`, que no cae en la cadena vacía; `new URL('')` reventaba con
`Invalid URL`. Lo encontró el sandbox compilado.

**`isSingleStep()` se retiró.** No lo usaba nadie y su nombre invitaba a la
decisión que ya había costado tres fallos.

**R22 se cerró con una señal real.** Una Parte de laboratorio se completa por
llevar trabajo dentro, no por existir la copia: nace en revisión 1 y sólo sube
al guardar.

#### Lo que se añadió para que no vuelva

| | |
|---|---|
| `tests/e2e/responsive.spec.ts` | 8 anchos × 16 pantallas, `scrollWidth <= innerWidth` |
| `tests/e2e/accessibility.spec.ts` | axe (WCAG 2.1 A/AA) + teclado + foco de diálogo |
| `tests/e2e/production-build.spec.ts` | la compilación real: bundles, consola, oscuro, runtimes |
| `npm run prod:local` | `next build` + `next start` sobre `.next-local/` |
| `npm run test:e2e:prod` | Playwright contra esa compilación |
| `distDir` por entorno | `dev`, `build` y el sandbox compilado dejan de pisarse (R10) |

#### R21, hasta dónde llegó

Se intentó llevar la suite entera a `next build` + `next start`. **No se puede,
y la razón es buena:** `lib/aws/config.ts` sólo admite un endpoint de DynamoDB
que no sea el de AWS cuando `NODE_ENV` no es `production`, y `NODE_ENV` en Next
es una constante de COMPILACIÓN —webpack la sustituye dentro del bundle, así que
en un build de producción la rama que permitiría el endpoint local ya no existe
en el código—. Comprobado: el servidor arranca y toda ruta que toca datos
responde 500 con ese mismo error.

Eso hace la garantía más fuerte, no más débil. Así que la suite compilada cubre
lo que no depende de datos y el aula sigue en `dev:local`, dicho en el
`playwright.config.ts` y en `docs/LIMITATIONS.md` §14.

#### Validación

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   46 archivos · 982 passed | 1 skipped (983)
npm run test:integration ✅   17 archivos · 237 passed
npm run build            ✅
npm run test:e2e         ✅   21 recorridos
npm run test:e2e:prod    ✅   5 sobre la compilación real
```

Accesibilidad: **cero incidencias de axe** (WCAG 2.1 A/AA) en portada, acceso,
registro, acerca de, aula, materia, ficha de actividad, trabajo del estudiante,
creador docente y laboratorio.

En navegador, a mano: las pantallas públicas en claro y oscuro a 1280×900,
390×844, 375×812 y 360×800, sin desbordamiento ni errores de consola; y **R18
cerrado** ejecutando el Worker de R contra un `LabDataset` real —`nex_sheet()`
devolvió un `data.frame`, y `download.file()`, `install.packages()` y `url()`
siguieron enmascarados—. Las pantallas con sesión las cubre Playwright.

---

## 4. Estrategia de compatibilidad

La regla de siempre en este proyecto: **normalizar al leer, migrar al
escribir, nunca migrar registros en masa.**

| Qué | Cómo sobrevive |
|---|---|
| Tareas anteriores a Workflow | `normalizeAssignment` sintetiza un paso con `LEGACY_STEP_ID` |
| `CodeData` | Intacto |
| `AIWorklogData` | Intacto; el bloque nuevo lo **anida**, no lo sustituye |
| `LEGACY_CODE_LANGUAGE` / `LEGACY_CODE_MODE` | Intactos: lectura usa el legacy, creación el default |
| `WorkspaceKind` ausente | Se lee `'code'` |
| NexBooks V1 y `.nexbook` existentes | `NEXBOOK_FORMAT_VERSION` sigue en 1 |
| Publicaciones y entregas | Snapshots inmutables, no se reinterpretan |
| Prompts, recursos, materiales | Referencias por id, resueltas al leer |
| Rutas públicas | No cambian |

**No se hará ninguna migración destructiva para conseguir un modelo más
bonito.**

---

## 5. Seguridad: invariantes que ninguna fase puede tocar

1. Ownership en tres capas y **404 indistinguible** entre «no existe» y «no es
   tuyo».
2. `ConditionExpression` en toda escritura de workspace y NexBook; `revision`
   para la concurrencia optimista.
3. Workers aislados; red bloqueada salvo el prefijo `/runtime/`; `fetch`,
   `XMLHttpRequest`, `WebSocket`, `EventSource` e `importScripts` endurecidos.
4. Ninguna ruta capaz de ejecutar `child_process`, `exec`, `spawn`, `Rscript`
   ni `python3`.
5. Markdown **sin HTML crudo** y URLs por lista blanca HTTP(S).
6. Origen separado para el contenido publicado por el alumnado.
7. Lista **blanca** en `publishableDocument`: se reconstruye campo a campo.
8. Assets: la lectura la autoriza el DOCUMENTO que los referencia, no el asset.
9. **Ningún export, publicación o snapshot puede contener** API keys, tokens,
   cookies, credenciales de AWS o Firebase, URLs firmadas durables ni
   identificadores internos del servidor.

La Fase 3 añadió superficie a (7) y (9), y toda ella se cubrió con pruebas antes
de declarar el bloque: `publishableWorklogBlock` reconstruye el registro campo a
campo, `resourcesUsed` sale vacío, `conversationUrl` pasa por `safeMarkdownUrl`,
y hay pruebas —unitarias y de integración— que inyectan un UID, un token de
Firebase, una credencial de AWS, una cookie y una URL firmada y comprueban que
ninguno llega a la publicación.

La Fase 3.5 añadirá superficie a (3) y (8): el Data Bridge amplía **qué** puede
leer un Worker sin ampliar **hasta dónde** puede llegar. La red sigue bloqueada,
los bytes los entrega la capa autorizada y el asset ajeno se rechaza. Las pruebas
de aislamiento existentes tienen que seguir verdes sin relajar ninguna.

---

## 6. Plan de pruebas

| Área | Qué se prueba | Dónde |
|---|---|---|
| Marca | `SITE`, metadata, ausencia de «UINexus» en superficies visibles, infraestructura intacta | unitaria |
| Búsqueda | ownership, permisos de materia, recursos privados, filtros, resultado no autorizado nunca aparece | unitaria + integración |
| NexIA | esquema, compatibilidad legacy, `conclusionMode`, assets, snapshot, export sin secretos | unitaria + integración ✅ (34 + 16) |
| NexLab Data Interop | hoja → Python/R, ids estables, XLSX, CSV, imágenes, outputs, red bloqueada | unitaria + integración (Fase 3.5) |
| Creador docente | catálogo humano, derivación de la forma, compatibilidad legacy, partes, dependencias, responsables, herramientas, prompts, NexCode, NexLab, NexIA | unitaria + integración + E2E ✅ (82 + 25 + 6) |
| NexLab | NexBooks existentes abren, outputs existentes, export/import | unitaria + integración |
| NexCode | Python, R y un lenguaje no ejecutable | unitaria + E2E ✅ |
| Experiencia del estudiante | estados por Parte, progreso, dependencias, validación antes de entregar, conclusión obligatoria, proceso de una parte, reanudación, snapshot inmutable, permisos | unitaria + integración + E2E ✅ (32 + 17 + 5) |
| Responsive | 8 anchos × 16 pantallas, sin desbordamiento horizontal | E2E ✅ |
| Accesibilidad | axe WCAG 2.1 A/AA, recorrido con teclado, foco de diálogo | E2E ✅ |
| Compilación de producción | bundles con hash, consola limpia, tema oscuro, sin runtimes | E2E ✅ |

Validación obligatoria al cerrar cada fase:

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e        # necesita el sandbox local; ver docs/LOCAL-DEVELOPMENT.md
npm run test:e2e:prod   # la compilación real, sin base de datos
```

**Navegador:** desde la Fase 4 existe `npm run test:e2e` (Playwright contra el
sandbox local de la Fase 3.5). Cubre once recorridos autenticados de docente y
de estudiante; no cubre producción, y el sandbox no tiene S3. Lo que no se haya
comprobado se declara como no comprobado. **No se reportará «debería
funcionar».**

---

## 7. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Un reemplazo global de `uinexus` rompe tablas, buckets o variables de entorno | Sólo se sustituye `UINexus` con capitalización exacta y en copy. Prueba que fija `TABLES`, `INDEXES` y prefijos |
| R2 | Cambiar la clave `uinexus-home-visit` hace que todo el muro parezca nuevo | No se toca |
| ~~R3~~ | ~~Ofrecer NexIA en el lanzador antes de la Fase 3 sería un botón falso~~ | **Cerrado en Fase 1 (ajuste A1):** NexIA no aparece en el lanzador, ni siquiera apagada. Se menciona en el landing, en prosa y sin control detrás |
| R4 | Declarar `ai_worklog` en la unión sin renderizador produce documentos que nadie puede abrir | El bloque se declara y se implementa en la MISMA fase |
| R5 | La búsqueda global multiplica consultas a DynamoDB | Dos niveles, *debounce*, mínimo de 2 caracteres, techo documentado y umbral para la proyección |
| ~~R6~~ | ~~El rediseño docente rompe tareas antiguas~~ | **Cerrado en Fase 4.** `deriveActivity` conserva la forma antigua cuando la parte cabe entera en ella, y `legacyEquivalent` comprueba campo por campo que no se pierda nada. Una actividad que ya era un proceso **nunca** se degrada, porque la evidencia se indexa por el id de la parte. Lo fijan pruebas unitarias por cada tipo antiguo, integración con un registro escrito con la forma anterior, y un recorrido de Playwright que abre, edita y reabre |
| R7 | «Espacios» como etiqueta y `/practicas` como ruta divergen | Decisión consciente (D4). Se revisa sólo si el usuario pide renombrar la URL, que exigiría redirección permanente |
| ~~R8~~ | ~~Renombrar el editor a NexLab deja huérfanos los enlaces «Abrir en Studio»~~ | **Cerrado en Fase 1:** sólo cambió el texto; las rutas son las mismas |
| ~~R9~~ | ~~Los recorridos autenticados siguen sin probarse (Firebase + AWS)~~ | **Cerrado entre las fases 3.5 y 4.** La 3.5 levantó el sandbox local —emulador de Firebase Auth y DynamoDB Local, con una cuenta docente y otra de estudiante— y la 4 le puso encima `npm run test:e2e`: seis recorridos de Playwright que entran de verdad, crean actividades, preparan un laboratorio y comprueban permisos. Lo que sigue sin cubrirse: producción, y todo lo que necesita S3 (el sandbox no lo tiene). Ver `docs/LOCAL-DEVELOPMENT.md` |
| R10 | `next build` y `next dev` comparten `.next` y se pisan | Se para el servidor de vista previa antes de compilar. Costó un build fallido en esta fase; queda anotado para no volver a diagnosticarlo |
| ~~R11~~ | ~~La paleta de búsqueda vive entera detrás de la sesión~~ | **Cerrado en Fase 4.** El sandbox local de la Fase 3.5 y la suite de Playwright de ésta permiten recorrer cualquier pantalla con una sesión real. La paleta en concreto sigue sin recorrido de Playwright propio —no es el objeto de esta fase—, pero ya no hay un impedimento estructural: basta `npm run dev:local` y entrar. |
| ~~R12~~ | ~~Un arnés de integración que no reproduce los índices reales esconde fallos hasta producción~~ | **Cerrado del todo en Fase 3.5.** La Fase 3 corrigió las divergencias a mano; la 3.5 eliminó su causa: las definiciones viven ahora en `scripts/lib/table-definitions.mjs` y las importan el arnés Y el sandbox local. Ya no hay copias que sincronizar, y una prueba comprueba que coinciden con `infra/uinexus.cfn.yaml` |
| ~~R13~~ | ~~`INDEXES.coursesBySlug` apunta a un índice que no existe~~ | **Cerrado en Fase 3.5.** La constante estaba muerta —`getCourseBySlug` lista y filtra en memoria— y se **retiró**. El índice **no** se creó: no se despliega infraestructura para justificar una constante. Lo fija una prueba |
| R16 | **Las referencias del laboratorio tienen que ser literales.** `nex.sheet(variable)` no se puede resolver: los datos se preparan ANTES de ejecutar, leyendo el fuente | Consciente y documentado. La alternativa exigía `SharedArrayBuffer` + COOP/COEP, que Nextudio no tiene. No devuelve datos vacíos: lanza un error que explica exactamente esto |
| R17 | **El lector de XLSX es propio.** Menos compatible con Excel que una biblioteca general | Deliberado, con la auditoría escrita en `lib/spreadsheet/xlsx.ts`. A cambio: cero dependencias nuevas, control total sobre qué partes del archivo se abren, y XXE estructuralmente imposible. Lo no soportado se **avisa**, nunca se inventa |
| R18 | **`Spreadsheet → R` no se ha ejecutado en un navegador.** webR usa Workers anidados, que el navegador embebido de la herramienta no admite; falla igual con R plano | Ambiental, no una regresión. Pendiente de un recorrido en Chrome o Firefox normales. El prólogo está cubierto por pruebas de forma y de escape |
| R14 | La vista docente de una entrega **no puede pintar las imágenes del snapshot** —ni las de un `ImageBlock`, ni las gráficas, ni las capturas de un registro de IA— porque los bytes cuelgan del prefijo del estudiante y la ruta de lectura exige ser su dueño | Es anterior a NexIA y afecta a todos los bloques con imagen. Servirlas al profesorado necesita una ruta autorizada nueva, que es una decisión de seguridad propia. Mitigación puesta: el registro de IA **dice** que hay una captura que no puede mostrarse aquí, con su texto alternativo, en vez de dejar el hueco vacío. Documentado en `docs/LIMITATIONS.md` |
| R15 | Un NexIA **personal** muestra `conclusionMode` pero no hay nadie que pueda exigirlo: no hay actividad ni plantilla | Consciente. En un documento personal el modo es una nota del propio autor, y por eso el preset nace en `optional` y no en `required`: `required` pintaría una advertencia que nada puede hacer cumplir |
| R19 | **Una actividad de una sola parte que no cabe en la forma antigua se guarda como proceso**, y eso cambia por qué camino la pinta la pantalla del estudiante | Es la causa de la regresión encontrada y corregida en esta fase. La señal correcta es `assignment.type === 'workflow'`, nunca contar pasos: la lectura sintetiza uno para las actividades anteriores, así que contar confunde «una parte» con «ninguna». Fijado por integración para laboratorio, código, archivo e instrucción |
| R20 | **El título de una parte se completa solo al guardar** (`namedForWorkflow`) | Consciente: el modelo lo exige y la interfaz lo ofrece como opcional. El relleno es determinista —el de la actividad con una parte, el de su intención con varias— y la pantalla avisa de cuál va a ser antes de publicar. Si alguna vez conviene exigirlo, el aviso ya existe y sólo hay que subirlo a bloqueante |
| R21 | **La suite de Playwright corre contra `next dev`**, que compila bajo demanda | Los tiempos son holgados a propósito y `tests/e2e/global-setup.ts` calienta las rutas. Contra un `next start` sería más rápida, pero entonces no se estaría probando el mismo entorno que se usa para desarrollar. Si se vuelve intermitente, el arreglo es compilar antes, no apretar los plazos |
| R22 | **Una Parte de laboratorio se da por completa cuando la copia del estudiante EXISTE**, no cuando tiene contenido | Es la misma regla que aplica el servidor al entregar, y es deliberado: exigir «suficiente contenido» sería autocalificar, que §38 excluye. La consecuencia visible es que abrir el laboratorio y no escribir nada deja la Parte en «Completada». Documentado en `docs/LIMITATIONS.md` |
| R23 | **«Ya la hice» se guarda en `note`**, el campo de la nota del estudiante | Es el único campo del modelo que ya contaba como contenido y que pertenece a quien hace la Parte; inventar uno nuevo habría sido añadir estado para una casilla. La casilla no pisa una nota escrita a mano —se deshabilita— pero borrar la nota sí devuelve la Parte a «Sin empezar», que es coherente con lo que el servidor cuenta |
| R24 | **El visor docente de entregas leía mal una actividad por partes** y enseñaba «(sin respuesta)» sobre un laboratorio entero | Corregido en Fase 5 reutilizando `EvidenceReader`; fijado por un recorrido de Playwright que entrega como estudiante y abre la entrega como docente. Queda anotado porque la causa —`flattenSubmission` sólo conoce los cinco tipos anteriores— sigue viva para cualquier pantalla nueva que la use |

### Clasificación final (cierre de la Fase 6)

Ningún riesgo queda simplemente «abierto». Cada uno está CERRADO, ACEPTADO como
límite del producto, o POST-ROADMAP con lo que haría falta para resolverlo.

| # | Estado | Razón, en una frase |
|---|---|---|
| R1 · R2 · R3 · R5 · R8 | **CERRADO** | La marca cambió sin tocar identificadores; lo fija `tests/unit/branding.test.ts` |
| R4 | **CERRADO** | `ai_worklog` se declaró e implementó en la misma fase |
| R6 | **CERRADO** | `deriveActivity` conserva la forma antigua; probado por tipo, por integración y en navegador |
| R7 | **ACEPTADO** | «Espacios» y `/practicas` divergen a propósito: renombrar la ruta exigiría redirección permanente |
| R9 · R11 | **CERRADO** | El sandbox local y la suite de Playwright recorren cualquier pantalla con sesión real |
| R10 | **CERRADO** | `distDir` por entorno: `dev`, `build` y el sandbox compilado ya no comparten directorio |
| R12 · R13 | **CERRADO** | Las definiciones de tabla viven en un solo sitio; la constante muerta se retiró |
| R14 | **POST-ROADMAP** | Servir las imágenes de un snapshot al profesorado necesita una ruta autorizada nueva, que es una decisión de seguridad propia |
| R15 | **ACEPTADO** | En un NexIA personal `conclusionMode` es una nota de su autor: no hay actividad que pueda exigirla |
| R16 | **ACEPTADO** | Las referencias del laboratorio siguen teniendo que ser literales. Comprobado en navegador al cerrar la Fase 6: un nombre calculado NO devuelve datos vacíos, lanza el error que dice exactamente esto |
| R17 | **ACEPTADO** | El lector de XLSX es propio y abre tres partes del ZIP; lo no soportado se avisa, nunca se inventa |
| R18 | **CERRADO** | `Spreadsheet → R` se ejecutó en un navegador real al cerrar la Fase 6: `nex_sheet("Ventas")` devuelve un `data.frame` de verdad y `nex_sheets()` lista el catálogo. El Worker anidado de webR arranca sin problema |
| R19 | **CERRADO** | Barrido completo: la señal es el tipo. La última aparición viva —el avance docente— se corrigió en la Fase 6 |
| R20 | **ACEPTADO** | El relleno del título es determinista, idempotente y nunca pisa lo escrito. Probado |
| R21 | **ACEPTADO** | Existe `test:e2e:prod`; el aula no puede correr sobre un build de producción sin debilitar la guarda de `NODE_ENV` |
| R22 | **CERRADO** | La revisión del documento distingue «abrí» de «guardé»; es el dato que el almacenamiento ya llevaba |
| R23 | **ACEPTADO** | «Ya la hice» vive en `note`; borrar la nota revierte el estado, y está probado y documentado |
| R24 | **CERRADO** | La lectura de evidencia está centralizada; la exportación y el visor leen cada Parte por su entregable |
| R25 *(nuevo)* | **ACEPTADO** | 21 vulnerabilidades de `npm audit`, todas con corrección sólo por salto mayor y sin vía alcanzable desde producción. Ver `docs/LIMITATIONS.md` §14 |
| R26 *(nuevo)* | **ACEPTADO** | La barra de navegación va apretada a 360 px: cabe, pero un control más volvería a romperla. Lo vigila `responsive.spec.ts` |

---

## 8. Lo que NO se hará en esta evolución

- Agente de IA, chatbot, RAG, BYOK, API keys, streaming de LLM.
- Colaboración en tiempo real, CRDT, edición tipo Google Docs.
- Docker por estudiante, Kubernetes, shell real, terminal, IDE remoto.
- Git hosting, autocalificación, detección de plagio, GPU.
- `RemoteRunner` completo ni frameworks remotos.
- Migración de dominio ni renombrado físico de infraestructura AWS.
- Árbol de carpetas, sistema de archivos virtual, mover entre carpetas.
- `ChartBlock`, recolección de assets huérfanos, historial de publicaciones,
  `.ipynb` / `.qmd` / PDF.
- Archivo genérico (PDF, DOCX, ZIP) como evidencia en el registro de IA.
- Detección automática de uso de IA, cálculo de «porcentaje generado» y
  detección de plagio.
- Migración automática de los AI Worklogs legacy al bloque nuevo.
- Grafo reactivo automático entre bloques de NexLab.
- Renombrar `NexBook` a otra cosa.
- Migraciones destructivas de cualquier clase.

> **Corregido al cerrar la Fase 3.** Esta lista decía antes que el **puente hoja
> ↔ Python/R** quedaba fuera de la evolución. Ya no: entra en la **Fase 3.5 —
> NexLab Data Interop**, junto con la importación de XLSX y CSV y el acceso del
> código a imágenes y a outputs persistidos. Se corrige aquí, en
> `docs/NEXBOOK.md` y en `docs/LIMITATIONS.md`, para que no quede ningún texto
> que declare esas piezas como descartadas.

---

## 9. Puntos de checkpoint

Al cerrar **cada** fase:

1. Terminar una unidad coherente; nunca dejar tipos sin renderizador, rutas sin
   autorización, botones falsos ni migraciones a medias.
2. Suite verde (los cinco comandos, con resultados exactos).
3. Sección nueva en `CHECKPOINT.md` con estado, decisiones, validación,
   navegador, riesgos y **próximo punto exacto**.
4. Actualizar este documento: marcar la fase, anotar lo que se decidió distinto
   y por qué.
5. `CHECKPOINTS.md` conserva su papel de historial técnico detallado; aquí no se
   duplica.

`CHECKPOINT.md` + este archivo tienen que bastar para que otro agente continúe
sin esta conversación.

---

## 10. Estado posterior al roadmap

**Las ocho fases están cerradas.**

```
Fase 0    Auditoría y hoja de ruta          ✅
Fase 1    Marca Nextudio + shell            ✅
Fase 2    Organización y descubrimiento     ✅
Fase 3    NexIA integrado                   ✅
Fase 3.5  NexLab Data Interop               ✅
Fase 4    Rediseño del creador docente      ✅
Fase 5    Experiencia del estudiante        ✅
Fase 6    Endurecimiento final              ✅
```

Este apartado existe para que alguien que llegue después sepa qué tiene entre
manos sin reconstruirlo leyendo commits. **No abre una Fase 7**: las líneas de
abajo son opciones, no un plan.

### Lo que Nextudio hace hoy

| | |
|---|---|
| **Identidad** | Firebase Auth, sólo institucional `@itdurango.edu.mx`. El rol se deduce del correo |
| **Aula** | Materias, actividades por Partes, reparto, dependencias, entrega y revisión |
| **Creador docente** | Siete intenciones humanas; la forma de guardado se deriva, no se pregunta |
| **NexCode** | Un archivo, un lenguaje, Monaco. Python y R se ejecutan en el navegador |
| **NexLab** | Documento por bloques: texto, código, hojas, imágenes y registros de IA |
| **NexIA** | Registro trazable de uso de IA. Nextudio no ejecuta ningún modelo |
| **Data Interop** | `nex.sheet("…")` en Python y `nex_sheet("…")` en R, con referencias literales |
| **Entrega** | Guardar ≠ entregar. La entrega congela una copia que no cambia después |
| **Publicación** | Proyectos en el origen aislado; NexBooks en `/nexbook/[slug]`, sólo lectura |
| **Búsqueda** | Paleta global con los permisos de siempre |
| **Formato** | `.nexbook` V1 (`uinexus-nexbook`), importa y exporta |

### Las deudas que se aceptaron, y por qué

Están razonadas una a una en `docs/LIMITATIONS.md` §14 y clasificadas en §7.
En resumen:

- **No hay S3 en el sandbox local.** Las imágenes de un NexBook y los materiales
  subidos no se pueden probar en local; fallan con un error legible.
- **La suite compilada no cubre el aula.** `NODE_ENV` es una constante de
  compilación y la guarda del endpoint queda inlineada. Debilitarla para poder
  probar sería cambiar una garantía por una prueba.
- **`Spreadsheet → R` no se ha ejecutado en un navegador normal.** webR usa
  Workers anidados; el navegador embebido de la herramienta no los admite.
- **Las imágenes de un snapshot no se le muestran al profesorado.** Los bytes
  cuelgan del prefijo del estudiante; servirlas exige una ruta autorizada nueva.
- **21 vulnerabilidades de `npm audit`**, todas con corrección sólo por salto
  mayor y sin vía alcanzable desde producción.
- **El lector de XLSX es propio.** Menos compatible que una biblioteca general,
  a cambio de cero dependencias y de que XXE sea estructuralmente imposible.

### Líneas futuras posibles

Sin orden, sin compromiso y sin empezar ninguna. Cada una es una decisión con su
propio coste, y la decisión no es de este documento.

**Producto**

- Calificación: rúbricas, notas, devolución con comentarios por Parte.
- Un panel para el profesorado que hoy no existe: destacar, ocultar, reportes.
- Reentrega con historial: hoy se puede volver a entregar, pero sólo se conserva
  la última copia.
- Plantillas de actividad compartidas entre materias.

**Plataforma**

- Ruta autorizada para las imágenes de un snapshot (cierra R14).
- S3 local o un almacén equivalente en el sandbox (cierra media docena de huecos
  de prueba a la vez).
- `RemoteRunner`: ejecutar Java, C y C++ en un sandbox remoto. Es lo que la
  tabla de lenguajes del README promete que **no** se hace.
- Una CSP en este origen. Las directivas necesarias ya están listadas en
  `docs/SECURITY.md`; escribirla entera es un cambio con su propia validación.

**Mantenimiento**

- Las cinco actualizaciones mayores pendientes (`next`, `vitest`, `tar`,
  `firebase-admin`, `firebase-tools`), una a una y con la suite delante.
- Revisar el lector de XLSX si aparece un archivo real que no abra.

### Por dónde empezar a leer

```
README.md                     qué es Nextudio y cómo se arranca
CHECKPOINT.md                 estado, riesgos abiertos y la siguiente decisión
docs/ARCHITECTURE.md          §17 resume las seis fases
docs/LOCAL-DEVELOPMENT.md     cómo levantar el producto entero con sesión
docs/SECURITY.md              las fronteras, y qué NO resuelven
docs/LIMITATIONS.md           §14 cierra: resuelto, aceptado, post-roadmap
```
