# Propuesta conceptual de rediseño

**Este documento no contiene implementación.** Describe qué debería ser la
interfaz y por qué. Los archivos concretos están en `technical-map.md` y el orden
de trabajo en `priorities.md`.

---

## 0. La tesis

Nextudio no necesita un rediseño de identidad. El lenguaje visual —papel
cuadriculado, tinta, filetes en vez de sombras, serif editorial, acento
terracota— es propio, coherente y está argumentado decisión por decisión en el
código. **Conservarlo entero.**

Lo que necesita es un cambio de **eje**.

Hoy la prioridad se paga en altura: lo importante va arriba, y como todo lo
importante va arriba, la pila crece hasta que el contenido que cambia a diario
—el muro— queda a 992 px del borde superior. La altura es un recurso que se
agota y que además desaparece al hacer scroll.

La propuesta es pagar la prioridad en **posición**: lo que caduca va a un carril
fijo, donde no se agota y no desaparece. El muro ocupa entonces la pantalla desde
el primer píxel.

Tres reglas que gobiernan todo lo que sigue:

1. **Nada nuevo.** El rediseño no añade información: la recoloca. La única
   excepción son datos que ya se recogen y hoy se tiran (carrera, semestre).
2. **La miniatura es lo que permite la densidad.** Sin ella, compactar produce
   una lista gris. Con ella, seis filas se escanean.
3. **El estado visible vive en la URL.** `/explore` ya lo hace bien; el resto del
   producto lo copia.

---

## 1. Layout recomendado

### Escritorio ancho (≥ 1440 px)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Nextudio    Inicio · Materias · Explorar    [buscar]  [Publicar]  [avatar] │  64px sticky
└───────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┬──────────────────────────────────┬──────────────────┐
  │  CONTEXTO    │             MURO                 │    DESCUBRIR     │
  │  280px       │           600–640px              │      300px       │
  │  fijo        │                                  │      fijo        │
  │              │                                  │                  │
  │ ┌──────────┐ │ [Todas][DCU][IHC][Prog.Web]  →   │ DEL RESTO DE     │
  │ │ ◯  Ana   │ │                                  │ UINEXUS          │
  │ │ Ing.Sist │ │ ── nuevo desde tu última visita ─│ ┌──────────────┐ │
  │ │ 6.º sem  │ │                                  │ │[img] proyecto│ │
  │ └──────────┘ │ ┌──────────────────────────────┐ │ │      autor   │ │
  │              │ │[img] ◯ Prof. Gibran · DCU 2h │ │ └──────────────┘ │
  │ NECESITA TU  │ │ 96×60 Práctica 4: prototipo  │ │ ┌──────────────┐ │
  │ ATENCIÓN     │ │      Entrega el viernes…  ⚑ │ │ │[img] proyecto│ │
  │ ┌──────────┐ │ └──────────────────────────────┘ │ └──────────────┘ │
  │ │⚠ HOY     │ │ ┌──────────────────────────────┐ │ ver la galería → │
  │ │ Prototipo│ │ │[img] ◯ Ana Ruiz · IHC · 5h   │ │                  │
  │ │ DCU      │ │ │      Mapa de empatía         │ │ ─────────────────│
  │ └──────────┘ │ └──────────────────────────────┘ │ DISEÑO CENTRADO  │
  │ ┌──────────┐ │ ┌──────────────────────────────┐ │ EN EL USUARIO    │
  │ │↩ CAMBIOS │ │ │      ◯ Prof. Gibran · DCU 1d │ │ 24 estudiantes   │
  │ │ Empatía  │ │ │        Aviso: sesión del…    │ │ Próx. entrega:   │
  │ └──────────┘ │ └──────────────────────────────┘ │ vie 12, 23:59    │
  │ ver las 5 →  │ ┌──────────────────────────────┐ │                  │
  │              │ │[img] ◯ Luis M. · DCU · 1d    │ │                  │
  │ TUS MATERIAS │ └──────────────────────────────┘ │                  │
  │ ▸ DCU     ●2 │ ┌──────────────────────────────┐ │                  │
  │ ▸ IHC        │ │      ◯ Prof. Ana · IHC · 2d  │ │                  │
  │ ▸ Prog. Web  │ └──────────────────────────────┘ │                  │
  │ + código     │        [ cargar más ]            │                  │
  └──────────────┴──────────────────────────────────┴──────────────────┘
     sticky              scroll                        sticky
```

Total ≈ 1252 px, centrado. Publicaciones visibles: **6**, contra 1,3 hoy.

### Escritorio / portátil (1024 – 1439 px)

El carril derecho **desaparece**. No se comprime ni se apila: es contenido
secundario y su ausencia no rompe nada. Quedan `280 | 640`.

### Tablet (768 – 1023 px)

Los carriles se **transforman**:

```
┌───────────────────────────────────────────────┐
│ [Todas] [DCU] [IHC] [Prog. Web]      →        │  chips, scroll-x
├───────────────────────────────────────────────┤
│ ⚠ Entrega hoy       │ ↩ Requiere cambios      │  tira, máx. 2 + «ver todas»
│   Prototipo · DCU   │   Mapa de empatía · IHC │
├───────────────────────────────────────────────┤
│  muro, una columna, 704 px                    │
└───────────────────────────────────────────────┘
```

La identidad no aparece: ya está en el avatar del navbar.

### Móvil (< 768 px)

```
┌─────────────────────────┐
│ [Todas][DCU][IHC]   →   │
├─────────────────────────┤
│ ⚠ Entrega hoy       →   │  tira horizontal, 1 + peek
├─────────────────────────┤
│ ▸ publicación (125px)   │
│ ▸ publicación           │
│ ▸ publicación           │
│ ▸ publicación           │
│ ▸ publicación           │
└─────────────────────────┘
```

**El orden vertical es idéntico en los cuatro anchos**: materias → atención →
muro. La jerarquía no cambia al girar el dispositivo, que es la propiedad que el
diseño actual defiende con razón.

---

## 2. Home recomendado

**`/` sigue siendo el reparto entre escaparate público y muro autenticado.** La
ruta no cambia; la pantalla sí.

Lo que se va del muro:

| Elemento | A dónde |
|---|---|
| `<h1>Hola, {nombre}</h1>` | Se elimina. El `<h1>` accesible pasa a ser «Tu muro» en `sr-only` |
| Botón «Ver mis materias» | Se elimina: duplica el navbar |
| «Necesita tu atención» | Carril izquierdo (máx. 3 + «ver las N») |
| «Requiere tu atención» (docente) | Carril izquierdo |
| «Publicaciones pendientes» | Enlace en el carril → pantalla propia de moderación |
| Compositor | Fila de una línea sobre el muro |
| Filtro `<select>` por grupo | Chips sobre el muro, para **todos los roles** |
| «Desde tu última visita» | Separador dentro de la lista, en el punto exacto |

Y un cambio de una línea que hoy contradice toda la arquitectura: **el destino
por defecto tras iniciar sesión pasa de `/dashboard` a `/`.**

---

## 3. Estructura del muro

Una sola lista, no dos. La distinción docente / clase se conserva —es
información real— pero se resuelve dentro de la tarjeta y en el filtro, no con
dos cabeceras de sección de 82 px cada una.

```
[Todas] [DCU] [IHC] [Prog. Web]        [ De docentes ] [ De la clase ]
─────────────────────────────────────────────────────────────────────
publicaciones, orden cronológico, con cupo reservado para actividades
(sortEventsReservingAssignments ya lo garantiza y no se toca)
─────────────────────────────────────────────────────────────────────
[ cargar más ]  ·  o  ·  «Estás al día. Explorar otros trabajos →»
```

- Los chips de materia y el conmutador docente/clase van en la **URL**
  (`?materia=…&origen=…`), como los filtros de `/explore`.
- El separador «nuevo desde tu última visita» usa la marca de `localStorage` que
  ya existe (`uinexus-home-visit`), pero como línea dentro de la lista.
- El final del muro es un destino, no un vacío: enlace a `/explore`.

---

## 4. Estructura de una publicación

### Densidad `compact` (la del muro, por defecto)

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌────────┐  ◯ Prof. Gibran · Diseño Centrado · hace 2 h         │  19px
│ │ 96×60  │  Práctica 4 · Prototipo de alta fidelidad     [Tarea]│  22px
│ │  min.  │  Entrega el viernes 12 a las 23:59                   │  20px
│ └────────┘                                                      │
│            ⚑ vence en 2 días                                    │  26px
└─────────────────────────────────────────────────────────────────┘
   toda la tarjeta enlaza a la publicación · 139 px
```

Reglas:

| Regla | Motivo |
|---|---|
| **Miniatura de alto fijo** (96 × 60 desktop, 72 × 45 móvil) | Es lo único que hoy hace crecer la tarjeta. Alto fijo = tarjeta predecible |
| **La materia sube a la primera línea**, en color de texto normal | Con varias materias es el segundo dato más importante |
| **El verbo desaparece**; el tipo pasa a etiqueta a la derecha del título | 24 px recuperados sin perder información |
| **No hay botón**; la tarjeta entera es el enlace | 48 px recuperados. Un solo objetivo, un solo tab-stop |
| **Resumen a una línea** | La segunda se lee al abrir |
| **Cuarta línea sólo si hay señal** (fecha de entrega, «requiere cambios», «pendiente de aprobación») | Densidad variable: las tarjetas con urgencia son más altas, y eso es correcto |
| Sin miniatura cuando no es proyecto/página | La tarjeta baja a ~110 px |

### Densidad `full` (permalink, `/muro/[id]`)

Portada a ancho completo, contenido íntegro, audiencia, estado, moderación si
procede. Es lo que hoy hace `PublicationDetail` — que está bien hecho— pero con
URL propia. El modal sobre el muro se conserva como presentación interceptada de
esa ruta, de modo que compartir el enlace lleva a la página completa.

### Qué se muestra sin abrir, respuesta directa

| Dato | ¿Sin abrir? |
|---|---|
| Autor + avatar | Sí |
| Materia | Sí |
| Fecha relativa | Sí |
| Tipo | Sí, como etiqueta |
| Título | Sí, completo |
| Miniatura (sólo página/proyecto) | Sí |
| Resumen | Una línea |
| Fecha de entrega si es tarea | Sí |
| Estado si es propio y está pendiente | Sí |
| Contenido completo | No |
| Audiencia | No |
| «Aprobado por» | No |
| Comentarios, likes, vistas | **No existen y no deben existir** |

---

## 5. Navegación

```
Sin sesión
  [Nextudio]  Explorar · Cursos · Acerca de      [Iniciar sesión] [Publicar]

Con sesión
  [Nextudio]  Inicio · Materias · Explorar   [buscar]  [Publicar]  [avatar ▾]
```

Cambios:

- «Aula» → **«Materias»**, para que el nombre coincida con lo que dice la
  pantalla. Un solo vocabulario en todo el producto (ver
  `information-architecture.md` §4).
- El buscador aparece desde `md:` (768 px), no desde `lg:`. Hoy desaparece justo
  cuando ya hay sitio.
- Un solo breakpoint por decisión de visibilidad en la barra. Hoy hay tres.
- El menú de cuenta deja de listar «Inicio» (es el logo) y «Publicar» (es el
  botón primario, siempre visible).

---

## 6. Perfil

```
┌────────────────────────────────────────────────────────────┐
│ ◯ 96px   Ana Ramírez                          [Estudiante] │
│          @ana-ramirez                                      │
│          Ingeniería en Sistemas · 6.º semestre             │
│          Instituto Tecnológico de Durango                  │
│                                                            │
│          Me interesa la accesibilidad en interfaces…       │
│                                                            │
│          Diseño Centrado en el Usuario · IHC               │
│          4 proyectos · accesibilidad, móvil, prototipado   │
└────────────────────────────────────────────────────────────┘
  Ago–Dic 2026 ────────────────────────────────────────────
  [proyecto]  [proyecto]  [proyecto]
  Ene–Jun 2026 ───────────────────────────────────────────
  [proyecto]
```

Dos cambios, ningún campo nuevo:

1. **Contexto académico bajo el nombre** — carrera y semestre ya se recogen en
   `/dashboard/profile` y hoy se descartan. Falta exponerlos en el DTO público y
   dar al titular un interruptor de visibilidad (ver `student-profile.md` §5).
2. **Agrupar por periodo** — `project.term` ya existe. Convierte un escaparate en
   un historial de aprendizaje sin pedir nada.

Lo que **no** se añade, y por qué: skills autodeclaradas (compiten con la
evidencia y pierden), logros e insignias (ranking por la puerta de atrás),
estadísticas de vistas (métrica de popularidad), línea de actividad pública
(problema de privacidad en una página indexable), matrícula (identificador
institucional). Las etiquetas de temas **sí**, pero derivadas de los `tags` de
sus proyectos, no declaradas.

---

## 7. Carril de contexto

Sí, pero por descargar la columna, no por mostrar datos. Un carril que sólo dice
quién soy es decoración con datos dentro.

```
┌──────────────────────────┐
│ ◯ Ana Ramírez            │  identidad: 2 líneas, ni una más
│ Ing. Sistemas · 6.º sem  │
├──────────────────────────┤
│ NECESITA TU ATENCIÓN     │  lo único que caduca
│ ⚠ Entrega hoy            │  máx. 3
│   Prototipo · DCU        │
│ ↩ Requiere cambios       │
│   Mapa de empatía · IHC  │
│ ver las 5 →              │
├──────────────────────────┤
│ TUS MATERIAS             │  el filtro mental del muro
│ ▸ Diseño Centrado…   ●2  │  ya viaja en HomePayload.courses
│ ▸ Interacción H-C        │
│ ▸ Programación Web       │
│ + Unirme con código      │
└──────────────────────────┘
```

- 260–280 px · `position: sticky; top: 64px` · `max-height: calc(100dvh - 64px)`
  con scroll propio · desde `lg:` (1024 px).
- **Si sólo queda la identidad, no hay carril.** Un usuario sin materias ve una
  columna con el mensaje de bienvenida y «unirme con código», no un carril vacío.
- Docente: «Requiere tu atención» (revisar, moderar) y grupos con contador.
- **No entran**: estadísticas, progreso del semestre, logros, proyectos propios,
  actividad propia, accesos rápidos. Ninguno cambia lo que voy a hacer en los
  próximos cinco minutos.

---

## 8. Responsive

Ver `responsive.md` para el detalle. Las cinco reglas:

1. Nunca tres columnas por debajo de 1440 px.
2. Los carriles se retiran o se transforman; **no se comprimen**.
3. La columna del muro no baja de 560 px ni sube de 680 px.
4. Toda fila de pestañas o chips lleva `overflow-x-auto` con `scroll-snap`.
5. Añadir `xl:` a la galería (`xl:grid-cols-4`): el ancho existe y hoy se tira.

---

## 9. Componentes

### Crear

| Componente | Función | Sustituye a |
|---|---|---|
| `wall-layout.tsx` | Rejilla de 1 / 2 / 3 zonas por breakpoint | El `container-page max-w-3xl` del muro |
| `wall-rail.tsx` | Carril: identidad, atención, materias | Tres secciones apiladas de `academic-home.tsx` |
| `wall-feed.tsx` | Lista, filtro, paginación, separador «nuevo» | `FeedSection` × 2 |
| `feed-card.tsx` | Tarjeta con densidad `compact` / `full` | `FeedCard` |
| `wall-context.tsx` | Carril derecho, ≥1440 px | Nada (nuevo) |
| `segmented-nav.tsx` | Un control para «elige una de N» | 4 copias de pestañas + 2 grupos de botones + 1 `<select>` |
| `page-header.tsx` | Título + subtítulo + acción | Repetido casi idéntico en 5 pantallas |
| `icon.tsx` | Tamaño, `stroke-width` y `aria-hidden` en un sitio | SVG en línea con grosores 1 / 1.4 / 1.5 / 1.6 |
| `attention-item.tsx` | Fila compacta de tarea pendiente | `AttentionCard` (`panel p-4`, 159 px) |

### Reutilizar sin cambios

`ui/user-avatar.tsx`, `ui/empty-state.tsx`, `ui/status-badge.tsx`,
`project/generated-cover.tsx`, `project/project-card.tsx`, `aula/aula-ui.tsx`,
y **toda** la lógica de `lib/home-feed.ts`, `lib/due-date.ts`, `lib/workflow.ts`.

### Eliminar

| Qué | Por qué |
|---|---|
| El `<h1>` de saludo en `/` y `/aula` | El elemento más grande de la pantalla, sin información |
| El botón «Ver mis materias» | Duplica el navbar |
| El `<select>` de filtro por grupo | Sustituido por chips en la URL |
| El verbo del evento | Metadato de tipo con formato de narración |
| El botón `btn-sm` por tarjeta | La tarjeta es el objetivo |
| Los dos `<h2>` de sección del muro | Una sola lista |
| Los tokens `--text-small`, `--text-body`, `--radius-lg` | Definidos y nunca usados |
| Las 4 copias literales de clases de pestaña | Van a `segmented-nav` |

### Sistema visual: cinco ajustes

1. **Una sola escala tipográfica.** Hoy conviven la propia (`text-h1…text-label`)
   y la de Tailwind (`text-sm`, 262 usos). Decidir una y cerrar la otra con
   `--text-*: initial` para que las utilidades fuera de escala no compilen.
2. **`--border-control` con ≥3:1** para `.field`, `.chip`, `.btn-secondary` y
   `.tag`. Hoy están en 1,8:1 (ver `accessibility.md` A-01). Es el cambio que más
   altera el aspecto del producto: hacerlo con revisión visual.
3. **Tres densidades de `.panel`** (`row` `p-3.5`, `card` `p-5`, `block` `p-8`) en
   lugar de siete paddings sueltos.
4. **Un padding vertical de página** (`py-10`) en lugar de seis.
5. **Un radio de superficie**, en lugar de `rounded-sm` y `rounded-md` mezclados
   para el mismo componente según la pantalla.

---

## 10. Lo que esta propuesta rechaza deliberadamente

| Idea | Por qué no |
|---|---|
| Convertir `/` en un dashboard con métricas | El producto ya la rechazó dos veces por escrito, con buen argumento. Y la pila actual demuestra el fallo |
| «Me gusta», comentarios, contador de vistas | Un aula de 30 personas no necesita señales de popularidad. Necesita que la publicación se vea |
| Mover el muro a `/muro` dejando `/` como panel | Un clic más cada día, para siempre |
| Sombras en las tarjetas | El lenguaje es de filetes y funciona. El problema es el contraste del filete, no el filete |
| Sidebar colapsable | Estado extra que recordar y control que explicar; a 1024 px ya cabe y por debajo no se muestra |
| Carril derecho «porque quedan tres columnas» | Si al implementarlo no hay contenido que se gane el sitio, **dos columnas es el resultado correcto** |
| Rediseñar la identidad visual | No hace falta. Es lo mejor que tiene el producto |
