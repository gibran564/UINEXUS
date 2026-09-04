'use client';

import { useId } from 'react';

/**
 * Campo de texto con sugerencias.
 *
 * Un `<select>` obliga a elegir de una lista cerrada, y aquí la lista no puede
 * serlo: el primer proyecto de un curso nuevo no tendría dónde ponerse. Un
 * `<input>` a secas resuelve eso pero pierde lo que el desplegable hacía bien,
 * que era evitar que el mismo curso se escriba de cinco maneras distintas.
 *
 * `<input list>` + `<datalist>` es el control nativo que hace las dos cosas:
 * se escribe libremente, se despliega lo que ya existe, y el navegador filtra
 * mientras se teclea. Es nativo a propósito — un combobox propio son doscientas
 * líneas de ARIA y teclado que aquí no aportan nada, y el nativo ya lo anuncia
 * bien cualquier lector de pantalla.
 *
 * Quien decide si lo escrito es nuevo o ya existía es el SERVIDOR, comparando
 * por slug. El navegador sólo sugiere.
 */
export function ComboField({
  label,
  value,
  onChange,
  options,
  hint,
  placeholder,
  maxLength,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  optional?: boolean;
}) {
  const inputId = useId();
  const listId = `${inputId}-opciones`;

  return (
    <div>
      <label htmlFor={inputId} className="label">
        {label}{' '}
        {optional && <span className="font-normal text-subtle">(opcional)</span>}
      </label>
      <input
        id={inputId}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        className="field"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
