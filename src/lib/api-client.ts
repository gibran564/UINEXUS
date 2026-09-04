'use client';

import { getClientAuth } from './firebase/client';

/**
 * Cliente de la API de UINexus.
 *
 * Tras la migración a AWS, el navegador ya no escribe en la base de datos ni
 * en el almacenamiento: pide, y el servidor decide. Firebase queda reducido a
 * emitir la prueba de identidad —el ID token— que se adjunta en cada petición.
 *
 * El token se pide fresco al SDK en cada llamada: `getIdToken()` lo devuelve de
 * caché y sólo lo renueva cuando queda poco, así que no cuesta nada y evita el
 * fallo clásico de guardar un token que caduca a la hora.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function idToken(): Promise<string> {
  const auth = getClientAuth();
  const user = auth?.currentUser;
  if (!user) throw new ApiError(401, 'Necesitas iniciar sesión.');
  return user.getIdToken();
}

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await idToken();

  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((data: { error?: string }) => data.error)
      .catch(() => undefined);
    throw new ApiError(response.status, message ?? 'No se pudo completar la operación.');
  }

  return (await response.json()) as T;
}

/**
 * Sube un archivo con un POST firmado por el servidor.
 *
 * Los campos van ANTES que el archivo en el `FormData`: S3 procesa el
 * formulario en orden y descarta lo que llegue después del campo `file`, así
 * que invertirlo hace que la política firmada se ignore y la subida falle.
 */
export async function uploadSigned(
  target: { url: string; fields: Record<string, string> },
  file: Blob,
  filename: string
): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(target.fields)) form.append(key, value);
  form.append('file', file, filename);

  const response = await fetch(target.url, { method: 'POST', body: form });
  if (!response.ok) {
    // S3 responde con XML; el detalle no le sirve a nadie que esté publicando
    // una práctica, así que se traduce a algo accionable.
    throw new ApiError(response.status, `No se pudo subir ${filename}.`);
  }
}
