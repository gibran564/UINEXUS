'use client';

import type { ReactNode } from 'react';

/**
 * El marco del muro: dónde cae cada zona en cada ancho.
 *
 * ## Dos zonas, no tres
 *
 * Un carril de contexto a la izquierda y el muro a la derecha. El tercer carril
 * que la propuesta dejaba abierto —«descubrir», a partir de 1440 px— no se
 * añade: hoy no hay contenido que se gane ese sitio sin ampliar la API del
 * inicio, y dos columnas con un muro legible es mejor resultado que tres con
 * relleno.
 *
 * ## Las reglas del ancho
 *
 * El muro no baja de 560 px ni sube de 640 px: por debajo, la miniatura y el
 * texto se pelean; por encima, la línea se sale del rango legible. El carril
 * mide 280 px fijos y no se comprime nunca —un carril de 180 px es peor que
 * ningún carril—: por debajo de 1024 px se transforma en una tira sobre el
 * muro, que es lo que hace `wall-rail`.
 *
 * ## El orden vertical no cambia
 *
 * En cualquier ancho el orden del documento es el mismo: filtros, luego lo que
 * requiere atención, luego el muro. La rejilla de escritorio sólo reparte esas
 * mismas piezas en dos columnas, así que girar el dispositivo no reordena la
 * pantalla ni cambia lo que lee un lector de pantalla.
 */
export function WallLayout({
  filters,
  rail,
  feed,
}: {
  filters?: ReactNode;
  rail: ReactNode;
  feed: ReactNode;
}) {
  return (
    <div className="container-page py-8">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 md:max-w-[704px] lg:grid lg:max-w-[960px] lg:grid-cols-[280px_minmax(560px,640px)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-6">
        {filters && <div className="lg:col-start-2 lg:row-start-1">{filters}</div>}

        <aside className="lg:sticky lg:top-20 lg:col-start-1 lg:row-span-2 lg:self-start">
          {rail}
        </aside>

        <div className="lg:col-start-2 lg:row-start-2">{feed}</div>
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
        <div aria-hidden="true" className="flex flex-col gap-2">
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
