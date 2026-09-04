'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { ACADEMIC_FILE_LIMITS, ACADEMIC_FILE_TYPES, FILE_CLASS_BY_DELIVERABLE } from '@/lib/constants';
import { uploadAcademicFile } from '@/lib/aula-client';
import { aiWorklogToMarkdown, detectTextFormat, normalizeAIResult } from '@/lib/ai-worklog';
import { AI_MODEL_SUGGESTIONS, AI_PROVIDERS, LINK_PROVIDERS } from '@/lib/constants';
import type { AssignmentDetail } from '@/lib/aula-client';
import { useMyProjects } from '@/lib/use-my-projects';
import { publicProjectPath } from '@/lib/urls';
import type {
  AIProvider,
  AIWorklogData,
  ExternalLinkData,
  FreeformData,
  MediaData,
  ResearchData,
  ResourceRef,
  WebProjectData,
} from '@/lib/types';
import { Field, Notice } from './aula-ui';
import { CopyButton } from './copy-button';
import { LinkCard } from './link-card';
import { MarkdownContent } from './markdown-content';

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
}: {
  data: AIWorklogData;
  onChange: (changes: Record<string, unknown>) => void;
  resources: AssignmentDetail['resources'];
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
          <div role="tablist" aria-label="Resultado de la IA" className="flex gap-1">
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

      <Field
        label="Tu análisis"
        hint="Qué aprendiste, en qué se equivocó la IA, qué decidiste tú."
      >
        <textarea
          rows={4}
          value={data.studentAnalysis ?? ''}
          onChange={(event) => onChange({ studentAnalysis: event.target.value })}
          className="field"
        />
      </Field>

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

const MEDIA_COPY: Record<MediaData['kind'], { label: string; hint: string; example: string }> = {
  file: {
    label: 'Enlace al archivo',
    hint: 'Súbelo a Drive, OneDrive o donde prefieras y pega aquí el enlace de acceso.',
    example: 'https://drive.google.com/file/d/…',
  },
  image: {
    label: 'Enlace a la imagen',
    hint: 'Puede estar en Drive, en Figma o en cualquier sitio con enlace público.',
    example: 'https://…/captura.png',
  },
  video: {
    label: 'Enlace al video',
    hint: 'HeyGen, YouTube, Drive… Cualquier enlace donde se pueda ver.',
    example: 'https://youtube.com/watch?v=…',
  },
};

/**
 * Entrega de un archivo.
 *
 * Se pide un ENLACE y no una subida, y conviene entender por qué: UINexus tiene
 * S3 para el código de los proyectos y para portadas, pero no un prefijo ni una
 * ruta de firma para archivos académicos —un MP4 de 200 MB no es una portada—.
 * §18 pide documentar esa infraestructura antes que improvisarla, así que está
 * anotado en CHECKPOINTS.md como trabajo con nombre propio.
 *
 * Mientras tanto, el enlace cubre el caso real de §19: un video de HeyGen, uno
 * de YouTube o un archivo en Drive se entregan igual de bien así.
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
  /** Con ambos, se habilita la subida a UINexus además del enlace. */
  assignmentId?: string;
  stepId?: string;
}) {
  const copy = MEDIA_COPY[kind];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const canUpload = Boolean(assignmentId && stepId);

  async function upload(file: File): Promise<void> {
    if (!assignmentId || !stepId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { storageKey, fileName } = await uploadAcademicFile(assignmentId, stepId, file);
      // Subir y enlazar son alternativas: guardar las dos dejaría dudando sobre
      // cuál es la entrega de verdad.
      onChange({ storageKey, fileName, kind, url: '' });
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'No se pudo subir.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      {canUpload && (
        <Field
          label="Sube el archivo"
          hint={`Se guarda en UINexus. ${LIMIT_COPY[kind]}`}
        >
          <input
            type="file"
            accept={ACCEPT[kind]}
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            className="field"
          />
        </Field>
      )}

      {uploading && <Notice>Subiendo… no cierres esta pestaña.</Notice>}
      {uploadError && <Notice tone="error">{uploadError}</Notice>}

      {data.storageKey && (
        <Notice tone="success">
          Archivo subido{data.fileName ? `: ${data.fileName}` : ''}. Puedes reemplazarlo
          eligiendo otro.
        </Notice>
      )}

      <Field
        label={canUpload ? `${copy.label} (alternativa)` : copy.label}
        hint={hint || copy.hint}
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

      <Field label="Nombre" hint="Opcional. Cómo se llama lo que entregas.">
        <input
          value={data.fileName ?? ''}
          onChange={(event) => onChange({ fileName: event.target.value })}
          placeholder="avatar-presentacion.mp4"
          className="field"
        />
      </Field>

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

/** Qué extensiones ofrece el selector de archivo, por clase de entregable. */
const ACCEPT: Record<MediaData['kind'], string> = {
  image: Object.keys(ACADEMIC_FILE_TYPES.image).join(','),
  video: Object.keys(ACADEMIC_FILE_TYPES.video).join(','),
  file: Object.keys(ACADEMIC_FILE_TYPES.document).join(','),
};

/** El límite, dicho en megas, para que se lea antes de intentar subir. */
const LIMIT_COPY: Record<MediaData['kind'], string> = {
  image: `Máximo ${Math.round(ACADEMIC_FILE_LIMITS[FILE_CLASS_BY_DELIVERABLE.image] / (1024 * 1024))} MB.`,
  video: `Máximo ${Math.round(ACADEMIC_FILE_LIMITS[FILE_CLASS_BY_DELIVERABLE.video] / (1024 * 1024))} MB.`,
  file: `Máximo ${Math.round(ACADEMIC_FILE_LIMITS[FILE_CLASS_BY_DELIVERABLE.file] / (1024 * 1024))} MB.`,
};
