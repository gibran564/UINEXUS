# Auditoría integral de Nextudio

Fecha: **2026-09-06** · Rama: `codex/unified-academic-publishing` ·
Producción auditada: `https://uinex.vercel.app`

**Nada implementado.** Este directorio es sólo documentación de análisis.

## Documentos

| Archivo | Contenido |
|---|---|
| [`pages.md`](pages.md) | Mapa completo de pantallas, rutas y propósito |
| [`wall.md`](wall.md) | **Auditoría profunda del muro** — el documento principal |
| [`home-vs-wall.md`](home-vs-wall.md) | Qué debería ser el inicio, con recomendación inequívoca |
| [`student-profile.md`](student-profile.md) | Perfil del estudiante y carril de contexto |
| [`information-architecture.md`](information-architecture.md) | IA actual vs propuesta, árbol de navegación, glosario |
| [`ux-problems.md`](ux-problems.md) | 28 problemas clasificados P0–P3 |
| [`ui-consistency.md`](ui-consistency.md) | Sistema visual y consolidación de componentes |
| [`responsive.md`](responsive.md) | Desktop / laptop / tablet / móvil |
| [`accessibility.md`](accessibility.md) | Contrastes calculados y patrones ARIA |
| [`technical-map.md`](technical-map.md) | `pantalla → ruta → layout → componente → estilos` |
| [`redesign-proposal.md`](redesign-proposal.md) | Propuesta conceptual, con diagramas |
| [`priorities.md`](priorities.md) | Backlog priorizado y orden de trabajo |
| [`feed-density.py`](feed-density.py) | Modelo reproducible de densidad del muro |

---

## Método y limitaciones

### Lo que sí se hizo

- **Código fuente completo**: los 170 archivos de `src/**`, con lectura íntegra
  de `globals.css` (613 líneas), `academic-home.tsx` (523), `api/home/route.ts`,
  `home-feed.ts`, `navbar.tsx`, `landing.tsx`, `publication-composer.tsx`,
  `publication-detail.tsx`, `course-workspace.tsx`, `aula-home.tsx`,
  `dashboard-client.tsx`, `project-card.tsx`, `profile-editor.tsx`, y recuento
  sistemático de utilidades (escala tipográfica, radios, breakpoints, ARIA,
  `overflow`, `sticky`).
- **HTML real de producción**: descargado de las 10 rutas públicas más
  `sitemap.xml` y `robots.txt`, con verificación del orden de encabezados
  excluyendo los `<script>` de streaming de React.
- **Contrastes calculados**, no estimados: fórmula de luminancia relativa de
  WCAG sobre los 30 tokens de color de ambos temas.
- **Densidad calculada**, no estimada: `feed-density.py` deriva cada altura de un
  valor concreto de `globals.css` o de una utilidad de Tailwind presente en el
  código. Reproducible con `python docs/audit/feed-density.py`.

### Lo que no se pudo hacer

**Las herramientas de lectura del navegador estuvieron bloqueadas durante toda
la sesión** (`Policy check temporarily unavailable` en `get_page_text`,
`read_page`, `screenshot` y `javascript_tool`; la navegación funcionaba, la
lectura no). En consecuencia:

- **No hay capturas de pantalla.** El punto 14 del encargo no se pudo cumplir.
- **No se pudo iniciar sesión** para recorrer las pantallas autenticadas en
  producción. Todo el análisis del muro, el aula y el panel viene del código y
  del modelo de densidad, no de observación directa.
- Quedan pendientes de confirmación visual, y están marcados como tales en cada
  documento: el desbordamiento de pestañas en móvil (`responsive.md` R-08), el
  recorrido de teclado, los anuncios de lector de pantalla, el contraste efectivo
  del navbar translúcido y el zoom al 200 %.

Ningún hallazgo de este informe depende de una impresión visual: todos son
verificables releyendo el archivo y la línea que se cita.

### Skills utilizadas

Instaladas con `npx skills@latest add emilkowalski/skills` (12 skills). Tras
revisar sus descripciones:

| Skill | ¿Usada? | Para qué |
|---|---|---|
| `emil-design-eng` | **Sí** | Criterio de calidad de UI y de detalle en la evaluación de `FeedCard` y del sistema de componentes |
| `apple-design` | **Sí** | Restricción, jerarquía y feedback; el criterio de «no añadir componentes sin función» de `redesign-proposal.md` §10 |
| `improve-ui` (integrada) | **Sí** | Postura de auditoría en sólo lectura sobre la evidencia del propio producto, con planes autocontenidos para otro agente |
| `ux-heuristics` (integrada) | **Sí** | Clasificación por severidad P0–P3 y análisis de navegación |
| `refactoring-ui` (integrada) | **Sí** | Jerarquía visual, densidad, escalas y consolidación de tokens |
| `animate-expo`, `write-swift`, `ask-sonner` | No | Otras plataformas o librerías que este proyecto no usa |
| `animation-vocabulary`, `pick-ui-library`, `prototype` | No | Fuera del alcance de una auditoría |
| `animate`, `find-animation-opportunities`, `improve-animations`, `review-animations` | No | Nextudio tiene una sola transición (`160ms`, `--ease`) y `prefers-reduced-motion` bien resuelto. El movimiento no es un problema aquí, y auditarlo habría sido usar una skill por usarla |

---

## Resumen ejecutivo

Nextudio es un producto **mejor construido de lo que su interfaz deja ver**. Tiene
un lenguaje visual propio, declarado y argumentado decisión por decisión en el
CSS; una frontera de privacidad resuelta en el servidor; un orden del muro
derivado de fechas y estados en lugar de un algoritmo de popularidad; y una base
de accesibilidad muy por encima de la media de un proyecto académico. **No hay
ningún problema P0: ninguna función está rota.**

El problema es de **eje**, no de calidad.

La prioridad se paga en **altura**: lo importante va arriba, y como todo lo
importante va arriba, la pila crece hasta que el muro —el contenido que cambia a
diario— queda a **992 px** del borde superior. A 1440×900 eso es 1,2 pantallas de
scroll antes de ver la primera publicación. Y cuando llega, **sólo cabe una**:
una tarjeta de proyecto mide 654 px, de los cuales 404 son la portada.

El dato que resume la auditoría: **un móvil de 390 px muestra 2,0 publicaciones
de proyecto y un monitor de 1920 muestra 1,6.** Cuanto mejor es la pantalla, peor
es el muro. No es un problema de estética; es un defecto de escalado con una
causa única y localizada.

Tres correcciones de fondo:

1. **Pagar la prioridad en posición, no en altura.** Lo que caduca va a un carril
   fijo, donde no se agota y no desaparece al hacer scroll. El muro ocupa la
   pantalla desde el primer píxel.
2. **La miniatura sustituye a la portada en el muro**, sin eliminarla: 96 × 60 px
   distingue una página de otra —que es lo que el código pide— por 60 px en lugar
   de 404. La portada grande conserva su sitio en la galería, el curso y el
   perfil, donde el objetivo declarado sí es mirar trabajo.
3. **El estado visible vive en la URL.** `/explore` ya lo hace bien y lo
   argumenta; el resto del producto no lo copió, y de ahí salen cuatro problemas
   distintos: publicaciones que no se pueden compartir, pestañas que rompen el
   botón Atrás, un patrón ARIA incompleto en seis sitios y un formulario de
   entrada cuya URL no corresponde a lo que se ve.

Y un cambio de una línea que hoy contradice toda la arquitectura de inicio:
**tras iniciar sesión, el destino por defecto es `/dashboard`, no `/`.** El
producto decidió que el muro es el inicio autenticado y el flujo de entrada nunca
se enteró.

---

## Las 15 preguntas, contestadas

### 1. ¿Debería el muro convertirse en el inicio autenticado?

**Ya lo es.** `app/page.tsx` → `HomeGate` → `AcademicHome`. La decisión está
tomada, es correcta y no hay que revertirla.

Lo que falla es que **no lo es en la pantalla**: la primera publicación cae a 992
px (estudiante) o 1088 px (docente). El muro es el inicio por ruta y el pie de
página por maquetación. Hay que hacer que la pantalla cumpla lo que la ruta ya
promete, y corregir el destino post-login.

### 2. ¿Las publicaciones son demasiado grandes?

**Sí, y la causa es una sola.** 654 px con portada, de los cuales 404 son la
imagen: el **62 %** de la tarjeta.

Las tarjetas de texto (209 px) son razonables. No hay que reducir padding,
tipografía ni separación por todas partes: hay que arreglar un elemento.

### 3. ¿Qué tamaño y densidad deberían tener?

**~139 px por tarjeta compacta. 5–7 publicaciones por pantalla en escritorio,
5–6 en móvil.**

| Viewport | Hoy | Propuesta |
|---|---|---|
| 1366 × 768 | 1,1 | 5,1 |
| 1440 × 900 | 1,3 | 6,0 |
| 1920 × 1080 | 1,6 | 7,3 |
| 390 × 844 | 2,0 | 5,6 |

Por debajo de 4 el muro no se escanea; por encima de 8 con miniatura empieza a
parecer un gestor de archivos.

### 4. ¿Cuánta información sin abrir?

Autor con avatar, **materia**, fecha relativa, tipo como etiqueta, título
completo, miniatura sólo si es página/proyecto, resumen a una línea, y una cuarta
línea **sólo si hay señal** (fecha de entrega, «requiere cambios», «pendiente de
aprobación»).

Fuera: contenido completo, audiencia, «aprobado por». Y no deben existir:
comentarios, «me gusta», contadores de vistas.

### 5. ¿Tiene sentido una sidebar con información del estudiante?

**Sí, pero no por el motivo de la hipótesis.**

Un carril que sólo dice quién soy es decoración con datos dentro: ya sé quién
soy, y a la tercera sesión deja de mirarse. Lo que justifica el carril es
**descargar la columna central**: sacar «Necesita tu atención» de ahí devuelve
~600 px al muro y, de paso, hace que lo urgente **deje de desaparecer al hacer
scroll**. Fijo es más prioritario que arriba.

La identidad viaja de acompañante, no como motivo.

### 6. ¿Qué debería contener?

Por orden: **identidad en dos líneas** (avatar, nombre, carrera · semestre) →
**«Necesita tu atención», máx. 3 + «ver las N»** → **«Tus materias»** con
contador y «unirme con código».

Dos datos importantes: carrera y semestre **ya se recogen** en
`/dashboard/profile` y hoy se descartan; y `HomePayload.courses` **ya llega al
navegador** en cada carga del inicio, donde sólo alimenta un `<select>` que ven
los docentes. El carril **no cuesta ni una petición adicional**.

Fuera del carril: estadísticas, progreso del semestre, logros, proyectos propios,
actividad propia y accesos rápidos. Ninguno cambia lo que voy a hacer en los
próximos cinco minutos. El propio código ya rechazó los KPI dos veces, con buen
argumento.

**Y si sólo queda la identidad, no hay carril.**

### 7. Si no, ¿qué patrón sería superior?

Sí procede, así que el patrón alternativo sólo aplica por debajo de 1024 px: en
tablet y móvil el carril **se transforma** en chips de materia + tira horizontal
de atención sobre el muro. No se comprime a 180 px: un carril estrecho es peor
que ningún carril.

### 8. ¿Cuál debería ser el layout desktop?

- **≥ 1440 px**: `contexto 280 | muro 600–640 | descubrir 300`, ambos carriles
  sticky bajo el navbar de 64 px.
- **1024–1439 px**: dos zonas. El carril derecho **desaparece**, no se comprime.
- El carril derecho sólo se construye si se encuentra contenido que se gane el
  sitio (acceso a `/explore` y contexto de la materia activa). **Si no,
  dos columnas es el resultado correcto.** No hay que llenar espacio.

### 9. ¿Cómo debería transformarse en móvil?

Una columna, **mismo orden vertical** que en escritorio: materias (chips con
scroll-x) → atención (tira horizontal, 1 + peek) → muro. Miniatura de 72 × 45,
tarjeta de ~125 px, 5,6 publicaciones visibles. La identidad no aparece: ya está
en el avatar del navbar.

Que la jerarquía sea la misma en los cuatro anchos es la propiedad que el diseño
actual defiende con razón y que hay que conservar.

### 10. ¿Qué debería desaparecer?

`<h1>Hola, {nombre}</h1>` · el botón «Ver mis materias» · el verbo del evento
(«Publicó una actividad») · el botón `btn-sm` de cada tarjeta · los dos `<h2>`
serif de sección del muro · el `<select>` de filtro por grupo · los tokens
`--text-small`, `--text-body` y `--radius-lg` (definidos, cero usos) · las cuatro
copias literales de clases de pestaña.

### 11. ¿Qué debería conservarse?

La regla «las tareas ganan espacio al contenido social, siempre» · el orden
explicable de `ATTENTION_ORDER`, sin algoritmo de popularidad · la ausencia de
métricas sociales · el endpoint único `/api/home` · la frontera de privacidad en
el servidor · el `<dialog>` nativo con retorno de foco · `GeneratedCover` ·
`.chip` pintado desde `aria-current` · `.section-mark` · la pareja
Fraunces + Inter · los tokens de color de ambos temas · el foco visible que nunca
se elimina · **y todo el lenguaje visual de papel y tinta.**

### 12. Los cinco problemas de UX más importantes

1. **El muro empieza a 1,2 pantallas del borde superior** (UX-02).
2. **Una tarjeta de proyecto mide 654 px y la portada es el 62 %** (UX-03).
3. **Iniciar sesión lleva a `/dashboard`, no al inicio** (UX-01).
4. **El estado visible no vive en la URL**: publicaciones sin permalink,
   pestañas que rompen el botón Atrás, ARIA de pestañas incompleto en seis sitios
   (UX-04, UX-05, UX-06).
5. **Cuatro nombres para un concepto** — curso, materia, grupo, aula — y una
   materia que vive en dos árboles sin ningún enlace entre ellos (UX-07, IA-01).

### 13. Los cinco cambios con mejor relación impacto/esfuerzo

1. **Destino post-login `/dashboard` → `/`.** Una línea.
2. **Miniatura en lugar de portada en el muro.** Un componente; densidad ×3.
3. **`overflow-x-auto` en las seis filas de pestañas.** Corrige un desbordamiento
   que hoy afecta a **cualquier móvil en el rol docente** (5 pestañas ≈ 444 px en
   350 px disponibles).
4. **Quitar saludo, botón duplicado, verbo y botón por tarjeta.** ~150 px
   recuperados por pantalla, cero funcionalidad perdida.
5. **`<SegmentedNav>` + pestaña en la URL.** Un solo trabajo que arregla la
   consistencia visual, el botón Atrás y el patrón ARIA a la vez.

### 14. ¿Escala a varias materias y grupos?

**Los datos sí; la interfaz no.**

Escala bien: `/api/home` sólo recorre las materias de las que se es miembro, con
límites aplicados al final; `sortEventsReservingAssignments` impide que el
contenido social desplace a las tareas por volumen; los filtros de `/explore`
viven en la URL.

No escala: con 6 materias, «Necesita tu atención» puede llegar a 12 tarjetas
(≈ 1900 px hasta el muro); el estudiante **no puede filtrar su propio muro**;
«De tu docente» mezclaría doce docentes; `/aula` mostraría 12 tarjetas y
`/courses` 12 galerías sin marcar cuáles son tuyas.

Y un límite técnico que conviene registrar: **`teacherTasksFor` hace un
`listSubmissionsByAssignment` por cada tarea publicada de cada materia**. Con 6
materias × 10 tareas son 60 consultas en el endpoint del inicio. Medirlo antes de
crecer.

El carril y el filtro por materia dejan de ser mejoras y pasan a ser requisitos
en cuanto haya más de dos materias por persona.

### 15. ¿Qué debería implementar primero el siguiente agente?

**Fase 0 (medio día, sin riesgo)** — A1 (post-login → `/`), A2 (miniatura), A5
(`overflow-x-auto`). Tres cambios pequeños que arreglan las tres cosas más
visibles del producto.

**Fase 1 (un día, sin cambios visibles)** — B1: partir `academic-home.tsx` (523
líneas) en `wall-layout`, `wall-rail`, `wall-feed` y `feed-card`. Nada del
rediseño se puede hacer con comodidad mientras todo viva en un archivo.

**Fase 2** — el rediseño del muro, en este orden: tarjeta compacta → carril →
rejilla por breakpoint → una sola lista → filtro por materia. La tarjeta primero
porque fija la densidad; el carril después porque su valor depende de que el muro
ya sea denso.

**Lo que no hay que hacer primero**: renombrar rutas, construir el carril
derecho, y sobre todo **no empezar por subir el contraste de los bordes** (D2):
es el cambio de mayor riesgo visual del backlog y conviene hacerlo con la
maquetación ya estable.

---

## Un apunte final

Este informe es duro con la maquetación del muro y con el vocabulario, y debe
serlo. Pero la conclusión honesta es que **Nextudio no necesita un rediseño de
identidad**: necesita que su interfaz deje ver lo que ya tiene detrás. El sistema
visual es propio y está bien pensado; el problema es que la pantalla más
importante del producto lo está usando en el eje equivocado.
