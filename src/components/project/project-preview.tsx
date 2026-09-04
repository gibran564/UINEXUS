'use client';

import { useState } from 'react';
import { GeneratedCover } from './generated-cover';

/**
 * Visor de proyectos.
 *
 * Tres decisiones de seguridad, en orden de importancia:
 *
 * 1. El `src` apunta al ORIGEN AISLADO, nunca a uinexus.mx. Aunque el iframe
 *    ejecute JavaScript hostil, la política de mismo origen lo separa de la
 *    sesión de la plataforma.
 * 2. El sandbox NO incluye `allow-same-origin`. El documento recibe un origen
 *    opaco: sin cookies, sin localStorage, sin poder tocar nada suyo. Es el
 *    ajuste más restrictivo que sigue permitiendo ver la interfaz.
 * 3. No se carga hasta que la persona lo pide. Abrir una ficha no debería
 *    ejecutar el código de nadie, y de paso la página no arrastra el peso de
 *    un sitio entero en la primera pintura.
 */

type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICES: { value: Device; label: string; width: number | null }[] = [
  { value: 'desktop', label: 'Escritorio', width: null },
  { value: 'tablet', label: 'Tableta', width: 820 },
  { value: 'mobile', label: 'Móvil', width: 390 },
];

export function ProjectPreview({
  src,
  title,
  seed,
  coverUrl,
  showDeviceSwitcher = false,
  aspect = 'aspect-16/10',
}: {
  src: string;
  title: string;
  seed: string;
  coverUrl?: string | null;
  showDeviceSwitcher?: boolean;
  aspect?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const width = DEVICES.find((item) => item.value === device)?.width ?? null;

  return (
    <figure className="m-0">
      {showDeviceSwitcher && loaded && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span id="device-label" className="meta">
            Ver como
          </span>
          <div role="group" aria-labelledby="device-label" className="flex gap-1">
            {DEVICES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDevice(option.value)}
                aria-pressed={device === option.value}
                className="chip"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-line bg-sunken">
        {/* Barra del visor: recuerda que lo de dentro no es UINexus. */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full border border-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full border border-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full border border-line-strong" />
          </span>
          <p className="truncate font-mono text-label text-muted">{src}</p>
        </div>

        <div className={`relative ${aspect} ${width ? 'flex justify-center' : ''}`}>
          {loaded ? (
            <iframe
              src={src}
              title={`Vista previa de ${title}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              // Sin allow-same-origin: origen opaco dentro del marco.
              sandbox="allow-scripts allow-popups allow-forms"
              className="h-full border-0 bg-white"
              style={{ width: width ? `${width}px` : '100%', maxWidth: '100%' }}
            />
          ) : (
            <>
              <div className="absolute inset-0" aria-hidden="true">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="h-full w-full object-cover opacity-60" />
                ) : (
                  <GeneratedCover seed={seed} className="h-full w-full opacity-60" />
                )}
              </div>
              <div className="absolute inset-0 grid place-items-center bg-bg/55 p-6 text-center backdrop-blur-[2px]">
                <div>
                  <button type="button" onClick={() => setLoaded(true)} className="btn btn-primary">
                    Cargar vista previa
                  </button>
                  <p className="mt-3 max-w-xs text-sm text-muted">
                    El proyecto se ejecuta en un dominio separado y con permisos mínimos.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {loaded && (
        <figcaption className="hint">
          Vista previa restringida: sin almacenamiento local ni cookies. Si algo no responde,
          ábrelo en una pestaña nueva.
        </figcaption>
      )}
    </figure>
  );
}
