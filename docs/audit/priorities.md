# Backlog priorizado

Todos los hallazgos convertidos en trabajo. **Nada implementado.**

Columnas: **P** = prioridad (`ux-problems.md`) · **Esf.** = esfuerzo
(XS < 1 h, S < ½ día, M 1–2 días, L 3–5 días, XL > 1 semana) · **Efecto** =
impacto en la experiencia.

---

## A · Quick wins

Efecto alto o medio con esfuerzo XS/S. Se pueden hacer todos en un día y no
dependen del rediseño estructural.

| # | Cambio | P | Esf. | Efecto | Archivo |
|---|---|---|---|---|---|
| A1 | **Tras iniciar sesión, ir a `/` en vez de `/dashboard`** | P1 | XS | **Alto** | `auth/login-form.tsx` |
| A2 | **Portada del muro → miniatura de alto fijo**: tarjeta de 654 px a ~250 px, densidad ×3 | P1 | S | **Alto** | `home/academic-home.tsx` → `FeedCard` |
| A3 | Quitar el `<h1>` de saludo de `/` y `/aula` | P2 | XS | Medio | `academic-home.tsx`, `aula-home.tsx` |
| A4 | Quitar el botón «Ver mis materias» | P2 | XS | Bajo | `academic-home.tsx` |
| A5 | **`overflow-x-auto` en las 6 filas de pestañas** (desbordan en móvil para docentes) | P1 | XS | **Alto** | 6 archivos, ver `responsive.md` R-08 |
| A6 | Quitar el verbo del evento; pasarlo a etiqueta de tipo | P3 | S | Medio | `FeedCard` |
| A7 | Quitar el botón por tarjeta; enlazar la tarjeta entera | P3 | S | Medio | `FeedCard` |
| A8 | Un solo padding vertical de página (`py-10`) | P2 | XS | Bajo | 25 páginas |
| A9 | Borrar `--text-small`, `--text-body`, `--radius-lg` (0 usos) | P3 | XS | Bajo | `globals.css` |
| A10 | Buscador del navbar desde `md:` en vez de `lg:` | P2 | XS | Bajo | `navbar.tsx` |
| A11 | Truncar la audiencia concatenada a 2 + «y N más» | P3 | XS | Bajo | `api/home/route.ts` |
| A12 | `--fg-subtle` a 4,5:1 sobre `--surface-sunken` | P2 | XS | Bajo | `globals.css` |
| A13 | `<h1>` estático en `/login` y `/register` fuera del `Suspense` | P2 | S | Bajo | `app/login/page.tsx` |
| A14 | Quitar «Publicar» del menú móvil (ya está el botón primario) | P2 | XS | Bajo | `navbar.tsx` |

> **A1 y A2 son el mejor par de la lista.** Juntos cuestan menos de medio día y
> arreglan las dos cosas que hacen que el muro parezca no existir: que no
> aterrizas en él y que sólo cabe una publicación.

---

## B · Cambios estructurales

Requieren decisión de diseño e implementación real. Es el rediseño.

| # | Cambio | P | Esf. | Efecto | Depende de |
|---|---|---|---|---|---|
| B1 | **Partir `academic-home.tsx`** (523 líneas) en `wall-layout` / `wall-rail` / `wall-feed` / `feed-card` | — | M | Habilitante | — |
| B2 | **Carril de contexto** (identidad + atención + materias), sticky, desde `lg:` | P1 | L | **Alto** | B1 |
| B3 | **Fusionar los dos bloques del muro** en una lista con marca de origen | P2 | M | Alto | B1 |
| B4 | **Tarjeta compacta** con densidades `compact` / `full` | P1 | M | **Alto** | B1, A2 |
| B5 | **Permalink `/muro/[id]`** con el modal como ruta interceptada | P1 | M | Alto | — |
| B6 | **Filtro por materia para todos los roles**, con chips en la URL | P1 | M | Alto | servidor: `api/home` |
| B7 | Compositor a fila de una línea | P2 | S | Medio | B1 |
| B8 | Separador «nuevo desde tu última visita» dentro de la lista | P2 | S | Medio | B3 |
| B9 | Paginación o «cargar más» en el muro | P2 | M | Medio | `api/home` |
| B10 | Pantalla propia de moderación de publicaciones | P2 | M | Medio | — |
| B11 | Carril derecho «Del resto de Nextudio» (≥1440 px) | P2 | M | Medio | B2 |
| B12 | Cierre del muro con salida a `/explore` | P2 | S | Medio | B9 |

**Orden sugerido**: B1 → A2 → B4 → B2 → B3 → B6 → B5 → B8 → B9 → B12 → B7 → B10 → B11.

---

## C · Responsive

| # | Cambio | P | Esf. | Efecto |
|---|---|---|---|---|
| C1 | `overflow-x-auto` + `scroll-snap` en pestañas y chips | P1 | XS | Alto |
| C2 | Rejilla de 1 / 2 / 3 zonas por breakpoint en `/` | P1 | M | Alto |
| C3 | Transformación tablet: chips + tira de atención sobre el muro | P2 | M | Medio |
| C4 | Transformación móvil: miniatura 72 × 45, tarjeta ~125 px | P2 | S | Medio |
| C5 | `xl:grid-cols-4` en `ProjectGrid` | P2 | XS | Bajo |
| C6 | Un solo breakpoint por decisión de visibilidad en el navbar | P2 | S | Bajo |
| C7 | Verificar zoom al 200 % en `/aula/[courseId]` | — | S | — |
| C8 | Verificar el navbar translúcido sobre imágenes al hacer scroll | — | XS | — |

---

## D · Sistema visual

| # | Cambio | P | Esf. | Efecto |
|---|---|---|---|---|
| D1 | **Una sola escala tipográfica**; cerrar la otra con `--text-*: initial` | P1 | M | Alto (a largo plazo) |
| D2 | **`--border-control` con ≥3:1** para `.field`, `.chip`, `.btn-secondary`, `.tag` | P1 | S + revisión visual | Alto (a11y) |
| D3 | Subir `--border` en `prefers-contrast: more` hasta ≥3:1 (hoy 2,74:1) | P2 | XS | Medio |
| D4 | **`<SegmentedNav>`**: un control para las 6 copias de pestañas + 2 grupos de botones + 1 `<select>` | P1 | M | **Alto** |
| D5 | Tres densidades de `.panel` (`row` / `card` / `block`) | P3 | S | Medio |
| D6 | Un radio de superficie (hoy `rounded-sm` y `rounded-md` para lo mismo) | P3 | XS | Bajo |
| D7 | `<PageHeader>` compartido | P3 | S | Medio |
| D8 | `<Icon>` con tamaño y `stroke-width` fijos | P3 | S | Bajo |
| D9 | Un solo estado de hover para superficie enlazada | P3 | XS | Bajo |
| D10 | Esqueleto real para el muro (existe `ProjectGridSkeleton` como modelo) | P2 | S | Medio |

> **D2 es el cambio de mayor riesgo visual de todo el backlog.** Subir el
> contraste de los bordes altera el aspecto de cada campo, chip y botón
> secundario del producto. Hacerlo con revisión de pantalla, no a ciegas.

---

## E · Arquitectura

| # | Cambio | P | Esf. | Efecto |
|---|---|---|---|---|
| E1 | **Un solo vocabulario**: materia / grupo / galería / muro / publicación | P1 | M | Alto |
| E2 | **La pestaña vive en la URL** en materia, tarea y cuenta | P1 | M | Alto |
| E3 | Enlace bidireccional entre `/courses/[slug]` y `/aula/[courseId]` | P1 | M | Alto |
| E4 | **Sustituir el patrón ARIA de pestañas** por enlaces con `aria-current` | P1 | M | Alto (a11y + E2) |
| E5 | `/aula` pasa a índice de materias, sin saludo ni pendientes duplicados | P2 | M | Medio |
| E6 | `/dashboard` → `/cuenta/proyectos`, perfil como hermano | P2 | M | Medio |
| E7 | El conmutador de `/login` ⟷ `/register` navega en vez de cambiar estado | P1 | S | Medio |
| E8 | Exponer carrera y semestre en el DTO público, con interruptor de visibilidad | P2 | M | Medio |
| E9 | Agrupar los proyectos del perfil por periodo | P2 | S | Medio |
| E10 | Renombrar rutas a español (`/materias`, `/explorar`, `/publicar`, `/cuenta`) | P3 | L | Bajo |

> E2 y E4 son **el mismo trabajo**: convertir las pestañas en enlaces que
> escriben en la URL arregla a la vez el botón Atrás y el patrón ARIA
> incompleto. Hacerlos juntos.

---

## F · Mejoras futuras

Fuera del alcance de la V2. Registradas para no perderlas.

| # | Idea | Motivo |
|---|---|---|
| F1 | Vincular cuentas por correo verificado en Firebase Auth | Producción tiene dos perfiles del mismo docente (`ux-problems.md` UX-10) |
| F2 | Limpiar cursos y perfiles duplicados en producción | Salen en el `sitemap.xml` público |
| F3 | Impedir dos materias con el mismo nombre y periodo | Misma causa |
| F4 | **Medir `teacherTasksFor`** antes de escalar | Un `listSubmissionsByAssignment` por tarea publicada de cada materia: con 6 materias × 10 tareas son 60 consultas en el endpoint del inicio |
| F5 | El escaparate público menciona el aula | Un estudiante nuevo no sabe que existe |
| F6 | Renombrar «Recursos IA» por su función, no por su tecnología | El resto de la copia acierta en esto («un archivo HTML», no «static site») |
| F7 | Elegir entre «actividad» y «tarea» | Hoy se usan como sinónimos: `EVENT_VERB.assignment` dice «actividad», la ruta y la pestaña dicen «tareas» |
| F8 | Filtro de materia también en `/explore` para miembros | Ver su propia materia marcada en la galería pública |
| F9 | Actualizar `docs/ACCESSIBILITY.md` | Afirma «controles ≥ 3:1»; la medición da 1,8:1 |
| F10 | Etiquetas de temas en el perfil, derivadas de los `tags` de los proyectos | Coste cero, sale de datos existentes |

---

## Top 10 por relación efecto / esfuerzo

| # | Cambio | Esf. | Efecto | Ref. |
|---|---|---|---|---|
| 1 | Tras iniciar sesión, ir a `/` | XS | Alto | A1 |
| 2 | Miniatura en la tarjeta del muro | S | Alto | A2 |
| 3 | `overflow-x-auto` en las pestañas | XS | Alto | A5 / C1 |
| 4 | Quitar saludo, botón duplicado, verbo y botón por tarjeta | S | Medio-alto | A3, A4, A6, A7 |
| 5 | Carril de contexto | L | Alto | B2 |
| 6 | Fusionar los dos bloques del muro | M | Alto | B3 |
| 7 | Filtro por materia para todos, en la URL | M | Alto | B6 |
| 8 | `<SegmentedNav>` + pestañas en la URL + ARIA | M | Alto | D4 + E2 + E4 |
| 9 | Permalink `/muro/[id]` | M | Alto | B5 |
| 10 | `--border-control` con ≥3:1 | S | Alto (a11y) | D2 |

---

## Qué debería hacer primero el siguiente agente

**Fase 0 — medio día, sin riesgo, efecto inmediato**

A1 + A2 + A5. Tres cambios pequeños que arreglan: aterrizar en el sitio
equivocado, ver una sola publicación por pantalla, y una fila de pestañas que
desborda en móvil para el rol docente. Ninguno depende del rediseño.

**Fase 1 — un día, habilitante**

B1: partir `academic-home.tsx`. Nada del rediseño del muro se puede hacer con
comodidad mientras layout, feed, atención, tarjetas y estados vivan en 523 líneas
del mismo archivo. Sin cambios visibles.

**Fase 2 — el rediseño del muro**

B4 (tarjeta compacta) → B2 (carril) → C2 (rejilla por breakpoint) → B3 (una sola
lista) → B6 (filtro). En ese orden: la tarjeta primero porque es lo que fija la
densidad, y el carril después porque su valor depende de que el muro ya sea
denso.

**Fase 3 — URLs y consistencia**

E2 + E4 + D4 juntos (son el mismo trabajo), luego B5 (permalink) y D1 (escala
tipográfica).

**Fase 4 — sistema visual y perfil**

D2 con revisión visual, D5, E8, E9.

Lo que **no** hay que hacer primero: renombrar rutas (E10), el carril derecho
(B11) y cualquier cosa de la sección F. Y no empezar por D2: es el cambio de
mayor riesgo visual y conviene hacerlo cuando la maquetación ya esté estable.
