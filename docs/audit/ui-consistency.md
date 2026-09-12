# Auditoría del sistema visual

## Veredicto

**Nextudio parece una única aplicación coherente, y eso es un logro poco común.**
Hay un lenguaje visual declarado, argumentado y aplicado: papel cuadriculado y
tinta, filetes en vez de sombras, radios pequeños, serif variable para títulos,
acento terracota apagado, y la regla explícita de que «el color nunca carga la
jerarquía solo».

El problema no es la falta de sistema. Es que **el sistema documentado y el
sistema realmente usado han empezado a separarse**, en cinco puntos concretos y
medibles. Ninguno es grave hoy; todos empeoran con cada pantalla nueva.

---

## D-01 · P1 · Dos escalas tipográficas conviven

`globals.css` declara ocho pasos y lo justifica: «Escala tipográfica: ocho pasos,
ni uno más». Pero al declararlos como `--text-*` en `@theme inline`, Tailwind v4
los **añade** a su escala por defecto en vez de sustituirla. El resultado, contado
sobre `src/**/*.tsx`:

| Escala propia | Usos | | Escala de Tailwind | Usos |
|---|---|---|---|---|
| `text-display` | 1 | | `text-xs` | 3 |
| `text-h1` | 29 | | **`text-sm`** | **262** |
| `text-h2` | 43 | | `text-base` | 0 |
| `text-h3` | 61 | | `text-lg` | 0 |
| `text-lead` | 7 | | `text-3xl` | 1 |
| `text-body` | **0** | | | |
| `text-small` | **0** | | | |
| `text-label` | 61 | | | |

Consecuencias:

- **`text-small` y `text-body` son tokens muertos.** Están definidos, comentados
  y no se usan nunca. El comentario de `globals.css` dice que `lead` y `label`
  se nombraron «para que la escala no se erosione a base de excepciones»; con
  `small` pasó lo contrario: se nombró y la excepción ganó.
- **El tamaño pequeño real del producto es `text-sm` (14 px / 20 px de
  Tailwind), no `text-small` (14 px / 1.55).** Mismo cuerpo, interlineado
  distinto: 20 px contra 21,7 px. La diferencia es invisible en una línea y
  perceptible en un párrafo.
- `text-xs` (12 px) aparece 3 veces y `text-3xl` una: por debajo y por encima de
  la escala declarada. El propio CSS fija el suelo en 13 px («por debajo, la
  letra deja de ser legible con comodidad»).

**Solución**: decidir cuál de las dos escalas manda y hacerla la única.
Recomendación: **quedarse con `text-sm`** (262 usos, migrarlo es tocar todo) y
o bien redefinir `--text-sm` con el interlineado de 1.55, o bien borrar
`--text-small`, `--text-body`, `--text-xs` y `--text-3xl` con
`--text-*: initial` para que las utilidades fuera de escala dejen de compilar.
Lo segundo es lo que impide la erosión futura.
**Dificultad**: baja. **Efecto**: alto a largo plazo.

## D-02 · P2 · La escala de radios está declarada al revés de como se usa

| Token | Valor | Utilidad | Usos |
|---|---|---|---|
| `--radius-xs` | 2 px | `rounded-xs` | 15 |
| `--radius-sm` | 4 px | `rounded-sm` | **54** |
| `--radius-md` | 6 px | `rounded-md` | 12 |
| `--radius-lg` | 10 px | `rounded-lg` | **0** |
| — | 9999 px | `rounded-full` | 14 |

`--radius-lg` no se usa nunca. `rounded-full` se usa 14 veces (avatares, puntos
de estado) y no está en la escala documentada. `rounded-md` (6 px) se aplica a
`.panel` y a la portada de `ProjectCard`, mientras que `rounded-sm` (4 px) se
aplica a los paneles del muro: **dos radios distintos para la misma superficie
según la pantalla**.

**Solución**: borrar `--radius-lg`, documentar `full` como caso legítimo para
elementos circulares, y unificar el radio de superficie en un solo valor.

## D-03 · P2 · Seis paddings verticales de página

`py-6` (`/[handle]/[slug]/preview`), `py-8` (`/` autenticado), `py-10` (18
pantallas), `py-12` (`/about`, `/publish`), `py-14` (`/login`, `/register`),
`py-24` (error, 404, estados de carga).

`py-10` es claramente el valor de facto (18 de 25 pantallas). Los demás no tienen
motivo visible: `/about` no necesita más aire que `/explore`, y `/` autenticado
—la pantalla más usada— es la que menos tiene.

**Solución**: `py-10` como norma, `py-24` para páginas de estado centradas, y
nada más. **Dificultad**: trivial.

## D-04 · P1 · El mismo control implementado dos veces

`globals.css` documenta la consolidación de `.chip` con orgullo justificado:

> «Un solo dueño para el mismo control. Antes existían cuatro copias con estados
> de hover distintos (galería, curso, inicio, visor), y el mismo gesto se veía
> diferente según la página.»

La consolidación se hizo bien. Pero **el patrón volvió a aparecer**, esta vez
entre `.chip` y las pestañas:

| Control | Dónde | Implementación | Aspecto |
|---|---|---|---|
| Filtro de categoría | `/explore` | `.chip` (enlace) | Píldora con borde, acento al activarse |
| Filtro de tipo/orden | `/explore` | `.chip` (enlace) | Idem |
| Filtro por grupo | `/` (muro) | `<select className="field">` | Desplegable nativo |
| Pestañas de materia | `/aula/[courseId]` | `border-b-2` a mano | Subrayado |
| Pestañas de proyectos | `/dashboard` | `border-b-2` a mano | Subrayado |
| Pestañas de recursos | `resources-panel` | `border-b-2` a mano | Subrayado |
| Selector de tipo de publicación | compositor | `.btn btn-primary/secondary` + `aria-pressed` | Botones |
| Selector de modo nuevo/compartir | compositor | Idem | Botones |

**Cinco formas visuales para el mismo gesto**: «elige una de N opciones que
cambia lo que veo abajo». Y las cuatro pestañas repiten las mismas clases
literales (`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm …`)
copiadas en cuatro archivos.

**Solución**: un componente `<SegmentedNav>` (o extender `.chip` con una variante
`chip-tab`) y usarlo en los ocho sitios. Es el mismo ejercicio que ya se hizo con
`.chip` y que aquí quedó a medias.
**Dificultad**: media. **Efecto**: alto — es lo que más hace que el producto
parezca varias aplicaciones.

## D-05 · P2 · Nada reacciona por encima de 1280 px

Recuento de prefijos de breakpoint en todo `src/**/*.tsx`:

| Prefijo | Ancho | Usos |
|---|---|---|
| `sm:` | 640 px | 24 |
| `md:` | 768 px | 14 |
| `lg:` | 1024 px | 13 |
| `xl:` | 1280 px | **2** |
| `2xl:` | 1536 px | **0** |

Los dos `xl:` están en el navbar y sólo mueven el conmutador de tema entre la
barra y el menú de cuenta. **Ningún contenido de Nextudio cambia por encima de
1024 px.** `container-page` topa en 78 rem (1248 px) y el muro en 48 rem
(768 px). El resultado está medido en `responsive.md`.

## D-06 · P3 · Componentes de superficie con reglas distintas

| Superficie | Radio | Padding | Fondo |
|---|---|---|---|
| `.panel` (definición) | `md` 6 px | — | `--surface` |
| Panel del muro | `md` | `p-4` | `--surface` |
| Tarjeta de materia (`/aula`) | `md` | `p-5` | `--surface` |
| Tarjeta de curso (`/courses`) | `md` | `p-6` | `--surface` |
| Tarjeta de curso (`Landing`) | `md` | `p-5` | `--surface` |
| Tarjeta de tipo (`/publish`) | `md` | `p-5` | `--surface` |
| Bloque de cierre (`Landing`) | `md` | `p-8` | `--sunken` |
| Estado vacío | `md` | `px-6 py-14` | `--surface` |

Siete paddings (`p-3`, `p-4`, `p-5`, `p-6`, `p-8`, `px-6 py-14`) para el mismo
componente. La densidad de una tarjeta debería depender de su papel (fila de
lista, tarjeta de galería, panel de contenido), no de la pantalla en la que
aparece.

**Solución**: tres densidades nombradas —`panel-row` (`p-3.5`), `panel-card`
(`p-5`), `panel-block` (`p-8`)— y ninguna suelta.

## D-07 · P3 · Estados de hover inconsistentes en superficies enlazadas

| Componente | Hover |
|---|---|
| Tarjeta de materia | `hover:border-line-strong` |
| Tarjeta de curso | `hover:border-line-strong` |
| Tarjeta de tipo de publicación | `hover:border-accent` |
| Tarjeta de proyecto compartible (compositor) | `hover:border-accent` |
| Tarjeta del muro | **ninguno** (no es enlazable) |
| `ProjectCard` | `group-hover:border-line-strong` + `hover:underline` en el título |

Dos respuestas distintas al mismo gesto sobre el mismo componente, según la
pantalla. Y las tarjetas del muro no tienen ninguna, lo que es coherente con que
hoy no sean enlazables — algo que el rediseño va a cambiar.

## D-08 · P3 · El sistema no tiene componente de icono

Los SVG se escriben en línea, con `viewBox`, `width`, `height`, `stroke-width` y
`aria-hidden` repetidos a mano en cada sitio (navbar, buscador, filtros, estado
vacío, logo). Los grosores de trazo varían: `1.4`, `1.5`, `1.6`, `1`.

**Solución**: no hace falta una librería de iconos. Basta con un `<Icon>` que fije
tamaño, `stroke-width` y `aria-hidden`, y un archivo con los ~10 trazados que se
usan.

---

## Lo que está bien y no hay que tocar

- **Los tokens de color.** Superficies (4), textos (3), trazo (2), acento (5),
  semánticos (3 × 2). Ni uno de más. La paleta oscura no es la clara invertida:
  está recalculada, con `--accent` cambiando de `#ad3f1c` a `#ff8a5c` para
  mantener contraste. Es trabajo hecho bien.
- **La decisión de sombras.** Sólo dos (`--shadow-pop`, `--shadow-sheet`), y sólo
  para lo que realmente flota. Se cumple: ningún uso de sombra en tarjetas.
- **La pareja tipográfica.** Fraunces (variable, con ejes `SOFT`/`WONK`/`opsz`)
  para títulos e Inter para interfaz. Da voz editorial sin parecer plantilla, y
  el mono es el del sistema con el motivo escrito («no justifica otros 40 KB»).
- **`.meta`.** Mono, versalitas, 12 px, `letter-spacing: 0.08em` para periodos y
  numeración. Un solo trabajo, bien hecho, usado con constancia.
- **`.section-mark`.** La cruz de la retícula como marca de sección: firma visual
  propia construida con dos gradientes, sin imagen ni icono. Es lo más
  «Nextudio» del sistema.
- **`.chip` y su estado desde ARIA.** Ver `accessibility.md`.
- **El comentario de cada decisión.** `globals.css` explica por qué de cada
  elección. Es la razón por la que esta auditoría ha podido distinguir «decisión
  deliberada» de «descuido», y hay que mantener esa disciplina.

---

## Oportunidades de consolidación, por efecto

| # | Consolidar | Sustituye a | Efecto |
|---|---|---|---|
| 1 | `<SegmentedNav>` / `chip-tab` | 4 copias de pestañas + 2 grupos de botones + 1 `<select>` | Alto |
| 2 | Una sola escala tipográfica | `text-small`/`text-body` muertos, `text-xs`/`text-3xl` fuera de escala | Alto |
| 3 | `<FeedCard>` con densidad `compact` / `full` | La tarjeta del muro y su portada | Alto (ver `wall.md`) |
| 4 | Tres densidades de `.panel` | 7 paddings sueltos | Medio |
| 5 | `--border-control` con ≥3:1 | Bordes de `.field`, `.chip`, `.btn-secondary` | Medio (a11y, A-01) |
| 6 | Un padding vertical de página | 6 valores | Bajo, trivial |
| 7 | `<Icon>` | SVG en línea con grosores variables | Bajo |
| 8 | `<PageHeader>` (título + subtítulo + acción) | Repetido casi idéntico en `/`, `/aula`, `/dashboard`, `/explore`, `/courses` | Medio |
