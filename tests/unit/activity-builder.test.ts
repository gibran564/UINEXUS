import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  actionForPart,
  activityProblems,
  blockingProblems,
  dependentsOf,
  deriveActivity,
  humanizeSaveError,
  legacyEquivalent,
  makeDeliverable,
  makePart,
  movePart,
  partActionLabel,
  partDeliverable,
  partsFromAssignment,
  removePart,
  retypeDeliverable,
  titleForNewPart,
  type ActivityActionId,
} from '@/lib/activity-builder';
import { normalizeStep, synthesizeLegacyStep } from '@/lib/workflow';
import type { AssignmentType, ResearchQuestion, WorkflowStep } from '@/lib/types';

/**
 * La traducción entre intención humana y modelo académico.
 *
 * Es el archivo que decide si la Fase 4 cumple su promesa: la interfaz cambia y
 * el motor no. Todo lo que se prueba aquí es puro, así que se prueba la REGLA y
 * no una pantalla; si mañana el constructor se rediseña otra vez, estas reglas
 * siguen siendo las mismas.
 */

let counter = 0;
const nextId = (): string => `p${++counter}`;

function part(action: ActivityActionId, variant?: string): WorkflowStep {
  return makePart({ action, variant, id: nextId(), order: 0 });
}

describe('el catálogo humano', () => {
  it('no nombra nada del modelo en lo que se lee', () => {
    const visible = ACTIVITY_ACTIONS.flatMap((action) => [
      action.label,
      action.helper,
      ...action.variants.flatMap((variant) => [variant.label, variant.helper]),
    ]).join(' ');

    for (const forbidden of [
      'Workflow',
      'WorkflowStep',
      'DeliverableType',
      'ActionType',
      'Shape',
      'ResourceReference',
      'deliverable',
      'actionType',
    ]) {
      expect(visible).not.toContain(forbidden);
    }
  });

  it('ofrece las siete intenciones y ninguna más', () => {
    expect(ACTIVITY_ACTIONS.map((action) => action.id)).toEqual([
      'respond',
      'evidence',
      'code',
      'lab',
      'ai',
      'project',
      'instruction',
    ]);
  });

  it('cada intención produce al menos una variante', () => {
    for (const action of ACTIVITY_ACTIONS) {
      expect(action.variants.length).toBeGreaterThan(0);
    }
  });
});

describe('intención → modelo', () => {
  const cases: [ActivityActionId, string | undefined, string, string][] = [
    ['respond', 'text', 'text_response', 'text'],
    ['respond', 'structured', 'text_response', 'structured'],
    ['evidence', 'file', 'upload', 'file'],
    ['evidence', 'image', 'upload', 'image'],
    ['evidence', 'video', 'upload', 'video'],
    ['evidence', 'link', 'upload', 'url'],
    ['code', undefined, 'code', 'code'],
    ['lab', undefined, 'code', 'nexbook'],
    ['ai', undefined, 'ai_interaction', 'ai_worklog'],
    ['project', undefined, 'project', 'project'],
    ['instruction', undefined, 'instruction', 'none'],
  ];

  it.each(cases)('«%s/%s» escribe actionType %s y entregable %s', (action, variant, actionType, deliverable) => {
    const created = part(action, variant);
    expect(created.actionType).toBe(actionType);
    expect(partDeliverable(created).type).toBe(deliverable);
  });

  it('la ida y la vuelta coinciden para todas las opciones', () => {
    for (const action of ACTIVITY_ACTIONS) {
      for (const variant of action.variants) {
        const created = part(action.id, variant.id);
        expect(actionForPart(created)).toEqual({ action: action.id, variant: variant.id });
      }
    }
  });

  it('una parte nueva nace sin título, sin dependencias y sin responsables', () => {
    const created = part('respond', 'text');
    expect(created.title).toBe('');
    expect(created.dependsOnStepIds).toEqual([]);
    expect(created.assignedTo).toBeNull();
    expect(created.prompt.mode).toBe('none');
    expect(created.resources).toEqual([]);
    expect(created.required).toBe(true);
  });

  it('el modo de herramienta por defecto coincide con el que la lectura antigua sintetiza', () => {
    expect(part('respond', 'text').tool.mode).toBe('none');
    expect(part('respond', 'structured').tool.mode).toBe('none');
    expect(part('code').tool.mode).toBe('none');
    expect(part('lab').tool.mode).toBe('none');
    expect(part('project').tool.mode).toBe('none');
    // Quien registra su uso de IA usó la que usó.
    expect(part('ai').tool.mode).toBe('free');
    expect(part('evidence', 'link').tool.mode).toBe('free');
  });
});

describe('NexCode y NexLab se distinguen por el entregable', () => {
  it('comparten actionType pero no entregable', () => {
    expect(part('code').actionType).toBe(part('lab').actionType);
    expect(partDeliverable(part('code')).type).toBe('code');
    expect(partDeliverable(part('lab')).type).toBe('nexbook');
  });

  it('una parte de código nace con lenguaje y modalidad', () => {
    const deliverable = partDeliverable(part('code'));
    expect(deliverable.language).toBe('python');
    expect(deliverable.codeMode).toBe('editor');
    expect(deliverable.executionEnabled).toBe(false);
  });

  it('una parte de laboratorio no arrastra campos de código', () => {
    const deliverable = partDeliverable(part('lab'));
    expect(deliverable.language).toBeNull();
    expect(deliverable.codeMode).toBeNull();
    expect(deliverable.starterCode).toBe('');
  });
});

describe('NexIA como entregable', () => {
  it('nace con la conclusión opcional', () => {
    expect(partDeliverable(part('ai')).conclusionMode).toBe('optional');
  });

  it('ninguna otra intención guarda una política de conclusión', () => {
    for (const action of ACTIVITY_ACTIONS) {
      if (action.id === 'ai') continue;
      expect(partDeliverable(part(action.id)).conclusionMode).toBeNull();
    }
  });

  it('cambiar de tipo y volver no inventa «obligatoria»', () => {
    const ai = partDeliverable(part('ai'));
    const asText = retypeDeliverable({ ...ai, conclusionMode: 'required' }, 'text');
    expect(asText.conclusionMode).toBeNull();
    expect(retypeDeliverable(asText, 'ai_worklog').conclusionMode).toBe('optional');
  });
});

describe('cambiar la intención de una parte', () => {
  it('conserva la pista y limpia lo específico del tipo anterior', () => {
    const code = {
      ...makeDeliverable('code'),
      hint: 'Entrega el modelo completo.',
      starterCode: 'print(1)',
      executionEnabled: true,
    };
    const asText = retypeDeliverable(code, 'text');

    expect(asText.hint).toBe('Entrega el modelo completo.');
    expect(asText.starterCode).toBe('');
    expect(asText.executionEnabled).toBe(false);
    expect(asText.language).toBeNull();
  });

  it('conserva los campos sólo mientras siga siendo una respuesta por campos', () => {
    const questions: ResearchQuestion[] = [
      { id: 'q1', group: null, groupId: 'q1', prompt: 'Definición', type: 'long_text', required: true },
    ];
    const structured = { ...makeDeliverable('structured'), questions };

    expect(retypeDeliverable(structured, 'structured').questions).toHaveLength(1);
    expect(retypeDeliverable(structured, 'text').questions).toEqual([]);
  });
});

describe('los títulos aparecen cuando hacen falta', () => {
  it('la primera parte no recibe título: la actividad ya lo tiene', () => {
    const { parts } = titleForNewPart([], part('respond', 'text'));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.title).toBe('');
  });

  it('al añadir la segunda, las dos se nombran con su intención', () => {
    const first = titleForNewPart([], part('respond', 'text')).parts;
    const { parts } = titleForNewPart(first, part('lab'));

    expect(parts.map((item) => item.title)).toEqual([
      'Responder',
      'Trabajar en laboratorio — NexLab',
    ]);
  });

  it('un título ya escrito no se pisa', () => {
    const first = [{ ...part('respond', 'text'), title: 'Lee el caso' }];
    const { parts } = titleForNewPart(first, part('code'));
    expect(parts[0]!.title).toBe('Lee el caso');
  });

  it('dar título a la primera parte hace que la actividad deje de ser sencilla', () => {
    const single = titleForNewPart([], part('respond', 'text')).parts;
    expect(
      deriveActivity({ parts: single, wasWorkflow: false, researchQuestions: NO_QUESTIONS }).type
    ).toBe('freeform');

    const two = titleForNewPart(single, part('code')).parts;
    expect(
      deriveActivity({ parts: two, wasWorkflow: false, researchQuestions: NO_QUESTIONS }).type
    ).toBe('workflow');
  });
});

describe('añadir, mover y quitar partes', () => {
  it('mover reescribe `order`, que es dato y no el índice del array', () => {
    const parts = [part('respond', 'text'), part('code'), part('lab')];
    const moved = movePart(parts, 2, -1);

    expect(moved.map((item) => partDeliverable(item).type)).toEqual(['text', 'nexbook', 'code']);
    expect(moved.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it('mover fuera de rango no hace nada', () => {
    const parts = [part('respond', 'text'), part('code')];
    expect(movePart(parts, 0, -1).map((item) => item.id)).toEqual(parts.map((item) => item.id));
    expect(movePart(parts, 1, 1).map((item) => item.id)).toEqual(parts.map((item) => item.id));
  });

  it('quitar una parte de la que nadie depende la quita y renumera', () => {
    const parts = [part('respond', 'text'), part('code'), part('lab')];
    const result = removePart(parts, parts[1]!.id);

    expect(result.blockedBy).toEqual([]);
    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((item) => item.order)).toEqual([0, 1]);
  });

  it('quitar una parte de la que otra depende NO borra la dependencia en silencio', () => {
    const first = part('respond', 'text');
    const second = { ...part('code'), dependsOnStepIds: [first.id] };
    const parts = [first, second];

    const blocked = removePart(parts, first.id);
    expect(blocked.parts).toHaveLength(2);
    expect(blocked.blockedBy.map((item) => item.id)).toEqual([second.id]);
    expect(dependentsOf(parts, first.id)).toHaveLength(1);
  });

  it('sólo al pedirlo explícitamente se libera a quien dependía', () => {
    const first = part('respond', 'text');
    const second = { ...part('code'), dependsOnStepIds: [first.id] };

    const released = removePart([first, second], first.id, { releaseDependents: true });
    expect(released.blockedBy).toEqual([]);
    expect(released.parts).toHaveLength(1);
    expect(released.parts[0]!.dependsOnStepIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Derivación de la forma guardada
// ---------------------------------------------------------------------------

const NO_QUESTIONS: ResearchQuestion[] = [];

describe('derivación de la forma', () => {
  it('dos o más partes se guardan como proceso', () => {
    const derived = deriveActivity({
      parts: [part('respond', 'text'), part('code')],
      wasWorkflow: false,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.type).toBe('workflow');
    expect(derived.workflow).toHaveLength(2);
  });

  it('una parte que cabe en la forma antigua se guarda como antes', () => {
    const derived = deriveActivity({
      parts: [{ ...part('respond', 'text'), title: '' }],
      wasWorkflow: false,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.type).toBe('freeform');
    expect(derived.workflow).toEqual([]);
  });

  it.each([
    ['respond:text', 'text', 'freeform'],
    ['respond:structured', 'structured', 'research'],
    ['ai', 'ai_worklog', 'ai_worklog'],
    ['project', 'project', 'web_project'],
    ['evidence:link', 'url', 'external_link'],
  ] as const)('%s tiene equivalente antiguo %s', (_name, _deliverable, expected) => {
    const [action, variant] = _name.split(':') as [ActivityActionId, string | undefined];
    const created = { ...part(action, variant), title: '' };
    expect(legacyEquivalent(created)).toBe(expected as AssignmentType);
  });

  it.each(['code', 'lab', 'instruction'] as const)(
    '%s no tiene equivalente antiguo y fuerza el proceso',
    (action) => {
      const created = { ...part(action), title: '' };
      expect(legacyEquivalent(created)).toBeNull();

      const derived = deriveActivity({
        parts: [created],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
      });
      expect(derived.type).toBe('workflow');
      expect(derived.workflow).toHaveLength(1);
    }
  );

  it.each(['file', 'image', 'video'] as const)(
    'entregar %s tampoco cabe en la forma antigua',
    (variant) => {
      expect(legacyEquivalent({ ...part('evidence', variant), title: '' })).toBeNull();
    }
  );

  /**
   * La mitad que se olvida: que el ENTREGABLE tenga equivalente no basta. Lo que
   * la parte diga por encima de lo que la lectura antigua sintetiza se perdería.
   */
  describe('una parte no cabe en la forma antigua si dice algo que ésta no guarda', () => {
    const base = (): WorkflowStep => ({ ...part('respond', 'text'), title: '' });

    it('título propio', () => {
      expect(legacyEquivalent({ ...base(), title: 'Parte 1' })).toBeNull();
    });
    it('instrucciones propias', () => {
      expect(legacyEquivalent({ ...base(), instructions: 'Haz esto.' })).toBeNull();
    });
    it('prompt', () => {
      expect(
        legacyEquivalent({
          ...base(),
          prompt: { mode: 'inline', title: '', text: 'Resume', resourceId: null },
        })
      ).toBeNull();
    });
    it('recursos propios', () => {
      expect(legacyEquivalent({ ...base(), resources: [{ kind: 'prompt', id: 'r1' }] })).toBeNull();
    });
    it('responsables', () => {
      expect(legacyEquivalent({ ...base(), assignedTo: ['ana'] })).toBeNull();
    });
    it('dependencias', () => {
      expect(legacyEquivalent({ ...base(), dependsOnStepIds: ['otro'] })).toBeNull();
    });
    it('ser opcional', () => {
      expect(legacyEquivalent({ ...base(), required: false })).toBeNull();
    });
    it('una herramienta concreta', () => {
      expect(
        legacyEquivalent({
          ...base(),
          tool: { mode: 'required', toolIds: [], toolNames: ['Perplexity'] },
        })
      ).toBeNull();
    });
    it('una pista sobre la entrega', () => {
      const deliverable = { ...makeDeliverable('text'), hint: 'Tres párrafos.' };
      expect(legacyEquivalent({ ...base(), deliverables: [deliverable] })).toBeNull();
    });
    it('una conclusión obligatoria en un registro de IA', () => {
      const ai = { ...part('ai'), title: '' };
      expect(legacyEquivalent(ai)).toBe('ai_worklog');

      const strict = {
        ...ai,
        deliverables: [{ ...partDeliverable(ai), conclusionMode: 'required' as const }],
      };
      expect(legacyEquivalent(strict)).toBeNull();
    });
  });

  /**
   * El modelo EXIGE un título por parte. La interfaz lo ofrece como opcional. La
   * derivación es donde esas dos cosas se concilian, y tiene que hacerlo sin
   * inventar nada que quien lo lea no reconozca.
   */
  describe('una parte guardada como proceso nunca sale sin nombre', () => {
    it('con una sola parte hereda el título de la actividad', () => {
      const derived = deriveActivity({
        parts: [part('lab')],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Análisis de ventas',
      });

      expect(derived.type).toBe('workflow');
      expect(derived.workflow[0]!.title).toBe('Análisis de ventas');
    });

    it('con varias partes, cada una toma el nombre de su intención', () => {
      const derived = deriveActivity({
        parts: [part('code'), part('instruction')],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Proceso',
      });

      expect(derived.workflow.map((item) => item.title)).toEqual([
        'Programar — NexCode',
        'Continuar proceso',
      ]);
    });

    it('sin título de actividad tampoco se queda vacío', () => {
      const derived = deriveActivity({
        parts: [part('lab')],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
      });
      expect(derived.workflow[0]!.title).toBe('Trabajar en laboratorio — NexLab');
    });

    it('un título escrito a mano manda sobre cualquier relleno', () => {
      const derived = deriveActivity({
        parts: [{ ...part('lab'), title: 'Laboratorio de ventas' }],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Otra cosa',
      });
      expect(derived.workflow[0]!.title).toBe('Laboratorio de ventas');
    });

    it('un título de sólo espacios cuenta como vacío', () => {
      // Si no, la parte se guardaría con un nombre en blanco y el estudiante
      // vería un hueco en su lista. `trim` es lo que hace la regla determinista.
      const derived = deriveActivity({
        parts: [{ ...part('lab'), title: '   ' }],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Análisis de ventas',
      });
      expect(derived.workflow[0]!.title).toBe('Análisis de ventas');
    });

    it('volver a guardar no vuelve a renombrar: el relleno es idempotente', () => {
      /**
       * El caso real: se guarda, se reabre para cambiar la fecha y se guarda
       * otra vez. Tras la primera vuelta el título YA es explícito, así que el
       * relleno tiene que dejarlo en paz —aunque entretanto cambie el título de
       * la actividad, que es cuando un relleno mal hecho reescribiría el de la
       * parte sin que nadie lo pidiera—.
       */
      const first = deriveActivity({
        parts: [part('lab')],
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Análisis de ventas',
      });

      const second = deriveActivity({
        parts: first.workflow,
        wasWorkflow: true,
        researchQuestions: NO_QUESTIONS,
        activityTitle: 'Análisis de ventas (rev. 2)',
      });

      expect(second.workflow[0]!.title).toBe('Análisis de ventas');
    });

    it('ninguna parte del proceso sale con el título vacío, venga de donde venga', () => {
      const derived = deriveActivity({
        parts: ACTIVITY_ACTIONS.map((action) => part(action.id)),
        wasWorkflow: false,
        researchQuestions: NO_QUESTIONS,
      });
      for (const step of derived.workflow) {
        expect(step.title.trim().length).toBeGreaterThan(0);
      }
    });
  });

  /**
   * La regla que protege lo ya entregado: la evidencia se indexa por el id de la
   * parte, así que una actividad que ya era un proceso no puede volver atrás.
   */
  it('un proceso nunca se degrada a la forma antigua, ni con una sola parte', () => {
    const derived = deriveActivity({
      parts: [{ ...part('respond', 'text'), title: '' }],
      wasWorkflow: true,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.type).toBe('workflow');
    expect(derived.workflow).toHaveLength(1);
  });

  it('los campos de una respuesta por campos suben a la actividad en la forma antigua', () => {
    const questions: ResearchQuestion[] = [
      { id: 'q1', group: 'Card sorting', groupId: 'g1', prompt: 'Definición', type: 'long_text', required: true },
    ];
    const structured = {
      ...part('respond', 'structured'),
      title: '',
      deliverables: [{ ...makeDeliverable('structured'), questions }],
    };

    const derived = deriveActivity({
      parts: [structured],
      wasWorkflow: false,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.type).toBe('research');
    expect(derived.researchQuestions).toEqual(questions);
  });

  it('al pasar a proceso, los campos antiguos de la actividad no se tiran', () => {
    const questions: ResearchQuestion[] = [
      { id: 'q1', group: null, groupId: 'g1', prompt: 'Definición', type: 'long_text', required: true },
    ];

    const derived = deriveActivity({
      parts: [part('respond', 'text'), part('code')],
      wasWorkflow: false,
      researchQuestions: questions,
    });

    expect(derived.type).toBe('workflow');
    expect(derived.researchQuestions).toEqual(questions);
  });
});

// ---------------------------------------------------------------------------
// Compatibilidad con lo que ya existe
// ---------------------------------------------------------------------------

describe('actividades anteriores', () => {
  const LEGACY_TYPES: AssignmentType[] = [
    'freeform',
    'research',
    'ai_worklog',
    'external_link',
    'web_project',
  ];

  it.each(LEGACY_TYPES)('una actividad «%s» abre, se guarda y sigue siendo lo que era', (type) => {
    const researchQuestions: ResearchQuestion[] =
      type === 'research'
        ? [
            {
              id: 'q1',
              group: 'Card sorting',
              groupId: 'g1',
              prompt: 'Definición',
              type: 'long_text',
              required: true,
            },
          ]
        : [];

    const loaded = { type, workflow: [] as WorkflowStep[], researchQuestions };
    const parts = partsFromAssignment(loaded, nextId);

    expect(parts).toHaveLength(1);

    const derived = deriveActivity({
      parts,
      wasWorkflow: false,
      researchQuestions,
    });

    expect(derived.type).toBe(type);
    expect(derived.workflow).toEqual([]);
    expect(derived.researchQuestions).toEqual(researchQuestions);
  });

  it('la parte que representa una actividad antigua reproduce el paso que el servidor sintetiza', () => {
    for (const type of LEGACY_TYPES) {
      const assignment = {
        type,
        title: 'Título',
        description: 'Objetivo',
        instructions: 'Instrucciones',
        researchQuestions: [] as ResearchQuestion[],
        resources: [],
      };

      const synthesized = synthesizeLegacyStep(assignment);
      const [representation] = partsFromAssignment(
        { type, workflow: [], researchQuestions: [] },
        nextId
      );

      // El entregable y el modo de herramienta son los que la lectura del
      // servidor ya producía. Si divergieran, abrir y guardar cambiaría la
      // actividad sin que nadie lo hubiera pedido.
      expect(partDeliverable(representation!).type).toBe(synthesized.deliverables[0]!.type);
      expect(representation!.tool.mode).toBe(synthesized.tool.mode);
    }
  });

  it('una actividad de varias partes abre como tal y conserva sus ids', () => {
    const workflow = [
      { ...part('respond', 'text'), id: 'uno', title: 'Uno', order: 0 },
      { ...part('code'), id: 'dos', title: 'Dos', order: 1, dependsOnStepIds: ['uno'] },
    ];

    const parts = partsFromAssignment(
      { type: 'workflow', workflow, researchQuestions: [] },
      nextId
    );

    expect(parts.map((item) => item.id)).toEqual(['uno', 'dos']);
    expect(parts[1]!.dependsOnStepIds).toEqual(['uno']);
  });

  it('un tipo de entrega retirado del catálogo no se destruye al abrir ni al guardar', () => {
    const legacy = normalizeStep(
      {
        id: 'viejo',
        title: 'Elige recursos',
        actionType: 'external_resource',
        deliverables: [{ type: 'resource_reference', required: true, hint: '', questions: [] }],
      },
      0
    ) as WorkflowStep;

    // No se ofrece en el catálogo…
    expect(actionForPart(legacy).action).toBe('legacy');
    expect(partActionLabel(legacy)).toBe('Elegir recursos de la materia');

    // …pero sobrevive intacto a la derivación.
    const derived = deriveActivity({
      parts: [legacy],
      wasWorkflow: true,
      researchQuestions: NO_QUESTIONS,
    });
    expect(partDeliverable(derived.workflow[0]!).type).toBe('resource_reference');
    expect(derived.workflow[0]!.actionType).toBe('external_resource');
  });

  it('una acción desconocida se conserva tal cual', () => {
    const exotic: WorkflowStep = {
      ...part('respond', 'text'),
      actionType: 'herramienta_que_no_existia',
    };

    const derived = deriveActivity({
      parts: [exotic, part('code')],
      wasWorkflow: false,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.workflow[0]!.actionType).toBe('herramienta_que_no_existia');
  });

  it('prompts, herramientas, responsables y dependencias sobreviven a la derivación', () => {
    const rich: WorkflowStep = {
      ...part('evidence', 'link'),
      id: 'uno',
      title: 'Busca fuentes',
      prompt: { mode: 'library', title: 'Buscar fuentes', text: '', resourceId: 'res-1' },
      tool: { mode: 'choice', toolIds: ['t1'], toolNames: ['Perplexity'] },
      resources: [{ kind: 'skill', id: 's1' }],
      assignedTo: ['ana', 'luis'],
    };
    const second: WorkflowStep = { ...part('code'), id: 'dos', dependsOnStepIds: ['uno'] };

    const derived = deriveActivity({
      parts: [rich, second],
      wasWorkflow: false,
      researchQuestions: NO_QUESTIONS,
    });

    expect(derived.workflow[0]).toMatchObject({
      prompt: { mode: 'library', resourceId: 'res-1' },
      tool: { mode: 'choice', toolIds: ['t1'], toolNames: ['Perplexity'] },
      resources: [{ kind: 'skill', id: 's1' }],
      assignedTo: ['ana', 'luis'],
    });
    expect(derived.workflow[1]!.dependsOnStepIds).toEqual(['uno']);
  });
});

// ---------------------------------------------------------------------------
// Errores en lenguaje de persona
// ---------------------------------------------------------------------------

describe('qué falta, dicho como se lo diría una persona', () => {
  it('un título corto impide publicar', () => {
    const problems = activityProblems({ title: 'ab', parts: [part('respond', 'text')] });
    expect(blockingProblems(problems)).toHaveLength(1);
    expect(problems[0]!.message).toContain('título');
  });

  it('con una sola parte no se pide un segundo título', () => {
    const problems = activityProblems({
      title: 'Análisis de ventas',
      parts: [{ ...part('respond', 'text'), title: '' }],
    });
    expect(problems).toEqual([]);
  });

  it('con varias partes se avisa de la que no tiene nombre, sin impedir publicar', () => {
    const problems = activityProblems({
      title: 'Análisis de ventas',
      parts: [{ ...part('respond', 'text'), title: 'Una' }, { ...part('code'), title: '' }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.part).toBe(1);
    expect(problems[0]!.message).toContain('Parte 2');
    // Se completa al guardar, así que avisar basta: bloquear sería mentir.
    expect(problems[0]!.severity).toBe('soft');
    expect(problems[0]!.message).toContain('Programar — NexCode');
  });

  it('lo que no impide guardar un borrador se marca como blando', () => {
    const problems = activityProblems({
      title: 'Glosario',
      parts: [{ ...part('respond', 'structured'), title: '' }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.severity).toBe('soft');
    expect(blockingProblems(problems)).toEqual([]);
  });

  it('una dependencia hacia una parte que ya no existe sí impide publicar', () => {
    const problems = activityProblems({
      title: 'Proceso',
      parts: [
        { ...part('respond', 'text'), title: 'Una' },
        { ...part('code'), title: 'Dos', dependsOnStepIds: ['fantasma'] },
      ],
    });

    expect(blockingProblems(problems)).toHaveLength(1);
    expect(problems.find((item) => item.field === 'dependsOn')?.message).toContain('Parte 2');
  });

  it('ningún mensaje enseña la ruta del modelo', () => {
    const problems = activityProblems({
      title: 'ab',
      parts: [
        { ...part('respond', 'structured'), title: '' },
        { ...part('code'), title: '', tool: { mode: 'required', toolIds: [], toolNames: [] } },
      ],
    });

    for (const problem of problems) {
      expect(problem.message).not.toMatch(/workflow|deliverable|actionType|\[\d+\]/i);
    }
  });

  it('un error del servidor con ruta técnica se traduce a la Parte que le toca', () => {
    expect(humanizeSaveError('workflow.2.title: El paso necesita un título.')).toBe(
      'La Parte 3 necesita un título.'
    );
    expect(humanizeSaveError('El título necesita al menos 3 caracteres.')).toBe(
      'El título necesita al menos 3 caracteres.'
    );
  });
});
