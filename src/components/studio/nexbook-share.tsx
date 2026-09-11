'use client';

import { useEffect, useState } from 'react';

import { getNexBookPublication, publishNexBook, unpublishNexBook } from '@/lib/aula-client';
import type { NexBookPublication, NexBookPublicVisibility } from '@/lib/types';

/**
 * Compartir y publicar.
 *
 * ## Publicar es una ACCIÓN, no un interruptor
 *
 * La diferencia está en el botón: no dice «público / privado», dice «Publicar» y
 * después «Actualizar publicación». Es lo que hace visible que lo publicado es
 * una COPIA y no el documento en el que se sigue trabajando:
 *
 * ```
 * NexBook vivo  ──Publicar──▶  copia congelada
 *      │                              ▲
 *      └─────Actualizar publicación───┘
 * ```
 *
 * Cuando el original avanza, se dice «hay cambios sin publicar» en vez de
 * publicarlos solos. Alguien que arregla un dato a la una de la mañana decide
 * cuándo eso se ve fuera.
 *
 * ## Retirar no borra
 *
 * «Dejar de publicar» quita la copia pública. El documento original no se toca,
 * y el texto lo dice: confundir las dos cosas en un botón sería la peor manera
 * de descubrir la diferencia.
 */

const VISIBILITY_LABEL: Record<NexBookPublicVisibility, string> = {
  class: 'Solo mi clase',
  link: 'Con el enlace',
  public: 'Público',
};

const VISIBILITY_HINT: Record<NexBookPublicVisibility, string> = {
  class: 'Hace falta entrar con una cuenta institucional.',
  link: 'Quien tenga la dirección puede abrirlo. No se lista en ningún sitio.',
  public: 'Cualquiera puede abrirlo.',
};

export function NexBookShare({ nexbookId, title }: { nexbookId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [publication, setPublication] = useState<NexBookPublication | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [visibility, setVisibility] = useState<NexBookPublicVisibility>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;

    void (async () => {
      try {
        const data = await getNexBookPublication(nexbookId);
        if (!active) return;
        setPublication(data.publication);
        setHasChanges(data.hasChanges);
        if (data.publication) setVisibility(data.publication.visibility);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'No se pudo consultar.');
      }
    })();

    return () => {
      active = false;
    };
  }, [open, nexbookId]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  }

  const url = publication ? `${location.origin}/nexbook/${publication.slug}` : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
      >
        {publication ? 'Publicado' : 'Compartir'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-sm border border-line bg-surface p-3 shadow-lg">
          <h2 className="text-sm font-medium">Publicar «{title}»</h2>

          <p className="mt-1 text-label text-subtle">
            Se publica una COPIA. Puedes seguir editando tu NexBook sin que lo publicado cambie.
          </p>

          <fieldset className="mt-3 space-y-1.5">
            <legend className="sr-only">Quién puede verlo</legend>
            {(Object.keys(VISIBILITY_LABEL) as NexBookPublicVisibility[]).map((option) => (
              <label key={option} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="nexbook-visibility"
                  value={option}
                  checked={visibility === option}
                  onChange={() => setVisibility(option)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm">{VISIBILITY_LABEL[option]}</span>
                  <span className="block text-label text-subtle">{VISIBILITY_HINT[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {publication && hasChanges && (
            <p className="mt-3 text-label text-warning">
              Tu NexBook cambió desde la última publicación.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await publishNexBook(nexbookId, { visibility });
                  setPublication(data.publication);
                  setHasChanges(false);
                })
              }
              className="btn btn-primary btn-sm"
            >
              {busy ? '…' : publication ? 'Actualizar publicación' : 'Publicar'}
            </button>

            {publication && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await unpublishNexBook(nexbookId);
                    setPublication(null);
                    setHasChanges(false);
                  })
                }
                className="btn btn-ghost btn-sm"
              >
                Dejar de publicar
              </button>
            )}
          </div>

          {url && (
            <div className="mt-3">
              <label className="block text-label text-subtle" htmlFor="nexbook-share-url">
                Dirección de la publicación
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="nexbook-share-url"
                  readOnly
                  value={url}
                  onFocus={(event) => event.target.select()}
                  className="field flex-1 text-label"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url);
                    setCopied(true);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              {/* El campo es de sólo lectura y seleccionable: copiar con el
                  portapapeles puede estar bloqueado y entonces hay que poder
                  seleccionar la dirección a mano. */}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
