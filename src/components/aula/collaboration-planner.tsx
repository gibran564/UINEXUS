'use client';

import { useMemo } from 'react';
import { distributeRoundRobin } from '@/lib/collaborative';
import type { GroupAssignment, ResearchQuestion } from '@/lib/types';
import type { RosterRow } from '@/lib/aula-client';
import { Notice } from './aula-ui';

/**
 * Reparto de conceptos entre estudiantes (§5, §6, §9).
 *
 * Dos decisiones de interfaz que salen directamente del encargo:
 *
 *  · Se reparte por CONCEPTO, no por campo. Un concepto son tres campos
 *    —definición, fuente, comentario— y obligar a elegir a la misma persona tres
 *    veces sería inaceptable con doce conceptos.
 *  · «Distribuir automáticamente» es un punto de partida, no una decisión
 *    final: reparte por turnos y deja todo editable. La docente casi siempre
 *    querrá mover una o dos cosas, y un reparto que no se pueda tocar acaba sin
 *    usarse.
 *
 * Un concepto sin nadie marcado queda ABIERTO a todo el grupo. Se dice con
 * todas las letras debajo de cada uno, porque es lo contrario de lo que la
 * gente asume al ver una lista de casillas vacías.
 */
export function CollaborationPlanner({
  questions,
  students,
  assignments,
  onChange,
}: {
  questions: ResearchQuestion[];
  students: RosterRow[];
  assignments: GroupAssignment[];
  onChange: (assignments: GroupAssignment[]) => void;
}) {
  /** Los conceptos en el orden en que se escribieron, sin repetir. */
  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const question of questions) {
      if (!question.groupId) continue;
      if (!seen.has(question.groupId)) {
        seen.set(question.groupId, question.group ?? question.prompt);
      }
    }
    return [...seen.entries()].map(([groupId, title]) => ({ groupId, title }));
  }, [questions]);

  const byGroup = new Map(assignments.map((entry) => [entry.groupId, entry.assignedTo]));

  function toggle(groupId: string, handle: string): void {
    const current = byGroup.get(groupId) ?? [];
    const next = current.includes(handle)
      ? current.filter((item) => item !== handle)
      : [...current, handle];

    const others = assignments.filter((entry) => entry.groupId !== groupId);
    onChange([...others, { groupId, assignedTo: next }]);
  }

  function distribute(): void {
    onChange(
      distributeRoundRobin(
        groups.map((group) => group.groupId),
        students.map((student) => student.handle)
      )
    );
  }

  if (groups.length === 0) {
    return (
      <Notice>
        Añade primero los conceptos de la actividad. Después podrás repartirlos entre el grupo.
      </Notice>
    );
  }

  if (students.length === 0) {
    return (
      <Notice>
        Todavía no hay nadie inscrito en la materia. Sin reparto, cada concepto queda abierto a
        todo el grupo, que es un punto de partida perfectamente válido.
      </Notice>
    );
  }

  const fieldsOf = (groupId: string) =>
    questions.filter((question) => question.groupId === groupId);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {groups.length} conceptos · {students.length} estudiantes
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={distribute} className="btn btn-secondary btn-sm">
            Distribuir automáticamente
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="btn btn-ghost btn-sm"
          >
            Quitar todo el reparto
          </button>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {groups.map((group) => {
          const chosen = byGroup.get(group.groupId) ?? [];
          return (
            <li key={group.groupId} className="panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{group.title}</h3>
                <p className="text-label text-subtle">
                  {fieldsOf(group.groupId)
                    .map((question) => question.prompt)
                    .join(' · ')}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {students.map((student) => {
                  const active = chosen.includes(student.handle);
                  return (
                    <button
                      key={student.handle}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(group.groupId, student.handle)}
                      className="chip"
                    >
                      {student.displayName}
                    </button>
                  );
                })}
              </div>

              <p className="hint">
                {chosen.length === 0
                  ? 'Sin responsable: cualquiera del grupo puede responderlo.'
                  : chosen.length === 1
                    ? 'Sólo esa persona puede responderlo.'
                    : `${chosen.length} personas. Cada una escribe su propia aportación.`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
