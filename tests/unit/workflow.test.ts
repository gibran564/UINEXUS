import { describe, expect, it } from 'vitest';
import {
  assertAcyclicWorkflow,
  canSubmitWorkflow,
  canWorkOnStep,
  hasContent,
  isSingleStep,
  missingRequiredSteps,
  normalizeStep,
  normalizeStepEvidence,
  normalizeWorkflow,
  primaryDeliverable,
  stepCompletion,
  stepState,
  synthesizeLegacyStep,
  workableStepIds,
  workflowProgress,
} from '../../src/lib/workflow';
import { LEGACY_STEP_ID } from '../../src/lib/types';
import { assignment, step, stepEvidence, UID, workflowAssignment } from './academic-fixtures';
import type { AssignmentRecord, StepEvidence, WorkflowStepRecord } from '../../src/lib/types';

/**
 * El modelo modular (P0).
 *
 * Lo que más importa aquí NO es que los pasos funcionen: es que una tarea
 * creada antes de la iteración 4 se siga comportando exactamente igual. Por eso
 * el primer bloque es el de compatibilidad y no el de funcionalidad nueva.
 */

const evidenceMap = (entries: StepEvidence[]): Record<string, StepEvidence> =>
  Object.fromEntries(entries.map((entry) => [entry.stepId, entry]));

describe('compatibilidad: una tarea antigua ES un workflow de un paso', () => {
  it('una tarea sin pasos guardados recibe uno sintetizado', () => {
    const workflow = normalizeWorkflow(assignment(), assignment());
    expect(workflow).toHaveLength(1);
    expect(workflow[0]?.id).toBe(LEGACY_STEP_ID);
    expect(isSingleStep({ workflow })).toBe(true);
  });

  it('el paso sintetizado conserva el título y las instrucciones de la tarea', () => {
    const source = assignment({ title: 'Glosario', instructions: '1. Identifica.' });
    const [only] = normalizeWorkflow(source, source);
    expect(only?.title).toBe('Glosario');
    expect(only?.instructions).toBe('1. Identifica.');
  });

  it('cada tipo antiguo se traduce al entregable que ya pedía', () => {
    const cases: [AssignmentRecord['type'], string][] = [
      ['research', 'structured'],
      ['ai_worklog', 'ai_worklog'],
      ['web_project', 'project'],
      ['external_link', 'url'],
      ['freeform', 'text'],
    ];

    for (const [type, expected] of cases) {
      const source = assignment({ type });
      const [only] = normalizeWorkflow(source, source);
      expect(primaryDeliverable(only!).type).toBe(expected);
    }
  });

  it('una investigación lleva sus campos al entregable del paso', () => {
    const source = assignment({ type: 'research' });
    const [only] = normalizeWorkflow(source, source);
    expect(primaryDeliverable(only!).questions).toHaveLength(3);
  });

  it('el paso legado NO restringe a nadie: lo hace quien tenga la tarea', () => {
    const [only] = normalizeWorkflow(assignment(), assignment());
    expect(only?.assignedTo).toBeNull();
    expect(canWorkOnStep(only!, UID.pedro)).toBe(true);
  });

  it('una entrega antigua se lee como la evidencia del paso legado', () => {
    // Es la pieza que hace que no haga falta migrar: `LEGACY_STEP_ID` es el
    // mismo id que recibe el paso sintetizado, así que encajan.
    const evidence = normalizeStepEvidence({
      data: { answers: [{ questionId: 'q1', value: 'Una definición' }] },
      submittedAt: '2026-09-05T10:00:00.000Z',
    });

    expect(Object.keys(evidence)).toEqual([LEGACY_STEP_ID]);
    expect(evidence[LEGACY_STEP_ID]?.completedAt).toBe('2026-09-05T10:00:00.000Z');
    expect(hasContent(evidence[LEGACY_STEP_ID])).toBe(true);
  });

  it('una entrega sin nada devuelve evidencia vacía en vez de fallar', () => {
    expect(normalizeStepEvidence({})).toEqual({});
  });

  it('una entrega que YA tiene stepEvidence no se sobrescribe con `data`', () => {
    const evidence = normalizeStepEvidence({
      data: { text: 'vieja', links: [] },
      stepEvidence: { s1: stepEvidence({ stepId: 's1', data: { text: 'nueva', links: [] } }) },
    });
    expect(Object.keys(evidence)).toEqual(['s1']);
  });
});

describe('normalización de pasos', () => {
  it('rellena los campos que falten sin inventar contenido', () => {
    const normalized = normalizeStep({ title: 'Buscar fuentes' }, 0);
    expect(normalized.id).toBe('step-1');
    expect(normalized.actionType).toBe('instruction');
    expect(normalized.tool.mode).toBe('none');
    expect(normalized.required).toBe(true);
    expect(normalized.dependsOnStepIds).toEqual([]);
  });

  it('el orden manda sobre la posición en la lista', () => {
    const source = workflowAssignment({
      workflow: [
        step({ id: 'c', order: 2, title: 'Tercero' }),
        step({ id: 'a', order: 0, title: 'Primero' }),
        step({ id: 'b', order: 1, title: 'Segundo' }),
      ],
    });
    const workflow = normalizeWorkflow(source, source);
    expect(workflow.map((item) => item.title)).toEqual(['Primero', 'Segundo', 'Tercero']);
    expect(workflow.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it('un actionType desconocido se acepta tal cual', () => {
    // §4: la docente encontrará otra herramienta la semana que viene y no puede
    // depender de que alguien despliegue código para poder usarla.
    const normalized = normalizeStep({ title: 'x', actionType: 'holograma_cuantico' }, 0);
    expect(normalized.actionType).toBe('holograma_cuantico');
  });
});

describe('quién puede trabajar en cada paso (§33)', () => {
  const workflow: WorkflowStepRecord[] = [
    step({ id: 's1', assignedTo: null }),
    step({ id: 's2', assignedTo: [UID.christian] }),
    step({ id: 's3', assignedTo: [UID.ana, UID.christian] }),
  ];

  it('un paso sin responsables lo hace cualquiera', () => {
    expect(canWorkOnStep(workflow[0]!, UID.pedro)).toBe(true);
  });

  it('un paso con lista vacía también queda abierto', () => {
    // La ausencia de restricción significa «para todos», nunca «para nadie»:
    // un olvido al repartir se nota y se arregla; lo contrario deja un paso que
    // nadie puede tocar sin que se entienda por qué.
    expect(canWorkOnStep(step({ assignedTo: [] }), UID.pedro)).toBe(true);
  });

  it('un paso asignado sólo lo hace su responsable', () => {
    expect(canWorkOnStep(workflow[1]!, UID.christian)).toBe(true);
    expect(canWorkOnStep(workflow[1]!, UID.ana)).toBe(false);
  });

  it('workableStepIds devuelve exactamente los propios', () => {
    expect([...workableStepIds(workflow, UID.ana)].sort()).toEqual(['s1', 's3']);
    expect([...workableStepIds(workflow, UID.pedro)].sort()).toEqual(['s1']);
  });
});

describe('dependencias entre pasos (§22)', () => {
  const workflow: WorkflowStepRecord[] = [
    step({ id: 's1' }),
    step({ id: 's2', dependsOnStepIds: ['s1'] }),
    step({ id: 's3', dependsOnStepIds: ['s2'] }),
  ];

  it('sin dependencias, ningún paso se bloquea', () => {
    expect(stepState(step({ id: 'libre' }), {})).toBe('pending');
  });

  it('un paso cuya dependencia no está hecha queda bloqueado', () => {
    expect(stepState(workflow[1]!, {})).toBe('locked');
  });

  it('al completar la dependencia, el siguiente se desbloquea', () => {
    const evidence = evidenceMap([
      stepEvidence({ stepId: 's1', data: { text: 'cinco fuentes', links: [] } }),
    ]);
    expect(stepState(workflow[0]!, evidence)).toBe('done');
    expect(stepState(workflow[1]!, evidence)).toBe('pending');
    expect(stepState(workflow[2]!, evidence)).toBe('locked');
  });

  it('rechaza un ciclo directo A → B → A', () => {
    expect(() =>
      assertAcyclicWorkflow([
        step({ id: 'a', dependsOnStepIds: ['b'] }),
        step({ id: 'b', dependsOnStepIds: ['a'] }),
      ])
    ).toThrow('El workflow contiene dependencias cíclicas.');
  });

  it('rechaza un ciclo indirecto A → B → C → A', () => {
    expect(() =>
      assertAcyclicWorkflow([
        step({ id: 'a', dependsOnStepIds: ['c'] }),
        step({ id: 'b', dependsOnStepIds: ['a'] }),
        step({ id: 'c', dependsOnStepIds: ['b'] }),
      ])
    ).toThrow('El workflow contiene dependencias cíclicas.');
  });

  it('acepta una cadena acíclica A → B → C', () => {
    expect(() =>
      assertAcyclicWorkflow([
        step({ id: 'a' }),
        step({ id: 'b', dependsOnStepIds: ['a'] }),
        step({ id: 'c', dependsOnStepIds: ['b'] }),
      ])
    ).not.toThrow();
  });
});

describe('¿hay contenido en una evidencia?', () => {
  it('un texto escrito cuenta', () => {
    expect(hasContent(stepEvidence({ data: { text: 'algo', links: [] } }))).toBe(true);
  });

  it('un texto en blanco no cuenta', () => {
    expect(hasContent(stepEvidence({ data: { text: '   ', links: [] } }))).toBe(false);
  });

  it('una lista de respuestas vacías no cuenta', () => {
    expect(
      hasContent(stepEvidence({ data: { answers: [{ questionId: 'q1', value: '' }] } }))
    ).toBe(false);
  });

  it('haber anotado la herramienta usada sí cuenta', () => {
    // Un paso de «usa Perplexity y dime cuál usaste» puede no dejar más rastro.
    expect(hasContent(stepEvidence({ data: {} as never, toolName: 'Perplexity' }))).toBe(true);
  });

  it('una evidencia que no existe no cuenta', () => {
    expect(hasContent(undefined)).toBe(false);
  });
});

describe('progreso y entrega', () => {
  const workflow: WorkflowStepRecord[] = [
    step({ id: 's1', required: true }),
    step({ id: 's2', required: true, assignedTo: [UID.ana] }),
    step({ id: 's3', required: false }),
  ];

  it('el progreso de una persona cuenta sólo SUS pasos', () => {
    const evidence = evidenceMap([
      stepEvidence({ stepId: 's1', data: { text: 'hecho', links: [] } }),
    ]);

    // Christian no tiene el paso 2: su total es 2, no 3.
    expect(workflowProgress(workflow, evidence, UID.christian)).toEqual({
      total: 2,
      done: 1,
      requiredTotal: 1,
      requiredDone: 1,
    });
  });

  it('sin uid, el progreso es el del workflow entero', () => {
    expect(workflowProgress(workflow, {}).total).toBe(3);
  });

  it('un paso OPCIONAL sin hacer no impide entregar (§23)', () => {
    const evidence = evidenceMap([
      stepEvidence({ stepId: 's1', data: { text: 'hecho', links: [] } }),
    ]);
    expect(canSubmitWorkflow(workflow, evidence, UID.christian)).toBe(true);
  });

  it('un paso obligatorio sin hacer sí lo impide, y se dice cuál', () => {
    const missing = missingRequiredSteps(workflow, {}, UID.ana);
    expect(missing.map((item) => item.id)).toEqual(['s1', 's2']);
    expect(canSubmitWorkflow(workflow, {}, UID.ana)).toBe(false);
  });
});

describe('avance por paso para el profesorado (§34)', () => {
  const audience = [{ uid: UID.christian }, { uid: UID.ana }, { uid: UID.pedro }];

  it('un paso de todo el grupo se mide contra todo el grupo', () => {
    const byUid = new Map([
      [UID.christian, evidenceMap([stepEvidence({ stepId: 's1', data: { text: 'ok', links: [] } })])],
    ]);
    expect(stepCompletion(step({ id: 's1' }), audience, byUid)).toEqual({
      assigned: 3,
      done: 1,
    });
  });

  it('un paso de una sola persona se mide contra esa persona', () => {
    // «1 de 1», no «1 de 31»: lo contrario haría parecer atrasado un paso que
    // está al día.
    const byUid = new Map([
      [UID.ana, evidenceMap([stepEvidence({ stepId: 's2', data: { text: 'ok', links: [] } })])],
    ]);
    expect(stepCompletion(step({ id: 's2', assignedTo: [UID.ana] }), audience, byUid)).toEqual({
      assigned: 1,
      done: 1,
    });
  });
});

describe('workflow de varios pasos', () => {
  it('un proceso real se modela como una sola tarea, no como cuatro', () => {
    const source = workflowAssignment({
      workflow: [
        step({ id: 's1', title: 'Buscar fuentes', actionType: 'external_tool' }),
        step({ id: 's2', title: 'Cargar en NotebookLM', dependsOnStepIds: ['s1'] }),
        step({ id: 's3', title: 'Mapa en Miro', dependsOnStepIds: ['s2'] }),
        step({ id: 's4', title: 'Reflexión', actionType: 'reflection', dependsOnStepIds: ['s3'] }),
      ],
    });

    const workflow = normalizeWorkflow(source, source);
    expect(workflow).toHaveLength(4);
    expect(isSingleStep({ workflow })).toBe(false);
    expect(workflow.map((item) => item.title)).toEqual([
      'Buscar fuentes',
      'Cargar en NotebookLM',
      'Mapa en Miro',
      'Reflexión',
    ]);
  });

  it('el paso sintetizado no aparece cuando hay pasos de verdad', () => {
    const source = workflowAssignment({ workflow: [step({ id: 'unico' })] });
    expect(normalizeWorkflow(source, source)[0]?.id).toBe('unico');
  });
});

describe('herramienta del paso', () => {
  it('guarda el nombre junto al id (§50)', () => {
    // Una actividad no puede romperse porque una herramienta desaparezca del
    // catálogo: el nombre es lo que sigue siendo legible.
    const normalized = normalizeStep(
      { title: 'x', tool: { mode: 'required', toolIds: ['t1'], toolNames: ['Perplexity'] } },
      0
    );
    expect(normalized.tool.toolNames).toEqual(['Perplexity']);
  });

  it('sin herramienta declarada, el paso no exige ninguna (§37)', () => {
    expect(normalizeStep({ title: 'Analiza los resultados' }, 0).tool.mode).toBe('none');
  });
});

describe('paso legado de un tipo desconocido', () => {
  it('no rompe: cae en texto libre', () => {
    const synthesized = synthesizeLegacyStep({
      type: 'algo_que_no_existe' as AssignmentRecord['type'],
      title: 'Rara',
      description: '',
      instructions: '',
      researchQuestions: [],
      resources: [],
    });
    expect(primaryDeliverable(synthesized).type).toBe('text');
  });
});
