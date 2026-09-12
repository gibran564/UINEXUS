# Responsive

## Método

Las herramientas de inspección del navegador estuvieron bloqueadas durante toda
la sesión, así que este análisis está **calculado** sobre `globals.css` y las
utilidades de Tailwind presentes en el código, no observado en pantalla. Los
números son reproducibles con `python docs/audit/feed-density.py`. Lo que
requiere confirmación visual está marcado como tal.

## Los breakpoints que existen

| Prefijo | Ancho | Usos en `src/**` |
|---|---|---|
| (base) | — | — |
| `sm:` | 640 px | 24 |
| `md:` | 768 px | 14 |
| `lg:` | 1024 px | 13 |
| `xl:` | 1280 px | **2** |
| `2xl:` | 1536 px | **0** |

Los dos `xl:` están en `navbar.tsx` y sólo deciden si el conmutador de tema vive
en la barra o dentro del menú de cuenta.

**Conclusión estructural: Nextudio está diseñado para el rango 375–1024 px.** Por
encima de 1024 px la interfaz no cambia; sólo aparece margen.

Contenedores:

| Contenedor | Máximo | Padding lateral |
|---|---|---|
| `.container-page` | 78 rem = 1248 px | 1,25 rem (< 768) / 2 rem (≥ 768) |
| Muro (`/` autenticado) | `max-w-3xl` = 768 px | heredado |
| `/publish` | `max-w-3xl` = 768 px | heredado |
| `/login`, `/register` | `max-w-sm` = 384 px | heredado |
| `.prose-block` | 68 ch | — |

---

## Desktop grande — 1920 × 1080

| Pantalla | Ancho útil | Ancho sin usar | Diagnóstico |
|---|---|---|---|
| **`/` autenticado (muro)** | 768 px | **1152 px (60 %)** | 1,6 publicaciones de proyecto visibles. El peor caso del producto |
| `/explore` | 1248 px | 672 px (35 %) | 3 columnas de galería. Razonable, aunque a 1920 cabrían 4 |
| `/courses` | 1248 px | 672 px | 2 columnas. A 1920 caben 3 |
| `/aula` | 1248 px | 672 px | 2 columnas de materia |
| `/aula/[courseId]` | 1248 px | 672 px | Pestañas + contenido a una columna |
| `/[handle]` | 1248 px | 672 px | 3 columnas de galería |
| `/publish/new` | 768 px | 1152 px | Aceptable: un formulario ancho se lee peor |

Problemas:

- **R-01 · P1** — El muro deja el 60 % del ancho sin usar y a cambio no muestra
  ni dos publicaciones. No es un problema de estética: es la razón por la que hay
  que hacer scroll.
- **R-02 · P2** — `ProjectGrid` topa en `lg:grid-cols-3`. A 1248 px con
  `gap-x-6`, cada tarjeta mide ~400 px y la portada 16:10 mide 250 px de alto. A
  1920 px cabría una cuarta columna (`xl:grid-cols-4`) sin bajar de 290 px por
  tarjeta.
- **R-03 · P3** — `container-page` topa en 1248 px, así que a 1920 px hay 336 px
  de margen a cada lado incluso en las pantallas anchas. Es una decisión
  razonable para texto; conviene revisarla para galerías.

## Laptop — 1440 × 900 y 1366 × 768

Es el escenario más probable en un aula.

| | 1366 × 768 | 1440 × 900 |
|---|---|---|
| Ancho del muro | 768 px | 768 px |
| Ancho sin usar | 598 px (44 %) | 672 px (47 %) |
| Publicaciones con portada visibles | **1,1** | **1,3** |
| Publicaciones sin portada visibles | 3,4 | 4,0 |
| Scroll hasta la 1.ª publicación (estudiante) | 992 px = **1,29 pantallas** | 992 px = **1,19 pantallas** |

- **R-04 · P1** — A 1366 × 768, la altura visible bajo el navbar es de 704 px y
  una tarjeta de proyecto mide 654 px: **cabe una, con 50 px de sobra**. En el
  portátil más común del aula, el muro muestra exactamente una publicación.
- **R-05 · P2** — Confirmar visualmente: `/aula/[courseId]` con cinco pestañas
  («Resumen, Tareas, Estudiantes, Proyectos, Recursos IA») en `flex gap-1` con
  `px-3` cada una. A 1366 px hay sitio de sobra; el riesgo está en móvil (ver
  abajo).

## Tablet — 768 × 1024

Paradójicamente, **el mejor ancho del producto**.

| Métrica | Valor |
|---|---|
| Ancho del muro | 704 px (`container-page` a 768 − 2 × 32) |
| Ancho sin usar | 64 px (8 %) |
| Publicaciones con portada | 1,6 |
| Publicaciones sin portada | 4,6 |

En 768 px se activan `md:` y `sm:`, así que:
- El navbar muestra la navegación completa (`hidden md:block`) pero **oculta el
  buscador** (`hidden … lg:block`): el buscador desaparece justo en el ancho
  donde ya hay sitio para él. **R-06 · P2** — bajar el buscador a `md:`.
- `/aula` pasa a 2 columnas de materia (`md:grid-cols-2`) con ~336 px cada una:
  ajustado pero correcto.
- `ProjectGrid` está en `sm:grid-cols-2`, así que a 768 px son 2 columnas de
  ~336 px. Correcto.
- El pie pasa a `sm:grid-cols-2` (4 bloques en 2 filas). Correcto.

**R-07 · P2** — En el rango 768–1023 px el navbar tiene navegación pero no
buscador, y el conmutador de tema está escondido en el menú de cuenta (`xl:`).
Tres decisiones de visibilidad con tres breakpoints distintos en la misma barra.

## Móvil — 390 × 844 (y 360 × 640 como caso estrecho)

| Métrica | 390 px |
|---|---|
| Ancho de contenido | 350 px |
| Columna de texto de la tarjeta | 274 px |
| Portada de proyecto | 171 px |
| Tarjeta de proyecto | 392 px |
| Publicaciones con portada visibles | **2,0** |

Lo que funciona:

- Ningún desbordamiento horizontal detectado en el muro, la galería ni el perfil.
- `input, textarea, select { font-size: 16px }` bajo 640 px: no hay zoom de iOS.
- `.btn` a 44 px y `.field` a 44 px: objetivos táctiles correctos.
- `DashboardClient` convierte la tabla en tarjetas en vez de comprimirla, con el
  motivo escrito en el código. Es la decisión correcta y es el único `<table>` de
  producto (el otro está en `markdown-content.tsx`, que sí lleva
  `overflow-x-auto`).
- El botón «Publicar» permanece visible en móvil con sesión, con comentario
  explícito («publicar es la acción principal y no puede vivir sólo dentro de un
  menú»). Correcto.
- Los enlaces del pie llevan `min-h-9` explícito, con el motivo comentado.

Lo que no:

- **R-08 · P1** — Las pestañas de `/aula/[courseId]` están en `flex gap-1`
  **sin `overflow-x-auto` y sin `flex-wrap`**. Cada botón lleva `px-3` (24 px) y
  texto a 14 px (≈ 7 px por carácter en Inter):

  | Pestaña | Ancho aprox. | ¿Quién la ve? |
  |---|---|---|
  | Resumen | 73 px | todos |
  | Tareas | 66 px | todos |
  | Estudiantes | 101 px | **sólo docentes** |
  | Proyectos | 87 px | todos |
  | Recursos IA | 101 px | todos |

  Con `gap-1` (4 px × 4):

  - **Estudiante** (4 pestañas): ≈ 339 px en 350 px disponibles. Entra por 11 px.
    A 360 px de viewport (320 de contenido) **ya no entra**.
  - **Docente** (5 pestañas): ≈ 444 px en 350 px. **Desborda por 94 px en
    cualquier móvil.**

  Sin `overflow-x-auto`, flex comprime los elementos: los textos se recortan o la
  fila se sale del contenedor. **Es el problema responsive más probable del
  producto, afecta sobre todo al rol docente, y hay que confirmarlo en un móvil
  real.** Mismo patrón en `assignment-detail.tsx:485` y `resources-panel.tsx:73`.
- **R-09 · P2** — El filtro por grupo del muro (`label` + `<select className="field">`)
  ocupa 96 px verticales en móvil para un control secundario, justo delante del
  muro.
- **R-10 · P2** — El menú móvil (`mobileOpen`) es un panel desplegable que empuja
  el contenido, no un overlay. Con sesión lista Inicio, Aula, Explorar, Tus
  proyectos, Acerca de, Publicar y el conmutador de tema: siete entradas más un
  buscador. Aceptable, pero el enlace «Publicar» del menú **duplica** el botón
  primario que ya está visible en la barra.
- **R-11 · P3** — `text-display` usa `clamp(2.25rem, 1.6rem + 2.6vw, 3.5rem)`:
  a 390 px son 36 px. Correcto para el titular del escaparate, pero es el único
  uso de `text-display` en todo el proyecto.
- **R-12 · P3** — Confirmar visualmente: la audiencia concatenada de una
  publicación (`courseName` = nombres unidos con ` · `) en una tarjeta de 274 px.
  Con dos materias de nombre largo la línea se parte en tres.

---

## Cómo debe transformarse el layout propuesto

La regla que pide el encargo —una arquitectura de tres columnas **no** puede
convertirse mecánicamente en tres columnas comprimidas en móvil— aplicada:

### ≥ 1440 px — tres zonas

```
┌──────────────┬────────────────────────────┬──────────────┐
│ carril izq.  │  muro                      │ carril der.  │
│ 280px fijo   │  600–640px                 │ 300px fijo   │
│              │                            │              │
│ identidad    │  [chips de materia]        │ del resto de │
│ atención(3)  │  ── nuevo ──               │ Nextudio      │
│ materias     │  publicaciones compactas   │ materia      │
│              │                            │ activa       │
└──────────────┴────────────────────────────┴──────────────┘
        total ≈ 1252 px, centrado
```

### 1024 – 1439 px — dos zonas

El carril derecho **desaparece por completo**. Su contenido no se comprime ni se
apila: se retira, porque es contenido secundario. El acceso a `/explore` se
mantiene en el navbar.

```
┌──────────────┬────────────────────────────────────┐
│ carril 280   │  muro 600–660                      │
└──────────────┴────────────────────────────────────┘
```

### 768 – 1023 px (tablet) — una columna con tira superior

El carril izquierdo **se transforma**, no se encoge:

```
┌───────────────────────────────────────────────────┐
│ [Todas] [DCU] [IHC] [Prog. Web]   ← materias      │  chips, scroll-x
├───────────────────────────────────────────────────┤
│ ⚠ Entrega hoy · Prototipo   │ ⚠ Requiere cambios  │  tira de atención,
│   Diseño Centrado…          │   Mapa de empatía   │  máx. 2 + «ver todas»
├───────────────────────────────────────────────────┤
│  muro, una columna, 704px                         │
└───────────────────────────────────────────────────┘
```

La identidad no aparece: ya está en el avatar del navbar y en este ancho no se
gana nada.

### < 768 px (móvil) — una columna, mismo orden

```
┌─────────────────────────┐
│ [Todas][DCU][IHC] →     │  chips con scroll-x
├─────────────────────────┤
│ ⚠ Entrega hoy       →   │  tira horizontal, 1 visible + peek
│   Prototipo de alta…    │
├─────────────────────────┤
│ ▸ publicación compacta  │
│ ▸ publicación compacta  │
│ ▸ publicación compacta  │
│ ▸ publicación compacta  │
│ ▸ publicación compacta  │
└─────────────────────────┘
```

Miniatura de 72 × 45 px en lugar de 96 × 60. La tarjeta baja a ~125 px y caben
5,6 publicaciones, frente a las 2,0 de hoy.

**El orden vertical es el mismo en los cuatro anchos** —materias, atención,
muro—, así que la jerarquía no cambia al girar el dispositivo. Es la propiedad
que el comentario actual de `academic-home.tsx` defiende con razón y que hay que
conservar.

---

## Reglas responsive para el rediseño

1. **Nunca tres columnas por debajo de 1440 px.** Un carril de 280 px y un muro
   de 640 px suman 952 px: por debajo de 1024 px no caben dos.
2. **Los carriles se retiran o se transforman; no se comprimen.** Un carril de
   180 px es peor que ningún carril.
3. **La columna del muro no baja de 560 px ni sube de 680 px.** Por debajo, la
   miniatura y el texto se pelean; por encima, la línea supera el rango legible
   (`prose-block` ya fija 68 ch como límite del sistema).
4. **Cualquier fila de pestañas o chips lleva `overflow-x-auto` con
   `scroll-snap`.** Corrige R-08 y previene su repetición.
5. **Añadir `xl:` a la galería** (`xl:grid-cols-4`). El ancho existe y hoy se
   tira.
6. **Un solo breakpoint por decisión de visibilidad en el navbar.** Hoy hay tres
   distintos en la misma barra (R-07).

---

## Pendiente de confirmación visual

- R-08: comportamiento real de las cinco pestañas a 360 y 390 px.
- R-05: pestañas del detalle de tarea, que son más y con nombres más largos.
- El navbar translúcido (`bg-bg/85` + `backdrop-blur-md`) sobre contenido con
  imágenes: contraste efectivo del texto de navegación al hacer scroll.
- Zoom al 200 % en `/aula/[courseId]`, que es la pantalla con más controles.
- Teclado en pantalla en móvil sobre el compositor del muro cuando está abierto.
