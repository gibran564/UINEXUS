# Accesibilidad

Auditoría razonable, no certificación WCAG formal. Todos los contrastes están
**calculados** sobre los valores hexadecimales de `src/app/globals.css` con la
fórmula de luminancia relativa de WCAG 2.x, no estimados a ojo.

## Resumen

Nextudio tiene una base de accesibilidad **muy por encima de la media** de un
proyecto académico: foco visible que nunca se elimina, `:focus-visible` global,
enlace de salto, `prefers-reduced-motion`, `prefers-contrast: more`, campos de
16 px en móvil para evitar el zoom de iOS, objetivos táctiles de 44 px por
defecto en `.btn` y `.field`, estados que nunca se comunican sólo con color
(el punto siempre va con su palabra), `<dialog>` nativo con retorno de foco, y
gestión explícita del foco en el asistente de publicación (`headingRef` con
`tabIndex={-1}`).

Los problemas encontrados son tres, y dos de ellos son **sistémicos**.

---

## A-01 · P1 · Los bordes no llegan a 3:1 (WCAG 1.4.11)

El lenguaje visual de Nextudio sustituye deliberadamente las sombras por filetes
de 1 px: «filetes de 1px en vez de sombras» (`globals.css`). Esa decisión hace
que **el borde sea el único límite visible de cada componente**, y por tanto
sujeto al criterio 1.4.11 Non-text Contrast (3:1) allí donde identifica un
control.

Contrastes medidos:

| Token | Sobre | Tema claro | Tema oscuro | Requisito |
|---|---|---|---|---|
| `--border` | `--bg` | **1,25:1** | **1,37:1** | 3:1 |
| `--border-strong` | `--bg` | **1,67:1** | **1,92:1** | 3:1 |
| `--border-strong` | `--surface` | **1,81:1** | **1,79:1** | 3:1 |

`--border-strong` es el borde de `.field` (todos los inputs, textareas y
selects), `.btn-secondary`, `.chip` y `.tag`. Un campo de formulario cuyo único
indicador visual es su borde necesita 3:1; hoy está en 1,8:1, es decir a menos de
dos tercios del mínimo.

`prefers-contrast: more` sube `--border` a `#9a927f` (**2,74:1**) y
`--border-strong` a `#6d6555` (5,10:1). Es decir: **ni siquiera el modo de alto
contraste alcanza 3:1 en `--border`.**

- **Impacto**: con visión reducida o en una pantalla mal calibrada, los campos y
  los botones secundarios no tienen borde perceptible. Y como el sistema no usa
  sombras ni fondos de relleno en esos controles, no queda ninguna otra señal.
- **Componente**: `src/app/globals.css`, bloque `:root` y `[data-theme='dark']`.
- **Solución**: separar el filete decorativo del filete funcional.
  - `--border` (separadores, bordes de panel) puede quedarse tenue: no identifica
    un control.
  - Introducir un token nuevo —`--border-control`— con ≥3:1 sobre `--surface`
    para `.field`, `.btn-secondary`, `.chip` y `.tag`. En claro, en torno a
    `#8a8272`; en oscuro, en torno a `#6a6f7d`. Verificar con la calculadora de
    este informe.
  - Subir `--border` en `prefers-contrast: more` hasta al menos 3:1.
- **Dificultad**: baja (cambio de tokens), pero **exige revisión visual**: es el
  cambio que más altera el aspecto de todo el producto.

> **Corrección de la documentación**: `docs/ACCESSIBILITY.md:56-58` afirma
> «1.4.3 / 1.4.11 Contraste. Verificado en ambos temas: … controles ≥ 3:1». La
> medición no lo sostiene. Ese documento debe corregirse.

## A-02 · P2 · `--fg-subtle` sobre `--sunken` queda en 4,28:1

| Combinación | Tema claro | Requisito |
|---|---|---|
| `--fg-subtle` sobre `--bg` | 4,57:1 | 4,5:1 ✓ (por poco) |
| `--fg-subtle` sobre `--surface` | 4,94:1 | ✓ |
| **`--fg-subtle` sobre `--surface-sunken`** | **4,28:1** | ✗ |

`--surface-sunken` se usa en zonas de arrastre, bloques de código, la línea
«Desde tu última visita», los estados vacíos de atención y el `hover` de
`.btn-ghost`. En tema oscuro, `--fg-subtle` sobre `--surface-raised` queda en
4,56:1: pasa, pero sin margen.

- **Solución**: oscurecer `--fg-subtle` en claro (hasta ~`#63656d`, que da 5,0:1
  sobre `sunken`) o prohibir por convención `text-subtle` sobre `bg-sunken`.
- **Dificultad**: trivial.

## A-03 · P1 · Patrón ARIA de pestañas incompleto (seis instancias)

`grep` sobre `src/**`:

| Elemento | Instancias |
|---|---|
| `role="tablist"` | **6** |
| `role="tab"` | 6 grupos |
| `role="tabpanel"` | **0** |
| `aria-controls` en una pestaña | **0** |
| Navegación con flechas (`onKeyDown`) | **0** |

Archivos: `aula/course-workspace.tsx:87`, `aula/assignment-detail.tsx:485`,
`aula/deliverable-fields.tsx:286`, `aula/resources-panel.tsx:73`,
`aula/workflow-progress.tsx:82`, `dashboard/dashboard-client.tsx:98`.

`aria-selected` sí se aplica correctamente, así que el estado se anuncia bien.
Lo que falta es el resto del contrato: sin `aria-controls` no hay forma anunciada
de saltar al panel, y sin manejo de flechas la interacción prometida por el rol
no existe. El contenido sigue siendo alcanzable con Tab, así que **degrada la
experiencia sin bloquearla**.

- **Solución recomendada**: no completar el patrón, sino **sustituirlo**. Estas
  seis «pestañas» son en realidad secciones de una página. Convertirlas en
  enlaces con `aria-current="page"` que escriban `?tab=` en la URL:
  - elimina el requisito de flechas y de `tabpanel`,
  - arregla de paso UX-05 (las pestañas no son enlazables),
  - reutiliza el patrón de `.chip` que `/explore` ya aplica bien.
- **Dificultad**: media.

---

## Lo que está bien y no hay que romper

| Aspecto | Evidencia |
|---|---|
| **Foco visible siempre** | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` en `@layer base`, sin ninguna regla que lo elimine en todo el proyecto |
| **Enlace de salto** | `.skip-link` en `layout.tsx`, con `<main id="contenido" tabIndex={-1}>` como destino |
| **Objetivos táctiles** | `.btn` 44 px, `.field` 44 px, `.chip` 36 px, `.btn-sm` 36 px, enlaces del pie con `min-h-9` explícito y comentario que lo justifica |
| **Zoom de iOS** | `@media (max-width: 640px) { input, textarea, select { font-size: 16px } }` |
| **Movimiento reducido** | `prefers-reduced-motion` anula animaciones y `scroll-behavior` |
| **Alto contraste** | `prefers-contrast: more` refuerza filetes y textos (insuficiente en `--border`, ver A-01) |
| **Estado nunca sólo por color** | `SubmissionBadge` y `StatusBadge` acompañan el punto con la palabra. Comentario explícito citando 1.4.1 |
| **Estado seleccionado desde ARIA** | `.chip[aria-current='true']` / `[aria-pressed='true']` pinta desde el atributo, así que es imposible verse activo sin estarlo para un lector de pantalla. Es el fallo clásico de este patrón y aquí está evitado por diseño |
| **Modales nativos** | `<dialog showModal()>` en `publication-detail.tsx`, `submission-viewer.tsx` y `step-prompt-field.tsx`, guardando y restaurando `document.activeElement` |
| **Foco tras avanzar de paso** | `publish-flow.tsx` mueve el foco al `<h1>` de cada paso con `ref` + `tabIndex={-1}` |
| **Regiones vivas** | 40 usos de `aria-live` / `role="status"` / `role="alert"` |
| **Imágenes** | 8 de 8 `<img>` con `alt`; `alt=""` cuando el nombre ya aparece al lado, con el motivo escrito en `UserAvatar` |
| **Encabezado invisible para no saltar niveles** | `<h2 className="sr-only">Resultados</h2>` en `/explore`, con el motivo comentado |
| **Menú de cuenta** | `aria-expanded`, `aria-haspopup`, `aria-controls`, cierre con `Escape` y con clic fuera |

---

## Puntos menores

### A-04 · P2 · `/login`, `/register`, `/aula` y `/dashboard` no traen `<h1>` en el HTML

Comprobado descargando el HTML de producción: en esas cuatro rutas no hay ningún
`<h1>` en el documento servido. El `<h1>` lo pinta React. Con JavaScript lento o
fallido, la página no tiene encabezado y el `fallback` de Suspense es un `<p>`
suelto («Cargando…»). No es un fallo de seguridad ni impide el uso con JS activo,
pero deja esas pantallas sin estructura durante la carga.
**Solución**: `<h1>` estático en el componente de servidor, con el formulario
dentro del `Suspense`. Dificultad: baja.

### A-05 · P3 · `role="dialog"` sin `aria-modal` en `share-button.tsx`

`components/ui/share-button.tsx:90` declara `role="dialog"` sin `aria-modal`, a
diferencia de los otros tres diálogos del proyecto. Si es un popover y no un
modal, el rol correcto no es `dialog`.
**Solución**: `<dialog>` nativo como el resto, o quitar el rol.

### A-06 · P3 · Los diálogos no llevan `<h1>`/`<h2>` coherente con la página

`PublicationDetail` usa un `<h2>` como título del diálogo dentro de una página
que ya tiene `<h2>` de sección. No es un fallo de WCAG —el diálogo modal aísla el
contexto—, pero conviene fijar la convención al añadir más diálogos.

### A-07 · P3 · La retícula de fondo se dibuja sobre `body`

`background-image` con dos gradientes lineales a 64 px sobre `body`. Es muy tenue
(`rgba(…, 0.045)`) y no interfiere con el contraste del texto, pero conviene
comprobarlo si en el rediseño se sube su opacidad.

---

## Comprobaciones que esta auditoría **no** pudo hacer

Las herramientas de lectura del navegador estuvieron bloqueadas durante toda la
sesión (`Policy check temporarily unavailable`), así que lo siguiente queda
pendiente de verificación en un navegador real:

- Recorrido completo con teclado de las pantallas autenticadas (orden de
  tabulación, trampas de foco).
- Anuncios reales con lector de pantalla (NVDA / VoiceOver).
- Contraste efectivo tras la composición de capas translúcidas (`bg-bg/85` +
  `backdrop-blur-md` del navbar sobre contenido que pasa por debajo).
- Comportamiento del zoom al 200 % y del `text-spacing` de 1.4.12.

Todo lo reportado arriba está derivado del código fuente y de los valores del
sistema de diseño, no de una inspección visual, y es verificable releyendo esos
archivos.
