import type { Project, ProjectRecord } from '../types';

/**
 * Única frontera entre lo que persiste el servidor y lo que ve el navegador.
 *
 * Quita `ownerId` (UID de Firebase), `ownerHandle` duplicado, `entryFile`
 * (ruta interna de Storage) y los campos de moderación. Si un componente
 * necesita algo de eso, es señal de que la lógica está en el sitio equivocado.
 */
export function toPublicProject(record: ProjectRecord): Project {
  const {
    ownerId: _ownerId,
    ownerHandle: _ownerHandle,
    entryFile: _entryFile,
    hiddenByAdmin: _hiddenByAdmin,
    reportCount: _reportCount,
    ...project
  } = record;
  return project;
}

export function toPublicProjects(records: readonly ProjectRecord[]): Project[] {
  return records.map(toPublicProject);
}
