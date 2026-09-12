'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  ACADEMIC_LIMITS,
  ACADEMIC_FILE_LIMITS,
  FILE_CLASS_BY_DELIVERABLE,
  LEGACY_CODE_MODE,
  acceptAttributeFor,
  fileLimitLabel,
  programmingLanguageLabel,
} from '@/lib/constants';
import { allowedExtensionsFor, resolveAcademicUpload } from '@/lib/academic-files';
import {
  academicFileUrl,
  downloadText,
  openSignedUrl,
  uploadAcademicFile,
} from '@/lib/aula-client';
import { aiWorklogToMarkdown, detectTextFormat, normalizeAIResult } from '@/lib/ai-worklog';
import { AI_MODEL_SUGGESTIONS, AI_PROVIDERS, LINK_PROVIDERS } from '@/lib/constants';
import type { AssignmentDetail } from '@/lib/aula-client';
import { useMyProjects } from '@/lib/use-my-projects';
import { publicProjectPath } from '@/lib/urls';
import type {
  AcademicFileClass,
  AIProvider,
  AIWorklogData,
  CodeData,
  CodeMode,
  ExternalLinkData,
  FreeformData,
  MediaData,
  NexBookConclusionMode,
  ProgrammingLanguage,
  ResearchData,
  ResourceRef,
  WebProjectData,
} from '@/lib/types';
import { Field, Notice } from './aula-ui';
import { CopyButton } from './copy-button';
import { LinkCard } from './link-card';
import { MarkdownContent } from './markdown-content';
import { CodeEditor, sourceFilenameFor } from './code-editor';

/**
 * Los formularios de cada tipo de entregable.
 *
 * Viven aparte desde la iteración 4 porque ahora los usan DOS pantallas: la
 * entrega de una tarea de un solo paso y la de cada paso de un workflow. Son
 * los mismos campos en ambos casos —un AI Worklog es igual sea la tarea entera
 * o el paso 2 de cuatro (§25)—, así que duplicarlos habría garantizado que se
 * separaran con el tiempo.
 *
 * Cada componente recibe su `data` y un `onChange` que fusiona cambios. No
 * saben nada de pasos ni de entregas: eso lo decide quien los coloca.
 */

// ---------------------------------------------------------------------------
// Investigación estructurada (§9)
// ---------------------------------------------------------------------------

export function ResearchFields({
  questions: allQuestions,
  only,
  data,
  onChange,
}: {
  questions: AssignmentDetail['assignment']['researchQuestions'];
  /** Conceptos que puede responder. `null` = todos (modo individual). */
  only: Set<string> | null;
  data: ResearchData;
  onChange: (answers: { questionId: string; value: string }[]) => void;
}) {
  const questions = only
    ? allQuestions.filter((question) => only.has(question.groupId))
    : allQuestions;
  const answers = data.answers ?? [];
  const valueOf = (id: string) => answers.find((answer) => answer.questionId === id)?.value ?? '';

  function set(id: string, value: string): void {
    const others = answers.filter((answer) => answer.questionId !== id);
    onChange([...others, { questionId: id, value }]);
  }

  // Los campos se agrupan por concepto para que la pantalla se lea igual que la
  // tarea original: «Card sorting» y debajo sus tres huecos.
  const groups: { name: string | null; items: typeof questions }[] = [];
  for (const question of questions) {
    const last = groups[groups.length - 1];
    if (last && last.name === question.group) last.items.push(question);
    else groups.push({ name: question.group, items: [question] });
  }

  if (questions.length === 0) {
    return (
      <Notice>
        {only
          ? 'No tienes conceptos asignados en esta actividad. Habla con tu docente si crees que es un error.'
          : 'Esta tarea todavía no tiene campos definidos. Avisa a tu docente.'}
      </Notice>
    );
  }

  return (
    <>
      {groups.map((group, index) => (
        <section key={`${group.name ?? 'suelto'}-${index}`} className="panel p-5">
          {group.name && <h2 className="font-display text-h3">{group.name}</h2>}
          <div className="mt-4 space-y-4">
            {group.items.map((question) => (
              <Field
                key={question.id}
                label={`${question.prompt}${question.required ? ' *' : ''}`}
                hint={question.type === 'url' ? 'Pega la dirección completa.' : undefined}
              >
                {question.type === 'long_text' ? (
                  <textarea
                    rows={4}
                    required={question.required}
                    value={valueOf(question.id)}
                    onChange={(event) => set(question.id, event.target.value)}
                    className="field"
                  />
                ) : (
                  <input
                    type={question.type === 'url' ? 'url' : 'text'}
                    required={question.required}
                    value={valueOf(question.id)}
                    onChange={(event) => set(question.id, event.target.value)}
                    className="field"
                  />
                )}
              </Field>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// AI Worklog (§7)
// ---------------------------------------------------------------------------

export function WorklogFields({
  data,
  onChange,
  resources,
  conclusionMode = 'optional',
}: {
  data: AIWorklogData;
  onChange: (changes: Record<string, unknown>) => void;
  resources: AssignmentDetail['resources'];
  /**
   * Qué hace la actividad con la conclusión del estudiante.
   *
   * Ausente significa `optional`, que es lo que hacían las entregas guardadas
   * antes de que la política existiera: se ofrecía el espacio y no se exigía.
   */
  conclusionMode?: NexBookConclusionMode;
}) {
  const provider = (data.provider ?? 'Claude') as AIProvider;
  const suggestions = AI_MODEL_SUGGESTIONS[provider] ?? [];
  const used = data.resourcesUsed ?? [];
  const result = normalizeAIResult(data);
  const [resultMode, setResultMode] = useState<'edit' | 'preview'>('edit');

  const toggleResource = (kind: ResourceRef['kind'], id: string) => {
    const has = used.some((ref) => ref.kind === kind && ref.id === id);
    onChange({
      resourcesUsed: has
        ? used.filter((ref) => !(ref.kind === kind && ref.id === id))
        : [...used, { kind, id }],
    });
  };

  return (
    <div className="space-y-5">
      {resources.prompts.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-display text-h3">Prompt sugerido por tu docente</h2>
          <p className="mt-1 text-sm text-muted">
            Puedes usarlo tal cual o adaptarlo. Lo que escribas abajo en «Prompt utilizado» es lo
            que de verdad usaste, y no tiene por qué ser igual.
          </p>
          <ul className="mt-4 space-y-4">
            {resources.prompts.map((prompt) => (
              <li key={prompt.id}>
                <p className="text-sm font-medium">{prompt.title}</p>
                <pre className="mt-2 max-h-40 overflow-y-auto rounded-sm border border-line bg-sunken p-3 font-mono text-sm whitespace-pre-wrap">
                  {prompt.prompt}
                </pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton value={prompt.prompt} label="Copiar prompt" />
                  <button
                    type="button"
                    onClick={() => onChange({ prompt: prompt.prompt })}
                    className="btn btn-ghost btn-sm"
                  >
                    Usarlo como punto de partida
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resources.skills.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-display text-h3">Skills recomendadas</h2>
          <ul className="mt-3 space-y-2">
            {resources.skills.map((skill) => (
              <li key={skill.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{skill.title}</span>
                  {skill.compatibleTools.length > 0 && (
                    <span className="block text-label text-subtle">
                      {skill.compatibleTools.join(' · ')}
                    </span>
                  )}
                </span>
                {skill.repositoryUrl && (
                  <a
                    href={skill.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    Repositorio ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Herramienta">
          <select
            value={provider}
            onChange={(event) => onChange({ provider: event.target.value })}
            className="field"
          >
            {AI_PROVIDERS.map((option) => (
              <option key={option} value={option}>
                {option === 'Other' ? 'Otra' : option}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Modelo" hint="Si lo sabes. Puedes escribirlo a mano.">
          <input
            list="ai-model-suggestions"
            value={data.model ?? ''}
            onChange={(event) => onChange({ model: event.target.value })}
            placeholder={suggestions[0] ?? 'Nombre del modelo'}
            className="field"
          />
          <datalist id="ai-model-suggestions">
            {suggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Objetivo" hint="Qué querías conseguir con la IA.">
        <textarea
          rows={2}
          value={data.objective ?? ''}
          onChange={(event) => onChange({ objective: event.target.value })}
          className="field"
        />
      </Field>

      <Field label="Prompt utilizado" hint="Cópialo tal cual lo escribiste.">
        <textarea
          rows={6}
          value={data.prompt ?? ''}
          onChange={(event) => onChange({ prompt: event.target.value })}
          className="field font-mono text-sm"
        />
      </Field>

      <Field
        label="Enlace a la conversación"
        hint="Opcional. No todos los servicios permiten compartir conversaciones."
      >
        <input
          type="url"
          value={data.conversationUrl ?? ''}
          onChange={(event) => onChange({ conversationUrl: event.target.value })}
          placeholder="https://…"
          className="field"
        />
      </Field>

      <section className="panel p-4" aria-labelledby="resultado-ia">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="resultado-ia" className="font-display text-h3">
              Resultado de la IA
            </h2>
            <p className="hint">
              Pégalo tal cual. Se conservan títulos, listas, tablas, enlaces y código.
            </p>
          </div>
          <div role="tablist" aria-label="Resultado de la IA" className="tab-row">
            <button
              type="button"
              role="tab"
              aria-selected={resultMode === 'edit'}
              onClick={() => setResultMode('edit')}
              className="btn btn-ghost btn-sm"
            >
              Editar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={resultMode === 'preview'}
              onClick={() => setResultMode('preview')}
              className="btn btn-ghost btn-sm"
            >
              Vista previa
            </button>
          </div>
        </div>

        {resultMode === 'edit' ? (
          <textarea
            rows={12}
            aria-label="Resultado de la IA"
            value={result.content}
            onChange={(event) => {
              const content = event.target.value;
              onChange({
                result: { content, format: detectTextFormat(content) },
                // Al editar un registro legacy, el texto pasa al campo
                // canónico sin conservar una segunda copia desincronizable.
                responseSummary: '',
              });
            }}
            className="field mt-4 font-mono text-sm"
          />
        ) : (
          <div className="mt-4 rounded-sm border border-line bg-surface p-4">
            <MarkdownContent content={result.content} format={result.format} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton value={result.content} label="Copiar resultado" />
          <CopyButton value={aiWorklogToMarkdown(data)} label="Copiar AI Worklog" variant="ghost" />
          <span className="text-label text-subtle">
            {result.format === 'markdown' ? 'Markdown detectado' : 'Texto plano'}
          </span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="¿Qué utilizaste?">
          <textarea
            rows={4}
            value={data.whatWasUsed ?? ''}
            onChange={(event) => onChange({ whatWasUsed: event.target.value })}
            className="field"
          />
        </Field>
        <Field label="¿Qué modificaste?">
          <textarea
            rows={4}
            value={data.whatWasChanged ?? ''}
            onChange={(event) => onChange({ whatWasChanged: event.target.value })}
            className="field"
          />
        </Field>
        <Field label="¿Qué descartaste?">
          <textarea
            rows={4}
            value={data.whatWasDiscarded ?? ''}
            onChange={(event) => onChange({ whatWasDiscarded: event.target.value })}
            className="field"
          />
        </Field>
      </div>

      {/*
        La conclusión, con la política que puso la docente en esta parte.

        `none` la quita de la pantalla: pedirla «por si acaso» y no mirarla
        nunca es lo que enseña a rellenar campos sin pensar. `required` se dice
        ANTES, no al chocar con el botón de entregar. Quien la hace cumplir es
        el servidor, que la lee de la definición de la actividad y no de lo que
        manda el navegador.
      */}
      {conclusionMode !== 'none' && (
        <Field
          label={conclusionMode === 'required' ? 'Tu conclusión (requerida)' : 'Tu conclusión'}
          hint={
            conclusionMode === 'required'
              ? 'Qué aprendiste, en qué se equivocó la IA, qué decidiste tú. Esta actividad la pide para poder entregar.'
              : 'Opcional. Qué aprendiste, en qué se equivocó la IA, qué decidiste tú.'
          }
        >
          <textarea
            rows={4}
            required={conclusionMode === 'required'}
            value={data.studentAnalysis ?? ''}
            onChange={(event) => onChange({ studentAnalysis: event.target.value })}
            className="field"
          />
        </Field>
      )}

      {(resources.prompts.length > 0 || resources.skills.length > 0) && (
        <fieldset>
          <legend className="label">Recursos que utilizaste</legend>
          <p className="hint">
            Opcional. Sirve para que quede registrado junto al prompt y al modelo.
          </p>
          <ul className="mt-2 space-y-1">
            {resources.skills.map((skill) => (
              <li key={`skill-${skill.id}`}>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={used.some((ref) => ref.kind === 'skill' && ref.id === skill.id)}
                    onChange={() => toggleResource('skill', skill.id)}
                  />
                  <span className="text-sm">{skill.title}</span>
                  <span className="text-label text-subtle">Skill</span>
                </label>
              </li>
            ))}
            {resources.prompts.map((prompt) => (
              <li key={`prompt-${prompt.id}`}>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={used.some((ref) => ref.kind === 'prompt' && ref.id === prompt.id)}
                    onChange={() => toggleResource('prompt', prompt.id)}
                  />
                  <span className="text-sm">{prompt.title}</span>
                  <span className="text-label text-subtle">Prompt</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enlace externo (§17)
// ---------------------------------------------------------------------------

/** Reconoce el proveedor por el dominio para no tener que preguntarlo. */
function detectProvider(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LINK_PROVIDERS.find((entry) => entry.match?.test(host))?.value ?? 'other';
  } catch {
    return 'other';
  }
}

export function LinkFields({
  data,
  onChange,
}: {
  data: ExternalLinkData;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const provider = data.provider ?? 'other';
  const providerLabel = LINK_PROVIDERS.find((entry) => entry.value === provider)?.label ?? 'Otro';

  return (
    <div className="space-y-5">
      <Field label="Enlace" hint="Figma, Miro, Canva, GitHub… Cualquier dirección pública.">
        <input
          type="url"
          required
          value={data.url ?? ''}
          onChange={(event) =>
            onChange({ url: event.target.value, provider: detectProvider(event.target.value) })
          }
          placeholder="https://figma.com/file/…"
          className="field"
        />
      </Field>

      {data.url && (
        <LinkCard url={data.url} description={`Detectado como ${providerLabel}.`} />
      )}

      <Field label="Título">
        <input
          value={data.title ?? ''}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Wireframes de la app"
          className="field"
        />
      </Field>

      <Field label="Descripción" hint="Qué hay en ese enlace y qué debe mirar tu docente.">
        <textarea
          rows={4}
          value={data.description ?? ''}
          onChange={(event) => onChange({ description: event.target.value })}
          className="field"
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proyecto web (§16)
// ---------------------------------------------------------------------------

/**
 * Entrega que apunta a un proyecto ya publicado.
 *
 * Se guarda una REFERENCIA, no una copia: el id, su ruta pública y su título
 * para poder pintarlo sin ir a buscarlo. §16 lo pide explícitamente y evita el
 * problema de tener dos versiones del mismo trabajo que se separan en cuanto
 * alguien vuelve a publicar.
 */
export function ProjectFields({
  data,
  onChange,
}: {
  data: WebProjectData;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const { projects, state } = useMyProjects(user);

  const publishable = projects.filter((project) => project.status !== 'draft');

  return (
    <div className="space-y-5">
      <Field label="Elige uno de tus proyectos publicados">
        {state === 'loading' ? (
          <p className="text-muted">Cargando tus proyectos…</p>
        ) : publishable.length === 0 ? (
          <Notice>
            Todavía no tienes proyectos publicados.{' '}
            <Link href="/publish" className="underline">
              Publica uno
            </Link>{' '}
            y vuelve aquí.
          </Notice>
        ) : (
          <select
            required
            value={data.projectId ?? ''}
            onChange={(event) => {
              const chosen = publishable.find((project) => project.id === event.target.value);
              onChange({
                projectId: chosen?.id ?? '',
                projectPath: chosen ? publicProjectPath(chosen) : '',
                projectTitle: chosen?.title ?? '',
              });
            }}
            className="field"
          >
            <option value="">— Elige un proyecto —</option>
            {publishable.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        )}
      </Field>

      {data.projectPath && (
        <p className="text-sm">
          <Link href={data.projectPath} className="underline">
            Ver {data.projectTitle}
          </Link>
        </p>
      )}

      <Field label="Nota" hint="Qué debe mirar tu docente en el proyecto.">
        <textarea
          rows={4}
          value={data.note ?? ''}
          onChange={(event) => onChange({ note: event.target.value })}
          className="field"
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrega libre
// ---------------------------------------------------------------------------

export function FreeformFields({
  data,
  onChange,
}: {
  data: FreeformData;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const links = data.links ?? [];

  return (
    <div className="space-y-5">
      <Field label="Tu respuesta">
        <textarea
          rows={10}
          value={data.text ?? ''}
          onChange={(event) => onChange({ text: event.target.value })}
          className="field"
        />
      </Field>

      <fieldset>
        <legend className="label">Enlaces (opcional)</legend>
        <ul className="space-y-2">
          {links.map((link, index) => (
            <li key={index} className="flex flex-wrap items-end gap-2">
              <label className="min-w-32 flex-1">
                <span className="sr-only">Nombre del enlace {index + 1}</span>
                <input
                  value={link.label}
                  onChange={(event) =>
                    onChange({
                      links: links.map((item, position) =>
                        position === index ? { ...item, label: event.target.value } : item
                      ),
                    })
                  }
                  placeholder="Nombre"
                  className="field"
                />
              </label>
              <label className="min-w-56 flex-[2]">
                <span className="sr-only">Dirección del enlace {index + 1}</span>
                <input
                  type="url"
                  value={link.url}
                  onChange={(event) =>
                    onChange({
                      links: links.map((item, position) =>
                        position === index ? { ...item, url: event.target.value } : item
                      ),
                    })
                  }
                  placeholder="https://…"
                  className="field"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({ links: links.filter((_, position) => position !== index) })
                }
                className="btn btn-ghost btn-sm"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onChange({ links: [...links, { label: '', url: '' }] })}
          className="btn btn-secondary btn-sm mt-3"
        >
          + Añadir enlace
        </button>
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archivos, imágenes y video (§18, §19)
// ---------------------------------------------------------------------------

const MEDIA_COPY: Record<
  MediaData['kind'],
  { upload: string; link: string; hint: string; example: string }
> = {
  file: {
    upload: 'Sube tu entrega',
    link: 'Enlace al archivo',
    hint: 'Si prefieres, súbelo a Drive u OneDrive y pega aquí el enlace de acceso.',
    example: 'https://drive.google.com/file/d/…',
  },
  image: {
    upload: 'Sube tu imagen',
    link: 'Enlace a la imagen',
    hint: 'Puede estar en Drive, en Figma o en cualquier sitio con enlace público.',
    example: 'https://…/captura.png',
  },
  video: {
    upload: 'Sube tu video',
    link: 'Enlace al video',
    hint: 'HeyGen, YouTube, Drive… Cualquier enlace donde se pueda ver.',
    example: 'https://youtube.com/watch?v=…',
  },
};

/**
 * Entrega de un archivo, una imagen o un video.
 *
 * ## Subir y enlazar, en ese orden
 *
 * Subir a Nextudio es lo primero y lo evidente, porque es lo que pide una tarea
 * que dice «entrega el reporte». El enlace externo se conserva DEBAJO y no se
 * retira: un video hecho con un avatar de IA vive en HeyGen y no tiene sentido
 * duplicarlo, y un archivo compartido en Drive por todo el equipo tampoco.
 *
 * Las dos formas son alternativas y no se acumulan: al subir se limpia la URL y
 * al escribir una URL se limpia la clave. Guardar las dos dejaría dudando sobre
 * cuál es la entrega de verdad, que es justo la pregunta que nadie debería
 * tener que hacerse al corregir.
 */
export function MediaFields({
  data,
  onChange,
  kind,
  hint,
  assignmentId,
  stepId,
}: {
  data: MediaData;
  onChange: (changes: Record<string, unknown>) => void;
  kind: MediaData['kind'];
  hint?: string;
  /** Con ambos, se habilita la subida a Nextudio además del enlace. */
  assignmentId?: string;
  stepId?: string;
}) {
  const copy = MEDIA_COPY[kind];
  const fileClass = FILE_CLASS_BY_DELIVERABLE[kind];
  const canUpload = Boolean(assignmentId && stepId);

  return (
    <div className="space-y-5">
      {canUpload && (
        <AcademicFileDrop
          label={copy.upload}
          hint={hint}
          fileClass={fileClass}
          assignmentId={assignmentId!}
          stepId={stepId!}
          storageKey={data.storageKey ?? ''}
          fileName={data.fileName ?? ''}
          onUploaded={({ storageKey, fileName }) =>
            onChange({ storageKey, fileName, kind, url: '' })
          }
          onCleared={() => onChange({ storageKey: '', fileName: '' })}
        />
      )}

      <Field
        label={canUpload ? `${copy.link} (alternativa)` : copy.link}
        hint={!canUpload && hint ? hint : copy.hint}
      >
        <input
          type="url"
          value={data.url ?? ''}
          onChange={(event) =>
            onChange({ url: event.target.value, kind, storageKey: '' })
          }
          placeholder={copy.example}
          className="field"
        />
      </Field>

      {data.url && <LinkCard url={data.url} />}

      <Field label="Nota" hint="Qué debe mirar tu docente.">
        <textarea
          rows={3}
          value={data.note ?? ''}
          onChange={(event) => onChange({ note: event.target.value })}
          className="field"
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subida de archivos académicos
// ---------------------------------------------------------------------------

/**
 * La zona de subida de una entrega.
 *
 * Arrastrar y soltar es una comodidad ENCIMA de un `<input type="file">` real,
 * no en lugar de él: el input sigue ahí, con su etiqueta y alcanzable con el
 * teclado, porque arrastrar no es una opción para quien navega sin ratón. Lo
 * que el `div` aporta es la zona grande; lo que decide es el input.
 *
 * El archivo va DIRECTO a S3 con un permiso que firmó el servidor (ver
 * `uploadAcademicFile`). Aquí sólo se ve el progreso y el resultado.
 */
export function AcademicFileDrop({
  label,
  hint,
  fileClass,
  assignmentId,
  stepId,
  storageKey,
  fileName,
  onUploaded,
  onCleared,
}: {
  label: string;
  hint?: string;
  fileClass: AcademicFileClass;
  assignmentId: string;
  stepId: string;
  storageKey: string;
  fileName: string;
  onUploaded: (file: { storageKey: string; fileName: string }) => void;
  onCleared: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const accept = acceptAttributeFor(fileClass);
  const limit = fileLimitLabel(fileClass);

  async function upload(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);

    // El mismo criterio que aplicará el servidor, dicho antes de gastar la
    // subida entera para recibir un 422 al final.
    if (!resolveAcademicUpload(fileClass, { fileName: file.name, contentType: file.type })) {
      setError(
        `Ese formato no se admite en este paso. Se admiten: ${allowedExtensionsFor(fileClass).join(', ')}.`
      );
      return;
    }
    if (file.size > ACADEMIC_FILE_LIMITS[fileClass]) {
      setError(`El archivo supera el límite de ${limit}.`);
      return;
    }

    setUploading(true);
    try {
      const uploaded = await uploadAcademicFile(assignmentId, stepId, file);
      onUploaded(uploaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  /** Se pide en el momento de abrir: una URL firmada dura pocos minutos. */
  async function open(): Promise<void> {
    setOpening(true);
    setError(null);
    try {
      await openSignedUrl(() => academicFileUrl(assignmentId, storageKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo abrir el archivo.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="label">
        {label}
      </label>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files?.[0]);
        }}
        className={`rounded-sm border border-dashed p-4 transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong'
        }`}
      >
        <p className="text-sm text-muted">
          Arrastra el archivo aquí o elígelo desde tu equipo.
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={uploading}
          onChange={(event) => void upload(event.target.files?.[0])}
          aria-describedby={`${inputId}-hint`}
          className="field mt-3"
        />
        <p id={`${inputId}-hint`} className="hint">
          {hint ? `${hint} ` : ''}
          Se admiten {allowedExtensionsFor(fileClass).join(', ')}. Máximo {limit}.
        </p>
      </div>

      {uploading && (
        <div className="mt-3">
          <Notice>Subiendo… no cierres esta pestaña.</Notice>
        </div>
      )}

      {storageKey && !uploading && (
        <div className="panel mt-3 flex flex-wrap items-center gap-3 p-3">
          <span aria-hidden="true">📄</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {fileName || 'Archivo entregado'}
            </span>
            <span className="block text-label text-success">Guardado en Nextudio</span>
          </span>
          <button
            type="button"
            onClick={() => void open()}
            disabled={opening}
            className="btn btn-secondary btn-sm"
          >
            {opening ? 'Abriendo…' : 'Ver'}
          </button>
          <button type="button" onClick={onCleared} className="btn btn-ghost btn-sm">
            Quitar
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Código (Investigación de Operaciones y cualquier materia que programe)
// ---------------------------------------------------------------------------

/** Cómo va el autoguardado del paso. Lo calcula quien tiene la conexión. */
export type CodeSaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Entrega de código.
 *
 * ## Tres modalidades, no tres formularios
 *
 * `editor` escribe en Monaco; `upload` entrega un archivo; `either` admite las
 * dos cosas. Lo que decide es el PASO, no quien entrega. Un paso guardado antes
 * de que existieran las modalidades se lee como `either`, que es exactamente lo
 * que ofrecía antes: fuente pegado y archivo opcional. Nadie pierde nada.
 *
 * ## Importar un archivo NO es adjuntarlo
 *
 * En modo editable, «Importar» lee el `.R` o el `.py` como texto y lo mete en
 * el editor: acaba habiendo UNA evidencia, la del editor. «Adjuntar» sube el
 * archivo a S3 y deja su clave. Son cosas distintas y por eso son dos botones
 * distintos: guardar el mismo programa dos veces obligaría a la docente a
 * decidir cuál de las dos copias es la buena.
 *
 * ## Ejecutar no entrega
 *
 * El botón de ejecutar vive dentro de `CodeEditor` y no toca la entrega: antes
 * de ejecutar se GUARDA (`beforeExecute`), y lo que se ejecuta es lo guardado.
 * La salida no se persiste en ninguna parte.
 */
export function CodeFields({
  data,
  onChange,
  language,
  codeMode,
  starterCode = '',
  executionEnabled = false,
  hint,
  assignmentId,
  stepId,
  readOnly = false,
  onCodeEdited,
  beforeExecute,
  saveState = 'idle',
  saveError,
}: {
  data: CodeData;
  onChange: (changes: Record<string, unknown>) => void;
  /** El lenguaje que pide el paso. Lo decide la docente, no el alumnado. */
  language: ProgrammingLanguage;
  /** Ausente en pasos anteriores a las modalidades: se lee como `either`. */
  codeMode?: CodeMode | null;
  starterCode?: string;
  executionEnabled?: boolean;
  hint?: string;
  assignmentId?: string;
  stepId?: string;
  readOnly?: boolean;
  /** Aviso de que el fuente cambió POR UNA EDICIÓN, para el autoguardado. */
  onCodeEdited?: () => void;
  beforeExecute?: () => Promise<void>;
  saveState?: CodeSaveState;
  saveError?: string;
}) {
  const mode = codeMode ?? LEGACY_CODE_MODE;
  const editable = mode === 'editor' || mode === 'either';
  const attachable = (mode === 'upload' || mode === 'either') && Boolean(assignmentId && stepId);
  const label = programmingLanguageLabel(language);
  const code = data.code ?? '';

  const [importError, setImportError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

  /**
   * La copia del alumnado nace del código inicial UNA vez.
   *
   * La guarda importa: sin ella, cada visita al paso pisaría lo escrito con la
   * plantilla, y cambiar la plantilla más tarde borraría el trabajo de quien ya
   * había empezado. Se siembra en local y no se autoguarda: abrir un paso no
   * debe fabricar una entrega que nadie ha escrito.
   */
  useEffect(() => {
    if (seeded.current || readOnly || !editable) return;
    seeded.current = true;
    if (!code && starterCode) onChange({ code: starterCode, language });
  }, [code, editable, language, onChange, readOnly, starterCode]);

  function editCode(next: string): void {
    onChange({ code: next, language });
    onCodeEdited?.();
  }

  async function importSource(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError(null);

    // Las mismas dos preguntas que hace el servidor al subir, hechas antes: qué
    // extensión trae y cuánto ocupa.
    if (!resolveAcademicUpload('code', { fileName: file.name, contentType: file.type })) {
      setImportError(
        `Sólo se admiten ${allowedExtensionsFor('code').join(', ')} para importar al editor.`
      );
      return;
    }
    if (file.size > ACADEMIC_LIMITS.codeMax) {
      setImportError('Ese archivo es demasiado grande para el editor.');
      return;
    }

    try {
      editCode(await file.text());
    } catch {
      setImportError('No se pudo leer el archivo.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  return (
    <div className="space-y-5">
      <Notice>
        Esta entrega es en <strong>{label}</strong>.{' '}
        {mode === 'editor'
          ? 'Escribe tu solución en el editor. No hace falta adjuntar ningún archivo.'
          : mode === 'upload'
            ? 'Adjunta tu archivo de código.'
            : 'Escribe en el editor, adjunta el archivo, o las dos cosas.'}
      </Notice>

      {editable && (
        <div>
          <p className="label">Tu código en {label}</p>
          <CodeEditor
            language={language}
            value={code}
            onChange={editable && !readOnly ? editCode : undefined}
            readOnly={readOnly}
            starterCode={starterCode}
            executionEnabled={executionEnabled}
            beforeExecute={beforeExecute}
            ariaLabel={`Tu código en ${label}`}
            toolbar={<SaveState state={saveState} error={saveError} />}
          />
          <p className="hint">
            {hint || 'Se conserva la sangría. Se guarda solo mientras escribes.'}
          </p>

          {!readOnly && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="btn btn-ghost btn-sm cursor-pointer">
                Importar archivo al editor
                <input
                  ref={importRef}
                  type="file"
                  accept={acceptAttributeFor('code')}
                  onChange={(event) => void importSource(event.target.files?.[0])}
                  className="sr-only"
                />
              </label>
              {code && (
                <button
                  type="button"
                  onClick={() => downloadText(code, sourceFilenameFor(language), 'text/plain')}
                  className="btn btn-ghost btn-sm"
                >
                  Descargar mi código
                </button>
              )}
            </div>
          )}

          {importError && (
            <div className="mt-3">
              <Notice tone="error">{importError}</Notice>
            </div>
          )}
        </div>
      )}

      {attachable && (
        <AcademicFileDrop
          label={mode === 'upload' ? `Tu archivo de ${label}` : 'Adjunta el archivo (opcional)'}
          fileClass="code"
          assignmentId={assignmentId!}
          stepId={stepId!}
          storageKey={data.storageKey ?? ''}
          fileName={data.fileName ?? ''}
          onUploaded={({ storageKey, fileName }) => onChange({ storageKey, fileName, language })}
          onCleared={() => onChange({ storageKey: '', fileName: '' })}
        />
      )}

      <Field
        label="Explicación"
        hint="Qué hace el programa y cómo se ejecuta. Opcional si la tarea no la pide."
      >
        <textarea
          rows={4}
          readOnly={readOnly}
          value={data.explanation ?? ''}
          onChange={(event) => onChange({ explanation: event.target.value, language })}
          className="field"
        />
      </Field>
    </div>
  );
}

/**
 * El estado del autoguardado, dicho sin alarmar y sin mentir.
 *
 * «Guardado» aparece sólo cuando el servidor confirmó. Mientras tanto se dice
 * «Guardando…», y si falló se dice que falló Y se deja el aviso puesto: perder
 * una hora de trabajo porque un mensaje se desvaneció a los tres segundos es
 * exactamente lo que no puede pasar.
 */
function SaveState({ state, error }: { state: CodeSaveState; error?: string }) {
  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <span className="text-sm text-danger" role="status">
        {error || 'No se pudo guardar. Usa «Guardar borrador» antes de cerrar.'}
      </span>
    );
  }

  return (
    <span className="text-sm text-subtle" role="status">
      {state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  );
}
