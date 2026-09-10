'use client';

import { useState } from 'react';
import { DELIVERABLE_LABEL } from '@/lib/constants';
import {
  instantiateWorkflowTemplate,
  templateWorkflowSteps,
  workflowTemplatesBySubject,
  type WorkflowTemplate,
} from '@/lib/workflow-templates';
import type { WorkflowStep } from '@/lib/types';
import { Notice } from './aula-ui';

/**
 * Galería de plantillas de proceso.
 *
 * Existe para resolver un problema concreto: quien da Investigación de
 * Operaciones no debería tener que escribir «Variables de decisión → Función
 * objetivo → Restricciones» a mano cada semana. Elegir la plantilla deja esos
 * pasos puestos y a partir de ahí todo se edita como cualquier otra actividad.
 *
 * Dos decisiones de interfaz que importan:
 *
 *  · Los pasos se pueden VER antes de aplicarlos. Una plantilla que hay que
 *    aplicar para saber qué trae no ahorra tiempo: lo cambia de sitio.
 *  · Aplicar sobre una actividad que ya tiene pasos pide confirmación y dice
 *    cuántos se van a perder. Reemplazar en silencio el trabajo de alguien es
 *    la clase de error que sólo se descubre después de publicar.
 */
export function WorkflowTemplatePicker({
  hasSteps,
  onApply,
}: {
  /** `true` si la actividad ya tiene pasos: aplicar los reemplaza. */
  hasSteps: boolean;
  onApply: (template: WorkflowTemplate, steps: WorkflowStep[]) => void;
}) {
  const groups = workflowTemplatesBySubject();
  const [open, setOpen] = useState(!hasSteps);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (groups.length === 0) return null;

  function apply(template: WorkflowTemplate): void {
    // El clonado ocurre AQUÍ y siempre: los pasos que entran en la tarea nunca
    // son los de la plantilla, son copias con identificadores propios.
    onApply(template, instantiateWorkflowTemplate(template.id));
    setConfirming(null);
    setPreview(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="btn btn-ghost btn-sm"
        >
          Usar una plantilla de proceso
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          Empieza desde un proceso ya armado. Después puedes cambiar los pasos, quitarlos,
          reordenarlos o hacerlos opcionales.
        </p>
        {hasSteps && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className="btn btn-ghost btn-sm"
          >
            Ocultar plantillas
          </button>
        )}
      </div>

      {groups.map((group) => (
        <section key={group.subject} className="mt-4">
          <h3 className="meta">{group.subject}</h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {group.templates.map((template) => {
              const steps = templateWorkflowSteps(template);
              const showing = preview === template.id;

              return (
                <li key={template.id} className="panel p-4">
                  <h4 className="font-medium">{template.name}</h4>
                  <p className="mt-1 text-sm text-muted">{template.summary}</p>
                  <p className="mt-2 text-label text-subtle tabular-nums">
                    {steps.length} pasos ·{' '}
                    {steps.filter((step) => step.required).length} obligatorios
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        hasSteps ? setConfirming(template.id) : apply(template)
                      }
                      className="btn btn-primary btn-sm"
                    >
                      {hasSteps ? 'Reemplazar pasos' : 'Usar esta plantilla'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreview(showing ? null : template.id)}
                      aria-expanded={showing}
                      className="btn btn-ghost btn-sm"
                    >
                      {showing ? 'Ocultar pasos' : 'Ver los pasos'}
                    </button>
                  </div>

                  {confirming === template.id && (
                    <div className="mt-3">
                      <Notice tone="error">
                        Esto reemplaza los pasos que ya escribiste. No se puede deshacer.
                      </Notice>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => apply(template)}
                          className="btn btn-danger btn-sm"
                        >
                          Sí, reemplazar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="btn btn-ghost btn-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {showing && (
                    <ol className="mt-3 space-y-1.5 border-l-2 border-line pl-4">
                      {steps.map((step, index) => (
                        <li key={step.id} className="text-sm">
                          <span className="text-subtle tabular-nums">{index + 1}.</span>{' '}
                          <span className="font-medium">{step.title}</span>
                          <span className="block text-label text-subtle">
                            {DELIVERABLE_LABEL[step.deliverables[0]?.type ?? 'none']}
                            {!step.required && ' · opcional'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
