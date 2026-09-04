'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { reportSchema } from '@/lib/schemas';

const REASONS = [
  { value: 'inappropriate', label: 'Contenido inapropiado' },
  { value: 'plagiarism', label: 'Parece copiado sin crédito' },
  { value: 'malware', label: 'Hace algo dañino o engañoso' },
  { value: 'privacy', label: 'Expone datos personales' },
  { value: 'other', label: 'Otro motivo' },
] as const;

/**
 * Reportar un proyecto.
 *
 * Vive al final de la página, en texto pequeño: es una salida de emergencia,
 * no una acción que deba competir con "Abrir proyecto". Se requiere sesión
 * para limitar suplantación y abuso; sólo el profesorado lee los reportes.
 */
export function ReportProject({ projectId, title }: { projectId: string; title: string }) {
  const { user, isDemo } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = reportSchema.safeParse({
      projectId,
      reason: data.get('reason'),
      details: String(data.get('details') ?? ''),
    });

    if (!parsed.success) {
      setState('error');
      setMessage('Elige un motivo antes de enviar.');
      return;
    }

    setState('sending');

    if (!user) {
      setState('error');
      setMessage('Inicia sesión para enviar un reporte.');
      return;
    }

    if (isDemo) {
      setState('sent');
      return;
    }

    try {
      // Quien reporta no elige el estado ni quién figura como denunciante: el
      // servidor pone `open` y toma el uid del token.
      const { reportProject } = await import('@/lib/projects-client');
      await reportProject(parsed.data);
      setState('sent');
    } catch {
      setState('error');
      setMessage('No se pudo enviar el reporte. Vuelve a intentarlo en un momento.');
    }
  }

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm text-muted">
        Gracias. El profesorado del curso revisará “{title}”.
      </p>
    );
  }

  if (!user) {
    return (
      <p className="text-sm text-muted">
        ¿Detectaste un problema?{' '}
        <Link href="/login" className="underline underline-offset-2">
          Inicia sesión para reportarlo
        </Link>
        .
      </p>
    );
  }

  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-muted hover:text-fg">
        Reportar este proyecto
      </summary>

      <form onSubmit={(event) => void submit(event)} className="panel mt-3 max-w-md space-y-4 p-4">
        <fieldset>
          <legend className="label">¿Qué ocurre con este proyecto?</legend>
          <div className="space-y-1.5">
            {REASONS.map((reason) => (
              <label key={reason.value} className="flex min-h-9 items-center gap-2">
                <input type="radio" name="reason" value={reason.value} required />
                <span>{reason.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="report-details" className="label">
            Cuéntanos algo más <span className="font-normal text-subtle">(opcional)</span>
          </label>
          <textarea id="report-details" name="details" rows={3} maxLength={500} className="field" />
        </div>

        {state === 'error' && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}

        <button type="submit" className="btn btn-secondary btn-sm" disabled={state === 'sending'}>
          {state === 'sending' ? 'Enviando…' : 'Enviar reporte'}
        </button>
      </form>
    </details>
  );
}
