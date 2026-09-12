'use client';

import type { ReactNode } from 'react';

/**
 * El marco del Inicio: dónde cae cada zona en cada ancho.
 *
 * ## Dos zonas, no tres
 *
 * Un carril de contexto a la izquierda y todo lo demás a la derecha. El tercer
 * carril que la propuesta dejaba abierto —«descubrir», a partir de 1440 px— no
 * se añade: hoy no hay contenido que se gane ese sitio sin ampliar la API del
 * inicio, y dos columnas legibles es mejor resultado que tres con relleno.
 *
 * ## Por qué la columna principal lo lleva todo
 *
 * Porque el Inicio es el sitio donde se decide qué hacer, no un vestíbulo con
 * enlaces a las pantallas donde se decide. Los contadores, lo que hay que
 * hacer, lo que quedó a medias y lo que se publicó viven en la misma columna y
 * en ese orden. Repartirlos entre dos columnas obligaría a barrer la pantalla
 * en zigzag para saber si queda algo pendiente.
 *
 * ## Las reglas del ancho
 *
 * La columna principal no baja de 560 px ni sube de 640 px: por debajo, la
 * miniatura y el texto se pelean; por encima, la línea se sale del rango
 * legible. El carril mide 280 px fijos y no se comprime nunca —un carril de 180
 * px es peor que ningún carril—: por debajo de 1024 px no se estrecha, se va.
 * Lo que lleva —quién eres y tus materias— ya está en el navbar y en `/aula`.
 *
 * ## El orden vertical no cambia
 *
 * En cualquier ancho el orden del documento es el mismo. La rejilla de
 * escritorio sólo aparta el contexto a un lado, así que girar el dispositivo no
 * reordena la pantalla ni cambia lo que lee un lector de pantalla.
 */
export function WallLayout({ rail, main }: { rail: ReactNode; main: ReactNode }) {
  return (
    <div className="container-page py-8">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 md:max-w-[704px] lg:grid lg:max-w-[960px] lg:grid-cols-[280px_minmax(560px,640px)] lg:gap-x-10">
        <aside className="hidden lg:sticky lg:top-20 lg:col-start-1 lg:block lg:self-start">
          {rail}
        </aside>

        <div className="lg:col-start-2">{main}</div>
      </div>
    </div>
  );
}

/**
 * El muro mientras llega.
 *
 * Ocupa el mismo sitio que el muro de verdad para que la pantalla no salte
 * cuando entran los datos: mismas dos zonas, mismas alturas de tarjeta. No
 * anima nada —el movimiento no acelera la respuesta y molesta a quien pide
 * menos movimiento—; sólo reserva el hueco y lo dice en voz alta una vez.
 */
export function WallSkeleton() {
  return (
    <div className="container-page py-8" aria-busy="true">
      <p role="status" className="sr-only">
        Abriendo tu inicio…
      </p>

      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 md:max-w-[704px] lg:grid lg:max-w-[960px] lg:grid-cols-[280px_minmax(560px,640px)] lg:gap-x-10 lg:gap-y-6">
        <div aria-hidden="true" className="hidden flex-col gap-2 lg:flex">
          <div className="panel h-16" />
          <div className="panel h-16" />
        </div>

        <div aria-hidden="true" className="flex flex-col gap-3">
          <div className="panel h-24" />
          <div className="panel h-24" />
          <div className="panel h-24" />
        </div>
      </div>
    </div>
  );
}
