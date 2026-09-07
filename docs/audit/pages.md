# Mapa de pantallas de UINexus

Construido leyendo `src/app/**` (App Router) y comprobando contra la versión
desplegada en `https://uinex.vercel.app`. Fecha: 2026-09-06.

## Cómo leer la tabla

`Acceso` distingue tres cosas que en este producto no coinciden:

- **Público** — HTML completo desde el servidor, indexable, sin cuenta.
- **Cliente** — la ruta existe y devuelve 200, pero el contenido lo pinta React
  después de resolver la sesión. El HTML inicial no contiene ni el `<h1>`.
- **Redirección** — sólo reenvía.

Esa distinción importa: `/aula`, `/dashboard` y todo `/aula/**` devuelven 200 con
la cáscara vacía. No es un fallo de seguridad (los datos vienen de `/api/**`, que
sí exige token), pero sí explica el parpadeo y la ausencia de encabezado en el
HTML inicial.

## Superficie pública

| Ruta | Pantalla | Propósito | Acceso | Componente raíz |
|---|---|---|---|---|
| `/` | Portada / Inicio | Reparto: visitante ve escaparate, sesión ve su muro | Público + cliente | `home/home-gate.tsx` |
| `/explore` | Explorar proyectos | Galería completa, búsqueda y filtros por URL | Público | `app/explore/page.tsx` |
| `/courses` | Cursos | Índice de galerías por materia | Público | `app/courses/page.tsx` |
| `/courses/[slug]` | Galería de un curso | Exposición del grupo en un periodo | Público | `app/courses/[slug]/page.tsx` |
| `/about` | Acerca de | Qué es, seguridad, privacidad, límites | Público | `app/about/page.tsx` |
| `/[handle]` | Perfil público | Persona + sus proyectos publicados | Público | `app/[handle]/page.tsx` |
| `/[handle]/[slug]` | Ficha de proyecto | Portada, brief y enlace a la página real | Público | `project/project-shell.tsx` |
| `/[handle]/[slug]/preview` | Vista previa | Borrador sin ejecutar JavaScript | Autor | `project/project-preview.tsx` |

## Entrada

| Ruta | Pantalla | Propósito | Acceso | Componente raíz |
|---|---|---|---|---|
| `/login` | Iniciar sesión | Google + correo institucional; teléfono y reset detrás | Cliente | `auth/login-form.tsx` |
| `/register` | Crear cuenta | **Mismo componente** con `initialMode="signup"` | Cliente | `auth/login-form.tsx` |
| `/signup` | — | `redirect('/register')` | Redirección | `app/signup/page.tsx` |

> Tres rutas, una sola pantalla. El selector de modo vive dentro del formulario,
> así que la URL y el estado visible pueden desincronizarse: se puede estar en
> `/register` viendo «Iniciar sesión». Ver `ux-problems.md` · UX-09.

## Publicación

| Ruta | Pantalla | Propósito | Acceso | Componente raíz |
|---|---|---|---|---|
| `/publish` | ¿Qué quieres publicar? | Bifurcación en tres tipos de proyecto | Público | `app/publish/page.tsx` |
| `/publish/new` | Asistente de 5 pasos | Archivos → información → vista previa → visibilidad → hecho | Cliente | `publish/publish-flow.tsx` |

## Espacio propio

| Ruta | Pantalla | Propósito | Acceso | Componente raíz |
|---|---|---|---|---|
| `/dashboard` | Tus proyectos | Tabla/tarjetas con estado, tamaño y acciones | Cliente | `dashboard/dashboard-client.tsx` |
| `/dashboard/profile` | Editar perfil | Nombre, bio, programa **+ matrícula, semestre, carrera, departamento, título** | Cliente | `dashboard/profile-editor.tsx` |
| `/dashboard/[projectId]/edit` | Editar proyecto | Metadatos, archivos, visibilidad | Cliente | `dashboard/edit-project.tsx` |

## Aula (docencia)

| Ruta | Pantalla | Propósito | Acceso | Componente raíz |
|---|---|---|---|---|
| `/aula` | Portada del aula | Pendientes + materias que cursa / imparte | Cliente | `aula/aula-home.tsx` |
| `/aula/[courseId]` | Materia | 5 pestañas: Resumen, Tareas, Estudiantes, Proyectos, Recursos IA | Cliente | `aula/course-workspace.tsx` |
| `/aula/[courseId]/estudiantes/[handle]` | Estudiante en la materia | Entregas y progreso de una persona | Docente | `aula/student-in-course.tsx` |
| `/aula/[courseId]/tareas/nueva` | Nueva tarea | Editor con workflow, entregables y recursos | Docente | `aula/assignment-editor.tsx` |
| `/aula/[courseId]/tareas/[assignmentId]` | Detalle de tarea | Enunciado, workflow, entregas | Ambos | `aula/assignment-detail.tsx` |
| `/aula/[courseId]/tareas/[assignmentId]/editar` | Editar tarea | Igual que «nueva» | Docente | `aula/assignment-editor.tsx` |
| `/aula/[courseId]/tareas/[assignmentId]/entrega` | Entregar | Formulario de entrega y ejecución del workflow | Estudiante | `aula/submission-form.tsx` |
| `/aula/[courseId]/tareas/[assignmentId]/conjunta` | Actividad conjunta | Reparto de conceptos entre el grupo | Ambos | `aula/collaborative-screen.tsx` |
| `/aula/[courseId]/recursos/skills/nueva` | Nueva Skill | Editor de Skill | Ambos | `aula/skill-editor.tsx` |
| `/aula/[courseId]/recursos/skills/[skillId]` | Ver Skill | Ficha, métodos de instalación | Ambos | `aula/skill-detail.tsx` |
| `/aula/[courseId]/recursos/skills/[skillId]/editar` | Editar Skill | Editor de Skill | Autor/docente | `aula/skill-editor.tsx` |

## Estados globales

| Archivo | Cuándo | Contenido |
|---|---|---|
| `app/loading.tsx` | Suspense de ruta | `container-page py-10` con esqueleto |
| `app/error.tsx` | Error de render | Panel centrado con reintento |
| `app/not-found.tsx` | 404 | Panel centrado |

## Superficies que NO son páginas pero funcionan como tales

Descubrimiento importante: hay pantallas completas que no tienen ruta y por
tanto no se pueden enlazar, compartir ni recuperar con el botón Atrás.

| Superficie | Dónde vive | Cómo se abre | Problema |
|---|---|---|---|
| **Detalle de publicación del muro** | `home/publication-detail.tsx` | `<dialog>` modal desde una tarjeta del muro | Sin URL. Una publicación del muro no se puede compartir |
| **Compositor de publicaciones** | `home/publication-composer.tsx` | Se despliega en línea en `/` | Empuja el muro hacia abajo aunque esté cerrado |
| **Moderación de publicaciones** | `home/publication-composer.tsx` | Se inserta en `/` si hay pendientes | La cola de moderación no tiene pantalla propia |
| **Visor de entregas** | `aula/submission-viewer.tsx` | `<dialog>` desde la lista de entregas | Sin URL |
| **Pestañas de `/aula/[courseId]`** | `aula/course-workspace.tsx` | `useState`, lee `?tab=` **pero no lo escribe** | Cambiar de pestaña no cambia la URL; Atrás sale de la materia |

## API (contexto, no auditada como interfaz)

`/api/home`, `/api/aula`, `/api/courses/**`, `/api/assignments/**`,
`/api/submissions/**`, `/api/projects/**`, `/api/publications/**`,
`/api/resources/**`, `/api/skills/**`, `/api/prompts/**`, `/api/profile`,
`/api/people/search`, `/api/reports`.

`/api/home` es el único endpoint del muro: una petición devuelve materias,
atención, tareas docentes, publicaciones y los dos bloques de eventos.

## Datos reales en producción (2026-09-06)

Leídos de `sitemap.xml`:

- 2 cursos, con nombres casi idénticos: `diseno-centrado-en-el-usuario` y
  `diseno-centrado-en-el-usuario-8c29` («Diseño centrado en el usuario» y
  «Diseño Centrado en el Usuario»).
- 2 perfiles del mismo docente: `@christian-gibran-esp` y
  `@christian-gibran-esp-2`.
- 1 proyecto publicado.

La instancia de producción es, hoy, un entorno de una sola persona con datos
duplicados. Toda conclusión sobre densidad de este informe está calculada sobre
el CSS y no sobre lo que hoy hay en la base de datos, porque hoy no hay
contenido suficiente para que el muro se comporte como un muro.
