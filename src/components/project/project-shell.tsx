'use client';

import Link from 'next/link';
import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '@/components/ui/logo';
import { profilePath } from '@/lib/urls';

export const PROJECT_SHELL_SANDBOX = 'allow-scripts allow-popups allow-forms';

export function projectShareData(title: string, publicUrl: string) {
  return { title, url: publicUrl };
}

export function ProjectShell({
  title,
  handle,
  publicUrl,
  originUrl,
}: {
  title: string;
  handle: string;
  publicUrl: string;
  originUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice('Enlace copiado.');
    } catch {
      setNotice(`No se pudo copiar. El enlace es ${publicUrl}`);
    }
  }

  async function share(): Promise<void> {
    if ('share' in navigator) {
      try {
        await navigator.share(projectShareData(title, publicUrl));
        return;
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
      }
    }
    await copyLink();
  }

  async function enterFullscreen(): Promise<void> {
    const shell = document.getElementById('project-shell');
    if (!shell?.requestFullscreen) {
      setNotice('La pantalla completa no está disponible en este navegador.');
      return;
    }
    await shell.requestFullscreen().catch(() => {
      setNotice('No se pudo abrir a pantalla completa.');
    });
  }

  return (
    <div id="project-shell" className="fixed inset-0 z-[90] h-dvh w-screen bg-white">
      <iframe
        src={originUrl}
        title={title}
        referrerPolicy="no-referrer"
        sandbox={PROJECT_SHELL_SANDBOX}
        allowFullScreen
        className="block h-full w-full border-0 bg-white"
      />

      <div ref={menuRef} className="absolute top-3 right-3">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Opciones del proyecto"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 items-center gap-2 rounded-sm border border-line-strong bg-raised px-3 text-sm font-medium text-fg"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <LogoMark size={17} />
          UINexus
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Opciones del proyecto"
            className="mt-2 w-56 rounded-md border border-line bg-raised py-1 text-left text-fg"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void copyLink()}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-sunken"
            >
              Copiar enlace
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void share()}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-sunken"
            >
              Compartir…
            </button>
            <Link
              role="menuitem"
              href={profilePath(handle)}
              className="flex min-h-11 items-center px-3 py-2 text-sm no-underline hover:bg-sunken"
            >
              Ver perfil
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void enterFullscreen()}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-sunken"
            >
              Pantalla completa
            </button>
            <a
              role="menuitem"
              href={originUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center border-t border-line px-3 py-2 text-sm no-underline hover:bg-sunken"
            >
              Abrir origen ↗
            </a>
          </div>
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`absolute right-3 bottom-3 max-w-sm rounded-sm border border-line bg-raised px-3 py-2 text-sm text-fg ${notice ? '' : 'sr-only'}`}
        style={notice ? { boxShadow: 'var(--shadow-pop)' } : undefined}
      >
        {notice}
      </p>
    </div>
  );
}
