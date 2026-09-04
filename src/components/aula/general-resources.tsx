'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DELIVERABLE_LABEL, stepActionLabel } from '@/lib/constants';
import { createCourseResource, deleteCourseResource } from '@/lib/aula-client';
import type { CourseResource, CourseResourceType, WorkflowStep } from '@/lib/types';
import { Field, Notice } from './aula-ui';
import { WorkflowBuilder } from './workflow-builder';
import { ModerationActions, ResourceAttribution, ResourceStatusBadge } from './resource-card';
import { LinkCard } from './link-card';

/**
 * Herramientas, enlaces y guías de la materia (§13, §38, §40).
 *
 * Son el tercer tipo de recurso, junto a prompts y Skills. Viven aparte de
 * ambos porque su forma es otra —un enlace y una explicación— y porque §5 pide
 * que registrar una herramienta nueva no dependa de tocar código: aquí la
 * docente escribe «Napkin AI», pega la URL, y esa herramienta ya se puede usar
 * en un paso de workflow.
 */

export const RESOURCE_TYPE_LABEL: Record<CourseResourceType, string> = {
  tool: 'Herramienta',
  link: 'Enlace',
  guide: 'Guía',
  video: 'Video',
  document: 'Documento',
  template: 'Plantilla',
  workflow: 'Proceso',
  other: 'Recurso',
};

/**
 * El dominio de una URL, para la tarjeta (§38).
 *
 * Se calcula en el NAVEGADOR a partir del texto. UINexus no visita el enlace
 * para sacarle título ni favicon, y no es pereza: pedir metadatos a un sitio
 * que alguien acaba de pegar convierte al servidor en un cliente de peticiones
 * arbitrarias, que es un problema de seguridad con nombre propio (SSRF). La
 * tarjeta enriquecida de verdad necesita un servicio de metadatos con lista de
 * dominios y tiempos de espera; está anotado en CHECKPOINTS.md.
 */
export function safeDomain(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Ficha de un recurso general.
 *
 * Se pinta como TARJETA con dominio y enlace, nunca como un embed. §15 lo pide
 * con todas las letras: la mayoría de las herramientas bloquean el iframe con
 * `X-Frame-Options` o `frame-ancestors`, y prometer una vista incrustada que
 * casi nunca funciona convierte el caso normal en un error aparente. El nivel
 * 0/1 —enlace y tarjeta— es el que siempre funciona (§39).
 */
export function GeneralResourceCard({
  resource,
  isTeacher,
  onChanged,
}: {
  resource: CourseResource;
  isTeacher: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const domain = safeDomain(resource.url);
  const isTemplate = resource.type === 'workflow' && resource.workflowSteps.length > 0;

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="meta">{RESOURCE_TYPE_LABEL[resource.type]}</p>
          <h3 className="mt-1 flex flex-wrap items-center gap-2 font-medium">
            {resource.title}
            <ResourceStatusBadge status={resource.status} />
          </h3>
          {resource.description && (
            <p className="mt-1 text-sm text-muted">{resource.description}</p>
          )}
          {(domain || resource.category) && (
            <p className="mt-1 text-label text-subtle">
              {[resource.category, domain].filter(Boolean).join(' · ')}
            </p>
          )}
          <ResourceAttribution resource={resource} />
        </div>

        <div className="flex flex-wrap gap-2">
          {isTemplate && (
            <button
              type="button"
              onClick={() => setShowSteps((value) => !value)}
              className="btn btn-secondary btn-sm"
            >
              {showSteps ? 'Ocultar proceso' : 'Ver proceso'}
            </button>
          )}
          {/*
            Crear tarea desde la plantilla es del profesorado y sólo si está
            aprobada: usar una propuesta pendiente la publicaría por la puerta
            de atrás. El servidor lo comprueba igualmente.
          */}
          {isTemplate && isTeacher && resource.status === 'approved' && (
            <Link
              href={`/aula/${resource.courseId}/tareas/nueva?template=${resource.id}`}
              className="btn btn-primary btn-sm"
            >
              Crear tarea
            </Link>
          )}
          {resource.url && (
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Abrir ↗
            </a>
          )}
          {isTeacher && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-ghost btn-sm"
            >
              Borrar
            </button>
          )}
        </div>
      </div>

      {isTemplate && (
        <p className="mt-2 text-label text-subtle">
          {resource.workflowSteps.length} pasos
        </p>
      )}

      {isTemplate && showSteps && (
        <ol className="mt-3 space-y-1.5 border-l-2 border-line pl-4">
          {resource.workflowSteps.map((step, index) => (
            <li key={step.id} className="text-sm">
              <span className="text-subtle tabular-nums">{index + 1}.</span>{' '}
              <span className="font-medium">{step.title}</span>
              <span className="block text-label text-subtle">
                {stepActionLabel(step.actionType)}
                {step.tool.toolNames.length > 0 && ` · ${step.tool.toolNames.join(', ')}`}
                {' · '}
                {DELIVERABLE_LABEL[step.deliverables[0]?.type ?? 'none']}
                {!step.required && ' · opcional'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {resource.url && (
        <div className="mt-3">
          <LinkCard url={resource.url} compact />
        </div>
      )}

      {resource.content && (
        <p className="prose-block mt-3 max-w-prose whitespace-pre-line text-sm text-muted">
          {resource.content}
        </p>
      )}

      {isTeacher && (
        <ModerationActions
          kind="resource"
          id={resource.id}
          status={resource.status}
          featured={resource.featured}
          onDone={onChanged}
        />
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm">¿Borrar este recurso?</p>
          <button
            type="button"
            onClick={() => void deleteCourseResource(resource.id).then(onChanged)}
            className="btn btn-danger btn-sm"
          >
            Sí, borrar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost btn-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Alta de una herramienta, enlace o guía. La usan AMBOS roles (§7, §40).
 *
 * El botón dice «Guardar» o «Enviar propuesta» según quién esté delante, y el
 * aviso explica dónde acaba lo que se escribe. Quien lo pulsa no debería tener
 * que descubrirlo después.
 */
export function CourseResourceEditor({
  courseId,
  isTeacher,
  initialType = 'tool',
  initialSteps = [],
  onDone,
  onCancel,
}: {
  courseId: string;
  isTeacher: boolean;
  /** Con qué tipo abre. `workflow` cuando se guarda un proceso como plantilla. */
  initialType?: CourseResourceType;
  initialSteps?: WorkflowStep[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<CourseResourceType>(initialType);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>(initialSteps);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCourseResource(courseId, {
        type,
        title,
        url,
        description,
        category,
        content,
        tags: [],
        // Los pasos sólo se mandan si el recurso es una plantilla. El servidor
        // los descarta igualmente en cualquier otro tipo.
        workflowSteps:
          type === 'workflow'
            ? workflowSteps.map((step, index) => ({
                ...step,
                order: index,
                // Una plantilla no lleva responsables: se reparte al crear la
                // tarea, que es cuando se sabe quién está en el grupo.
                assignedHandles: null,
              }))
            : [],
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-5">
      <h3 className="font-display text-h3">
        {isTeacher ? 'Nuevo recurso' : 'Proponer un recurso'}
      </h3>

      {!isTeacher && (
        <Notice>
          Tu propuesta le llega a tu docente. Si la acepta, entra en la biblioteca de la materia
          con tu nombre.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as CourseResourceType)}
            className="field"
          >
            {(Object.keys(RESOURCE_TYPE_LABEL) as CourseResourceType[]).map((value) => (
              <option key={value} value={value}>
                {RESOURCE_TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Categoría" hint="Opcional. Visualización, búsqueda, diseño…">
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Visualización"
            className="field"
          />
        </Field>
      </div>

      <Field label="Nombre">
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Napkin AI"
          className="field"
        />
      </Field>

      <Field label="Enlace" hint="Opcional: una guía puede ser sólo texto.">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.napkin.ai"
          className="field"
        />
      </Field>

      <Field label="Para qué sirve">
        <textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Convierte texto en diagramas con IA."
          className="field"
        />
      </Field>

      {type === 'workflow' && (
        <fieldset>
          <legend className="label">Los pasos del proceso</legend>
          <p className="hint">
            Esto es una plantilla: define el proceso una vez y crea tareas desde él cuantas veces
            quieras. Los responsables se reparten al crear cada tarea.
          </p>
          <div className="mt-3">
            <WorkflowBuilder
              courseId={courseId}
              steps={workflowSteps}
              students={[]}
              onChange={setWorkflowSteps}
            />
          </div>
        </fieldset>
      )}

      <Field label="Cómo se usa" hint="Opcional. Texto plano; los saltos de línea se respetan.">
        <textarea
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="field"
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="submit"
          disabled={
            busy ||
            title.trim().length < 2 ||
            (type === 'workflow' && workflowSteps.length === 0)
          }
          className="btn btn-primary"
        >
          {busy ? 'Guardando…' : isTeacher ? 'Guardar' : 'Enviar propuesta'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  );
}
