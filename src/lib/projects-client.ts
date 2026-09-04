'use client';

import { apiFetch } from './api-client';
import type { ProjectMetadataInput } from './schemas';
import type { Visibility } from './types';

/**
 * Operaciones sobre proyectos que necesitan autoridad de servidor.
 *
 * Sustituye a `firebase/functions.ts`, que llamaba a Cloud Functions
 * invocables. El contrato para quien lo usa es el mismo —una promesa que
 * resuelve o lanza— y por eso los componentes del panel apenas cambian: lo que
 * cambió es quién está al otro lado.
 */

export function updateProjectMetadata(input: {
  projectId: string;
  metadata?: ProjectMetadataInput;
  status?: Visibility;
}): Promise<void> {
  const { projectId, ...body } = input;
  return apiFetch<{ status: Visibility }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body,
  }).then(() => {});
}

export function deleteProject(input: { projectId: string }): Promise<void> {
  return apiFetch<{ ok: true }>(`/api/projects/${input.projectId}`, {
    method: 'DELETE',
  }).then(() => {});
}

export function updateProfile(input: {
  displayName: string;
  bio?: string;
  program?: string;
}): Promise<void> {
  return apiFetch<{ ok: true }>('/api/profile', { method: 'PATCH', body: input }).then(() => {});
}

export function reportProject(input: {
  projectId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  return apiFetch<{ ok: true }>('/api/reports', { method: 'POST', body: input }).then(() => {});
}
