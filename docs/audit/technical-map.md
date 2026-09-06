# Mapa técnico

Referencia para que el siguiente agente implemente sin volver a descubrir el
producto. Formato: `pantalla → ruta → layout → componente → estilos → datos`.

## Cadena común a todas las pantallas

```
app/layout.tsx
├── <ThemeScript />          components/theme/theme-script.tsx    escribe data-theme antes de pintar
├── <SessionScript />        components/home/session-hint.tsx     escribe data-session antes de pintar
├── .skip-link               globals.css @layer components
└── <AuthProvider>           components/auth/auth-provider.tsx    estado de sesión (Firebase, en memoria)
    └── <AppFrame>           components/app-shell/app-frame.tsx   oculta marco en /@handle/[slug]
        ├── <DemoBanner />   components/app-shell/demo-banner.tsx sólo en modo demo
        ├── <Navbar />       components/app-shell/navbar.tsx      sticky, h-16, z-40
        ├── <main id="contenido" tabIndex={-1}>
        └── <Footer />       components/app-shell/footer.tsx
```

Fuentes: `Fraunces` (`--font-fraunces`, ejes SOFT/WONK/opsz) y `Inter`
(`--font-inter`), cargadas con `next/font/google` en `layout.tsx`.

`AppFrame` oculta banner, navbar y pie cuando `isProjectShellPath(pathname)`
(`lib/slug.ts:45`): la ficha de un proyecto se presenta a pantalla completa.

---

## 1. Inicio · `/`

```
app/page.tsx                        RSC, revalidate = 300
│  carga listFeaturedProjects(3), listProjects({sort:'recent'},1,6), listCourses()
└── components/home/home-gate.tsx   'use client'
    ├── status === 'authenticated' → <AcademicHome />
    ├── status === 'anonymous'     → <Landing featured latest courses />
    └── status === 'loading'       → Landing oculta por CSS + marcador
```

El reparto antes de la primera pintura lo hace CSS, no React:
`globals.css` final — `[data-session='in'] [data-home-gate='landing'] { display:none }`.

### 1a · Muro autenticado

| Capa | Archivo | Notas |
|---|---|---|
| Componente | `components/home/academic-home.tsx` (523 líneas) | Contiene **todo** el muro |
| Datos | `useApi<HomePayload>('/api/home')` vía `lib/aula-client.ts` | Una sola petición |
| Endpoint | `app/api/home/route.ts` | `FEED_LIMIT=20`, `ATTENTION_LIMIT=12` |
| Lógica pura | `lib/home-feed.ts` | `ATTENTION_ORDER`, `sortAttention`, `sortEvents`, `sortEventsReservingAssignments`, `relativeTime`, `summarizeSince`, `filterEventsByCourse` |
| Fechas | `lib/due-date.ts` | `formatDueLabel`, `isPastDue`, `resolveDueInstant` |
| Progreso | `lib/workflow.ts` | `workflowProgress`, `missingRequiredSteps` |
| Contenedor | `container-page max-w-3xl py-8` | **768 px, sin breakpoints** |

Subcomponentes dentro de `academic-home.tsx`:

| Función | Qué pinta | Estilos clave |
|---|---|---|
| `AcademicHome` | Orquesta el orden completo | `container-page max-w-3xl py-8` |
| `SinceSummaryLine` | «Desde tu última visita» | `rounded-sm border bg-sunken px-4 py-3 text-sm` |
| `StudentAttention` | Sección «Necesita tu atención» | `mt-10`, `h2.section-mark` |
| `AttentionCard` | Tarjeta de tarea pendiente | `panel p-4` + `border-accent` si urgente |
| `TeacherAttention` | Sección «Requiere tu atención» | igual |
| `TeacherTaskCard` | Revisar / moderar / cierra hoy | `panel p-4` |
| `FeedSection` | Cabecera + lista de eventos | `mt-12`, `ul.space-y-3` |
| **`FeedCard`** | **La tarjeta del muro** | `panel p-4`, `flex gap-3`, avatar 30, portada `aspect-16/10` |

Constantes de comportamiento: `LAST_VISIT_KEY = 'uinexus-home-visit'`
(`localStorage`), `REASON_LABEL`, `URGENT`, `EVENT_VERB`.

Componentes externos usados por el muro:
`ui/user-avatar.tsx`, `project/generated-cover.tsx`, `ui/empty-state.tsx`,
`home/publication-composer.tsx`, `home/publication-detail.tsx`.

### 1b · Escaparate público

`components/home/landing.tsx` → `project/project-card.tsx`,
`project/project-grid.tsx`, `explore/search-field.tsx`, `ui/empty-state.tsx`.
Secciones: entrada (`lg:grid-cols-[1.25fr_1fr]`), destacados
(`lg:grid-cols-[1.6fr_1fr]`), explorar, galerías por curso, cierre.

---

## 2. Publicaciones del muro

| Pieza | Archivo | Notas |
|---|---|---|
| Compositor | `components/home/publication-composer.tsx` → `PublicationComposer` | Cerrado = `panel p-4` con `<button className="field">` |
| Moderación | mismo archivo → `PublicationModeration` | `id="publication-moderation"`, destino del ancla de `TeacherTaskCard` |
| Detalle | `components/home/publication-detail.tsx` | `<dialog>` nativo, `showModal()`, `max-w-3xl` |
| Contenido | mismo archivo → `PublicationContent` | Discrimina por forma del recurso (`'prompt' in`, `'brief' in`, …) |
| Tipos | `lib/publications.ts` | `PublicationDTO`, `PublicationOption`, `PublicationDetail` |
| Servidor | `lib/server/publications.ts`, `app/api/publications/route.ts`, `app/api/publications/[id]/route.ts` | |
| Etiquetas | `PUBLICATION_LABELS` en `publication-composer.tsx` | |

El compositor **reutiliza los editores del aula**: `PromptEditor`
(`aula/resources-panel.tsx`), `CourseResourceEditor`
(`aula/general-resources.tsx`), `SkillEditor` (`aula/skill-editor.tsx`). Para
tipo `project` deriva a `/publish/new?type=…&compartir=…`.

---

## 3. Aula

| Pantalla | Ruta | Componente | Datos |
|---|---|---|---|
| Portada | `/aula` | `aula/aula-home.tsx` | `useApi<AulaHome>('/api/aula')` |
| Materia | `/aula/[courseId]` | `aula/course-workspace.tsx` | `useApi<CourseOverview>('/api/courses/{id}')` |
| Roster | pestaña | `aula/roster-panel.tsx` | `/api/courses/{id}/students` |
| Recursos | pestaña | `aula/resources-panel.tsx` | `/api/courses/{id}/{prompts,skills,library}` |
| Proyectos | pestaña | `CourseProjects` en `course-workspace.tsx` | `/api/courses/{id}/projects` |
| Tarea | `/aula/[courseId]/tareas/[id]` | `aula/assignment-detail.tsx` | `/api/assignments/{id}` |
| Editor de tarea | `…/nueva`, `…/editar` | `aula/assignment-editor.tsx` (1176 líneas) | |
| Entrega | `…/entrega` | `aula/submission-form.tsx` | `/api/assignments/{id}/submission` |
| Conjunta | `…/conjunta` | `aula/collaborative-screen.tsx` | `/api/assignments/{id}/collaborative` |
| Skill | `…/recursos/skills/…` | `aula/skill-detail.tsx`, `skill-editor.tsx` | `/api/skills/{id}` |

Piezas compartidas: `aula/aula-ui.tsx` → `AulaScreen` (estado de carga/error con
`next` para volver tras el login), `Crumbs`, `Stat`, `DueDate`,
`SubmissionBadge`, `AssignmentStatusBadge`, `TypeChip`, `Notice`.

Cliente: `lib/aula-client.ts` → `useApi`, `joinCourse`, `createCourse`, y los
tipos `AulaHome` y `CourseOverview`.

**Patrón de pestañas repetido en 6 sitios** (ver `ui-consistency.md` D-04):

```tsx
-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm
{activa ? 'border-accent font-medium text-accent'
        : 'border-transparent text-muted hover:text-fg'}
```

Archivos: `course-workspace.tsx:87`, `assignment-detail.tsx:485`,
`deliverable-fields.tsx:286`, `resources-panel.tsx:73`,
`workflow-progress.tsx:82`, `dashboard-client.tsx:98`.

---

## 4. Galería pública

| Pantalla | Ruta | Componente | Datos | Cache |
|---|---|---|---|---|
| Explorar | `/explore` | `app/explore/page.tsx` (RSC) | `listProjects`, `getExploreFacets` | `revalidate = 120` |
| Filtros | — | `explore/filter-bar.tsx` | Enlaces, estado en la URL | — |
| Buscador | — | `explore/search-field.tsx` | `<form>` GET | — |
| Cursos | `/courses` | `app/courses/page.tsx` | `listCourses` | `revalidate = 600` |
| Curso | `/courses/[slug]` | `app/courses/[slug]/page.tsx` | — | — |
| Perfil | `/@handle` | `app/[handle]/page.tsx` | `getUserByHandle`, `listProjectsByHandle` | `revalidate = 300` |
| Proyecto | `/@handle/[slug]` | `project/project-shell.tsx` | — | — |

Tarjetas: `project/project-card.tsx` (portada 16:10, título como único
interactivo extendido con `::after`), `project/project-grid.tsx`
(`sm:grid-cols-2 lg:grid-cols-3` + `ProjectGridSkeleton`),
`project/generated-cover.tsx` (portada determinista a partir de una semilla).

Paginación: `PAGE_SIZE = 24`, enlaces `?page=` con `exploreHref` (`lib/urls.ts`).

---

## 5. Publicar

```
/publish        app/publish/page.tsx        RSC, 3 opciones de PROJECT_TYPES
/publish/new    publish/publish-flow.tsx    746 líneas, 5 pasos
                ├── 1 archivos     publish/upload-dropzone.tsx
                ├── 2 información
                ├── 3 vista previa  lib/preview.ts (no ejecuta JS)
                ├── 4 visibilidad   publish/visibility-selector.tsx
                └── 5 hecho        + compartir en el muro (?compartir=)
```

Soporte: `lib/publish-client.ts`, `lib/files.ts` (validación y descompresión de
zip), `lib/constants.ts` (`LIMITS`, `ALLOWED_EXTENSIONS`, `PROJECT_TYPES`).
El foco se mueve al `<h1>` de cada paso con `headingRef` + `tabIndex={-1}`.

---

## 6. Cuenta

| Pantalla | Ruta | Componente | Notas |
|---|---|---|---|
| Proyectos | `/dashboard` | `dashboard/dashboard-client.tsx` | Tabla en desktop, tarjetas en móvil |
| Acciones | — | `dashboard/project-row-actions.tsx` | |
| Perfil | `/dashboard/profile` | `dashboard/profile-editor.tsx` | **Recoge `enrollmentNumber`, `semester`, `career`, `department`, `academicTitle` — ninguno se muestra en público** |
| Editar proyecto | `/dashboard/[id]/edit` | `dashboard/edit-project.tsx` | |

Datos: `lib/use-my-projects.ts`, `app/api/profile/route.ts`,
`lib/schemas.ts` (`profileSchema`), `lib/academic-schemas.ts`
(`academicProfileSchema`).

---

## 7. Sistema de diseño

Un solo archivo: **`src/app/globals.css`** (613 líneas).

| Bloque | Líneas aprox. | Contenido |
|---|---|---|
| `:root` | 20–70 | Superficies, texto, trazo, acento, semánticos, radios, sombras, movimiento |
| `[data-theme='dark']` | 72–100 | Paleta oscura recalculada |
| `@theme inline` | 104–175 | Mapeo a utilidades + escala tipográfica de 8 pasos |
| `@layer base` | 180–260 | Reset, retícula de fondo, `:focus-visible`, tamaño mínimo en móvil |
| `@layer components` | 265–520 | `.skip-link .btn .field .label .hint .panel .tag .chip .meta .section-mark .prose-block` |
| `@layer utilities` | 525–560 | `.container-page .hairline-t .hairline-b .sr-only` |
| Media queries | 565–600 | `prefers-reduced-motion`, `prefers-contrast: more` |
| Reparto de `/` | 600–613 | `[data-session]` / `[data-home-gate]` |

Tokens que hay que conocer antes de tocar nada:

```
--bg #f3f1ea   --surface #fbfaf6   --surface-raised #fff   --surface-sunken #eceadf
--fg #191a1c   --fg-muted #56585f  --fg-subtle #6b6d75
--border #ded9cc (1.25:1)          --border-strong #c3bcaa (1.67:1)   ← ver accessibility.md A-01
--accent #ad3f1c                   --accent-soft #f4e3da
--radius-xs 2  --radius-sm 4  --radius-md 6  --radius-lg 10 (sin usar)
--ease cubic-bezier(0.2,0,0,1)     --duration 160ms
```

---

## 8. Datos y servidor

```
lib/data/repository.ts      DynamoDB o modo demo, según variables de entorno
lib/data/demo.ts            datos de ejemplo: la interfaz funciona sin nube
lib/data/mappers.ts         frontera de privacidad de proyectos
lib/data/academic.ts        listCoursesForUser, listAssignmentsByCourse, …
lib/data/academic-mappers.ts  UID → handle; NO saltarse
lib/server/session.ts       requireIdentity / requireActor / requireWriter, HttpError
lib/server/writes.ts        reserveHandle, ensureProfile, updateProfile, escrituras
lib/server/academic-views.ts / academic-writes.ts / course-access.ts / publications.ts
lib/aws/*                   config, DynamoDB, S3 firmado
lib/firebase/*              sólo identidad
```

La sesión es un **ID token de Firebase en memoria**, no una cookie. De ahí que
`/` no pueda redirigir en el servidor y exista `HomeGate` (ver el comentario de
`app/page.tsx`).

---

## 9. Archivos que tocará el rediseño del muro

Por orden de impacto:

| # | Archivo | Qué hay que hacer |
|---|---|---|
| 1 | `components/home/academic-home.tsx` | Partirlo. Hoy son 523 líneas con layout, feed, atención, tarjetas y estados |
| 2 | `app/globals.css` | Escala tipográfica única, `--border-control`, densidades de `.panel` |
| 3 | `components/auth/login-form.tsx` | `next` por defecto `/dashboard` → `/` |
| 4 | `components/home/publication-detail.tsx` | Ruta `/muro/[id]` + modal interceptado |
| 5 | `app/api/home/route.ts` | Permitir filtro por materia a estudiantes; paginación |
| 6 | `components/aula/course-workspace.tsx` + 5 más | Pestañas a URL y a componente único |
| 7 | `app/[handle]/page.tsx` + `lib/types.ts` | Exponer carrera/semestre en el DTO público |
| 8 | `components/app-shell/navbar.tsx` | Un breakpoint por decisión de visibilidad |

### Componentes nuevos sugeridos

```
components/home/
├── wall-layout.tsx        rejilla de 1 / 2 / 3 zonas por breakpoint
├── wall-rail.tsx          carril: identidad + atención + materias
├── wall-feed.tsx          lista, filtro, paginación, separador «nuevo»
├── feed-card.tsx          extraído de academic-home, con densidad compact/full
└── wall-context.tsx       carril derecho (≥1440), opcional

components/ui/
├── segmented-nav.tsx      sustituye las 6 copias de pestañas
├── page-header.tsx        título + subtítulo + acción
└── icon.tsx               tamaño, stroke-width y aria-hidden en un sitio
```

### Componentes que se reutilizan sin cambios

`ui/user-avatar.tsx`, `ui/empty-state.tsx`, `ui/status-badge.tsx`,
`project/generated-cover.tsx`, `project/project-card.tsx` (galería),
`aula/aula-ui.tsx` (badges y fechas), `lib/home-feed.ts` **íntegro**,
`lib/due-date.ts`, `lib/workflow.ts`.

### Lo que no hay que tocar

`app/api/home/route.ts` en su frontera de privacidad, `lib/home-feed.ts` en su
orden de prioridad, `lib/server/*`, `lib/data/*mappers*`, `infra/`, y el
aislamiento por origen descrito en `docs/SECURITY.md`.
