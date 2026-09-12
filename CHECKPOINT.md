# Checkpoint

> **Empieza aquí.** Este encabezado es el estado actual del proyecto; todo lo
> que va debajo es el historial de cada iteración, en orden, y se conserva.

## Estado — roadmap Nextudio cerrado · iniciativa activa (2026-09-12)

```
Roadmap Nextudio 0–6:   CERRADO
Iniciativa activa:      Calificación y Rúbricas → docs/GRADING-ROADMAP.md
```

Las ocho fases de la evolución `UINexus → Nextudio` están completas. El
producto es estable: la suite entera pasa, el build compila, y los recorridos de
docente y estudiante se recorren de punta a punta con sesión real.

**No hay una Fase 7 y no la habrá.** Lo que hay es una iniciativa nueva e
independiente —**Calificación y Rúbricas**, en `docs/GRADING-ROADMAP.md`— con su
propio alcance y sus propias unidades (G0…G6). Si se abandona a mitad, el
producto anterior sigue siendo exactamente lo que era. Las demás líneas futuras
posibles siguen listadas, sin compromiso, en `docs/NEXTUDIO-ROADMAP.md` §10.

### Qué es Nextudio hoy

Un espacio académico donde una actividad se plantea, se hace y se entrega sin
salir de la plataforma: el profesorado la crea por **Partes** con intenciones
humanas, el alumnado la resuelve en **NexCode** (un archivo con Monaco),
**NexLab** (un documento por bloques con hojas, código y resultados) o **NexIA**
(el registro de cómo usó una IA), y entrega una copia congelada de su trabajo.

Firebase sólo dice quién eres. Los datos viven en DynamoDB, los archivos en S3 y
los proyectos publicados se sirven desde un origen aislado.

### Validación en el árbol actual

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   46 archivos · 982 passed | 1 skipped (983)
npm run test:integration ✅   17 archivos · 237 passed
npm run build            ✅
npm run test:e2e         ✅   21 recorridos con sesión real
npm run test:e2e:prod    ✅   5 sobre la compilación de producción
```

La única prueba omitida es deliberada y mutuamente excluyente con otra: en
`tests/unit/code-engines.test.ts`, «sin ruedas publicadas, el fallo se EXPLICA»
sólo corre cuando NO están las ruedas de Python; cuando están —lo normal— corren
las cuatro que las usan.

Accesibilidad: **cero incidencias de axe** (WCAG 2.1 A/AA) en las diez pantallas
principales. Responsive: ningún desbordamiento horizontal en ocho anchos, de
1440 px a 360 px.

### Cómo levantarlo

```bash
npm install
npm run dev:local     # el producto entero, con identidad y datos locales
```

Docente `docente.sandbox@itdurango.edu.mx`, estudiante
`20250001@itdurango.edu.mx`, contraseña `sandbox-local`. Necesita Java 17+.
Todo lo demás, en `docs/LOCAL-DEVELOPMENT.md`.

### Arquitectura, en cinco líneas

- **El motor académico no cambió en toda la evolución.** `Workflow`,
  `WorkflowStep`, `StepDeliverable`, `dependsOnStepIds` y `assignedTo` son los de
  la iteración 4. Lo que se añadió fueron capas de traducción puras:
  `lib/activity-builder.ts` y `lib/student-activity.ts`.
- **Una actividad antigua se LEE como un proceso de un paso**
  (`synthesizeLegacyStep`), nunca se migra.
- **Una actividad `type: 'workflow'` puede tener UNA sola Parte.** Nada puede
  decidir contando partes; la señal es el tipo. Ese error costó tres fallos en
  tres capas distintas.
- **La entrega congela una copia.** Seguir trabajando después no cambia lo que se
  califica.
- **Los runtimes se cargan sólo cuando se usan.** Ninguna ruta carga Monaco,
  Pyodide, webR ni los parsers de inicio.

### Riesgos: todos clasificados

Ninguno queda «abierto» a secas. La tabla completa —CERRADO / ACEPTADO /
POST-ROADMAP, con su razón— está en `docs/NEXTUDIO-ROADMAP.md` §7. Lo que queda
vivo:

| | |
|---|---|
| **POST-ROADMAP** | R14 (imágenes del snapshot para el profesorado) |
| **ACEPTADO** | R7 · R15 · R16 (referencias literales) · R17 · R20 · R21 · R23 · R25 (dependencias) · R26 (barra a 360 px) |

### Limitaciones aceptadas que conviene saber antes de tocar nada

- **No hay S3 en el sandbox local**: subir imágenes a un NexBook falla ahí.
- **`npm run test:e2e:prod` no cubre el aula**: un build de producción no puede
  hablar con DynamoDB Local, porque `NODE_ENV` es una constante de compilación y
  la guarda del endpoint queda inlineada. Debilitarla sería cambiar una garantía
  de seguridad por una prueba.
- **Borrar la nota de una Parte sin entrega la devuelve a «Sin empezar»**: la
  marca «Ya la hice» vive en `note`, que es el campo que ya contaba.
- **21 vulnerabilidades de `npm audit`**, todas con corrección sólo por salto
  mayor y sin vía alcanzable desde producción.

Razonadas una a una en `docs/LIMITATIONS.md` §14.

### La decisión que ya se tomó

El roadmap terminó, y de las líneas posibles se eligió **una**: cerrar el ciclo
académico con calificación y rúbricas. Está diseñada en
`docs/GRADING-ROADMAP.md`, en unidades G0…G6, con su propio criterio de
terminación.

Las demás —panel docente completo, `RemoteRunner`, una CSP propia, S3 local, las
actualizaciones mayores— siguen sin empezar y sin comprometer, en
`docs/NEXTUDIO-ROADMAP.md` §10.

Dos riesgos preexistentes que la auditoría de esa iniciativa sacó a la luz y que
conviene conocer antes de tocar entregas: **RG-1**, el item de una entrega puede
pasar de los 400 KB de DynamoDB si lleva varias Partes de laboratorio llenas; y
**RG-2**, `reviewSubmission` no tiene concurrencia optimista, así que dos
docentes revisando la misma entrega se pisan. Razonados en
`docs/GRADING-ROADMAP.md` §14.

---

## Historial

- [x] F0.1 · Redirect post-login → `/` — ÉXITO
- [x] F0.2 · Miniaturas compactas — ÉXITO
- [x] F0.3 · Overflow móvil de pestañas — ÉXITO
- [x] F1.1 · Separar layout — ÉXITO
- [x] F1.2 · Separar feed — ÉXITO
- [x] F1.3 · Separar tarjeta — ÉXITO
- [x] F1.4 · Separar atención/filtros — ÉXITO
- [x] F1.5 · Validar refactor sin regresiones — ÉXITO
- [x] F2.1 · FeedCard compacta definitiva — ÉXITO
- [x] F2.2 · Metadata y jerarquía — ÉXITO
- [x] F2.3 · Acciones/navegación coherentes — ÉXITO
- [x] F3.1 · Layout desktop — ÉXITO
- [x] F3.2 · Carril de contexto — ÉXITO
- [x] F3.3 · Tablet — ÉXITO
- [x] F3.4 · Móvil — ÉXITO
- [x] F3.5 · Carril derecho sólo si se justifica — ÉXITO
- [x] F4.1 · Unificar feed — ÉXITO
- [x] F4.2 · Filtros por materia — ÉXITO
- [x] F4.3 · Estado de filtros en URL — ÉXITO
- [x] F4.4 · Separador última visita — ÉXITO
- [x] F4.5 · Final/cargar más — ÉXITO
- [x] F5.1 · URL de publicación — ÉXITO
- [x] F5.2 · Navegación/modal — ÉXITO
- [x] F5.3 · Autorización y privacidad — ÉXITO
- [x] F5.4 · Deep links — ÉXITO
- [x] F6.1 · Loading — ÉXITO
- [x] F6.2 · Empty — ÉXITO
- [x] F6.3 · Error — ÉXITO
- [ ] F6.4 · Responsive QA — NO COMPLETADA
- [ ] F6.5 · Tema claro/oscuro — NO COMPLETADA
- [x] F6.6 · Tests finales — ÉXITO
- [x] F6.7 · Build final — ÉXITO

## Iteración — Identidad, materiales y proceso de materia (2026-09-09)

- [x] P0.1 · Sesión restaurada valida el correo institucional antes del perfil — ÉXITO
- [x] P0.2 · `requireIdentity` aplica la política en TODAS las rutas — ÉXITO
- [x] P0.3 · Aviso de cuenta no autorizada en `/login`, sin bucle — ÉXITO
- [x] P0.4 · Acceso por teléfono retirado — ÉXITO
- [x] P0.5 · `AssignmentMaterial`: modelo, ruta propia y prefijo propio en S3 — ÉXITO
- [x] P0.6 · Subida en dos tiempos (firmar → subir → registrar) — ÉXITO
- [x] P0.7 · Materiales visibles y descargables por el alumnado — ÉXITO
- [x] P0.8 · Entrega de documento con arrastre, aviso previo y archivo visible — ÉXITO
- [x] P1.1 · Cinco plantillas de Investigación de Operaciones — ÉXITO
- [x] P1.2 · Galería de plantillas en el constructor, con vista previa — ÉXITO
- [x] P1.3 · Estado vacío del profesorado sin grupos propios — ÉXITO
- [x] P2.1 · Entregable de código con lenguaje (R habilitado) — ÉXITO
- [x] P2.2 · Revisión del código sin descargar — ÉXITO
- [x] P2.3 · Interfaz de ejecutor externo documentada — ÉXITO (sin conectar, a propósito)
- [x] V.1 · typecheck · lint · 467 unitarias · 92 de integración · build — ÉXITO
- [ ] V.2 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — Monaco Editor + ejecución de R y Python (2026-09-10)

- [x] E1 · `CodeEditor` único por lenguaje, con respaldo accesible a textarea — ÉXITO
- [x] E2 · Monaco desde el paquete instalado, sin CDN — ÉXITO
- [x] E3 · `browser-code-runner`: reloj, terminación y estados — ÉXITO
- [x] E4 · Python con Pyodide en Web Worker — ÉXITO (probado ejecutando de verdad)
- [x] E5 · R con webR en Web Worker — ÉXITO (verificado en navegador)
- [x] E6 · Tiempo límite, Detener y reejecución tras un corte — ÉXITO
- [x] E7 · Autoguardado por paso, y guardado antes de ejecutar/entregar — ÉXITO
- [x] E8 · Modalidades editor / upload / either, legacy intacto — ÉXITO
- [x] E9 · Código inicial de la docente y «Restablecer» — ÉXITO
- [x] E10 · Configuración del paso de código en el constructor — ÉXITO
- [x] E11 · Vista docente readOnly y ejecutable, sin mutar la entrega — ÉXITO
- [x] E12 · Red y paquetes bloqueados en los dos runtimes — ÉXITO
- [x] E13 · Publicación de runtimes y Workers fuera de git — ÉXITO
- [x] E14 · 83 pruebas nuevas (79 unitarias + 4 de integración) — ÉXITO
- [x] V.1 · typecheck · lint · 550 unitarias · 98 de integración · build — ÉXITO
- [ ] V.2 · CSP de la plataforma — NO COMPLETADA (auditada: la ejecución no exige
      relajar nada; escribirla entera excede este sprint. Ver docs/SECURITY.md)
- [ ] V.3 · Ejecución real de R en la suite — NO COMPLETADA (webR no arranca bajo
      Node en Windows; necesita Playwright. Ver docs/LIMITATIONS.md)
- [ ] V.4 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita
      Firebase y AWS)

## Iteración — Reposicionamiento y workspace académico (2026-09-10)

- [x] R1 · `LanguageCapabilities`: editar y ejecutar dejan de ser un booleano — ÉXITO
- [x] R2 · Java, C, C++, HTML y CSS editables con resaltado propio — ÉXITO
- [x] R3 · «Ejecución no disponible» con motivo y sin botón fantasma — ÉXITO
- [x] R4 · `LEGACY_CODE_LANGUAGE`: el default nuevo no reinterpreta lo guardado — ÉXITO
- [x] R5 · Landing reposicionado, tabla de lenguajes generada del catálogo — ÉXITO
- [x] R6 · README, `SITE`, `/about` y navegación — ÉXITO
- [x] R7 · Modelo `Workspace` con `files` opcional — ÉXITO
- [x] R8 · Tabla `uinexus-workspaces`, índice `byOwner`, CFN y script — ÉXITO
- [x] R9 · API de prácticas, privacidad en tres capas — ÉXITO
- [x] R10 · `/practicas` y `/practicas/:id` con autoguardado — ÉXITO
- [x] R11 · 37 pruebas nuevas — ÉXITO
- [x] V.1 · typecheck · lint · 575 unitarias · 114 de integración · build — ÉXITO
- [ ] V.2 · `RemoteRunner` para Java, C y frameworks — NO COMPLETADA (contrato listo,
      proveedor sin decidir. Ver docs/ARCHITECTURE.md §14)
- [ ] V.3 · Multi-archivo en el editor — NO COMPLETADA (modelo listo, UI no)
- [ ] V.4 · CSP de la plataforma — NO COMPLETADA (sin cambios respecto a la anterior)
- [ ] V.5 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — NexBook y UINexus Studio (2026-09-10)

- [x] N1 · Modelo `NexBook`: bloques, outputs, contexto, visibilidad, revisión — ÉXITO
- [x] N2 · Límites en `NEXBOOK_LIMITS`, presupuesto medido sobre el JSON real — ÉXITO
- [x] N3 · CRUD con ownership en tres capas y 404 indistinguible — ÉXITO
- [x] N4 · Concurrencia optimista con 409 que devuelve el documento actual — ÉXITO
- [x] N5 · UINexus Studio: bloques, orden, añadir/eliminar, foco tras insertar — ÉXITO
- [x] N6 · MarkdownBlock con el renderer sanitizado existente — ÉXITO
- [x] N7 · CodeBlock sobre Monaco, lenguaje por bloque — ÉXITO
- [x] N8 · `NotebookKernel`: sesión, restart, interrupt, estado por lenguaje — ÉXITO
- [x] N9 · Python conserva estado entre celdas — ÉXITO (verificado en navegador)
- [x] N10 · R con sesión y aislamiento simétrico — ÉXITO
- [x] N11 · Autoguardado con estados que nunca ocultan un error — ÉXITO
- [x] N12 · Laboratorios personales en `/practicas`, lista unificada — ÉXITO
- [x] N13 · Entregable `nexbook` en Workflow, `CodeData` intacto — ÉXITO
- [x] N14 · Plantilla docente e instancia perezosa por estudiante — ÉXITO
- [x] N15 · Snapshot de entrega y vista docente de sólo lectura — ÉXITO
- [x] N16 · 50 pruebas nuevas (32 unitarias + 18 de integración) — ÉXITO
- [x] N17 · `docs/NEXBOOK.md` — ÉXITO
- [x] V.1 · typecheck · lint · 616 unitarias · 132 de integración · build — ÉXITO
- [ ] V.2 · Import/export `.nexbook` — NO COMPLETADA (formato diseñado y versionado)
- [ ] V.3 · Publicación de NexBooks — NO COMPLETADA (sólo `private` implementado)
- [ ] V.4 · Outputs ricos y orden real de stdout/stderr — NO COMPLETADA
- [ ] V.5 · Historial de reentregas en la interfaz — NO COMPLETADA (esquema listo)
- [ ] V.6 · Project Workspace — NO COMPLETADA (previsto, no empezado)
- [ ] V.7 · `RemoteRunner` para Java y C — NO COMPLETADA (sin cambios)
- [ ] V.8 · CSP de la plataforma — NO COMPLETADA (sin cambios)
- [ ] V.9 · Recorridos con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — NexBook modular (2026-09-10)

- [x] M1 · Salidas ricas: `text`, `table`, `image`, `json` como valores de `stream` — ÉXITO
- [x] M2 · Orden REAL de stdout y stderr, sin rediseñar runtimes — ÉXITO (navegador)
- [x] M3 · Limpiar salida por celda y global — ÉXITO
- [x] M4 · Python: tablas por pato, sin exigir pandas — ÉXITO
- [x] M5 · Python: `pandas` y `matplotlib` desde el propio origen — ÉXITO (navegador)
- [x] M6 · Ruedas verificadas contra el `sha256` del lockfile — ÉXITO
- [x] M7 · R: `plot()` capturado como PNG vía `OffscreenCanvas` — ÉXITO (navegador)
- [x] M8 · R: `data.frame` como tabla estructurada — ÉXITO (navegador)
- [x] M9 · Assets en S3, clave por persona, sin tabla nueva — ÉXITO
- [x] M10 · `ImageBlock` con alt, pie, arrastrar, pegar y reemplazar — ÉXITO
- [x] M11 · `SpreadsheetBlock` con motor de fórmulas propio — ÉXITO
- [x] M12 · `SpreadsheetBridge` desacoplado de los kernels — ÉXITO (sin conectar)
- [x] M13 · Publicar como SNAPSHOT, con actualización explícita — ÉXITO
- [x] M14 · Vista pública sin runtimes (167 kB frente a 232 kB) — ÉXITO
- [x] M15 · Exportar `.nexbook` con assets y referencias reescritas — ÉXITO
- [x] M16 · Importar `.nexbook` con defensas contra zip slip y bomb — ÉXITO
- [x] M17 · Lista BLANCA de exportación, con pruebas de secretos — ÉXITO
- [x] M18 · «Copiar a mis prácticas» separa evidencia de portafolio — ÉXITO
- [x] M19 · Barra de Studio: + Bloque, Ejecutar todo, Reiniciar kernels — ÉXITO
- [x] M20 · Aviso de tamaño al 80 % del presupuesto — ÉXITO
- [x] M21 · 112 pruebas nuevas (82 unitarias + 30 de integración) — ÉXITO
- [x] V.1 · typecheck · lint · 698 unitarias · 162 de integración · build — ÉXITO
- [ ] V.2 · `AIBlock` — NO COMPLETADA (diseñado y documentado, no declarado)
- [ ] V.3 · `ChartBlock` — NO COMPLETADA (una gráfica se guarda como imagen)
- [ ] V.4 · Puente hoja ↔ Python/R — NO COMPLETADA (abstracción lista, sin conectar)
- [ ] V.5 · Playwright — NO COMPLETADA (sin entorno de autenticación controlado)
- [ ] V.6 · Recolección de assets huérfanos — NO COMPLETADA
- [ ] V.7 · Historial de publicaciones — NO COMPLETADA (actualizar sobrescribe)
- [ ] V.8 · Import/export `.ipynb`, `.qmd`, PDF — NO COMPLETADA
- [ ] V.9 · Project Workspace — NO COMPLETADA (previsto, no empezado)
- [ ] V.10 · `RemoteRunner` para Java y C — NO COMPLETADA (sin cambios)
- [ ] V.11 · CSP de la plataforma — NO COMPLETADA (sin cambios)
- [ ] V.12 · Recorridos con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — Nextudio · Fase 0 (auditoría y hoja de ruta) — 2026-09-11

### Estado

- [x] F0.1 · Rama, HEAD y árbol de trabajo comprobados (`codex/monaco-r-python-runtime`,
      `db547e2`, limpio) — ÉXITO
- [x] F0.2 · `CHECKPOINT.md`, `CHECKPOINTS.md`, `docs/NEXBOOK.md`,
      `docs/ARCHITECTURE.md`, `docs/SECURITY.md` y `docs/LIMITATIONS.md` leídos — ÉXITO
- [x] F0.3 · Implementación real revisada: NexBook, Studio, Workspace, Workflow,
      WorkflowBuilder, WorkflowRunner, AI Worklog, publicaciones, recursos,
      materiales, navegación, landing, listados, Monaco, runners, persistencia,
      S3, DynamoDB y autorización — ÉXITO
- [x] F0.4 · Suite base ejecutada ANTES de tocar nada — ÉXITO
- [x] F0.5 · `docs/NEXTUDIO-ROADMAP.md` con auditoría, decisiones, fases,
      dependencias, riesgos, compatibilidad, plan de pruebas y checkpoints — ÉXITO
- [x] F0.6 · Informe al usuario antes de implementar — ÉXITO
- [ ] F1 · Marca Nextudio + shell — NO EMPEZADA (a propósito: Fase 0 no implementa)

### Decisiones

Las diez decisiones están razonadas en `docs/NEXTUDIO-ROADMAP.md` §2. En corto:

- **D1** La marca visible pasa a `Nextudio`, escritura normal siempre. `SITE`
  deja de ser sólo metadata y pasa a ser la fuente única de la marca.
- **D2** NO se renombran repositorio, historial, tablas `uinexus-*`, buckets,
  prefijos de S3, variables `UINEXUS_*`, proyectos de Firebase, rutas públicas,
  la clave `uinexus-home-visit` ni el handle reservado `'uinexus'`. Regla
  operativa: sustituir sólo `UINexus` con capitalización exacta en copy.
- **D3** NexLab, NexCode y NexIA son EXPERIENCIAS. `NexBook` no se renombra.
  «UINexus Studio» desaparece como nombre visible y pasa a ser **NexLab**.
- **D4** `Prácticas` → `Espacios` conservando la ruta `/practicas`. No se crean
  `/recursos` ni `/publicaciones`: ese problema lo resuelve la búsqueda global.
- **D5** `NexBookAIWorklogBlock` **anida** `AIWorklogData` en vez de aplanarlo, de
  forma que el entregable legacy y el bloque lleven el mismo objeto.
  `conclusionMode` se aplica sobre `studentAnalysis`; `resourcesUsed` ya existe.
  `NEXBOOK_FORMAT_VERSION` sigue en 1. El bloque no se declara hasta estar completo.
- **D6** NexIA no ejecuta IA y la interfaz lo dice.
- **D7** El creador docente se rediseña sobre el MISMO modelo: «Paso» → «Parte» en
  copy, 7 opciones humanas en lugar de 12 entregables técnicos, `shape` derivado
  en vez de preguntado, plantilla de NexLab editable desde el constructor.
- **D8** Búsqueda en dos niveles, sin tabla ni GSI nuevos en el primer corte.
  Autorización reutilizada, nada privado ajeno al navegador, `Ctrl/Cmd + K` que
  no interfiere con los acordes de Monaco.
- **D9** Entregar y publicar siguen siendo actos distintos. Sin cambios.
- **D10** Nada nuevo se carga por visitar Nextudio.

### Validación (suite BASE, antes de cualquier cambio)

- typecheck: ✅ exit 0
- lint: ✅ exit 0, sin avisos
- test: ✅ 37 archivos · **698 pasadas**, 1 omitida (699) · 30.7 s
- integration: ✅ 13 archivos · **162 pasadas** · 39.2 s (DynamoDB Local, Java 21)
- build: ✅ exit 0 · shared 104 kB · `/nexbook/[slug]` 167 kB ·
  `/practicas/nexbook/[id]` 232 kB (sin cambios respecto a la iteración anterior)

### Navegador

Nada. Fase 0 no modifica producto, así que no hay nada que comprobar en el
navegador. Los recorridos autenticados siguen sin entorno controlado
(ver `docs/LIMITATIONS.md`).

### Riesgos

Los nueve están en `docs/NEXTUDIO-ROADMAP.md` §7. Los tres que más pesan:

- **R1** Un reemplazo global de `uinexus` rompería tablas, buckets o variables de
  entorno. Mitigación: sólo `UINexus` con capitalización exacta, más una prueba
  que fija `TABLES`, `INDEXES` y los prefijos de S3.
- **R3** Ofrecer NexIA en el lanzador antes de la Fase 3 sería un botón falso. En
  Fase 1 aparece deshabilitado con motivo escrito, o no aparece.
- **R4** Declarar `ai_worklog` en la unión sin renderizador produciría documentos
  que nadie puede abrir. Se declara e implementa en la MISMA fase.

### Próximo punto exacto

**Fase 1 — Marca Nextudio + shell.** Empezar por `src/lib/constants.ts`
(`SITE`, línea 134) y `src/components/ui/logo.tsx` (`Wordmark`, línea 35), y
desde ahí recorrer el copy visible siguiendo la lista de `docs/NEXTUDIO-ROADMAP.md`
§3 · Fase 1. NO tocar `lib/aws/*`, `lib/firebase/*`, `lib/server/*`, `infra/`,
`scripts/` ni ninguna variable de entorno. Cerrar con la prueba `branding.test.ts`
descrita en esa misma sección y con los cinco comandos de validación.

## Iteración — Nextudio · Fase 1 (marca y shell) — 2026-09-11

### Estado

- [x] F1.1 · `SITE` dice Nextudio, con tagline y descripción nuevas — ÉXITO
- [x] F1.2 · `Wordmark` con la `x` enfatizada, un solo nodo de texto — ÉXITO
- [x] F1.3 · Copy visible rebrandeado: 92 sustituciones en 53 archivos de `src/` — ÉXITO
- [x] F1.4 · «UINexus Studio» → **NexLab** como nombre visible — ÉXITO
- [x] F1.5 · «Prácticas» → **Espacios**, conservando la ruta `/practicas` — ÉXITO
- [x] F1.6 · Lanzador con dos puertas: «+ Nuevo NexLab» y «+ Nuevo NexCode» — ÉXITO
- [x] F1.7 · Landing reescrito por formas de trabajar, sin prometer nada falso — ÉXITO
- [x] F1.8 · `README.md`, `docs/ARCHITECTURE.md` §0 y `docs/` rebrandeados — ÉXITO
- [x] F1.9 · `nextudio`, `nexlab` y `nexcode` reservados sin quitar `uinexus` — ÉXITO
- [x] F1.10 · `tests/unit/branding.test.ts`: 9 pruebas nuevas — ÉXITO
- [x] V.1 · typecheck · lint · 707 unitarias · 162 de integración · build — ÉXITO
- [x] V.2 · Superficies PÚBLICAS comprobadas en navegador (escritorio y móvil) — ÉXITO
- [ ] V.3 · Recorridos AUTENTICADOS en navegador — NO COMPLETADA (necesita una
      cuenta institucional real de Firebase; ver «Navegador»)
- [ ] F2 · Organización y descubrimiento — NO EMPEZADA

### Decisiones

- **Ajuste A1 aprobado: NexIA no aparece en el lanzador**, ni siquiera apagada.
  Se menciona en el landing en prosa, sin control detrás. Un botón deshabilitado
  sigue ocupando sitio y prometiendo una fecha que nadie ha dado. Cierra el R3
  del roadmap.
- **Ajuste A2 aprobado: `SITE` es la fuente canónica del NOMBRE, no un sistema
  de plantillas.** Alimenta metadata y superficies centrales; el copy normal
  escribe «Nextudio» tal cual. No se construyó ningún pseudo-i18n alrededor de la
  constante, y se retiró un `PRODUCT_NAME` que iba justo por ese camino.
- **Ajuste A3 aprobado: el énfasis del wordmark va en la `x`**, con peso y color.
  Comprobado en el navegador: `textContent` del enlace = `Nextudio`, nombre
  accesible = `Nextudio, ir al inicio`. `NeXtudio` no existe como forma escrita.
- **Se descubrió un identificador persistido más de los que listaba la Fase 0:**
  `NEXBOOK_ARCHIVE_FORMAT = 'uinexus-nexbook'`, que viaja dentro de cada archivo
  exportado y que el importador compara. **No se tocó**, y ahora lo fija una
  prueba. Lo que sí cambió es `createdWith` del manifiesto —texto humano que el
  importador no valida—, así que un `.nexbook` anterior sigue abriéndose.
- **`nexia` NO se reservó todavía como handle.** `RESERVED_HANDLES` lo comprueba
  también el esquema del perfil: reservar retroactivamente una palabra que
  alguien pudiera tener dejaría a esa persona sin poder guardar su perfil.
  «Nexia» es un nombre plausible; los otros tres no. Se reserva en la Fase 3.
- **Dos mentiras de `/about` corregidas de paso**, porque eran falsas y estaban
  a la vista: nombraba el dominio `uinexus-projects.web.app` escrito a mano
  —el origen aislado real sale de `NEXT_PUBLIC_PROJECTS_ORIGIN` y en este
  despliegue es un dominio de CloudFront—, y decía que la autorización la
  deciden «las reglas de Firestore y de Storage», que desaparecieron con la
  migración a AWS.
- **`CHECKPOINT.md` y `CHECKPOINTS.md` NO se rebrandearon.** Son historial:
  decían la verdad cuando se escribieron, y reescribirlos sería falsificar el
  registro. Tampoco se tocaron `infra/`, `scripts/`, `functions/` ni `legacy/`.

### Validación

- typecheck: ✅ exit 0
- lint: ✅ exit 0, sin avisos
- test: ✅ 38 archivos · **707 pasadas**, 1 omitida (708) — 9 nuevas
- integration: ✅ 13 archivos · **162 pasadas** — sin cambios
- build: ✅ exit 0. Tamaños **sin regresión**: shared 104 kB (igual),
  `/nexbook/[slug]` 167 kB (igual), `/practicas/nexbook/[id]` 232 kB (igual),
  `/practicas` 2.74 → 2.80 kB (+60 B: el copy del lanzador)

### Navegador

Comprobado de verdad, con el servidor de desarrollo (Next 15.5.25):

- **`/` (landing)** — 1280×900 claro y oscuro, 390×844 y 375×812. Hero, «Un
  espacio para cada forma de trabajar» (NexCode / NexLab), lenguajes, «Trabajo
  reproducible», «Del aula al portafolio», materias y pie. Sin desbordamiento
  horizontal (`scrollWidth === clientWidth` en 390 y en 375). Consola sin errores.
- **Wordmark** — `textContent` = `Nextudio`, `aria-label` = `Nextudio, ir al
  inicio`, el `<span>` de la `x` es `display: inline`. La `x` se lee en acento.
- **`<title>`** — `Nextudio · Aprende construyendo.`, `Acerca de Nextudio ·
  Nextudio`, `Mis espacios · Nextudio`, `Iniciar sesión · Nextudio`.
- **`/about`** — copia nueva, etimología corregida, host del origen aislado
  leído de la configuración.
- **`/login`** — «Entra a Nextudio».
- **`/practicas`** en 375×812 — `<h1>` «Mis espacios», «+ Nuevo NexLab»,
  «+ Nuevo NexCode», «Importar .nexbook», pie nuevo. La lista muestra
  «Necesitas iniciar sesión» porque no hay sesión.
- **Menú móvil** — abre y cierra, enlaces y selector de tema correctos.

**Lo que NO se pudo comprobar en el navegador:** todo lo que hay detrás de la
sesión —la etiqueta «Espacios» de la barra autenticada, la lista real de
espacios, NexLab y NexCode abiertos, «Abrir en NexLab» y «Copiar a mis
espacios»—. Esta instalación apunta a Firebase y AWS reales y no hay ninguna
cuenta institucional disponible aquí. Esas superficies quedan cubiertas por las
707 unitarias y las 162 de integración, y por el marcado y el `<title>` de
`/practicas`, que sí se renderizan sin sesión. Es la misma limitación declarada
en todas las iteraciones anteriores (`docs/LIMITATIONS.md`).

### Riesgos

- **R1 mitigado y probado.** La sustitución fue con capitalización EXACTA
  (`UINexus` → `Nextudio`) mediante un script que aborta si cambia el número de
  apariciones de `uinexus` o `UINEXUS`. `branding.test.ts` fija las once tablas,
  los índices, el formato `.nexbook`, cinco variables de entorno y los tres
  prefijos de S3.
- **R3 y R8 cerrados** (ver roadmap §7).
- **R10 nuevo:** `next build` y `next dev` comparten `.next` y se pisan. Costó
  un build fallido con `PageNotFoundError`; se resolvió parando la vista previa
  y borrando `.next`. Queda anotado para no volver a diagnosticarlo.
- **Inconsistencia asumida:** `infra/`, `scripts/`, `functions/` y `legacy/`
  siguen escribiendo «UINexus» en sus comentarios. Son código de despliegue y
  restos, no superficie de producto; tocarlos sólo añadiría riesgo.
- **Vocabulario interno sin migrar:** los comentarios de `data/workspaces.ts`,
  `api/workspaces/*` y `types.ts` siguen diciendo «práctica». El tipo se llama
  `Workspace` y el mapeo a NexCode está documentado en `practice-list.tsx` y en
  el roadmap; renombrar prosa interna era churn sin beneficio.

### Próximo punto exacto

**Fase 2 — Organización y descubrimiento.** Empezar por
`src/components/workspace/practice-list.tsx`: la pantalla ya se llama «Mis
espacios» y `describe()` ya etiqueta cada fila como `NexLab · N bloques` o
`NexCode · Python`, así que lo que falta es (1) la barra de filtros **Todos /
NexLab / NexCode / Recientes** encima de la lista, con el estado en la URL igual
que en `/explore` y en el muro, filtrando sobre `WorkspaceSummary` —que ya trae
`kind` y `updatedAt`, sin pedir nada nuevo al servidor—; y (2) la búsqueda
global de `docs/NEXTUDIO-ROADMAP.md` §D8, en dos niveles y sin tabla ni GSI
nuevos, con `Ctrl/Cmd + K` guardado contra los acordes de Monaco. El campo de
búsqueda de `navbar.tsx` (`onSearch`) deja entonces de ir sólo a `/explore`.

## Iteración — Nextudio · Fase 2 (organización y descubrimiento) — 2026-09-11

### Estado

- [x] F2.1 · Filtros Todos / NexLab / NexCode / Recientes, con recuento — ÉXITO
- [x] F2.2 · Estado del filtro en la URL (`?tipo=`), con `replaceState` — ÉXITO
- [x] F2.3 · Vacío explicado cuando el filtro no deja nada, con «Ver todos» — ÉXITO
- [x] F2.4 · Cada fila dice qué es, cuándo se guardó y que es **privada** — ÉXITO
- [x] F2.5 · `lib/search.ts`: modelo y criterio de coincidencia, compartido — ÉXITO
- [x] F2.6 · `GET /api/search`: nivel 2, sin tabla ni GSI nuevos — ÉXITO
- [x] F2.7 · Paleta con `Ctrl/Cmd + K`, dos secciones y teclado — ÉXITO
- [x] F2.8 · `Ctrl+K` no se roba el acorde de Monaco — ÉXITO
- [x] F2.9 · La barra autenticada abre la paleta; la anónima sigue en `/explore` — ÉXITO
- [x] F2.10 · `resourceVisibleTo` extraído: una sola regla de visibilidad — ÉXITO
- [x] F2.11 · 26 pruebas nuevas (14 unitarias + 12 de integración) — ÉXITO
- [x] V.1 · typecheck · lint · 721 unitarias · 174 de integración · build — ÉXITO
- [x] V.2 · Superficies públicas y comportamiento anónimo en navegador — ÉXITO
- [ ] V.3 · Recorrido AUTENTICADO de la paleta — NO COMPLETADA (ver «Navegador»)
- [ ] F3 · NexIA integrado — NO EMPEZADA

### Decisiones

- **Los dos niveles de la búsqueda cubren fuentes DISJUNTAS.** El navegador
  busca en los espacios propios —que ya tiene en memoria para pintar
  `/practicas`— y `/api/search` busca en lo repartido: actividades, materiales,
  prompts, Skills, recursos y proyectos propios. Si la ruta devolviera también
  los espacios, cada NexLab saldría **dos veces** en la paleta. Lo fija una
  prueba de integración, no un comentario.
- **En la ruta de búsqueda no hay ni una comprobación de permisos escrita a
  mano.** Cada fuente se filtra con la misma función que ya decide quién la ve
  en su pantalla: `listCoursesForUser`, `isAssignedTo`, `resourceVisibleTo` y
  `listProjectsByOwner`, cuya firma ni siquiera admite pedir los de otro. Una
  búsqueda que decidiera por su cuenta sería un segundo sistema de permisos, y
  el segundo es siempre el que se queda atrás.
- **`resourceVisibleTo` salió de la ruta de la biblioteca a
  `lib/server/resource-visibility.ts`.** No fue limpieza: copiar la regla habría
  creado dos, y la que se olvida de actualizar es la que enseña de más.
- **La eñe se protege al normalizar.** NFD parte `ñ` en `n` + tilde combinante,
  así que el filtro de acentos la habría aplanado y «año» sería «ano». Se aparta
  antes de descomponer y se devuelve después. La diéresis sí se quita, porque
  ahí ninguna palabra se convierte en otra.
- **`Ctrl+K` se cede dentro de Monaco.** Ahí es prefijo de acorde
  (`Ctrl+K Ctrl+C` comenta). La comprobación es estructural —¿el foco está en un
  `.monaco-editor`?— y no una lista de rutas «donde hay editor», que envejecería.
- **Los filtros no piden nada al servidor.** `WorkspaceSummary` ya trae `kind` y
  `updatedAt` y son doscientos como mucho. «Recientes» es un CORTE de siete
  días, no un orden: la lista ya llega con lo último tocado primero.
- **Sin favoritos.** Con recientes, filtros y búsqueda no hay todavía evidencia
  de que hagan falta, y añaden una ruta de escritura y un campo.

### Validación

- typecheck: ✅ exit 0
- lint: ✅ exit 0, sin avisos
- test: ✅ 39 archivos · **721 pasadas**, 1 omitida (722) — 14 nuevas
- integration: ✅ 14 archivos · **174 pasadas** — 12 nuevas
- build: ✅ exit 0

### Navegador

Comprobado con el servidor de desarrollo:

- **`/` y `/login`** en 1280×900 (oscuro) — sin errores de consola en pestaña
  limpia. Los 500 que aparecieron al arrancar en frío eran compilación del
  servidor de desarrollo: una navegación posterior devuelve 200 y
  `preview_logs --level error` no registra nada.
- **La barra anónima conserva su formulario** hacia `/explore`
  (`header form[role=search]` presente, botón de paleta ausente). Es la
  comprobación de que la paleta no se ofrece a quien no puede usarla.
- **`Ctrl+K` sin sesión no hace nada**: no aparece ningún `[role=dialog]`. El
  manejador está condicionado a la sesión, y se verificó que de verdad lo está.
- **`/practicas`** en 1280×900 (oscuro) y 390×844 (claro) — `<h1>` «Mis
  espacios», las dos puertas, «Importar .nexbook», sin desbordamiento
  horizontal (`scrollWidth === clientWidth`).

**Lo que NO se pudo comprobar (R11):** la paleta con resultados de verdad —las
dos secciones, la navegación con flechas, Enter, el recorte por clase— y los
filtros de Espacios con lista poblada. Todo eso vive detrás de la sesión, y esta
instalación apunta a Firebase y AWS reales sin una cuenta institucional
disponible aquí. Queda cubierto por 26 pruebas nuevas: 14 unitarias del criterio
de coincidencia y 12 de integración que ejercitan la ruta real contra DynamoDB
Local, incluidas las de «esto nunca debe aparecer».

### Riesgos

- **R11 (nuevo):** la paleta entera está detrás de la sesión y no se recorrió a
  mano. Es la deuda más clara de esta fase; un entorno de autenticación
  controlado la cerraría de una vez para todas las iteraciones anteriores.
- **R12 (nuevo):** el arnés de integración no reproducía el índice `byOwner` de
  la tabla de proyectos, que en producción sí existe. Se descubrió porque
  `listProjectsByOwner` reventó con «the table does not have the specified
  index» y se arregló **en el arnés**, no esquivándolo desde la ruta. Conviene
  cotejar el resto de índices de `infra/uinexus.cfn.yaml` con
  `tests/integration/helpers/dynamodb.ts` la próxima vez que una ruta nueva
  consulte una tabla que la suite no tocaba.
- **Techo de coste conocido:** el nivel 2 cuesta un `Scan` de materias —el mismo
  que ya hace `/aula`— más dos a cuatro consultas por materia, con tope de 12
  materias. Con seis son unas veinte consultas por búsqueda, y por eso hay
  *debounce* de 250 ms y mínimo de dos caracteres. El umbral para una proyección
  de metadatos está en `docs/NEXTUDIO-ROADMAP.md` §D8.
- `nexia` sigue **sin reservar** como handle, a propósito: se reserva en la Fase
  3 tras comprobar que no lo tiene nadie (ver la sección de la Fase 1).

### Próximo punto exacto

**Fase 3 — NexIA integrado.** Empezar declarando `NexBookAIWorklogBlock` en
`src/lib/types.ts` junto a los otros cuatro miembros de `NexBookBlock`, con la
forma de `docs/NEXTUDIO-ROADMAP.md` §D5: **anidando** `AIWorklogData` en un
campo `worklog` en lugar de aplanar sus once campos, para que el entregable
legacy y el bloque lleven literalmente el mismo objeto y `normalizeAIResult()` y
`aiWorklogToMarkdown()` sigan sirviendo sin tocarlas. Y la regla que no se
negocia: **el bloque no se declara hasta que la misma fase traiga** esquema Zod,
editor, renderizador de sólo lectura, persistencia, snapshot de entrega,
export/import y su entrada en la lista **blanca** de `publishableDocument` con
prueba de que no salen `resourcesUsed` ni ningún secreto. `NEXBOOK_FORMAT_VERSION`
se queda en 1. El preset NexIA —un NexBook sembrado con un bloque de
instrucciones y uno de AI Worklog— es lo último, y sólo entonces aparece en el
lanzador de Espacios.

## Iteración — Nextudio · Fase 3 (NexIA integrado) — 2026-09-11

### Estado

- [x] R12 · Arnés de integración cotejado contra `infra/uinexus.cfn.yaml` — ÉXITO
- [x] F3.1 · `NexBookAIWorklogBlock` en la unión, **anidando** `AIWorklogData` — ÉXITO
- [x] F3.2 · Esquema Zod (`aiWorklogBlockSchema`) reutilizando `aiWorklogDataSchema` — ÉXITO
- [x] F3.3 · Editor «Registrar uso de IA», agrupado como relato y no como formulario — ÉXITO
- [x] F3.4 · Render de sólo lectura ÚNICO: vista docente, bloque bloqueado y publicación — ÉXITO
- [x] F3.5 · Capturas por el almacén de assets existente, sin bucket ni prefijo nuevos — ÉXITO
- [x] F3.6 · `conclusionMode` sobre `studentAnalysis`, aplicado AL ENTREGAR — ÉXITO
- [x] F3.7 · La obligatoriedad manda desde la PLANTILLA, no desde el navegador — ÉXITO
- [x] F3.8 · Lista blanca de publicación/exportación, reconstruida campo a campo — ÉXITO
- [x] F3.9 · `.nexbook`: export, import y remapeo de las capturas — ÉXITO
- [x] F3.10 · Preset NexIA y tercera puerta del lanzador de Espacios — ÉXITO
- [x] F3.11 · Entregable `ai_worklog` legacy intacto, sin migración — ÉXITO
- [x] F3.12 · 50 pruebas nuevas (34 unitarias + 16 de integración) — ÉXITO
- [x] F3.13 · Fase 3.5 documentada e incorporada al roadmap — ÉXITO
- [x] F3.14 · Copy del landing corregido: NexIA deja de anunciarse como futuro — ÉXITO
- [x] V.1 · typecheck · lint · 755 unitarias · 190 de integración · build — ÉXITO
- [x] V.2 · Superficies SIN sesión comprobadas en navegador (claro, oscuro, 375 px) — ÉXITO
- [ ] V.2b · Recorrido AUTENTICADO del bloque en navegador — NO COMPLETADA (ver «Navegador»)
- [ ] V.3 · `nexia` como handle reservado — NO COMPLETADA (a propósito; ver «Decisiones»)
- [ ] V.4 · Imágenes del snapshot en la vista docente — NO COMPLETADA (R14, anterior a NexIA)
- [ ] F3.5 · NexLab Data Interop — NO EMPEZADA (documentada, a propósito sin implementar)

### Paso previo — R12

Se cotejó `tests/integration/helpers/dynamodb.ts` contra
`infra/uinexus.cfn.yaml`. **Tres divergencias reales del arnés**, corregidas en
el arnés y sólo en él:

- Faltaba la tabla `handles`, que `lib/server/writes.ts` escribe en cada registro
  de perfil.
- Faltaba la tabla `reports`.
- Faltaba el índice `projects.byPath`, que `data/repository.ts` usa para resolver
  la URL pública `/@handle/slug`.

Ninguna de las tres la tocaban los tests de esta fase —NexIA vive en
`workspaces`, `assignments` y `submissions`, que sí estaban completas—, pero son
exactamente la clase de fallo que R12 describía y arreglarlas costaba minutos.

**Divergencia adicional encontrada, NO corregida:** `lib/aws/config.ts` declara
`INDEXES.coursesBySlug = 'bySlug'`, pero `CoursesTable` del CFN **no tiene ningún
GSI**. Hoy no rompe nada porque ninguna ruta usa esa constante. No se tocó: ni se
modifica infraestructura de producción para hacer pasar tests, ni se borra una
constante como efecto secundario de otra fase. Queda como **R13** en el roadmap.

### Decisiones

- **`ai_worklog` se declaró en la unión al FINAL**, cuando ya existían tipo,
  esquema, normalización, editor, render de sólo lectura, persistencia, snapshot,
  publicación, export, import, lista blanca y pruebas. No hubo ningún momento
  estable en el que se pudiera guardar un bloque que ninguna pantalla supiera
  abrir.
- **`AIWorklogData` va ANIDADO en `worklog`, no aplanado.** El entregable legacy y
  el bloque llevan literalmente el mismo objeto, validado por el mismo
  `aiWorklogDataSchema`. `normalizeAIResult()` y `aiWorklogToMarkdown()` sirven
  sobre `block.worklog` sin una línea de adaptación, y hay una prueba que fija que
  un registro APLANADO **no** se cuela como bloque.
- **`conclusionMode: 'required'` se comprueba contra la PLANTILLA del paso, no
  contra el snapshot que llega.** Leerlo del cuerpo habría hecho la regla
  decorativa: `'none'` es un valor legítimo en un documento, así que bastaba con
  mandarlo. El servidor lee la plantilla —que es de la docente— y empareja por id
  de bloque, que la copia del estudiante conserva (`instanceDocumentFrom`).
  Borrar el bloque tampoco sirve: se exige que exista y esté contestado. Cuesta un
  `GetItem` por paso de NexBook, y sólo al entregar.
- **Por eso el selector «Conclusión del estudiante» sólo se pinta en modo
  plantilla** (`templateMode`, derivado del `role` que devuelve el servidor). No
  es la defensa; es la razón de no enseñar un control donde no significa nada.
- **La obligatoriedad NO vive en el esquema.** Si viviera, un documento con la
  reflexión a medio escribir dejaría de poder autoguardarse justo cuando hay que
  guardarlo. Hay una prueba unitaria y una de integración que fijan que un
  borrador incompleto sigue siendo válido y guardable.
- **`resourcesUsed` sale VACÍO, nunca ausente.** Son ids internos de una materia.
  Omitir el campo produciría un documento que no pasa su propio esquema al
  reimportarlo. **La información semántica se pierde al exportar** y así queda
  escrito en `docs/LIMITATIONS.md`: convertir ids a nombres exigiría resolverlos
  dentro de la frontera de publicación, y eso es otra decisión.
- **Las capturas reutilizan el almacén de assets tal cual**: mismo prefijo
  `nexbook/<ownerUid>/…`, mismo `maxAssetBytes`, mismos MIME (PNG, JPEG, WebP;
  **sin SVG**). No hay bucket nuevo, ni prefijo nuevo, ni otra autorización.
  Copiar o publicar un NexBook sigue sin duplicar bytes.
- **`collectAssetIds` e `imageMimeTypeFor` aprendieron el sitio nuevo, y eso NO
  es cosmético**: son las funciones que AUTORIZAN la lectura de un asset y las
  que deciden qué entra en el ZIP. Hay una prueba que comprueba que el remapeo
  del contenedor conoce exactamente los mismos sitios.
- **`nexia` sigue SIN reservarse como handle.** La Fase 1 lo pospuso a ésta «tras
  comprobar que no lo tiene nadie», y esa comprobación exige consultar la tabla de
  usuarios real, que este entorno no alcanza. `RESERVED_HANDLES` lo valida también
  el esquema del PERFIL: reservarlo a ciegas dejaría a quien lo tuviera sin poder
  guardar su propio perfil. Pendiente con su motivo, no olvidado.
- **`AIBlock` deja de estar «previsto» en `docs/NEXBOOK.md`.** Lo implementado es
  un REGISTRO. La sección que describía un bloque que llamaría a un modelo se
  reescribió para decir qué hay y qué no va a haber por ampliación.

### Validación

- typecheck: ✅ exit 0
- lint: ✅ exit 0, sin avisos
- test: ✅ 40 archivos · **755 pasadas**, 1 omitida (756) — 34 nuevas
- integration: ✅ 15 archivos · **190 pasadas** — 16 nuevas
- build: ✅ exit 0

| Bundle | Fase 2 | Fase 3 |
|---|---|---|
| shared JS | 104 kB | **104 kB** |
| `/nexbook/[slug]` | 167 kB | 170 kB (+3 kB) |
| `/practicas/nexbook/[id]` | 232 kB | 235 kB (+3 kB) |
| `/practicas` | 3.39 kB | 4.84 kB (+1.45 kB) |
| `/` (landing) | — | 246 kB, **sin código de NexIA** |

**Comprobado sobre el manifiesto de compilación, no de oído.** El chunk que
contiene el bloque lo usan exactamente cuatro rutas: la vista de la actividad, la
entrega, la publicación y NexLab. El landing y `/login` no lo incluyen, y ni
Pyodide ni webR aparecen en ninguna de esas rutas. `/practicas` sólo incluye el
copy del lanzador y el documento del preset, no el editor.

### Navegador

**Lo que SÍ se comprobó**, con el servidor de desarrollo (Next 15.5.25):

- **`/practicas` sin sesión** — el lanzador muestra sus **tres** puertas:
  «+ Nuevo NexLab», «+ Nuevo NexCode» y **«+ Nuevo NexIA»**. Al pulsar la
  tercera, el formulario dice «NexIA · registra de forma trazable cómo utilizaste
  una IA», el campo trae de marcador «Registro de uso de IA» y la explicación
  termina en «Nextudio no ejecuta ninguna IA».
- **375×812 en tema claro** — sin desbordamiento horizontal
  (`scrollWidth === clientWidth === 375`); los tres botones envuelven limpiamente.
- **1280×900 en tema oscuro** — la misma pantalla, legible, sin errores de
  consola.
- **`/` (landing)** — se encontró que el copy seguía diciendo que NexIA «tendrá
  espacio propio más adelante», que ya era **falso**. Se corrigió en la misma
  iteración: ahora describe lo que hace y dice explícitamente que Nextudio **no
  ejecuta** la IA. Verificado en el navegador: la frase nueva está, «más
  adelante» ya no, y no hay desbordamiento ni errores.
- **Copy prohibido**: ni «Pregunta a NexIA», ni «Enviar prompt», ni «Respuesta de
  NexIA» aparecen en ninguna superficie pública.

**Lo que NO se pudo comprobar.** El bloque en sí vive detrás de la sesión: NexLab
abierto, el editor del registro, la plantilla docente, la entrega y la
publicación con datos reales. Esta instalación apunta a Firebase y AWS reales y
no hay cuenta institucional disponible aquí (misma limitación declarada desde la
Fase 1, ver `docs/LIMITATIONS.md` y R9/R11). **No se finge esa prueba.**

Lo que cubre el hueco son las 50 pruebas nuevas, y en particular las 16 de
integración, que ejercitan las **rutas reales** contra DynamoDB Local: guardar,
autoguardar a medias, publicar, leer la publicación **sin sesión**, entregar con y
sin conclusión, e intentar saltarse la regla desde el cuerpo de la petición.

Tampoco se montó un arnés para publicar un NexBook con AI Worklog y abrirlo a
mano en el navegador: la ruta pública ya se ejerce en integración sin
`Authorization`, que es el caso real, y levantar un servidor con datos sembrados
para mirar la misma respuesta con los ojos no habría añadido información.

### Riesgos

- **R12 cerrado** (ver «Paso previo»).
- **R13 (nuevo):** `INDEXES.coursesBySlug` apunta a un índice que el CFN no crea.
  Inofensivo hoy porque nadie lo usa; fallaría en producción el día que alguien lo
  use. No se tocó.
- **R14 (nuevo, anterior a NexIA):** la vista docente de una entrega no pinta las
  imágenes del snapshot —de ningún bloque—, porque los bytes cuelgan del prefijo
  del estudiante y la ruta de lectura exige ser su dueño. Mitigación puesta: el
  registro de IA dice que hay una captura que no puede mostrarse ahí, con su
  texto alternativo, en vez de dejar el hueco vacío.
- **R15 (nuevo):** en un NexIA personal, `conclusionMode` no tiene quien lo
  exija. Consciente: el preset nace en `optional` y no en `required`, porque
  `required` pintaría una advertencia que nada puede hacer cumplir.
- **R9 y R11 siguen abiertos:** ningún recorrido autenticado se ha probado a mano
  en ninguna iteración. Un entorno de autenticación controlado los cerraría todos
  de una vez.
- **Aviso operativo (R10):** `git stash` en este árbol arrastra el trabajo no
  commiteado de las Fases 1 y 2, que todavía no tienen commit. Se usó una vez para
  medir un bundle base, se restauró íntegro con `git stash pop` y se verificó; no
  se volverá a usar mientras el árbol siga así. Y `next build` sobre un `.next`
  mezclado revienta: hay que borrarlo, como ya anotaba R10.

### Próximo punto exacto

**Fase 3.5 — NexLab Data Interop.** El plan completo está en
`docs/NEXTUDIO-ROADMAP.md` §3 · Fase 3.5. Empezar por **auditar
`lib/spreadsheet/bridge.ts`**, que ya existe y está probado, y por decidir el
nombre de la API académica comprobando conflictos —`nex.sheet(...)` es la forma
conceptual, no un compromiso—. Después, en este orden: (1) `NexLab Data Bridge`
como capa pequeña y testeable entre el bridge y `NotebookKernel`, con referencias
por `blockId` y alias humano opcional con duplicados resueltos explícitamente;
(2) `SpreadsheetBlock → Python` y `→ R`; (3) importación `.xlsx` y CSV, donde el
archivo alimenta el bloque y deja de mandar; (4) `ImageBlock → Python/R`
entregando **bytes**, nunca una URL firmada ni acceso del Worker a S3; (5) acceso
a outputs persistidos si resulta razonable.

Lo que NO se hace en esa fase: grafo reactivo automático, ETL, compatibilidad
total con Excel, ejecución de macros, resolución de conexiones externas y
cualquier forma de red desde el Worker. La suite que protege el aislamiento tiene
que seguir verde sin relajar ni una prueba.

**Fase 4 no empieza antes que la 3.5.**

## Iteración — Nextudio · Fase 3.5 (NexLab Data Interop) — 2026-09-11

### Estado

- [x] P0.1 · Auditoría del entorno de autenticación: el emulador YA estaba soportado — ÉXITO
- [x] P0.2 · `npm run dev:local`: DynamoDB Local + Auth Emulator + next dev — ÉXITO
- [x] P0.3 · Dos identidades locales deterministas (docente y estudiante) — ÉXITO
- [x] P0.4 · Materia, inscripción y actividad sembradas — ÉXITO
- [x] P0.5 · Guardián que impide apuntar a producción, con pruebas — ÉXITO
- [x] P0.6 · `docs/LOCAL-DEVELOPMENT.md` — ÉXITO
- [x] P0.7 · Recorrido AUTENTICADO real en navegador (docente) — ÉXITO
- [ ] P0.8 · Playwright — NO COMPLETADA (ver «Decisiones»)
- [x] R13 · `coursesBySlug` resuelto: constante muerta retirada, índice NO creado — ÉXITO
- [x] R12 · Definiciones de tabla unificadas en un solo módulo, con prueba — ÉXITO
- [x] D1 · `SpreadsheetBridge` auditado y REUTILIZADO, sin segundo puente — ÉXITO
- [x] D2 · `NexLab Data Bridge` (`lib/lab/`), pequeño y testeable — ÉXITO
- [x] D3 · API `nex.*` en Python y `nex_*` en R — ÉXITO
- [x] D4 · Identidad estable por `blockId`; alias duplicado = error explícito — ÉXITO
- [x] D5 · Spreadsheet → Python, ejecutando de verdad — ÉXITO
- [x] D6 · Spreadsheet → R (prólogo y data.frames) — ÉXITO por pruebas; navegador NO (ver R18)
- [x] D7 · Importación CSV con delimitador, comillas, UTF-8 y vacíos — ÉXITO
- [x] D8 · Importación XLSX con parser propio y avisos — ÉXITO
- [x] D9 · `ImageBlock` → código, con BYTES y nunca URL — ÉXITO
- [x] D10 · Outputs persistidos → código, incluido Python → R — ÉXITO
- [x] D11 · Datos BAJO DEMANDA, no el NexBook entero — ÉXITO
- [x] D12 · Parsers con carga diferida, fuera de toda carga inicial — ÉXITO
- [x] V.1 · typecheck · lint · 859 unitarias · 190 de integración · build — ÉXITO
- [ ] V.2 · `Spreadsheet → R` en navegador — NO COMPLETADA (webR no arranca aquí; R18)
- [ ] V.3 · Imágenes desde código en navegador — NO COMPLETADA (el sandbox no tiene S3)
- [ ] F4 · Rediseño del creador docente — NO EMPEZADA

### Paso 0 — el entorno local

**Lo que ya existía, y por eso no se inventó nada.** La auditoría encontró
soporte completo de **Firebase Auth Emulator**: `firebase.json` lo declara,
`lib/firebase/config.ts` tiene `FIREBASE_EMULATOR_PROJECT_ID = 'demo-uinexus'` y
el interruptor `NEXT_PUBLIC_FIREBASE_USE_EMULATORS`, `client.ts` llama a
`connectAuthEmulator` y `admin.ts` apunta el Admin SDK al emulador. También
existían DynamoDB Local (fijado por hash) y los fixtures académicos. **Opción A
del encargo**: se usó eso. No se construyó ningún «Local Test Auth».

**Las cuentas usan el dominio institucional REAL** (`@itdurango.edu.mx`) y no un
`@nextudio.local`: `isInstitutionalEmail()` es una regla de producción y
relajarla para poder probar habría convertido el tooling en un agujero. El ROL
tampoco se escribe a mano —sale de `getRoleFromInstitutionalEmail`, que mira si
la parte local lleva dígitos—, así que el sandbox ejercita la función que de
verdad decide quién es quién. Las cuentas viven sólo en el emulador
(`demo-uinexus`, que Google no conoce) y en DynamoDB Local.

**`.env.local` no se toca.** Apunta a Firebase y AWS reales porque hace falta
para trabajar contra producción. El sandbox le gana por precedencia: `@next/env`
conserva lo que ya esté en `process.env`, así que `childEnv()` define TODA
variable relevante, incluidas las que valen cadena vacía como
`FIREBASE_SERVICE_ACCOUNT_JSON`. Una variable sin definir sería una variable que
`.env.local` rellenaría con el valor de producción.

**La única concesión en producción**: `lib/aws/config.ts` admite ahora un
endpoint de DynamoDB alternativo en un segundo runtime. Exige
`NODE_ENV === 'development'` **y** `UINEXUS_LOCAL_SANDBOX=true`, además del
`http:` + bucle local que ya comprobaba. En un despliegue no existe ninguna
combinación de variables que lo active, y hay una prueba que lo fija.

### Decisiones

- **Las referencias del laboratorio se resuelven leyendo el FUENTE antes de
  ejecutar.** El encargo pedía «bajo demanda» sin decir cómo. La forma natural
  —que el Worker pida datos a mitad de ejecución— exige comunicación síncrona
  con el hilo principal, es decir `SharedArrayBuffer` + `Atomics.wait`, que
  exigen COOP/COEP que Nextudio no tiene. El precio, documentado y con error
  propio: `nex.sheet(variable)` no se puede resolver; tiene que ser literal.
- **No se instaló ninguna biblioteca de XLSX.** Se auditaron SheetJS (paquete
  congelado en npm, ~900 KB, CVEs de prototype pollution y ReDoS), ExcelJS (~1 MB,
  orientado a escribir, dependencias de Node) y `read-excel-file` (la más
  cercana, pero depende de `DOMParser`/`xmldom`). Decidió que **`fflate` ya es
  dependencia** —con las defensas de zip slip y ZIP bomb ya escritas para
  `.nexbook`— y que escribirlo da **control total sobre qué partes del archivo se
  abren**: macros, Power Query, conexiones y enlaces externos no se filtran,
  sencillamente no se decodifican. Efecto secundario: sin parser de XML general,
  XXE y la expansión de entidades no tienen dónde ocurrir. Hay una prueba que
  mete un `<!ENTITY>` y comprueba que se queda como texto.
- **Una hoja de Excel → un `SpreadsheetBlock`.** La opción con menor
  incompatibilidad: no cambia `NexBookSheetData`, ni el editor, ni el renderizador
  de sólo lectura, ni la lista blanca, ni el `.nexbook`, y deja a cada hoja con
  su nombre del libro, que es por el que `nex.sheet("Ventas")` la busca. Meter
  varias hojas en un bloque habría obligado además a decidir qué significa «el
  nombre del bloque» cuando dentro hay tres nombres más.
- **Los duplicados de nombre PARAN.** `SpreadsheetBridge` se queda con el
  primero, que para pintar da igual; para decidir qué datos ve un programa
  significa que añadir una hoja cambia el resultado de una celda que nadie tocó.
  La política nueva vive en el Data Bridge, así que el puente no se tocó.
- **Los booleanos se infieren en el PUENTE, no en `formula.ts`.** `VERDADERO` es
  texto para la hoja —lo que se escribe es lo que se ve— y booleano para el
  código. Cambiarlo en el motor habría alterado hojas existentes.
- **`resolveLabDataset` se llama desde Studio y no desde el kernel.** Studio es
  quien tiene el documento ACTUAL y la sesión; el kernel ejecuta y no sabe de qué
  documento viene la celda. Es la misma separación por la que las imágenes de
  salida se suben fuera del kernel.
- **`sanitizeWorkerRun` reconstruye el dataset campo a campo**, aunque venga de
  `resolveLabDataset`, que ya lo construye. Una garantía que depende de que la
  función de al lado siga comportándose bien no es una garantía.
- **Playwright NO se añadió.** El encargo lo ofrecía «si el entorno lo permite», y
  lo permite. No se hizo porque la verificación de esta fase se hizo a mano sobre
  el entorno real y porque una suite E2E es una pieza con su propio diseño
  —fixtures de sesión, espera de compilación de `next dev`, limpieza entre
  pruebas— que no cabía sin recortar Data Interop, que es el objeto de la fase.
  El entorno queda listo: `npm run local:prepare` deja todo servido sin arrancar
  el servidor, que es justo lo que una suite E2E necesita. Queda como el primer
  trabajo de la Fase 4.

### Dos fallos reales que sólo el entorno local podía destapar

1. **`api-client.ts` leía `auth.currentUser` sin esperar a Firebase.** Abrir una
   URL directamente —un marcador de `/aula`— con sesión válida respondía
   «Necesitas iniciar sesión», mientras la barra superior sí mostraba la cuenta.
   Se añadió `await auth.authStateReady()`. Es un fallo de PRODUCTO que
   sobrevivió tres fases porque nadie podía entrar.
2. **`dev:local` se saltaba la compilación de los Workers.** `next dev` a secas
   no ejecuta el `predev`, así que `public/runtime/workers/` conservaba el Worker
   anterior al cambio y una celda correcta fallaba con `NameError: name 'nex' is
   not defined`. Ahora el orquestador los recompila al arrancar.

### Validación

- typecheck: ✅ exit 0
- lint: ✅ exit 0, sin avisos
- test: ✅ 44 archivos · **859 pasadas**, 1 omitida (860) — 104 nuevas
- integration: ✅ 15 archivos · **190 pasadas** — sin cambios
- build: ✅ exit 0

| Bundle | Fase 3 | Fase 3.5 |
|---|---|---|
| shared JS | 104 kB | 105 kB |
| `/` (landing) | 246 kB | 247 kB |
| `/nexbook/[slug]` | 170 kB | **170 kB** |
| `/practicas` | 4.84 kB | **4.84 kB** |
| `/practicas/nexbook/[id]` | 235 kB | 239 kB |

**Los parsers no entran en ninguna carga inicial.** Comprobado sobre el
manifiesto de compilación: el chunk del lector de XLSX y el del de CSV no los
carga de entrada **ninguna** página —se piden con `import()` dentro del
manejador— y el módulo `nex` de Python no aparece en ningún chunk de cliente,
porque vive en el Worker. El landing, la búsqueda, NexCode y la publicación de
lectura siguen sin tocarlos.

### Navegador

**Con sesión real, por primera vez en todo el proyecto.**

Como **docente** (`docente.sandbox@itdurango.edu.mx`): acceso, Aula con «Hola,
Docente», la materia «Investigación de Operaciones — Sandbox» con 1 estudiante y
1 tarea, la actividad publicada y su panel de entregas.

En **NexLab**, ejecutando de verdad:

```
hoja «Ventas» escrita a mano → Python
  ['producto', 'unidades', 'precio']
  [['Tornillo', 10, 2.5], ['Tuerca', 4, 1.25], ['Arandela', 14, 0.5]]
  total: 28
```

La fórmula `=SUMA(B2:B3)` llegó **ya calculada** como `14`, y `28` = 10+4+14.

Importación CSV, con el archivo entregado al `input[type=file]` real:

```
region;unidades;activo           →  hoja «ventas-region»  →  Python
Norte;120;VERDADERO                 ['region','unidades','activo']
"Durango, Dgo.";85;FALSO            [['Norte',120,True],
Sur;;VERDADERO                       ['Durango, Dgo.',85,False],
                                     ['Sur',None,True]]
```

Delimitador `;` detectado, el campo entrecomillado con coma **intacto**, `120`
como número, booleanos como booleanos y el vacío como `None`. La hoja se renombró
sola con el nombre del archivo. Y al importar sobre una hoja CON datos, el aviso
de sustitución apareció y detuvo la importación: la confirmación funciona.

**Lo que NO se pudo comprobar en el navegador:**

- **`Spreadsheet → R`.** webR arranca un Worker ANIDADO y el navegador embebido
  de esta herramienta no lo admite: falla con «An error occurred initialising the
  webR PostMessageChannel worker» **también con código R plano sin la API del
  laboratorio**. Es ambiental, no una regresión. Queda pendiente de un Chrome o
  Firefox normales.
- **Imágenes desde el código.** El sandbox no tiene S3, así que no se puede subir
  una imagen. Cubierto ejecutando Pyodide de verdad en `lab-runtime.test.ts`.
- **El recorrido del estudiante y la entrega.** Se verificó el acceso y los datos
  como docente; el recorrido completo de entrega y revisión queda pendiente y es
  lo primero que una suite de Playwright debería cubrir.

### Pruebas nuevas (104)

- `tests/unit/lab-data-bridge.test.ts` — **36**: escáner de referencias (Python y
  R, `_by_id`, dinámicas), resolución con valores calculados, `blockId` estable
  al mover un bloque, eñe y acentos, duplicados que paran, bajo demanda, catálogo
  sin datos, outputs persistidos, imágenes sin URL, la frontera del Worker y la
  forma de lo que recibe cada runtime.
- `tests/unit/lab-runtime.test.ts` — **15**, ejecutando **Pyodide de verdad**:
  hojas con tipos, fórmulas ya calculadas, `to_dicts`, `sheet_by_id`, errores que
  dicen qué hay disponible, la superficie exacta de `nex`, que la red sigue sin
  existir con datos preparados, outputs persistidos e imágenes como `bytes`.
- `tests/unit/spreadsheet-import.test.ts` — **33**: CSV (delimitadores, comillas,
  CRLF, BOM, eñe, encabezados deducidos, inyección de fórmulas neutralizada,
  límites) y XLSX (texto compartido, inline, números, booleanos, fechas por
  estilo y por formato personalizado, fórmulas soportadas y no soportadas,
  varias hojas, macros y conexiones ignoradas con aviso, entidades XML, XXE
  imposible, archivos inválidos y límites).
- `tests/unit/local-sandbox.test.ts` — **20**: el guardián de destino, el de
  Firebase, que el endpoint local no se puede activar en producción, que las
  definiciones de tabla coinciden con el CFN (R12) y que `coursesBySlug` se
  retiró sin crear el índice (R13).

### Riesgos

- **R9, R11, R12 y R13 cerrados** (ver roadmap §7).
- **R16 (nuevo):** las referencias del laboratorio tienen que ser literales.
- **R17 (nuevo):** el lector de XLSX es propio y menos compatible que una
  biblioteca general. A cambio, cero dependencias nuevas y control total sobre
  qué se abre. Lo no soportado se avisa, nunca se inventa.
- **R18 (nuevo):** `Spreadsheet → R` no se ha ejecutado en un navegador.
- **R14 y R15 siguen abiertos** (imágenes del snapshot en la vista docente;
  `conclusionMode` sin quien lo exija en un NexIA personal).
- **Deuda asumida:** sin Playwright. El entorno ya lo permite.

### Próximo punto exacto

**Fase 4 — Rediseño del creador docente**, según `docs/NEXTUDIO-ROADMAP.md` §D7:
se reconstruye la PANTALLA, no el modelo. `Workflow`, `WorkflowStep`,
`StepDeliverable`, `StepPrompt`, `StepToolChoice`, `dependsOnStepIds` y
`assignedTo` no cambian.

Empezar por **cerrar la deuda de Playwright**, que ahora cuesta poco:
`npm run local:prepare` deja el sandbox servido sin arrancar el servidor, que es
lo que una suite E2E necesita. Con eso puesto, el rediseño se puede comprobar de
verdad en cada paso en vez de al final.

Después, `src/components/aula/workflow-builder.tsx` y `assignment-editor.tsx`:
«Paso» → «Parte» en copy visible, las 7 opciones humanas en lugar de los 12
entregables técnicos, `shape` derivado en vez de preguntado, y la plantilla de
NexLab editable **desde el constructor** (U5). La opción «Trabajar en
laboratorio (NexLab)» ya puede ofrecer un laboratorio de verdad: hoja importada
de Excel o CSV, código que la lee, resultados y registro de IA en un solo
NexBook reproducible.

---

## Iteración — Nextudio · Fase 4 (rediseño del creador docente) — 2026-09-11

### Qué se hizo

Se reconstruyó la pantalla de crear y editar una actividad. **El modelo no se
tocó.** `Workflow`, `WorkflowStep`, `StepDeliverable`, `StepPrompt`,
`StepToolChoice`, `dependsOnStepIds` y `assignedTo` son los mismos; el runner del
alumnado lee lo mismo; no hubo migración de registros ni `ActivityV2`.

La pantalla pasa de preguntar por la implementación —«¿un paso o varios?», «tipo
de entrega» entre cinco nombres internos, «qué debe entregar» entre doce— a
preguntar una sola cosa: **¿qué debe hacer el estudiante?**

Orden nuevo: Lo básico · Qué hará el estudiante · Materiales y recursos · Vista
previa · Opciones avanzadas.

### Arquitectura

**`src/lib/activity-builder.ts` (nuevo)** — la traducción, en un módulo puro sin
React y sin red. Es el único sitio donde una intención se convierte en modelo, y
por eso sus reglas se prueban una a una en vez de a través de una pantalla.

- `ACTIVITY_ACTIONS` — siete intenciones de primer nivel con sus variantes.
- `makePart` / `retypeDeliverable` — intención → `WorkflowStep`, campo por campo.
- `actionForPart` / `partActionLabel` — el camino de vuelta, para abrir lo que ya
  existe. Manda el ENTREGABLE, no `actionType`, porque `actionType` es una cadena
  abierta y el entregable es lo que el runner sabe pintar.
- `deriveActivity` — la forma se DERIVA, no se pregunta.
- `legacyEquivalent` — si una parte cabe entera en la representación anterior.
- `movePart` / `removePart` / `dependentsOf` — reordenar y quitar sin romper
  dependencias en silencio.
- `activityProblems` / `humanizeSaveError` — qué falta, dicho como se lo diría
  una persona.

**Componentes**

- `src/components/aula/activity-parts.tsx` (nuevo) — «Qué hará el estudiante»:
  el catálogo, la lista de Partes y el editor de cada una, con revelado
  progresivo y las avanzadas plegadas.
- `src/components/aula/nexlab-template-panel.tsx` (nuevo) — el laboratorio dentro
  del constructor. Monta `NexBookStep` por `next/dynamic`; **no hay un segundo
  editor**.
- `src/components/aula/assignment-editor.tsx` — reescrito sobre las cinco
  secciones. `TeacherPreview` ampliado; `WorkflowBuilder` retirado de aquí (sigue
  sirviendo a las plantillas de proceso de la biblioteca, que es otra pantalla).

**Modelo, sólo aditivo**

`StepDeliverable.conclusionMode`, opcional, reutilizando `NexBookConclusionMode`
y `nexBookConclusionModeSchema` —el MISMO tipo y el MISMO esquema que el bloque
de NexLab—. Ausente significa `optional`, que es lo que hacían las partes
guardadas antes. Se comprueba al entregar contra la definición de la parte, nunca
contra lo que manda el navegador.

### La regla de compatibilidad

```
ya era un proceso   → proceso            (nunca se degrada)
2 o más partes      → proceso
1 parte que cabe    → su forma antigua
1 parte que no cabe → proceso
```

Un proceso no vuelve atrás porque la evidencia se indexa por el id de la parte.
Y «cabe» no lo decide sólo el entregable: `legacyEquivalent` exige además que la
parte no lleve título ni instrucciones propias, ni prompt, ni herramienta, ni
recursos, ni responsables, ni dependencias, ni pista, ni conclusión obligatoria
—porque nada de eso sobreviviría al guardado antiguo—.

### Regresión encontrada y corregida

`submission-form.tsx` elegía el recorrido por partes con `workflow.length > 1`.
Con el constructor nuevo, una actividad de UNA parte que pide laboratorio,
código, archivo o ninguna entrega se guarda como `type: 'workflow'` con un solo
paso y caía en el formulario antiguo, quedándose **sin nada que rellenar**. La
señal correcta es `assignment.type === 'workflow'`. Igual en
`assignment-detail.tsx`. Cubierto por integración para los cuatro casos.

### Copy

«Parte» en lugar de «paso» en el constructor, en la ficha de la actividad y en el
recorrido del estudiante. `aria-label="Vista del workflow"` → «Vista del avance».
`TypeChip` ya no sale vacío en una actividad por partes: dice «Por partes».
«Tipo de entrega» en la ficha del estudiante pasa a «Qué hay que entregar» y
enumera lo que pide cada parte, en vez de dos párrafos vacíos.

### Pruebas

- `tests/unit/activity-builder.test.ts` — **82**: el catálogo sin palabras del
  modelo, la ida y la vuelta de cada opción, NexCode y NexLab distinguidos por el
  entregable, la política de conclusión, el cambio de intención sin arrastrar
  campos, los títulos que aparecen cuando hacen falta, mover y quitar partes,
  dependencias que no se borran solas, la derivación completa, los ocho motivos
  por los que una parte deja de caber en la forma antigua, los cinco tipos
  antiguos abriendo y guardándose igual, un entregable retirado del catálogo que
  sobrevive, y los mensajes de error sin rutas del modelo.
- `tests/integration/activity-builder-routes.test.ts` — **25**: actividad simple,
  de varias partes, NexLab preparado desde un borrador con la plantilla que
  llega al estudiante, NexIA con conclusión obligatoria bloqueando la entrega,
  fixtures escritos con la forma anterior, y permisos (docente ajena, estudiante,
  alguien de fuera).
- `tests/e2e/` — **6 recorridos** de Playwright contra el sandbox local.

### Validación

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   45 archivos · 941 passed | 1 skipped (942)
npm run test:integration ✅   16 archivos · 215 passed
npm run build            ✅
npm run test:e2e         ✅   6 passed
```

Bundles: compartido 105 kB · `/` 247 kB · `/aula` 170 kB · creador 202 kB (antes
197 kB) · `/practicas/nexbook/[id]` 239 kB · `/nexbook/[slug]` 170 kB. Ninguna de
las 34 rutas carga de inicio Monaco, Pyodide, webR ni los parsers de CSV/XLSX.

### Riesgos

- **R6, R9 y R11 cerrados** (ver roadmap §7).
- **R19 (nuevo):** una actividad de una parte guardada como proceso cambia por
  qué camino la pinta la pantalla del estudiante. Es la causa de la regresión.
- **R20 (nuevo):** el título de una parte se completa solo al guardar.
- **R21 (nuevo):** la suite E2E corre contra `next dev`.
- **R14, R15, R16, R17 y R18 siguen abiertos.**
- **Hallazgo fuera de alcance:** la barra de navegación desborda 3 px a 375 px.
  Es anterior a esta fase y afecta a todas las pantallas; queda anotado en
  `docs/LIMITATIONS.md` §12, sin tocar.

### Próximo punto exacto

**Fase 5 — Experiencia del estudiante**, según `docs/NEXTUDIO-ROADMAP.md`.
No se empezó en esta iteración.

Lo que esta fase deja preparado para ella: el vocabulario ya es «Parte» en las
dos direcciones, `partActionLabel` da el nombre humano de cualquier entregable
—incluidos los retirados— y `npm run test:e2e` permite comprobar el recorrido
del estudiante de verdad en cada paso, no al final.

---

## Iteración — Nextudio · Fase 5 (experiencia del estudiante) — 2026-09-12

### Qué se hizo

Se rediseñó la pantalla del alumnado para que una actividad se entienda como
**qué tengo que hacer → dónde lo hago → qué llevo → qué me falta → qué voy a
entregar**. **El modelo no se tocó**: `Workflow`, `WorkflowStep`,
`StepDeliverable`, `dependsOnStepIds`, `assignedTo` y el ciclo de vida de
`Submission` son los mismos, y no hubo migración de registros.

Nada de lo que se ve nombra el modelo. Hay Partes, estados y una entrega.

### Arquitectura

**`src/lib/student-activity.ts` (nuevo)** — la derivación, en un módulo puro sin
React y sin red, como hizo la Fase 4 con el constructor.

- `partStatus` — `Bloqueada · Sin empezar · En progreso · Completada`.
- `partIsComplete` — EXACTAMENTE las dos reglas que el servidor exige para
  entregar. Ni una más: decidir si un trabajo está bien hecho es calificar.
- `blockedBy` — qué Partes faltan para abrir ésta, con sus nombres.
- `activityProgress` — conteo, nunca porcentaje. Las Partes no tienen peso.
- `missingToSubmit` — qué falta, Parte por Parte, dicho como una frase.
- `activityState` — el estado de la actividad, DERIVADO. Sin campos nuevos.
- `humanizeSubmitError` — el conflicto de versiones y el fallo de red, dichos
  para quien los va a leer. Las reglas académicas del servidor ya hablan en
  claro y se dejan tal cual: reescribirlas aquí las duplicaría.

La regla que sostiene el módulo: **«lista para entregar» tiene que coincidir con
lo que el servidor deja entregar.** Más permisivo habilitaría un botón que
termina en 409; más estricto bloquearía una entrega que el servidor acepta. Hay
pruebas que comparan las dos cuentas contra `missingRequiredSteps`.

**Componentes**

- `src/components/aula/student-work.tsx` (nuevo) — «Tu trabajo»: el índice de
  Partes con su estado, el progreso y la lista de lo que falta. La MISMA pieza
  en la ficha y en el recorrido, para que no puedan contar cosas distintas.
- `src/components/aula/evidence-reader.tsx` (nuevo) — extraído de
  `workflow-progress.tsx`; lo usan las dos pantallas docentes que leen trabajo.
- `workflow-runner.tsx`, `submission-form.tsx` y `assignment-detail.tsx`
  reescritos sobre esas piezas.
- `deliverable-fields.tsx` sólo recibe `conclusionMode`. Los formularios de cada
  entregable no se tocaron.

**Servidor, sólo aditivo**

`GET /api/assignments/[id]` añade `teacherName` y `myLabs`.
`lib/server/student-labs.ts` (nuevo) resuelve las dos cosas que faltaban.

### Las dos cosas que faltaban de verdad

**El laboratorio y el progreso no se hablaban.** Un NexLab se guarda solo, en su
propio documento; la entrega guarda una COPIA, y esa copia sólo se escribía
cuando el navegador la mandaba. Resultado: trabajar una hora, volver al día
siguiente y leer «Sin empezar»; o pulsar «Entregar» sin reabrir la Parte y que
el servidor contestara «todavía te falta» sobre trabajo hecho. Ahora el servidor
dice qué laboratorios existen y, **al entregar**, recoge el que no llegó en el
cuerpo. Lo que NO se hace es guardar la copia continuamente: eso destruiría el
congelado de la entrega, que es lo que impide que seguir trabajando cambie lo
que se califica.

**El visor docente no sabía leer una actividad por partes.**
`flattenSubmission` sólo aplana los cinco tipos anteriores, así que sobre una
actividad por partes devolvía los campos de una entrega libre: la pantalla
enseñaba «(sin respuesta)» encima de un laboratorio entero. Corregido
reutilizando `EvidenceReader`. Es la misma clase de fallo que la regresión de la
Fase 4 —una pantalla que no distingue una actividad por partes— en el otro lado
del aula.

### Copy

«Mi entrega» → «Mi trabajo». «Tipo de entrega» → «Tu trabajo». «Comenzar tarea»
→ «Empezar» / «Continuar» / «Ver o cambiar lo que entregué». «Guardar borrador»
→ «Guardar y seguir después», con la frase que dice la diferencia: *guardar deja
tu trabajo a medias y sólo lo ves tú; entregar se lo manda a tu docente*. Un
bloque bloqueado de NexLab dice «contenido de tu docente · sólo lectura» en
lugar de esconder la explicación en un `title`, que en un móvil no existe.

### Pruebas

- `tests/unit/student-activity.test.ts` — **32**: estados por Parte, formulario
  en blanco que no cuenta, dependencias que bloquean y desbloquean, dependencia
  rota que no condena una Parte, laboratorio abierto que cuenta, conclusión
  obligatoria, progreso, lo que falta sin vocabulario del modelo, el estado de
  la actividad, «entregada tarde» derivada, una actividad del formato anterior
  que funciona igual, y los errores traducidos.
- `tests/integration/student-experience-routes.test.ts` — **17**: lo que viaja
  al abrir (sin un solo UID), dependencias derivadas de lo guardado, laboratorio
  empezado que cuenta y que se recoge al entregar, la copia entregada que no
  cambia, conclusión obligatoria por los dos lados, y los permisos —plantilla,
  laboratorio ajeno, completar una Parte que no te toca, alguien de fuera—.
- `tests/e2e/student-journeys.spec.ts` — **5 recorridos** más de Playwright.

### Validación

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

### Riesgos

- **R22 (nuevo):** una Parte de laboratorio se completa por EXISTIR la copia, no
  por tener contenido. Es la misma regla del servidor, y a propósito.
- **R23 (nuevo):** «Ya la hice» se guarda en `note`, así que borrar la nota
  devuelve la Parte a «Sin empezar».
- **R24 (nuevo, ya corregido):** el visor docente leía mal una actividad por
  partes. La causa —`flattenSubmission` sólo conoce los cinco tipos anteriores—
  sigue viva para cualquier pantalla nueva que la use.
- **R19, R20 y R21 siguen abiertos** (Fase 4); **R14, R15, R16, R17, R18 y R10**
  también.
- **Hallazgo conservado:** la barra de navegación desborda 3 px a 375 px. Medido
  otra vez: `main` termina exactamente en 375 px, así que es del marco y no del
  contenido. Es endurecimiento global, que es la Fase 6.

### Próximo punto exacto

**Fase 6 — Endurecimiento**, según `docs/NEXTUDIO-ROADMAP.md`. No se empezó.

Lo que esta fase le deja: el desbordamiento de 375 px ya está medido y
localizado (`app-shell/navbar.tsx`), las dos pantallas del aula comparten las
mismas piezas —así que un arreglo responsive vale para las dos—, y
`npm run test:e2e` recorre once caminos autenticados, que es la red de seguridad
que un endurecimiento necesita para no romper nada sin enterarse.

---

## Iteración — Nextudio · Fase 6 (endurecimiento final) — 2026-09-12

### Qué se hizo

La última fase del roadmap. No añadió capacidades: **auditó, corrigió bordes,
midió y documentó**. Cuatro de los fallos que encontró eran reales y estaban en
producción de la rama; ninguno se descubrió leyendo código, todos aparecieron al
medir.

### Lo corregido

**El desbordamiento global de 375 px.** La barra de navegación dejaba el
documento con `scrollWidth` de 378 px, y 18 px de más a 360 px. Afectaba a
TODAS las pantallas porque la barra es global. Corregido en la causa —menos
separación por debajo de `sm` y la marca sin su nombre por debajo de 400 px, con
el `aria-label` del enlace diciéndolo igual— y no pantalla por pantalla.

**El avance por parte rechazaba una actividad de UNA Parte.** `R19 vivo`: la
ruta `/workflow` contaba pasos (`workflow.length <= 1` → 409). La pestaña
«Avance por parte» es la que la pantalla docente abre por defecto en una
actividad de un solo laboratorio: se ofrecía y fallaba. Ahora lo decide el tipo.

**La exportación se quedaba vacía en una actividad por partes.** `R24 vivo`:
`flattenSubmission` sólo conocía los cinco tipos anteriores, así que el Markdown
para IA, el CSV y el visor docente devolvían «Respuesta: (sin respuesta)» sobre
un laboratorio entero. Ahora recibe el workflow y lee cada Parte con el
aplanador de su entregable, el mismo reparto que hace `evidence-reader.tsx`.

**El estudiante veía el formulario del creador por URL directa.** `GET
/api/assignments/:id` responde 200 al alumnado —puede leer su actividad— así que
la pantalla se montaba entera. Guardar siempre fue imposible (el servidor lo
rechaza, y hay pruebas), pero no se le debe enseñar una herramienta que no es
suya. Ahora se decide con `viewerRole` y con la lista de la materia.

Lo interesante es **por qué no se había visto**: la prueba afirmaba la AUSENCIA
del formulario, y eso pasa también mientras la página carga. Con la ruta ya
compilada por las suites nuevas, el formulario llegó dentro del plazo y se
descubrió. La prueba ahora espera primero a que la pantalla DIGA que no.

**Una variable de origen vacía tiraba la compilación.** `NEXT_PUBLIC_*_ORIGIN`
se leía con `??`, que no cae en la cadena vacía —lo que deja un panel de
despliegue al borrar un valor—, y `new URL('')` reventaba con `Invalid URL` al
cargar el módulo, es decir, tirando la página estática entera. Lo encontró el
sandbox compilado.

**`isSingleStep()` se retiró.** Devolvía `workflow.length <= 1`, no lo usaba
nadie y su nombre invitaba a la decisión que ya había costado tres fallos.

### R22, cerrado con una señal real

Una Parte de laboratorio ya no se completa por existir la copia, sino por llevar
trabajo dentro: `createNexBook` la crea en revisión **1** y `saveOwnNexBook`
sube la revisión en cada guardado, así que «revisión mayor que 1» significa
exactamente «se guardó algo después de crearla». No es una heurística ni una
medida de calidad —eso sería calificar—: es el dato que el almacenamiento ya
llevaba. El cambio va en los dos lados a la vez, para que la pantalla y el
servidor sigan contando lo mismo.

### R21, hasta dónde llega

Se intentó llevar la suite entera a `next build` + `next start`. **No se puede,
y la razón es buena.** `lib/aws/config.ts` sólo admite un endpoint de DynamoDB
que no sea el de AWS cuando `NODE_ENV` no es `production`, y `NODE_ENV` en Next
es una constante de COMPILACIÓN: webpack la sustituye dentro del bundle del
servidor, así que en un build de producción la rama que permitiría el endpoint
local **ya no existe en el código**. Comprobado a mano: el servidor arranca y
toda ruta que toca datos responde 500 con ese mismo error.

Eso hace la garantía más fuerte, no más débil. Así que `npm run prod:local`
sirve la compilación real **sin base de datos** —el modo que la aplicación ya
soporta— y `npm run test:e2e:prod` cubre lo que no depende de datos: que el
build arranca, que los bundles llevan hash, que no hay errores de consola, que
el tema oscuro se comporta, que no desborda y que la portada no descarga ningún
motor. El aula sigue en `dev:local`, y está dicho en los tres sitios donde
alguien lo buscaría.

### Lo añadido para que no vuelva

| | |
|---|---|
| `tests/e2e/responsive.spec.ts` | 8 anchos × 16 pantallas · `scrollWidth <= innerWidth` |
| `tests/e2e/accessibility.spec.ts` | axe WCAG 2.1 A/AA + recorrido con teclado + foco de diálogo |
| `tests/e2e/production-build.spec.ts` | la compilación real |
| `scripts/prod-local.mjs` | `next build` + `next start` sobre `.next-local/` |
| `scripts/lib/local-services.mjs` | los servicios del sandbox, compartidos por los dos entornos |
| `distDir` por entorno | `dev`, `build` y el sandbox compilado dejan de pisarse (**R10 cerrado**) |
| `@axe-core/playwright` | única dependencia nueva de la fase, sólo de desarrollo |

`signIn` dejó de ser intermitente: el envío del formulario espera a la
hidratación con `expect(...).toPass()`. No es «reintentar hasta que pase» —el
botón existe y está habilitado antes de que React enganche su `onSubmit`, así
que el clic no hace nada y no hay forma de observarlo de otra manera—.

### Lo que se auditó y se dejó como estaba

- **Dependencias.** 21 vulnerabilidades de `npm audit`, todas con corrección
  sólo por salto mayor (`tar` 6→7, `vitest` 3→5, `firebase-tools` 14→15,
  `firebase-admin` 13→14, `next` 15→16) y ninguna con vía alcanzable desde
  producción. Actualizar cinco mayores en la fase de endurecimiento introduce
  más riesgo del que elimina.
- **La marca.** Cero `UINexus` en copy visible. Lo que queda son claves de
  `localStorage` (`uinexus-theme`, `uinexus-home-visit`) y nombres de
  infraestructura: renombrarlas reiniciaría el tema de todo el mundo y haría
  que el muro pareciera nuevo.
- **Registro.** Ocho `console.*` en producción, todos con prefijo y ninguno
  imprime tokens, cookies ni URLs firmadas.
- **El alcance del guardián del endpoint.** Cubre la variable de este proyecto;
  el SDK de AWS honra además las suyas, que no se pueden desactivar sin romper
  despliegues legítimos. Corregido el comentario, que decía más de lo que
  garantizaba.

### Validación

```
npm run typecheck        ✅
npm run lint             ✅
npm test                 ✅   46 archivos · 982 passed | 1 skipped (983)
npm run test:integration ✅   17 archivos · 237 passed
npm run build            ✅
npm run test:e2e         ✅   21 recorridos
npm run test:e2e:prod    ✅   5 sobre la compilación real
```

Accesibilidad: **cero incidencias de axe** en las diez pantallas principales.

### Navegador

Recorrido a mano sobre `npm run dev:local`, en claro y en oscuro, a 1280×900,
390×844, 375×812 y 360×800: portada, `/explore`, `/courses`, `/about`, `/login`
y el menú móvil. `document.documentElement.scrollWidth` igual a
`window.innerWidth` en los cuatro anchos, cero errores de consola, el primer
`Tab` cae en «Saltar al contenido» con contorno visible y abrir el menú móvil
lleva el foco al botón de cerrar.

**R18 cerrado en navegador de verdad.** Se ejecutó `r-runner.worker.js` contra
un `LabDataset` de una hoja: el Worker anidado de webR arrancó, `nex_sheet("Ventas")`
devolvió un `data.frame` con sus tres filas, `sum(df$total)` dio 360 y
`nex_sheets()` listó el catálogo. En la misma ejecución `download.file()`,
`install.packages()` y `url()` siguieron enmascarados con su mensaje, y un
nombre construido con `paste0()` falló con el error que explica que la
referencia tiene que ser literal (**R16**, tal como está documentado).

Lo que **no** se recorrió a mano: las pantallas con sesión iniciada. Escribir una
contraseña en un formulario queda fuera de lo que el asistente hace, así que esa
parte la cubren los 21 recorridos de Playwright, que inician sesión de verdad
como docente y como estudiante.

### Próximo punto exacto

**Ninguno.** El roadmap está cerrado y no se abrió una Fase 7. Las líneas
futuras posibles están en `docs/NEXTUDIO-ROADMAP.md` §10; la decisión de cuál
—o ninguna— es humana.
