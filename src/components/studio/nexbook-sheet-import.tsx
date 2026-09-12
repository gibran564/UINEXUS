'use client';

import { useRef, useState } from 'react';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import type { NexBookSheetData } from '@/lib/types';

/**
 * Importar datos a una hoja.
 *
 * ## Los parsers se cargan CUANDO alguien importa
 *
 * `import()` dinámico dentro del manejador, no arriba. Es la diferencia entre
 * que el lector de XLSX viaje en el bundle de cualquiera que abra un NexLab y
 * que sólo lo descargue quien pulsa «Importar XLSX». La regla de rendimiento de
 * la fase es explícita: ni el landing, ni la búsqueda, ni NexCode, ni una
 * publicación de sólo lectura pueden cargar el parser.
 *
 * ## Importar REEMPLAZA, y se avisa antes
 *
 * Una hoja con datos no se fusiona con el archivo: se sustituye. Fusionar
 * obligaría a decidir qué gana en cada celda, y cualquier respuesta automática
 * pierde datos de alguien sin decirlo. Si la hoja tiene contenido se pide
 * confirmación; si está vacía, no hay nada que confirmar.
 *
 * ## Después de importar manda el BLOQUE
 *
 * El archivo no queda vinculado. No hay «actualizar desde el origen», no se
 * guarda el `.xlsx` y no se vuelve a leer nunca: lo importado es ya la hoja, se
 * edita como cualquier otra y se guarda con el documento. Un archivo que siguiera
 * siendo la fuente viva sería un segundo sitio donde vive el dato.
 */

export interface SheetImportProps {
  /** El nombre actual del bloque, para poder proponer el de la hoja importada. */
  name: string;
  hasContent: boolean;
  onImport: (result: { sheet: NexBookSheetData; name?: string }) => void;
  /** Un XLSX con varias hojas propone crear un bloque por cada una. */
  onImportMany?: (sheets: { name: string; sheet: NexBookSheetData }[]) => void;
}

type Busy = null | 'csv' | 'xlsx';

export function NexBookSheetImport({ name, hasContent, onImport, onImportMany }: SheetImportProps) {
  const csvRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function confirmReplace(): boolean {
    if (!hasContent) return true;
    return window.confirm(
      `La hoja "${name}" ya tiene datos y se van a sustituir por los del archivo. ` +
        'Esto no se puede deshacer. ¿Continuar?'
    );
  }

  async function acceptCsv(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    setWarnings([]);
    if (!confirmReplace()) return;

    if (file.size > NEXBOOK_LIMITS.maxImportBytes) {
      setError(`Ese archivo supera ${megabytes()} MB.`);
      return;
    }

    setBusy('csv');
    try {
      // Dinámico: quien no importa nunca, nunca lo descarga.
      const { csvToSheet } = await import('@/lib/spreadsheet/csv');
      const result = csvToSheet(await file.text());
      setWarnings(result.warnings);
      onImport({ sheet: result.sheet, name: baseName(file.name) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo leer ese CSV.');
    } finally {
      setBusy(null);
      if (csvRef.current) csvRef.current.value = '';
    }
  }

  async function acceptXlsx(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    setWarnings([]);
    if (!confirmReplace()) return;

    if (file.size > NEXBOOK_LIMITS.maxImportBytes) {
      setError(`Ese archivo supera ${megabytes()} MB.`);
      return;
    }

    setBusy('xlsx');
    try {
      const { readXlsx } = await import('@/lib/spreadsheet/xlsx');
      const result = readXlsx(new Uint8Array(await file.arrayBuffer()));
      setWarnings(result.warnings);

      const [first, ...rest] = result.sheets;
      if (!first) {
        setError('Ese libro no tiene ninguna hoja con datos.');
        return;
      }

      /**
       * Una hoja de Excel, un bloque.
       *
       * La primera sustituye a ésta y las demás se añaden detrás, cada una con
       * su nombre del libro. Así `nex.sheet("Ventas")` encuentra exactamente lo
       * que se llamaba «Ventas» en Excel, sin que nadie tenga que renombrar
       * nada.
       */
      onImport({ sheet: first.sheet, name: first.name });
      if (rest.length > 0 && onImportMany) onImportMany(rest);
      else if (rest.length > 0) {
        setWarnings((current) => [
          ...current,
          `El libro traía ${rest.length} hoja${rest.length === 1 ? '' : 's'} más que no se pudieron añadir aquí.`,
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo leer ese .xlsx.');
    } finally {
      setBusy(null);
      if (xlsxRef.current) xlsxRef.current.value = '';
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => xlsxRef.current?.click()}
          disabled={busy !== null}
          className="btn btn-ghost btn-sm"
        >
          {busy === 'xlsx' ? 'Importando…' : 'Importar XLSX'}
        </button>
        <button
          type="button"
          onClick={() => csvRef.current?.click()}
          disabled={busy !== null}
          className="btn btn-ghost btn-sm"
        >
          {busy === 'csv' ? 'Importando…' : 'Importar CSV'}
        </button>
        <span className="text-label text-subtle">
          Sustituye los datos de esta hoja · hasta {megabytes()} MB
        </span>
      </div>

      <input
        ref={xlsxRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label={`Archivo XLSX para la hoja ${name}`}
        onChange={(event) => void acceptXlsx(event.target.files?.[0])}
      />
      <input
        ref={csvRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        aria-label={`Archivo CSV para la hoja ${name}`}
        onChange={(event) => void acceptCsv(event.target.files?.[0])}
      />

      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Lo que se ignoró se DICE. Un archivo con macros que se importa en
          silencio hace creer que las macros siguen ahí. */}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1" role="status">
          {warnings.map((warning) => (
            <li key={warning} className="text-label text-warning">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const megabytes = (): number => Math.round(NEXBOOK_LIMITS.maxImportBytes / (1024 * 1024));

/** `ventas-2026.csv` → `ventas-2026`. El nombre del archivo es un buen nombre. */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, NEXBOOK_LIMITS.maxSheetNameChars) || 'Hoja';
}
