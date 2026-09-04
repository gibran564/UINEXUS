import { z } from 'zod';
import { profileSchema } from '@/lib/schemas';
import {
  errorResponse,
  readJson,
  requireActor,
  requireIdentity,
  requireWriter,
} from '@/lib/server/session';
import { ensureProfile, updateProfile } from '@/lib/server/writes';

/**
 * Perfil de la persona autenticada.
 *
 * POST  → crea el perfil si es el primer inicio de sesión (idempotente).
 * PATCH → actualiza los campos que su dueño puede cambiar.
 *
 * Ni el handle ni el rol ni la suspensión se aceptan por aquí: no están en el
 * esquema, así que aunque lleguen en el cuerpo se descartan antes de mirarlos.
 */

const createSchema = z.object({
  displayName: z.string().trim().max(120).nullish(),
  avatarUrl: z.string().url().max(2048).nullish(),
});

/** Perfil propio, para rellenar el formulario de edición. */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor(request);
    return Response.json({
      handle: actor.profile.handle,
      displayName: actor.profile.displayName,
      avatarUrl: actor.profile.avatarUrl,
      bio: actor.profile.bio,
      program: actor.profile.program,
      role: actor.profile.role,
      suspended: actor.profile.suspended,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await requireIdentity(request);
    const hints = await readJson(request, createSchema).catch(() => ({
      displayName: null,
      avatarUrl: null,
    }));

    const profile = await ensureProfile(identity, hints);

    // Sólo sale lo que la sesión del navegador necesita. El uid ya lo conoce
    // (es suyo); `suspended` se envía para poder explicar por qué no puede
    // publicar, y nada más.
    return Response.json({
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
      suspended: profile.suspended,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const input = await readJson(request, profileSchema);
    await updateProfile(actor, input);
    return Response.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
