import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as home } from '@/app/api/home/route';
import { GET as list, POST as publish } from '@/app/api/publications/route';
import { GET as detail, PATCH as moderate } from '@/app/api/publications/[id]/route';
import { PATCH as legacyModerate, GET as legacyRead } from '@/app/api/resources/[resourceId]/route';
import { GET as promptRead } from '@/app/api/prompts/[promptId]/route';
import { POST as createPrompt } from '@/app/api/courses/[courseId]/prompts/route';
import { getCourseResource, getPromptTemplate } from '@/lib/data/academic';
import type { PublicationDTO } from '@/lib/publications';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import { COURSE_A, COURSE_B, PEOPLE } from './helpers/fixtures';
import { createIntegrationTables, deleteIntegrationTables, resetAndSeedIntegrationData, putIntegrationItems, INTEGRATION_TABLES as tables } from './helpers/dynamodb';

type Actor = (typeof ACTORS)[keyof typeof ACTORS];
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const announcement = { title: 'Aviso académico', content: 'Revisaremos los prototipos.' };
const prompt = { title: 'Análisis heurístico', description: 'Guía para evaluar', prompt: 'Evalúa la navegación', recommendedProvider: null, recommendedModel: 'Modelo libre' };
async function create(actor: Actor, body: Record<string, unknown>): Promise<PublicationDTO> {
  const response = await publish(jsonRequestAs(actor, 'http://localhost/api/publications', 'POST', body));
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).publication;
}
async function feed(actor: Actor, query = '') {
  const response = await home(requestAs(actor, 'http://localhost/api/home' + query));
  expect(response.status).toBe(200);
  const payload = await response.json();
  return [...payload.teacherUpdates, ...payload.classroomActivity] as { publicationId?: string; title: string; actor: { handle: string } }[];
}
async function decision(actor: Actor, id: string, status: 'approved' | 'rejected') {
  return moderate(jsonRequestAs(actor, 'http://localhost/api/publications/' + id, 'PATCH', { status }), context(id));
}
async function secondGroup() {
  await putIntegrationItems(tables.courses, [{ ...COURSE_B, teachers: [PEOPLE.teacherA], students: [PEOPLE.studentA, PEOPLE.outsiderStudent] }]);
}
function page(overrides: Record<string, unknown> = {}) {
  return { id: 'page', slug: 'page', title: 'Página académica', description: 'Contenido publicado', author: { handle: 'student-a', displayName: 'Student A', avatarUrl: null }, ownerId: PEOPLE.studentA.uid, ownerHandle: 'student-a', courseId: 'course-a', courseName: 'Course A', term: null, group: null, tags: [], cover: null, projectType: 'web', status: 'published', brief: {}, version: 1, fileCount: 1, totalBytes: 20, entryFile: 'index.html', hiddenByAdmin: false, reportCount: 0, views: 0, featured: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', publishedAt: '2026-09-01T00:00:00Z', statusKey: 'published', listedAt: '2026-09-01T00:00:00Z', ...overrides };
}
beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('publicación unificada y audiencia', () => {
  it('publica inmediatamente para A, excluye B y valida filtros del docente', async () => {
    await secondGroup();
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], announcement });
    expect(publication.status).toBe('approved');
    expect((await feed(ACTORS.studentB)).map((p) => p.publicationId)).toContain(publication.id);
    expect((await feed(ACTORS.outsiderStudent)).map((p) => p.publicationId)).not.toContain(publication.id);
    expect(await feed(ACTORS.teacherA, '?courseId=course-b')).toEqual([]);
    expect((await home(requestAs(ACTORS.teacherB, 'http://localhost/api/home?courseId=course-a'))).status).toBe(404);
  });
  it('A+B es una publicación y no duplica la card de un estudiante en ambos', async () => {
    await secondGroup();
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a', 'course-b', 'course-a'], announcement });
    expect(publication.audienceCourseIds).toEqual(['course-a', 'course-b']);
    expect((await feed(ACTORS.studentA)).filter((p) => p.publicationId === publication.id)).toHaveLength(1);
    expect((await feed(ACTORS.outsiderStudent)).filter((p) => p.publicationId === publication.id)).toHaveLength(1);
    expect((await getCourseResource(publication.id))?.publication?.audienceCourseIds).toEqual(['course-a', 'course-b']);
  });
  it('filtra antes del límite agregado del feed', async () => {
    await secondGroup();
    const older = await create(ACTORS.teacherA, { audienceCourseIds: ['course-b'], announcement });
    const stored = await getCourseResource(older.id);
    await putIntegrationItems(tables.resources, [{ ...stored!, createdAt: '2020-01-01T00:00:00Z' }]);
    for (let index = 0; index < 21; index++) await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], announcement: { ...announcement, title: 'Aviso ' + index } });
    expect((await feed(ACTORS.teacherA)).map((p) => p.publicationId)).not.toContain(older.id);
    expect((await feed(ACTORS.teacherA, '?courseId=course-b')).map((p) => p.publicationId)).toEqual([older.id]);
  });
  it('todos mis grupos se resuelve desde las membresías de docencia', async () => {
    const publication = await create(ACTORS.teacherA, { allTeacherGroups: true, audienceCourseIds: ['course-b'], announcement });
    expect(publication.audienceCourseIds).toEqual(['course-a']);
    expect(await feed(ACTORS.teacherB)).toEqual([]);
  });
  it.each([ACTORS.teacherA, ACTORS.studentA])('rechaza grupos ajenos y falsificación de estado/autor ($uid)', async (actor) => {
    const forbidden = await publish(jsonRequestAs(actor, 'http://localhost/api/publications', 'POST', { audienceCourseIds: ['course-b'], announcement, status: 'approved', authorId: PEOPLE.teacherB.uid }));
    expect(forbidden.status).toBe(404);
    const result = await create(actor, { audienceCourseIds: ['course-a'], announcement, status: 'approved', authorId: PEOPLE.teacherB.uid });
    expect(result.author.handle).toBe(actor === ACTORS.teacherA ? 'teacher-a' : 'student-a');
    expect(result.status).toBe(actor === ACTORS.teacherA ? 'approved' : 'proposed');
  });
  it('crea Prompt real de forma atómica, conserva campos y no lo filtra por biblioteca legacy', async () => {
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], newContent: { kind: 'prompt', data: prompt } });
    const response = await detail(requestAs(ACTORS.studentB, 'http://localhost'), context(publication.id));
    expect(response.status).toBe(200);
    expect((await response.json()).resource).toMatchObject(prompt);
    expect((await feed(ACTORS.studentB)).filter((p) => p.title === prompt.title)).toHaveLength(1);
    const ref = publication.reference!;
    expect((await promptRead(requestAs(ACTORS.studentB, 'http://localhost'), { params: Promise.resolve({ promptId: ref.id }) })).status).toBe(404);
    const original = await getPromptTemplate(ref.id);
    await putIntegrationItems(tables.prompts, [{ ...original!, title: 'Prompt corregido' }]);
    expect((await (await detail(requestAs(ACTORS.studentB, 'http://localhost'), context(publication.id))).json()).resource.title).toBe('Prompt corregido');
  });
  it.each(['skill', 'resource'] as const)('crea el contenido %s con sus campos reales', async (kind) => {
    const data = kind === 'skill' ? { title: 'Skill académica', description: 'Método de trabajo', compatibleTools: ['Codex'], installMethods: [], usageInstructions: 'Aplicar la guía' } : { type: 'guide', title: 'Guía académica', content: 'Instrucciones completas' };
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], newContent: { kind, data } });
    const result = await detail(requestAs(ACTORS.studentB, 'http://localhost'), context(publication.id));
    expect(result.status).toBe(200);
    expect((await result.json()).resource).toMatchObject(data);
    const shared = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], reference: publication.reference });
    expect(shared.reference).toEqual(publication.reference);
  });
  it('comparte un prompt existente sin copiar y permite compartirlo en otro grupo propio', async () => {
    await secondGroup();
    const response = await createPrompt(jsonRequestAs(ACTORS.teacherA, 'http://localhost', 'POST', prompt), { params: Promise.resolve({ courseId: 'course-a' }) });
    const original = (await response.json()).prompt;
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-b'], reference: { kind: 'prompt', id: original.id } });
    expect(publication.reference?.id).toBe(original.id);
    expect((await (await detail(requestAs(ACTORS.outsiderStudent, 'http://localhost'), context(publication.id))).json()).resource.id).toBe(original.id);
    const inline = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], newContent: { kind: 'prompt', data: prompt } });
    const shared = await create(ACTORS.teacherA, { audienceCourseIds: ['course-b'], reference: inline.reference });
    expect(shared.reference).toEqual(inline.reference);
  });
  it('páginas sólo entran al compartir; privadas, ocultas e incompletas se rechazan', async () => {
    await putIntegrationItems(tables.projects, [page()]);
    expect(await feed(ACTORS.studentB)).toEqual([]);
    const options = await (await list(requestAs(ACTORS.teacherA, 'http://localhost/api/publications'))).json();
    expect(options.options).toContainEqual({ kind: 'project', id: 'page', title: 'Página académica' });
    const publication = await create(ACTORS.teacherA, { audienceCourseIds: ['course-a'], reference: { kind: 'project', id: 'page' } });
    expect(publication.detailHref).toBe('/@student-a/page/');
    expect((await feed(ACTORS.studentB)).map((p) => p.publicationId)).toContain(publication.id);
    for (const overrides of [{status: 'draft'}, {status: 'unlisted'}, {hiddenByAdmin: true}, {entryFile: ''}, {ownerHandle: 'different'}]) {
      await putIntegrationItems(tables.projects, [page(overrides)]);
      expect((await publish(jsonRequestAs(ACTORS.teacherA, 'http://localhost', 'POST', { audienceCourseIds: ['course-a'], reference: { kind: 'project', id: 'page' } }))).status).toBe(404);
      expect((await detail(requestAs(ACTORS.studentB, 'http://localhost'), context(publication.id))).status).toBe(404);
    }
  });
});

describe('moderación común y privacidad', () => {
  it('pending no llega a compañeros; aprobado conserva autor y entra al feed', async () => {
    const publication = await create(ACTORS.studentA, { audienceCourseIds: ['course-a'], newContent: { kind: 'prompt', data: prompt } });
    expect(publication.status).toBe('proposed');
    expect(await feed(ACTORS.studentB)).toEqual([]);
    expect((await detail(requestAs(ACTORS.studentB, 'http://localhost'), context(publication.id))).status).toBe(404);
    const teacherHome = await (await home(requestAs(ACTORS.teacherA, 'http://localhost/api/home'))).json();
    expect(teacherHome.publications[0]).toMatchObject({ id: publication.id, canModerate: true, status: 'proposed' });
    expect((await detail(requestAs(ACTORS.studentA, 'http://localhost'), context(publication.id))).status).toBe(200);
    expect((await decision(ACTORS.studentA, publication.id, 'approved')).status).toBe(404);
    expect((await decision(ACTORS.teacherB, publication.id, 'approved')).status).toBe(404);
    expect((await decision(ACTORS.teacherA, publication.id, 'approved')).status).toBe(200);
    const events = await feed(ACTORS.studentB);
    expect(events.find((p) => p.publicationId === publication.id)?.actor.handle).toBe('student-a');
    const stored = await getCourseResource(publication.id);
    expect(stored?.approvedByUid).toBe(PEOPLE.teacherA.uid);
    expect(stored?.approvedAt).toBeTruthy();
    expect((await decision(ACTORS.teacherA, publication.id, 'approved')).status).toBe(409);
  });
  it('rechazado no aparece y las rutas legacy no eluden moderación', async () => {
    const publication = await create(ACTORS.studentA, { audienceCourseIds: ['course-a'], announcement });
    const params = { params: Promise.resolve({ resourceId: publication.id }) };
    expect((await legacyModerate(jsonRequestAs(ACTORS.teacherA, 'http://localhost', 'PATCH', { action: 'approve' }), params)).status).toBe(404);
    expect((await legacyRead(requestAs(ACTORS.teacherA, 'http://localhost'), params)).status).toBe(404);
    expect((await decision(ACTORS.teacherA, publication.id, 'rejected')).status).toBe(200);
    expect(await feed(ACTORS.studentB)).toEqual([]);
    expect((await getCourseResource(publication.id))?.status).toBe('rejected');
  });
  it('no comparte recursos privados, propuestos o de origen sin permiso', async () => {
    const response = await createPrompt(jsonRequestAs(ACTORS.teacherB, 'http://localhost', 'POST', prompt), { params: Promise.resolve({ courseId: 'course-b' }) });
    const original = (await response.json()).prompt;
    for (const actor of [ACTORS.teacherA, ACTORS.studentA]) {
      expect((await publish(jsonRequestAs(actor, 'http://localhost', 'POST', { audienceCourseIds: ['course-a'], reference: { kind: 'prompt', id: original.id } }))).status).toBe(404);
    }
    const pending = await create(ACTORS.studentA, { audienceCourseIds: ['course-a'], newContent: { kind: 'prompt', data: prompt } });
    expect((await publish(jsonRequestAs(ACTORS.teacherA, 'http://localhost', 'POST', { audienceCourseIds: ['course-a'], reference: pending.reference }))).status).toBe(404);
  });
  it('estudiante comparte página como propuesta y no puede ampliarla a otro grupo', async () => {
    await putIntegrationItems(tables.projects, [page()]);
    const publication = await create(ACTORS.studentA, { audienceCourseIds: ['course-a'], reference: { kind: 'project', id: 'page' } });
    expect(publication.status).toBe('proposed');
    expect(await feed(ACTORS.studentB)).toEqual([]);
    await secondGroup();
    expect((await publish(jsonRequestAs(ACTORS.studentA, 'http://localhost', 'POST', { audienceCourseIds: ['course-a', 'course-b'], announcement }))).status).toBe(403);
    await putIntegrationItems(tables.courses, [{ ...COURSE_A, teachers: [PEOPLE.teacherA, PEOPLE.studentA] }]);
    expect((await decision(ACTORS.studentA, publication.id, 'approved')).status).toBe(404);
  });
});
