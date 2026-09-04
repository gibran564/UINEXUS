# Design language — UINexus

## 1. El concepto: papel cuadriculado y tinta

UINexus expone trabajo de diseño. Si la plataforma compite visualmente con lo
que exhibe, falla en su único cometido. De ahí un lenguaje que se comporta como
el papel de un cuaderno de bocetos: presente, con carácter, y por debajo del
trabajo.

El nombre da la forma: **UI + nexus**, el punto donde se cruzan los trabajos.
Ese cruce es literalmente el símbolo de la marca (una celda encendida en una
retícula) y la textura del fondo de todas las páginas: dos gradientes lineales
a 64 px, con una opacidad del 4,5 % que sólo se nota si se busca.

### Lo que se evitó, a propósito

| Cliché SaaS | Qué se hizo en su lugar |
|---|---|
| Fondo blanco puro | Papel cálido `#f3f1ea` en claro; tinta `#121316` en oscuro |
| Tarjetas blancas con `shadow-md` | **Filetes de 1 px.** Las sombras se reservan a lo que de verdad flota: menús y diálogos |
| Esquinas redondeadas por todas partes | Radios de 2–10 px. El radio grande sólo en la portada de las tarjetas |
| Gradiente morado | Acento **terracota** `#ad3f1c`, apagado, con contraste verificado |
| Sans geométrica para todo | Serif variable (Fraunces) en títulos: voz editorial y académica |
| Iconos sin etiqueta | Todo icono va acompañado de texto o de un nombre accesible |

## 2. Tokens

Todos en `src/app/globals.css`, expuestos como utilidades con `@theme inline`
para que el cambio de tema sea instantáneo y sin recompilar.

### Superficies y texto

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#f3f1ea` | `#121316` | Lienzo de la página |
| `--surface` | `#fbfaf6` | `#191a1e` | Paneles, barras |
| `--surface-raised` | `#ffffff` | `#212328` | Menús, popovers |
| `--surface-sunken` | `#eceadf` | `#0d0e10` | Zonas de arrastre, bloques inertes |
| `--fg` | `#191a1c` | `#f0eee9` | Texto principal |
| `--fg-muted` | `#56585f` (7.0:1) | `#a7aab3` (8.0:1) | Texto secundario |
| `--fg-subtle` | `#6b6d75` (5.4:1) | `#878a93` (5.2:1) | Metadatos |
| `--border` | `#ded9cc` | `#2c2e34` | Filete estándar |
| `--border-strong` | `#c3bcaa` | `#414450` | Campos, controles |

### Acento y semánticos

| Token | Claro | Oscuro | Contraste sobre su fondo |
|---|---|---|---|
| `--accent` | `#ad3f1c` | `#ff8a5c` | 5.6:1 / 8.4:1 |
| `--success` | `#1c6b46` | `#55d19a` | 5.2:1 / 8.9:1 |
| `--warning` | `#8a5c07` | `#e8b45c` | 5.0:1 / 8.8:1 |
| `--danger` | `#a52418` | `#ff8a80` | 6.1:1 / 8.2:1 |

Cada semántico tiene su pareja `-soft` para fondos. **El color nunca comunica
solo**: el estado de un proyecto lleva punto *y* texto, un campo con error
lleva borde *y* mensaje *y* `aria-invalid`.

### Temas

Tres estados reales: claro, oscuro y *sistema*. El script de
`components/theme/theme-script.tsx` resuelve la preferencia antes de la primera
pintura (sin él, quien tiene el sistema en oscuro ve un destello blanco en cada
navegación). El selector es un grupo de radios, no un interruptor: "sistema" es
una elección y mucha gente la quiere de vuelta.

Hay además un bloque `@media (prefers-contrast: more)` que refuerza los filetes,
que son la estructura del diseño.

### Escala tipográfica — ocho pasos

| Token | Tamaño | Interlineado | Uso |
|---|---|---|---|
| `text-display` | 36 → 56 px fluido | 1.04 | Sólo el titular de portada |
| `text-h1` | 28 → 40 px | 1.10 | Título de página |
| `text-h2` | 22 → 28 px | 1.20 | Sección |
| `text-h3` | 19 px | 1.30 | Título de tarjeta |
| `text-lead` | 17 px | 1.60 | Entradillas |
| `text-body` | 16 px | 1.65 | Cuerpo |
| `text-small` | 14 px | 1.55 | Controles, ayudas |
| `text-label` | 13 px | 1.45 | Metadatos, rutas en mono |

Suelo tipográfico: **12 px** (la clase `.meta`, en versalitas y mono). Nada baja
de ahí. En móvil los campos se fuerzan a 16 px porque iOS hace zoom en cualquier
campo por debajo de esa cifra.

Dos familias, ninguna más: **Fraunces** (serif variable, títulos) e **Inter**
(interfaz y cuerpo). El monoespaciado es el del sistema: se usa sólo en
metadatos y URLs, y no justifica 40 KB más de descarga. Total de fuentes:
~125 KB, con `font-display: swap` y respaldo de sistema.

### Espaciado, radios, movimiento

Escala 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96. Radios `2 / 4 / 6 / 10 px`.
Transiciones de 160 ms con `cubic-bezier(.2,0,0,1)`, y todo el movimiento
anulado bajo `prefers-reduced-motion`.

## 3. Componentes

Sólo los que hicieron falta. No hay una biblioteca de 50 primitivas construida
para poder decir que existe un design system.

### Clases base (`@layer components`)

`.btn` con variantes `primary / secondary / ghost / danger` y tamaños `sm / lg`
— altura mínima 44 px, objetivo táctil de WCAG 2.2 · `.field` y `.label` y
`.hint` para formularios · `.panel` (superficie con filete) · `.tag` (etiqueta
**no** interactiva, en tarjetas) · `.chip` (**todo** control de filtro y
selección) · `.meta` (metadato en versalitas) · `.section-mark` (la cruz de la
retícula que precede a los títulos de sección) · `.skip-link`.

`.chip` merece una nota: el estado seleccionado se pinta desde `aria-current` y
`aria-pressed`, no desde una clase aparte. Así es imposible que un chip parezca
activo sin estarlo para un lector de pantalla — el fallo clásico de este patrón.

### Componentes React

| Componente | Papel |
|---|---|
| `AppShell` (layout) + `Navbar` + `Footer` + `DemoBanner` | Marco, sesión, tema |
| `ProjectCard` · `ProjectGrid` · `ProjectGridSkeleton` | La galería |
| `GeneratedCover` | Portada determinista cuando no hay captura |
| `ProjectPreview` | Visor aislado, con simulación de dispositivos |
| `PublishFlow` · `UploadDropzone` · `VisibilitySelector` | El flujo de publicación |
| `DashboardClient` · `ProjectRowActions` · `EditProject` · `ProfileEditor` | Administración |
| `FilterBar` · `SearchField` | Exploración (enlaces, no estado de cliente) |
| `ShareButton` · `CopyField` · `StatusBadge` · `EmptyState` · `UserAvatar` · `Logo` | Piezas de apoyo |
| `AuthProvider` · `ThemeToggle` · `ReportProject` | Transversales |

### `GeneratedCover`

Una galería en la que la mitad de las tarjetas están vacías o repiten el mismo
icono deja de ser una galería. Cuando un proyecto no trae captura, se dibuja un
boceto de interfaz determinista a partir del *slug*: cinco disposiciones
(panel, artículo, móvil, formulario, galería) con los filetes y el acento del
sistema. Siempre la misma para el mismo proyecto, distinta entre proyectos, y
sin una sola petición de red.

## 4. Reglas de composición

- **Alineación a la izquierda por defecto.** Sólo se centra el estado vacío y
  las pantallas de una sola acción.
- **El texto no pasa de 65–68ch.** `.prose-block` lo impone.
- **La portada domina la tarjeta** (~70 % de su altura) y nunca hay más de
  cuatro metadatos debajo del título.
- **Un solo elemento interactivo por tarjeta**: el título, extendido a toda la
  superficie con `::after`. Las etiquetas de la tarjeta son texto, no enlaces —
  así no se anidan interactivos ni se multiplican las paradas de tabulador.
- **Jerarquía por tamaño, peso y espacio antes que por color.** El diseño
  completo se sostiene en escala de grises; el acento sólo marca la acción
  principal y el estado activo.
