import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as aulaRoute } from '@/app/api/aula/route';
import { POST as profileRoute } from '@/app/api/profile/route';
import { GET as courseAssignmentsRoute } from '@/app/api/courses/[courseId]/assignments/route';
import { ACTORS, jsonRequestAs, requestAs } from './helpers/auth';
import {
  createIntegrationTables,
  deleteIntegrationTables,
  resetAndSeedIntegrationData,
} from './helpers/dynamodb';

/**
 * La política institucional en el SERVIDOR.
 *
 * Un token de Firebase criptográficamente válido demuestra que esa cuenta
 * existe, no que pertenezca al ITD. Antes de esta iteración era suficiente para
 * entrar en las rutas del aula, y el rechazo llegaba más adelante y por motivos
 * accidentales. Ahora `requireIdentity` aplica `isInstitutionalEmail` sobre
 * `decoded.email` ANTES de leer el perfil, así que todas las rutas que se apoyan
 * en él —que son todas— quedan cubiertas por una sola comprobación.
 *
 * Las tres rutas de aquí se eligen por su forma: una de sesión (`/api/aula`),
 * una de creación de perfil (`/api/profile`, que usa `requireIdentity`
 * directamente y no `requireActor`) y una de materia. Si la protección se
 * hubiera puesto en `requireActor` en vez de en `requireIdentity`, la segunda
 * pasaría y las otras dos no.
 */

beforeAll(createIntegrationTables);
beforeEach(resetAndSeedIntegrationData);
afterAll(deleteIntegrationTables);

describe('un token válido con correo no institucional', () => {
  it('no entra al aula aunque tenga perfil', async () => {
    const response = await aulaRoute(requestAs(ACTORS.outsiderDomain, 'http://localhost/api/aula'));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('institucional');
  });

  it('no puede crear ni sincronizar su perfil', async () => {
    // Es el punto por donde entraba: el navegador llamaba a `/api/profile` nada
    // más restaurar la sesión y dejaba escrito un usuario que la plataforma no
    // reconoce.
    const response = await profileRoute(
      jsonRequestAs(ACTORS.outsiderDomain, 'http://localhost/api/profile', 'POST', {
        displayName: 'Cuenta Ajena',
      })
    );

    expect(response.status).toBe(403);
  });

  it('no puede leer las tareas de ninguna materia', async () => {
    const response = await courseAssignmentsRoute(
      requestAs(ACTORS.outsiderDomain, 'http://localhost/api/courses/course-a/assignments'),
      { params: Promise.resolve({ courseId: 'course-a' }) }
    );

    // 403 y no 404: el motivo no es que la materia no exista, es la cuenta.
    expect(response.status).toBe(403);
  });
});

describe('una sesión sin correo', () => {
  it('se rechaza: es lo que producía el acceso por teléfono', async () => {
    // UINexus autoriza sobre el correo institucional, así que un token sin
    // correo no puede demostrar pertenencia por ninguna vía.
    const response = await aulaRoute(requestAs(ACTORS.noEmail, 'http://localhost/api/aula'));
    expect(response.status).toBe(403);
  });

  it('tampoco puede crear un perfil', async () => {
    const response = await profileRoute(
      jsonRequestAs(ACTORS.noEmail, 'http://localhost/api/profile', 'POST', {
        displayName: 'Sin correo',
      })
    );
    expect(response.status).toBe(403);
  });
});

describe('la comunidad institucional sigue entrando', () => {
  it('un correo @itdurango.edu.mx entra con normalidad', async () => {
    const response = await aulaRoute(requestAs(ACTORS.teacherA, 'http://localhost/api/aula'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role).toBe('teacher');
  });

  it('el alumnado también', async () => {
    const response = await aulaRoute(requestAs(ACTORS.studentA, 'http://localhost/api/aula'));
    expect(response.status).toBe(200);
  });

  it('un token que no existe sigue siendo 401, no 403', async () => {
    // Distinguirlos importa: 401 se arregla volviendo a iniciar sesión y 403 no.
    const request = new Request('http://localhost/api/aula', {
      headers: { authorization: 'Bearer token-inventado' },
    });
    expect((await aulaRoute(request)).status).toBe(401);
  });
});
