import React from 'react';

/**
 * Marca Nextudio.
 *
 * El símbolo es un nodo de retícula: cuatro celdas y un punto de cruce
 * resaltado. Es la misma idea que la textura del fondo — el lugar donde se
 * cruzan los trabajos — sin caer en la ilustración de red neuronal. El cruce
 * hace además de aspa, que es lo que el wordmark repite en la `x`.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.5V22.5M15 1.5V22.5M1.5 9H22.5M1.5 15H22.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <rect x="9" y="9" width="6" height="6" fill="var(--accent)" />
    </svg>
  );
}

/**
 * El nombre, con la `x` enfatizada.
 *
 * ## Lo que se lee y lo que se ve son la misma palabra
 *
 * El énfasis es SÓLO visual: peso y color de acento sobre la `x`. El texto
 * sigue siendo `Nextudio` —una palabra, una capitalización— y por eso no hay
 * `aria-label` que «arregle» nada. Si hiciera falta un `aria-label` para que un
 * lector de pantalla dijera el nombre bien, es que el nombre estaría mal
 * escrito, y la solución sería escribirlo bien.
 *
 * Dos condiciones sostienen eso, y romper cualquiera de las dos rompe la
 * accesibilidad sin que se note mirando la pantalla:
 *
 *  1. Los tres `<span>` van **pegados**, sin espacios ni saltos entre ellos:
 *     el JSX de abajo está escrito en una sola línea a propósito.
 *  2. El `<span>` de la `x` se queda **en línea**. Un `inline-block` o un
 *     `display: block` convertiría la palabra en tres trozos para quien navega
 *     con voz.
 *
 * La escritura normal del producto es siempre `Nextudio`. La variante con la
 * equis en mayúscula no existe como forma escrita: aquí hay un dibujo de la
 * palabra, no otra ortografía. Lo comprueba `tests/unit/branding.test.ts`.
 */
export function Wordmark({
  size = 22,
  hideNameUnder400 = false,
}: {
  size?: number;
  /**
   * Deja sólo el símbolo por debajo de 400 px de ancho.
   *
   * Es para la barra de navegación y para nada más. Ahí conviven el nombre, la
   * búsqueda, publicar, la cuenta y el menú, y en un teléfono de 360 px no
   * caben todos: algo tiene que ceder, y ceder una tarea —publicar, buscar— es
   * peor que ceder el nombre, que en ese ancho ya está dicho por el símbolo.
   *
   * No se pierde para quien no ve la pantalla: el enlace que envuelve la marca
   * lleva `aria-label="Nextudio, ir al inicio"`, así que el nombre accesible es
   * el mismo a cualquier ancho.
   */
  hideNameUnder400?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span
        className={`font-display font-medium tracking-[-0.02em] ${
          hideNameUnder400 ? 'max-[399px]:hidden' : ''
        }`}
        style={{ fontSize: `${size * 0.92}px` }}
      >
        {/* prettier-ignore */}
        <span>Ne</span><span className="font-semibold text-accent">x</span><span>tudio</span>
      </span>
    </span>
  );
}
