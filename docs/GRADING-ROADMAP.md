# Calificación y Rúbricas

> **Esto no es la Fase 7.** El roadmap de evolución `UINexus → Nextudio` (Fases
> 0–6) está cerrado y no se reabre. Esta es una **iniciativa nueva e
> independiente**, con su propio alcance, sus propias unidades y su propio
> criterio de terminación. Si se abandona a mitad, el producto anterior sigue
> siendo exactamente lo que era.

Su objetivo es cerrar el ciclo académico:

```
actividad → trabajo → entrega → snapshot inmutable
          → revisión docente → retroalimentación → calificación
```

> **Estado: G0 cerrado.** El contrato de esta página es el que G1 implementa.
> Ha pasado por tres revisiones y el §9 cuenta qué cambió en cada una: la segunda
> arregló la identidad de la evaluación —una sola clave por entrega no puede
> guardar la de dos intentos—; la tercera hizo **seguro** el contador de
> intentos, que se había introducido con una comprobación TOCTOU y sin
> idempotencia.

---

## 1. Estado actual: qué hay ya, de verdad

La auditoría encontró **más de lo esperado**. Nextudio ya tiene un flujo de
revisión docente completo, y eso cambia el diseño: esta iniciativa **no
construye la revisión desde cero, la extiende**.

### Lo que YA existe

| Concepto | Dónde | Qué hace hoy |
|---|---|---|
| `SubmissionStatus` | `lib/types.ts:669` | `draft` · `submitted` · `reviewed` · `needs_changes` |
| `teacherNote` | `Submission` | Comentario libre del profesorado, hasta 2 000 caracteres |
| `reviewedAt` | `Submission` | Cuándo se revisó |
| `reviewedBy` | `SubmissionRecord` | UID de quien revisó. **Nunca sale al navegador** |
| `reviewSubmission()` | `lib/server/academic-writes.ts:575` | Cambia estado y nota. No toca el contenido |
| `PATCH /api/submissions/:id` | ruta | Sólo profesorado de la materia. 404 indistinguible para el resto |
| `SubmissionViewer` | `components/aula/submission-viewer.tsx` | Modal que lee la entrega por Partes y ofrece «Marcar como revisada» / «Pedir cambios» |
| `EvidenceReader` | `components/aula/evidence-reader.tsx` | Reparto por entregable: Markdown, hoja, código, outputs, registro de IA |

### Lo que NO existe

Búsqueda exhaustiva de `grade`, `grading`, `score`, `maxScore`, `points`,
`rubric`, `criterion`, `level`, `weight`, `feedback`: **cero coincidencias** en
`src/`, salvo la palabra «calificación» en una frase de la portada.

Búsqueda de `attempt`, `resubmit`, `reentrega`, `intento` sobre el modelo
académico: **cero**. Nada cuenta las entregas de nadie. Las coincidencias que
aparecen son reintentos de red y de guardado, ajenos a esto.

No hay número, no hay rúbrica, no hay puntos, no hay borrador de evaluación, y
**no hay distinción entre evaluar y publicar la evaluación**: hoy `teacherNote`
llega al estudiante en cuanto se guarda la revisión.

### Seis hallazgos que condicionan el diseño

**1. No hay concurrencia optimista en la revisión.** `reviewSubmission` escribe
con `ConditionExpression: 'attribute_exists(id)'`, que sólo comprueba que la
entrega exista. Dos docentes con la misma entrega abierta se pisan en silencio:
gana quien guarde último. `Submission` no tiene `revision`. El patrón correcto
ya existe en el proyecto (`lib/data/nexbooks.ts:227`) y esta iniciativa lo
adopta **para la evaluación nueva**.

**2. El item de la entrega ya está cerca de su techo.** Un `Submission` es UN
item de DynamoDB, límite duro **400 KB**. Dentro puede llevar hasta 25 Partes
(`WORKFLOW_LIMITS.maxSteps`) y cada Parte de laboratorio guarda un **snapshot
completo de NexBook**, presupuestado en **300 000 bytes**
(`NEXBOOK_LIMITS.documentBytes`). Dos Partes de laboratorio llenas ya no caben.

> Riesgo **preexistente** (**RG-1**), fuera del alcance de esta iniciativa.
> Documentado en `docs/LIMITATIONS.md` §15. Pero decide dónde va la evaluación.

**3. En una actividad colaborativa cada estudiante tiene su propia entrega.**
`submissionIdFor(assignmentId, uid)` deriva el id del UID, y
`buildWorkflowGroupView` compone la vista de grupo **en lectura**, sin que exista
ningún registro compartido. Así que «¿nota por Submission o por estudiante?» no
tiene dos respuestas: **hoy son el mismo objeto**.

**4. Reentregar ya invalida la revisión, pero conserva la nota.**
`upsertSubmission` limpia `reviewedAt` y `reviewedBy` y devuelve el estado a
`submitted`, pero mantiene `teacherNote` (`academic-writes.ts:560`). El
comentario del código lo razona: *«dejar la marca de revisado sobre un texto que
ha cambiado desde entonces es mentir sobre lo que se leyó»*. La semántica de la
calificación tiene que ser coherente con eso.

**5. Ninguna tabla del proyecto usa clave de ordenación.** Las once tablas
declaran **una sola clave HASH**; las claves RANGE aparecen únicamente dentro de
GSIs. La identidad compuesta se resuelve **derivando el id**:
`submissionIdFor()` es `sha256(assignmentId:uid)` recortado a 32 caracteres.
Ese es el patrón reutilizable, y **D1 lo sigue en vez de estrenar una PK+SK**.

**6. Declarar un índice que no existe ya costó un riesgo.** `INDEXES` llevaba un
`coursesBySlug` que nombraba un GSI ausente de la plantilla; se retiró en la Fase
3.5 (R13) con la nota de que *«una constante que nombra un índice inexistente es
una trampa»*. Y `tests/unit/local-sandbox.test.ts` comprueba que
`scripts/lib/table-definitions.mjs` e `infra/uinexus.cfn.yaml` coinciden. Todo
índice que proponga este diseño va **en los dos sitios**, o no va.

**7. El proyecto YA usa transacciones de DynamoDB.**
`lib/server/publications.ts` publica y modera con `TransactWriteCommand` y
`ConditionExpression`. Así que la atomicidad de D11 **no estrena nada**: reutiliza
el patrón. Lo que no existe todavía es el tipo de item `ConditionCheck` ni el
tratamiento de `TransactionCanceledException`, y eso sí lo incorpora G1.

**8. Entregar y reentregar son LA MISMA petición.** Un solo `PUT
/api/assignments/:id/submission` con `intent: 'submit'`. No hay ruta de
reentrega, ni acción distinta, ni marca que las separe: la pantalla posterior a
entregar dice literalmente *«vuelve a tu trabajo y entrega otra vez»* y el
estudiante pulsa **el mismo botón**. Por tanto **el producto no tiene hoy ninguna
forma de distinguir un reintento de una reentrega**, y eso hay que resolverlo
antes de que `attempt` signifique algo (D10).

Lo que salva la situación actual es que la escritura es un `PutCommand` que
**reemplaza el item entero**: reintentar el mismo `PUT` deja el mismo registro.
En cuanto `attempt` se incremente, esa idempotencia se pierde.

### Suite base sobre el árbol actual

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   990 passed | 1 skipped (991)
npm run test:integration ✅   17 archivos · 237 passed
npm run build            ✅
npm run test:e2e         ✅   21 passed
```

---

## 2. Decisiones

### D1 · La evaluación es una entidad propia, en su propia tabla

**No va dentro del item de `Submission`**, aunque pertenezca a una sola entrega.
Tres razones, en orden de peso:

1. **Espacio.** El item ya puede acercarse a 400 KB con snapshots de NexBook
   (hallazgo 2). Añadirle una rúbrica evaluada más su snapshot lo empuja hacia
   un `Item size has exceeded the maximum allowed size`, que es un error
   ilegible en mitad de una clase.
2. **La invisibilidad del borrador pasa a ser estructural.** Si la evaluación es
   otro item, la ruta del estudiante sencillamente **no lo lee**. No depende de
   acordarse de quitar un campo en `toSubmission`. Es el mismo argumento que
   sostiene el índice disperso `byStatus` en `docs/ARCHITECTURE.md`: la garantía
   deja de estar en el cuidado de quien escribe el mapper y pasa a estar en la
   forma del dato.
3. **Dos escritores, dos items.** El estudiante escribe su entrega; la docente
   escribe la evaluación. Separados, una reentrega y una calificación simultánea
   no pueden pisarse físicamente — y la carrera **semántica** que sí queda la
   cierra D11.

El proyecto ya tiene el precedente escrito en `lib/aws/config.ts`: *«Tablas
nuevas, no columnas nuevas: una entrega y un proyecto no comparten ni ciclo de
vida ni patrón de acceso»*, y `workspaces` es tabla propia por el mismo motivo.

```
uinexus-grades    PK id          id = `${submissionId}#${attempt}`
                  GSI bySubmission    HASH submissionId · RANGE attempt
```

**La clave primaria es un id derivado, no una PK+SK.** Ninguna tabla del
proyecto usa clave de ordenación (hallazgo 5), y estrenar ese patrón para una
tabla no obliga a nada: el id compuesto da lo mismo —acceso directo en O(1) sin
consulta— siguiendo la forma que ya tiene el resto.

`submissionId` ya es opaco (un sha256 recortado), así que el id compuesto no
revela nada y se puede leer en un log: `9f3c…a1#2` es «el segundo intento».

El GSI `bySubmission` existe para **una** pregunta: «¿qué evaluaciones ha tenido
esta entrega?». Sin él, conservar el histórico sería guardarlo sin poder leerlo.
Va en `table-definitions.mjs` **y** en `infra/uinexus.cfn.yaml` (hallazgo 6).

> **Corrige la versión anterior de este documento**, que proponía `PK:
> submissionId` a secas. Con esa clave, guardar la evaluación del intento 2 sin
> destruir la del intento 1 es imposible. Ver §9.

### D2 · La rúbrica se define en la actividad y se congela al abrir la evaluación

Dos objetos distintos:

- **`RubricDefinition`** vive en `Assignment.grading`. Se configura antes de que
  exista ninguna entrega, así que no puede colgar de la primera.
- **`RubricCriterionAssessment[]`** vive en la evaluación y **lleva dentro una
  copia del criterio entero** —nombre, descripción, puntos, niveles— junto a la
  elección.

Nunca se guarda `criterionIndex: 2`. Ni siquiera sólo `criterionId`: se guarda el
criterio completo. Si la docente reescribe la rúbrica en marzo, la evaluación de
febrero sigue diciendo exactamente lo que dijo.

Es la misma decisión que ya toma `NexBookSubmissionData`: *«Una entrega NO apunta
al NexBook vivo: lleva una COPIA»*.

#### Cuándo se congela, exactamente

El punto de congelación es **la creación de la evaluación de un intento**, y
sólo ese:

```
La docente abre la entrega y evalúa por primera vez
        ↓
el servidor lee Assignment.grading
        ↓
valida la definición (§ topes y validación)
        ↓
copia los criterios dentro del SubmissionGrade
        ↓
a partir de aquí, ESA copia es la definición de ESA evaluación
```

Después de eso el servidor **no vuelve a leer `Assignment.grading`** para esa
evaluación: ni al guardar el borrador, ni al publicar, ni al corregir una
publicada. Editar la actividad no puede cambiar en silencio una evaluación en
curso.

Esto resuelve la tensión aparente con «el servidor relee la rúbrica»: el servidor
**sí** es la única autoridad sobre la definición, pero la autoridad es el
snapshot a partir del instante en que existe. El navegador nunca lo es, ni antes
ni después (D12).

#### El caso rúbrica A → rúbrica B

```
La actividad usa la rúbrica A
      ↓  la docente abre la evaluación → snapshot de A
La actividad pasa a la rúbrica B
      ↓  la docente publica
La evaluación publicada sigue siendo de A, entera y legible
```

Conducta exacta:

| Momento | Qué rúbrica se usa |
|---|---|
| Evaluación ya creada (draft o publicada) | **La del snapshot**, siempre |
| Evaluación nueva de otro estudiante, después del cambio | La B |
| Evaluación nueva de un intento nuevo del mismo estudiante | La B |
| Corrección de una evaluación publicada | La del snapshot de esa evaluación |

**Limitación aceptada, y hay que decirla en voz alta:** dos estudiantes del mismo
grupo pueden acabar evaluados con rúbricas distintas si la docente la cambia a
mitad de la corrección. Es el precio de que la historia no se reinterprete, y es
el lado correcto del que equivocarse: la alternativa —reescribir evaluaciones ya
hechas al cambiar la definición— cambia notas ya comunicadas.

La pantalla docente lo avisa cuando detecta la divergencia (`RG-7`), comparando
el snapshot con `Assignment.grading`. Avisar es todo lo que hace: no ofrece
«migrar» la evaluación, porque migrarla sería justo lo que no se quiere.

### D3 · Tres modos, y el de por defecto es «ninguno»

```ts
type GradingMode = 'none' | 'direct' | 'rubric';
```

- `none` — sólo retroalimentación. **No se inventa un `0/0`.**
- `direct` — `maxScore` configurado, la docente escribe el número.
- `rubric` — la suma de los niveles elegidos deriva la calificación.

Una actividad sin `grading` guardado **se lee como `none`**. Normalizar al leer,
nunca migrar. No se asume 100 puntos para nadie.

### D4 · Puntos, no porcentajes

Cada criterio tiene puntos enteros; `maxScore` es su suma. Sin pesos
porcentuales, sin redondeos, sin dos sistemas conviviendo.

```
Análisis        40
Código          30
Interpretación  30
                ───
TOTAL          100
```

### D5 · Borrador y publicación son dos estados, como en todo el producto

```ts
type GradeStatus = 'draft' | 'published';
```

Nextudio ya distingue **guardar ≠ entregar** y **entregar ≠ publicar**. La
evaluación hereda la misma gramática.

`teacherNote` **no se toca**. Sigue siendo lo que es —la nota de la revisión
antigua— y las entregas ya revisadas se siguen leyendo igual. La
retroalimentación de la evaluación es un campo nuevo (`generalFeedback`) que vive
en la evaluación y sólo se ve publicada. Los dos mecanismos conviven sin
mezclarse, y eso es deliberado: unificarlos exigiría tocar una ruta probada que
está fuera de este alcance (**RG-2**).

### D6 · Un criterio puede señalar una Parte, y nunca por índice

```ts
stepId?: string   // el id estable de WorkflowStep, nunca "Parte 2"
```

`WorkflowStep.id` es estable: `order` es un campo aparte y `partsFromAssignment`
conserva los ids al reabrir una actividad por partes. Reordenar Partes no puede
romper una rúbrica.

Un `stepId` que ya no existe **no invalida el criterio**: se lee como criterio
global y se anota. La evaluación ya lleva su snapshot, así que sigue
entendiéndose.

### D7 · La nota es de la entrega, y la entrega es de una persona

Dado el hallazgo 3, **por entrega = por estudiante**. No se añaden overrides
individuales, porque no hay nada que sobrescribir: no existe una nota de grupo.

### D8 · Reentregar abre un intento nuevo; la evaluación anterior no se toca

**Reescrita por completo.** La versión anterior decía «la evaluación pasa a
`supersededAt != null`» y a la vez «hay exactamente una evaluación por entrega»,
con la entrega como clave única. Las dos cosas juntas no se pueden cumplir.

```
attempt 1 → entregada → evaluada → publicada        87 / 100
      ↓  el estudiante reentrega
attempt 2 → entregada, SIN evaluación                Pendiente de revisión
      ↓
la evaluación del attempt 1 sigue existiendo, entera, marcada como histórica
```

Reglas:

1. **Nada se borra y nada se sobrescribe.** La evaluación del intento 1 y la del
   intento 2 son items distintos (`…#1` y `…#2`).
2. **Sólo una es la vigente**: la del intento actual de la entrega.
3. **La reentrega no escribe en la tabla de evaluaciones.** No hay que tocar dos
   tablas a la vez, así que no hay ventana de fallo parcial ni transacción que
   inventar. Lo único que hace `upsertSubmission` es subir el contador.
4. **Al estudiante, un intento sin evaluación le dice «Pendiente de revisión»**,
   nunca la nota anterior. No ve un 87 que ya no corresponde a lo que entregó.
5. La docente ve que hubo evaluaciones anteriores y de qué intento eran.

Esto **no** es historial de versiones del trabajo: el intento no guarda copias de
la entrega, sólo cuenta cuántas veces se entregó. La entrega sigue siendo un
único item que se sobrescribe, como hasta hoy.

### D9 · Concurrencia entre docentes, con `revision`

`SubmissionGrade.revision` + `UpdateCommand` con
`ConditionExpression: '#revision = :expected'`, y relectura al fallar para
distinguir «no existe» de «alguien más guardó» — exactamente el patrón de
`lib/data/nexbooks.ts:195-243`. Nada de last-write-wins.

Protege **evaluación ↔ evaluación**. La otra carrera la cierra D11.

### D10 · `Submission.attempt`: el contador que no existía

La auditoría confirmó que **no hay ninguna noción reutilizable**. Los candidatos
y por qué no sirven:

| Candidato | Por qué no |
|---|---|
| `Submission.revision` | No existe. `Submission` no tiene control de versión |
| `updatedAt` | Cambia con cada guardado de borrador, no con la entrega |
| `submittedAt` | Se reescribe en **cada ejecución** de un submit, reintentos incluidos. Ver la corrección de abajo |

> **Corrección a la revisión anterior de este documento.** Decía que
> «`submittedAt` cambia exactamente cuando debe» y lo usaba como prueba de que un
> intento se podía identificar por él. **Es falso.** Lo único que demuestra es
> *cuándo se ejecuta el código*, no que cada ejecución sea un acto académico
> distinto: un reintento de red vuelve a escribirlo con otra hora sin que nadie
> haya entregado dos veces. `submittedAt` sigue sirviendo para decir «entregaste
> el…», pero **no puede usarse como prueba de idempotencia**.

Así que se añade un campo entero:

```ts
// En Submission / SubmissionRecord
attempt: number;   // 0 = nunca entregada. 1 = primera entrega. 2 = reentrega…
```

#### Qué es un intento, exactamente

**Un intento es un acto académico de entrega**: el estudiante da por terminado su
trabajo y lo manda. No es una petición HTTP, no es una escritura y no es una
marca de tiempo. La distinción importa porque una misma decisión suya puede
producir varias peticiones —doble clic, reintento del navegador, respuesta
perdida— y todas siguen siendo **una** entrega.

- **Nace** en 0: una entrega que sólo se ha guardado como borrador no tiene
  intentos.
- **Sube** cuando llega un submit con un acto de entrega que no se había visto.
- **No sube** al guardar un borrador, ni al reintentar el mismo acto, ni cuando
  el profesorado revisa, pide cambios o publica una evaluación.
- Una evaluación exige `attempt >= 1`, igual que `reviewSubmission` ya rechaza
  hoy revisar un borrador del estudiante.

#### El problema: hoy no hay forma de distinguir un reintento

Del hallazgo 8: entregar y reentregar son **la misma petición**, y el producto no
lleva ningún dato que las separe. Así que `if (intent === 'submit') attempt += 1`
convierte un doble clic en dos intentos, y deja una evaluación publicada
apuntando a un intento que nadie hizo.

**No hay ningún mecanismo reutilizable en el repositorio para esto.** Se declara,
como pedía el encargo, y se diseña el mínimo.

#### La idempotencia mínima: un token por acto de entrega

Se descartaron primero las alternativas más baratas, porque **ninguna funciona**:

| Alternativa | Por qué no sirve |
|---|---|
| Condicionar por `status` (`draft → submitted` sube, `submitted → submitted` no) | Una reentrega legítima sale casi siempre de `submitted`: es el caso que la pantalla invita a hacer. Dejaría de contar justo lo que hay que contar |
| Comparar el contenido | Un estudiante puede reentregar lo mismo a propósito, y un reintento tras editar lleva contenido distinto. Falla en los dos sentidos |
| `submittedAt` | Lo reescribe el propio reintento (corrección de arriba) |

Queda una: que **el cliente diga de qué acto se trata**.

```ts
// En el cuerpo del PUT, obligatorio cuando intent === 'submit'
submitToken: string        // opaco, generado por el cliente

// En Submission / SubmissionRecord
lastSubmitToken: string | null
```

El token se genera **al abrir la confirmación de entrega**, que ya existe
(`workflow-runner.tsx`, el paso «Sí, entregar»). Un acto de entrega, un token.
Reintentar ese envío reutiliza el mismo; volver a pulsar «Entregar actividad»
más tarde genera otro.

```
token === lastSubmitToken   →  es el MISMO acto  →  attempt se queda igual
token !== lastSubmitToken   →  es un acto NUEVO  →  attempt + 1
```

No es «confiar en el cliente»: el token no concede permisos ni decide nada que
el servidor no pueda comprobar. Sólo dice «esto es lo mismo que te mandé hace un
segundo», y lo peor que puede hacer un cliente mentiroso es contar mal **sus
propios** intentos.

#### La escritura, condicionada

El incremento se lee y se escribe en la misma operación condicional, para que dos
peticiones simultáneas no calculen ambas sobre el mismo valor:

```
PutCommand(item con attempt ya calculado)
  ConditionExpression:
       attribute_not_exists(id)          -- primera entrega de esta persona
    OR attribute_not_exists(#attempt)    -- registro legacy, todavía sin campo
    OR #attempt = :readAttempt           -- nadie lo movió desde que lo leí
```

Si falla, se relee y se decide otra vez con el estado fresco. **Es importante que
sea un `PutCommand` de item completo y no un `ADD attempt 1`**: el proyecto
escribe entregas reemplazando el item entero, así que el valor se calcula en el
servidor y se escribe como número, sin depender de que el atributo existiera.

#### Registros legacy: los dos casos, distinguidos

Al leer:

```ts
attempt: raw.attempt ?? (raw.submittedAt ? 1 : 0)
```

No es un relleno, es derivación exacta: una entrega anterior con `submittedAt` se
entregó una vez; una sin él, ninguna.

| Registro legacy | Lectura | Primer submit posterior | Resultado |
|---|---|---|---|
| `attempt` ausente · `submittedAt` **presente** | `1` | token nuevo ⇒ `1 + 1` | **`attempt = 2`** ✅ |
| `attempt` ausente · `submittedAt` **ausente** | `0` | token nuevo ⇒ `0 + 1` | **`attempt = 1`** ✅ |

La escritura persiste el valor calculado y, de paso, deja el registro ya
normalizado. **Cero migración**: cada entrega se pone al día la primera vez que
alguien la toca, que es la estrategia del proyecto desde la iteración 2.

La rama `attribute_not_exists(#attempt)` de la condición existe precisamente para
esto: sin ella, la condición `#attempt = :readAttempt` fallaría siempre sobre un
registro legacy, que no tiene el atributo.

#### Dos submits simultáneos

| Caso | Qué pasa | Resultado |
|---|---|---|
| **Mismo token** (doble clic, reintento) | Ambas leen `attempt = 1`. La primera escribe `2` con `lastSubmitToken = T`. La segunda encuentra `token === lastSubmitToken` y **no incrementa** | `attempt = 2` ✅ |
| **Mismo token, carrera exacta** (ninguna vio a la otra) | Ambas calculan `2`; la condición deja pasar a una y rechaza a la otra, que relee y ya ve el token | `attempt = 2` ✅ |
| **Tokens distintos** (dos reentregas de verdad) | La primera escribe `2`. La segunda falla la condición, relee, ve `attempt = 2` y su token distinto | `attempt = 3` ✅ |

Nunca sale un `3` de un solo acto, que es el fallo que había que impedir.

> **Éste y `lastSubmitToken` son los únicos cambios de esta iniciativa sobre una
> ruta de escritura ya probada.** Son aditivos —dos campos y una condición—, no
> una reestructuración de `Submission`, y sin ellos `attempt` no es seguro.

### D11 · La carrera entrega ↔ evaluación: 409, nunca reasignar

Separar las tablas evita la sobrescritura **física**. No evita ésta:

```
1. La docente abre el intento 1 y evalúa.
2. El estudiante reentrega          → intento 2.
3. La docente sigue con la pantalla vieja abierta.
4. La docente pulsa «Publicar evaluación».
```

`revision` no lo detecta: nadie ha tocado la evaluación, sólo la entrega. La
invariante que falta es otra:

> **Invariante A** — al guardar y al publicar, el `attempt` que la evaluación
> dice estar evaluando tiene que seguir siendo el `attempt` actual de la entrega.

#### Comprobarla leyendo NO sirve

La revisión anterior de este documento decía «el servidor lee la entrega y
compara». Eso es un TOCTOU de manual:

```
1. GET Submission           → attempt = 1
2. comprobar attempt === 1  → cierto
3. el estudiante reentrega  → attempt = 2
4. escribir la evaluación del attempt 1   ← la comprobación ya es falsa
```

La condición era verdad cuando se leyó y mentira cuando se escribió. **La
garantía tiene que estar en la escritura, no antes.**

#### La operación: una transacción, dos condiciones

El proyecto ya usa `TransactWriteCommand` con `ConditionExpression`
(`lib/server/publications.ts`, hallazgo 7), así que esto reutiliza el patrón. Lo
nuevo para G1 es el item `ConditionCheck` y el tratamiento de la cancelación.

**Al actualizar una evaluación existente:**

```
TransactWriteCommand
 ├─ [0] ConditionCheck  TABLES.submissions   Key: { id: submissionId }
 │        ConditionExpression: '#attempt = :expectedAttempt'
 │
 └─ [1] Update          TABLES.grades        Key: { id: `${submissionId}#${attempt}` }
          ConditionExpression: '#revision = :expectedRevision'
          UpdateExpression:    'SET … , #revision = #revision + :one'
```

**Al crear la primera evaluación de un intento:**

```
TransactWriteCommand
 ├─ [0] ConditionCheck  TABLES.submissions
 │        ConditionExpression: '#attempt = :expectedAttempt'
 │
 └─ [1] Put             TABLES.grades
          ConditionExpression: 'attribute_not_exists(id)'
```

Las dos condiciones y la escritura viven en **una sola operación**: DynamoDB las
evalúa juntas y, si cualquiera falla, **no escribe nada**. No hay ventana entre
comprobar y escribir porque no hay dos momentos.

Se aplica igual **al guardar el borrador y al publicar**. Sólo al publicar no
basta: un borrador guardado contra un intento que ya cambió también está
evaluando otra cosa.

#### Distinguir los dos conflictos, sin releer

`TransactionCanceledException` trae `CancellationReasons`, **un elemento por
item, en el mismo orden que `TransactItems`**. Eso basta para saber cuál falló:

| Índice con `ConditionalCheckFailed` | Causa | Respuesta |
|---|---|---|
| `[0]` — el `ConditionCheck` de la entrega | El estudiante reentregó | **409** · «La entrega cambió mientras la estabas evaluando. Recarga para revisar la versión actual.» |
| `[1]` — la escritura de la evaluación | Otra sesión docente guardó antes | **409** · «Esta evaluación cambió en otra sesión. Recarga antes de continuar.» |
| `[1]` en una creación (`attribute_not_exists`) | Ya existe una evaluación de ese intento | Se relee y se reintenta como actualización |

**No hace falta releer para distinguirlos**, que es la otra ventaja de meter las
dos condiciones en la misma transacción: el error dice cuál cedió. Si algún día
los dos índices fallan a la vez, manda el `[0]`: la entrega cambió, y eso es lo
que el docente necesita saber primero.

Copy y códigos quedan así, y nunca last-write-wins.

Qué **no** se hace, y es lo importante:

- **No se reasigna** la evaluación vieja al intento nuevo. Esos criterios se
  eligieron mirando otro trabajo.
- **No se sobrescribe.** El borrador del intento 1 se queda donde está, como
  histórico del intento 1.
- **No se publica.** Publicar es decirle a alguien su nota; hacerlo sobre un
  trabajo que ya no es el suyo es peor que fallar.

Se comprueba en **las dos** escrituras. Sólo al publicar no basta: un borrador
guardado contra un intento que ya cambió también está evaluando otra cosa.

### D12 · El navegador manda decisiones; el servidor deriva los números

El cliente **no es autoridad** sobre `points`, `score`, `maxScore`, el criterio
ni la definición de la rúbrica. Nada de eso se lee del cuerpo de la petición —no
es que se valide: es que **no se lee**, que es la única forma de que no pueda
colarse—.

Lo que el cliente puede mandar, entero:

```ts
// PUT  /api/submissions/:submissionId/grade
// POST /api/submissions/:submissionId/grade/publish
{
  attempt: number,              // qué intento cree estar evaluando (D11)
  expectedRevision: number,     // concurrencia entre docentes (D9)
  generalFeedback: string,
  // sólo en modo rubric
  criteria?: { criterionId: string; selectedLevelId: string | null; comment: string }[],
  // sólo en modo direct
  score?: number,
}
```

Lo que hace el servidor en modo `rubric`:

1. Carga el `SubmissionGrade` (o lo crea con el snapshot, D2).
2. Comprueba `attempt` (D11) y `expectedRevision` (D9).
3. Por cada entrada, **busca el `criterionId` dentro del snapshot**. Si no está →
   `400`, y la evaluación no se guarda a medias.
4. Busca el `selectedLevelId` **dentro de ese criterio del snapshot**. Si no está
   → `400`.
5. Toma los puntos **del nivel del snapshot**. Nunca del cuerpo.
6. Calcula `score` sumando. `maxScore` sale del snapshot.
7. Exige que estén todos los criterios del snapshot y ninguno repetido.

En modo `direct`, `score` **sí** viene del cliente —es el único dato que la
docente escribe a mano— y se valida contra el `maxScore` del snapshot: entero,
`0 <= score <= maxScore`. `maxScore` nunca viene del cuerpo.

En modo `none` se ignora cualquier `score` o `criteria` que llegue, y la
evaluación guarda sólo `generalFeedback`.

> Un cliente que mande `selectedLevelId` de un nivel de 20 puntos junto con
> `points: 1000`, `score: 1000` y `maxScore: 1000` obtiene **20 puntos**: los
> tres números no se leen. No hay que acordarse de rechazarlos.

### D13 · Un borrador puede estar a medias; una publicación, no

La diferencia de validación es explícita:

| | `draft` | `published` |
|---|---|---|
| `rubric`: criterios sin `selectedLevelId` | **Permitido** (`null`) | **Rechazado** — 400 |
| `rubric`: ids fuera del snapshot | Rechazado | Rechazado |
| `rubric`: `score` | Se calcula con lo elegido, como avance | Se recalcula entero |
| `direct`: `score` ausente | Permitido (`null`) | **Rechazado** |
| `direct`: rango | Si viene, entero `0..maxScore` | Entero `0..maxScore` |
| `none`: `score` | Siempre `null` | Siempre `null` |
| `generalFeedback` | Opcional | Opcional en los tres modos |

En `rubric`, publicar exige **todos** los criterios del snapshot resueltos. No se
publica «lo que haya»: media rúbrica publicada es una nota que nadie puede
defender.

Copy del bloqueo: «Falta evaluar: Interpretación, Código.» Nombra los criterios,
como «Todavía falta» ya nombra las Partes en la pantalla del estudiante.

### D14 · Corregir una evaluación publicada es una acción distinta

La pantalla no puede seguir aparentando un borrador:

```
draft       →  [Guardar borrador]  [Publicar evaluación]
published   →  [Actualizar evaluación publicada]
```

Actualizar una publicada:

- Es **explícito** y pide confirmación: «Esta evaluación ya la vio el
  estudiantado. Al actualizarla verán la nota nueva.»
- Vuelve a validar **como publicación** (D13): no se puede dejar incompleta.
- Sube `revision` y mantiene la condición optimista (D9).
- Comprueba el intento (D11).
- **Conserva el autor original** en `reviewedBy`/`reviewerName`, y anota en
  `lastEditedBy` quién hizo la corrección. Atribuir a la segunda persona una
  evaluación que hizo la primera sería falsear la autoría; no decir que alguien
  más la tocó, también.
- Usa el **snapshot de esa evaluación**, no la rúbrica actual de la actividad
  (D2).

No se construye historial de modificaciones (**RG-4**).

#### Semántica exacta de cada marca de tiempo

Tres, sin solapamiento:

| Campo | Cuándo se escribe | Qué significa |
|---|---|---|
| `createdAt` | Al crear la evaluación del intento | Cuándo se empezó a evaluar este intento |
| `updatedAt` | En **toda** escritura, borrador o publicada | Último cambio, sea el que sea |
| `publishedAt` | Sólo en la **primera** publicación | Cuándo la vio el estudiante por primera vez. Una corrección posterior **no** lo mueve |

**`reviewedAt` no existe en la evaluación**, a propósito: ya existe en
`Submission` con otro significado —la revisión antigua— y dos campos con el mismo
nombre y distinta semántica en objetos que se leen juntos es una trampa. Lo que
`reviewedAt` diría aquí es exactamente `updatedAt`.

El estudiante ve «Evaluada el {publishedAt}», y si `updatedAt > publishedAt`,
además «Actualizada el {updatedAt}». Así una corrección se nota sin necesidad de
historial.

### D15 · `supersededAt` se retira: el estado se deriva

Con `attempt` en los dos lados, «esta evaluación ya no es la vigente» es una
comparación, no un dato:

```ts
const isCurrent = grade.attempt === submission.attempt;
```

Persistirlo además sería estado duplicado, con su forma clásica de fallar: un
`supersededAt` que no se escribió por un fallo parcial deja una evaluación vieja
haciéndose pasar por vigente. Derivarlo no puede desincronizarse.

Y **quita una escritura del camino de la reentrega**: `upsertSubmission` no tiene
que tocar la tabla de evaluaciones (D8.3).

> Sustituye a la propuesta anterior, que persistía `supersededAt`. Responde a las
> preguntas de §9 del encargo así: no lo pone nadie, no vuelve a `null` porque no
> existe, es derivable, y por eso no se persiste.

---

## 3. Modelo final

Nombres en inglés como todo el modelo; copy en español. Pendiente de confirmar
contra `lib/types.ts` al implementar G1.

```ts
// ---- Definición: vive en Assignment ------------------------------------

interface RubricLevel {
  id: string;
  label: string;          // "Excelente"
  description: string;
  points: number;         // entero >= 0
}

interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  maxPoints: number;      // = levels[0].points, el mayor
  levels: RubricLevel[];  // estrictamente descendente por puntos, sin empates
  stepId?: string;        // D6 — opcional
}

interface RubricDefinition {
  criteria: RubricCriterion[];
}

interface GradingConfig {
  mode: 'none' | 'direct' | 'rubric';
  maxScore: number | null;      // null en modo 'none'
  rubric: RubricDefinition | null;
}

// Assignment gana UN campo. Ausente ⇒ { mode: 'none', maxScore: null, rubric: null }.
// grading: GradingConfig

// ---- Entrega: gana DOS campos ------------------------------------------

// En Submission / SubmissionRecord (D10):
// attempt: number                    // 0 = nunca entregada; sube por ACTO de entrega
// lastSubmitToken: string | null     // el acto que produjo el intento actual

// ---- Evaluación: item propio en `uinexus-grades` -----------------------

interface RubricCriterionAssessment {
  criterion: RubricCriterion;   // COPIA congelada, no una referencia
  selectedLevelId: string | null;   // null sólo en draft (D13)
  points: number;               // derivado del snapshot por el servidor
  comment: string;
}

interface SubmissionGradeRecord {
  /** `${submissionId}#${attempt}`. Clave HASH única, como el resto (D1). */
  id: string;
  submissionId: string;         // GSI bySubmission · HASH
  attempt: number;              // GSI bySubmission · RANGE
  assignmentId: string;
  courseId: string;             // autoriza sin leer la entrega

  status: 'draft' | 'published';
  mode: 'none' | 'direct' | 'rubric';

  score: number | null;
  maxScore: number | null;
  /** El snapshot. Congelado al crear (D2). Sólo en modo 'rubric'. */
  rubric: RubricCriterionAssessment[] | null;
  generalFeedback: string;

  reviewedBy: string;           // UID del autor. NUNCA sale al navegador
  reviewerName: string;         // desnormalizado, como `author` en projects
  lastEditedBy: string | null;  // UID de quien corrigió, si fue otra persona
  lastEditedByName: string | null;

  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;   // primera publicación; no se mueve al corregir

  revision: number;             // D9
}
```

El DTO que llega al navegador (`toGrade`) quita `reviewedBy` y `lastEditedBy`, y
añade `isCurrent` (derivado, D15). Al estudiante sólo se le entrega si
`status === 'published'` **y** `isCurrent`.

### Claves y tablas

```
uinexus-grades
  KeySchema        id (HASH)
  GSI bySubmission submissionId (HASH) · attempt (RANGE)   → el histórico
```

#### Los cuatro sitios que G1 actualiza JUNTOS

R13 costó un riesgo por declarar un índice que no existía. La tabla y su GSI van,
en el mismo cambio, a:

| Archivo | Qué añade |
|---|---|
| `src/lib/aws/config.ts` | `TABLES.grades` y `INDEXES.gradesBySubmission` |
| `scripts/lib/table-definitions.mjs` | La definición para el sandbox local |
| `infra/uinexus.cfn.yaml` | La misma tabla en la plantilla de AWS |
| `tests/unit/local-sandbox.test.ts` | Ya compara los dos anteriores: **fallará solo** si uno se olvida |

La cuarta fila es la que hace que esto no dependa de acordarse. Además, sin la
tabla en `table-definitions.mjs` las pruebas de integración de G1 no tendrían
dónde escribir, así que el olvido se nota en el primer `npm run test:integration`.

### Topes

| | |
|---|---|
| Criterios por rúbrica | 20 |
| Niveles por criterio | 6 |
| Nombre de criterio | 120 caracteres (como `stepTitleMax`) |
| Descripción de criterio / nivel | 500 |
| Etiqueta de nivel | 60 |
| Comentario por criterio | 1 000 |
| Retroalimentación general | 4 000 |
| Puntos de un nivel | entero, 0 … 1 000 |
| `maxScore` | entero, 1 … 1 000 |

Con los topes máximos, el snapshot ronda los 30 KB: holgado en su propia tabla.

### Validación de una rúbrica (regla única)

La versión anterior tenía dos reglas incompatibles —rechazar duplicados sólo si
coincidían puntos **y** etiqueta, pero exigir orden estrictamente descendente—.
Si el orden es estricto, dos niveles con los mismos puntos ya son imposibles.
Queda **una**:

1. Al menos un criterio en modo `rubric`; al menos dos niveles por criterio.
2. Nombre de criterio no vacío (tras `trim`).
3. Puntos: **enteros**, `>= 0`, dentro del tope.
4. Los niveles de un criterio van **estrictamente descendentes por puntos**:
   `levels[i].points > levels[i+1].points`. Eso ya prohíbe los empates, así que
   no hay una segunda regla que los prohíba.
5. Ids únicos dentro de la rúbrica (criterios) y dentro del criterio (niveles).
6. Etiquetas únicas dentro del mismo criterio, tras `trim` e ignorando
   mayúsculas. Dos «Bueno» en el mismo criterio no se pueden distinguir al
   elegir.
7. `criterion.maxPoints === levels[0].points`. Derivado, se recalcula al guardar;
   no se confía en el que venga.
8. `maxScore === Σ criterion.maxPoints`. Derivado igual.
9. `stepId`, si viene, es un id de Parte de esa actividad.
10. Nada de `NaN` ni `Infinity`: lo corta la regla 3, que exige entero finito.

---

## 4. Semántica de los verbos

| Verbo | Quién | Qué toca | `attempt` | Efecto sobre la evaluación |
|---|---|---|---|---|
| **Guardar** | estudiante | su entrega (`status: 'draft'`) | **no sube** | ninguno |
| **Entregar** | estudiante | su entrega (`status: 'submitted'`, `submittedAt`, `lastSubmitToken`) | **+1** si el token es nuevo | ninguno directo; el intento nuevo nace sin evaluación |
| **Reintentar ese envío** | el cliente, solo | lo mismo, reescrito igual | **no sube** (token repetido) | ninguno |
| **Reentregar** | estudiante | lo mismo, con token nuevo | **+1** | la evaluación anterior deja de ser vigente **por derivación** (D15); no se escribe |
| **Evaluar** | docente | `SubmissionGrade` `draft` | no | crea el item con el snapshot (D2) o actualiza el del intento |
| **Publicar** | docente | `status: 'published'`, `publishedAt` | no | el estudiante la ve |
| **Actualizar publicada** | docente | contenido + `updatedAt` + `revision` | no | el estudiante ve la nota nueva y que cambió (D14) |
| **Revisar / pedir cambios** (ruta antigua) | docente | `Submission.status`, `teacherNote` | **no sube** | ninguno; son mecanismos separados (D5) |
| **Supersede** | *nadie* | — | — | no es una acción: es `grade.attempt < submission.attempt` (D15) |

### Transiciones de estado, y cuál cuenta como intento

| Desde | Acción | `attempt` |
|---|---|---|
| *(sin entrega)* | guardar borrador | 0 → **0** |
| *(sin entrega)* o `draft` | primer submit | 0 → **1** |
| `submitted` | reintento del mismo submit (token repetido) | 1 → **1** |
| `submitted` | reentrega (token nuevo) | 1 → **2** |
| `reviewed` | reentrega | n → **n+1** |
| `needs_changes` | reentrega | n → **n+1** |
| cualquiera | guardar borrador | sin cambio |
| cualquiera | el docente revisa, pide cambios o publica | sin cambio |

El estado **no** decide el incremento: lo decide el token (D10). `submitted →
submitted` es a la vez el reintento y la reentrega, y por eso `status` no puede
distinguirlos.

---

## 5. Concurrencia: dos protecciones distintas

| | Qué carrera | Cómo | Fallo |
|---|---|---|---|
| **`revision` de la evaluación** (D9) | evaluación ↔ evaluación · dos docentes | `ConditionExpression: '#revision = :expected'` sobre la escritura, item `[1]` | 409 «Esta evaluación cambió en otra sesión. Recarga antes de continuar.» |
| **`attempt` de la entrega** (D11) | evaluación ↔ entrega evaluada · el estudiante reentrega | `ConditionCheck` sobre la entrega, item `[0]` de **la misma transacción** | 409 «La entrega cambió mientras la estabas evaluando. Recarga para revisar la versión actual.» |
| **`lastSubmitToken`** (D10) | entrega ↔ entrega · el propio cliente repite | comparar el token, y escribir condicionado a `#attempt` | no es un 409: el reintento **tiene éxito** y no cuenta un intento de más |

Las tres son independientes. Las dos primeras viajan en la **misma operación
atómica**, así que ninguna puede quedar cierta al comprobar y falsa al escribir;
la tercera protege el otro extremo del ciclo, donde quien repite no es un docente
sino el propio navegador del estudiante.

Ninguna sustituye a otra: la primera vigila el objeto que se escribe, la segunda
el objeto que se está juzgando, la tercera cuántas veces se entregó.

---

## 6. Qué NO se toca

- El motor académico: `Workflow`, `WorkflowStep`, `StepDeliverable`,
  `dependsOnStepIds`, `assignedTo`.
- La semántica de entrega: guardar ≠ entregar ≠ publicar.
- `Submission.data`, `stepEvidence`, los snapshots de NexBook.
- `teacherNote`, `reviewedAt`, `reviewedBy` y `PATCH /api/submissions/:id`.
- NexLab, NexCode, NexIA, Data Interop, el sandbox de ejecución.
- Búsqueda, Espacios, publicación, `.nexbook`.
- **RG-1** (el techo de 400 KB), **RG-2** (la concurrencia de la revisión
  antigua) y **R14** (las imágenes del snapshot).

Única excepción, declarada: **`Submission` gana `attempt` y `lastSubmitToken`**,
y `upsertSubmission` los escribe al entregar, con la condición de D10. Son
aditivos y normalizados al leer. Sin `attempt` no hay forma de decir qué se
evaluó; sin el token, `attempt` no es seguro.

`GET /api/assignments/:id/submission` y la pantalla de entrega ganan el
`submitToken`, que es el mismo cambio visto desde el cliente.

Y no se construye: panel docente, historial de versiones de entrega, historial de
cambios de evaluación, comentarios inline, autograding, IA que califique, plagio,
estadísticas, export institucional, competencias, badges, ranking, gamificación.

---

## 7. Compatibilidad

| Qué | Cómo sobrevive |
|---|---|
| Actividad sin `grading` | `{ mode: 'none', maxScore: null, rubric: null }` al leer |
| Entrega anterior sin `attempt` | `raw.attempt ?? (raw.submittedAt ? 1 : 0)`. Derivado exacto, no relleno. La primera escritura posterior lo persiste ya normalizado (D10) |
| Entrega anterior sin `lastSubmitToken` | Se lee `null`, que no coincide con ningún token: la siguiente entrega cuenta como acto nuevo, que es lo correcto |
| Entrega sin evaluación | La lectura devuelve `null`; la pantalla dice «Pendiente de revisión» |
| Entrega ya `reviewed` con `teacherNote` | Se sigue viendo igual. La evaluación es otra cosa, encima |
| Workflow legacy (`LEGACY_STEP_ID`) | Un criterio puede apuntar a `'main'` como a cualquier Parte |
| Actividad de UNA Parte | La señal es `assignment.type`, nunca `workflow.length` |
| Colaborativa | Una evaluación por entrega, que es una por estudiante (D7) |

**Cero migraciones.** Normalizar al leer, como todo el resto del proyecto.

---

## 8. Seguridad

El servidor decide, siempre:

| Invariante | Cómo |
|---|---|
| Sólo el profesorado de ESA materia evalúa | `requireCourseContext` + `role === 'teacher'`, como la revisión actual |
| El estudiante no puede escribir nada de la evaluación | No hay ruta que se lo permita |
| `points`, `score` (en `rubric`), `maxScore`, criterios y niveles | **No se leen del cuerpo** (D12). Se derivan del snapshot |
| El borrador no se filtra | La ruta del estudiante no entrega el item si no es `published` **y** vigente (D1, D15) |
| Una pantalla vieja no publica sobre una reentrega | Invariante A (D11) |
| Persona de otra materia | 404 indistinguible, como hoy |
| Sin UIDs al navegador | `reviewedBy` y `lastEditedBy` se quitan en el mapper; viajan los nombres |
| Texto del profesorado | La política de Markdown del producto: sin HTML crudo, URLs saneadas |

**Datos que el servidor acepta**: `attempt`, `expectedRevision`,
`generalFeedback`, `criteria[].criterionId`, `criteria[].selectedLevelId`,
`criteria[].comment` y, sólo en `direct`, `score`. En la ruta de entrega,
además, `submitToken` — opaco, sin privilegios, y que sólo puede hacer que el
estudiante cuente mal sus propios intentos (RG-9).
**Datos que el servidor deriva**: `points`, `score` en `rubric`, `maxScore`, el
snapshot entero, `reviewedBy`, `reviewerName`, `lastEditedBy`, `status`,
`createdAt`, `updatedAt`, `publishedAt`, `revision`, `id`.

---

## 9. Qué cambió en esta revisión de G0, y por qué

| # | Antes | Ahora |
|---|---|---|
| 1 | `PK: submissionId`, «exactamente una evaluación por entrega» | `id = ${submissionId}#${attempt}` + GSI `bySubmission` (**D1**). La clave anterior hacía imposible conservar el intento 1 y evaluar el 2 |
| 2 | El intento no existía | `Submission.attempt`, aditivo y normalizado al leer (**D10**) |
| 3 | `supersededAt` persistido | Derivado de comparar intentos (**D15**). Una fuente de verdad, y una escritura menos en la reentrega |
| 4 | «El servidor relee la rúbrica» vs «la evaluación lleva copia» | Punto de congelación explícito: al crear la evaluación del intento (**D2**) |
| 5 | Sin protección contra la reentrega a mitad de corrección | Invariante A, comprobada al guardar y al publicar (**D11**) |
| 6 | El contrato del cliente no estaba escrito | Lo que se acepta y lo que se deriva, campo por campo (**D12**) |
| 7 | Draft y publicación validaban igual | Tabla de diferencias (**D13**) |
| 8 | Dos reglas de niveles incompatibles | Una sola: orden estrictamente descendente (§3) |
| 9 | Editar una publicada, sin UX definida | Acción propia, confirmación, autoría conservada (**D14**) |
| 10 | `reviewedAt` en la evaluación | Retirado: chocaba con el de `Submission`. `createdAt`/`updatedAt`/`publishedAt` (**D14**) |

### Tercera revisión: `attempt` seguro

| # | Antes | Ahora |
|---|---|---|
| 11 | D11 comprobaba el intento **leyendo** antes de escribir | TOCTOU. Ahora es una `TransactWriteCommand` con `ConditionCheck` sobre la entrega y la condición de `revision` sobre la evaluación, en **una sola operación** (**D11**) |
| 12 | Los dos 409 no se distinguían | `CancellationReasons` mapea por índice: `[0]` entrega, `[1]` evaluación. Sin releer (**D11**) |
| 13 | «`submittedAt` cambia exactamente cuando debe» | **Falso y corregido.** Un reintento lo reescribe: prueba cuándo corre el código, no que sea otro acto (**D10**) |
| 14 | `if (intent === 'submit') attempt += 1` | Insuficiente: entregar y reentregar son la misma petición y nada las separa. Ahora un `submitToken` por acto de entrega decide el incremento (**D10**) |
| 15 | La transición legacy no estaba analizada | Los dos casos distinguidos por `submittedAt`, y la escritura es un `PutCommand` de item completo —nunca un `ADD` sobre un atributo ausente— (**D10**) |
| 16 | Nada decía dónde declarar la tabla | Los cuatro archivos que G1 toca juntos, con el test que lo vigila (§3) |

---

## 10. UX docente

La pantalla de revisión (`SubmissionViewer`) es el centro de la iniciativa.

```
Entrega de Christian · intento 2                       [Entregada]
  Hubo una evaluación del intento 1 · 12 mar          [Ver]

┌ Trabajo entregado ──────────────────────────┐
│ Parte 1 · Responder                         │
│ Parte 2 · NexLab                            │
│ Parte 3 · NexIA                             │
└─────────────────────────────────────────────┘

┌ Evaluación ─────────────────────────────────┐
│ Análisis de datos              40 pts       │
│ ( ) Excelente   40    ( ) Bueno       30    │
│ ( ) Suficiente  20    ( ) Insuficiente 0    │
│ Comentario  [......................]        │
│ → Ver evidencia de esta Parte               │
│                                             │
│ Total: 87 / 100                             │
└─────────────────────────────────────────────┘

Retroalimentación general
[.............................................]

[Guardar borrador]        [Publicar evaluación]
```

- **Móvil: una card por criterio**, con radios. Nunca una matriz horizontal.
- **Los niveles son un `radiogroup` real** dentro de `fieldset` + `legend` —
  teclado y lector de pantalla sin trabajo extra.
- **«Ver evidencia de esta Parte»** sólo si el criterio lleva `stepId`, y salta al
  `id` de la sección de esa Parte, que ya se pinta por `part.id`.
- **Guardando / Guardada / Publicada** son tres mensajes distintos.
- **Publicada** cambia la botonera entera (D14).
- Los dos conflictos tienen copy propio (§5). Nunca sobrescribir.
- Si el snapshot difiere de `Assignment.grading`, se avisa (**RG-7**): «Esta
  evaluación usa la rúbrica con la que se abrió. La actividad tiene otra desde
  entonces.»

### Configuración en el creador

Sección **Evaluación**, después del contenido académico —quien crea una actividad
piensa primero en qué va a pedir—.

```
○ Sin calificación numérica
○ Calificación directa      → Puntaje máximo [100]
○ Rúbrica                   → + Añadir criterio
```

El editor muestra etiquetas y puntos. Nunca JSON, nunca ids.

---

## 11. UX estudiante

Entregada, sin evaluar —incluye el caso «reentregué después de que me
evaluaran»—:

```
Entregada
Pendiente de revisión
```

Con evaluación publicada y vigente:

```
Evaluada          87 / 100

Tu evaluación
  Análisis de datos      Excelente        40 / 40
  Código                 Bueno            22 / 30
  Interpretación         Suficiente       15 / 30
                                          ───────
  Total                                   77 / 100
```

Modo `none`: **«Retroalimentación disponible»**, sin número.
Corregida después de publicar: «Evaluada el 12 mar · Actualizada el 14 mar».

No se enseña nada de la maquinaria: ni `stepId`, ni `revision`, ni `attempt`, ni
`reviewedBy`, ni ids de DynamoDB. Al estudiante no se le ofrece el histórico de
intentos: ve el suyo actual.

---

## 12. Unidades

Fases **de esta iniciativa**. No continúan la numeración de Nextudio.

| | | Se cierra cuando |
|---|---|---|
| **G0** ✅ | Auditoría y diseño | Este documento, con la suite base verde |
| **G1** | Modelo, persistencia, rutas | Tipos, esquemas, tabla + GSI en **los cuatro archivos** (§3), `attempt` + `submitToken`, `revision`/409, invariante A **en transacción**, permisos por integración |
| **G2** | Configuración en el creador | Los tres modos se guardan y releen; rúbrica válida e inválida |
| **G3** | Revisión docente | Borrador, publicación, corrección, los dos conflictos, salto a la Parte, responsive y teclado |
| **G4** | Vista del estudiante | Publicada sí, borrador no, superada no; los tres modos |
| **G5** | Reentrega y compatibilidad | Intentos, histórico, legacy y colaborativa intactas |
| **G6** | Endurecimiento y documentación | E2E completos, límites, docs, CHECKPOINT |

Cada unidad cierra con la suite entera:

```
npm run typecheck · npm run lint · npm test
npm run test:integration · npm run build · npm run test:e2e
```

y `npm run test:e2e:prod` mientras siga aplicando. Sin reruns ciegos.

---

## 13. Pruebas que G1–G5 deben tener

Especificadas desde aquí para que no se decidan improvisando.

| # | Caso | Espera | Dónde |
|---|---|---|---|
| 1 | Actividad sin `grading` | Se lee `mode: 'none'` | unidad · G1 |
| 2 | Rúbrica con criterio sin nombre · puntos negativos · no entero · `NaN` · `Infinity` | Rechazo con mensaje | unidad · G1 |
| 3 | Dos niveles con los mismos puntos, etiquetas distintas | **Rechazo** (orden estricto) | unidad · G1 |
| 4 | Dos «Bueno» en el mismo criterio | Rechazo | unidad · G1 |
| 5 | `maxScore` ≠ suma de criterios | Se recalcula; no se confía en el enviado | unidad · G1 |
| 6 | Reordenar Partes | La referencia `stepId` sigue válida | unidad · G1 |
| 7 | Borrar la Parte de un criterio | El criterio sobrevive como global | unidad · G1 |
| 8 | **Cliente manda `points: 1000`, `score: 1000`, `maxScore: 1000` con un nivel de 20** | **20 puntos.** Los tres se ignoran | integración · G1 |
| 9 | `criterionId` o `selectedLevelId` inexistentes | 400, sin guardado parcial | integración · G1 |
| 10 | Draft con criterios sin resolver | **Se guarda** | integración · G1 |
| 11 | Publicar con criterios sin resolver | **400**, nombrando los que faltan | integración · G1 |
| 12 | `direct`: publicar sin `score` · `score` fuera de rango · no entero | 400 | integración · G1 |
| 13 | `none`: llega un `score` | Se ignora; no se inventa nota | integración · G1 |
| 14 | **Dos docentes**: A y B abren `revision 3`; A guarda → 4; B guarda con `expectedRevision 3` | **409** | integración · G1 |
| 15 | **Docente vs reentrega**: docente abre intento 1; estudiante entrega → intento 2; docente publica intento 1 | **409**, y la evaluación del 1 intacta | integración · G1 |
| 16 | Lo mismo, pero **guardando borrador** en vez de publicar | **409** también | integración · G1 |
| 15b | **Atomicidad, no lectura previa**: el `attempt` cambia entre la lectura y la escritura de la evaluación | La escritura **no ocurre** y sale 409. Se prueba moviendo `Submission.attempt` **después** de que la ruta haya leído y **antes** de la transacción, no simulando una comprobación previa | integración · G1 |
| 15c | Los dos conflictos a la vez: `attempt` cambiado **y** `revision` obsoleta | 409, y el mensaje es el de la **entrega** (índice `[0]` manda) | integración · G1 |
| 15d | `CancellationReasons` mapea por índice | `[0]` → mensaje de entrega; `[1]` → mensaje de evaluación. Sin releer para distinguirlos | integración · G1 |
| 17 | **Rúbrica cambiada a media corrección**: draft con A; la actividad pasa a B; se publica | Se publica **con A**, entera | integración · G1 |
| 18 | Reentrega tras evaluación publicada | La del intento 1 existe y no es vigente; el 2 sale «Pendiente de revisión» | integración · G5 |
| 19 | Estudiante pide la evaluación en borrador | No la recibe | integración · G1 |
| 20 | Estudiante intenta escribir score/feedback/publicar | Rechazado | integración · G1 |
| 21 | Docente de otra materia · persona ajena | 404 indistinguible | integración · G1 |
| 22 | Evaluar una entrega en `draft` del estudiante (`attempt: 0`) | Rechazo | integración · G1 |
| 23 | Corregir una publicada | Sube `revision`, `publishedAt` **no** se mueve, `updatedAt` sí, autoría conservada | integración · G1 |
| 24 | Entrega anterior sin `attempt` con `submittedAt` | Se lee `attempt: 1` | unidad · G5 |
| 24b | **Legacy ya entregado**: `attempt` ausente, `submittedAt` presente → reentrega | Se **persiste** `attempt = 2`, no 1 | integración · G5 |
| 24c | **Legacy nunca entregado**: `attempt` y `submittedAt` ausentes → primer submit | Se persiste `attempt = 1`. No se confunde con el anterior | integración · G5 |
| 24d | **Reintento del primer submit**: borrador → submit → se pierde la respuesta → el cliente repite con el **mismo** token | Sigue en `attempt = 1` | integración · G1 |
| 24e | **Reintento de una reentrega**: `reviewed` en `attempt 1` → reentrega → reintento con el mismo token | Sigue en `attempt = 2`, no 3 | integración · G1 |
| 24f | **Dos submits simultáneos, mismo token** | `attempt = 2`. Nunca 3 | integración · G1 |
| 24g | **Dos submits simultáneos, tokens distintos** (dos reentregas reales) | `attempt = 3`: son dos actos | integración · G1 |
| 24h | Submit con `intent: 'submit'` **sin** `submitToken` | Rechazo: el token es obligatorio al entregar | integración · G1 |
| 24i | Guardar borrador repetidamente | `attempt` no se mueve | integración · G1 |
| 24j | El docente revisa, pide cambios o publica | `attempt` no se mueve | integración · G1 |
| 25 | **Recorrido simple**: docente 85/100 + feedback → borrador → el estudiante NO lo ve → publica → el estudiante ve 85/100 | verde | e2e · G3/G4 |
| 26 | **Recorrido con rúbrica**: crear actividad con rúbrica → el estudiante entrega → elegir niveles → el total se calcula → publicar → el estudiante ve criterios y comentarios | verde | e2e · G3/G4 |
| 27 | **Recorrido de reentrega**: entregar → evaluar → publicar → reentregar → queda pendiente | verde | e2e · G5 |
| 28 | Estudiante abre por URL directa la pantalla docente de evaluación | Rechazado | e2e · G4 |
| 29 | Rúbrica a 1280×900, 390×844 y 375×812 | Sin desbordamiento; cards en móvil | e2e · G3 |
| 30 | Elegir niveles sólo con teclado | Posible; axe sin incidencias | e2e · G3 |

---

## 14. Riesgos

| # | Riesgo | Estado |
|---|---|---|
| **RG-1** | El item de `Submission` puede pasar de 400 KB con varias Partes de laboratorio llenas | **ABIERTO — preexistente**, fuera de alcance. `docs/LIMITATIONS.md` §15 |
| **RG-2** | `reviewSubmission` sigue sin concurrencia optimista | **ACEPTADO** aquí. La evaluación nueva sí la lleva (D9) |
| **RG-3** | Borrar una Parte deja criterios con `stepId` colgando | **CERRADO por diseño** (D6) |
| **RG-4** | Corregir una publicada no deja historial completo | **ACEPTADO.** Sube `revision`, conserva autoría, anota quién corrigió y se ve que cambió (D14) |
| **RG-5** | R14: las imágenes del snapshot no se sirven al profesorado | **DOCUMENTADO.** No se abre aquí |
| **RG-6** | El snapshot duplica la rúbrica en cada evaluación | **ACEPTADO.** ~30 KB en el peor caso, en su propia tabla |
| **RG-7** *(nuevo)* | Cambiar la rúbrica a media corrección deja a dos estudiantes evaluados con rúbricas distintas | **ACEPTADO y avisado** (D2). La alternativa reescribe notas ya comunicadas |
| **RG-8** | `attempt` y `lastSubmitToken` se escriben en `upsertSubmission`, una ruta ya probada | **ACEPTADO.** Aditivos, normalizados al leer, cubiertos por los casos 15–16, 18 y 24–24j |
| **RG-9** *(nuevo)* | La idempotencia depende de que el cliente reutilice el `submitToken` de un acto y genere uno nuevo en el siguiente | **ACEPTADO.** Un cliente que lo hiciera mal sólo cuenta mal **sus propios** intentos: el token no concede permisos ni decide nada que el servidor no compruebe. La alternativa —deducirlo del contenido o del estado— falla en los dos sentidos (D10) |
| **RG-10** *(nuevo)* | Dos reentregas **realmente** simultáneas con tokens distintos dejan una sola entrega almacenada, pero cuentan dos intentos | **ACEPTADO.** El contenido guardado es el de la que ganó, y `attempt = 3` describe bien «hubo otro acto». Contar de menos sería peor: dejaría una evaluación publicada apuntando a un trabajo que ya cambió |

---

## 15. Criterios de aceptación

La iniciativa **no está terminada** hasta que se cumplen las dieciocho:

1. Una actividad puede no tener calificación (`none`).
2. Puede usar calificación directa.
3. Puede usar rúbrica.
4. El borrador de evaluación es invisible para el estudiante.
5. Publicar es una acción explícita.
6. El estudiante ve calificación y retroalimentación publicadas.
7. El snapshot de rúbrica es estable: cambiar la actividad no altera una
   evaluación ya abierta.
8. Los puntos y el `score` en modo `rubric` se calculan **sólo** en el servidor.
9. Un borrador de rúbrica puede estar incompleto.
10. Publicar exige la rúbrica completa.
11. Cada evaluación está ligada a un intento concreto.
12. Reentregar crea un intento nuevo.
13. La evaluación anterior no desaparece.
14. La evaluación anterior no se muestra como vigente.
15. Una pantalla docente vieja no puede publicar contra una reentrega nueva
    (409), y la garantía está **en la escritura**: la condición sobre la entrega
    y la escritura de la evaluación son una sola operación atómica, no un
    «leo, compruebo, escribo».
16. Dos sesiones docentes concurrentes están protegidas (409), y los dos
    conflictos se distinguen sin releer.
16b. Un mismo acto de entrega no produce dos intentos, ocurra doble clic,
    reintento de red o respuesta perdida.
17. Rúbrica y Partes se relacionan por ids estables; legacy sigue funcionando sin
    migración; autorización y validación son server-side.
18. Responsive y teclado dentro del alcance, y los E2E cubren el ciclo completo.
