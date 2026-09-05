import { z } from 'zod';
import { courseResourceInputSchema, promptTemplateInputSchema, skillInputSchema } from './academic-schemas';
import type { CourseResource, Project, ProjectAuthor, PromptTemplate, ResourceStatus, SkillResource } from './types';

export type PublicationReference = { kind: 'prompt' | 'skill' | 'resource' | 'project'; id: string };
export interface PublicationDTO {
  id: string;
  title: string;
  content: string;
  kind: 'announcement' | PublicationReference['kind'];
  reference?: PublicationReference;
  audienceCourseIds: string[];
  origin: 'teacher' | 'student';
  status: ResourceStatus;
  author: ProjectAuthor;
  approvedBy: ProjectAuthor | null;
  createdAt: string;
  canModerate: boolean;
  detailHref: string;
}
export interface PublicationOption extends PublicationReference { title: string; courseId?: string }
export interface PublicationDetail { publication: PublicationDTO; resource: PromptTemplate | SkillResource | CourseResource | Project | null }
export const publicationInputSchema = z.object({
  audienceCourseIds: z.array(z.string().min(1)).max(100).default([]),
  allTeacherGroups: z.boolean().default(false),
  reference: z.object({ kind: z.enum(['prompt', 'skill', 'resource', 'project']), id: z.string().min(1) }).optional(),
  announcement: z.object({ title: z.string().trim().min(3).max(120), content: z.string().trim().min(1).max(20000) }).optional(),
  newContent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('prompt'), data: promptTemplateInputSchema }),
    z.object({ kind: z.literal('skill'), data: skillInputSchema }),
    z.object({ kind: z.literal('resource'), data: courseResourceInputSchema }),
  ]).optional(),
}).refine((input) => [input.reference, input.announcement, input.newContent].filter(Boolean).length === 1, 'Selecciona un solo contenido.');
export const publicationModerationSchema = z.object({ status: z.enum(['approved', 'rejected']) });
