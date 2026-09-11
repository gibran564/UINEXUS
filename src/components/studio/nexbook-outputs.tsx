import { NEXBOOK_LIMITS } from '@/lib/constants';
import type {
  NexBookCellResult,
  NexBookImageOutput,
  NexBookJsonOutput,
  NexBookOutput,
  NexBookTableOutput,
  NexBookTextOutput,
} from '@/lib/types';

/**
 * La salida de una celda.
 *
 * Se pinta recorriendo `outputs` EN ORDEN y no leyendo «el stdout» y «el
 * stderr» por separado. Desde la iteración 9 ese orden es el REAL —el motor
 * conserva la secuencia en que ocurrió—, así que un programa que imprime, avisa
 * y vuelve a imprimir se lee como pasó.
 *
 * Cada tipo de salida sabe pintarse a sí mismo. Un `switch` sobre `stream` y no
 * una cadena de `if`: cuando se añada un tipo nuevo, TypeScript señala aquí el
 * caso que falta en vez de dejar un hueco en blanco debajo de la celda.
 */

export interface NexBookOutputsProps {
  result: NexBookCellResult;
  /**
   * De dónde se leen las imágenes.
   *
   * Es una función y no una URL base porque el camino cambia según el contexto:
   * un NexBook propio, una entrega que revisa la docente y una publicación
   * resuelven sus assets por rutas distintas y con permisos distintos. El
   * componente no tiene por qué saber cuál es.
   */
  assetUrl?: (assetId: string) => string;
  /** Imágenes recién generadas que todavía no son assets. Clave: `seq`. */
  pendingImages?: Record<number, string>;
  onClear?: () => void;
}

const STATUS_LABEL: Record<NexBookCellResult['status'], string> = {
  ok: 'Finalizado',
  failed: 'Error de ejecución',
  timeout: 'Tiempo excedido',
  stopped: 'Interrumpido',
  rejected: 'No se ejecutó',
};

const STATUS_TONE: Record<NexBookCellResult['status'], string> = {
  ok: 'text-success',
  failed: 'text-danger',
  timeout: 'text-warning',
  stopped: 'text-warning',
  rejected: 'text-subtle',
};

/** ¿Este trozo de salida tiene algo que enseñar? */
function hasContent(output: NexBookOutput): boolean {
  switch (output.stream) {
    case 'table':
      return output.columns.length > 0;
    case 'image':
      return true;
    case 'json':
      return output.value !== null && output.value !== undefined;
    default:
      return Boolean(output.text);
  }
}

export function NexBookOutputs({
  result,
  assetUrl,
  pendingImages,
  onClear,
}: NexBookOutputsProps) {
  const visible = result.outputs.filter(hasContent);

  return (
    <div className="border-t border-line bg-sunken px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="meta">Salida</span>
        <span className={`text-label ${STATUS_TONE[result.status]}`}>
          {STATUS_LABEL[result.status]}
        </span>
        <span className="text-label text-subtle tabular-nums">{result.durationMs} ms</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="btn btn-ghost btn-sm ml-auto"
            // El nombre accesible dice QUÉ se limpia. «Limpiar» a secas, repetido
            // una vez por celda, deja a quien navega por lista de botones sin
            // saber cuál es cuál.
            aria-label={`Limpiar la salida del bloque ${result.blockId}`}
          >
            Limpiar salida
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mt-1 text-sm text-subtle">El programa terminó sin escribir nada.</p>
      ) : (
        visible.map((output) => (
          <OutputPart
            key={output.seq}
            output={output}
            assetUrl={assetUrl}
            pending={pendingImages?.[output.seq]}
          />
        ))
      )}
    </div>
  );
}

function OutputPart({
  output,
  assetUrl,
  pending,
}: {
  output: NexBookOutput;
  assetUrl?: (assetId: string) => string;
  pending?: string;
}) {
  switch (output.stream) {
    case 'table':
      return <TableOutput output={output} />;
    case 'image':
      return <ImageOutput output={output} assetUrl={assetUrl} pending={pending} />;
    case 'json':
      return <JsonOutput output={output} />;
    default:
      return <TextOutput output={output} />;
  }
}

const STREAM_STYLE: Record<NexBookTextOutput['stream'], string> = {
  stdout: 'text-fg',
  stderr: 'text-warning',
  error: 'text-danger',
};

function TextOutput({ output }: { output: NexBookTextOutput }) {
  return (
    <pre
      className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-sm ${STREAM_STYLE[output.stream]}`}
    >
      {output.text}
      {output.truncated && (
        <span className="block text-label text-subtle">
          … la salida se cortó a {NEXBOOK_LIMITS.maxOutputChars.toLocaleString('es-MX')} caracteres.
        </span>
      )}
    </pre>
  );
}

/**
 * Una tabla, con semántica de tabla.
 *
 * `<table>` de verdad con `<th scope="col">`, no una rejilla de `<div>`: un
 * lector de pantalla anuncia entonces «columna Precio, fila 3» al moverse, que
 * es la diferencia entre poder leer los datos y oír una lista de números.
 *
 * El desbordamiento horizontal es del CONTENEDOR y no de la página: una tabla de
 * quince columnas en un móvil se desplaza dentro de su caja.
 */
function TableOutput({ output }: { output: NexBookTableOutput }) {
  const hidden = output.totalRows - output.rows.length;

  return (
    <div className="mt-2">
      <div className="max-h-80 overflow-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {output.columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  scope="col"
                  className="border-b border-line px-2 py-1 text-left font-medium whitespace-nowrap"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="even:bg-sunken">
                {output.columns.map((_, columnIndex) => (
                  <Cell key={columnIndex} value={row[columnIndex]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <p className="mt-1 text-label text-subtle">
          Se muestran {output.rows.length.toLocaleString('es-MX')} de{' '}
          {output.totalRows.toLocaleString('es-MX')} filas.
        </p>
      )}
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  // Los números a la derecha: es como se comparan de un vistazo dos cantidades
  // en una columna, y es lo que hace cualquier hoja de cálculo.
  const numeric = typeof value === 'number';
  const text =
    value === null || value === undefined
      ? '—'
      : typeof value === 'boolean'
        ? value
          ? 'sí'
          : 'no'
        : String(value);

  return (
    <td
      className={`border-b border-line px-2 py-1 ${numeric ? 'text-right tabular-nums' : ''} ${
        value === null || value === undefined ? 'text-subtle' : ''
      }`}
    >
      {text}
    </td>
  );
}

/**
 * Una imagen de salida.
 *
 * Mientras se sube al almacén se enseña con los bytes que todavía están en
 * memoria (`pending`), así que la gráfica aparece en cuanto termina de
 * ejecutarse y no cuando termina la red. Si la subida falló, `assetId` se queda
 * vacío y se dice: una imagen rota sin explicación haría pensar que el código no
 * dibujó nada.
 */
function ImageOutput({
  output,
  assetUrl,
  pending,
}: {
  output: NexBookImageOutput;
  assetUrl?: (assetId: string) => string;
  pending?: string;
}) {
  const source = pending
    ? `data:${output.mimeType};base64,${pending}`
    : output.assetId && assetUrl
      ? assetUrl(output.assetId)
      : null;

  if (!source) {
    return (
      <p className="mt-2 text-sm text-warning">
        La gráfica se generó pero no se pudo guardar. Vuelve a ejecutar la celda.
      </p>
    );
  }

  return (
    /*
      El tamaño lo decide el programa que la dibujó y la ruta es dinámica con
      permisos por petición: el optimizador de Next no puede con ninguna de las
      dos cosas.
    */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={output.alt || 'Gráfica generada por el código de esta celda'}
      width={output.width}
      height={output.height}
      className="mt-2 h-auto max-w-full rounded-sm border border-line bg-white"
      loading="lazy"
    />
  );
}

function JsonOutput({ output }: { output: NexBookJsonOutput }) {
  return (
    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-sm text-fg">
      {JSON.stringify(output.value, null, 2)}
    </pre>
  );
}
