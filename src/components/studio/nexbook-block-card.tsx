'use client';

import { useState } from 'react';
import { CodeEditor } from '@/components/aula/code-editor';
import { MarkdownContent } from '@/components/aula/markdown-content';
import { ENABLED_PROGRAMMING_LANGUAGES, languageCapabilities } from '@/lib/constants';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import type {
  NexBookBlock,
  NexBookCellResult,
  NexBookImageMimeType,
  ProgrammingLanguage,
} from '@/lib/types';
import { NexBookImage } from './nexbook-image';
import { NexBookOutputs } from './nexbook-outputs';
import { NexBookSheet } from './nexbook-sheet';

/**
 * Un bloque del documento.
 *
 * ## Markdown: escribir y ver son dos estados, no dos bloques
 *
 * Un bloque de Markdown alterna entre editarse y verse renderizado. Podría
 * haberse resuelto con vista partida, pero en una pantalla estrecha eso deja dos
 * columnas de 180 px y ninguna sirve. Alternar respeta el espacio y hace
 * evidente cuál es el estado actual.
 *
 * El renderizado va por `MarkdownContent`, que NO interpreta HTML crudo y pasa
 * las URLs por una lista blanca. Un documento que una docente reparte a treinta
 * personas no puede ejecutar el JavaScript de quien lo escribió.
 *
 * ## Bloques bloqueados
 *
 * `editableByStudent: false` llega de una plantilla docente. El bloque se
 * muestra, se puede ejecutar si es código, y no se puede editar. Esconderlo
 * sería peor: las instrucciones están ahí justamente para leerse.
 *
 * Una imagen no lo lleva: no hay nada que «editar parcialmente» en ella, y su
 * estado de sólo lectura sale de si el documento entero lo es.
 */

export interface NexBookBlockCardProps {
  block: NexBookBlock;
  index: number;
  total: number;
  result: NexBookCellResult | undefined;
  /** `false` en la vista docente de una entrega y en los bloques bloqueados. */
  editable: boolean;
  running: boolean;
  onChange: (block: NexBookBlock) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onRun: () => void;
  onClearResult: () => void;
  uploadAsset?: (file: File, contentType: NexBookImageMimeType) => Promise<string>;
  assetUrl?: (assetId: string, mimeType: NexBookImageMimeType) => string;
  /** Imágenes de la última ejecución que todavía no son assets. Clave: `seq`. */
  pendingImages?: Record<number, string>;
}

const BLOCK_LABEL: Record<NexBookBlock['type'], string> = {
  markdown: 'Texto',
  code: 'Código',
  image: 'Imagen',
  spreadsheet: 'Hoja de cálculo',
};

export function NexBookBlockCard({
  block,
  index,
  total,
  result,
  editable,
  running,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  onRun,
  onClearResult,
  uploadAsset,
  assetUrl,
  pendingImages,
}: NexBookBlockCardProps) {
  const [editingMarkdown, setEditingMarkdown] = useState(false);
  const label = BLOCK_LABEL[block.type];
  const locked = 'editableByStudent' in block && block.editableByStudent === false;
  const writable = editable && !locked;

  return (
    <section
      aria-label={`Bloque ${index + 1} de ${total}: ${label}`}
      className="rounded-sm border border-line bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="meta tabular-nums">{index + 1}</span>
        <span className="text-label text-subtle">{label}</span>

        {block.type === 'code' && writable && (
          <label className="ml-1 flex items-center gap-1.5">
            <span className="sr-only">Lenguaje del bloque {index + 1}</span>
            <select
              value={block.language}
              onChange={(event) =>
                onChange({ ...block, language: event.target.value as ProgrammingLanguage })
              }
              className="field h-7 w-auto py-0 text-label"
            >
              {ENABLED_PROGRAMMING_LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {block.type === 'code' && !writable && (
          <span className="text-label text-subtle">{block.language}</span>
        )}

        {block.type === 'spreadsheet' && writable && (
          <label className="ml-1 flex items-center gap-1.5">
            <span className="sr-only">Nombre de la hoja del bloque {index + 1}</span>
            <input
              value={block.name}
              onChange={(event) => onChange({ ...block, name: event.target.value })}
              maxLength={NEXBOOK_LIMITS.maxSheetNameChars}
              className="field h-7 w-32 py-0 text-label"
            />
          </label>
        )}
        {block.type === 'spreadsheet' && !writable && (
          <span className="text-label text-subtle">{block.name}</span>
        )}

        {locked && (
          <span className="text-label text-subtle" title="Lo escribió tu docente">
            · sólo lectura
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {block.type === 'markdown' && writable && (
            <button
              type="button"
              onClick={() => setEditingMarkdown((value) => !value)}
              className="btn btn-ghost btn-sm"
              aria-pressed={editingMarkdown}
            >
              {editingMarkdown ? 'Ver' : 'Editar'}
            </button>
          )}

          {block.type === 'code' && (
            <RunButton language={block.language} running={running} onRun={onRun} index={index} />
          )}

          {editable && (
            <>
              {/*
                Botones y no arrastrar: mover un bloque tiene que ser posible con
                el teclado, y un arrastre accesible es bastante más trabajo que
                lo que aporta en un documento de diez bloques.
              */}
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={index === 0}
                className="btn btn-ghost btn-sm"
                aria-label={`Mover el bloque ${index + 1} hacia arriba`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                className="btn btn-ghost btn-sm"
                aria-label={`Mover el bloque ${index + 1} hacia abajo`}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={onDuplicate}
                className="btn btn-ghost btn-sm"
                aria-label={`Duplicar el bloque ${index + 1}`}
                title="Duplicar"
              >
                ⧉
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="btn btn-ghost btn-sm"
                aria-label={`Eliminar el bloque ${index + 1}`}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </header>

      {block.type === 'markdown' &&
        (writable && editingMarkdown ? (
          <div className="p-3">
            <label className="sr-only" htmlFor={`md-${block.id}`}>
              Texto del bloque {index + 1}, en Markdown
            </label>
            <textarea
              id={`md-${block.id}`}
              value={block.source}
              maxLength={NEXBOOK_LIMITS.maxMarkdownChars}
              onChange={(event) => onChange({ ...block, source: event.target.value })}
              onBlur={() => setEditingMarkdown(false)}
              rows={Math.min(20, Math.max(4, block.source.split('\n').length + 1))}
              spellCheck
              autoFocus
              className="field font-mono text-sm"
            />
            <p className="hint">Markdown: # títulos, listas, tablas y enlaces.</p>
          </div>
        ) : (
          <div
            className="px-3 py-2"
            // Doble clic para editar es una comodidad ENCIMA del botón «Editar»,
            // no en lugar de él: quien navega con teclado usa el botón.
            onDoubleClick={writable ? () => setEditingMarkdown(true) : undefined}
          >
            {block.source.trim() ? (
              <MarkdownContent content={block.source} format="markdown" />
            ) : (
              <p className="text-sm text-subtle">Bloque de texto vacío.</p>
            )}
          </div>
        ))}

      {block.type === 'code' && (
        <div className="p-3">
          <CodeEditor
            language={block.language}
            value={block.source}
            onChange={writable ? (source) => onChange({ ...block, source }) : undefined}
            readOnly={!writable}
            // La ejecución la gobierna el kernel del documento, no el editor:
            // una celda tiene que ver lo que definió la anterior, y el botón del
            // editor ejecuta aislado.
            executionEnabled={false}
            height={Math.min(420, Math.max(120, block.source.split('\n').length * 20 + 40))}
            ariaLabel={`Código del bloque ${index + 1} en ${block.language}`}
          />
        </div>
      )}

      {block.type === 'image' && (
        <NexBookImage
          block={block}
          index={index}
          editable={writable}
          onChange={onChange}
          upload={uploadAsset}
          resolve={assetUrl}
        />
      )}

      {block.type === 'spreadsheet' && (
        <div className="p-3">
          <NexBookSheet
            sheet={block.sheet}
            name={block.name}
            editable={writable}
            onChange={(sheet) => onChange({ ...block, sheet })}
          />
        </div>
      )}

      {result && (
        <NexBookOutputs
          result={result}
          assetUrl={assetUrl ? (assetId) => assetUrl(assetId, 'image/png') : undefined}
          pendingImages={pendingImages}
          onClear={editable ? onClearResult : undefined}
        />
      )}
    </section>
  );
}

/**
 * El botón de ejecutar de una celda.
 *
 * Cuando el lenguaje no se ejecuta NO se pinta un botón muerto: se dice por qué.
 * Es la misma política que en el editor de actividades.
 */
function RunButton({
  language,
  running,
  onRun,
  index,
}: {
  language: ProgrammingLanguage;
  running: boolean;
  onRun: () => void;
  index: number;
}) {
  if (!languageCapabilities(language).browserExecution) {
    return (
      <span className="text-label text-subtle" title={`${language} no se ejecuta en UINexus`}>
        Ejecución no disponible
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running}
      className="btn btn-secondary btn-sm"
      aria-label={`Ejecutar el bloque ${index + 1}`}
      title="Ctrl + Enter"
    >
      {running ? '…' : '▶'}
    </button>
  );
}
