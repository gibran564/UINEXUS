import { describe, expect, it } from 'vitest';
import {
  buildCollaborativeView,
  buildWorkflowGroupView,
  canSeeOthers,
  distributeRoundRobin,
  sectionsOf,
} from '../../src/lib/collaborative';
import {
  answerableQuestionIds,
  canAnswerGroup,
  derivedGroupId,
} from '../../src/lib/data/academic';
import { toAssignment } from '../../src/lib/data/academic-mappers';
import {
  assignment,
  course,
  sharedAssignment,
  submission,
  UID,
} from './academic-fixtures';
import type { AssignmentRecord, ResearchData } from '../../src/lib/types';

/**
 * La actividad colaborativa.
 *
 * Todo lo que decide quién puede escribir qué vive en funciones puras
 * —`canAnswerGroup`, `answerableQuestionIds`, `buildCollaborativeView`—, así que
 * se puede comprobar entero sin nube. Es deliberado: la regla que sostiene §14
 * no debería depender de levantar una base de datos para poder leerse.
 */

const answers = (pairs: [string, string][]): ResearchData => ({
  answers: pairs.map(([questionId, value]) => ({ questionId, value })),
});

describe('conceptos de una investigación', () => {
  it('agrupa los campos por concepto conservando el orden de la docente', () => {
    const sections = sectionsOf(assignment());
    expect(sections.map((section) => section.title)).toEqual([
      'Arquitectura de información',
      'Card sorting',
    ]);
    expect(sections[0]?.questions).toHaveLength(2);
  });

  it('un campo suelto sin concepto se muestra bajo su propio enunciado', () => {
    const sections = sectionsOf(
      assignment({
        researchQuestions: [
          { id: 'x', group: null, groupId: 'x', prompt: '¿Qué observaste?', type: 'long_text', required: false },
        ],
      })
    );
    expect(sections[0]?.title).toBe('¿Qué observaste?');
  });
});

describe('compatibilidad con investigaciones de la iteración 2', () => {
  it('deriva un groupId estable del nombre del concepto', () => {
    expect(derivedGroupId('Card sorting')).toBe(derivedGroupId('Card sorting'));
    expect(derivedGroupId('Card sorting')).not.toBe(derivedGroupId('Taxonomía'));
  });

  it('un concepto sin nombre no rompe: cae en un identificador propio', () => {
    expect(derivedGroupId(null)).toBe('sin-concepto');
    expect(derivedGroupId('')).toBe('sin-concepto');
  });
});

describe('quién puede responder cada apartado (§7, §14)', () => {
  it('en modo individual cualquiera responde todo', () => {
    const item = assignment({ collaborationMode: 'individual' });
    expect(canAnswerGroup(item, 'arquitectura', UID.christian)).toBe(true);
    expect(canAnswerGroup(item, 'card-sorting', UID.christian)).toBe(true);
  });

  it('en modo colaborativo, sólo el responsable del concepto', () => {
    const item = sharedAssignment();
    expect(canAnswerGroup(item, 'arquitectura', UID.christian)).toBe(true);
    expect(canAnswerGroup(item, 'arquitectura', UID.ana)).toBe(false);
    expect(canAnswerGroup(item, 'card-sorting', UID.ana)).toBe(true);
    expect(canAnswerGroup(item, 'card-sorting', UID.christian)).toBe(false);
  });

  it('un concepto sin responsables queda ABIERTO a todo el grupo', () => {
    // La ausencia de restricción significa «para todos», nunca «para nadie»:
    // un olvido al repartir deja el concepto abierto, que se nota y se arregla.
    const item = sharedAssignment({
      groupAssignments: [{ groupId: 'arquitectura', assignedTo: [] }],
    });
    expect(canAnswerGroup(item, 'arquitectura', UID.ana)).toBe(true);
    expect(canAnswerGroup(item, 'card-sorting', UID.ana)).toBe(true);
  });

  it('un concepto puede ser de varias personas a la vez', () => {
    const item = sharedAssignment({
      groupAssignments: [
        { groupId: 'arquitectura', assignedTo: [UID.christian, UID.ana] },
      ],
    });
    expect(canAnswerGroup(item, 'arquitectura', UID.christian)).toBe(true);
    expect(canAnswerGroup(item, 'arquitectura', UID.ana)).toBe(true);
  });

  it('los questionId respondibles son sólo los de sus conceptos', () => {
    const ids = answerableQuestionIds(sharedAssignment(), UID.christian);
    expect([...ids].sort()).toEqual(['q1', 'q2']);
    expect(ids.has('q3')).toBe(false);
  });
});

describe('visibilidad de las aportaciones (§13)', () => {
  const base = { viewerRole: 'student' as const, viewerHasSubmitted: false };

  it('el profesorado siempre lo ve todo', () => {
    expect(
      canSeeOthers({ viewerRole: 'teacher', visibility: 'own', viewerHasSubmitted: false })
    ).toBe(true);
  });

  it('«grupo» deja leer al resto desde el principio', () => {
    expect(canSeeOthers({ ...base, visibility: 'group' })).toBe(true);
  });

  it('«propia» no deja ver nada ajeno, ni después de entregar', () => {
    expect(canSeeOthers({ ...base, visibility: 'own' })).toBe(false);
    expect(canSeeOthers({ ...base, visibility: 'own', viewerHasSubmitted: true })).toBe(false);
  });

  it('«después de entregar» abre la lectura sólo al haber entregado', () => {
    expect(canSeeOthers({ ...base, visibility: 'after_submit' })).toBe(false);
    expect(
      canSeeOthers({ ...base, visibility: 'after_submit', viewerHasSubmitted: true })
    ).toBe(true);
  });
});

describe('la vista conjunta', () => {
  const view = (over: Partial<Parameters<typeof buildCollaborativeView>[0]> = {}) =>
    buildCollaborativeView({
      assignment: sharedAssignment(),
      course: course(),
      submissions: [],
      viewerRole: 'teacher',
      viewerUid: UID.luz,
      ...over,
    });

  it('se compone de los conceptos, con sus responsables', () => {
    const result = view();
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.responsibles.map((p) => p.handle)).toEqual(['christian']);
    expect(result.sections[1]?.responsibles.map((p) => p.handle)).toEqual(['ana']);
  });

  it('un concepto sin aportación sale como «sin iniciar»', () => {
    expect(view().progress).toEqual({ total: 2, done: 0, drafting: 0, missing: 2 });
  });

  it('atribuye cada aportación a quien la escribió', () => {
    const result = view({
      submissions: [
        submission({
          studentId: UID.christian,
          status: 'submitted',
          data: answers([['q1', 'Cómo se organiza la información.']]),
        }),
      ],
    });

    const section = result.sections[0]!;
    expect(section.contributions).toHaveLength(1);
    expect(section.contributions[0]?.author.displayName).toBe('Christian González');
    expect(section.contributions[0]?.answers[0]?.value).toBe(
      'Cómo se organiza la información.'
    );
    expect(result.progress.done).toBe(1);
  });

  it('empareja cada respuesta con el enunciado de su campo', () => {
    const result = view({
      submissions: [
        submission({ studentId: UID.christian, data: answers([['q2', 'https://nngroup.com']]) }),
      ],
    });
    const contribution = result.sections[0]?.contributions[0];
    expect(contribution?.answers.map((a) => a.prompt)).toEqual(['Definición', 'Fuente']);
    expect(contribution?.answers[1]?.value).toBe('https://nngroup.com');
  });

  it('dos responsables producen DOS aportaciones separadas, no un texto común', () => {
    // Es la propiedad que elimina los conflictos: nadie escribe sobre el
    // registro de nadie. Y además deja ver quién escribió qué, que es lo que
    // un documento compartido de Drive vuelve imposible.
    const result = view({
      assignment: sharedAssignment({
        groupAssignments: [
          { groupId: 'arquitectura', assignedTo: [UID.christian, UID.ana] },
          { groupId: 'card-sorting', assignedTo: [] },
        ],
      }),
      submissions: [
        submission({ studentId: UID.christian, data: answers([['q1', 'La de Christian']]) }),
        submission({ id: 's2', studentId: UID.ana, data: answers([['q1', 'La de Ana']]) }),
      ],
    });

    const section = result.sections[0]!;
    expect(section.contributions).toHaveLength(2);
    expect(section.contributions.map((c) => c.answers[0]?.value).sort()).toEqual([
      'La de Ana',
      'La de Christian',
    ]);
  });

  it('un apartado con varios responsables no está hecho hasta que lo están todos', () => {
    const result = view({
      assignment: sharedAssignment({
        groupAssignments: [
          { groupId: 'arquitectura', assignedTo: [UID.christian, UID.ana] },
        ],
      }),
      submissions: [
        submission({
          studentId: UID.christian,
          status: 'submitted',
          data: answers([['q1', 'lista']]),
        }),
      ],
    });
    expect(result.sections[0]?.state).toBe('missing');
  });

  it('con visibilidad «propia», un estudiante sólo recibe su aportación', () => {
    const result = view({
      assignment: sharedAssignment({
        contributionVisibility: 'own',
        groupAssignments: [
          { groupId: 'arquitectura', assignedTo: [UID.christian, UID.ana] },
        ],
      }),
      viewerRole: 'student',
      viewerUid: UID.ana,
      submissions: [
        submission({ studentId: UID.christian, data: answers([['q1', 'secreta']]) }),
        submission({ id: 's2', studentId: UID.ana, data: answers([['q1', 'la mía']]) }),
      ],
    });

    const section = result.sections[0]!;
    expect(section.contributions).toHaveLength(1);
    expect(section.contributions[0]?.author.handle).toBe('ana');
    // Lo que no le corresponde ni siquiera se serializa.
    expect(JSON.stringify(result)).not.toContain('secreta');
  });

  it('no filtra ningún UID', () => {
    const result = view({
      submissions: [submission({ studentId: UID.christian, data: answers([['q1', 'x']]) })],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(UID.christian);
    expect(serialized).not.toContain(UID.ana);
  });
});

describe('el resultado grupal de un workflow', () => {
  const threeStudents = () =>
    course({
      students: [
        ...course().students,
        { uid: UID.pedro, handle: 'pedro', displayName: 'Pedro Ruiz', avatarUrl: null },
      ],
    });

  it('crea tres aportaciones independientes y conserva autor, evidencia y trazabilidad', () => {
    const item = assignment({
      type: 'workflow',
      workflow: [
        {
          id: 'buscar',
          order: 0,
          title: 'Buscar fuentes',
          description: 'Reúne fuentes confiables.',
          instructions: 'Entrega tus hallazgos.',
          actionType: 'research',
          tool: { mode: 'choice', toolIds: ['perplexity'], toolNames: ['Perplexity'] },
          resources: [],
          deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
          required: true,
          assignedTo: [UID.christian, UID.ana, UID.pedro],
          dependsOnStepIds: [],
        },
      ],
    });

    const result = buildWorkflowGroupView(item, threeStudents(), [
      submission({
        id: 'submission-christian',
        studentId: UID.christian,
        status: 'reviewed',
        reviewedAt: '2026-09-06T10:00:00.000Z',
        stepEvidence: {
          buscar: {
            stepId: 'buscar',
            toolId: 'perplexity',
            toolName: 'Perplexity',
            startedAt: '2026-09-04T08:00:00.000Z',
            completedAt: '2026-09-04T09:00:00.000Z',
            data: { text: 'Fuentes de Christian', links: [] },
            note: '',
          },
        },
      }),
      submission({
        id: 'submission-ana',
        studentId: UID.ana,
        status: 'submitted',
        stepEvidence: {
          buscar: {
            stepId: 'buscar',
            toolId: null,
            toolName: 'Claude',
            startedAt: null,
            completedAt: '2026-09-05T09:00:00.000Z',
            data: { text: 'Fuentes de Ana', links: [] },
            note: '',
          },
        },
      }),
      submission({
        id: 'submission-pedro',
        studentId: UID.pedro,
        status: 'draft',
        stepEvidence: {
          buscar: {
            stepId: 'buscar',
            toolId: null,
            toolName: 'Gemini',
            startedAt: '2026-09-05T12:00:00.000Z',
            completedAt: null,
            data: { text: 'Borrador de Pedro', links: [] },
            note: '',
          },
        },
      }),
    ]);

    const groupStep = result.steps[0]!;
    expect(groupStep.expectedParticipants).toBe(3);
    expect(groupStep.withEvidence).toBe(3);
    expect(groupStep.contributions).toHaveLength(3);
    expect(groupStep.contributions.map((entry) => entry.author.handle)).toEqual([
      'christian',
      'ana',
      'pedro',
    ]);
    expect(groupStep.contributions[0]?.submissionId).toBe('submission-christian');
    expect(groupStep.contributions[1]?.evidence?.toolName).toBe('Claude');
    expect(groupStep.contributions[0]?.reviewedAt).toBe('2026-09-06T10:00:00.000Z');
    // reviewed > submitted > draft: el agregado representa a quien va menos avanzado.
    expect(groupStep.state).toBe('draft');
  });

  it('incluye a quien no tiene submission y el estado agregado queda sin iniciar', () => {
    const item = assignment({
      type: 'workflow',
      workflow: [
        {
          id: 'todos',
          order: 0,
          title: 'Reflexión',
          description: '',
          instructions: '',
          actionType: 'reflection',
          tool: { mode: 'none', toolIds: [], toolNames: [] },
          resources: [],
          deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
          required: true,
          assignedTo: null,
          dependsOnStepIds: [],
        },
      ],
    });

    const result = buildWorkflowGroupView(item, threeStudents(), [
      submission({
        studentId: UID.christian,
        stepEvidence: {
          todos: {
            stepId: 'todos',
            toolId: null,
            toolName: '',
            startedAt: null,
            completedAt: null,
            data: { text: 'Terminada', links: [] },
            note: '',
          },
        },
      }),
    ]);

    const groupStep = result.steps[0]!;
    expect(groupStep.expectedParticipants).toBe(3);
    expect(groupStep.withEvidence).toBe(1);
    expect(groupStep.state).toBe('missing');
    expect(groupStep.contributions[2]).toMatchObject({
      author: { handle: 'pedro' },
      state: 'missing',
      submissionId: null,
      evidence: null,
    });
  });

  it('una evidencia estructural pero vacía no cuenta como aportación', () => {
    const item = assignment({
      type: 'workflow',
      assignedTo: [UID.christian],
      workflow: [
        {
          id: 'vacio',
          order: 0,
          title: 'Vacío',
          description: '',
          instructions: '',
          actionType: 'instruction',
          tool: { mode: 'none', toolIds: [], toolNames: [] },
          resources: [],
          deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
          required: true,
          assignedTo: null,
          dependsOnStepIds: [],
        },
      ],
    });
    const result = buildWorkflowGroupView(item, course(), [
      submission({
        stepEvidence: {
          vacio: {
            stepId: 'vacio',
            toolId: null,
            toolName: '',
            startedAt: null,
            completedAt: null,
            data: { text: '   ', links: [] },
            note: '',
          },
        },
      }),
    ]);

    expect(result.steps[0]).toMatchObject({
      expectedParticipants: 1,
      withEvidence: 0,
      state: 'missing',
    });
    expect(result.steps[0]?.contributions[0]?.evidence).toMatchObject({
      stepId: 'vacio',
      data: { text: '   ', links: [] },
    });
  });

  it('no serializa UID de estudiantes ni responsables', () => {
    const item = assignment({
      type: 'workflow',
      workflow: [
        {
          id: 's1',
          order: 0,
          title: 'Paso',
          description: '',
          instructions: '',
          actionType: 'instruction',
          tool: { mode: 'none', toolIds: [], toolNames: [] },
          resources: [],
          deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
          required: true,
          assignedTo: [UID.christian, UID.ana],
          dependsOnStepIds: [],
        },
      ],
    });
    const serialized = JSON.stringify(buildWorkflowGroupView(item, course(), []));
    expect(serialized).not.toContain(UID.christian);
    expect(serialized).not.toContain(UID.ana);
  });
});

describe('reparto automático por turnos (§9)', () => {
  it('reparte 10 conceptos entre 5 personas dando 2 a cada una', () => {
    const groups = Array.from({ length: 10 }, (_, index) => `g${index + 1}`);
    const people = ['christian', 'ana', 'pedro', 'sofia', 'luis'];
    const result = distributeRoundRobin(groups, people);

    expect(result).toHaveLength(10);
    expect(result[0]?.assignedTo).toEqual(['christian']);
    expect(result[5]?.assignedTo).toEqual(['christian']);
    expect(result[4]?.assignedTo).toEqual(['luis']);

    const counts = new Map<string, number>();
    for (const entry of result) {
      const handle = entry.assignedTo[0]!;
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([2, 2, 2, 2, 2]);
  });

  it('sin personas, deja todos los conceptos abiertos en vez de fallar', () => {
    const result = distributeRoundRobin(['a', 'b'], []);
    expect(result).toEqual([
      { groupId: 'a', assignedTo: [] },
      { groupId: 'b', assignedTo: [] },
    ]);
  });
});

describe('el reparto no se filtra al alumnado', () => {
  it('el DTO del profesorado lleva los responsables en handles', () => {
    const dto = toAssignment(sharedAssignment(), {
      viewerRole: 'teacher',
      roster: course().students,
    });
    expect(dto.groupAssignments).toEqual([
      { groupId: 'arquitectura', assignedTo: ['christian'] },
      { groupId: 'card-sorting', assignedTo: ['ana'] },
    ]);
  });

  it('el DTO del alumnado NO lleva quién hace qué', () => {
    const dto = toAssignment(sharedAssignment(), {
      viewerRole: 'student',
      roster: course().students,
    });
    expect(dto.groupAssignments).toEqual([]);
    expect(dto.collaborationMode).toBe('shared');
  });
});

describe('una tarea de la iteración 2 sigue comportándose igual', () => {
  it('sin collaborationMode se lee como individual', () => {
    // Se simula un registro antiguo: el objeto no trae los campos nuevos.
    const legacy = { ...assignment() } as Partial<AssignmentRecord>;
    delete legacy.collaborationMode;
    delete legacy.groupAssignments;

    const item = { ...assignment(), ...legacy } as AssignmentRecord;
    expect(canAnswerGroup(assignment({ ...item, collaborationMode: 'individual' }), 'x', UID.ana)).toBe(
      true
    );
  });
});
