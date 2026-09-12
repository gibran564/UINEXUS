# Problemas de UX, clasificados

Escala:

- **P0 — Bloqueante.** Impide utilizar correctamente una función.
- **P1 — Alto.** Deteriora significativamente la UX o la comprensión.
- **P2 — Medio.** Perceptible, no crítico.
- **P3 — Bajo.** Pulido.

## Nota sobre la ausencia de P0

**No se ha encontrado ningún problema P0.** Ninguna función de Nextudio está rota:
se puede publicar, entregar, moderar, explorar y compartir un proyecto. Los
problemas de este informe son de densidad, jerarquía, consistencia y arquitectura
de información, no de funcionamiento.

Decirlo importa porque cambia la estrategia: no hay incendios que apagar antes
del rediseño. La siguiente fase puede ser estructural desde el primer día.

---

## P1 — Alto

### UX-01 · Iniciar sesión no lleva al inicio

- **Evidencia**: `src/components/auth/login-form.tsx:~95` —
  `const next = requestedNext?.startsWith('/') … : '/dashboard'`. El enlace
  «Iniciar sesión» del navbar (`navbar.tsx`, `href="/login"`) no lleva `?next`.
- **Pantalla**: `/login` → `/dashboard`
- **Impacto**: el producto decidió que el muro es el inicio autenticado
  (`app/page.tsx` + `HomeGate`) y el flujo de entrada aterriza en «Tus
  proyectos». Cada primera sesión del día empieza en la pantalla equivocada.
- **Causa probable**: el `next` por defecto es anterior al rediseño del inicio y
  no se actualizó.
- **Componente**: `components/auth/login-form.tsx`
- **Solución**: cambiar el destino por defecto a `/`.
- **Dificultad**: trivial (una línea).

### UX-02 · El muro empieza a 1,2 pantallas del borde superior

- **Evidencia**: `docs/audit/feed-density.py` → 992 px (estudiante) / 1088 px
  (docente) hasta la primera publicación, a 1440×900 con tres tarjetas de
  atención.
- **Pantalla**: `/` autenticado
- **Impacto**: el muro no se ve al entrar. La actividad de la clase se descubre
  sólo si se hace scroll deliberado.
- **Causa probable**: la prioridad se paga en altura (pila vertical) en lugar de
  en posición (carriles). Ver `wall.md` §0.
- **Componente**: `components/home/academic-home.tsx`
- **Solución**: carril fijo para atención/materias; muro desde el píxel 0.
- **Dificultad**: alta (cambio estructural).

### UX-03 · Una tarjeta de proyecto ocupa 654 px; la portada es el 62 %

- **Evidencia**: `aspect-16/10` sobre una columna de texto de 628 px = 404 px de
  imagen. 1,3 publicaciones visibles a 1440×900; 1,6 a 1920×1080; **2,0 en un
  móvil de 390 px**.
- **Pantalla**: `/` autenticado, muro
- **Impacto**: no hay muro que escanear. Y el defecto empeora cuanto mejor es la
  pantalla, que es lo contrario de lo que espera cualquiera.
- **Causa probable**: la portada escala con el ancho de la columna mientras el
  alto del viewport no.
- **Componente**: `components/home/academic-home.tsx` → `FeedCard`
- **Solución**: miniatura 96 × 60 px de alto fijo. Portada grande sólo en
  `/explore`, `/courses/[slug]` y `/[handle]`.
- **Dificultad**: baja.

### UX-04 · Una publicación del muro no tiene URL

- **Evidencia**: `FeedCard` → `event.publicationId ? <button onClick={…}>` abre
  `PublicationDetail` en un `<dialog>`. No hay ruta `/muro/[id]`.
- **Pantalla**: `/` autenticado
- **Impacto**: no se puede enlazar ni compartir una publicación, ni volver a ella
  con el botón Atrás, ni recuperarla tras recargar. En un producto cuyo lema es
  «Diseña. Publica. **Comparte.**», la unidad del muro no es compartible.
- **Causa probable**: el detalle se añadió como modal sin ruta asociada.
- **Componente**: `components/home/publication-detail.tsx`
- **Solución**: ruta `/muro/[id]` que renderice el mismo contenido; el modal pasa
  a ser una presentación interceptada de esa ruta.
- **Dificultad**: media.

### UX-05 · Las pestañas de una materia no escriben en la URL

- **Evidencia**: `course-workspace.tsx:41-47` lee `params.get('tab')` para
  inicializar `useState`, pero ningún `router.replace` lo escribe al cambiar.
  Mismo patrón en `assignment-detail.tsx` y `dashboard-client.tsx`.
- **Pantalla**: `/aula/[courseId]`, `/dashboard`, detalle de tarea
- **Impacto**: pulsar Atrás después de cambiar de pestaña **sale de la materia
  entera**. No se puede enlazar «los recursos de esta materia». Recargar pierde
  el sitio.
- **Causa probable**: el estado de pestaña se resolvió como estado local.
- **Componente**: `components/aula/course-workspace.tsx`, `dashboard-client.tsx`
- **Solución**: `router.replace` con `?tab=` (shallow); el estado sigue viviendo
  en la URL como ya hace `/explore` con sus filtros.
- **Dificultad**: baja.

### UX-06 · Patrón ARIA de pestañas incompleto en seis sitios

- **Evidencia**: 6 × `role="tablist"`, 0 × `role="tabpanel"`, 0 × `aria-controls`,
  0 × navegación con flechas (`grep` sobre `src/**`).
- **Pantalla**: `/aula/[courseId]`, detalle de tarea, recursos, workflow,
  `/dashboard`, entregables
- **Impacto**: un lector de pantalla anuncia «pestaña, 1 de 5» y promete
  interacción con flechas que no existe. No hay forma anunciada de llegar al
  panel. El contenido sigue siendo alcanzable con Tab, así que degrada pero no
  bloquea.
- **Causa probable**: se aplicaron los roles sin el resto del patrón.
- **Componente**: seis archivos, ver `accessibility.md` A-03
- **Solución**: o completar el patrón (`id`/`aria-controls`/`tabpanel` + flechas)
  o —mejor— bajar a una lista de enlaces con `aria-current`, que además arregla
  UX-05 de paso.
- **Dificultad**: media.

### UX-07 · Cuatro nombres para el mismo concepto

- **Evidencia**: «Cursos» (`/courses`), «Aula» (`/aula`), «Materias»
  (`aula-home.tsx`), «Grupos» (`publication-composer.tsx`, filtro del muro),
  además de «curso» como filtro de `/explore`.
- **Pantalla**: navbar, `/courses`, `/aula`, `/`, `/explore`
- **Impacto**: el usuario no sabe si «Cursos» y «Aula» son lo mismo. Lo son casi:
  `/courses/[slug]` es la galería pública de una materia y `/aula/[courseId]` es
  su espacio de trabajo, pero nada en la interfaz lo dice.
- **Causa probable**: dos etapas del producto (galería pública primero, aula
  después) que nunca unificaron vocabulario.
- **Componente**: `lib/constants.ts`, `navbar.tsx`, y toda la copia
- **Solución**: un glosario y un solo término visible. Ver
  `information-architecture.md` §4.
- **Dificultad**: baja en el código, media en la decisión.

### UX-08 · El estudiante no puede filtrar su propio muro

- **Evidencia**: `academic-home.tsx` — el `<select>` de `feedCourseId` está
  dentro de `{teachesSomewhere && …}`. Y el servidor
  (`api/home/route.ts:~145`) rechaza con 404 cualquier `courseId` en el que no se
  sea docente.
- **Pantalla**: `/` autenticado
- **Impacto**: con cuatro materias, un estudiante recibe un muro mezclado sin
  ninguna forma de separarlo. Es el rol mayoritario y el único sin filtro.
- **Causa probable**: el filtro se diseñó para la moderación docente.
- **Componente**: `components/home/academic-home.tsx`, `app/api/home/route.ts`
- **Solución**: permitir el filtro a cualquier miembro de la materia, con chips
  en lugar de `<select>`.
- **Dificultad**: baja.

### UX-09 · Tres rutas para una sola pantalla de entrada, con estado desincronizable

- **Evidencia**: `/login` y `/register` renderizan el mismo `<LoginForm>` con
  distinto `initialMode`; `/signup` hace `redirect('/register')`. El selector de
  modo vive dentro del formulario y no toca la URL.
- **Pantalla**: `/login`, `/register`, `/signup`
- **Impacto**: se puede estar en `/register` viendo «Iniciar sesión». Compartir
  la URL no reproduce la pantalla.
- **Componente**: `components/auth/login-form.tsx`
- **Solución**: mantener las dos rutas como puntos de entrada semánticos y hacer
  que el conmutador navegue (`router.replace`) en lugar de cambiar estado local.
- **Dificultad**: baja.

### UX-10 · Identidades duplicadas en producción

- **Evidencia**: `sitemap.xml` de producción publica `@christian-gibran-esp` y
  `@christian-gibran-esp-2`, y dos cursos con nombres casi idénticos
  (`diseno-centrado-en-el-usuario` y `…-8c29`).
- **Pantalla**: `/[handle]`, `/courses`
- **Impacto**: dos perfiles de la misma persona, con proyectos repartidos. Dos
  galerías para una materia. Cara al público y en el sitemap.
- **Causa probable**: `reserveHandle` es idempotente por `uid`
  (`writes.ts:79`), así que el sufijo `-2` implica **dos UID distintos** para la
  misma persona: dos métodos de autenticación (Google y correo) que no quedaron
  vinculados. **Requiere confirmación en la consola de Firebase Auth.**
- **Componente**: `lib/server/writes.ts` + configuración de Firebase Auth
- **Solución**: activar la vinculación de cuentas por correo verificado; limpiar
  los duplicados existentes; en el aula, impedir dos materias con el mismo nombre
  en el mismo periodo o avisar al crearlas.
- **Dificultad**: media (toca datos de producción, fuera del alcance de esta fase).

---

## P2 — Medio

### UX-11 · El saludo es el elemento más grande de la pantalla

`<h1>Hola, {nombre}</h1>` en `text-h1` (40 px, serif) tanto en `/` como en
`/aula`. Consume el punto de mayor atención sin informar de nada, y se repite
idéntico en dos pantallas contiguas.
**Solución**: eliminarlo del inicio autenticado; el `<h1>` accesible pasa a ser
«Tu muro» en `sr-only` o un título discreto. Dificultad: trivial.

### UX-12 · «Ver mis materias» duplica el navbar

Botón en la cabecera de `/` a ~200 px del enlace «Aula» del navbar, que lleva al
mismo sitio.
**Solución**: eliminar; las materias pasan al carril. Dificultad: trivial.

### UX-13 · El compositor ocupa un panel completo estando cerrado

`panel p-4` con un `<button class="field">` que imita un campo de texto: 118 px
verticales para un control cerrado, delante del muro.
**Solución**: fila de una línea o botón en la cabecera del muro. Dificultad: baja.

### UX-14 · «Desde tu última visita» cuenta pero no señala

Resume «1 actividad, 2 recursos, 4 proyectos» y luego el muro no marca cuáles.
Hay que releerlo entero para encontrar lo nuevo.
**Solución**: separador «nuevo desde tu última visita» dentro de la lista, usando
la misma marca de `localStorage` que ya existe. Dificultad: baja.

### UX-15 · El muro no lleva a ninguna parte al terminarse

`FEED_LIMIT = 20` por bloque, sin paginación, sin «cargar más», sin aviso. El
muro simplemente se acaba.
**Solución**: paginación por cursor o «cargar más», y un cierre explícito.
Dificultad: media.

### UX-16 · Dos afordances idénticas con comportamiento distinto

En la misma lista, unas tarjetas navegan (`<Link>`) y otras abren un modal
(`<button>`), con exactamente el mismo aspecto. El usuario no puede predecir si
va a perder el sitio.
**Solución**: se resuelve con UX-04 (todo navega a una URL). Dificultad: baja
una vez resuelto UX-04.

### UX-17 · Desde el inicio autenticado no hay camino a `/explore`

El muro sólo enseña las materias propias. El escaparate —lo que da sentido a
«publicar y compartir»— queda a un enlace de navbar que compite con «Inicio» y
«Aula».
**Solución**: carril derecho con «Del resto de Nextudio» (≥1440 px), o un pie de
muro con 3 proyectos públicos recientes. Dificultad: media.

### UX-18 · La cola de moderación vive dentro del muro

`PublicationModeration` se inserta en `/` cuando hay pendientes, y
`TeacherTaskCard` enlaza con `#publication-moderation` —un ancla a la misma
pantalla—. Revisar publicaciones es una tarea con su propio ritmo; hoy es un
bloque que aparece y desaparece dentro del inicio.
**Solución**: pantalla o panel propio, con enlace desde el carril. Dificultad: media.

### UX-19 · Seis paddings verticales de página distintos

`py-6`, `py-8`, `py-10`, `py-12`, `py-14`, `py-24` según la pantalla. `/` usa
`py-8`, `/aula` `py-10`, `/publish` `py-12`, `/login` `py-14`. Navegar entre
pantallas mueve el contenido verticalmente sin motivo.
**Solución**: un valor de página (`py-10`) y excepciones justificadas.
Dificultad: trivial.

### UX-20 · Sin estado de carga estructurado en el inicio autenticado

`AcademicHome` devuelve `<p>Abriendo tu inicio…</p>` centrado a `py-24`. Tras la
carga, la página salta a la maquetación real. `ProjectGridSkeleton` ya existe y
hace esto bien en la galería; el muro no lo aprovecha.
**Solución**: esqueleto con la retícula real. Dificultad: baja.

### UX-21 · El filtro por grupo es un `<select>` donde el sistema usa chips

`/explore` filtra con `.chip` enlazados (estado en la URL, funciona sin JS, se
puede compartir). El muro filtra con un `<select>` controlado. Mismo gesto, dos
implementaciones y dos aspectos.
**Solución**: chips, como en `/explore`. Dificultad: baja.

---

## P3 — Bajo

### UX-22 · El verbo del evento ocupa una línea entera
«Publicó una actividad» / «Añadió un recurso»: 24 px verticales por tarjeta para
un metadato de tipo. Pasa a etiqueta junto al título.

### UX-23 · Botón redundante en cada tarjeta del muro
«Ver la actividad» bajo un título que ya dice qué es. 48 px por tarjeta.
La tarjeta entera debería ser el objetivo.

### UX-24 · «Aprobado por {nombre}» en la tarjeta
Información de auditoría en una superficie de lectura. Va al detalle.

### UX-25 · Concatenación de audiencia sin límite
`audience.map(c => c.name).join(' · ')` en `api/home/route.ts`. Una publicación a
cinco grupos genera una línea muy larga en la tarjeta. Truncar a dos + «y 3 más».

### UX-26 · `/publish` usa `text-h2` para su `<h1>` en los estados de error
`publish-flow.tsx:181` y `:213` (`<h1 className="font-display text-h2">`) frente
a `text-h1` en los pasos normales. Salto de escala sin motivo.

### UX-27 · El escaparate público no menciona el aula
`Landing` habla de publicar y explorar; nada indica que existe un espacio de
materias, tareas y entregas. Un estudiante nuevo no sabe que hay algo más.

### UX-28 · «Recursos IA» como nombre de pestaña
Agrupa prompts, Skills, recursos y enlaces. El nombre describe la tecnología, no
la función, en un producto que en el resto de la copia hace lo contrario con
acierto («un archivo HTML», no «static site»).

---

## Resumen

| Prioridad | Nº | Peso |
|---|---|---|
| P0 | 0 | — |
| P1 | 10 | Estructura del inicio, densidad, URLs, ARIA, vocabulario |
| P2 | 11 | Jerarquía, consistencia, estados |
| P3 | 7 | Pulido |

Los P1 se concentran en dos causas raíz:

1. **La prioridad se paga en altura** en lugar de en posición (UX-02, UX-03,
   UX-11, UX-12, UX-13).
2. **El estado de la interfaz no vive en la URL** (UX-04, UX-05, UX-09, UX-16).

Atacar esas dos causas resuelve, entera o parcialmente, la mitad del inventario.
