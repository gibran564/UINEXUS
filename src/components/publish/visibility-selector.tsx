'use client';

import { STATUS_HELP, STATUS_LABEL } from '@/lib/constants';
import type { Visibility } from '@/lib/types';

const OPTIONS: Visibility[] = ['published', 'unlisted', 'draft'];

/**
 * Elección de visibilidad.
 *
 * Radios reales, no un desplegable: son tres opciones con consecuencias
 * distintas y cada una necesita su explicación a la vista. Esconderlas detrás
 * de un <select> obliga a recordar qué significaba cada una.
 */
export function VisibilitySelector({
  value,
  onChange,
  name = 'visibility',
}: {
  value: Visibility;
  onChange: (value: Visibility) => void;
  name?: string;
}) {
  return (
    <fieldset>
      <legend className="label">¿Quién puede ver este proyecto?</legend>
      <div className="space-y-2">
        {OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <label
              key={option}
              className={`flex cursor-pointer gap-3 rounded-sm border p-3.5 transition-colors ${
                selected
                  ? 'border-accent bg-accent-soft'
                  : 'border-line-strong bg-surface hover:border-fg-muted'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{STATUS_LABEL[option]}</span>
                <span className="mt-0.5 block text-sm text-muted">{STATUS_HELP[option]}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
