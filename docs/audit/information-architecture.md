# Arquitectura de información

## 1. Arquitectura actual

```
/                          escaparate público  ⟷  muro autenticado  (HomeGate)
├── /explore               galería completa, filtros en la URL
├── /courses               índice de galerías por materia
│   └── /courses/[slug]    galería de una materia
├── /about
├── /@handle               perfil público
│   └── /@handle/[slug]    ficha de proyecto
│       └── /preview       vista previa del borrador
│
├── /login  ─┐
├── /register├── una sola pantalla, tres rutas
├── /signup ─┘  (signup → redirect)
│
├── /publish               ¿qué quieres publicar? (3 tipos)
│   └── /publish/new       asistente de 5 pasos
│
├── /dashboard             tus proyectos
│   ├── /dashboard/profile edición de perfil (+ campos académicos ocultos)
│   └── /dashboard/[id]/edit
│
└── /aula                  pendientes + materias
    └── /aula/[courseId]   [Resumen|Tareas|Estudiantes|Proyectos|Recursos IA]
        ├── /estudiantes/[handle]
        ├── /tareas/nueva
        ├── /tareas/[id]  [pestañas]
        │   ├── /editar
        │   ├── /entrega
        │   └── /conjunta
        └── /recursos/skills/…
```

## 2. Los cinco problemas estructurales

### IA-01 · Una materia vive en dos árboles con dos nombres

```
/courses/[slug]      «Curso»   público, galería de proyectos terminados
/aula/[courseId]     «Materia» privado, tareas, entregas, recursos, roster
```

Son la misma entidad. Tienen identificadores distintos (`slug` contra `id`),
vocabulario distinto y **ningún enlace entre ellas en ninguna dirección**. Desde
la galería pública de Diseño Centrado en el Usuario no se puede llegar a su aula,
ni al revés. Un estudiante inscrito que abre `/courses` ve su propia materia como
si fuera de otro.

Efecto en la escala: con seis materias y dos grupos cada una, esto son doce
entradas en `/courses` y doce en `/aula`, sin relación visible.

### IA-02 · Cuatro palabras para un concepto

| Palabra | Dónde aparece |
|---|---|
| **Curso** | navbar público, `/courses`, filtro «Curso» de `/explore`, pie |
| **Materia** | `/aula` («Tus materias», «Materias que impartes»), `/` |
| **Grupo** | compositor («Audiencia», «Todos mis grupos»), filtro del muro |
| **Aula** | navbar privado, migas de pan |

«Grupo» sí designa algo distinto —una instancia de una materia con un conjunto de
estudiantes—, pero la interfaz nunca lo explica y lo usa indistintamente. «Curso»
y «Materia» son sinónimos puros.

### IA-03 · Cuatro entradas para «lo mío», tres de ellas cruzadas

| Ruta | Qué contiene | Solapamiento |
|---|---|---|
| `/` | Muro + pendientes | Los pendientes están también en `/aula` |
| `/aula` | Pendientes + materias | Los pendientes están también en `/` |
| `/dashboard` | Proyectos publicados | Los proyectos están también en `/@handle` |
| `/@handle` | Perfil + proyectos | Idem, versión pública |

`/` y `/aula` empiezan con el mismo `<h1>Hola, {nombre}</h1>` y ambos listan lo
que hay que hacer. `/dashboard` y `/@handle` listan los mismos proyectos con
distinto envoltorio. El usuario tiene que aprender cuál de las cuatro visita
según lo que quiera hacer, y la diferencia no es evidente desde ninguna de ellas.

### IA-04 · El estado de la interfaz no vive en la URL (excepto en `/explore`)

`/explore` lo hace **bien**, y el código lo argumenta:

> «Cada filtro es un ENLACE, no un control de JavaScript. El estado vive en la
> URL, así que se puede compartir "los proyectos de accesibilidad de este curso",
> el botón Atrás funciona y la página sigue filtrando sin JS.»

Ese criterio no se aplicó en ningún otro sitio:

| Estado | Ruta | ¿En la URL? |
|---|---|---|
| Filtros de galería | `/explore` | **Sí** |
| Pestaña de materia | `/aula/[courseId]` | Se lee, no se escribe |
| Pestaña de tarea | `/aula/[courseId]/tareas/[id]` | No |
| Pestaña de proyectos | `/dashboard` | No |
| Publicación abierta | `/` | No (modal) |
| Entrega abierta | tarea | No (modal) |
| Filtro del muro | `/` | No |
| Modo de entrada | `/login` ⟷ `/register` | Se lee, no se escribe |

### IA-05 · Funciones enterradas

| Función | Profundidad | Comentario |
|---|---|---|
| Editar el perfil (con carrera y semestre) | navbar → menú de cuenta → «Editar perfil» | Se pide rellenarlo y luego no se muestra en ningún sitio |
| Ver el perfil público propio | navbar → menú de cuenta | 3 niveles para ver cómo te ven |
| Recursos IA de una materia | `/aula` → materia → pestaña «Recursos IA» | 3 clics; y es contenido que el muro sí publica |
| Moderar publicaciones | Aparece dentro de `/` cuando hay pendientes | No hay pantalla estable |
| Actividad conjunta | tarea → «conjunta» | Sin punto de entrada desde `/aula` |
| Unirse a una materia con código | `/aula` → botón | Correcto, pero es el primer acto de un estudiante nuevo y `/` no lo ofrece |

---

## 3. Arquitectura recomendada

### Principios

1. **Una entidad, una ruta, un nombre.** Materia es materia en todas partes.
2. **El estado visible se puede pegar en un chat.** El criterio de `/explore` se
   extiende a todo el producto.
3. **Público y privado son vistas de la misma cosa**, no árboles distintos.
4. **Cuatro entradas de nivel superior, no más.** Hoy hay tres visibles y cuatro
   reales.

### Árbol propuesto

```
/                                  INICIO — el muro (autenticado)
│                                  escaparate público (anónimo)
│  carril: identidad · atención · materias
│  centro: muro filtrable por materia
│  carril ≥1440: del resto de UINexus
│
├── /muro/[publicationId]          NUEVO · permalink de una publicación
│                                  (modal interceptado desde el muro)
│
├── /materias                      antes /aula
│   └── /materias/[id]             antes /aula/[courseId]
│       ?vista=resumen|tareas|estudiantes|proyectos|recursos
│       │  ← la pestaña pasa a la URL
│       ├── /materias/[id]/publico     NUEVO · la galería pública de esta materia
│       │                              (misma vista que /cursos/[slug], con contexto)
│       ├── /materias/[id]/estudiantes/[handle]
│       ├── /materias/[id]/tareas/nueva
│       └── /materias/[id]/tareas/[id]?vista=…
│           ├── /editar   /entrega   /conjunta
│
├── /explorar                      antes /explore — ya correcto, sólo se traduce
│   └── ?q= &materia= &periodo= &tipo= &orden=
│
├── /cursos                        antes /courses — índice público de materias
│   └── /cursos/[slug]             galería pública
│       └── enlace explícito a /materias/[id] si eres miembro
│
├── /publicar                      antes /publish
│   └── /publicar/nuevo
│
├── /@handle                       PERFIL — portafolio + contexto académico
│   ├── ?periodo=                  agrupación por periodo
│   └── /@handle/[slug]            ficha de proyecto
│
├── /cuenta                        antes /dashboard
│   ├── /cuenta/proyectos          antes /dashboard (lista)
│   ├── /cuenta/perfil             antes /dashboard/profile
│   └── /cuenta/proyectos/[id]/editar
│
└── /acerca
```

> Renombrar rutas a español es **opcional y de prioridad baja**. Lo que no es
> opcional es el vocabulario visible. Si se decide no tocar las rutas, el árbol
> es el mismo con los nombres actuales; lo importante son los cambios
> estructurales marcados abajo.

### Cambios estructurales, en orden de importancia

| # | Cambio | Resuelve |
|---|---|---|
| 1 | **`/muro/[id]`**: cada publicación tiene URL | IA-04, UX-04, UX-16 |
| 2 | **La pestaña va en la URL** en materia, tarea y cuenta | IA-04, UX-05, A-03 |
| 3 | **Un solo nombre**: «materia» en toda la interfaz; «grupo» sólo para la instancia con estudiantes, y explicado | IA-02 |
| 4 | **Enlace bidireccional** entre la galería pública de una materia y su aula | IA-01 |
| 5 | **Fusionar `/` y `/aula`** en la práctica: los pendientes viven en el carril de `/`; `/materias` pasa a ser un índice de materias, sin saludo ni pendientes duplicados | IA-03 |
| 6 | **`/dashboard` → `/cuenta/proyectos`**, con el perfil como hermano y no como hijo | IA-03, IA-05 |
| 7 | **Carrera y semestre visibles** en el perfil público | IA-05 |
| 8 | **Pantalla propia de moderación** enlazada desde el carril | UX-18 |

### El árbol de navegación visible

```
Sin sesión
  [UINexus]   Explorar · Cursos · Acerca de      [Iniciar sesión] [Publicar]

Con sesión
  [UINexus]   Inicio · Materias · Explorar        [buscar] [Publicar] [avatar ▾]
                                                                       ├ Tu perfil
                                                                       ├ Tus proyectos
                                                                       ├ Editar perfil
                                                                       └ Cerrar sesión
```

Tres entradas con sesión, igual que hoy, pero «Aula» pasa a «Materias» para que
coincida con lo que dice la pantalla a la que lleva.

---

## 4. Glosario propuesto

Un término, una definición, y **prohibido usar los sinónimos en la interfaz**.

| Término | Qué es | Ruta | Sinónimos a retirar |
|---|---|---|---|
| **Materia** | La asignatura con sus tareas, personas y recursos | `/materias/[id]` | curso, aula, clase |
| **Grupo** | Una instancia de una materia con un conjunto de estudiantes y su código de acceso | (misma ruta) | — |
| **Galería** | La exposición pública de los proyectos de una materia | `/cursos/[slug]` | curso público |
| **Muro** | El flujo de lo publicado en tus materias | `/` | inicio, feed |
| **Publicación** | Una unidad del muro (anuncio, recurso, prompt, Skill o página) | `/muro/[id]` | evento, aportación |
| **Proyecto** / **Página** | Lo que sube un estudiante y obtiene dirección propia | `/@handle/[slug]` | trabajo, sitio |
| **Tarea** | Una actividad con entrega | `/materias/[id]/tareas/[id]` | actividad |
| **Entrega** | Lo que un estudiante manda para una tarea | — | submission |
| **Recurso** | Material de apoyo: enlace, prompt o Skill | — | «Recursos IA» |

Nota: hoy la interfaz usa «actividad» y «tarea» indistintamente
(`EVENT_VERB.assignment = 'Publicó una actividad'` pero la ruta es `/tareas/` y
la pestaña se llama «Tareas»). Elegir una.

---

## 5. ¿Escala esta arquitectura a varias materias y grupos?

**La arquitectura de datos sí; la de interfaz no.**

### Escala bien

- `/api/home` recorre las materias de las que se es miembro y compone en
  memoria, con `FEED_LIMIT` y `ATTENTION_LIMIT` aplicados al final. No hay
  consulta que crezca con el total de la plataforma.
- `sortEventsReservingAssignments` da cupo propio a las tareas, así que la
  actividad social no puede desplazarlas por volumen. Es la decisión correcta.
- La frontera de privacidad está en el servidor y no depende de cuántas materias
  haya.
- Los filtros de `/explore` viven en la URL y ya soportan materia y periodo.

### No escala

| Punto | A 1 materia | A 6 materias × 2 grupos |
|---|---|---|
| **La pila vertical de `/`** | ~990 px hasta el muro | «Necesita tu atención» con hasta 12 tarjetas ≈ 1900 px hasta el muro |
| **El muro sin filtro para el estudiante** | Irrelevante | Ilegible: seis materias mezcladas |
| **Los dos bloques del muro** | Se distinguen | Doce docentes distintos en «De tu docente» |
| **`/aula` con dos secciones** | 2 tarjetas | 12 tarjetas en rejilla de 2 columnas: 6 filas |
| **`/courses` sin relación con `/aula`** | Molesto | 12 galerías públicas sin marcar cuáles son tuyas |
| **El `<select>` de filtro docente** | Cómodo | 12 opciones en un desplegable |
| **`teacherTasksFor`** | 1 consulta por tarea | `listSubmissionsByAssignment` **por cada tarea publicada de cada materia**. Con 6 materias × 10 tareas son 60 consultas en la ruta más visitada. Es el único límite técnico real y conviene medirlo antes de crecer |

### Conclusión

Los cambios 1–5 de §3 no son estética: son exactamente los que convierten una
interfaz que funciona con una materia en una que funciona con doce. El filtro por
materia y el carril fijo dejan de ser mejoras y pasan a ser requisitos en cuanto
haya más de dos materias por persona.

Y una recomendación técnica fuera del alcance visual pero que conviene registrar:
**medir `teacherTasksFor` antes de escalar**. Es un bucle de consultas por tarea
en el endpoint del inicio.
