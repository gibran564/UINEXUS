"""
Modelo de densidad del muro de UINexus.

No es una estimacion a ojo: cada numero sale de un valor que esta escrito en
`src/app/globals.css` o en una utilidad de Tailwind usada por
`src/components/home/academic-home.tsx`. Ejecutar con:

    python docs/audit/feed-density.py

Fuentes de cada constante (revisadas el 2026-09-06):
  container-page   globals.css @layer utilities  -> max-width 78rem, padding 1.25rem / 2rem (>=768px)
  max-w-3xl        Tailwind                      -> 48rem = 768px
  panel p-4        globals.css .panel + Tailwind -> border 1px, padding 16px
  gap-3 / space-y-3                              -> 12px
  avatar                                          -> 30px (UserAvatar size={30})
  text-label       globals.css @theme            -> 13px / 1.45
  text-sm          Tailwind (por defecto)        -> 14px / 20px
  titulo sin clase body                          -> 16px / 1.65
  btn-sm           globals.css                   -> min-height 36px
  portada          aspect-16/10 del ancho de la columna de texto
  navbar           navbar.tsx h-16               -> 64px, sticky
"""

REM = 16

def col_width(viewport_w):
    """Ancho util de la columna de contenido del Inicio autenticado."""
    pad = 2 * REM if viewport_w >= 768 else 1.25 * REM
    container = min(78 * REM, viewport_w) - 2 * pad
    return min(48 * REM, container)          # max-w-3xl

def card_height(text_col, with_cover):
    h = 16                                   # padding-top del panel
    h += 13 * 1.45                           # linea de autor (text-label)
    h += 4 + 20                              # mt-1 + verbo (text-sm)
    h += 2 + 16 * 1.65                       # mt-0.5 + titulo
    h += 4 + 2 * 20                          # mt-1 + resumen, line-clamp-2
    if with_cover:
        h += 12 + text_col / 1.6             # mt-3 + portada 16:10
    h += 12 + 36                             # mt-3 + btn-sm
    h += 16 + 2                              # padding-bottom + 2 bordes
    return h

def report(name, w, h):
    cw = col_width(w)
    text_col = cw - 32 - 2 - 30 - 12         # padding + bordes + avatar + gap
    proj = card_height(text_col, True) + 12  # + space-y-3
    text = card_height(text_col, False) + 12
    fold = h - 64                            # navbar sticky
    unused = w - cw
    print(f"{name:<22} viewport {w}x{h}")
    print(f"   columna              {cw:.0f}px    ancho no usado {unused:.0f}px ({unused/w*100:.0f}% del ancho)")
    print(f"   tarjeta con portada  {proj:.0f}px  -> {fold/proj:.2f} visibles")
    print(f"   tarjeta sin portada  {text:.0f}px  -> {fold/text:.2f} visibles")
    print()

def scroll_to_first_post(w, attention_cards=3, teacher=False):
    """Cuanto hay que bajar antes de ver la primera publicacion del muro."""
    y  = 32                                  # py-8
    y += 40 * 1.1 + 4 + 16 * 1.65            # h1 + subtitulo
    y += 24 + 24 + 14 * 1.55 + 2             # linea "desde tu ultima visita"
    y += 40 + 27.9 * 1.2 + 20                # mt-10 + h2 + mt-5
    y += attention_cards * 159 + (attention_cards - 1) * 12
    y += 40 + 78                             # compositor de publicaciones
    if teacher:
        y += 32 + 20 + 44                    # filtro por grupo (solo docente)
    y += 48 + 27.9 * 1.2 + 20                # mt-12 + h2 "De tu docente" + mt-5
    return y

if __name__ == '__main__':
    for name, w, h in [
        ("Laptop 1366x768", 1366, 768),
        ("Laptop 1440x900", 1440, 900),
        ("Desktop 1920x1080", 1920, 1080),
        ("Tablet 768x1024", 768, 1024),
        ("Movil 390x844", 390, 844),
    ]:
        report(name, w, h)

    print("Scroll hasta la primera publicacion del muro")
    for label, teacher in (("estudiante", False), ("docente", True)):
        y = scroll_to_first_post(1440, teacher=teacher)
        print(f"   {label:<12} {y:.0f}px  = {y / (900 - 64):.2f} pantallas de 1440x900")

# ---------------------------------------------------------------------------
# Propuesta: tarjeta compacta
# ---------------------------------------------------------------------------
# Miniatura 96x60 a la izquierda, tres lineas de texto a su derecha, una fila
# de acciones debajo. La portada deja de escalar con el ancho de la columna,
# que es lo unico que hace que la tarjeta actual crezca hasta 654px.

def compact_card(thumb_h=60):
    lines = 13 * 1.45 + 4 + 16 * 1.4 + 4 + 20   # autor / titulo / resumen
    body = max(lines, thumb_h)
    return 12 + body + 6 + 26 + 12 + 2          # padding + cuerpo + acciones

def proposal():
    card = compact_card() + 12                  # + separacion
    print()
    print("Propuesta - tarjeta compacta")
    print(f"   alto                 {card:.0f}px")
    for name, w, h, rail in [
        ("Laptop 1366x768", 1366, 768, True),
        ("Laptop 1440x900", 1440, 900, True),
        ("Desktop 1920x1080", 1920, 1080, True),
        ("Tablet 768x1024", 768, 1024, False),
        ("Movil 390x844", 390, 844, False),
    ]:
        fold = h - 64 - (0 if rail else 0)
        print(f"   {name:<20} {fold/card:.1f} visibles   (hoy: "
              f"{(h-64)/(card_height(col_width(w)-32-2-30-12, True)+12):.1f})")

if __name__ == '__main__':
    proposal()
