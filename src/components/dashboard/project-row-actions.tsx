'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import type { ProjectRecord, Visibility } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/constants';
import { publicProjectPath, publicProjectUrl } from '@/lib/urls';

/**
 * Acciones de un proyecto.
 *
 * Sólo una acción destructiva y va detrás de una confirmación que exige
 * escribir el nombre: borrar un proyecto publicado rompe un enlace que quizá
 * está en una entrega. Todo lo demás es reversible y se hace de un clic.
 */
export function ProjectRowActions({
  project,
  onDeleted,
  onChanged,
}: {
  project: ProjectRecord;
  onDeleted: (projectId: string) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const url = publicProjectUrl(project);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Enlace copiado.');
    } catch {
      setNotice('No se pudo copiar. El enlace es: ' + url);
    }
    setOpen(false);
  }

  async function changeVisibility(next: Visibility): Promise<void> {
    setBusy(true);
    setOpen(false);
    if (!isFirebaseConfigured) {
      setNotice(`Modo demo: aquí cambiaría a "${STATUS_LABEL[next]}".`);
      setBusy(false);
      return;
    }
    try {
      const { updateProjectMetadata } = await import('@/lib/projects-client');
      await updateProjectMetadata({ projectId: project.id, status: next });
      setNotice(`Ahora es "${STATUS_LABEL[next]}".`);
      onChanged();
    } catch {
      setNotice('No se pudo cambiar la visibilidad. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    if (!isFirebaseConfigured) {
      onDeleted(project.id);
      setBusy(false);
      return;
    }
    try {
      const { deleteProject } = await import('@/lib/projects-client');
      await deleteProject({ projectId: project.id });
      onDeleted(project.id);
    } catch {
      setNotice('No se pudo eliminar. Inténtalo otra vez.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    const confirmId = `confirm-${project.id}`;
    return (
      <div className="panel border-danger/40 p-4" role="alertdialog" aria-labelledby={`${confirmId}-title`}>
        <h3 id={`${confirmId}-title`} className="font-medium">
          Eliminar “{project.title}”
        </h3>
        <p className="mt-1 text-sm text-muted">
          El enlace <span className="font-mono">{publicProjectPath(project)}</span> dejará
          de funcionar para siempre, también para quien ya lo tenga. Los archivos se borran.
        </p>
        <label htmlFor={confirmId} className="label mt-4">
          Escribe <span className="font-mono">{project.slug}</span> para confirmar
        </label>
        <input
          id={confirmId}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          className="field max-w-xs font-mono"
          autoComplete="off"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={confirmText !== project.slug || busy}
            onClick={() => void remove()}
          >
            {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setConfirming(false);
              setConfirmText('');
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-end gap-2" ref={containerRef}>
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
      {notice && (
        <span className="hidden text-sm text-muted lg:inline" aria-hidden="true">
          {notice}
        </span>
      )}

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        Acciones
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-60 rounded-md border border-line bg-raised py-1 text-left"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          {project.status !== 'draft' && (
            <>
              <a
                role="menuitem"
                href={publicProjectPath(project)}
                className="block px-3 py-2 text-sm no-underline hover:bg-sunken"
              >
                Abrir proyecto
              </a>
              <button
                type="button"
                role="menuitem"
                onClick={() => void copyLink()}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                Copiar enlace
              </button>
            </>
          )}

          <Link
            role="menuitem"
            href={`/dashboard/${project.id}/edit`}
            className="block px-3 py-2 text-sm no-underline hover:bg-sunken"
          >
            Editar información
          </Link>
          <Link
            role="menuitem"
            href={`/dashboard/${project.id}/edit#archivos`}
            className="block px-3 py-2 text-sm no-underline hover:bg-sunken"
          >
            Actualizar archivos
          </Link>

          <div className="my-1 border-t border-line" />
          <p className="meta px-3 py-1">Cambiar visibilidad</p>
          {(['published', 'unlisted', 'draft'] as Visibility[])
            .filter((option) => option !== project.status)
            .map((option) => (
              <button
                key={option}
                type="button"
                role="menuitem"
                onClick={() => void changeVisibility(option)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                {STATUS_LABEL[option]}
              </button>
            ))}

          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft"
            disabled={!user}
          >
            Eliminar proyecto
          </button>
        </div>
      )}
    </div>
  );
}
