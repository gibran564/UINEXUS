'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/aula-client';
import type { InstallMethod, SkillResource } from '@/lib/types';
import { AulaScreen, Crumbs, Notice } from './aula-ui';
import { CopyButton } from './copy-button';

/**
 * La ficha de una Skill (§23, §24, §25).
 *
 * ## Lo que esta pantalla NO hace
 *
 * No instala nada. No ejecuta nada. No descarga nada. Los comandos son TEXTO:
 * se muestran y se copian, y la persona los pega en su propia terminal si
 * quiere. Esa es una propiedad de la arquitectura y no una opción desactivada:
 * no existe en UINexus ninguna ruta capaz de ejecutar un comando.
 *
 * Por eso el botón que lleva aquí dice «Ver instalación» y no «Instalar», y por
 * eso cada bloque de comando se pinta como código con su botón de copiar, con
 * el aspecto de algo que hay que llevarse a otro sitio.
 *
 * ## Por qué los pasos son bloques y no un textarea
 *
 * Un único campo de texto gigante obliga a leer diez líneas para encontrar el
 * comando, y a seleccionarlo a mano sin pasarse. Separar texto, comando y
 * enlace permite darle a cada uno lo que necesita: al comando su botón de
 * copiar, al enlace su `noopener noreferrer`, y al texto que se lea como texto.
 * Es la diferencia entre una guía y un volcado.
 */
export function SkillDetail({ courseId, skillId }: { courseId: string; skillId: string }) {
  const { data, state, error } = useApi<{ skill: SkillResource }>(`/api/skills/${skillId}`);
  const [method, setMethod] = useState<string | null>(null);

  const skill = data?.skill;
  const methods = skill?.installMethods ?? [];
  const active = methods.find((item) => item.id === method) ?? methods[0];

  return (
    <AulaScreen state={state} error={error} next={`/aula/${courseId}/recursos/skills/${skillId}`}>
      {skill && (
        <article className="max-w-3xl">
          <Crumbs
            items={[
              { href: '/aula', label: 'Aula' },
              { href: `/aula/${courseId}`, label: 'Materia' },
              { label: skill.title },
            ]}
          />

          <header className="mt-4 border-b border-line pb-6">
            <p className="meta">Skill</p>
            <h1 className="mt-2 font-display text-h1">{skill.title}</h1>
            {skill.description && (
              <p className="mt-3 max-w-prose text-muted">{skill.description}</p>
            )}

            {skill.compatibleTools.length > 0 && (
              <div className="mt-4">
                <p className="meta">Compatible con</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {skill.compatibleTools.map((tool) => (
                    <li key={tool} className="tag">
                      {tool}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {skill.repositoryUrl && (
                <a
                  href={skill.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  Abrir repositorio ↗
                </a>
              )}
              {skill.homepageUrl && (
                <a
                  href={skill.homepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  Sitio oficial ↗
                </a>
              )}
            </div>
          </header>

          {methods.length > 0 && (
            <section aria-labelledby="instalacion" className="mt-8">
              <h2 id="instalacion" className="section-mark font-display text-h2">
                Cómo instalarla
              </h2>
              <p className="mt-1 text-sm text-muted">
                Estos comandos los ejecutas tú en tu propia terminal. UINexus sólo te los
                muestra.
              </p>

              {methods.length > 1 && (
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Herramienta"
                >
                  {methods.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active?.id === item.id}
                      onClick={() => setMethod(item.id)}
                      className="chip"
                    >
                      {item.tool}
                    </button>
                  ))}
                </div>
              )}

              {active && <InstallSteps method={active} />}
            </section>
          )}

          {skill.usageInstructions && (
            <section aria-labelledby="uso" className="mt-10">
              <h2 id="uso" className="section-mark font-display text-h2">
                Cómo usarla
              </h2>
              <p className="prose-block mt-3 max-w-prose whitespace-pre-line text-muted">
                {skill.usageInstructions}
              </p>
            </section>
          )}

          {methods.length === 0 && !skill.usageInstructions && (
            <div className="mt-8">
              <Notice>
                Esta Skill todavía no tiene instrucciones. Pregunta a tu docente o abre el
                repositorio.
              </Notice>
            </div>
          )}

          <div className="mt-10 border-t border-line pt-6">
            <Link href={`/aula/${courseId}`} className="btn btn-ghost">
              Volver a la materia
            </Link>
          </div>
        </article>
      )}
    </AulaScreen>
  );
}

function InstallSteps({ method }: { method: InstallMethod }) {
  return (
    <div className="mt-5">
      {method.title && <h3 className="font-medium">{method.title}</h3>}

      <ol className="mt-4 space-y-5">
        {method.steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-label tabular-nums">
              {index + 1}
            </span>

            <div className="min-w-0 flex-1">
              {step.type === 'text' && (
                <p className="max-w-prose whitespace-pre-line text-muted">{step.content}</p>
              )}

              {step.type === 'command' && (
                <div>
                  {/*
                    El comando se pinta como código y NUNCA se ejecuta. Lo único
                    que hace el botón es ponerlo en el portapapeles.
                  */}
                  <pre className="overflow-x-auto rounded-sm border border-line bg-sunken p-3 font-mono text-sm">
                    {step.content}
                  </pre>
                  <div className="mt-2">
                    <CopyButton value={step.content} label="Copiar comando" variant="ghost" />
                  </div>
                </div>
              )}

              {step.type === 'link' && (
                <a
                  href={step.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  {step.label} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
