# ¿Qué debería ser el inicio de Nextudio?

## Punto de partida: la pregunta está mal formulada, y por una buena razón

La decisión «muro o dashboard» **ya se tomó, y a favor del muro**. `src/app/page.tsx`
→ `HomeGate` → `AcademicHome`. Un usuario con sesión que escribe `uinex.vercel.app`
aterriza en su inicio académico, no en el escaparate público.

De modo que la pregunta útil no es *si* el muro debería ser el inicio, sino:

> El inicio autenticado ya existe. ¿Está haciendo el trabajo de un inicio?

La respuesta medida es **no**: la primera publicación del muro cae a 992 px del
borde superior en un estudiante y a 1088 px en un docente. A 1440×900 eso es 1,2
y 1,3 pantallas. El inicio autenticado, en la práctica, es una lista de tareas
con un muro adjunto al final.

Y hay un segundo desmentido, más literal: **después de iniciar sesión no vas al
inicio.** En `src/components/auth/login-form.tsx`:

```ts
const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
  ? requestedNext
  : '/dashboard';
```

El enlace «Iniciar sesión» del navbar no lleva `?next`, así que el destino por
defecto tras autenticarse es `/dashboard` («Tus proyectos»). El producto decidió
que el muro es el inicio y el flujo de entrada nunca se enteró.

---

## Las alternativas, evaluadas

Cinco dimensiones para cada opción: frecuencia de uso, carga cognitiva, clics
hasta la tarea real, *discoverability* y escalabilidad a varias materias.

### Opción A — La portada/escaparate como inicio

Volver al estado anterior: `/` es siempre `Landing` (destacados, explorar,
galerías por curso) y el trabajo vive en `/aula`.

**Ventajas**
- Una sola portada que servir, cacheable, indexable, cero JavaScript de sesión.
- Elimina `HomeGate`, `SessionScript` y el CSS de reparto: menos superficie.
- El escaparate es lo que mejor vende el producto a quien llega de fuera.

**Problemas**
- Un estudiante entra a Nextudio para entregar algo o para ver qué publicó su
  docente. Ninguna de las dos cosas está en el escaparate. Coste: **1 clic extra
  en cada sesión, para siempre.**
- El escaparate no cambia entre semanas; el muro sí. Poner lo estático donde se
  entra a diario es invertir la frecuencia de uso.
- El comentario de `page.tsx` documenta exactamente por qué se abandonó: «hasta
  hoy un estudiante autenticado aterrizaba en el escaparate y tenía que buscar la
  puerta de su aula; eso es una pantalla de más».

| Frecuencia | Carga | Clics | Discovery | Escala |
|---|---|---|---|---|
| Baja | Baja | +1 siempre | Alta (público) | Buena |

**Descartada.** Fue un retroceso ya identificado y ya corregido.

### Opción B — El muro como inicio (estado actual)

**Ventajas**
- Correcta por frecuencia: lo que cambia a diario está donde se entra a diario.
- Cero clics hasta lo que se vino a hacer.
- El escaparate sigue existiendo, servido desde el mismo `/` para quien no tiene
  sesión: no se pierde SEO.

**Problemas**
- Ya medidos: el muro empieza a 1,2 pantallas de scroll.
- Un carril de una sola columna a 768 px desperdicia el 47–60 % del ancho.
- Sin la información de contexto —qué materias, qué progreso, quién soy— el
  muro es una lista sin marco.
- No conduce a `/explore`: quien tiene sesión pierde el acceso al trabajo
  publicado fuera de sus materias.

| Frecuencia | Carga | Clics | Discovery | Escala |
|---|---|---|---|---|
| Alta | Media-alta (pila larga) | 0 | Baja dentro de sesión | Mala: con 5 materias la pila crece sin límite |

**Correcta en la ruta, incompleta en la pantalla.**

### Opción C — Dashboard híbrido

Resumen del usuario + actividad + muro + proyectos + materias + pendientes, todo
en `/`.

**Ventajas**
- Cubre todas las preguntas de golpe.

**Problemas**
- Es literalmente lo que hay hoy, más cosas. La pila vertical actual **ya es**
  un dashboard híbrido: saludo, resumen desde la última visita, pendientes,
  tareas docentes, moderación, compositor, filtro, dos feeds. Añadirle proyectos
  y materias agrava el problema que se quiere resolver.
- El código lo rechaza dos veces, con argumento: «no hay gráficas, ni KPIs, ni
  marcadores de progreso del semestre… lo que no ayuda a decidir qué hacer ahora
  no está» (`academic-home.tsx`) y «nada de gráficas ni de "actividad reciente",
  que es información que nadie usa para decidir nada» (`aula-home.tsx`). El
  argumento es bueno y sigue siendo válido.

| Frecuencia | Carga | Clics | Discovery | Escala |
|---|---|---|---|---|
| Alta | **Alta** | 0 | Media | Muy mala |

**Descartada.** Un dashboard resuelve la ansiedad del diseñador, no una tarea
del estudiante. Y la versión actual demuestra el fallo: cuantos más bloques se
apilan, más abajo cae el contenido que cambia.

### Opción D (recomendada) — El muro como inicio, con el contexto en carriles

Mantener `/` como muro autenticado y **cambiar el eje en el que se paga la
prioridad**: de vertical (altura, que se acaba y se pierde al hacer scroll) a
horizontal (posición fija, que no se acaba y no desaparece).

```
┌───────────────────┬──────────────────────────────┬────────────────────┐
│ Carril izquierdo  │  Muro                        │ Carril derecho     │
│ (fijo, 280px)     │  (600–640px)                 │ (fijo, 300px)      │
│                   │                              │  ≥1440px           │
│ · Identidad       │  [filtro: todas · DCU · IHC] │                    │
│   avatar, nombre, │                              │ · Del resto de     │
│   carrera, sem.   │  ── nuevo desde tu visita ── │   Nextudio          │
│                   │  ▸ publicación compacta      │   3 proyectos      │
│ · Necesita tu     │  ▸ publicación compacta      │   públicos         │
│   atención (2–3)  │  ▸ publicación compacta      │   recientes        │
│   [ver todas →]   │  ▸ publicación compacta      │                    │
│                   │  ▸ publicación compacta      │ · Tu materia       │
│ · Tus materias    │  ▸ publicación compacta      │   activa: gente,   │
│   DCU · IHC ·…    │                              │   código, próxima  │
│                   │  [ cargar más ]              │   entrega          │
└───────────────────┴──────────────────────────────┴────────────────────┘
```

**Por qué esto y no un dashboard**

Un dashboard *añade* información. Esto **no añade nada**: mueve lo que ya está en
la pila vertical a una posición donde no compite con el muro por la misma altura.
El inventario no crece; el eje cambia.

Comprobación de que cada elemento del carril se gana su sitio:

| Elemento | ¿Se muestra hoy? | ¿Por qué en el carril? |
|---|---|---|
| Necesita tu atención | Sí, en la columna | Es lo único que caduca. Fijo = nunca desaparece al hacer scroll. **Mejora su prioridad, no la reduce** |
| Tus materias | No (sólo en `/aula`) | Con >1 materia es el filtro mental. Ya viaja en `HomePayload.courses` |
| Identidad + carrera + semestre | No, en ningún sitio | Ya se recoge en `/dashboard/profile` y hoy se descarta. Da marco al muro |
| Del resto de Nextudio | No | Cierra el agujero de discoverability: hoy con sesión no hay camino al trabajo público |

**Ventajas**
- El muro empieza en el píxel 0. De 1,3 a **6,0** publicaciones visibles a
  1440×900 (contando el compactado de la tarjeta).
- Las entregas dejan de perderse de vista: fijas es *más* prioritario que arriba.
- Se usa el ancho que hoy se tira, sin estirar la línea de texto: la columna
  central se mantiene entre 600 y 640 px, dentro del rango legible.
- Escala: con 5 materias el carril crece de 5 filas; la pila vertical crecería de
  5 bloques de 600 px.
- Recupera el acceso a `/explore` desde dentro de la sesión.

**Problemas y cómo se cubren**
- Tres columnas en móvil serían un desastre. No se hacen tres columnas en móvil:
  ver `responsive.md` para la transformación completa por breakpoint.
- El carril derecho puede volverse relleno decorativo. Por eso **sólo aparece a
  partir de 1440 px** y sólo con contenido que hoy no tiene ningún hueco.
- Más superficie que mantener. Cierto: es el coste real. Se compensa porque el
  carril izquierdo reutiliza componentes que ya existen (`AttentionCard`,
  `UserAvatar`, las tarjetas de materia de `aula-home.tsx`).

| Frecuencia | Carga | Clics | Discovery | Escala |
|---|---|---|---|---|
| Alta | **Baja** (nada apilado) | 0 | Alta | Buena |

### Opción E — Muro con pestañas o vistas conmutables

`[ Muro | Pendientes | Materias ]` como pestañas en `/`.

**Descartada.** Convierte información que debe verse a la vez en información que
hay que ir a buscar, y añade una decisión antes de cada uso. Además el proyecto
ya arrastra un problema con pestañas: las de `/aula/[courseId]` no escriben en la
URL (ver `ux-problems.md` · UX-05).

---

## Comparación por perfil

| | Estudiante nuevo | Estudiante recurrente | Docente |
|---|---|---|---|
| **A** Escaparate | Bonito pero desorientador: no ve su materia | 1 clic de más cada día | Muy malo: su trabajo está a 2 clics |
| **B** Actual | Ve tareas primero (bien) pero no entiende que hay un muro debajo | Scrollea 1,2 pantallas cada sesión | Peor: 1,3 pantallas, y la cola de moderación mezclada con el muro |
| **C** Híbrido | Sobrecarga inmediata | Más scroll que hoy | Panel de control sin decisiones que tomar |
| **D** Carriles | Ve quién es, qué le toca y qué pasa, en una pantalla | 0 scroll para lo urgente, muro completo a la vista | Moderación en el carril; muro filtrable por grupo |

---

## Recomendación

**El muro debe seguir siendo el inicio autenticado —lo es ya— y hay que
completarlo con la Opción D: carriles de contexto laterales y una tarjeta
compacta.**

Sin ambigüedad, y en este orden:

1. `/` sigue siendo el reparto entre escaparate público y muro autenticado. **No
   cambiar la ruta.** La decisión de arquitectura es correcta y está bien
   argumentada en el código.
2. **Corregir el destino post-login**: cambiar el `next` por defecto de
   `/dashboard` a `/`. Es un cambio de una línea que hoy contradice toda la
   arquitectura de inicio. Es el arreglo con mejor relación efecto/esfuerzo de
   toda esta auditoría.
3. Sacar «Necesita tu atención», «Requiere tu atención» y la moderación de la
   columna central al carril izquierdo fijo.
4. Compactar la tarjeta del muro (la portada es el 62 %).
5. Añadir el carril derecho **sólo a partir de 1440 px** y sólo si tiene
   contenido con función: acceso a `/explore` y contexto de la materia activa. Si
   al implementarlo no se encuentra contenido que se gane el sitio, **no ponerlo**.
   Dos columnas es un resultado perfectamente válido.

Lo que **no** hay que hacer:

- No convertir `/` en un dashboard con métricas. El producto ya rechazó esa idea
  dos veces con buenos argumentos.
- No añadir «me gusta», comentarios ni contadores para «dar vida» al muro. Un
  aula con 30 personas y una publicación al día no necesita señales de
  popularidad: necesita que la publicación se vea.
- No mover el muro a una ruta propia (`/muro`) dejando `/` como dashboard. Eso
  es la opción C disfrazada y añade un clic diario.
