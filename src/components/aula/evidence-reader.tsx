'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LEGACY_CODE_LANGUAGE, programmingLanguageLabel } from '@/lib/constants';
import { aiWorklogToMarkdown, normalizeAIResult } from '@/lib/ai-worklog';
import { academicFileUrl } from '@/lib/aula-client';
import type {
  AIWorklogData,
  CodeData,
  ExternalLinkData,
  FreeformData,
  MediaData,
  NexBookSubmissionData,
  ResearchData,
  ResourceSelectionData,
  StepDeliverable,
  StepEvidence,
  WebProjectData,
} from '@/lib/types';
import { Notice } from './aula-ui';
import { CodeEditor } from './code-editor';
import { NexBookStudio } from '@/components/studio/nexbook-studio';
import { LinkCard } from './link-card';
import { CopyButton } from './copy-button';
import { MarkdownContent } from './markdown-content';

/**
 * Lo que alguien entregó en una Parte, leído por quien corrige.
 *
 * Vive aparte porque lo usan DOS pantallas docentes: el resultado del grupo,
 * que recorre las aportaciones de cada participante, y el visor de una entrega
 * completa. Duplicarlo habría garantizado que se separaran con el tiempo, y con
 * ellos lo que cada pantalla es capaz de mostrar: hasta ahora el visor no sabía
 * leer una actividad por partes y enseñaba «(sin respuesta)» sobre un
 * laboratorio entero.
 *
 * Todo lo que se pinta aquí es SÓLO LECTURA, y no como promesa sino como
 * imposibilidad: ni Studio ni el editor de código reciben `onChange`, así que
 * no hay ninguna ruta desde esta pantalla hacia una escritura.
 */

export interface ReadableStep {
  /** Sólo hace falta el primero: es el que rellena el formulario. */
  deliverables: readonly StepDeliverable[];
}

export function EvidenceReader({
  assignmentId,
  step,
  evidence,
}: {
  assignmentId: string;
  step: ReadableStep;
  evidence: StepEvidence;
}) {
  const type = step.deliverables[0]?.type ?? 'none';

  if (type === 'structured') {
    const answers = (evidence.data as ResearchData).answers ?? [];
    const byId = new Map(answers.map((answer) => [answer.questionId, answer.value]));
    return (
      <dl className="space-y-3">
        {(step.deliverables[0]?.questions ?? []).map((question) => (
          <div key={question.id}>
            <dt className="meta">{question.prompt}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-muted">
              {byId.get(question.id) || <span className="text-subtle">(sin respuesta)</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (type === 'ai_worklog') {
    const data = evidence.data as AIWorklogData;
    const result = normalizeAIResult(data);
    const fields = [
      ['Herramienta', data.provider],
      ['Modelo', data.model],
      ['Objetivo', data.objective],
      ['Prompt utilizado', data.prompt],
      ['Qué utilizó', data.whatWasUsed],
      ['Qué modificó', data.whatWasChanged],
      ['Qué descartó', data.whatWasDiscarded],
      ['Análisis', data.studentAnalysis],
    ] as const;
    return (
      <div className="space-y-3">
        {fields.map(([label, value]) =>
          value ? (
            <div key={label}>
              <p className="meta">{label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{value}</p>
            </div>
          ) : null
        )}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="meta">Resultado</p>
            {result.content && <CopyButton value={result.content} label="Copiar resultado" variant="ghost" />}
          </div>
          <div className="mt-1">
            <MarkdownContent content={result.content} format={result.format} />
          </div>
        </div>
        <CopyButton value={aiWorklogToMarkdown(data)} label="Copiar AI Worklog" />
        {data.conversationUrl && <LinkCard url={data.conversationUrl} compact />}
      </div>
    );
  }

  if (type === 'url') {
    const data = evidence.data as ExternalLinkData;
    return data.url ? (
      <LinkCard url={data.url} title={data.title} description={data.description} />
    ) : null;
  }

  if (type === 'project') {
    const data = evidence.data as WebProjectData;
    return (
      <div className="text-sm text-muted">
        {data.projectPath && (
          <Link href={data.projectPath} className="font-medium underline">
            {data.projectTitle || 'Abrir proyecto'}
          </Link>
        )}
        {data.note && <p className="mt-2 whitespace-pre-wrap">{data.note}</p>}
      </div>
    );
  }

  if (type === 'file' || type === 'image' || type === 'video') {
    return <MediaEvidence assignmentId={assignmentId} data={evidence.data as MediaData} />;
  }

  if (type === 'nexbook') {
    return <NexBookEvidence data={evidence.data as NexBookSubmissionData} />;
  }

  if (type === 'code') {
    return (
      <CodeEvidence
        assignmentId={assignmentId}
        data={evidence.data as CodeData}
        deliverable={step.deliverables[0]}
      />
    );
  }

  if (type === 'resource_reference') {
    const data = evidence.data as ResourceSelectionData;
    return (
      <div className="text-sm text-muted">
        {data.refs?.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {data.refs.map((ref) => <li key={`${ref.kind}-${ref.id}`}>{ref.kind}: {ref.id}</li>)}
          </ul>
        )}
        {data.note && <p className="mt-2 whitespace-pre-wrap">{data.note}</p>}
      </div>
    );
  }

  const data = evidence.data as FreeformData;
  return (
    <div className="space-y-3 text-sm text-muted">
      {data.text && <p className="whitespace-pre-wrap">{data.text}</p>}
      {(data.links ?? []).map((link) => (
        <LinkCard key={`${link.label}-${link.url}`} url={link.url} title={link.label} compact />
      ))}
      {evidence.note && <p className="whitespace-pre-wrap">{evidence.note}</p>}
    </div>
  );
}

/**
 * El NexBook entregado, tal y como se entregó.
 *
 * Se pinta el SNAPSHOT que viajó en la evidencia, no el documento vivo. Es la
 * diferencia entre calificar lo que alguien entregó y calificar lo que tenga
 * ahora mismo: el segundo cambia mientras se corrige.
 *
 * En sólo lectura, y eso no es una promesa sino una imposibilidad: `editable` a
 * `false` deja Studio sin botones de añadir, mover ni borrar, y el editor de
 * cada bloque sin `onChange`. No hay ninguna ruta desde aquí hacia una
 * escritura. Ejecutar una celda sí se puede —hace falta para comprobar la
 * salida— y no toca nada: el resultado se pinta y se olvida.
 */
function NexBookEvidence({ data }: { data: NexBookSubmissionData }) {
  const blocks = data.snapshot?.blocks ?? [];

  if (blocks.length === 0) {
    return <p className="text-sm text-subtle">(entregó un NexBook vacío)</p>;
  }

  return (
    <div className="space-y-3">
      <p className="meta">
        NexBook · {blocks.length} {blocks.length === 1 ? 'bloque' : 'bloques'}
        {data.revision ? ` · versión ${data.revision}` : ''}
      </p>
      <NexBookStudio
        document={data.snapshot}
        // El snapshot es inmutable: los cambios no se propagan a ninguna parte.
        onChange={() => undefined}
        editable={false}
      />
    </div>
  );
}

/**
 * El código entregado, legible y EJECUTABLE sin descargar nada.
 *
 * Es lo que hace útil la revisión: leer veinte entregas de R descargando veinte
 * archivos no lo hace nadie. Se muestra en el mismo editor que usó el alumnado
 * —resaltado, números de línea, búsqueda— en modo de sólo lectura, y se puede
 * ejecutar para comprobar qué imprime.
 *
 * Ejecutar aquí NO TOCA LA ENTREGA, y no es una promesa: no hay por dónde. El
 * editor va sin `onChange` y sin `beforeExecute`, así que no existe ninguna
 * ruta desde este componente hacia una escritura. La salida se pinta y se
 * olvida.
 *
 * El lenguaje sale del PASO. Un registro antiguo puede traerlo sólo en la
 * evidencia, y por eso se lee del paso primero y del cuerpo después.
 */
function CodeEvidence({
  assignmentId,
  data,
  deliverable,
}: {
  assignmentId: string;
  data: CodeData;
  deliverable?: StepDeliverable;
}) {
  const language = deliverable?.language ?? data.language ?? LEGACY_CODE_LANGUAGE;

  return (
    <div className="space-y-3 text-sm text-muted">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="meta">Código · {programmingLanguageLabel(language)}</p>
          {data.code && <CopyButton value={data.code} label="Copiar código" variant="ghost" />}
        </div>
        {data.code ? (
          <div className="mt-2">
            <CodeEditor
              language={language}
              value={data.code}
              readOnly
              // La revisión siempre puede ejecutar. El interruptor del paso
              // decide qué ve el ALUMNADO; quien corrige necesita comprobar la
              // salida en cualquier caso.
              executionEnabled
              height={320}
              ariaLabel={`Código entregado en ${programmingLanguageLabel(language)}`}
            />
          </div>
        ) : (
          <p className="mt-1 text-subtle">(no escribió código)</p>
        )}
      </div>

      {data.storageKey && (
        <MediaEvidence
          assignmentId={assignmentId}
          data={{
            url: '',
            storageKey: data.storageKey,
            fileName: data.fileName,
            kind: 'file',
            note: '',
          }}
        />
      )}

      {data.explanation && (
        <div>
          <p className="meta">Explicación</p>
          <p className="mt-1 whitespace-pre-wrap">{data.explanation}</p>
        </div>
      )}
    </div>
  );
}

function MediaEvidence({ assignmentId, data }: { assignmentId: string; data: MediaData }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare(): Promise<void> {
    setError(null);
    try {
      const result = await academicFileUrl(assignmentId, data.storageKey);
      setUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo abrir el archivo.');
    }
  }

  return (
    <div className="space-y-2 text-sm text-muted">
      {data.storageKey && !url && (
        <button type="button" onClick={() => void prepare()} className="btn btn-secondary btn-sm">
          Preparar {data.fileName || 'archivo'}
        </button>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
          Abrir {data.fileName || 'archivo'} ↗
        </a>
      )}
      {data.url && <LinkCard url={data.url} title={data.fileName} compact />}
      {data.note && <p className="whitespace-pre-wrap">{data.note}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
