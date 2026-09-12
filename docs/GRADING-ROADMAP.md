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
`rubric`, `feedback`, `criterion`, `level`, `weight`: **cero coincidencias** en
`src/`, salvo la palabra «calificación» en una frase de la portada.

No hay número, no hay rúbrica, no hay puntos, no hay borrador de evaluación, y
**no hay distinción entre evaluar y publicar la evaluación**: hoy `teacherNote`
llega al estudiante en cuanto se guarda la revisión.

### Cuatro hallazgos que condicionan el diseño

**1. No hay concurrencia optimista en la revisión.** `reviewSubmission` escribe
con `ConditionExpression: 'attribute_exists(id)'`, que sólo comprueba que la
entrega exista. Dos docentes con la misma entrega abierta se pisan en silencio:
gana quien guarde último. `Submission` no tiene `revision`. El patrón correcto
ya existe en el proyecto (`lib/data/nexbooks.ts:227`) y esta iniciativa lo
adopta.

**2. El item de la entrega ya está cerca de su techo.** Un `Submission` es UN
item de DynamoDB, límite duro **400 KB**. Dentro puede llevar hasta 25 Partes
(`WORKFLOW_LIMITS.maxSteps`) y cada Parte de laboratorio guarda un **snapshot
completo de NexBook**, presupuestado en **300 000 bytes**
(`NEXBOOK_LIMITS.documentBytes`). Dos Partes de laboratorio llenas ya no caben.

> Esto es un riesgo **preexistente**, no algo que introduzca la calificación —
> queda anotado como **RG-1** más abajo—. Pero decide dónde va la evaluación.

**3. En una actividad colaborativa cada estudiante tiene su propia entrega.**
`submissionIdFor(assignmentId, uid)` deriva el id del UID, y `buildWorkflowGroupView`
compone la vista de grupo **en lectura**, sin que exista ningún registro
compartido. Así que la pregunta «¿nota por Submission o por estudiante?» no
tiene dos respuestas: **hoy son el mismo objeto**.

**4. Reentregar ya invalida la revisión, pero conserva la nota.**
`upsertSubmission` limpia `reviewedAt` y `reviewedBy` y devuelve el estado a
`submitted`, pero mantiene `teacherNote` (`academic-writes.ts:560`). El
comentario del código lo razona: *«dejar la marca de revisado sobre un texto que
ha cambiado desde entonces es mentir sobre lo que se leyó»*. La semántica de la
calificación tiene que ser coherente con eso.

### Suite base sobre el árbol actual

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   46 archivos · 982 passed | 1 skipped (983)
npm run test:integration ✅   17 archivos · 237 passed
npm run build            ✅
npm run test:e2e         ✅   21 recorridos con sesión real
```

---

## 2. Decisiones

### D1 · La evaluación es una entidad propia, en su propia tabla

**No va dentro del item de `Submission`**, aunque pertenezca a una sola entrega.
Tres razones, en orden de peso:

1. **Espacio.** El item ya puede acercarse a 400 KB con snapshots de NexBook
   (hallazgo 2). Añadirle una rúbrica evaluada más su snapshot lo empuja hacia
   un `ValidationException: Item size has exceeded the maximum allowed size`,
   que es un error ilegible en mitad de una clase.
2. **La invisibilidad del borrador pasa a ser estructural.** Si la evaluación es
   otro item, la ruta del estudiante sencillamente **no lo lee**. No depende de
   acordarse de quitar un campo en `toSubmission`. Es el mismo argumento que
   sostiene el índice disperso `byStatus` en `docs/ARCHITECTURE.md`: la garantía
   deja de estar en el cuidado de quien escribe el mapper y pasa a estar en la
   forma del dato.
3. **Dos escritores, dos items.** El estudiante escribe su entrega; la docente
   escribe la evaluación. Separados, una reentrega y una calificación simultánea
   no pueden pisarse, y cada uno lleva su propia `revision`.

El proyecto ya tiene el precedente escrito en `lib/aws/config.ts`: *«Tablas
nuevas, no columnas nuevas: una entrega y un proyecto no comparten ni ciclo de
vida ni patrón de acceso»*, y `workspaces` es tabla propia por el mismo motivo.

```
uinexus-grades    PK submissionId
```

Clave primaria `submissionId` y no un id nuevo: hay **exactamente una evaluación
vigente por entrega**, así que un id propio sólo permitiría tener dos.

> Esto **contradice deliberadamente** la recomendación tentativa del encargo
> («considera almacenarla junto a `Submission`»), que admitía explícitamente
> decidir tras leer tamaños, patrones y escrituras. Se leyeron, y el tamaño
> manda.

### D2 · La rúbrica se define en la actividad y se congela en la evaluación

`RubricDefinition` vive en `Assignment` (se configura antes de que exista
ninguna entrega, así que no puede colgar de la primera).
`RubricAssessment` vive en la evaluación y **lleva dentro una copia de la
definición** con la que se evaluó.

Nunca se guarda `criterionIndex: 2`. Ni siquiera se guarda sólo `criterionId`:
se guarda el criterio entero —nombre, descripción, puntos, niveles— junto a la
elección. Así, si la docente reescribe la rúbrica en marzo, la evaluación de
febrero sigue diciendo exactamente lo que dijo.

Es la misma decisión que ya toma `NexBookSubmissionData`: *«Una entrega NO
apunta al NexBook vivo: lleva una COPIA»*. El snapshot de rúbrica es el mismo
principio aplicado al instrumento de medida.

Coste: duplicación. Una rúbrica de 20 criterios × 6 niveles ronda los 8–12 KB
por evaluación. Con la evaluación en su propia tabla (D1), cabe de sobra.

### D3 · Tres modos, y el de por defecto es «ninguno»

```ts
type GradingMode = 'none' | 'direct' | 'rubric';
```

- `none` — sólo retroalimentación. **No se inventa un `0/0`.**
- `direct` — `maxScore` configurado, la docente escribe el número.
- `rubric` — la suma de los niveles elegidos deriva la calificación.

Una actividad sin `grading` guardado **se lee como `none`**. Es la misma
estrategia de compatibilidad de todo el proyecto: normalizar al leer, nunca
migrar. No se asume 100 puntos para nadie.

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
evaluación hereda la misma gramática: guardar una evaluación no se la enseña a
nadie; publicarla es una acción explícita y con confirmación.

`teacherNote` **no se toca**. Sigue siendo lo que es —la nota de la revisión— y
las entregas ya revisadas se siguen leyendo igual. La retroalimentación de la
evaluación es un campo nuevo (`generalFeedback`) que vive en la evaluación y
sólo se ve publicada.

### D6 · Un criterio puede señalar una Parte, y nunca por índice

```ts
stepId?: string   // el id estable de WorkflowStep, nunca "Parte 2"
```

`WorkflowStep.id` es estable: `order` es un campo aparte y `partsFromAssignment`
conserva los ids al reabrir una actividad por partes. Reordenar Partes no puede
romper una rúbrica.

Un `stepId` que ya no existe (la Parte se borró) **no invalida el criterio**: se
lee como criterio global y se anota. La evaluación histórica ya lleva su
snapshot, así que sigue entendiéndose.

### D7 · La nota es de la entrega, y la entrega es de una persona

Dado el hallazgo 3, **por entrega = por estudiante**. No se añaden overrides
individuales, porque no hay nada que sobrescribir: no existe una nota de grupo.
Si algún día existe una entrega compartida de verdad, será una decisión suya.

### D8 · Una reentrega deja la evaluación no vigente, sin borrarla

```
entrega evaluada y publicada
      ↓ el estudiante vuelve a entregar
la evaluación pasa a supersededAt != null
      ↓
la entrega vuelve a "Pendiente de revisión"
```

La evaluación anterior **se conserva** con su snapshot y su fecha; deja de ser
vigente. El estudiante ve «Pendiente de revisión», no un 85 que ya no
corresponde a lo que entregó. La docente, al abrirla, ve que hubo una evaluación
previa y de cuándo.

No es historial de versiones: es **un** registro con una marca. El historial
completo de reentregas es otra iniciativa y esta no lo abre.

### D9 · Concurrencia con `revision`, como los NexBooks

`SubmissionGrade.revision` + `UpdateCommand` con
`ConditionExpression: '#revision = :expected'`, y relectura al fallar para
distinguir «no existe» de «alguien más guardó» — exactamente el patrón de
`lib/data/nexbooks.ts:195-243`. Nada de last-write-wins.

Esto **también corrige el hallazgo 1** para el camino de la evaluación. La
revisión antigua (`teacherNote` + estado) se deja como está: cambiarla es tocar
una ruta probada por razones que no son de esta iniciativa. Queda anotado como
**RG-2**.

---

## 3. Modelo propuesto

Pendiente de confirmar contra `lib/types.ts` al implementar G1. Nombres en
inglés como todo el modelo; copy en español.

```ts
// ---- Definición: vive en Assignment ------------------------------------

interface RubricLevel {
  id: string;
  label: string;          // "Excelente"
  description: string;
  points: number;         // entero ≥ 0
}

interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  maxPoints: number;      // = max(levels.points)
  levels: RubricLevel[];  // orden descendente por puntos
  stepId?: string;        // D6 — opcional
}

interface RubricDefinition {
  criteria: RubricCriterion[];
}

interface GradingConfig {
  mode: 'none' | 'direct' | 'rubric';
  maxScore: number | null;      // null cuando mode === 'none'
  rubric: RubricDefinition | null;
}

// Assignment gana UN campo. Ausente ⇒ { mode: 'none', … } al leer.
// grading: GradingConfig

// ---- Evaluación: item propio en `uinexus-grades` -----------------------

interface RubricCriterionAssessment {
  criterion: RubricCriterion;   // COPIA congelada, no una referencia
  selectedLevelId: string | null;
  points: number;
  comment: string;
}

interface SubmissionGrade {
  submissionId: string;         // PK
  assignmentId: string;
  courseId: string;             // para autorizar sin leer la entrega
  status: 'draft' | 'published';
  mode: 'none' | 'direct' | 'rubric';
  score: number | null;
  maxScore: number | null;
  rubric: RubricCriterionAssessment[] | null;
  generalFeedback: string;
  reviewedBy: string;           // UID. NUNCA sale al navegador
  reviewerName: string;         // desnormalizado, como `author` en projects
  reviewedAt: string;
  publishedAt: string | null;
  supersededAt: string | null;  // D8
  revision: number;             // D9
  createdAt: string;
  updatedAt: string;
}
```

El DTO que llega al navegador (`toGrade`) elimina `reviewedBy` y, para el
estudiante, todo lo que no sea `status: 'published'`.

### Topes

Pendientes de ajustar contra `NEXBOOK_LIMITS` y `WORKFLOW_LIMITS` al
implementar. Punto de partida:

| | |
|---|---|
| Criterios por rúbrica | 20 |
| Niveles por criterio | 6 |
| Nombre de criterio | 120 caracteres (como `stepTitleMax`) |
| Descripción de criterio / nivel | 500 |
| Comentario por criterio | 1 000 |
| Retroalimentación general | 4 000 |
| Puntos | entero, 0 … 1 000 |

### Validación

Se rechaza: criterio sin nombre · puntos negativos · `NaN` · `Infinity` ·
no entero · rúbrica sin criterios en modo `rubric` · dos niveles con los mismos
puntos Y la misma etiqueta · `maxScore` que no cuadra con la suma · `stepId` que
no es un id de Parte de esa actividad.

El orden de los niveles **sí** es estricto (descendente por puntos): una rúbrica
donde «Insuficiente» vale más que «Excelente» es un error de captura, no una
preferencia.

---

## 4. Qué NO se toca

- El motor académico: `Workflow`, `WorkflowStep`, `StepDeliverable`,
  `dependsOnStepIds`, `assignedTo`.
- La semántica de entrega: guardar ≠ entregar ≠ publicar.
- `Submission.data`, `stepEvidence`, los snapshots.
- `teacherNote`, `reviewedAt`, `reviewedBy` y la ruta `PATCH /api/submissions/:id`.
- NexLab, NexCode, NexIA, Data Interop, el sandbox de ejecución.
- Búsqueda, Espacios, publicación, `.nexbook`.
- **R14.** Las imágenes del snapshot siguen sin poder servirse al profesorado.
  No se abre una ruta nueva por la puerta de atrás.

Y no se construye: panel docente, historial de reentregas, comentarios inline,
autograding, IA que califique, plagio, estadísticas de grupo, export
institucional, competencias, badges, ranking, gamificación.

---

## 5. Compatibilidad

| Qué | Cómo sobrevive |
|---|---|
| Actividad sin `grading` | Se lee como `{ mode: 'none' }`. Ni un `0/0`, ni 100 puntos supuestos |
| Entrega anterior | No tiene evaluación; la lectura devuelve `null`, la pantalla dice «Pendiente de revisión» |
| Entrega ya `reviewed` con `teacherNote` | Se sigue viendo exactamente igual. La evaluación es otra cosa, encima |
| Workflow legacy (`LEGACY_STEP_ID`) | Un criterio puede apuntar a `'main'` como a cualquier Parte |
| Actividad de UNA Parte | La señal es `assignment.type`, nunca `workflow.length` |
| Colaborativa | Una evaluación por entrega, que es una por estudiante (D7) |

**Cero migraciones.** Normalizar al leer, como todo el resto.

---

## 6. Seguridad

El servidor decide, siempre:

| Invariante | Cómo |
|---|---|
| Sólo el profesorado de ESA materia evalúa | `requireCourseContext` + `role === 'teacher'`, igual que la revisión actual |
| El estudiante no puede escribir nada de la evaluación | No hay ruta que se lo permita; `score`, `maxScore`, `reviewedBy`, `publishedAt` no se leen nunca del cuerpo |
| `maxScore` y la rúbrica no vienen del navegador | Se releen de la actividad y se revalidan en el servidor |
| El borrador no se filtra | La ruta del estudiante no lee el item si `status !== 'published'` (D1) |
| Persona de otra materia | 404 indistinguible, como hoy |
| Sin UIDs al navegador | `reviewedBy` se quita en el mapper; viaja `reviewerName` |
| Texto del profesorado | Misma política de Markdown del producto: sin HTML crudo, URLs saneadas |

---

## 7. UX docente

La pantalla de revisión (`SubmissionViewer`) es el centro de la iniciativa.

```
Entrega de Christian                            [Entregada]

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
- **Los niveles son un `radiogroup` real** dentro de un `fieldset` con
  `legend` — teclado y lector de pantalla sin trabajo extra.
- **«Ver evidencia de esta Parte»** sólo aparece si el criterio lleva `stepId`,
  y salta al `id` de la sección de esa Parte, que ya se pinta por `part.id`.
- **Guardando / Guardada / Publicada** son tres mensajes distintos. El producto
  ya distingue guardar de publicar y aquí se dice igual.
- Conflicto: «Esta evaluación cambió en otra sesión. Recarga antes de
  continuar.» Nunca sobrescribir.

### Configuración en el creador

Sección **Evaluación**, después del contenido académico —no al principio: quien
crea una actividad piensa primero en qué va a pedir—.

```
○ Sin calificación numérica
○ Calificación directa      → Puntaje máximo [100]
○ Rúbrica                   → + Añadir criterio
```

El editor de rúbrica muestra etiquetas y puntos. Nunca JSON, nunca ids.

---

## 8. UX estudiante

Después de entregar, sin evaluar:

```
Entregada
Pendiente de revisión
```

Con evaluación publicada:

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

No se enseña nada de la maquinaria: ni `stepId`, ni `revision`, ni
`reviewedBy`, ni ids de DynamoDB.

---

## 9. Unidades

Fases **de esta iniciativa**. No continúan la numeración de Nextudio.

| | | Se cierra cuando |
|---|---|---|
| **G0** | Auditoría y diseño | Este documento, con la suite base verde |
| **G1** | Modelo, persistencia, rutas | Tipos, esquemas, tabla `grades`, `revision`/409, permisos probados por integración |
| **G2** | Configuración en el creador | Los tres modos se guardan y se releen; rúbrica válida e inválida probadas |
| **G3** | Revisión docente | Borrador, publicación, conflicto, navegación a la Parte, responsive y teclado |
| **G4** | Vista del estudiante | Publicada sí, borrador no; los tres modos |
| **G5** | Reentrega y compatibilidad | D8 probada; legacy y colaborativa intactas |
| **G6** | Endurecimiento y documentación | E2E completos, límites, docs, CHECKPOINT |

Cada unidad cierra con la suite entera:

```
npm run typecheck · npm run lint · npm test
npm run test:integration · npm run build · npm run test:e2e
```

y `npm run test:e2e:prod` mientras siga aplicando. Sin reruns ciegos.

---

## 10. Riesgos

| # | Riesgo | Estado |
|---|---|---|
| **RG-1** | **El item de `Submission` puede pasar de 400 KB** con varias Partes de laboratorio llenas (25 Partes × 300 KB de snapshot, techo de 400 KB). Es **preexistente**; la calificación no lo agrava porque vive en otra tabla (D1) | **ABIERTO — preexistente.** Se documenta aquí y en `docs/LIMITATIONS.md`. Arreglarlo es trabajo propio: un tope agregado sobre `stepEvidence` al validar la entrega |
| **RG-2** | `reviewSubmission` sigue sin concurrencia optimista: dos docentes revisando se pisan | **ACEPTADO en esta iniciativa.** La evaluación nueva sí la lleva (D9). Extenderla a la revisión antigua es un cambio de una ruta probada, ajeno a este alcance |
| **RG-3** | Borrar una Parte deja criterios con `stepId` colgando | **CERRADO por diseño.** Se leen como criterios globales; las evaluaciones publicadas llevan su snapshot |
| **RG-4** | Editar una evaluación publicada cambia la nota sin dejar rastro completo | **ACEPTADO.** Se actualiza `reviewedAt`, se conserva el autor y la pantalla lo dice. Historial completo es otra iniciativa |
| **RG-5** | R14: las imágenes del snapshot no se sirven al profesorado, así que un criterio sobre una figura se evalúa sin verla | **DOCUMENTADO.** No se abre R14 aquí. Si bloquea de verdad, se propone como prerequisito separado |
| **RG-6** | El snapshot de rúbrica duplica la definición en cada evaluación | **ACEPTADO.** 8–12 KB por evaluación en su propia tabla, a cambio de que la historia no dependa de un dato mutable |

---

## 11. Criterios de aceptación

La iniciativa **no está terminada** hasta que las diecisiete se cumplen:

1. Una actividad puede no tener calificación.
2. Puede usar calificación directa.
3. Puede usar rúbrica.
4. Rúbrica y Partes se relacionan por ids estables.
5. La docente guarda la evaluación como borrador.
6. El estudiante no ve borradores.
7. La docente publica.
8. El estudiante ve calificación y retroalimentación publicadas.
9. La evaluación referencia la entrega congelada.
10. Modificar el trabajo vivo no cambia lo evaluado.
11. La reentrega tiene semántica explícita (D8).
12. Las actividades legacy siguen funcionando.
13. Los permisos están probados.
14. La concurrencia está protegida.
15. El responsive móvil funciona.
16. Los E2E reales están verdes.
17. La documentación explica el modelo.
