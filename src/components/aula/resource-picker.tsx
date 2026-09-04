'use client';

import Link from 'next/link';
import { useApi, type CourseLibrary } from '@/lib/aula-client';
import type { ResourceRef } from '@/lib/types';
import { Notice } from './aula-ui';

/**
 * Elegir qué prompts y Skills recomienda una tarea (§20, §27).
 *
 * Se guardan REFERENCIAS por id, no copias: si la docente corrige el prompt, la
 * tarea que lo recomienda enseña la corrección. La alternativa —copiar el texto
 * dentro de la tarea— produce doce versiones del mismo prompt que envejecen por
 * separado, y nadie sabe cuál es la buena.
 */
export function ResourcePicker({
  courseId,
  value,
  onChange,
  label = 'Recursos recomendados',
  hint = 'Prompts y Skills de la materia que quieres que el alumnado tenga a mano.',
}: {
  courseId: string;
  value: ResourceRef[];
  onChange: (refs: ResourceRef[]) => void;
  label?: string;
  hint?: string;
}) {
  const library = useApi<CourseLibrary>(`/api/courses/${courseId}/library`);
  const { state } = library;

  /**
   * Sólo se puede recomendar lo que YA está en la biblioteca.
   *
   * La respuesta trae también las propuestas pendientes —el profesorado las
   * modera y el alumnado ve las suyas—, pero recomendar algo sin aprobar lo
   * publicaría por la puerta de atrás: aparecería en la tarea de todo el grupo
   * sin haber pasado por revisión. El servidor lo rechaza igualmente
   * (`assertResourcesBelongTo`); esto evita ofrecerlo.
   */
  const data = library.data
    ? {
        prompts: library.data.prompts.filter((item) => item.status === 'approved'),
        skills: library.data.skills.filter((item) => item.status === 'approved'),
      }
    : null;

  const has = (kind: ResourceRef['kind'], id: string) =>
    value.some((ref) => ref.kind === kind && ref.id === id);

  const toggle = (kind: ResourceRef['kind'], id: string) =>
    onChange(
      has(kind, id)
        ? value.filter((ref) => !(ref.kind === kind && ref.id === id))
        : [...value, { kind, id }]
    );

  const empty = state === 'ready' && !data?.prompts.length && !data?.skills.length;

  return (
    <section aria-labelledby="recursos-ia">
      <h2 id="recursos-ia" className="section-mark font-display text-h3">
        {label}
      </h2>
      <p className="mt-1 text-sm text-muted">{hint}</p>

      {state === 'loading' && <p className="mt-4 text-muted">Cargando la biblioteca…</p>}

      {empty && (
        <div className="mt-4">
          <Notice>
            Todavía no hay recursos en esta materia.{' '}
            <Link href={`/aula/${courseId}?tab=resources`} className="underline">
              Crea un prompt o una Skill
            </Link>{' '}
            y vuelve a esta tarea.
          </Notice>
        </div>
      )}

      {data && data.prompts.length > 0 && (
        <fieldset className="mt-4">
          <legend className="label">Prompts</legend>
          <ul className="space-y-1">
            {data.prompts.map((prompt) => (
              <li key={prompt.id}>
                <label className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={has('prompt', prompt.id)}
                    onChange={() => toggle('prompt', prompt.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{prompt.title}</span>
                    {prompt.description && (
                      <span className="block text-sm text-muted">{prompt.description}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {data && data.skills.length > 0 && (
        <fieldset className="mt-4">
          <legend className="label">Skills</legend>
          <ul className="space-y-1">
            {data.skills.map((skill) => (
              <li key={skill.id}>
                <label className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={has('skill', skill.id)}
                    onChange={() => toggle('skill', skill.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{skill.title}</span>
                    {skill.compatibleTools.length > 0 && (
                      <span className="block text-label text-subtle">
                        {skill.compatibleTools.join(' · ')}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </section>
  );
}
