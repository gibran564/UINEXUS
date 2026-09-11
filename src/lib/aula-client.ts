'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, currentIdToken, uploadSigned } from './api-client';
import { getClientAuth } from './firebase/client';
import { isFirebaseConfigured } from './firebase/config';
import type {
  NexBook,
  NexBookDocument,
  NexBookImageMimeType,
  NexBookPublication,
  NexBookPublicVisibility,
  Workspace,
  Assignment,
  AssignmentMaterial,
  AssignmentMaterialKind,
  CollaborativeView,
  ContributionState,
  CourseResource,
  CourseDetail,
  CourseMember,
  Project,
  PromptTemplate,
  SkillResource,
  Submission,
  SubmissionStatus,
} from './types';

/**
 * Cliente del aula.
 *
 * Todas las pantallas del aula son de CLIENTE y no Server Components, y no es
 * por gusto: el servidor de esta aplicación autentica con el ID token de
 * Firebase en la cabecera `Authorization`, no con una cookie de sesión. Un
 * Server Component no tiene ese token, así que no podría saber quién pide la
 * página. Mientras la sesión sea un token en memoria del navegador, el aula
 * —que es privada de arriba abajo— se pinta desde el cliente contra `/api/*`.
 *
 * La consecuencia buena es que hay UN solo sitio donde se decide qué se ve: las
 * rutas de API. La mala es que estas pantallas no se indexan ni se prerrenderan,
 * cosa que a una pantalla privada le da exactamente igual.
 */

export interface AulaCourseCard {
  course: CourseDetail;
  role: 'teacher' | 'student';
  assignments: number;
  attention: number;
  collaborative: { assignmentId: string; title: string; done: number; total: number } | null;
}

export interface AulaPendingItem {
  assignment: Assignment;
  courseId: string;
  courseName: string;
  status: SubmissionStatus | null;
  myConcepts: number | null;
  resources: { prompts: number; skills: number };
}

export interface AulaHome {
  role: 'student' | 'teacher' | 'admin';
  displayName: string;
  courses: AulaCourseCard[];
  pending: AulaPendingItem[];
}

export interface AssignmentProgress {
  assignmentId: string;
  assigned: number;
  submitted: number;
  reviewed: number;
  pending: number;
}

export interface CourseOverview {
  course: CourseDetail;
  assignments: Assignment[];
  progress: AssignmentProgress[];
  myStatus: { assignmentId: string; status: SubmissionStatus | null }[];
  unreviewed: number;
}

export interface RosterRow extends CourseMember {
  assigned: number;
  submitted: number;
  reviewed: number;
  pending: number;
  worklogs: number;
}

export interface AssignmentDetail {
  assignment: Assignment;
  courseName: string;
  courseId: string;
  viewerRole: 'teacher' | 'student';
  submission: Submission | null;
  /** Conceptos que le tocan a quien pregunta. Vacío en modo individual. */
  myGroupIds: string[];
  /** Pasos del workflow que le tocan. Siempre al menos uno. */
  myStepIds: string[];
  /** Prompts y Skills recomendados, ya resueltos por el servidor. */
  resources: { prompts: PromptTemplate[]; skills: SkillResource[] };
  /**
   * Fichas de las herramientas que mencionan los pasos, por id. Enriquecen la
   * vista; el nombre a mostrar sale siempre de `step.tool.toolNames`.
   */
  stepTools: Record<string, { id: string; title: string; url: string | null; description: string }>;
}

export interface CourseResources {
  prompts: PromptTemplate[];
  skills: SkillResource[];
  viewerRole: 'teacher' | 'student';
}

/** La biblioteca completa: prompts, Skills y recursos generales. */
export interface CourseLibrary extends CourseResources {
  resources: CourseResource[];
  /** Propuestas esperando revisión. Cero para el alumnado. */
  pendingReview: number;
}

export interface SubmissionsPage {
  submissions: Submission[];
  missing: CourseMember[];
  progress: Omit<AssignmentProgress, 'assignmentId'> | null;
}

export interface StudentInCourse {
  student: CourseMember;
  academicProfile: {
    enrollmentNumber?: string | null;
    semester?: string | null;
    career?: string | null;
  } | null;
  courseName: string;
  collaborative: {
    assignmentId: string;
    assignmentTitle: string;
    concepts: { groupId: string; title: string; state: ContributionState }[];
  }[];
  assignments: { assignment: Assignment; submission: Submission | null }[];
  projects: Project[];
  totals: {
    assigned: number;
    submitted: number;
    pending: number;
    reviewed: number;
    worklogs: number;
  };
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Carga con recarga explícita y mensaje de error legible.
 *
 * Se repite en todas las pantallas del aula, así que vive aquí una vez. El
 * error se guarda como texto y no como booleano porque la API devuelve mensajes
 * escritos para que los lea una persona («Esa tarea no existe»), y tirarlos
 * para pintar «Algo falló» sería empeorarlos a propósito.
 */
export function useApi<T>(path: string | null): {
  data: T | null;
  state: LoadState;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path) return;

    /**
     * El aula no tiene modo demo, y decirlo es mas honesto que fingirlo.
     * El resto de UINexus si lo tiene porque sirve datos de ejemplo en memoria;
     * aqui todo depende de quien eres, y sin identidad no hay materia, ni
     * tarea, ni entrega que ensenar. Un aula de mentira solo confundiria sobre
     * si la plataforma esta bien configurada.
     */
    if (!isFirebaseConfigured) {
      setError(
        'El aula necesita la base de datos real. Estas en modo demo: configura Firebase y AWS para entrar.'
      );
      setState('error');
      return;
    }

    let active = true;
    setState('loading');

    void (async () => {
      try {
        const result = await apiFetch<T>(path);
        if (!active) return;
        setData(result);
        setState('ready');
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'No se pudo cargar.');
        setState('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [path, nonce]);

  return { data, state, error, reload };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export const createCourse = (body: unknown) =>
  apiFetch<{ course: CourseDetail }>('/api/courses', { method: 'POST', body });

export const joinCourse = (code: string) =>
  apiFetch<{ course: CourseDetail }>('/api/courses/join', { method: 'POST', body: { code } });

export const createAssignment = (courseId: string, body: unknown) =>
  apiFetch<{ assignment: Assignment }>(`/api/courses/${courseId}/assignments`, {
    method: 'POST',
    body,
  });

export const updateAssignment = (assignmentId: string, body: unknown) =>
  apiFetch<{ assignment: Assignment }>(`/api/assignments/${assignmentId}`, {
    method: 'PATCH',
    body,
  });

export const deleteAssignment = (assignmentId: string) =>
  apiFetch<{ ok: true }>(`/api/assignments/${assignmentId}`, { method: 'DELETE' });

export const saveSubmission = (
  assignmentId: string,
  intent: 'draft' | 'submit',
  data: unknown
) =>
  apiFetch<{ submission: Submission }>(`/api/assignments/${assignmentId}/submission`, {
    method: 'PUT',
    body: { intent, data },
  });

/**
 * Entrega de una tarea de varios pasos.
 *
 * Misma ruta que la de un solo paso: el servidor distingue por la FORMA del
 * cuerpo (`steps` frente a `data`), no por el tipo de la tarea. Así un
 * formulario antiguo sigue funcionando sin desplegar las dos partes a la vez.
 */
export const saveWorkflowSubmission = (
  assignmentId: string,
  intent: 'draft' | 'submit',
  steps: {
    stepId: string;
    toolId: string | null;
    toolName: string;
    note: string;
    data: Record<string, unknown>;
  }[]
) =>
  apiFetch<{ submission: Submission }>(`/api/assignments/${assignmentId}/submission`, {
    method: 'PUT',
    body: { intent, steps },
  });

export const reviewSubmission = (
  submissionId: string,
  body: { status: 'reviewed' | 'needs_changes' | 'submitted'; teacherNote: string }
) =>
  apiFetch<{ submission: Submission }>(`/api/submissions/${submissionId}`, {
    method: 'PATCH',
    body,
  });

export const enrollStudents = (courseId: string, handles: string[]) =>
  apiFetch<{ students: RosterRow[] }>(`/api/courses/${courseId}/students`, {
    method: 'POST',
    body: { handles, role: 'student' },
  });

export const removeStudent = (courseId: string, handle: string) =>
  apiFetch<{ students: RosterRow[] }>(`/api/courses/${courseId}/students`, {
    method: 'DELETE',
    body: { handle, role: 'student' },
  });

export const searchPeople = (query: string) =>
  apiFetch<{ people: CourseMember[] }>(`/api/people/search?q=${encodeURIComponent(query)}`);

export const createPrompt = (courseId: string, body: unknown) =>
  apiFetch<{ prompt: PromptTemplate }>(`/api/courses/${courseId}/prompts`, {
    method: 'POST',
    body,
  });

export const updatePrompt = (promptId: string, body: unknown) =>
  apiFetch<{ prompt: PromptTemplate }>(`/api/prompts/${promptId}`, { method: 'PATCH', body });

export const deletePrompt = (promptId: string) =>
  apiFetch<{ ok: true }>(`/api/prompts/${promptId}`, { method: 'DELETE' });

export const createSkill = (courseId: string, body: unknown) =>
  apiFetch<{ skill: SkillResource }>(`/api/courses/${courseId}/skills`, {
    method: 'POST',
    body,
  });

export const updateSkill = (skillId: string, body: unknown) =>
  apiFetch<{ skill: SkillResource }>(`/api/skills/${skillId}`, { method: 'PATCH', body });

export const deleteSkill = (skillId: string) =>
  apiFetch<{ ok: true }>(`/api/skills/${skillId}`, { method: 'DELETE' });

export const createCourseResource = (courseId: string, body: unknown) =>
  apiFetch<{ resource: CourseResource }>(`/api/courses/${courseId}/library`, {
    method: 'POST',
    body,
  });

export const deleteCourseResource = (resourceId: string) =>
  apiFetch<{ ok: true }>(`/api/resources/${resourceId}`, { method: 'DELETE' });

/**
 * Decisión de moderación (§8, §44).
 *
 * Una sola función para los tres tipos porque la decisión es la misma; sólo
 * cambia la ruta. El servidor comprueba que quien decide sea docente de ESA
 * materia: aquí no hay ninguna garantía, sólo comodidad.
 */
export const moderateResource = (
  kind: 'prompt' | 'skill' | 'resource',
  id: string,
  action: 'approve' | 'reject' | 'archive' | 'feature' | 'unfeature'
) => {
  const path =
    kind === 'prompt' ? `/api/prompts/${id}` : kind === 'skill' ? `/api/skills/${id}` : `/api/resources/${id}`;
  return apiFetch<unknown>(path, { method: 'PATCH', body: { action } });
};

/** Re-exporta el tipo de la vista conjunta para que las pantallas no vayan a `types`. */
export type { CollaborativeView };

/**
 * Sube un archivo académico DIRECTAMENTE a S3.
 *
 * Dos pasos: se pide permiso al servidor —que decide ruta, tipo y tamaño— y se
 * sube al bucket con ese permiso. El archivo no pasa por Next.js: un video de
 * 200 MB a través de una función serverless es tiempo pagado y un límite de
 * cuerpo que no da.
 *
 * Devuelve la CLAVE, no una URL. Leer el archivo exige pedir después una URL
 * firmada de corta duración, y quién puede leerlo se decide en cada petición.
 */
export async function uploadAcademicFile(
  assignmentId: string,
  stepId: string,
  file: File
): Promise<{ storageKey: string; fileName: string }> {
  const { upload, storageKey, fileName } = await apiFetch<{
    upload: { url: string; fields: Record<string, string> };
    storageKey: string;
    fileName: string;
  }>(`/api/assignments/${assignmentId}/files`, {
    method: 'POST',
    body: {
      stepId,
      contentType: file.type,
      sizeBytes: file.size,
      fileName: file.name,
    },
  });

  const { uploadSigned } = await import('./api-client');
  await uploadSigned(upload, file, file.name);

  return { storageKey, fileName: fileName || file.name };
}

/** URL temporal para ver un archivo entregado. Se pide cuando se va a mirar. */
export const academicFileUrl = (assignmentId: string, storageKey: string) =>
  apiFetch<{ url: string }>(
    `/api/assignments/${assignmentId}/files?key=${encodeURIComponent(storageKey)}`
  );

// ---------------------------------------------------------------------------
// Materiales de la tarea
// ---------------------------------------------------------------------------

/**
 * Sube un archivo para la clase y lo registra en la tarea.
 *
 * Tres pasos, en este orden: permiso → subida directa a S3 → registro. El
 * registro va AL FINAL a propósito; si se hiciera antes, un fallo de red dejaría
 * en la tarea un archivo que no existe. Devuelve la lista completa ya
 * actualizada para que la pantalla no tenga que recargar la tarea entera.
 */
export async function uploadAssignmentMaterial(
  assignmentId: string,
  file: File,
  options: { kind: AssignmentMaterialKind; displayName?: string }
): Promise<AssignmentMaterial[]> {
  const { upload, storageKey } = await apiFetch<{
    upload: { url: string; fields: Record<string, string> };
    storageKey: string;
    contentType: string;
  }>(`/api/assignments/${assignmentId}/materials`, {
    method: 'POST',
    body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
  });

  const { uploadSigned } = await import('./api-client');
  await uploadSigned(upload, file, file.name);

  const { materials } = await apiFetch<{ materials: AssignmentMaterial[] }>(
    `/api/assignments/${assignmentId}/materials`,
    {
      method: 'PUT',
      body: {
        storageKey,
        fileName: file.name,
        displayName: options.displayName ?? '',
        kind: options.kind,
        sizeBytes: file.size,
      },
    }
  );

  return materials;
}

export const updateAssignmentMaterial = (
  assignmentId: string,
  body: { id: string; displayName?: string; kind?: AssignmentMaterialKind }
) =>
  apiFetch<{ materials: AssignmentMaterial[] }>(
    `/api/assignments/${assignmentId}/materials`,
    { method: 'PATCH', body }
  );

export const deleteAssignmentMaterial = (assignmentId: string, id: string) =>
  apiFetch<{ materials: AssignmentMaterial[] }>(
    `/api/assignments/${assignmentId}/materials?id=${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );

/** Los materiales de una tarea, sin traerse la tarea entera. */
export const listAssignmentMaterials = (assignmentId: string) =>
  apiFetch<{ materials: AssignmentMaterial[] }>(`/api/assignments/${assignmentId}/materials`);

/**
 * URL temporal para descargar un material. Se pide POR ID, nunca por clave: el
 * servidor toma la clave de la propia tarea (ver la ruta de materiales).
 */
export const assignmentMaterialUrl = (assignmentId: string, id: string) =>
  apiFetch<{ url: string; fileName: string }>(
    `/api/assignments/${assignmentId}/materials?id=${encodeURIComponent(id)}`
  );

/**
 * Abre una URL firmada en otra pestaña, sin perderla por el bloqueador.
 *
 * La pestaña se abre EN BLANCO de forma síncrona, dentro del gesto de la
 * persona, y se le pone la dirección cuando el servidor responde. Al revés
 * —pedir la firma y después abrir— el navegador ya no relaciona la apertura con
 * el clic y Safari, entre otros, la bloquea sin decir nada.
 *
 * Las URLs no se piden por adelantado a propósito: duran minutos, así que
 * generarlas al pintar la lista dejaría enlaces caducados y regalaría accesos
 * temporales a archivos que nadie llegó a abrir.
 */
export async function openSignedUrl(load: () => Promise<{ url: string }>): Promise<void> {
  // Sin `noopener` en las opciones: con esa bandera el navegador devuelve
  // `null` y no habría a qué asignarle la dirección. Se desvincula a mano.
  const tab = typeof window === 'undefined' ? null : window.open('', '_blank');
  if (tab) tab.opener = null;

  try {
    const { url } = await load();
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (caught) {
    tab?.close();
    throw caught;
  }
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

export interface ExportOptions {
  format: 'json' | 'csv' | 'md';
  scope?: 'all' | 'worklogs';
  handles?: string[];
}

/**
 * Trae el resultado de la exportación como texto.
 *
 * No se abre la URL en una pestaña ni se usa un enlace: la ruta exige la
 * cabecera `Authorization`, y un `window.open` no la lleva. Se descarga con
 * `fetch` autenticado y el texto se entrega a quien llama, que decide si lo
 * enseña para copiar o lo guarda como archivo.
 */
export async function fetchExport(
  assignmentId: string,
  options: ExportOptions
): Promise<{ text: string; filename: string }> {
  const auth = getClientAuth();
  const user = auth?.currentUser;
  if (!user) throw new Error('Necesitas iniciar sesión.');

  const search = new URLSearchParams({ format: options.format });
  if (options.scope === 'worklogs') search.set('scope', 'worklogs');
  if (options.handles?.length) search.set('students', options.handles.join(','));

  const response = await fetch(
    `/api/assignments/${assignmentId}/export?${search.toString()}`,
    { headers: { Authorization: `Bearer ${await user.getIdToken()}` } }
  );

  if (!response.ok) {
    const message = await response
      .json()
      .then((data: { error?: string }) => data.error)
      .catch(() => undefined);
    throw new Error(message ?? 'No se pudo exportar.');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `export.${options.format}`;

  return { text: await response.text(), filename };
}

/** Guarda un texto como archivo, sin pasar por el servidor. */
export function downloadText(text: string, filename: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revocar en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Prácticas de programación (iteración 7)
// ---------------------------------------------------------------------------

/**
 * Ninguna de estas funciones acepta un uid, y no es un olvido.
 *
 * La colección es siempre la de quien pide: el servidor la deriva del token. Si
 * hubiera un parámetro de dueño, tarde o temprano alguien lo rellenaría desde
 * la consola del navegador. Ver `app/api/workspaces/route.ts`.
 */
export const listWorkspaces = () => apiFetch<{ workspaces: Workspace[] }>('/api/workspaces');

export const createWorkspace = (body: {
  title: string;
  language: string;
  code?: string;
  courseId?: string | null;
}) => apiFetch<{ workspace: Workspace }>('/api/workspaces', { method: 'POST', body });

/** Guarda sólo lo que cambió: es lo que usa el autoguardado del editor. */
export const patchWorkspace = (
  workspaceId: string,
  changes: { title?: string; code?: string; language?: string }
) =>
  apiFetch<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: changes,
  });

export const deleteWorkspace = (workspaceId: string) =>
  apiFetch<{ ok: true }>(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// NexBooks (iteración 8)
// ---------------------------------------------------------------------------

export const createNexBook = (body: { title: string; document?: NexBookDocument }) =>
  apiFetch<{ nexbook: NexBook }>('/api/nexbooks', { method: 'POST', body });

/**
 * Guarda con concurrencia optimista.
 *
 * `revision` es la que el cliente creía tener. Un 409 significa que alguien
 * guardó desde otro sitio y trae el documento que ganó dentro, para que la
 * interfaz pueda decir qué pasó en vez de un «error» a secas.
 */
export const patchNexBook = (
  nexbookId: string,
  body: { revision: number; title?: string; document?: NexBookDocument }
) => apiFetch<{ nexbook: NexBook }>(`/api/nexbooks/${nexbookId}`, { method: 'PATCH', body });

export const deleteNexBook = (nexbookId: string) =>
  apiFetch<{ ok: true }>(`/api/nexbooks/${nexbookId}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Assets, publicación e intercambio (iteración 9)
// ---------------------------------------------------------------------------

/**
 * Sube una imagen y devuelve su identificador.
 *
 * Dos pasos y no uno: el servidor firma un permiso acotado y el navegador sube
 * DIRECTAMENTE a S3. Pasar cuatro megas por una función serverless sería tiempo
 * de cómputo pagado por copiar bytes de un sitio a otro.
 */
export async function uploadNexBookAsset(
  nexbookId: string,
  file: Blob,
  contentType: NexBookImageMimeType
): Promise<string> {
  const { assetId, upload } = await apiFetch<{
    assetId: string;
    upload: { url: string; fields: Record<string, string> };
  }>(`/api/nexbooks/${nexbookId}/assets`, {
    method: 'POST',
    body: { contentType, sizeBytes: file.size },
  });

  await uploadSigned(upload, file, assetId);
  return assetId;
}

/**
 * La URL por la que se lee una imagen.
 *
 * Estable y del propio origen: lo que caduca es la firma que hay detrás, no
 * esto. El tipo viaja como pista para la imagen que todavía no llegó al
 * documento guardado; ver la ruta.
 */
export function nexBookAssetUrl(
  nexbookId: string,
  assetId: string,
  mimeType?: NexBookImageMimeType
): string {
  const suffix = mimeType ? `?type=${encodeURIComponent(mimeType)}` : '';
  return `/api/nexbooks/${nexbookId}/assets/${assetId}${suffix}`;
}

export const publishNexBook = (
  nexbookId: string,
  body: { visibility: NexBookPublicVisibility }
) =>
  apiFetch<{ publication: NexBookPublication }>(`/api/nexbooks/${nexbookId}/publication`, {
    method: 'PUT',
    body,
  });

export const getNexBookPublication = (nexbookId: string) =>
  apiFetch<{ publication: NexBookPublication | null; hasChanges: boolean }>(
    `/api/nexbooks/${nexbookId}/publication`
  );

export const unpublishNexBook = (nexbookId: string) =>
  apiFetch<{ ok: true }>(`/api/nexbooks/${nexbookId}/publication`, { method: 'DELETE' });

/**
 * Descarga el `.nexbook`.
 *
 * No pasa por `apiFetch` porque la respuesta es un ZIP y no JSON, pero necesita
 * la misma cabecera `Authorization`: un `<a download>` no la lleva, así que un
 * enlace directo devolvería un 401 guardado como si fuera el archivo.
 */
export async function downloadNexBookArchive(
  nexbookId: string
): Promise<{ body: Blob; fileName: string }> {
  const token = await currentIdToken();
  const response = await fetch(`/api/nexbooks/${nexbookId}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((data: { error?: string }) => data.error)
      .catch(() => undefined);
    throw new Error(message ?? 'No se pudo exportar el NexBook.');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition);
  return { body: await response.blob(), fileName: named?.[1] ?? 'nexbook.nexbook' };
}

/** Importa un `.nexbook` y devuelve el documento nuevo, ya del usuario actual. */
export async function importNexBookArchive(file: File): Promise<NexBook> {
  const token = await currentIdToken();
  const form = new FormData();
  form.append('file', file, file.name);

  const response = await fetch('/api/nexbooks/import', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = (await response.json()) as { nexbook?: NexBook; error?: string };
  if (!response.ok || !data.nexbook) {
    throw new Error(data.error ?? 'No se pudo importar el archivo.');
  }
  return data.nexbook;
}
