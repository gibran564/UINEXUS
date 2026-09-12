'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { Notice } from './aula-ui';

/**
 * Preparar el laboratorio de una parte, sin salir de la actividad.
 *
 * ## El problema que cierra
 *
 * Hasta ahora, preparar la plantilla de un NexLab obligaba a este recorrido:
 *
 * ```
 * crear la actividad → publicarla → volver a entrar → abrir el paso → editar
 * ```
 *
 * Publicar para poder preparar es al revés de como se trabaja: la actividad
 * llega al grupo antes de estar lista. Aquí la plantilla se prepara ANTES, y lo
 * único que hace falta es que la actividad exista como borrador —que no avisa a
 * nadie—, porque la plantilla cuelga de la actividad y del paso.
 *
 * ## Es el mismo editor
 *
 * No hay `TeacherNexLabEditor` ni `NexBookLiteEditor`. Esto monta `NexBookStep`,
 * que monta `NexBookStudio`: exactamente el mismo componente que usa el
 * alumnado. La plantilla que se ve aquí es la estructura que recibirá cada
 * estudiante, no una aproximación.
 *
 * El servidor decide que esto es la PLANTILLA (`role: 'template'`) porque quien
 * pregunta es docente de la materia. El navegador no lo declara ni puede.
 *
 * ## Lo que NO hace
 *
 * No crea ninguna entrega, no suplanta a nadie y no escribe progreso. La
 * plantilla es un NexBook de la docente; la copia de cada estudiante se crea la
 * primera vez que ese estudiante abre la parte.
 *
 * ## Por qué entra por `next/dynamic`
 *
 * `NexBookStudio` arrastra el editor de hojas, el de bloques y, en cuanto hay un
 * bloque de código, Monaco y los motores de ejecución. Una actividad de
 * «responde con tres conclusiones» no puede pagar eso. Con la carga diferida,
 * el constructor sólo lo descarga cuando alguien pulsa «Preparar NexLab».
 */

const NexBookStep = dynamic(
  async () => (await import('@/components/studio/nexbook-step')).NexBookStep,
  {
    ssr: false,
    loading: () => <p className="py-10 text-center text-muted">Abriendo el laboratorio…</p>,
  }
);

export function NexLabTemplatePanel({
  assignmentId,
  stepId,
  partLabel,
  onClose,
}: {
  assignmentId: string;
  stepId: string;
  /** Cómo se llama la parte, para que se sepa cuál se está preparando. */
  partLabel: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * El foco entra al panel al abrirlo y Escape lo cierra.
   *
   * Sin esto, quien navega con teclado seguiría en el botón «Preparar NexLab»
   * del formulario de detrás, y tabular le llevaría por los campos de la
   * actividad en lugar de por el laboratorio que acaba de abrir.
   */
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plantilla de NexLab · ${partLabel}`}
      className="fixed inset-0 z-50 flex flex-col bg-bg"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-label text-subtle">Estás editando la plantilla</p>
          <h2 className="truncate font-display text-h3">{partLabel}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="btn btn-secondary btn-sm"
        >
          ← Volver a la actividad
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4">
            <Notice>
              Lo que prepares aquí es lo que cada estudiante recibirá como punto de partida. Los
              bloques marcados como no editables se leerán pero no se podrán tocar. Se guarda solo.
            </Notice>
          </div>

          <NexBookStep assignmentId={assignmentId} stepId={stepId} variant="template" />
        </div>
      </div>
    </div>
  );
}
