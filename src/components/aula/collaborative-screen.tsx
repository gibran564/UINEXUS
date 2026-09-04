'use client';

import Link from 'next/link';
import { useApi, type AssignmentDetail } from '@/lib/aula-client';
import { AulaScreen, Crumbs } from './aula-ui';
import { CollaborativeDocument } from './collaborative-view';

/**
 * La actividad del grupo, en su propia página.
 *
 * Para el profesorado la vista conjunta vive como pestaña dentro de la tarea,
 * junto a las entregas. Para el alumnado tiene página propia, y la razón es de
 * uso: un estudiante entra a leer lo que escribió el grupo, no a administrar la
 * tarea. Meterle pestañas alrededor sería pedirle que entienda una pantalla de
 * gestión para hacer una lectura.
 */
export function CollaborativeScreen({
  courseId,
  assignmentId,
}: {
  courseId: string;
  assignmentId: string;
}) {
  const { data, state, error } = useApi<AssignmentDetail>(`/api/assignments/${assignmentId}`);

  return (
    <AulaScreen
      state={state}
      error={error}
      next={`/aula/${courseId}/tareas/${assignmentId}/conjunta`}
    >
      {data && (
        <div>
          <Crumbs
            items={[
              { href: '/aula', label: 'Aula' },
              { href: `/aula/${courseId}`, label: data.courseName },
              {
                href: `/aula/${courseId}/tareas/${assignmentId}`,
                label: data.assignment.title,
              },
              { label: 'Actividad del grupo' },
            ]}
          />

          <header className="mt-4 border-b border-line pb-6">
            <p className="meta">Actividad colaborativa</p>
            <h1 className="mt-2 font-display text-h1">{data.assignment.title}</h1>
            {data.assignment.description && (
              <p className="mt-3 max-w-prose text-muted">{data.assignment.description}</p>
            )}
          </header>

          <div className="mt-8">
            <CollaborativeDocument assignmentId={assignmentId} />
          </div>

          <div className="mt-10 border-t border-line pt-6">
            <Link
              href={`/aula/${courseId}/tareas/${assignmentId}/entrega`}
              className="btn btn-primary"
            >
              Ir a mi aportación
            </Link>
          </div>
        </div>
      )}
    </AulaScreen>
  );
}
