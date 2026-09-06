# Perfil del estudiante y contexto lateral

## 1. El hallazgo que resuelve la mitad de la pregunta

UINexus **ya recoge** casi todos los datos de la sidebar que se plantea como
hipótesis, y **no los enseña en ningún sitio**.

`src/components/dashboard/profile-editor.tsx` pide, con etiqueta y validación:

| Campo | Esquema | ¿Se muestra en algún sitio? |
|---|---|---|
| `displayName` | `profileSchema` | Sí (perfil público, navbar, tarjetas) |
| `bio` | `profileSchema`, 280 car. | Sí (perfil público) |
| `program` | `profileSchema` | Sí (perfil público, una línea gris) |
| `avatarUrl` | `/api/profile` | Sí |
| **`enrollmentNumber`** | `academicProfileSchema` | **No** |
| **`semester`** | `academicProfileSchema` | **No** |
| **`career`** | `academicProfileSchema` | **No** |
| **`department`** (docente) | `academicProfileSchema` | **No** |
| **`academicTitle`** (docente) | `academicProfileSchema` | **No** |

El tipo público (`src/lib/types.ts:81-86`) es:

```ts
handle · displayName · avatarUrl · bio · program · role
```

`studentProfile` y `teacherProfile` viajan en `GET /api/profile` (perfil propio)
y en el roster del aula, pero **no existen en el DTO público**. Es decir: se pide
al estudiante que rellene su carrera y su semestre, y luego esos datos no
aparecen ni en su perfil público ni en su inicio.

Corolario para la decisión de la sidebar: **no hay que inventar información. Hay
que dejar de tirarla.**

Y hay un segundo dato ya disponible que hoy se desperdicia: `HomePayload.courses`
—`{ id, name, role, code }` de cada materia— **ya llega al navegador en cada
carga del inicio**, y su único uso actual es rellenar un `<select>` que sólo ve
el profesorado. Un carril con las materias del estudiante cuesta **cero
peticiones adicionales**.

---

## 2. Auditoría del perfil público (`/[handle]`)

### Lo que hay hoy

```
[avatar 84]  Nombre                       (text-h1, Fraunces)
             @handle                      (mono, 14px)
             Bio                          (text-lead, si existe)
             Programa · N proyectos publicados · [Docente]
─────────────────────────────────────────────────────────
Rejilla de proyectos publicados (1 / 2 / 3 columnas)
```

### Evaluación

El comentario del archivo declara la intención: «perfil deliberadamente sobrio:
sin seguidores, sin likes, sin rankings». **Es correcto y hay que conservarlo.**
El problema no es que falten métricas sociales; es que falta contexto académico y
el perfil no cumple ninguno de los cuatro papeles que se le piden.

| Papel | ¿Lo cumple? | Por qué |
|---|---|---|
| **Portafolio académico** | Parcialmente | Enseña proyectos, pero no dice de qué carrera, qué semestre ni qué materias. Un portafolio sin contexto formativo no es un portafolio |
| **Comunidad de clase** | No | No se ve en qué materias está, ni hay camino desde el perfil a la clase ni de la clase al perfil |
| **Escaparate de proyectos** | Sí | Es lo único que hace bien. La rejilla reutiliza `ProjectGrid` y se ve igual que `/explore` |
| **Historial de aprendizaje** | No | No hay eje temporal. Los proyectos salen sin fecha y sin periodo |

### Qué añadir, y con qué justificación académica

Regla aplicada: **cada elemento tiene que servir para una decisión concreta de
alguien real** (una compañera, un docente, un empleador, la persona misma). Lo
que no pasa esa prueba, fuera.

| Elemento | ¿Incluir? | Justificación / motivo del rechazo |
|---|---|---|
| Nombre, avatar, handle | Sí (ya está) | Identidad |
| Bio | Sí (ya está) | Voz propia; 280 caracteres es el límite correcto |
| **Carrera + semestre** | **Sí** | Sitúa el trabajo en su nivel. «Un prototipo de 3.º» y «un prototipo de 8.º» no se juzgan igual. **Ya se recoge** |
| **Institución** | Sí | Deriva de `course.institution`, no hace falta pedirla |
| **Materias cursadas o impartidas** | **Sí, con matiz** | Es la unidad de organización del producto. Sólo las materias **públicas**; una matrícula completa es dato sensible (ver §5) |
| Proyectos publicados | Sí (ya está) | El escaparate |
| **Periodo de cada proyecto** | **Sí** | Convierte una rejilla en un historial. El dato ya existe (`project.term`) y ya se muestra en `ProjectCard` |
| Etiquetas / temas recurrentes | Sí, derivado | Agregar los `tags` de sus proyectos y mostrar los 3–5 más frecuentes. Coste cero, sale de datos existentes. Dice «esta persona hace accesibilidad» mejor que una lista declarativa |
| Skills declaradas por la persona | **No** | Autodeclaración sin verificación. En un contexto académico compite con la evidencia (los proyectos) y siempre gana la evidencia |
| Logros / insignias | **No** | Gamificación sin función pedagógica. Introduce ranking por la puerta de atrás, justo lo que el perfil rechaza por escrito |
| Estadísticas (vistas, likes) | **No** | Métrica de popularidad. Descartada por la misma razón |
| Actividad (línea temporal de eventos) | **No en el perfil público** | Es información de aula, no de escaparate. Publicar el rastro de actividad de un estudiante en una página indexable es un problema de privacidad, no una funcionalidad |
| Matrícula (`enrollmentNumber`) | **Nunca en público** | Identificador institucional. Sólo para el profesorado en el roster |
| «N proyectos publicados» | Sí (ya está) | Correcto: cuenta trabajo, no popularidad |
| Enlace de contacto / correo | **No** | El correo es institucional y el dominio se puede deducir. Publicarlo es cosecha de spam |

### Propuesta de cabecera de perfil

```
┌────────────────────────────────────────────────────────────┐
│ [avatar]  Ana Ramírez                        [Estudiante]  │
│   96px    @ana-ramirez                                     │
│                                                            │
│           Ingeniería en Sistemas · 6.º semestre            │
│           Instituto Tecnológico de Durango                 │
│                                                            │
│           Me interesa la accesibilidad en interfaces…      │
│                                                            │
│           Diseño Centrado en el Usuario · IHC              │
│           4 proyectos publicados · accesibilidad, móvil    │
└────────────────────────────────────────────────────────────┘
   Ago–Dic 2026 ─────────────────────────────────────────────
   [proyecto] [proyecto] [proyecto]
   Ene–Jun 2026 ─────────────────────────────────────────────
   [proyecto]
```

Dos cambios estructurales, ninguno decorativo:

1. **Contexto académico bajo el nombre**: carrera, semestre, institución,
   materias. Datos que ya existen.
2. **Agrupar los proyectos por periodo** en lugar de una rejilla plana. Convierte
   el escaparate en un historial de aprendizaje sin añadir ningún campo nuevo:
   `project.term` ya está.

---

## 3. ¿Tiene sentido una sidebar con información del estudiante?

**Sí, pero no la que se plantea en la hipótesis, y por una razón distinta de la
que se supone.**

La hipótesis propone la sidebar como *lugar donde poner los datos del
estudiante*. Ese motivo, por sí solo, no la justifica: un panel de identidad que
me dice quién soy es la información que menos necesito, porque ya lo sé. Un
carril que sólo lleva avatar, nombre, carrera y semestre es decoración con datos
dentro, y a la tercera sesión deja de mirarse.

Lo que sí justifica el carril es otra cosa: **descargar la columna central**.
Hoy «Necesita tu atención» ocupa ~600 px verticales de la misma columna en la que
vive el muro, y desaparece en cuanto se hace scroll. Moverlo a un carril fijo
consigue dos cosas a la vez:

- El muro empieza en el píxel 0 en lugar de en el 992.
- Lo urgente **deja de desaparecer**. Fijo es más prioritario que arriba.

La identidad viaja de acompañante, no como motivo. Es el peaje barato (unos 80 px
de carril) que da marco a lo demás.

### Qué debe contener el carril, en orden

```
┌──────────────────────────┐
│ [avatar 40] Ana Ramírez  │  ← identidad: 2 líneas, no más
│ Ing. Sistemas · 6.º sem  │
├──────────────────────────┤
│ NECESITA TU ATENCIÓN     │  ← lo único que caduca
│ ▸ Entrega hoy            │
│   Prototipo de alta fid. │
│ ▸ Requiere cambios       │
│   Mapa de empatía        │
│ ver las 5 →              │  ← máx. 3 + enlace
├──────────────────────────┤
│ TUS MATERIAS             │  ← el filtro mental del muro
│ ▸ Diseño Centrado…   ●2  │
│ ▸ Interacción H-C        │
│ + Unirme con código      │
└──────────────────────────┘
```

| Elemento | ¿Incluir? | Motivo |
|---|---|---|
| Avatar + nombre | Sí | Confirma con qué cuenta se está (real en aulas de laboratorio compartidas) |
| Carrera + semestre | Sí | Una línea. Da marco y usa un dato ya recogido |
| Institución | **No** | Hoy hay una sola. Ruido hasta que UINexus sea multiinstitución |
| **Necesita tu atención (máx. 3)** | **Sí — es la razón del carril** | Lo único con fecha límite |
| **Tus materias / grupos** | **Sí** | Filtro del muro + acceso al aula. Ya viaja en `HomePayload.courses` |
| Contador de no revisadas por materia | Sí | Ya se calcula en `/api/aula` |
| Proyectos propios | **No** | Ya está en `/dashboard` y en el menú de cuenta. Tercera copia |
| Estadísticas / progreso del semestre | **No** | El propio código lo rechazó: «no hay gráficas, ni KPIs, ni marcadores de progreso del semestre». Sigue siendo correcto |
| Accesos rápidos («Publicar») | **No** | Ya está en el navbar, en color de acento, visible también en móvil |
| Actividad reciente propia | **No** | Nadie decide nada mirando lo que hizo él mismo |
| Código de la materia | Sólo docentes | Ya se envía condicionado por rol en `/api/home` |

Regla de corte: **si el elemento no cambia lo que voy a hacer en los próximos
cinco minutos, no va en un carril fijo.** Estadísticas, logros y actividad propia
fallan esa prueba.

### Comportamiento

| Aspecto | Recomendación | Motivo |
|---|---|---|
| **Ancho** | 260–280 px | Cabe «Diseño Centrado en el Usuario» en dos líneas a 14 px sin partir palabras |
| **Sticky** | Sí, `position: sticky; top: 64px` | El navbar mide `h-16` (64 px) y es sticky. Sin `top` el carril se solapa |
| **Scroll propio** | `max-height: calc(100dvh - 64px); overflow-y: auto` | Con 6 materias el carril supera el viewport |
| **Desde** | ≥ 1024 px (`lg:`) | A 768–1023 px, 280 + 640 no cabe sin comprimir la lectura |
| **Tablet 768–1023** | Sin carril. «Atención» pasa a **tira horizontal** sobre el muro (2 tarjetas, scroll-x) y las materias a chips de filtro | Conserva la función sin robar ancho |
| **Móvil < 768** | Sin carril. Orden: chips de materia → tira de atención → muro. Identidad sólo en el menú de cuenta | El navbar ya lleva la identidad |
| **Colapsable** | No | Un carril de 280 px con 3 bloques no necesita colapsarse; añadiría un estado que recordar y un control que explicar |

### Qué cambia según el contexto

| Contexto | Carril |
|---|---|
| Estudiante en `/` | Identidad → Atención → Materias |
| Docente en `/` | Identidad → Requiere tu atención (revisar, moderar) → Grupos con contador |
| Ambos roles | Los dos bloques de atención, con el rol principal primero (`teacherFirst`, la lógica ya existe) |
| Sin materias | El carril se reduce a identidad + «Unirme con código». **No mostrar un carril vacío**: si sólo queda identidad, no hay carril |
| `/aula/[courseId]` | El carril podría llevar el contexto de la materia (código, docente, próxima entrega). Fuera del alcance de esta fase |

---

## 4. Alternativas consideradas y por qué se descartan

| Patrón | Veredicto |
|---|---|
| **Mini profile card sobre el muro** | Insuficiente. Resuelve la identidad (lo menos importante) y no descarga la columna: sigue empujando el muro hacia abajo |
| **Header contextual** (banda con nombre + materias bajo el navbar) | Interesante para tablet, pero no cabe «atención» en una banda sin volverse un carrusel. **Sí como fallback de 768–1023 px** |
| **Panel derecho en vez de izquierdo** | Peor para lo urgente: en lectura occidental el carril izquierdo se lee antes. Lo que caduca va a la izquierda; lo secundario, a la derecha si acaso |
| **Volver al dashboard** | Descartado en `home-vs-wall.md` |
| **Sidebar colapsable** | Estado extra sin ganancia: a 1024 px ya cabe, y por debajo no se muestra |
| **Navegación contextual** (menú lateral con las secciones) | Sobra: la navegación global tiene 3 entradas y ya está en el navbar. Un carril de navegación para 3 enlaces es desperdicio |

---

## 5. Nota de privacidad

Antes de exponer `career`, `semester` o la lista de materias en el perfil
**público** (indexable, sin sesión) hay que decidir explícitamente:

- `enrollmentNumber` **nunca** sale del roster docente.
- La lista de materias en público revela horario y ubicación aproximada de una
  persona. Recomendación: mostrarla **sólo con sesión iniciada**, o dejarla
  visible únicamente para miembros de esas mismas materias.
- `career` y `semester` son razonables en público para un portafolio académico,
  pero deberían ser **opcionales y visibles por decisión del titular**, no por
  defecto. El editor de perfil ya los pide como `nullish`; falta el interruptor.

Esto no es una objeción al carril —el carril es privado por definición, sólo lo
ve su dueño— sino al perfil público de §2.
