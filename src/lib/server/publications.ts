import 'server-only';
import { randomUUID } from 'node:crypto';
import { ScanCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { z } from 'zod';
import { TABLES } from '../aws/config';
import { getDynamo } from '../aws/dynamo';
import { getCourseRecord, getCourseResource, getPromptTemplate, getSkill, listCoursesForUser, listCourseResources, listPromptTemplates, listSkills, normalizeResource } from '../data/academic';
import { toCourseResource, toPromptTemplate, toSkillResource } from '../data/academic-mappers';
import { getProjectRecordById, listProjects } from '../data/repository';
import { isPubliclyRoutable } from '../project-access';
import { publicProjectPath } from '../urls';
import { toPublicProject } from '../data/mappers';
import type { CourseResourceRecord } from '../types';
import type { PublicationDTO, PublicationDetail, PublicationOption, PublicationReference, publicationInputSchema } from '../publications';
import { applyModeration, createCourseResource, createPromptTemplate, createSkill } from './academic-writes';
import { requireCourseContext } from './course-access';
import { HttpError, type Actor } from './session';

function database() { const db = getDynamo(); if (!db) throw new HttpError(503, 'Publicaciones no disponibles.'); return db; }
function missing(): never { throw new HttpError(404, 'Esa publicación no está disponible.'); }
async function records(): Promise<CourseResourceRecord[]> {
  const db = getDynamo();
  if (!db) return [];
  const result: CourseResourceRecord[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ TableName: TABLES.resources, FilterExpression: 'attribute_exists(publication)', ExclusiveStartKey: cursor }));
    result.push(...(page.Items ?? []).map((item) => normalizeResource(item)));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return result;
}
export async function canModeratePublication(actor: Actor, item: CourseResourceRecord): Promise<boolean> {
  const ids = item.publication?.audienceCourseIds ?? [];
  if (!ids.length || item.createdBy === actor.uid) return false;
  const courses = await Promise.all(ids.map(getCourseRecord));
  return courses.every((course) => course?.teachers.some((member) => member.uid === actor.uid));
}
async function visible(actor: Actor, item: CourseResourceRecord): Promise<boolean> {
  const ids = item.publication?.audienceCourseIds ?? [];
  if (!ids.length) return false;
  const courses = await Promise.all(ids.map(getCourseRecord));
  const member = courses.some((course) => course && [...course.teachers, ...course.students].some((person) => person.uid === actor.uid));
  return member && (item.status === 'approved' || item.createdBy === actor.uid || await canModeratePublication(actor, item));
}
async function referenceRecord(ref: PublicationReference) {
  if (ref.kind === 'project') return getProjectRecordById(ref.id);
  if (ref.kind === 'prompt') return getPromptTemplate(ref.id);
  if (ref.kind === 'skill') return getSkill(ref.id);
  return getCourseResource(ref.id);
}
/** References are checked again at read time, including the original sharer's course permissions. */
async function resolveReference(item: CourseResourceRecord): Promise<PublicationDetail['resource']> {
  const ref = item.publication?.reference;
  if (!ref) return null;
  const found = await referenceRecord(ref);
  if (!found) missing();
  if (ref.kind === 'project') {
    if (!('ownerId' in found) || found.status !== 'published' || !isPubliclyRoutable(found)) missing();
    return toPublicProject(found);
  }
  if ('ownerId' in found || ('publication' in found && found.publication)) missing();
  const sourceScope = found.courseId;
  if (sourceScope?.startsWith('publication:')) {
    const sourceId = sourceScope.slice('publication:'.length);
    if (sourceId !== item.id) {
      const source = await getCourseResource(sourceId);
      if (!source?.publication || source.status !== 'approved') missing();
      // Ampliar audiencia exige administrar tanto el origen como los destinos.
      if (!item.publication!.audienceCourseIds.every((id) => source.publication!.audienceCourseIds.includes(id))) {
        const groups = await Promise.all([...new Set([...source.publication.audienceCourseIds, ...item.publication!.audienceCourseIds])].map(getCourseRecord));
        if (!groups.every((group) => group?.teachers.some((member) => member.uid === item.createdBy))) missing();
      }
    }
  } else {
    const source = sourceScope ? await getCourseRecord(sourceScope) : null;
    if (!source) missing();
    const crossCourse = item.publication!.audienceCourseIds.some((id) => id !== sourceScope);
    const teachers = await Promise.all(item.publication!.audienceCourseIds.map(getCourseRecord));
    if (crossCourse && (!source.teachers.some((m) => m.uid === item.createdBy) || !teachers.every((course) => course?.teachers.some((m) => m.uid === item.createdBy)))) missing();
  }
  const ownPending = sourceScope === `publication:${item.id}` && item.status !== 'approved' && found.status === item.status;
  if (found.status !== 'approved' && !ownPending) missing();
  if (ref.kind === 'prompt' && 'prompt' in found) return toPromptTemplate(found);
  if (ref.kind === 'skill' && 'installMethods' in found) return toSkillResource(found);
  if (ref.kind === 'resource' && 'type' in found) return toCourseResource(found);
  return missing();
}
async function dto(actor: Actor, item: CourseResourceRecord, resource: PublicationDetail['resource']): Promise<PublicationDTO> {
  const meta = item.publication!;
  const memberships = await listCoursesForUser(actor.uid);
  const audienceCourseIds = meta.audienceCourseIds.filter((id) => memberships.some(({ course }) => course.id === id));
  return { id: item.id, title: resource?.title ?? item.title, content: resource && 'description' in resource ? resource.description : item.content,
    kind: meta.reference?.kind ?? 'announcement', reference: meta.reference, audienceCourseIds,
    origin: meta.origin, status: item.status, author: { handle: item.authorHandle, displayName: item.authorName, avatarUrl: null },
    approvedBy: item.approvedByUid ? { handle: '', displayName: item.approvedByName, avatarUrl: null } : null,
    createdAt: item.createdAt, canModerate: await canModeratePublication(actor, item), detailHref: resource && 'brief' in resource ? publicProjectPath({ handle: resource.author.handle, slug: resource.slug }) : `/api/publications/${item.id}` };
}
export async function getPublicationFor(actor: Actor, id: string): Promise<PublicationDetail> {
  const item = await getCourseResource(id);
  if (!item?.publication || !await visible(actor, item)) missing();
  const resource = await resolveReference(item);
  return { publication: await dto(actor, item, resource), resource };
}
export async function listPublicationsFor(actor: Actor): Promise<PublicationDTO[]> {
  const items = await records();
  const visibleItems = await Promise.all(items.map(async (item) => {
    if (!await visible(actor, item)) return null;
    try { return await dto(actor, item, await resolveReference(item)); }
    catch (error) { if (error instanceof HttpError && error.status === 404) return null; throw error; }
  }));
  return visibleItems.filter((item): item is PublicationDTO => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function publicationOptionsFor(actor: Actor): Promise<PublicationOption[]> {
  const courses = await listCoursesForUser(actor.uid);
  const options = (await Promise.all(courses.map(async ({ course }) => {
    const [prompts, skills, resources] = await Promise.all([listPromptTemplates(course.id), listSkills(course.id), listCourseResources(course.id)]);
    return [ ...prompts.filter((r) => r.status === 'approved').map((r) => ({ kind: 'prompt' as const, id: r.id, title: r.title, courseId: course.id })),
      ...skills.filter((r) => r.status === 'approved').map((r) => ({ kind: 'skill' as const, id: r.id, title: r.title, courseId: course.id })),
      ...resources.filter((r) => r.status === 'approved').map((r) => ({ kind: 'resource' as const, id: r.id, title: r.title, courseId: course.id })) ];
  }))).flat() as PublicationOption[];
  const projects = await listProjects({}, 1, 100);
  for (const project of projects.projects) {
    const original = await getProjectRecordById(project.id);
    if (original?.status === 'published' && isPubliclyRoutable(original)) options.push({ kind: 'project', id: project.id, title: project.title });
  }
  for (const publication of await listPublicationsFor(actor)) {
    if (publication.status === 'approved' && publication.reference) options.push({ ...publication.reference, title: publication.title });
  }
  return [...new Map(options.map((option) => [`${option.kind}:${option.id}`, option])).values()];
}
export async function createPublication(actor: Actor, input: z.infer<typeof publicationInputSchema>): Promise<PublicationDTO> {
  const memberships = await listCoursesForUser(actor.uid);
  const audience = [...new Set(input.allTeacherGroups ? memberships.filter((m) => m.role === 'teacher').map((m) => m.course.id) : input.audienceCourseIds)];
  if (!audience.length) throw new HttpError(422, 'Selecciona al menos un grupo.');
  if (audience.some((id) => !memberships.some(({ course }) => course.id === id))) missing();
  const contexts = await Promise.all(audience.map((id) => requireCourseContext(actor, id)));
  const teacher = contexts.every((context) => context.role === 'teacher');
  if (!teacher && (input.allTeacherGroups || audience.length !== 1 || contexts.some((c) => c.role !== 'student'))) throw new HttpError(403, 'Sólo puedes proponer para uno de tus grupos.');
  const publicationId = randomUUID();
  // El contenido conserva su tabla y esquema real. El ámbito de publicación
  // evita que la biblioteca de un solo curso lo publique antes de moderarlo.
  // Ambos registros se guardan y aprueban en una única transacción.
  const scope = `publication:${publicationId}`;
  let ref = input.reference;
  let contentRecord;
  if (input.newContent?.kind === 'prompt') contentRecord = await createPromptTemplate(actor, scope, input.newContent.data, teacher, false);
  if (input.newContent?.kind === 'skill') contentRecord = await createSkill(actor, scope, input.newContent.data, teacher, false);
  if (input.newContent?.kind === 'resource') contentRecord = await createCourseResource(actor, scope, input.newContent.data, teacher, false);
  if (contentRecord && input.newContent) ref = { kind: input.newContent.kind, id: contentRecord.id };
  const item = await createCourseResource(actor, audience[0]!, { type: input.announcement ? 'announcement' : 'other', title: input.announcement?.title ?? contentRecord?.title ?? 'Publicación', content: input.announcement?.content ?? '', description: '', url: '', category: '', tags: [] }, teacher, false);
  item.id = publicationId;
  item.publication = { audienceCourseIds: audience, reference: ref, origin: teacher ? 'teacher' : 'student' };
  let resource: PublicationDetail['resource'] = null;
  if (!contentRecord && ref) {
    const source = await referenceRecord(ref);
    if (!source) missing();
    if (ref.kind !== 'project' && source.courseId?.startsWith('publication:')) {
      const sourcePublication = await getCourseResource(source.courseId.slice('publication:'.length));
      if (!sourcePublication || !await visible(actor, sourcePublication)) missing();
    } else if (ref.kind !== 'project' && source.courseId) await requireCourseContext(actor, source.courseId);
    resource = await resolveReference(item);
    item.title = resource?.title ?? item.title;
  }
  const writes: NonNullable<TransactWriteCommandInput['TransactItems']> = [{ Put: { TableName: TABLES.resources, Item: item, ConditionExpression: 'attribute_not_exists(id)' } }];
  if (contentRecord && ref) writes.push({ Put: { TableName: ref.kind === 'prompt' ? TABLES.prompts : ref.kind === 'skill' ? TABLES.skills : TABLES.resources, Item: contentRecord as CourseResourceRecord, ConditionExpression: 'attribute_not_exists(id)' } });
  await database().send(new TransactWriteCommand({ TransactItems: writes }));
  return dto(actor, item, resource);
}
export async function moderatePublication(actor: Actor, id: string, status: 'approved' | 'rejected'): Promise<PublicationDTO> {
  const item = await getCourseResource(id);
  if (!item?.publication || !await canModeratePublication(actor, item)) missing();
  if (item.status !== 'proposed') throw new HttpError(409, 'Esta propuesta ya fue revisada.');
  const resource = await resolveReference(item);
  const next = { ...item, ...applyModeration(actor, item, status === 'approved' ? 'approve' : 'reject'), updatedAt: new Date().toISOString() };
  const writes: NonNullable<TransactWriteCommandInput['TransactItems']> = [{ Put: { TableName: TABLES.resources, Item: next, ConditionExpression: '#s = :proposed', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':proposed': 'proposed' } } }];
  const ref = item.publication.reference;
  if (ref && ref.kind !== 'project') {
    const original = await referenceRecord(ref);
    if (original && original.courseId === `publication:${id}` && !('ownerId' in original)) {
      writes.push({ Put: { TableName: ref.kind === 'prompt' ? TABLES.prompts : ref.kind === 'skill' ? TABLES.skills : TABLES.resources,
        Item: { ...original, ...applyModeration(actor, original, status === 'approved' ? 'approve' : 'reject'), updatedAt: next.updatedAt } as CourseResourceRecord,
        ConditionExpression: '#s = :proposed', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':proposed': 'proposed' } } });
    }
  }
  await database().send(new TransactWriteCommand({ TransactItems: writes }));
  return dto(actor, next, resource);
}
