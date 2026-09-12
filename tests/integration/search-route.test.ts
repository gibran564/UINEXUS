import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as searchRoute } from '@/app/api/search/route';
import { POST as createAssignmentRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { POST as createResourceRoute } from '@/app/api/courses/[courseId]/library/route';
import { POST as createWorkspaceRoute } from '@/app/api/workspaces/route';
import type { SearchResult } from '@/lib/search';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * Búsqueda global, contra DynamoDB Local.
 *
 * Lo que se prueba aquí es UNA cosa y no es «que encuentre»: es que **la
 * búsqueda no sea una puerta trasera**. Una consulta de texto que recorre varias
 * tablas es exactamente el sitio donde se cuela un permiso olvidado, porque
 * ninguna pantalla enseña de dónde salió cada resultado.
 *
 * Por eso casi todas las pruebas de abajo comprueban lo que NO aparece.
 */

type Actor = (typeof ACTORS)[keyof typeof ACTORS];

async function search(actor: Actor, query: string): Promise<SearchResult[]> {
  const response = await searchRoute(
    requestAs(actor, `http://localhost/api/search?q=${encodeURIComponent(query)}`)
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: SearchResult[] }).results;
}

const titles = (results: SearchResult[]): string[] => results.map((result) => result.title);

async function createAssignment(
  actor: Actor,
  courseId: string,
  input: Record<string, unknown>
): Promise<void> {
  const response = await createAssignmentRoute(
    jsonRequestAs(actor, `http://localhost/api/courses/${courseId}/assignments`, 'POST', input),
    { params: Promise.resolve({ courseId }) }
  );
  expect(response.status).toBe(201);
}

async function createResource(
  actor: Actor,
  courseId: string,
  input: Record<string, unknown>
): Promise<void> {
  const response = await createResourceRoute(
    jsonRequestAs(actor, `http://localhost/api/courses/${courseId}/library`, 'POST', input),
    { params: Promise.resolve({ courseId }) }
  );
  expect(response.status).toBe(201);
}

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('quién puede buscar', () => {
  it('sin sesión no se busca', async () => {
    const response = await searchRoute(new Request('http://localhost/api/search?q=simplex'));
    expect(response.status).toBe(401);
  });

  it('una cuenta de dominio ajeno tampoco, aunque tenga perfil', async () => {
    const response = await searchRoute(
      requestAs(ACTORS.outsiderDomain, 'http://localhost/api/search?q=simplex')
    );
    expect(response.status).toBe(403);
  });
});

describe('el mínimo de caracteres', () => {
  it('con menos de dos caracteres devuelve vacío, no un error', async () => {
    // El campo se está escribiendo. No ha pasado nada malo: simplemente todavía
    // no hay una pregunta que valga la pena repartir entre varias tablas.
    for (const query of ['', ' ', 'a', '  a  ']) {
      const response = await searchRoute(
        requestAs(ACTORS.studentA, `http://localhost/api/search?q=${encodeURIComponent(query)}`)
      );
      expect(response.status, query).toBe(200);
      expect((await response.json()).results, query).toEqual([]);
    }
  });
});

describe('actividades', () => {
  it('el alumnado encuentra la suya, publicada', async () => {
    await createAssignment(ACTORS.teacherA, 'course-a', {
      title: 'Método simplex',
      type: 'freeform',
      status: 'published',
      assignedHandles: null,
    });

    const results = await search(ACTORS.studentA, 'simplex');
    expect(titles(results)).toContain('Método simplex');
    expect(results[0]).toMatchObject({ kind: 'assignment', context: 'Course A', privacy: 'course' });
  });

  it('encuentra sin acentos', async () => {
    await createAssignment(ACTORS.teacherA, 'course-a', {
      title: 'Investigación de Operaciones',
      type: 'freeform',
      status: 'published',
      assignedHandles: null,
    });

    expect(titles(await search(ACTORS.studentA, 'investigacion'))).toContain(
      'Investigación de Operaciones'
    );
  });

  /**
   * La prueba que importa: un BORRADOR no existe para el alumnado. Es la misma
   * regla que `requireAssignmentAccess` aplica al abrirlo, y la búsqueda la
   * cumple porque llama a la misma función, no porque la repita bien.
   */
  it('un borrador del profesorado no aparece para el alumnado', async () => {
    await createAssignment(ACTORS.teacherA, 'course-a', {
      title: 'Borrador secreto simplex',
      type: 'freeform',
      status: 'draft',
      assignedHandles: null,
    });

    expect(titles(await search(ACTORS.studentA, 'simplex'))).toEqual([]);
    // Para quien la escribió sí existe: si no, no podría encontrarla para seguirla.
    expect(titles(await search(ACTORS.teacherA, 'simplex'))).toContain('Borrador secreto simplex');
  });

  it('una actividad asignada a otra persona no aparece', async () => {
    await createAssignment(ACTORS.teacherA, 'course-a', {
      title: 'Sólo para B simplex',
      type: 'freeform',
      status: 'published',
      assignedHandles: ['student-b'],
    });

    expect(titles(await search(ACTORS.studentA, 'simplex'))).toEqual([]);
    expect(titles(await search(ACTORS.studentB, 'simplex'))).toContain('Sólo para B simplex');
  });

  it('una actividad de una materia ajena NUNCA aparece', async () => {
    await createAssignment(ACTORS.teacherB, 'course-b', {
      title: 'Ajena simplex',
      type: 'freeform',
      status: 'published',
      assignedHandles: null,
    });

    // `student-a` no está en `course-b`. Ni buscando el título exacto.
    expect(titles(await search(ACTORS.studentA, 'ajena simplex'))).toEqual([]);
    expect(titles(await search(ACTORS.teacherA, 'ajena simplex'))).toEqual([]);
    expect(titles(await search(ACTORS.teacherB, 'ajena simplex'))).toContain('Ajena simplex');
  });
});

describe('la biblioteca de la materia', () => {
  it('un recurso aprobado lo ve toda la clase', async () => {
    await createResource(ACTORS.teacherA, 'course-a', {
      type: 'guide',
      title: 'Guía de simplex',
      description: 'Cómo resolverlo a mano',
    });

    const results = await search(ACTORS.studentA, 'simplex');
    expect(titles(results)).toContain('Guía de simplex');
    expect(results.find((item) => item.title === 'Guía de simplex')).toMatchObject({
      kind: 'resource',
      privacy: 'course',
    });
  });

  /**
   * Una propuesta pendiente es de quien la propuso y del profesorado, y de nadie
   * más. Es exactamente lo que decide `resourceVisibleTo`, que esta ruta comparte
   * con `/api/courses/:id/library` desde que existe la búsqueda.
   */
  it('una propuesta ajena no aparece para otro estudiante', async () => {
    await createResource(ACTORS.studentB, 'course-a', {
      type: 'link',
      title: 'Propuesta simplex de B',
    });

    expect(titles(await search(ACTORS.studentA, 'simplex'))).toEqual([]);
    // Quien la propuso la ve, para saber qué pasó con ella.
    expect(titles(await search(ACTORS.studentB, 'simplex'))).toContain('Propuesta simplex de B');
    // Y el profesorado, para poder moderarla.
    expect(titles(await search(ACTORS.teacherA, 'simplex'))).toContain('Propuesta simplex de B');
  });
});

describe('la frontera con el nivel 1', () => {
  /**
   * Los espacios personales NO salen por aquí, y es una decisión, no un olvido:
   * el navegador ya tiene esa lista entera para pintar la pantalla de Espacios y
   * la filtra en memoria. Si algún día aparecieran también aquí, cada NexLab
   * saldría DOS VECES en la paleta.
   */
  it('un NexCode propio no viaja en esta respuesta', async () => {
    const created = await createWorkspaceRoute(
      jsonRequestAs(ACTORS.studentA, 'http://localhost/api/workspaces', 'POST', {
        title: 'Práctica simplex',
        language: 'python',
      })
    );
    expect(created.status).toBe(201);

    expect(titles(await search(ACTORS.studentA, 'simplex'))).toEqual([]);
  });
});

describe('lo que devuelve un resultado', () => {
  it('trae contexto, fecha, privacidad y enlace, y ningún uid', async () => {
    await createAssignment(ACTORS.teacherA, 'course-a', {
      title: 'Método simplex',
      type: 'freeform',
      status: 'published',
      assignedHandles: null,
    });

    const [result] = await search(ACTORS.studentA, 'simplex');
    expect(result).toBeDefined();
    expect(result!.context).toBe('Course A');
    expect(result!.href).toMatch(/^\/aula\/course-a\/tareas\//);
    expect(result!.updatedAt).toBeTruthy();

    // La frontera de privacidad de siempre: el UID no cruza al navegador.
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(ACTORS.teacherA.uid);
    expect(raw).not.toContain(ACTORS.studentA.uid);
  });
});
