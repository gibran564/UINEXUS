# Auditoría de UX — UINexus

Dos auditorías: una **antes** de escribir interfaz (Etapa 1) y otra **sobre el
resultado construido** (Etapa 8). Método: heurísticas de Nielsen, las tres
leyes de Krug y el Trunk Test, con la escala de severidad 0–4.

---

## Parte 1 · Auditoría conceptual (antes de construir)

### 1.1 Quiénes son y a qué vienen

| Persona | Viene a | Éxito se ve como | Fracaso se ve como |
|---|---|---|---|
| **Visitante** (compañero, familiar, otro profesor) | Ver un trabajo concreto que le compartieron por WhatsApp | El proyecto se abre en menos de 3 s, sin registro | Un muro de inicio de sesión, o un enlace roto |
| **Alumna que no programa** | Convertir su `index.html` en un enlace | Publica en < 5 min sin ayuda | Se pierde en un formulario de 20 campos, o no entiende "static build" |
| **Alumno avanzado** | Exhibir una app Vite compilada como portafolio | Su build sube entero y funciona | Le piden Git, npm o una CLI |
| **Profesora sin conocimientos técnicos** | Decir en clase "suban aquí su página" | Una URL de curso que enseña las 48 entregas | Tener que explicar la plataforma antes que la materia |

### 1.2 Los dos recorridos que deben ser excelentes

```
PUBLICAR
cuenta → tipo → archivos → información → vista previa → visibilidad → URL

EXPLORAR
llego → galería → proyecto → abrir la experiencia
```

Todo lo demás (cursos, perfiles, moderación, versiones) es secundario: si
estos dos fallan, la plataforma no sirve; si funcionan, ya es útil.

### 1.3 Riesgos detectados antes de escribir una línea

| # | Riesgo | Severidad prevista | Decisión de diseño tomada |
|---|---|---|---|
| R1 | El alumno no sabe qué opción elegir entre "HTML / sitio / build" | 3 · Mayor | Las tres opciones se describen por **lo que la persona tiene** ("un archivo index.html"), no por tecnología. Más un bloque "¿No estás seguro?" que resuelve el caso mayoritario |
| R2 | Publicar se convierte en un formulario interminable | 3 · Mayor | Cinco pasos, un objetivo por paso; sólo **título y descripción** son obligatorios. La ficha académica va plegada y es opcional |
| R3 | El visitante topa con un muro de login | 4 · Catastrófico | Explorar, buscar, filtrar, ver perfiles y abrir proyectos son públicos. El login sólo aparece al intentar publicar |
| R4 | La galería se vuelve una cuadrícula de tarjetas sin jerarquía | 2 · Menor | Destacado en grande, resto en rejilla; máximo 4 metadatos por tarjeta; la portada ocupa ~70 % |
| R5 | Quince filtros de golpe convierten la galería en una aduana | 2 · Menor | Cinco categorías visibles; curso, periodo, tipo y orden dentro de `<details>` |
| R6 | Los filtros dependen de JavaScript y se pierden al compartir | 2 · Menor | Cada filtro es un **enlace**; el estado vive en la URL. Funciona sin JS, el botón Atrás funciona, la búsqueda es compartible |
| R7 | La persona publica y no sabe si salió bien | 3 · Mayor | Pantalla de éxito explícita, con el enlace copiable, la explicación de quién lo ve y el aviso de que se puede editar sin perder la URL |
| R8 | Se rompe un enlace ya entregado al profesor | 4 · Catastrófico | El slug es **inmutable** (también en las reglas de Firestore). Reemplazar archivos crea `v{n+1}` y conserva la URL. Borrar exige escribir el slug |
| R9 | "Sólo con enlace" se entiende como "privado" | 3 · Mayor | Cada opción de visibilidad lleva su consecuencia escrita al lado, no en un tooltip |
| R10 | La vista previa del borrador ejecuta código no confiable en el dominio de la plataforma | 4 · Catastrófico | El borrador se ve con `sandbox=""` y sin scripts; se avisa. Lo publicado corre en otro origen |

### 1.4 Arquitectura de información resultante

Profundidad máxima: **3 niveles**. Ninguna ruta necesita explicación.

```
/                        galería + entrada
├── explore              búsqueda y filtros  (estado en la URL)
├── courses              galerías por materia
│   └── [slug]           la exposición oficial de un grupo
├── about                qué es, cómo protege, qué publica
├── login
├── publish              elegir qué publicar
│   └── new              el flujo de 5 pasos
├── dashboard            tus proyectos
│   ├── profile
│   └── [id]/edit        información + reemplazo de archivos
└── @usuario             perfil público
    └── proyecto         ficha académica
        └── preview      visor con simulación de dispositivos
```

Separación deliberada entre **explorar** (`/`, `/explore`, `/courses`),
**publicar** (`/publish`) y **administrar** (`/dashboard`). La navegación
principal sólo ofrece explorar; publicar es un botón primario; administrar
vive detrás del avatar.

---

## Parte 2 · Auditoría del resultado construido

Ejecutada sobre la aplicación corriendo, en claro y oscuro, a 1280 / 1024 /
768 / 390 px, con axe-core 4.10 y revisión manual de teclado.

### 2.1 Trunk Test

Se abrió cada plantilla de página en frío y se comprobaron las seis preguntas
de orientación.

| Página | ¿Qué sitio? | ¿Qué página? | ¿Secciones? | ¿Opciones? | ¿Dónde estoy? | ¿Búsqueda? |
|---|---|---|---|---|---|---|
| `/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/explore` | ✅ | ✅ | ✅ | ✅ | ✅ `aria-current` | ✅ |
| `/@u/proyecto` | ✅ | ✅ | ✅ | ✅ | ✅ "← Explorar" | ✅ navbar |
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ pestañas | ✅ navbar |
| `/publish/new` | ✅ | ✅ | ✅ | ✅ | ✅ paso actual | n/a |

Pasa. El único punto flojo: desde `/dashboard/[id]/edit` la ruta de vuelta es
un solo enlace ("← Tus proyectos"), sin miga de pan completa. Severidad 1;
aceptado, porque la jerarquía tiene dos niveles.

### 2.2 Hallazgos y correcciones aplicadas

| # | Hallazgo | Sev. | Estado |
|---|---|---|---|
| H1 | El texto `--fg-subtle` daba 4.4:1 sobre `--surface`: reprueba 1.4.3 | 3 | **Corregido** — token oscurecido a `#6b6d75` (5.2:1) |
| H2 | El aviso de modo demo quedaba fuera de todo landmark | 2 | **Corregido** — pasa a `<aside aria-label>` |
| H3 | En `/explore` los títulos de tarjeta (`h3`) colgaban del `h1`: salto de nivel | 2 | **Corregido** — `h2` "Resultados" para lector de pantalla, y `h2` en los filtros desplegables |
| H4 | El botón "Publicar" desaparecía en móvil para quien ya tenía sesión, y tampoco estaba en el menú: la acción principal quedaba inalcanzable | 3 | **Corregido** — visible siempre + entrada en el menú móvil |
| H5 | "hace 1 meses" | 1 | **Corregido** |
| H6 | Los enlaces del pie medían 17 px de alto en móvil | 2 | **Corregido** — `min-height: 36px` |
| H7 | **El mismo chip de filtro existía en cuatro copias** con estados de hover distintos (inicio acentuaba, galería y curso no). El mismo gesto se veía diferente según la página | 2 | **Corregido** — una sola clase `.chip`, con el estado activo pintado desde `aria-current`/`aria-pressed`, de modo que no puede verse activo sin estarlo para un lector de pantalla |
| H8 | **La escala tipográfica declaraba siete pasos y el código usaba 18 valores sueltos** (`text-[1.0625rem]`, `text-[0.75rem]`…). Además `--text-meta` (13 px) y la clase `.meta` (11 px) compartían nombre con tamaños distintos | 2 | **Corregido** — la escala nombra `lead` y `label`, se eliminaron todos los valores arbitrarios, y el suelo tipográfico sube de 11 px a 12 px |

### 2.3 Lo que se revisó y no dio hallazgo

- **Diagnóstico rápido de Krug** (10 filas): todas pasan.
- **Estados**: cada superficie tiene carga, vacío, error, éxito, deshabilitado,
  hover, foco y activo. Los vacíos dicen qué pasó y cuál es el paso siguiente.
- **Errores**: ningún mensaje muestra un código crudo. Los de Firebase Auth se
  traducen uno a uno a una frase accionable.
- **Deshacer**: no hay diálogo "¿estás seguro?" salvo en borrar, donde además
  se exige escribir el slug. Cambiar visibilidad es reversible de un clic.
- **Sin dependencia del hover**: ninguna información vive sólo en hover.
- **Patrones oscuros**: ninguno. Despublicar cuesta lo mismo que publicar.

### 2.4 Puntuación

**Heurísticas (Krug + Nielsen): 9 / 10.**
Sin problemas de severidad 3 o superior tras las correcciones. Resta el punto
por la búsqueda: se resuelve en memoria sobre los 500 proyectos más recientes,
así que con miles de proyectos dejaría de encontrar los antiguos —
[limitación conocida](LIMITATIONS.md), no un defecto de interfaz.

**Refactoring UI (8 comprobaciones): 10 / 10.**
Jerarquía legible desenfocada y en escala de grises, espaciado en escala
4/8/16/24/32/48/64, anchos de texto limitados a 65–68ch, contraste verificado,
sombras reservadas a lo que flota.

**Tipografía (10 comprobaciones): 10 / 10.**
Cuerpo 16 px, medida < 75ch, interlineado 1.65, dos familias, ~125 KB de
fuentes, `font-display: swap`, respaldo de sistema, correcto a 200 % de zoom.
