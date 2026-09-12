'use client';

import { useRef, useState } from 'react';
import { MarkdownContent } from '@/components/aula/markdown-content';
import { detectTextFormat, normalizeAIResult, safeMarkdownUrl } from '@/lib/ai-worklog';
import {
  AI_MODEL_SUGGESTIONS,
  AI_PROVIDERS,
  NEXBOOK_LIMITS,
} from '@/lib/constants';
import type {
  AIProvider,
  NexBookAIWorklogBlock,
  NexBookAIWorklogImage,
  NexBookConclusionMode,
  NexBookImageMimeType,
} from '@/lib/types';

/**
 * El bloque «Registrar uso de IA» (NexIA).
 *
 * ## Nextudio NO ejecuta la IA, y la interfaz lo dice
 *
 * No hay «Preguntar», ni «Enviar prompt», ni «Generar», ni una respuesta que
 * salga de aquí. Todos los campos son de LECTURA de lo que pasó fuera: qué
 * herramienta se usó, qué se le pidió, qué contestó, qué se aprovechó y qué se
 * descartó. El verbo de esta pantalla es «registrar», nunca «pedir». Ver
 * `docs/NEXTUDIO-ROADMAP.md` §D6.
 *
 * Por eso el campo del prompt dice «Prompt utilizado» en pasado y está junto a
 * la respuesta: los dos son evidencia de una conversación que ya ocurrió, no un
 * formulario que va a mandar nada a ningún sitio.
 *
 * ## Se agrupa como un relato, no como una tabla de base de datos
 *
 * Los once campos de `AIWorklogData` son muchos seguidos. Se reparten en cuatro
 * momentos —la herramienta, lo que se pidió, lo que contestó, lo que hizo la
 * persona con eso— porque es el orden en el que se recuerda una sesión de
 * trabajo, y porque así cada pregunta llega con contexto de la anterior.
 *
 * ## La conclusión REUTILIZA `studentAnalysis`
 *
 * `conclusionMode` sólo cambia si se pide y con qué énfasis. No hay un segundo
 * campo: ver `NexBookConclusionMode` en `lib/types.ts`.
 */

const ACCEPTED: readonly NexBookImageMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];

const CONCLUSION_LABEL: Readonly<Record<NexBookConclusionMode, string>> = {
  none: 'No solicitar',
  optional: 'Opcional',
  required: 'Obligatoria',
};

export interface NexBookWorklogProps {
  block: NexBookAIWorklogBlock;
  index: number;
  editable: boolean;
  onChange: (block: NexBookAIWorklogBlock) => void;
  /** Sube una captura y devuelve su id. Sin esto no se ofrecen imágenes. */
  upload?: (file: File, contentType: NexBookImageMimeType) => Promise<string>;
  /** La URL por la que se lee una captura ya guardada. */
  resolve?: (assetId: string, mimeType: NexBookImageMimeType) => string;
  /**
   * Modo plantilla docente.
   *
   * Es lo único que enseña el selector de «Conclusión del estudiante». Quien
   * rellena el registro no decide si su propia reflexión es obligatoria: eso lo
   * decide quien preparó la actividad, y el servidor lo comprueba contra la
   * PLANTILLA al entregar, no contra lo que mande el navegador.
   */
  templateMode?: boolean;
}

export function NexBookWorklog({
  block,
  index,
  editable,
  onChange,
  upload,
  resolve,
  templateMode = false,
}: NexBookWorklogProps) {
  const [preview, setPreview] = useState(false);

  if (!editable) {
    return <NexBookWorklogView block={block} assetUrl={resolve} />;
  }

  const worklog = block.worklog;
  const provider = (worklog.provider ?? 'Other') as AIProvider;
  const suggestions = AI_MODEL_SUGGESTIONS[provider] ?? [];
  const result = normalizeAIResult(worklog);
  const mode = block.conclusionMode ?? 'optional';

  const patch = (changes: Partial<NexBookAIWorklogBlock['worklog']>): void =>
    onChange({ ...block, worklog: { ...worklog, ...changes } });

  return (
    <div className="space-y-5 p-3">
      {/* Dice de una vez lo que la pantalla NO hace. Sin esto, un cuadro grande
          debajo de «Prompt utilizado» invita a escribir esperando respuesta. */}
      <p className="text-label text-subtle">
        Nextudio no ejecuta ninguna IA. Esto es el registro de lo que hiciste con una herramienta
        externa, para que quede trazable.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Herramienta</span>
          <select
            value={provider}
            onChange={(event) => patch({ provider: event.target.value as AIProvider })}
            className="field"
          >
            {AI_PROVIDERS.map((option) => (
              <option key={option} value={option}>
                {option === 'Other' ? 'Otra' : option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Modelo</span>
          <input
            list={`nexia-models-${block.id}`}
            value={worklog.model ?? ''}
            onChange={(event) => patch({ model: event.target.value })}
            placeholder={suggestions[0] ?? 'Si lo sabes'}
            maxLength={80}
            className="field"
          />
          <datalist id={`nexia-models-${block.id}`}>
            {suggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
      </div>

      <label className="block">
        <span className="label">Objetivo</span>
        <textarea
          rows={2}
          value={worklog.objective ?? ''}
          onChange={(event) => patch({ objective: event.target.value })}
          placeholder="¿Qué querías conseguir?"
          className="field"
        />
      </label>

      <label className="block">
        <span className="label">Prompt utilizado</span>
        <textarea
          rows={5}
          value={worklog.prompt ?? ''}
          onChange={(event) => patch({ prompt: event.target.value })}
          placeholder="Cópialo tal cual lo escribiste."
          className="field font-mono text-sm"
        />
      </label>

      <section className="rounded-sm border border-line p-3" aria-labelledby={`nexia-r-${block.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`nexia-r-${block.id}`} className="label m-0">
            Respuesta obtenida
          </h3>
          <div role="tablist" aria-label="Respuesta obtenida" className="tab-row">
            <button
              type="button"
              role="tab"
              aria-selected={!preview}
              onClick={() => setPreview(false)}
              className="btn btn-ghost btn-sm"
            >
              Editar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={preview}
              onClick={() => setPreview(true)}
              className="btn btn-ghost btn-sm"
            >
              Vista previa
            </button>
          </div>
        </div>

        {preview ? (
          <div className="mt-3 rounded-sm border border-line bg-sunken p-3">
            <MarkdownContent content={result.content} format={result.format} />
          </div>
        ) : (
          <textarea
            rows={8}
            aria-label="Respuesta obtenida"
            value={result.content}
            onChange={(event) => {
              const content = event.target.value;
              /**
               * Al escribir aquí, el texto pasa al campo canónico `result` y
               * `responseSummary` se vacía. Es lo mismo que hace el entregable
               * legacy: conservar las dos copias garantizaría que una de las dos
               * quedara desincronizada, y `normalizeAIResult` prefiere `result`.
               */
              onChange({
                ...block,
                worklog: {
                  ...worklog,
                  result: { content, format: detectTextFormat(content) },
                  responseSummary: '',
                },
              });
            }}
            className="field mt-3 font-mono text-sm"
          />
        )}

        <p className="hint">
          Pégala tal cual. Se conservan títulos, listas, tablas, enlaces y código ·{' '}
          {result.format === 'markdown' ? 'Markdown detectado' : 'texto plano'}
        </p>

        <WorklogImages
          block={block}
          editable
          onChange={onChange}
          upload={upload}
          resolve={resolve}
          index={index}
        />

        <label className="mt-4 block">
          <span className="label">Enlace a la conversación</span>
          <input
            type="url"
            value={worklog.conversationUrl ?? ''}
            onChange={(event) => patch({ conversationUrl: event.target.value })}
            placeholder="https://…"
            className="field"
          />
          <span className="hint">
            Opcional. No todos los servicios permiten compartir una conversación.
          </span>
        </label>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="label">¿Cómo la utilizaste?</span>
          <textarea
            rows={4}
            value={worklog.whatWasUsed ?? ''}
            onChange={(event) => patch({ whatWasUsed: event.target.value })}
            className="field"
          />
        </label>
        <label className="block">
          <span className="label">¿Qué cambiaste?</span>
          <textarea
            rows={4}
            value={worklog.whatWasChanged ?? ''}
            onChange={(event) => patch({ whatWasChanged: event.target.value })}
            className="field"
          />
        </label>
        <label className="block">
          <span className="label">¿Qué descartaste?</span>
          <textarea
            rows={4}
            value={worklog.whatWasDiscarded ?? ''}
            onChange={(event) => patch({ whatWasDiscarded: event.target.value })}
            className="field"
          />
        </label>
      </div>

      {/*
        Con `none` el campo no se pinta, y el valor que hubiera escrito antes NO
        se borra: cambiar de idea sobre si se pide una conclusión no puede
        destruir lo que alguien ya escribió.
      */}
      {mode !== 'none' && (
        <label className="block">
          <span className="label">
            Tu análisis
            {mode === 'required' && <span className="ml-1 text-danger">· obligatorio</span>}
          </span>
          <textarea
            rows={4}
            value={worklog.studentAnalysis ?? ''}
            onChange={(event) => patch({ studentAnalysis: event.target.value })}
            placeholder="Qué aprendiste, en qué se equivocó, qué decidiste tú."
            className="field"
          />
          {mode === 'required' && (
            <span className="hint">Hace falta para poder entregar la actividad.</span>
          )}
        </label>
      )}

      {templateMode && (
        <fieldset className="rounded-sm border border-line p-3">
          <legend className="label px-1">Conclusión del estudiante</legend>
          <p className="hint">
            Sólo tú ves esta opción. Decide si se pide una reflexión escrita y si hace falta para
            entregar.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            {(Object.keys(CONCLUSION_LABEL) as NexBookConclusionMode[]).map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`nexia-conclusion-${block.id}`}
                  checked={mode === option}
                  onChange={() => onChange({ ...block, conclusionMode: option })}
                />
                <span className="text-sm">{CONCLUSION_LABEL[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capturas de la respuesta
// ---------------------------------------------------------------------------

/**
 * Las imágenes del registro.
 *
 * Reutilizan el almacén de assets de NexBook sin excepción: el mismo `upload`
 * que ya usan `ImageBlock` y las gráficas de una ejecución, la misma lista de
 * MIME y el mismo límite de tamaño. No hay bucket nuevo, ni prefijo nuevo, ni
 * una segunda forma de autorizar: copiar un NexBook sigue sin duplicar bytes
 * porque las claves cuelgan de la persona y no del documento.
 */
function WorklogImages({
  block,
  editable,
  onChange,
  upload,
  resolve,
  index,
}: {
  block: NexBookAIWorklogBlock;
  editable: boolean;
  onChange: (block: NexBookAIWorklogBlock) => void;
  upload?: (file: File, contentType: NexBookImageMimeType) => Promise<string>;
  resolve?: (assetId: string, mimeType: NexBookImageMimeType) => string;
  index: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Vista previa local mientras la subida viaja. Clave: posición en la lista. */
  const [pending, setPending] = useState<string | null>(null);

  const images = block.responseImages ?? [];

  async function accept(file: File | null | undefined): Promise<void> {
    if (!file || !upload) return;

    if (images.length >= NEXBOOK_LIMITS.maxWorklogImages) {
      setError(`Este registro admite hasta ${NEXBOOK_LIMITS.maxWorklogImages} capturas.`);
      return;
    }
    if (!ACCEPTED.includes(file.type as NexBookImageMimeType)) {
      setError('La captura debe ser PNG, JPEG o WebP.');
      return;
    }
    if (file.size > NEXBOOK_LIMITS.maxAssetBytes) {
      setError(
        `La captura pesa demasiado: el límite son ${Math.round(NEXBOOK_LIMITS.maxAssetBytes / (1024 * 1024))} MB.`
      );
      return;
    }

    setError(null);
    setBusy(true);
    const local = URL.createObjectURL(file);
    setPending(local);

    try {
      const mimeType = file.type as NexBookImageMimeType;
      const assetId = await upload(file, mimeType);
      onChange({
        ...block,
        responseImages: [...images, { assetId, mimeType, alt: '' }],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo subir la captura.');
    } finally {
      setPending(null);
      URL.revokeObjectURL(local);
      setBusy(false);
      // Sin esto, volver a elegir EL MISMO archivo no dispara `change`.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function update(position: number, changes: Partial<NexBookAIWorklogImage>): void {
    onChange({
      ...block,
      responseImages: images.map((image, at) => (at === position ? { ...image, ...changes } : image)),
    });
  }

  function remove(position: number): void {
    const next = images.filter((_image, at) => at !== position);
    onChange({ ...block, responseImages: next.length ? next : undefined });
  }

  if (!editable && images.length === 0) return null;

  return (
    <div className="mt-4">
      {images.length > 0 && (
        <ul className="space-y-3">
          {images.map((image, position) => (
            <li key={image.assetId} className="rounded-sm border border-line p-2">
              <figure className="m-0">
                {resolve ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- Ruta
                     dinámica con permisos por petición. */
                  <img
                    src={resolve(image.assetId, image.mimeType)}
                    alt={image.alt}
                    width={image.width}
                    height={image.height}
                    className="h-auto max-w-full rounded-sm border border-line"
                    loading="lazy"
                  />
                ) : (
                  <p className="text-sm text-subtle">Captura {position + 1}</p>
                )}
                {image.caption && (
                  <figcaption className="mt-1 text-sm text-muted">{image.caption}</figcaption>
                )}
              </figure>

              {editable && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="text-label text-subtle">Texto alternativo</span>
                    <input
                      value={image.alt}
                      onChange={(event) => update(position, { alt: event.target.value })}
                      maxLength={400}
                      placeholder="Qué se ve en la captura"
                      className="field"
                    />
                  </label>
                  <label className="block">
                    <span className="text-label text-subtle">Pie (opcional)</span>
                    <input
                      value={image.caption ?? ''}
                      onChange={(event) =>
                        update(position, { caption: event.target.value || undefined })
                      }
                      maxLength={400}
                      className="field"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(position)}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Quitar la captura ${position + 1}`}
                  >
                    Quitar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pending && (
        /* eslint-disable-next-line @next/next/no-img-element -- Vista previa local. */
        <img src={pending} alt="" className="mt-2 h-auto max-w-full rounded-sm opacity-60" />
      )}

      {editable && upload && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || images.length >= NEXBOOK_LIMITS.maxWorklogImages}
            className="btn btn-ghost btn-sm"
          >
            {busy ? 'Subiendo…' : '+ Captura de la respuesta'}
          </button>
          <span className="text-label text-subtle">
            PNG, JPEG o WebP · hasta {NEXBOOK_LIMITS.maxWorklogImages}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            aria-label={`Captura de la respuesta del bloque ${index + 1}`}
            onChange={(event) => void accept(event.target.files?.[0])}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sólo lectura
// ---------------------------------------------------------------------------

/**
 * El registro, para leer.
 *
 * Lo usan la vista docente de una entrega, el bloque bloqueado por plantilla y
 * el lector de una publicación. Uno solo y no tres: un registro académico que se
 * viera distinto según quién lo abre dejaría de servir para comparar.
 *
 * ## Los campos vacíos NO se pintan
 *
 * Un registro donde sólo se rellenaron el prompt y la respuesta no puede
 * enseñarse como siete etiquetas seguidas con «(sin respuesta)» debajo. Se
 * enseña lo que hay; lo que falta, falta, y se ve porque no está.
 */
export function NexBookWorklogView({
  block,
  assetUrl,
}: {
  block: NexBookAIWorklogBlock;
  assetUrl?: (assetId: string, mimeType: NexBookImageMimeType) => string;
}) {
  const worklog = block.worklog;
  const result = normalizeAIResult(worklog);
  const images = block.responseImages ?? [];
  const link = safeMarkdownUrl(worklog.conversationUrl ?? '');
  const tool = [worklog.provider, worklog.model].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="text-label text-subtle">Registro de uso de IA</p>
        {tool && <p className="text-sm font-medium text-fg">{tool}</p>}
      </div>

      <Section title="Objetivo" value={worklog.objective} />

      {worklog.prompt?.trim() && (
        <section>
          <h4 className="label m-0">Prompt utilizado</h4>
          <pre className="mt-1 overflow-x-auto rounded-sm bg-sunken p-3 font-mono text-sm whitespace-pre-wrap">
            {worklog.prompt}
          </pre>
        </section>
      )}

      {result.content.trim() && (
        <section>
          <h4 className="label m-0">Respuesta obtenida</h4>
          <div className="mt-1 rounded-sm border border-line p-3">
            <MarkdownContent content={result.content} format={result.format} />
          </div>
        </section>
      )}

      {images.length > 0 && (
        <section>
          <h4 className="label m-0">Capturas de la respuesta</h4>
          <ul className="mt-1 space-y-2">
            {images.map((image) => (
              <li key={image.assetId}>
                <figure className="m-0">
                  {assetUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- Ruta
                       dinámica con permisos por petición. */
                    <img
                      src={assetUrl(image.assetId, image.mimeType)}
                      alt={image.alt}
                      width={image.width}
                      height={image.height}
                      className="h-auto max-w-full rounded-sm border border-line"
                      loading="lazy"
                    />
                  ) : (
                    /*
                      Sin forma de resolver el asset —hoy, la vista docente de un
                      snapshot, que no tiene ruta autorizada para leer las
                      imágenes de otra persona— se dice que la captura existe y
                      no se puede pintar AQUÍ. Callarlo haría parecer que el
                      registro no llevaba ninguna. Ver `docs/LIMITATIONS.md`.
                    */
                    <p className="text-sm text-subtle">
                      {image.alt ? `Captura: ${image.alt}` : 'Captura adjunta'} · no se puede
                      mostrar en esta vista
                    </p>
                  )}
                  {image.caption && (
                    <figcaption className="mt-1 text-sm text-muted">{image.caption}</figcaption>
                  )}
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}

      {link && (
        <p className="text-sm">
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="text-accent">
            Ver la conversación ↗
          </a>
        </p>
      )}

      <Section title="Cómo la utilizó" value={worklog.whatWasUsed} />
      <Section title="Qué cambió" value={worklog.whatWasChanged} />
      <Section title="Qué descartó" value={worklog.whatWasDiscarded} />
      <Section title="Análisis" value={worklog.studentAnalysis} />

      {/* Sólo cuando se pidió y no se escribió: es la única combinación en la
          que la ausencia significa algo para quien revisa. */}
      {block.conclusionMode === 'required' && !worklog.studentAnalysis?.trim() && (
        <p className="text-sm text-danger">La actividad pide un análisis y está sin escribir.</p>
      )}
    </div>
  );
}

function Section({ title, value }: { title: string; value: string | undefined }) {
  if (!value?.trim()) return null;
  return (
    <section>
      <h4 className="label m-0">{title}</h4>
      <p className="mt-1 max-w-prose whitespace-pre-wrap text-muted">{value}</p>
    </section>
  );
}
