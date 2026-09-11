'use client';

import { MarkdownContent } from '@/components/aula/markdown-content';
import { evaluateSheet, formatValue, isFormulaError } from '@/lib/spreadsheet/formula';
import { cellKey, columnName } from '@/lib/spreadsheet/cells';
import type { NexBookBlock, NexBookDocument, NexBookSheetData } from '@/lib/types';
import { NexBookOutputs } from './nexbook-outputs';

/**
 * Un NexBook en modo LECTURA.
 *
 * ## Por qué no es Studio con `editable: false`
 *
 * Porque Studio arrastra el kernel, Monaco y todo lo que hace falta para
 * ejecutar, y aquí nada de eso puede cargarse. Abrir una publicación no puede
 * costar 13 MB de Pyodide ni 46 MB de webR: quien la abre viene de un enlace y
 * sólo quiere leer.
 *
 * El código se pinta con `<pre>` y resaltado nulo en vez de con Monaco por la
 * misma razón: Monaco son cientos de kilobytes de editor para enseñar algo que
 * nadie va a editar.
 *
 * ```
 * Studio    editar + ejecutar    kernel, Monaco, autoguardado
 * Reader    leer                 nada de eso
 * ```
 *
 * ## No hay botón de ejecutar, y no es un olvido
 *
 * Se enseñan los resultados que el autor guardó, con su fecha. Ofrecer
 * «ejecutar» aquí significaría descargar un runtime en el navegador de cualquiera
 * que abra un enlace; el día que exista, será una acción explícita.
 */

export interface NexBookReaderProps {
  document: NexBookDocument;
  /** Cómo se resuelve la URL de una imagen en ESTE contexto. */
  assetUrl: (assetId: string) => string;
}

export function NexBookReader({ document: doc, assetUrl }: NexBookReaderProps) {
  return (
    <div className="space-y-4">
      {doc.blocks.map((block) => (
        <section key={block.id} className="rounded-sm border border-line bg-surface">
          <ReaderBlock block={block} assetUrl={assetUrl} />
          {doc.results[block.id] && (
            <NexBookOutputs result={doc.results[block.id]!} assetUrl={assetUrl} />
          )}
        </section>
      ))}
    </div>
  );
}

function ReaderBlock({
  block,
  assetUrl,
}: {
  block: NexBookBlock;
  assetUrl: (assetId: string) => string;
}) {
  switch (block.type) {
    case 'markdown':
      return (
        <div className="px-3 py-2">
          {/* El mismo renderizador sanitizado que el resto: sin HTML crudo y con
              las URLs por lista blanca. Una publicación la abre cualquiera. */}
          <MarkdownContent content={block.source} format="markdown" />
        </div>
      );

    case 'code':
      return (
        <div className="p-3">
          <div className="mb-1 text-label text-subtle">{block.language}</div>
          <pre className="overflow-x-auto rounded-sm bg-sunken p-3 font-mono text-sm">
            <code>{block.source}</code>
          </pre>
        </div>
      );

    case 'image':
      return (
        <figure className="m-0 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- Ruta dinámica
              con permisos por petición. */}
          <img
            src={assetUrl(block.assetId)}
            alt={block.alt}
            width={block.width}
            height={block.height}
            className="h-auto max-w-full rounded-sm border border-line"
            loading="lazy"
          />
          {block.caption && (
            <figcaption className="mt-1 text-sm text-muted">{block.caption}</figcaption>
          )}
        </figure>
      );

    default:
      return (
        <div className="p-3">
          <div className="mb-1 text-label text-subtle">{block.name}</div>
          <ReadOnlySheet sheet={block.sheet} name={block.name} />
        </div>
      );
  }
}

/**
 * La hoja, ya calculada y sin campos de edición.
 *
 * Se recalculan las fórmulas al pintar en vez de guardar los resultados: es lo
 * que hace que lo publicado siga siendo coherente con los datos que se
 * publicaron, y evita almacenar dos veces la misma información.
 */
function ReadOnlySheet({ sheet, name }: { sheet: NexBookSheetData; name: string }) {
  const values = evaluateSheet(sheet);

  return (
    <div className="max-h-96 overflow-auto rounded-sm border border-line">
      <table className="border-collapse text-sm">
        <caption className="sr-only">Hoja de cálculo {name}.</caption>
        <thead>
          <tr>
            <th scope="col" className="bg-surface px-1">
              <span className="sr-only">Número de fila</span>
            </th>
            {Array.from({ length: sheet.columns }, (_, column) => (
              <th
                key={column}
                scope="col"
                className="border border-line bg-surface px-2 py-1 text-label font-medium text-subtle"
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
                className="border border-line bg-surface px-2 py-1 text-label font-normal text-subtle tabular-nums"
              >
                {row + 1}
              </th>
              {Array.from({ length: sheet.columns }, (_, column) => {
                const value = values.get(cellKey(row, column)) ?? null;
                const error = isFormulaError(value);
                return (
                  <td
                    key={column}
                    className={`min-w-24 border border-line px-2 py-1 ${
                      error
                        ? 'text-danger'
                        : typeof value === 'number'
                          ? 'text-right tabular-nums'
                          : ''
                    }`}
                  >
                    {formatValue(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
