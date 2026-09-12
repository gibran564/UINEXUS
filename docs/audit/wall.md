# Auditoría del muro

Documento principal de esta auditoría. Todo lo que sigue está medido sobre
`src/components/home/academic-home.tsx`, `src/app/api/home/route.ts` y los
valores reales de `src/app/globals.css`. Los números son reproducibles:

```bash
python docs/audit/feed-density.py
```

---

## 0. El hallazgo que cambia el encuadre

**El muro ya es el inicio autenticado.** No es una propuesta pendiente: está
implementado. `src/app/page.tsx` renderiza `HomeGate`, que devuelve
`<AcademicHome />` cuando la sesión está resuelta y `<Landing />` cuando no.
`SessionScript` oculta el escaparate antes de la primera pintura para que quien
tiene sesión no vea un fogonazo de la portada pública.

Así que la hipótesis 1 («el muro debería ser el inicio») no hay que validarla:
hay que comprobar si **se cumple en la práctica**, y ahí es donde falla.

`/` es el muro por ruta, pero no lo es por pantalla. Lo que se ve al entrar es
esto, en este orden:

```
1. Saludo + botón «Ver mis materias»
2. «Desde tu última visita: …»
3. Necesita tu atención        (N tarjetas de tarea)
4. Requiere tu atención        (docentes)
5. Publicaciones pendientes    (docentes, si hay)
6. Compositor «Comparte algo…»
7. Filtro por grupo            (docentes)
8. ── De tu docente ──         ← aquí empieza el muro
9. ── Novedades de tu clase ──
```

Medido a 1440×900, con tres tarjetas de atención:

| Rol | Píxeles hasta la primera publicación | En pantallas |
|---|---|---|
| Estudiante | 992 px | **1,19** |
| Docente | 1088 px | **1,30** |

**Al abrir su inicio, nadie ve una sola publicación del muro sin hacer scroll.**
Esa es la contradicción central del producto: la ruta dice que el muro es el
inicio y la maquetación dice que el muro es el pie de página.

Y no es un accidente: el comentario de cabecera del componente lo declara como
regla —«las tareas ganan espacio al contenido social. Siempre»—. La regla es
correcta. La implementación de la regla, como pila vertical, es la que está mal:
convierte «prioridad» en «altura», y la altura es un recurso que se acaba.

---

## 1. Jerarquía visual

### Qué llama primero la atención

Por orden de peso óptico real:

1. **«Hola, {nombre}»** — `text-h1`, Fraunces, 40 px. Es el elemento más grande
   de la pantalla y no aporta ninguna información. Un saludo consume el punto de
   mayor atención de la página cada vez que se entra.
2. **Los `<h2>` de sección** — 28 px, serif, con la cruz de la retícula
   (`.section-mark`). Cuatro o cinco por pantalla.
3. **Las tarjetas de atención con `border-accent`** — el único uso de color
   estructural, y está bien empleado.
4. **Las portadas de proyecto** — 404 px de alto en una columna de 768 px. En
   términos de área son, con diferencia, lo más grande de la página, pero llegan
   tarde en el orden de lectura.
5. El contenido textual de las publicaciones.

### Qué debería llamar primero la atención

1. Lo que vence hoy o requiere cambios (hoy: puesto 3, correcto en orden pero
   caro en altura).
2. La primera publicación del muro (hoy: invisible sin scroll).
3. La identidad y el contexto de quien publica (hoy: `text-label`, 13 px, gris
   `--fg-subtle`, la línea más pequeña de la tarjeta).
4. El saludo (hoy: puesto 1).

La inversión es completa: lo decorativo está en la cima de la jerarquía y lo
accionable está debajo del pliegue.

### Relación autor · contenido · proyecto · materia · acciones

Dentro de `FeedCard` la línea de identidad es una sola cadena de 13 px:

```
[avatar 30px]  Nombre @handle · hace 2 h · Diseño Centrado en el Usuario
               Publicó una actividad          ← 14 px, gris
               Título de la actividad         ← 16 px, medium
               Resumen recortado a dos líneas ← 14 px, gris
               [portada 16:10 si es proyecto]
               [ Ver la actividad ]           ← botón secundario
```

Tres problemas:

- **El verbo ocupa una línea entera para no decir casi nada.** «Publicó una
  actividad», «Añadió un recurso», «Publicó un prompt». Es metadato de tipo, no
  narración: cabe en una etiqueta de 26 px al lado del título, o en el propio
  icono. Hoy cuesta 24 px verticales por tarjeta.
- **La materia va al final de la línea de autor**, en el color más apagado del
  sistema. En un producto que va a crecer a varias materias y grupos, la materia
  es el segundo dato más importante de una publicación, no el último.
- **El botón repite lo que la tarjeta ya es.** Cada tarjeta lleva un
  `btn-secondary btn-sm` de 36 px cuyo texto («Ver la actividad», «Ver el
  recurso») no añade nada que el título no diga. 48 px por tarjeta —el 23 % de
  una tarjeta de texto— para un objetivo que podría ser la tarjeta entera.

### Separación entre publicaciones

`space-y-3` (12 px) entre paneles con borde de 1 px sobre `--surface`. El borde
tiene un contraste de **1,25:1** contra el fondo (medido, ver
`accessibility.md`). A 12 px de separación y con un filete casi invisible, las
tarjetas se leen como un bloque continuo en lugar de como unidades. El diseño
apuesta por el filete en vez de la sombra —decisión buena y coherente con el
lenguaje «papel y tinta»— pero el filete elegido es demasiado tenue para hacer
el trabajo que se le ha encargado.

### Ruido y repetición

- El bloque «De tu docente» y el bloque «Novedades de tu clase» son **dos listas
  con tarjetas idénticas** separadas por 48 px y un `<h2>` serif de 28 px. La
  distinción es real y valiosa (quién publica cambia el peso de lo publicado),
  pero pagarla con dos cabeceras de sección a tamaño título es caro: la misma
  información cabe en una etiqueta dentro de la tarjeta.
- «Aprobado por {nombre}» aparece como una línea extra de 13 px bajo el botón.
  Es información de auditoría, no de lectura.
- El saludo de `/` («Hola, {nombre} — Lo que tienes que hacer y lo que está
  pasando en tus materias») y el saludo de `/aula` («Hola, {nombre} — Tus
  materias, tus tareas y tus entregas») son **el mismo encabezado dos veces**,
  en dos pantallas a un clic de distancia.

---

## 2. Tamaño de las publicaciones

### Anatomía medida

Columna de contenido: `container-page max-w-3xl` → **768 px máximo, siempre**,
sea el viewport de 1366 o de 1920. Dentro del `panel p-4` con avatar de 30 px y
`gap-3`, la columna de texto real es de **628 px**.

| Elemento | Valor | Alto |
|---|---|---|
| padding superior del panel | `p-4` | 16 px |
| línea de autor | `text-label` 13/1.45 | 19 px |
| verbo | `mt-1` + `text-sm` 14/20 | 24 px |
| título | `mt-0.5` + 16 px × 1.65 | 28 px |
| resumen | `mt-1` + `line-clamp-2` | 44 px |
| **portada (sólo proyecto)** | `mt-3` + `aspect-16/10` de 628 px | **404 px** |
| acción | `mt-3` + `btn-sm` | 48 px |
| padding inferior + bordes | | 18 px |
| separación | `space-y-3` | 12 px |
| **total con portada** | | **654 px** |
| **total sin portada** | | **209 px** |

**La portada es el 62 % de una tarjeta de proyecto.** Todo lo demás —autor,
título, resumen, materia, acción— ocupa 250 px; la imagen ocupa 404.

### Cuántas publicaciones caben

| Viewport | Columna | Ancho sin usar | Con portada | Sin portada |
|---|---|---|---|---|
| 1366 × 768 | 768 px | 598 px (44 %) | **1,1** | 3,4 |
| 1440 × 900 | 768 px | 672 px (47 %) | **1,3** | 4,0 |
| 1920 × 1080 | 768 px | 1152 px (60 %) | **1,6** | 4,9 |
| 768 × 1024 (tablet) | 704 px | 64 px (8 %) | 1,6 | 4,6 |
| 390 × 844 (móvil) | 350 px | 40 px (10 %) | **2,0** | 3,7 |

Dos lecturas, y la segunda es la que decide el rediseño:

1. **Sólo hay una publicación de proyecto visible a la vez en cualquier
   escritorio.** No hay muro: hay un carrusel vertical de una unidad.
2. **Un móvil de 390 px muestra más publicaciones de proyecto que un monitor de
   1920.** 2,0 contra 1,6. Esto no es un problema de «demasiado espacio en
   blanco»: es un defecto de escalado. La portada es `aspect-16/10` de la columna
   de texto, así que crece con el ancho disponible mientras el alto del viewport
   no crece igual. **Cuanto mejor es la pantalla, peor es el muro.**

### Veredicto sobre la hipótesis 2 («las publicaciones se sienten demasiado grandes»)

**Confirmada, con una corrección importante sobre la causa.**

Las tarjetas *de texto* (209 px) no son grandes: son razonables, quizá un 25 %
mejorables recortando el verbo y el botón. El problema no está repartido por
toda la tarjeta.

El problema es **un solo elemento**: la portada de proyecto a ancho completo con
proporción fija. Arreglar sólo eso lleva la tarjeta de 654 px a ~250 px y
multiplica por cuatro la densidad, sin tocar nada más.

Cuidado con la conclusión fácil: reducir padding, tipografía y separación en
toda la tarjeta sería trabajo repartido con poco efecto y coste de legibilidad.
El 62 % está en un sitio.

### ¿Y no necesita la portada ser grande?

La justificación que está escrita en el código es buena:

> «Una página compartida se enseña, no se menciona. Sin portada la tarjeta sería
> una línea de texto entre otras y nadie sabría que hay una interfaz al otro
> lado del botón.»

Es correcta y hay que conservarla. Pero «se enseña» no implica «ocupa 404 px».
Una miniatura de 96 × 60 px distingue una página de otra —que es lo que el
comentario pide— y cuesta 60 px en lugar de 404. La portada grande tiene su
sitio: en `/explore`, en `/courses/[slug]` y en `/[handle]`, donde el objetivo
declarado sí es mirar trabajo. En un muro cuyo objetivo es enterarse, no.

---

## 3. Densidad: qué merece estar siempre visible

Criterio aplicado: un dato se queda si responde **«¿me interesa esto?»** antes
de abrirlo. Si sólo se entiende después de abrirlo, no pertenece a la tarjeta.

### Siempre visible

| Dato | Por qué |
|---|---|
| Autor (avatar + nombre) | Decide la relevancia antes que el contenido: no es lo mismo la docente que un compañero |
| Materia / grupo | Con varias materias es el filtro mental principal. **Hoy va en gris al final de una línea de 13 px: debe subir** |
| Tipo (actividad, recurso, prompt, Skill, anuncio, página) | Cambia lo que se espera al abrir |
| Título | Es el contenido |
| Miniatura, sólo si es página/proyecto | Distingue una interfaz de otra |
| Fecha relativa | Decide si ya se vio |

### Comprimir

| Hoy | Propuesta |
|---|---|
| Verbo en línea propia (24 px) | Etiqueta de tipo junto al título, o icono de 16 px |
| Botón `btn-sm` por tarjeta (48 px) | La tarjeta entera es el objetivo; el botón sólo cuando hay una segunda acción real |
| Portada 16:10 a ancho completo (404 px) | Miniatura 96 × 60 (60 px) |
| Resumen a dos líneas (44 px) | Una línea; la segunda se gana al pasar el ratón o al abrir |
| Dos `<h2>` serif de sección (2 × 82 px) | Un solo muro, con la distinción docente/clase resuelta con una marca en la tarjeta y un filtro |

### Bajo interacción

- Segunda línea del resumen.
- «Aprobado por {nombre}».
- Audiencia completa cuando una publicación va a varios grupos (hoy se
  concatenan los nombres con ` · `, lo que puede desbordar la línea).

### Trasladar a otro sitio

- «Desde tu última visita: 1 actividad, 2 recursos» → a la cabecera del muro o a
  un separador dentro de la lista («nuevo desde tu última visita»), donde además
  cumple una función: marcar dónde dejó de leer.
- El compositor cerrado (118 px) → a un botón en la barra o a una tarjeta de una
  línea; hoy ocupa un panel completo para mostrar un campo falso.
- «Necesita tu atención» → a un carril lateral fijo, ver §6.

### El riesgo contrario

Compactar todo esto sin más deja una lista de líneas de texto grises: eso es
peor. Lo que sostiene la densidad sin convertirla en una hoja de cálculo es
exactamente lo que el sistema ya tiene y el muro no usa: **la miniatura**. Una
lista de 6 filas con miniatura se escanea; una lista de 6 filas de texto plano,
no. La miniatura no se elimina, se redimensiona.

---

## 4. Comportamiento responsive del muro

Hoy: **una sola columna en todos los anchos**. `container-page max-w-3xl` no
tiene ni un `md:` ni un `lg:`. Es la decisión declarada en el comentario del
componente:

> «Se lee sobre todo en el móvil, entre clase y clase. Una columna, tarjetas
> compactas y botones grandes: el mismo orden en cualquier ancho.»

La premisa (móvil primero) es sana y hay que conservarla. La conclusión (una
columna en todos los anchos) no se sigue de la premisa: que el móvil mande no
obliga a que el escritorio sea un móvil estirado. Hoy el precio es el 60 % del
ancho de un 1920 sin usar y la primera publicación fuera de la pantalla.

Detalles medidos:

- **Tablet 768 px** es el único ancho donde la proporción funciona: 704 px de
  columna, 8 % sin usar. Es el ancho para el que el muro está de hecho diseñado.
- **Móvil 390 px**: la portada baja a 219 px y la tarjeta a 392 px. Correcto.
  Ningún desbordamiento horizontal detectado en el muro.
- **El filtro por grupo del profesorado** es un `<select>` de ancho completo con
  `label` encima: 96 px verticales en móvil para un control que en escritorio
  debería ser una fila de chips (el sistema ya tiene `.chip`, y `/explore` ya lo
  usa exactamente así).
- **`>1280 px` no existe** en todo el proyecto: sólo hay dos `xl:` en el código
  (ambos en el navbar, para el conmutador de tema) y ningún `2xl:`. Nada en
  Nextudio reacciona por encima de 1280 px.

---

## 5. Navegación dentro del muro

| Problema | Evidencia |
|---|---|
| **Una publicación no tiene URL** | `FeedCard` abre `PublicationDetail` en un `<dialog>` cuando hay `publicationId`. No se puede enlazar, ni compartir, ni volver con Atrás |
| **Dos afordances con el mismo aspecto** | La misma tarjeta usa `<button>` (abre modal) o `<Link>` (navega) según el evento. Idénticos visualmente, comportamiento distinto |
| **No hay paginación ni «cargar más»** | `FEED_LIMIT = 20` por bloque en el servidor. Al llegar al final, el muro simplemente se acaba, sin decirlo |
| **Sin marca de leído/no leído** | «Desde tu última visita» resume el número pero no señala *cuáles*. Hay que releer para encontrar lo nuevo |
| **El muro no lleva a `/explore`** | Desde el inicio autenticado no hay ningún camino al trabajo publicado fuera de las propias materias, salvo el enlace del navbar. Es el agujero de *discoverability* del producto |
| **Filtro sólo para docentes** | `feedCourseId` sólo se ofrece a quien imparte. Un estudiante con cuatro materias no puede filtrar su propio muro |

Un acierto que conviene no perder: `PublicationDetail` usa `<dialog>` nativo con
`showModal()`, guarda el elemento activo y le devuelve el foco al cerrar. La
accesibilidad del modal está bien resuelta; el problema es que sea un modal.

---

## 6. Oportunidades

Ordenadas por relación efecto/esfuerzo.

1. **Miniatura en lugar de portada** — 654 px → ~250 px por tarjeta. Un
   componente, un cambio de clases. Multiplica ×4 la densidad de proyectos.
2. **Sacar «Necesita tu atención» de la columna** a un carril fijo. Devuelve
   ~600 px de altura al muro y, de paso, hace que las entregas dejen de
   desaparecer al hacer scroll: hoy la información más importante del producto se
   pierde de vista a los dos giros de rueda.
3. **Fusionar los dos bloques del muro** en una lista con marca de origen.
   Ahorra 82 px de cabecera y elimina la pregunta «¿en cuál de las dos listas
   estaba aquello?».
4. **Rejilla de dos o tres columnas por encima de 1024 px.** El ancho ya está
   pagado; hoy se tira.
5. **Permalink para cada publicación** (`/muro/[id]`), con el modal como
   presentación opcional sobre la ruta. Sin esto, el muro no es compartible, que
   es la mitad del nombre del producto.
6. **Filtro por materia para todo el mundo**, con `.chip`, no con `<select>`.
7. **Separador «nuevo desde tu última visita»** dentro de la lista, en lugar del
   resumen numérico de arriba.

---

## 7. Qué conservar

No todo esto está mal. Lo que sigue es bueno y un rediseño no debe romperlo:

- **La regla de prioridad.** «Las tareas ganan espacio al contenido social,
  siempre» es la decisión de producto correcta y distingue a Nextudio de un feed
  social. Lo que cambia es *cómo* se paga: con posición fija, no con altura.
- **El orden explicable.** `ATTENTION_ORDER` en `lib/home-feed.ts` deriva la
  prioridad de `dueAt`, del estado de la entrega y del avance del workflow. Sin
  algoritmo de popularidad. Se puede explicar en una frase a un estudiante que
  pregunte por qué algo está arriba. Conservar íntegro.
- **La ausencia de métricas sociales.** Sin «me gusta», sin comentarios, sin
  contador de vistas. Es una decisión de producto correcta para un aula y está
  bien argumentada en el código. No añadirlas.
- **Un solo endpoint (`/api/home`).** El muro se pinta de una vez, no en
  cascada. Buena arquitectura de datos que además ya envía las materias del
  usuario al cliente (ver `student-profile.md`).
- **La frontera de privacidad en el servidor.** Lo que no se puede ver no llega
  al navegador. No tocar.
- **La distinción docente / clase.** Es información real. Cambia el soporte (de
  dos secciones a una marca por tarjeta), no la distinción.
- **El `<dialog>` nativo** y su gestión de foco.
- **La portada generada** (`GeneratedCover`) cuando no hay captura: resuelve
  bien el caso vacío.

## 8. Qué eliminar

- El `<h1>` «Hola, {nombre}» del inicio autenticado. Es el elemento más grande
  de la pantalla y no informa de nada. El nombre ya está en el avatar del navbar.
- El botón «Ver mis materias» de la cabecera: duplica el enlace «Aula» del
  navbar, a 200 px de distancia.
- El verbo en línea propia («Publicó una actividad»).
- El botón por tarjeta cuando no hay una segunda acción.
- El `<h2>` serif de cada uno de los dos bloques del muro.
- El `<select>` de filtro por grupo, sustituido por chips.

## 9. Qué compactar

| Elemento | De | A |
|---|---|---|
| Portada de proyecto | 404 px | 60 px (miniatura 96×60) |
| Resumen | 2 líneas (44 px) | 1 línea (24 px) |
| Verbo + botón | 72 px | 0 px (etiqueta de tipo + tarjeta enlazada) |
| Compositor cerrado | 118 px | ~44 px |
| Línea «desde tu última visita» | 72 px | 0 px (pasa a separador dentro de la lista) |
| **Tarjeta de proyecto** | **654 px** | **~139 px** |
| **Publicaciones visibles a 1440×900** | **1,3** | **6,0** |

Objetivo de densidad recomendado: **5–7 publicaciones por pantalla en
escritorio, 5–6 en móvil**. Por debajo de 4 el muro no se escanea; por encima de
8 con miniatura empieza a parecer un gestor de archivos.
