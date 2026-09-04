'use client';

import { useState } from 'react';
import { createPrompt, useApi, type CourseLibrary } from '@/lib/aula-client';
import { ACADEMIC_LIMITS } from '@/lib/constants';
import {
  PROMPT_FORMATS,
  buildPrompt,
  suggestPromptDraft,
  type PromptContext,
  type PromptDraft,
} from '@/lib/prompt-generator';
import type { StepPrompt } from '@/lib/types';
import { Field, Notice } from './aula-ui';
import { CopyButton } from './copy-button';

/**
 * El prompt de un paso (P0).
 *
 * ## El problema que cierra
 *
 * Hasta ahora, un paso que necesitaba un prompt sólo podía APUNTAR a uno de la
 * biblioteca. En la práctica eso obligaba a dar de alta un recurso antes de
 * poder crear la actividad, aunque el prompt sólo tuviera sentido para ella. La
 * biblioteca es reutilización, no un requisito.
 *
 * ## Las tres formas, y ninguna manda sobre las otras
 *
 *  · **Escribir aquí** es lo predeterminado. El prompt vive en la actividad.
 *  · **Elegir de biblioteca** reutiliza un prompt aprobado de la materia. Se
 *    guarda la referencia, no una copia, para que corregirlo lo corrija en
 *    todas partes.
 *  · **Generar** compone uno con lo que la actividad ya dice y lo deja escrito
 *    aquí, editable.
 *
 * ## Por qué nada de esto navega
 *
 * Todo ocurre DENTRO del editor: la biblioteca se lista aquí y el generador se
 * abre como diálogo montado en este mismo árbol. El borrador de la actividad
 * —título, pasos, instrucciones, recursos, fecha— es estado de React vivo, y
 * navegar a otra pantalla lo desmontaría. Por eso no hay ninguna ruta nueva.
 */

type Tab = 'inline' | 'library' | 'generate';

const EMPTY: StepPrompt = { mode: 'none', title: '', text: '', resourceId: null };

export function StepPromptField({
  courseId,
  prompt,
  context,
  onChange,
}: {
  courseId: string;
  prompt: StepPrompt | undefined;
  context: PromptContext;
  onChange: (prompt: StepPrompt) => void;
}) {
  const value = prompt ?? EMPTY;

  /**
   * La pestaña es estado de INTERFAZ, no del modelo. Cambiar de pestaña no
   * borra nada: el texto escrito y el recurso elegido siguen en el paso, así
   * que se puede ir a la biblioteca, mirar, y volver a lo que había escrito.
   */
  const [tab, setTab] = useState<Tab>(value.mode === 'library' ? 'library' : 'inline');
  const [generating, setGenerating] = useState(false);

  const patch = (changes: Partial<StepPrompt>) => onChange({ ...value, ...changes });

  return (
    <fieldset>
      <legend className="label">Prompt</legend>
      <p className="hint">
        Escríbelo aquí si es de esta actividad. La biblioteca sirve para reutilizar, no es un
        requisito.
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            ['inline', 'Escribir aquí'],
            ['library', 'Elegir de biblioteca'],
            ['generate', 'Generar prompt'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              if (id === 'generate') {
                setGenerating(true);
                return;
              }
              /**
               * El modo del paso sigue a la pestaña sólo cuando hay contenido
               * para ese modo. Así, asomarse a la biblioteca sin elegir nada no
               * desactiva el prompt que ya estaba escrito.
               */
              if (id === 'inline' && value.text.trim()) patch({ mode: 'inline' });
              if (id === 'library' && value.resourceId) patch({ mode: 'library' });
            }}
            className="chip"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'inline' && (
        <InlinePrompt courseId={courseId} value={value} onChange={onChange} />
      )}

      {tab === 'library' && (
        <LibraryPrompt courseId={courseId} value={value} onChange={onChange} />
      )}

      {generating && (
        <PromptGeneratorDialog
          context={context}
          onCancel={() => {
            setGenerating(false);
            setTab(value.mode === 'library' ? 'library' : 'inline');
          }}
          onUse={(text) => {
            /**
             * El resultado entra en el paso que se estaba editando, escrito y
             * editable. No crea recurso: guardarlo en la biblioteca sigue
             * siendo una decisión aparte.
             */
            onChange({ ...value, mode: 'inline', text, resourceId: null });
            setGenerating(false);
            setTab('inline');
          }}
        />
      )}

      {value.mode === 'none' && <p className="hint mt-2">Este paso no usa prompt todavía.</p>}
    </fieldset>
  );
}

/** Escribir el prompt dentro de la actividad. Es lo predeterminado. */
function InlinePrompt({
  courseId,
  value,
  onChange,
}: {
  courseId: string;
  value: StepPrompt;
  onChange: (prompt: StepPrompt) => void;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <div className="mt-3 space-y-3">
      <textarea
        rows={6}
        value={value.text}
        maxLength={ACADEMIC_LIMITS.promptMax}
        onChange={(event) =>
          onChange({
            ...value,
            text: event.target.value,
            // Escribir ES elegir «escrito aquí»: no hay que marcar nada más.
            mode: event.target.value.trim() ? 'inline' : 'none',
            // Un texto propio deja de ser el recurso del que salió.
            resourceId: event.target.value.trim() ? value.resourceId : null,
          })
        }
        placeholder={
          'Analiza esta interfaz utilizando las heurísticas de Nielsen.\nIdentifica tres problemas de usabilidad y propone una mejora para cada uno.'
        }
        className="field font-mono text-sm"
      />

      {value.mode === 'inline' && (
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={value.text} label="Copiar" variant="ghost" />
          {!saving && (
            <button
              type="button"
              onClick={() => setSaving(true)}
              className="btn btn-ghost btn-sm"
            >
              Guardar en biblioteca
            </button>
          )}
          {value.resourceId && (
            <span className="text-label text-subtle">Guardado en la biblioteca.</span>
          )}
        </div>
      )}

      {saving && (
        <SaveToLibrary
          courseId={courseId}
          text={value.text}
          title={value.title}
          onCancel={() => setSaving(false)}
          onSaved={(created) => {
            /**
             * Guardar en la biblioteca NO cambia el modo del paso: el prompt
             * sigue siendo el de esta actividad y se puede seguir editando sin
             * tocar el recurso. El id sólo deja constancia de dónde se guardó.
             */
            onChange({ ...value, title: created.title, resourceId: created.id });
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Guardar el prompt escrito como recurso de la materia.
 *
 * Es OPCIONAL en el sentido fuerte: no bloquea publicar, y si el guardado falla
 * la actividad sigue siendo publicable con su prompt escrito.
 */
function SaveToLibrary({
  courseId,
  text,
  title,
  onCancel,
  onSaved,
}: {
  courseId: string;
  text: string;
  title: string;
  onCancel: () => void;
  onSaved: (created: { id: string; title: string }) => void;
}) {
  const [name, setName] = useState(title);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await createPrompt(courseId, {
        title: name,
        description,
        prompt: text,
        recommendedProvider: null,
        recommendedModel: null,
      });
      onSaved({ id: created.prompt.id, title: created.prompt.title });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar en la biblioteca.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-sm border border-line bg-sunken p-3">
      <Field label="Título del prompt" hint="Con esto lo encontrarás la próxima vez.">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Evaluación heurística"
          className="field"
        />
      </Field>

      <Field label="Para qué sirve" hint="Opcional.">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Para analizar una interfaz según las heurísticas de Nielsen."
          className="field"
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || name.trim().length < 3}
          onClick={() => void save()}
          className="btn btn-secondary btn-sm"
        >
          {busy ? 'Guardando…' : 'Guardar en biblioteca'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Ahora no
        </button>
      </div>
      <p className="hint">
        Publicar la actividad no depende de esto. El prompt ya está en el paso.
      </p>
    </div>
  );
}

/** Elegir un prompt aprobado de la materia. Se guarda la referencia, no una copia. */
function LibraryPrompt({
  courseId,
  value,
  onChange,
}: {
  courseId: string;
  value: StepPrompt;
  onChange: (prompt: StepPrompt) => void;
}) {
  const [query, setQuery] = useState('');
  const library = useApi<CourseLibrary>(`/api/courses/${courseId}/library`);

  const approved = (library.data?.prompts ?? []).filter((item) => item.status === 'approved');
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? approved.filter((item) =>
        `${item.title} ${item.description}`.toLowerCase().includes(needle)
      )
    : approved;

  return (
    <div className="mt-3 space-y-3">
      <label className="block">
        <span className="sr-only">Buscar un prompt</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar en la biblioteca…"
          className="field"
        />
      </label>

      {library.state === 'loading' && (
        <p className="text-sm text-muted">Cargando la biblioteca…</p>
      )}

      {library.state === 'ready' && approved.length === 0 && (
        <Notice>
          Todavía no hay prompts en esta materia. Escribe el tuyo en «Escribir aquí»: no hace falta
          que exista en la biblioteca.
        </Notice>
      )}

      {matches.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-sm border border-line p-2">
          {matches.map((item) => {
            const chosen = value.mode === 'library' && value.resourceId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() =>
                    onChange(
                      chosen
                        ? { ...value, mode: 'none', resourceId: null }
                        : { ...value, mode: 'library', resourceId: item.id, title: item.title }
                    )
                  }
                  className={`w-full rounded-sm p-2 text-left ${
                    chosen ? 'bg-accent-soft text-accent' : 'hover:bg-sunken'
                  }`}
                >
                  <span className="block text-sm font-medium">{item.title}</span>
                  {item.description && (
                    <span className="block text-sm text-muted">{item.description}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {value.mode === 'library' && (
        <p className="text-sm text-muted">
          Este paso usa «{value.title || 'un prompt de la biblioteca'}». Si lo corriges en la
          biblioteca, se corrige aquí.
        </p>
      )}

      {value.mode === 'library' && value.text.trim() && (
        <p className="hint">
          Tu prompt escrito sigue guardado. Vuelve a «Escribir aquí» para usarlo.
        </p>
      )}
    </div>
  );
}

/**
 * El generador, como diálogo dentro del editor.
 *
 * No es una página: montarlo aquí es lo que garantiza que el borrador de la
 * actividad siga vivo al volver. Compone el prompt con `lib/prompt-generator`,
 * que es una función pura —sin servicios externos— y por eso se puede probar
 * sola.
 */
function PromptGeneratorDialog({
  context,
  onUse,
  onCancel,
}: {
  context: PromptContext;
  onUse: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PromptDraft>(() => suggestPromptDraft(context));
  const preview = buildPrompt(draft);

  const patch = (changes: Partial<PromptDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generar un prompt"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
    >
      <div className="panel my-8 w-full max-w-2xl space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-h3">Generar un prompt</h3>
            <p className="mt-1 text-sm text-muted">
              Se compone con lo que ya dice la actividad. Puedes editarlo después.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
            Cerrar
          </button>
        </div>

        <Field label="Qué debe hacer la IA" hint="Es lo único imprescindible.">
          <textarea
            rows={3}
            value={draft.task}
            onChange={(event) => patch({ task: event.target.value })}
            placeholder="Identifica tres problemas de usabilidad y propón una mejora para cada uno."
            className="field"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Papel" hint="Opcional.">
            <input
              value={draft.role}
              onChange={(event) => patch({ role: event.target.value })}
              placeholder="especialista en experiencia de usuario"
              className="field"
            />
          </Field>

          <Field label="Formato de la respuesta">
            <select
              value={draft.format}
              onChange={(event) => patch({ format: event.target.value as PromptDraft['format'] })}
              className="field"
            >
              {PROMPT_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Contexto" hint="Sobre qué trabaja. Viene del objetivo de la actividad.">
          <textarea
            rows={2}
            value={draft.context}
            onChange={(event) => patch({ context: event.target.value })}
            className="field"
          />
        </Field>

        <Field label="Límites" hint="Opcional. Lo que NO debe hacer, o qué debe citar.">
          <input
            value={draft.constraints}
            onChange={(event) => patch({ constraints: event.target.value })}
            placeholder="No inventes fuentes. Cita la heurística concreta."
            className="field"
          />
        </Field>

        <div>
          <p className="label">Así queda</p>
          <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-sm border border-line bg-sunken p-3 font-mono text-sm">
            {preview || 'Escribe qué debe hacer la IA para ver el prompt.'}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button
            type="button"
            disabled={!preview.trim()}
            onClick={() => onUse(preview)}
            className="btn btn-primary"
          >
            Usar este prompt
          </button>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
