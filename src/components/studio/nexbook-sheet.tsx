'use client';

import { useMemo, useRef, useState } from 'react';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import { cellKey, columnName } from '@/lib/spreadsheet/cells';
import { evaluateSheet, formatValue, isFormula, isFormulaError } from '@/lib/spreadsheet/formula';
import type { NexBookSheetData } from '@/lib/types';

/**
 * La rejilla de un bloque de hoja de cálculo.
 *
 * ## Por qué una `<table>` y no un canvas
 *
 * Se evaluó Univer, que es la referencia del sector, y se descartó para esta
 * versión. Las razones están en `docs/NEXBOOK.md`; la que decide aquí es la
 * accesibilidad: Univer dibuja la hoja en un canvas, y un canvas no tiene
 * celdas que un lector de pantalla pueda anunciar. Una tabla real con
 * `<th scope>` sí: al moverse se oye «columna B, fila 3», que en un documento
 * académico —que alguien va a revisar y calificar— no es un extra.
 *
 * Lo que se pierde es todo lo que hace falta a partir de las diez mil filas:
 * virtualización, congelar paneles, formato enriquecido. Una hoja dentro de un
 * NexBook tiene decenas de filas, no decenas de miles, y el límite (200 × 40)
 * está puesto justo donde esta implementación sigue siendo cómoda.
 *
 * ## Editar y ver
 *
 * La celda enfocada enseña lo ESCRITO —`=SUMA(A1:A3)`— y las demás el valor
 * calculado. Es lo que hace cualquier hoja, y es lo que permite corregir una
 * fórmula sin tener que adivinarla.
 */

export interface NexBookSheetProps {
  sheet: NexBookSheetData;
  editable: boolean;
  onChange: (sheet: NexBookSheetData) => void;
  /** Para los nombres accesibles: «fila 3, columna B de Ventas». */
  name: string;
}

export function NexBookSheet({ sheet, editable, onChange, name }: NexBookSheetProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  /**
   * Toda la hoja se recalcula cuando cambia.
   *
   * Es lo correcto con estos tamaños: 200 × 40 son ocho mil celdas y sólo se
   * evalúan las que tienen contenido. Un recálculo incremental por dependencias
   * exigiría mantener un grafo, y ese grafo hay que invalidarlo bien —que es
   * justo donde las hojas de cálculo tienen sus errores más difíciles—.
   */
  const values = useMemo(() => evaluateSheet(sheet), [sheet]);

  function setCell(row: number, column: number, input: string): void {
    const key = cellKey(row, column);
    const cells = { ...sheet.cells };

    if (input.trim()) cells[key] = { input };
    // Vaciar una celda la BORRA en vez de guardar una cadena vacía: una hoja
    // donde se escribió y se borró no debe pesar más que una recién creada.
    else delete cells[key];

    onChange({ ...sheet, cells });
  }

  function resize(rows: number, columns: number): void {
    const nextRows = Math.min(Math.max(1, rows), NEXBOOK_LIMITS.maxSheetRows);
    const nextColumns = Math.min(Math.max(1, columns), NEXBOOK_LIMITS.maxSheetColumns);

    /**
     * Al encoger se BORRA lo que queda fuera.
     *
     * Conservarlo dejaría datos invisibles ocupando el documento, y el esquema
     * los rechaza al guardar —una celda fuera de la rejilla es un error—, así
     * que la hoja dejaría de poder guardarse sin que nadie viera por qué.
     */
    const cells = Object.fromEntries(
      Object.entries(sheet.cells).filter(([key]) => {
        const [row = '', column = ''] = key.split(':');
        return Number(row) < nextRows && Number(column) < nextColumns;
      })
    );

    onChange({ ...sheet, rows: nextRows, columns: nextColumns, cells });
  }

  /** Flechas y Enter mueven por la rejilla, como en cualquier hoja. */
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Enter: [1, 0],
      Tab: [0, event.shiftKey ? -1 : 1],
    };

    const move = moves[event.key];
    if (!move) return;
    // Las flechas izquierda y derecha NO se capturan: dentro de una celda con
    // texto sirven para mover el cursor, que es lo que espera quien escribe.
    if (event.key === 'Tab' && event.altKey) return;

    const target = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-cell="${cellKey(row + move[0], column + move[1])}"]`
    );
    if (!target) return;

    event.preventDefault();
    target.focus();
    target.select();
  }

  return (
    <div className="space-y-2">
      <div className="max-h-96 overflow-auto rounded-sm border border-line">
        <table ref={gridRef} className="border-collapse text-sm">
          <caption className="sr-only">
            Hoja de cálculo {name}: {sheet.rows} filas por {sheet.columns} columnas.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-20 bg-surface px-1">
                <span className="sr-only">Número de fila</span>
              </th>
              {Array.from({ length: sheet.columns }, (_, column) => (
                <th
                  key={column}
                  scope="col"
                  className="sticky top-0 z-10 min-w-24 border border-line bg-surface px-2 py-1 text-label font-medium text-subtle"
                >
                  {columnName(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: sheet.rows }, (_, row) => (
              <tr key={row}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border border-line bg-surface px-2 py-1 text-label font-normal text-subtle tabular-nums"
                >
                  {row + 1}
                </th>
                {Array.from({ length: sheet.columns }, (_, column) => {
                  const key = cellKey(row, column);
                  const input = sheet.cells[key]?.input ?? '';
                  const value = values.get(key) ?? null;
                  const focused = editing === key;
                  const error = isFormulaError(value);

                  return (
                    <td key={column} className="border border-line p-0">
                      <input
                        data-cell={key}
                        value={focused ? input : error ? String(value) : formatValue(value)}
                        readOnly={!editable}
                        onFocus={() => setEditing(key)}
                        onBlur={() => setEditing(null)}
                        onChange={(event) => setCell(row, column, event.target.value)}
                        onKeyDown={(event) => onKeyDown(event, row, column)}
                        maxLength={NEXBOOK_LIMITS.maxTableCellChars}
                        aria-label={`${name}, fila ${row + 1}, columna ${columnName(column)}`}
                        className={`w-28 bg-transparent px-2 py-1 outline-none focus:bg-sunken focus:ring-1 focus:ring-accent ${
                          error
                            ? 'text-danger'
                            : typeof value === 'number' && !focused
                              ? 'text-right tabular-nums'
                              : ''
                        } ${isFormula(input) && !focused ? 'text-accent' : ''}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => resize(sheet.rows + 1, sheet.columns)}
            disabled={sheet.rows >= NEXBOOK_LIMITS.maxSheetRows}
            className="btn btn-ghost btn-sm"
          >
            + Fila
          </button>
          <button
            type="button"
            onClick={() => resize(sheet.rows - 1, sheet.columns)}
            disabled={sheet.rows <= 1}
            className="btn btn-ghost btn-sm"
          >
            − Fila
          </button>
          <button
            type="button"
            onClick={() => resize(sheet.rows, sheet.columns + 1)}
            disabled={sheet.columns >= NEXBOOK_LIMITS.maxSheetColumns}
            className="btn btn-ghost btn-sm"
          >
            + Columna
          </button>
          <button
            type="button"
            onClick={() => resize(sheet.rows, sheet.columns - 1)}
            disabled={sheet.columns <= 1}
            className="btn btn-ghost btn-sm"
          >
            − Columna
          </button>
          <span className="ml-auto text-label text-subtle">
            Fórmulas: =SUMA(A1:A5), =PROMEDIO(B1:B9), =SI(A1&gt;10; &quot;alto&quot;; &quot;bajo&quot;)
          </span>
        </div>
      )}
    </div>
  );
}
