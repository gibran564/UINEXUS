import { z } from 'zod';
import { ALL_CATEGORIES, LIMITS } from './constants';
import { HANDLE_PATTERN, SLUG_PATTERN, isReservedHandle } from './slug';

/**
 * Esquemas de validación compartidos.
 *
 * Se usan en tres sitios: el formulario (feedback inmediato), la capa de
 * escritura del cliente y las Server Actions. Las reglas de Firestore repiten
 * las invariantes críticas porque el cliente nunca es la autoridad.
 */

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_PATTERN, 'Usa 3–24 caracteres: letras, números o guiones.')
  .refine((value) => !isReservedHandle(value), {
    message: 'Ese nombre de usuario está reservado por la plataforma.',
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'La dirección sólo admite letras, números y guiones.');

export const projectBriefSchema = z.object({
  problem: z.string().max(1200).optional(),
  goal: z.string().max(1200).optional(),
  process: z.string().max(2000).optional(),
  tools: z.string().max(400).optional(),
  reflection: z.string().max(1200).optional(),
});

/** Paso 2 del flujo de publicación: la información del proyecto. */
export const projectMetadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'El título necesita al menos 3 caracteres.')
    .max(LIMITS.titleMax, `Máximo ${LIMITS.titleMax} caracteres.`),
  description: z
    .string()
    .trim()
    .min(10, 'Escribe al menos una frase que explique el proyecto.')
    .max(LIMITS.descriptionMax, `Máximo ${LIMITS.descriptionMax} caracteres.`),
  courseId: z.string().trim().max(64).nullable(),
  /**
   * Nombre del curso tal y como se escribio en el formulario. Convive con
   * `courseId` a proposito: el desplegable es escribible, asi que puede llegar
   * un curso que todavia no existe. El servidor busca por nombre y lo crea si
   * hace falta; `courseId` sigue siendo la referencia cuando se eligio uno de
   * la lista.
   */
  courseName: z.string().trim().max(80).nullish(),
  group: z.string().trim().max(24).nullable(),
  tags: z
    .array(z.string().trim().min(1).max(24))
    .max(LIMITS.maxTags, `Como máximo ${LIMITS.maxTags} etiquetas.`),
  brief: projectBriefSchema.default({}),
});

export const visibilitySchema = z.enum(['published', 'unlisted', 'draft']);

export const projectTypeSchema = z.enum(['html', 'site', 'build']);

export const publishInputSchema = projectMetadataSchema.extend({
  slug: slugSchema,
  projectType: projectTypeSchema,
  visibility: visibilitySchema,
});

export type PublishInput = z.infer<typeof publishInputSchema>;
export type ProjectMetadataInput = z.infer<typeof projectMetadataSchema>;

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Escribe tu nombre.')
    .max(60, 'Máximo 60 caracteres.'),
  bio: z.string().trim().max(280, 'Máximo 280 caracteres.').optional(),
  program: z.string().trim().max(80).optional(),
});

export const reportSchema = z.object({
  projectId: z.string().min(1),
  reason: z.enum(['inappropriate', 'plagiarism', 'malware', 'privacy', 'other']),
  details: z.string().trim().max(500).optional(),
});

/** Etiquetas sugeridas: se validan contra el catálogo para mantener las
 *  facetas de la galería limpias, pero se permite etiqueta libre. */
export function normalizeTag(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const known = ALL_CATEGORIES.find(
    (category) => category.toLowerCase() === trimmed.toLowerCase()
  );
  return known ?? trimmed.slice(0, 24);
}
