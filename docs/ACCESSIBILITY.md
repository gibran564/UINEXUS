# Evaluación de accesibilidad — UINexus

**Objetivo:** WCAG 2.2 nivel AA.
**Método:** axe-core 4.10 sobre cada plantilla de página, en claro y oscuro, a
1280 / 1024 / 768 / 390 px; más revisión manual de teclado, foco, zoom al 200 %
y estructura semántica.

> Una plataforma para una materia de diseño centrado en el usuario no puede
> tener mala accesibilidad. Sería demasiado meta.

## 1. Resultado automatizado

| Página | Infracciones |
|---|---|
| `/` | 0 |
| `/explore` (con y sin filtros) | 0 |
| `/courses` · `/courses/[slug]` | 0 |
| `/@usuario` | 0 |
| `/@usuario/proyecto` | 0 |
| `/publish` · `/publish/new` (los 5 pasos) | 0 |
| `/login` | 0 |
| `/dashboard` · `/dashboard/[id]/edit` | 0 |
| `/about` | 0 |

Reglas ejecutadas: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` y
`best-practice`.

### Lo que se encontró y se corrigió

| Criterio | Problema | Corrección |
|---|---|---|
| 1.4.3 Contraste | `--fg-subtle` daba 4.4:1 sobre `--surface` | Token oscurecido a `#6b6d75` → 5.2:1 |
| 1.3.1 Información y relaciones | En `/explore` los `h3` de las tarjetas colgaban del `h1` | `h2` "Resultados" para lector de pantalla, y `h2` en el panel de filtros |
| 1.3.1 / landmarks | El aviso de modo demo quedaba fuera de todo landmark | Pasa a `<aside aria-label="Estado de la plataforma">` |
| 2.5.8 Tamaño del objetivo | Enlaces del pie de 17 px de alto en móvil | `min-height: 36px` |

## 2. Comprobación manual, criterio a criterio

### Perceptible

- **1.1.1 Contenido no textual.** Todo SVG decorativo lleva `aria-hidden="true"`
  y `focusable="false"`. El código QR tiene alt descriptivo con la URL. Las
  portadas generadas son `role="presentation"`: la información ya está en el
  título de la tarjeta. Los avatares sin nombre visible al lado usan
  `role="img"` con `aria-label`; los que van junto al nombre llevan `alt=""`
  para no duplicar el anuncio.
- **1.3.1 Información y relaciones.** Un `h1` por página, sin saltos de nivel.
  Landmarks: `header` / `nav` / `main` / `aside` / `footer`, cada `nav` con su
  `aria-label`. El panel del estudiante es una `<table>` real con `caption`,
  `th[scope=col]` y `th[scope=row]`. Los grupos de radio son `fieldset` +
  `legend`. Cada campo tiene `<label for>`; los mensajes de error se enlazan con
  `aria-describedby` + `aria-invalid`.
- **1.4.1 Uso del color.** El estado de un proyecto es punto **más** texto. Los
  filtros activos llevan una marca de verificación además del color. Los errores
  llevan icono, texto y `role="alert"`.
- **1.4.3 / 1.4.11 Contraste.** Verificado en ambos temas: texto principal
  ≥ 12:1, secundario ≥ 7:1, metadatos ≥ 5.2:1, acento ≥ 5.6:1, filetes de
  controles ≥ 3:1.
- **1.4.4 / 1.4.10 Zoom y reflujo.** Correcto a 200 % y a 320 px de ancho. Sin
  desplazamiento horizontal accidental en ninguna página (verificado comparando
  `scrollWidth` con `clientWidth`). Toda la tipografía usa `rem` o `clamp()`.
- **1.4.12 Espaciado del texto.** Interlineado 1.65 en cuerpo, sin alturas fijas
  en contenedores de texto.

### Operable

- **2.1.1 / 2.1.2 Teclado.** Todo alcanzable y operable con teclado, sin
  trampas. Menús y diálogos se cierran con `Escape` y devuelven el foco al
  disparador. Los desplegables se cierran también al hacer clic fuera.
- **2.4.1 Saltar bloques.** Enlace "Saltar al contenido" como primer elemento
  enfocable, visible al recibir foco; `main` tiene `tabIndex={-1}` para poder
  recibirlo.
- **2.4.3 Orden del foco.** Sigue el orden visual. En el flujo de publicación,
  al cambiar de paso el foco se mueve al encabezado del paso nuevo — sin eso,
  quien usa teclado o lector de pantalla se queda al principio de la página sin
  saber que algo cambió.
- **2.4.4 Propósito del enlace.** Sin "clic aquí". Los enlaces que abren pestaña
  nueva lo anuncian con texto para lector de pantalla.
- **2.4.7 Foco visible.** `:focus-visible` con contorno de 2 px del color de
  acento y 2 px de separación, nunca eliminado, comprobado sobre las cuatro
  superficies.
- **2.5.8 Tamaño del objetivo.** Botones 44 px, chips y controles secundarios
  36 px, enlaces del pie 36 px. Los enlaces dentro de una frase se acogen a la
  excepción de texto en línea.
- **2.3.3 / movimiento.** `prefers-reduced-motion: reduce` anula transiciones,
  animaciones y el desplazamiento suave.

### Comprensible

- **3.1.1 Idioma.** `<html lang="es">`.
- **3.2.2 Al recibir entrada.** Ningún cambio de contexto automático. La
  búsqueda es un formulario GET explícito, no un filtrado en vivo.
- **3.3.1 / 3.3.3 Errores.** Cada mensaje dice qué pasó y cómo arreglarlo, en
  lenguaje llano. Los códigos de Firebase Auth se traducen uno a uno
  (`auth/invalid-credential` → "El correo o la contraseña no coinciden"). Nunca
  se muestra un código crudo.
- **3.3.2 Etiquetas e instrucciones.** Se marca lo **opcional**, no lo
  obligatorio. Las ayudas están junto al campo, no en un tooltip.
- **3.3.4 Prevención de errores.** Borrar un proyecto exige escribir su slug y
  explica que el enlace dejará de funcionar para siempre. Reemplazar archivos
  avisa antes con el número de archivos y la versión resultante.

### Robusto

- **4.1.2 Nombre, función, valor.** `aria-expanded` / `aria-haspopup` /
  `aria-controls` en los desplegables; `aria-current` en navegación y filtros;
  `aria-pressed` en el selector de dispositivo; `role="progressbar"` con
  `aria-valuenow` en la subida.
- **4.1.3 Mensajes de estado.** `role="status"` con `aria-live="polite"` para
  copiar el enlace, guardar cambios, el progreso de subida y el número de
  resultados. Sin esto, copiar un enlace sería una acción silenciosa para quien
  no ve la pantalla.

## 3. Sin JavaScript

Explorar, buscar, filtrar, ordenar, paginar, ver fichas, perfiles y cursos
funcionan sin JavaScript: los filtros son enlaces y la búsqueda es un formulario
GET. Publicar y administrar sí lo requieren — leen y escriben archivos.

## 4. Pendiente

- **Prueba con lector de pantalla real** (NVDA, VoiceOver, TalkBack). Lo
  automatizado detecta ausencias, no torpezas: sólo escuchando la página se sabe
  si el recorrido es cómodo.
- **Prueba con personas.** Cinco estudiantes publicando su primer proyecto
  encontrarían más de lo que ha encontrado esta auditoría entera.
- **El contenido de los alumnos no se audita.** UINexus garantiza la
  accesibilidad de la plataforma, no la de los proyectos alojados. Una mejora
  futura interesante —y muy apropiada para la materia— sería ejecutar axe sobre
  cada proyecto publicado y devolver el informe a su autor.
