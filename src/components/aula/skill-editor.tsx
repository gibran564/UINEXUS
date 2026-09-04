'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createSkill, updateSkill, useApi } from '@/lib/aula-client';
import type { InstallMethod, InstallStep, SkillResource } from '@/lib/types';
import { AulaScreen, Crumbs, Field, Notice } from './aula-ui';

/**
 * Alta y edición de una Skill (§22, §23, §24).
 *
 * La forma del formulario sale del problema real: la misma habilidad se instala
 * distinto en Claude Code, en Codex y en Cursor, así que hay VARIOS métodos, y
 * cada método son PASOS de tres clases —una explicación, un comando o un
 * enlace—. Eso es más trabajo de formulario que un textarea, y a cambio el
 * alumnado recibe una guía con botones de copiar en vez de un muro de texto del
 * que hay que extraer el comando a ojo.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10);

const SUGGESTED_TOOLS = [
  'Claude Code',
  'Cursor',
  'Codex',
  'Gemini CLI',
  'GitHub Copilot',
  'Otra',
];

interface DraftState {
  title: string;
  description: string;
  repositoryUrl: string;
  homepageUrl: string;
  compatibleTools: string[];
  installMethods: InstallMethod[];
  usageInstructions: string;
  tags: string[];
}

const EMPTY: DraftState = {
  title: '',
  description: '',
  repositoryUrl: '',
  homepageUrl: '',
  compatibleTools: [],
  installMethods: [],
  usageInstructions: '',
  tags: [],
};

export function SkillEditor({
  courseId,
  skillId,
}: {
  courseId: string;
  skillId?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existing = useApi<{ skill: SkillResource }>(skillId ? `/api/skills/${skillId}` : null);

  useEffect(() => {
    const loaded = existing.data?.skill;
    if (!loaded) return;
    setDraft({
      title: loaded.title,
      description: loaded.description,
      repositoryUrl: loaded.repositoryUrl ?? '',
      homepageUrl: loaded.homepageUrl ?? '',
      compatibleTools: loaded.compatibleTools,
      installMethods: loaded.installMethods,
      usageInstructions: loaded.usageInstructions,
      tags: loaded.tags,
    });
  }, [existing.data]);

  const patch = (changes: Partial<DraftState>) =>
    setDraft((current) => ({ ...current, ...changes }));

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Los pasos vacíos se descartan al guardar en vez de rechazarse: quedan
      // de añadir un paso y cambiar de idea, y no es un error que valga la pena
      // contarle a nadie.
      const body = {
        ...draft,
        installMethods: draft.installMethods
          .filter((method) => method.tool.trim())
          .map((method) => ({
            ...method,
            steps: method.steps.filter((step) =>
              step.type === 'link' ? step.url.trim() : step.content.trim()
            ),
          })),
      };

      if (skillId) await updateSkill(skillId, body);
      else await createSkill(courseId, body);

      router.push(`/aula/${courseId}?tab=resources`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  function addMethod(): void {
    patch({
      installMethods: [
        ...draft.installMethods,
        { id: uid(), tool: '', title: '', steps: [{ type: 'text', content: '' }] },
      ],
    });
  }

  function patchMethod(id: string, changes: Partial<InstallMethod>): void {
    patch({
      installMethods: draft.installMethods.map((method) =>
        method.id === id ? { ...method, ...changes } : method
      ),
    });
  }

  return (
    <AulaScreen
      state={skillId ? existing.state : 'ready'}
      error={existing.error}
      next={`/aula/${courseId}`}
    >
      <div className="max-w-3xl">
        <Crumbs
          items={[
            { href: '/aula', label: 'Aula' },
            { href: `/aula/${courseId}`, label: 'Materia' },
            { label: skillId ? 'Editar Skill' : 'Nueva Skill' },
          ]}
        />

        <h1 className="mt-4 font-display text-h1">
          {skillId ? 'Editar Skill' : 'Nueva Skill'}
        </h1>
        <p className="mt-2 max-w-prose text-muted">
          Una Skill aquí es una ficha: explica qué hace, dónde está y cómo se instala. UINexus no
          ejecuta nada de lo que escribas: los comandos se muestran para copiarlos.
        </p>

        <form onSubmit={save} className="mt-8 space-y-8">
          <section className="space-y-4">
            <Field label="Nombre">
              <input
                required
                value={draft.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder="UI UX Pro Max"
                className="field"
              />
            </Field>

            <Field label="Descripción">
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => patch({ description: event.target.value })}
                placeholder="Skill especializada en diseño UI/UX."
                className="field"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repositorio" hint="Opcional. No tiene que ser GitHub.">
                <input
                  type="url"
                  value={draft.repositoryUrl}
                  onChange={(event) => patch({ repositoryUrl: event.target.value })}
                  placeholder="https://github.com/…"
                  className="field"
                />
              </Field>

              <Field label="Sitio oficial" hint="Opcional.">
                <input
                  type="url"
                  value={draft.homepageUrl}
                  onChange={(event) => patch({ homepageUrl: event.target.value })}
                  placeholder="https://…"
                  className="field"
                />
              </Field>
            </div>
          </section>

          <section aria-labelledby="herramientas">
            <h2 id="herramientas" className="section-mark font-display text-h3">
              Compatible con
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_TOOLS.map((tool) => {
                const active = draft.compatibleTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      patch({
                        compatibleTools: active
                          ? draft.compatibleTools.filter((item) => item !== tool)
                          : [...draft.compatibleTools, tool],
                      })
                    }
                    className="chip"
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="metodos">
            <h2 id="metodos" className="section-mark font-display text-h3">
              Cómo se instala
            </h2>
            <p className="mt-1 text-sm text-muted">
              Un método por herramienta. Cada paso puede ser una explicación, un comando para
              copiar o un enlace.
            </p>

            <ul className="mt-4 space-y-4">
              {draft.installMethods.map((method) => (
                <li key={method.id} className="panel p-4">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-40 flex-1">
                      <span className="label">Herramienta</span>
                      <input
                        value={method.tool}
                        onChange={(event) => patchMethod(method.id, { tool: event.target.value })}
                        placeholder="Claude Code"
                        className="field"
                      />
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className="label">Título del método</span>
                      <input
                        value={method.title}
                        onChange={(event) => patchMethod(method.id, { title: event.target.value })}
                        placeholder="Desde el marketplace"
                        className="field"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          installMethods: draft.installMethods.filter(
                            (item) => item.id !== method.id
                          ),
                        })
                      }
                      className="btn btn-ghost btn-sm"
                    >
                      Quitar método
                    </button>
                  </div>

                  <StepEditor
                    steps={method.steps}
                    onChange={(steps) => patchMethod(method.id, { steps })}
                  />
                </li>
              ))}
            </ul>

            <button type="button" onClick={addMethod} className="btn btn-secondary btn-sm mt-4">
              + Añadir método de instalación
            </button>
          </section>

          <section aria-labelledby="uso">
            <h2 id="uso" className="section-mark font-display text-h3">
              Cómo usarla
            </h2>
            <div className="mt-3">
              <Field label="Instrucciones" hint="Texto plano. Los saltos de línea se respetan.">
                <textarea
                  rows={6}
                  value={draft.usageInstructions}
                  onChange={(event) => patch({ usageInstructions: event.target.value })}
                  placeholder={
                    '1. Instala la skill.\n2. Reinicia Claude Code.\n3. Abre tu proyecto.\n4. Pide…'
                  }
                  className="field"
                />
              </Field>
            </div>
          </section>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="flex flex-wrap gap-3 border-t border-line pt-6">
            <button
              type="submit"
              disabled={busy || draft.title.trim().length < 3}
              className="btn btn-primary"
            >
              {busy ? 'Guardando…' : 'Guardar Skill'}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/aula/${courseId}?tab=resources`)}
              className="btn btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </AulaScreen>
  );
}

function StepEditor({
  steps,
  onChange,
}: {
  steps: InstallStep[];
  onChange: (steps: InstallStep[]) => void;
}) {
  function add(type: InstallStep['type']): void {
    const step: InstallStep =
      type === 'link' ? { type: 'link', label: '', url: '' } : { type, content: '' };
    onChange([...steps, step]);
  }

  function patchStep(index: number, next: InstallStep): void {
    onChange(steps.map((step, position) => (position === index ? next : step)));
  }

  return (
    <div className="mt-4">
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2">
            <span className="pb-2 text-sm text-subtle tabular-nums">{index + 1}</span>

            {step.type === 'text' && (
              <label className="min-w-56 flex-1">
                <span className="label">Explicación</span>
                <textarea
                  rows={2}
                  value={step.content}
                  onChange={(event) =>
                    patchStep(index, { type: 'text', content: event.target.value })
                  }
                  placeholder="Abre Claude Code dentro de tu proyecto."
                  className="field"
                />
              </label>
            )}

            {step.type === 'command' && (
              <label className="min-w-56 flex-1">
                <span className="label">Comando</span>
                <input
                  value={step.content}
                  onChange={(event) =>
                    patchStep(index, { type: 'command', content: event.target.value })
                  }
                  placeholder="npm install -g ui-ux-pro-max-cli"
                  className="field font-mono text-sm"
                />
              </label>
            )}

            {step.type === 'link' && (
              <>
                <label className="min-w-32 flex-1">
                  <span className="label">Texto del enlace</span>
                  <input
                    value={step.label}
                    onChange={(event) =>
                      patchStep(index, { type: 'link', label: event.target.value, url: step.url })
                    }
                    placeholder="Documentación"
                    className="field"
                  />
                </label>
                <label className="min-w-56 flex-[2]">
                  <span className="label">Dirección</span>
                  <input
                    type="url"
                    value={step.url}
                    onChange={(event) =>
                      patchStep(index, {
                        type: 'link',
                        label: step.label,
                        url: event.target.value,
                      })
                    }
                    placeholder="https://…"
                    className="field"
                  />
                </label>
              </>
            )}

            <button
              type="button"
              onClick={() => onChange(steps.filter((_, position) => position !== index))}
              className="btn btn-ghost btn-sm"
            >
              Quitar
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => add('text')} className="btn btn-ghost btn-sm">
          + Explicación
        </button>
        <button type="button" onClick={() => add('command')} className="btn btn-ghost btn-sm">
          + Comando
        </button>
        <button type="button" onClick={() => add('link')} className="btn btn-ghost btn-sm">
          + Enlace
        </button>
      </div>
    </div>
  );
}
