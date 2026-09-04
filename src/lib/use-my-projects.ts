'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@/components/auth/auth-provider';
import { apiFetch } from './api-client';
import { isFirebaseConfigured } from './firebase/config';
import { DEMO_PROJECTS } from './data/demo';
import type { ProjectRecord } from './types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Proyectos propios, para el panel.
 *
 * Antes esto consultaba Firestore desde el navegador filtrando por `ownerId`,
 * que era justo lo que las reglas exigían para permitir ver borradores. Ahora
 * la consulta la hace el servidor a partir del uid del token: no hay ningún
 * parámetro que manipular, así que la pregunta "¿y si pido los de otro?" ya no
 * tiene dónde formularse.
 */
export function useMyProjects(user: SessionUser | null): {
  projects: ProjectRecord[];
  state: LoadState;
  reload: () => void;
  removeLocal: (projectId: string) => void;
} {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const removeLocal = useCallback((projectId: string) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
  }, []);

  useEffect(() => {
    let active = true;

    if (!user) {
      setProjects([]);
      setState('ready');
      return;
    }

    if (!isFirebaseConfigured) {
      setProjects(DEMO_PROJECTS.filter((project) => project.ownerHandle === user.handle));
      setState('ready');
      return;
    }

    void (async () => {
      try {
        const data = await apiFetch<{ projects: ProjectRecord[] }>('/api/projects');
        if (!active) return;
        setProjects(data.projects);
        setState('ready');
      } catch {
        if (active) setState('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [user, nonce]);

  return { projects, state, reload, removeLocal };
}
