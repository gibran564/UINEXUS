'use client';

import { useState } from 'react';
import { insertableNexBookBlocks, nexBookBlockAction } from '@/lib/nexbook-blocks';
import type { NexBookBlockType } from '@/lib/types';

/**
 * Elegir un tipo de bloque, en la barra o entre dos bloques.
 *
 * ## Un solo menú, dos sitios
 *
 * El menú «+ Bloque» de la barra y el insertador que aparece entre dos bloques
 * ofrecen LO MISMO: la diferencia está en dónde cae el bloque nuevo, y eso lo
 * decide quien monta el componente al cerrar `onInsert`. Dos implementaciones
 * habrían significado que el día que se añada un tipo, uno de los dos menús se
 * quede sin él, y el catálogo compartido no serviría de nada si cada menú
 * volviera a escribir su lista.
 *
 * ## Sin `document.addEventListener`
 *
 * El resto de menús de la aplicación se cierran con oyentes en `document`
 * —`ProjectRowActions`, la cuenta de la barra—. Aquí no: puede haber cien de
 * estos en un documento largo, y cien pares de oyentes globales por un menú que
 * casi siempre está cerrado es un precio que no hace falta pagar.
 *
 * Se cierra con lo que ya sabe el árbol: `onBlur` del contenedor cuando el foco
 * sale de él, y `Escape`. Para que eso baste, al abrir el menú el foco ENTRA en
 * él —por eso `focusFirstItem`—: sin esa garantía, en Safari, donde pulsar un
 * botón no lo enfoca, el menú se quedaría abierto al hacer clic fuera.
 *
 * `Escape` para la propagación a propósito: este menú puede estar dentro del
 * panel de plantilla, que se cierra con `Escape` desde `window`. Cerrar el menú
 * Y el panel con la misma pulsación haría perder de vista lo que se estaba
 * preparando.
 */

export interface NexBookBlockInserterProps {
  /** Inserta un bloque de este tipo. La POSICIÓN la fija quien llama. */
  onInsert: (type: NexBookBlockType) => void;
  /** Si no hay a dónde subir imágenes, no se ofrece «Imagen». */
  canUploadAssets: boolean;
  /**
   * `toolbar`: el botón de la barra, con su etiqueta visible.
   * `between`: el separador discreto que aparece entre dos bloques.
   */
  variant: 'toolbar' | 'between';
  /**
   * El nombre accesible del disparador.
   *
   * En `toolbar` es además el texto visible. En `between` sólo es el nombre
   * accesible, porque el texto visible —«+ Añadir bloque»— se repite en cada
   * hueco del documento y no distinguiría un insertador de otro para quien
   * navega por lista de botones.
   */
  label: string;
  /** No abre el menú cuando el documento ya alcanzó su límite. */
  disabled?: boolean;
}

export function NexBookBlockInserter({
  onInsert,
  canUploadAssets,
  variant,
  label,
  disabled = false,
}: NexBookBlockInserterProps) {
  const [open, setOpen] = useState(false);
  const choices = insertableNexBookBlocks({ assetUpload: canUploadAssets });

  function select(type: NexBookBlockType): void {
    setOpen(false);
    onInsert(type);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!open) return;

    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      trigger(event.currentTarget)?.focus();
      return;
    }

    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;

    // Las flechas recorren el menú en vez de desplazar el documento, que es lo
    // que espera cualquiera que haya abierto un menú.
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const current = items.findIndex((item) => item === document.activeElement);
    const next = items[(current + step + items.length) % items.length];
    next?.focus();
  }

  /** El foco salió del insertador: nadie está usando ya este menú. */
  function onBlur(event: React.FocusEvent<HTMLDivElement>): void {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
  }

  return (
    <div
      className={variant === 'toolbar' ? 'relative' : 'relative flex items-center gap-2'}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {variant === 'between' && <Rule />}

      <button
        type="button"
        data-inserter-trigger
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open && !disabled}
        aria-haspopup="menu"
        aria-label={variant === 'between' ? label : undefined}
        className={variant === 'toolbar' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm'}
      >
        {variant === 'toolbar' ? label : <span className="text-label">+ Añadir bloque</span>}
      </button>

      {variant === 'between' && <Rule />}

      {open && !disabled && (
        <div
          role="menu"
          aria-label="Tipo de bloque"
          ref={focusFirstItem}
          className={`absolute top-full z-30 mt-1 w-60 rounded-sm border border-line bg-surface py-1 shadow-lg ${
            variant === 'toolbar' ? 'left-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {choices.map((definition) => (
            <button
              key={definition.type}
              type="button"
              role="menuitem"
              onClick={() => select(definition.type)}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-sunken"
            >
              <span className="text-sm">{nexBookBlockAction(definition)}</span>
              <span className="ml-auto text-label text-subtle">{definition.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * La línea del separador.
 *
 * El insertador se ve SIEMPRE, atenuado, en vez de aparecer al pasar el ratón:
 * en una pantalla táctil no hay ratón por el que pasar, y un control que sólo
 * existe al hacer hover no existe en un móvil. Discreto en reposo, evidente al
 * enfocarlo o al pasar por encima —de eso se encarga `.btn-ghost`—, y siempre
 * alcanzable con el tabulador.
 */
function Rule() {
  return <span aria-hidden="true" className="h-0 flex-1 border-t border-line" />;
}

/** El disparador de ESTE insertador, sin necesidad de un `ref`. */
function trigger(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-inserter-trigger]');
}

/**
 * Al abrirse, el foco entra en el menú.
 *
 * Está declarada FUERA del componente para que su identidad no cambie entre
 * renderizados: React sólo la llama al montar y al desmontar el menú, no cada
 * vez que el documento cambia. Una función en línea aquí devolvería el foco al
 * primer elemento cada vez que se repintara el editor.
 */
function focusFirstItem(node: HTMLDivElement | null): void {
  node?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}
