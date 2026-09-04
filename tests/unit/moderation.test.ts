import { describe, expect, it } from 'vitest';
import { applyModeration, initialAuthorship } from '../../src/lib/server/academic-writes';
import { toCourseResource, toSkillResource } from '../../src/lib/data/academic-mappers';
import {
  courseResourceInputSchema,
  moderationInputSchema,
} from '../../src/lib/academic-schemas';
import { authorship, courseResource, skill, UID } from './academic-fixtures';
import type { Actor } from '../../src/lib/server/session';

/**
 * Moderación de recursos y aportaciones estudiantiles (§7, §8, §9, §44).
 */

const actorOf = (
  uid: string,
  handle: string,
  displayName: string,
  role: 'student' | 'teacher' = 'student'
): Actor =>
  ({
    uid,
    email: null,
    emailVerified: true,
    profile: {
      uid,
      handle,
      displayName,
      avatarUrl: null,
      bio: null,
      program: null,
      role,
      projectCount: 0,
      suspended: false,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  }) as Actor;

const christian = actorOf(UID.christian, 'christian', 'Christian González');
const luz = actorOf(UID.luz, 'profesora-luz', 'Luz Adriana Márquez', 'teacher');

describe('quién publica directamente y quién propone (§8)', () => {
  it('el profesorado de la materia crea ya aprobado', () => {
    const result = initialAuthorship(luz, true);
    expect(result.status).toBe('approved');
    expect(result.approvedByUid).toBe(UID.luz);
    expect(result.approvedAt).not.toBeNull();
  });

  it('el alumnado crea en estado propuesto', () => {
    const result = initialAuthorship(christian, false);
    expect(result.status).toBe('proposed');
    expect(result.approvedByUid).toBeNull();
    expect(result.approvedAt).toBeNull();
  });

  it('la autoría queda registrada desde el primer momento', () => {
    const result = initialAuthorship(christian, false);
    expect(result.authorHandle).toBe('christian');
    expect(result.authorName).toBe('Christian González');
  });

  it('nada nace destacado', () => {
    expect(initialAuthorship(luz, true).featured).toBe(false);
  });

  it('el estado NO se puede pedir desde el cuerpo de la petición', () => {
    // El esquema de entrada no tiene `status`: aunque llegue, se descarta antes
    // de mirarlo. Es lo que impide que un estudiante publique directamente en
    // la biblioteca oficial.
    const parsed = courseResourceInputSchema.safeParse({
      type: 'tool',
      title: 'Napkin AI',
      status: 'approved',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('status' in parsed.data).toBe(false);
  });
});

describe('decisiones de moderación (§44)', () => {
  const proposed = authorship({
    status: 'proposed',
    authorHandle: 'christian',
    authorName: 'Christian González',
    approvedByUid: null,
    approvedByName: '',
    approvedAt: null,
  });

  it('aprobar deja constancia de quién aprobó y cuándo', () => {
    const result = applyModeration(luz, proposed, 'approve');
    expect(result.status).toBe('approved');
    expect(result.approvedByUid).toBe(UID.luz);
    expect(result.approvedByName).toBe('Luz Adriana Márquez');
    expect(result.approvedAt).not.toBeNull();
  });

  it('rechazar NO borra: deja el recurso en un estado que se puede consultar', () => {
    // Quien propuso algo tiene derecho a saber qué pasó. Un recurso que
    // desaparece sin rastro sólo produce la misma propuesta la semana que viene.
    const result = applyModeration(luz, proposed, 'reject');
    expect(result.status).toBe('rejected');
    expect(result.approvedByUid).toBe(UID.luz);
  });

  it('archivar saca de la biblioteca y quita el destacado', () => {
    const featured = authorship({ status: 'approved', featured: true });
    const result = applyModeration(luz, featured, 'archive');
    expect(result.status).toBe('archived');
    expect(result.featured).toBe(false);
  });

  it('destacar y quitar destacado no cambian el estado (§45)', () => {
    const approved = authorship({ status: 'approved' });
    expect(applyModeration(luz, approved, 'feature')).toMatchObject({
      status: 'approved',
      featured: true,
    });
    expect(
      applyModeration(luz, { ...approved, featured: true }, 'unfeature')
    ).toMatchObject({ status: 'approved', featured: false });
  });

  it('un recurso rechazado deja de estar destacado', () => {
    const result = applyModeration(luz, { ...proposed, featured: true }, 'reject');
    expect(result.featured).toBe(false);
  });

  it('sólo se aceptan las cinco acciones conocidas', () => {
    expect(moderationInputSchema.safeParse({ action: 'approve' }).success).toBe(true);
    expect(moderationInputSchema.safeParse({ action: 'publicar' }).success).toBe(false);
    expect(moderationInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('la autoría se conserva al aprobar (§9)', () => {
  it('aprobar no borra a quien lo aportó', () => {
    const proposed = authorship({
      status: 'proposed',
      authorHandle: 'christian',
      authorName: 'Christian González',
      approvedByUid: null,
      approvedByName: '',
      approvedAt: null,
    });

    const decided = applyModeration(luz, proposed, 'approve');
    const record = { ...courseResource(), ...proposed, ...decided };
    const dto = toCourseResource(record);

    expect(dto.author?.displayName).toBe('Christian González');
    expect(dto.approvedBy?.displayName).toBe('Luz Adriana Márquez');
    expect(dto.status).toBe('approved');
  });

  it('el DTO nunca lleva el UID de quien lo creó ni de quien lo aprobó', () => {
    const dto = toCourseResource(courseResource({ createdBy: UID.christian }));
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(UID.christian);
    expect(serialized).not.toContain(UID.luz);
  });

  it('una Skill aportada por un estudiante conserva su autoría', () => {
    const dto = toSkillResource(
      skill({
        createdBy: UID.christian,
        ...authorship({
          status: 'approved',
          authorHandle: 'christian',
          authorName: 'Christian González',
        }),
      })
    );
    expect(dto.author?.handle).toBe('christian');
    expect(dto.approvedBy?.displayName).toBe('Luz Adriana Márquez');
  });
});

describe('compatibilidad con la iteración 3', () => {
  it('un recurso sin campos de moderación se lee como aprobado', () => {
    // Lo que era —algo que escribió la docente y ya estaba en la biblioteca— es
    // exactamente `approved`. Leerlo como `proposed` lo haría desaparecer de la
    // biblioteca de todo el mundo, que es lo contrario de compatibilidad.
    const legacy = { ...skill() } as Partial<ReturnType<typeof skill>>;
    delete legacy.status;
    delete legacy.authorHandle;

    const dto = toSkillResource({ ...skill(), ...legacy } as ReturnType<typeof skill>);
    expect(dto.status).toBe('approved');
  });
});

describe('recursos generales (§13, §41)', () => {
  it('la URL es opcional: una guía puede ser sólo texto', () => {
    const parsed = courseResourceInputSchema.safeParse({
      type: 'guide',
      title: 'Cómo usar NotebookLM',
      content: '1. Abre NotebookLM.',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.url).toBe('');
  });

  it('rechaza un enlace javascript:', () => {
    expect(
      courseResourceInputSchema.safeParse({
        type: 'tool',
        title: 'Maliciosa',
        url: 'javascript:alert(1)',
      }).success
    ).toBe(false);
  });

  it('acepta una herramienta que UINexus no conoce (§5, §50)', () => {
    // El modelo no puede depender de un catálogo cerrado: mañana sale otra.
    const parsed = courseResourceInputSchema.safeParse({
      type: 'tool',
      title: 'Herramienta que sale el mes que viene',
      url: 'https://some-new-ai-tool.example',
      category: 'Diagramación',
    });
    expect(parsed.success).toBe(true);
  });
});
