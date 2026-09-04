import { describe, expect, it } from 'vitest';
import { cloneWorkflowSteps, templateSteps } from '../../src/lib/workflow';
import { toCourseResource } from '../../src/lib/data/academic-mappers';
import { courseResourceInputSchema } from '../../src/lib/academic-schemas';
import { authorship, courseResource, step, UID } from './academic-fixtures';
import type { WorkflowStepRecord } from '../../src/lib/types';

/**
 * Plantillas reutilizables de workflow (§28).
 *
 * La prueba que de verdad importa es la de los identificadores. Si dos tareas
 * creadas desde la misma plantilla conservaran los ids de sus pasos,
 * compartirían claves en `Submission.stepEvidence`: lo que alguien escribiera
 * en un paso de la primera aparecería como escrito en el mismo paso de la
 * segunda. Es corrupción silenciosa de trabajo académico, no un detalle.
 */

/** Generador determinista, para poder afirmar cosas concretas sobre el clon. */
function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

const templateOf = (): WorkflowStepRecord[] => [
  step({ id: 'tpl-1', order: 0, title: 'Perplexity', actionType: 'external_tool' }),
  step({ id: 'tpl-2', order: 1, title: 'NotebookLM', dependsOnStepIds: ['tpl-1'] }),
  step({ id: 'tpl-3', order: 2, title: 'Miro', dependsOnStepIds: ['tpl-2'] }),
  step({
    id: 'tpl-4',
    order: 3,
    title: 'Reflexión',
    required: false,
    dependsOnStepIds: ['tpl-3'],
  }),
];

describe('clonar una plantilla: los identificadores', () => {
  it('cada paso recibe un id NUEVO', () => {
    const cloned = cloneWorkflowSteps(templateOf(), counter('a'));
    expect(cloned.map((s) => s.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(cloned.some((s) => s.id.startsWith('tpl-'))).toBe(false);
  });

  it('dos tareas de la misma plantilla NO comparten ningún id', () => {
    // Ésta es la invariante. Sin ella, la evidencia de una tarea se leería como
    // evidencia de la otra.
    const template = templateOf();
    const a = cloneWorkflowSteps(template, counter('a'));
    const b = cloneWorkflowSteps(template, counter('b'));

    const idsA = new Set(a.map((s) => s.id));
    const shared = b.filter((s) => idsA.has(s.id));
    expect(shared).toEqual([]);
  });

  it('las dependencias se remapean a los ids clonados', () => {
    const cloned = cloneWorkflowSteps(templateOf(), counter('a'));
    expect(cloned[1]?.dependsOnStepIds).toEqual(['a1']);
    expect(cloned[2]?.dependsOnStepIds).toEqual(['a2']);
    expect(cloned[3]?.dependsOnStepIds).toEqual(['a3']);
  });

  it('ninguna dependencia queda apuntando a un id de la plantilla', () => {
    const cloned = cloneWorkflowSteps(templateOf(), counter('a'));
    const dangling = cloned.flatMap((s) => s.dependsOnStepIds).filter((id) => id.startsWith('tpl-'));
    expect(dangling).toEqual([]);
  });

  it('una dependencia hacia un paso que no está en la plantilla se descarta', () => {
    // Dejarla apuntando al id viejo bloquearía ese paso para siempre sin que se
    // viera por qué.
    const cloned = cloneWorkflowSteps(
      [step({ id: 'x', dependsOnStepIds: ['no-existe'] })],
      counter('a')
    );
    expect(cloned[0]?.dependsOnStepIds).toEqual([]);
  });
});

describe('clonar una plantilla: qué se conserva y qué no', () => {
  it('conserva el contenido del paso', () => {
    const [first] = cloneWorkflowSteps(templateOf(), counter('a'));
    expect(first).toMatchObject({
      title: 'Perplexity',
      actionType: 'external_tool',
      required: true,
    });
  });

  it('conserva qué pasos eran opcionales', () => {
    const cloned = cloneWorkflowSteps(templateOf(), counter('a'));
    expect(cloned[3]?.required).toBe(false);
  });

  it('reordena de cero, sin huecos', () => {
    const cloned = cloneWorkflowSteps(templateOf(), counter('a'));
    expect(cloned.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('LIMPIA los responsables', () => {
    // Una plantilla puede venir de otra materia, donde esos UID no existen.
    // Copiarlos produciría pasos asignados a gente que no está en el grupo.
    const cloned = cloneWorkflowSteps(
      [step({ id: 'x', assignedTo: [UID.christian, UID.ana] })],
      counter('a')
    );
    expect(cloned[0]?.assignedTo).toBeNull();
  });

  it('conserva la herramienta con su nombre', () => {
    const cloned = cloneWorkflowSteps(
      [
        step({
          id: 'x',
          tool: { mode: 'required', toolIds: ['t1'], toolNames: ['Perplexity'] },
        }),
      ],
      counter('a')
    );
    expect(cloned[0]?.tool.toolNames).toEqual(['Perplexity']);
  });
});

describe('clonar no modifica la plantilla original', () => {
  it('los pasos de la plantilla siguen intactos tras clonar', () => {
    const template = templateOf();
    const before = JSON.stringify(template);

    cloneWorkflowSteps(template, counter('a'));

    expect(JSON.stringify(template)).toBe(before);
  });

  it('editar el clon no toca la plantilla', () => {
    // Sin copia en profundidad, mutar `tool` o `deliverables` del clon cambiaría
    // también la plantilla, porque serían el mismo objeto.
    const template = templateOf();
    const cloned = cloneWorkflowSteps(template, counter('a'));

    cloned[0]!.tool.toolNames.push('Otra herramienta');
    cloned[0]!.deliverables[0]!.hint = 'cambiado';

    expect(template[0]?.tool.toolNames).toEqual([]);
    expect(template[0]?.deliverables[0]?.hint).toBe('');
  });

  it('clonar dos veces produce clones independientes entre sí', () => {
    const template = templateOf();
    const a = cloneWorkflowSteps(template, counter('a'));
    const b = cloneWorkflowSteps(template, counter('b'));

    a[0]!.title = 'Cambiado en A';
    expect(b[0]?.title).toBe('Perplexity');
  });
});

describe('leer los pasos de un recurso', () => {
  it('un recurso de tipo `workflow` devuelve sus pasos', () => {
    const steps = templateSteps({ type: 'workflow', workflowSteps: templateOf() });
    expect(steps).toHaveLength(4);
  });

  it('un recurso que NO es plantilla devuelve lista vacía', () => {
    // Un enlace con pasos colgando sería un registro que hay que interpretar.
    expect(templateSteps({ type: 'tool', workflowSteps: templateOf() })).toEqual([]);
  });

  it('una plantilla sin el campo no rompe', () => {
    expect(templateSteps({ type: 'workflow' })).toEqual([]);
  });

  it('normaliza pasos guardados a medias', () => {
    const steps = templateSteps({ type: 'workflow', workflowSteps: [{ title: 'Suelto' }] });
    expect(steps[0]).toMatchObject({ title: 'Suelto', actionType: 'instruction', required: true });
  });
});

describe('el recurso plantilla', () => {
  it('acepta pasos en la entrada validada', () => {
    const parsed = courseResourceInputSchema.safeParse({
      type: 'workflow',
      title: 'Investigación asistida por IA',
      workflowSteps: [
        { id: 's1', title: 'Perplexity', actionType: 'external_tool' },
        { id: 's2', title: 'Reflexión', dependsOnStepIds: ['s1'] },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.workflowSteps).toHaveLength(2);
  });

  it('un recurso normal no necesita pasos', () => {
    const parsed = courseResourceInputSchema.safeParse({ type: 'tool', title: 'Napkin AI' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.workflowSteps).toEqual([]);
  });

  it('un paso sin título se rechaza: una plantilla a medias produce tareas rotas', () => {
    const parsed = courseResourceInputSchema.safeParse({
      type: 'workflow',
      title: 'Proceso',
      workflowSteps: [{ id: 's1', title: '' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('el DTO conserva la autoría de quien aportó la plantilla', () => {
    const dto = toCourseResource(
      courseResource({
        type: 'workflow',
        title: 'Proceso para diseñar con IA',
        workflowSteps: templateOf(),
        ...authorship({
          status: 'approved',
          authorHandle: 'christian',
          authorName: 'Christian González',
        }),
      })
    );

    expect(dto.workflowSteps).toHaveLength(4);
    expect(dto.author?.handle).toBe('christian');
    expect(dto.approvedBy?.displayName).toBe('Luz Adriana Márquez');
    expect(JSON.stringify(dto)).not.toContain(UID.luz);
  });
});

describe('workflows propuestos por estudiantes (Prioridad 2)', () => {
  const proposal = () =>
    courseResource({
      id: 'wf-1',
      type: 'workflow',
      title: 'Proceso para diseñar una interfaz con IA',
      workflowSteps: [
        step({ id: 'p1', title: 'Perplexity' }),
        step({ id: 'p2', title: 'ChatGPT', dependsOnStepIds: ['p1'] }),
        step({ id: 'p3', title: 'Figma', dependsOnStepIds: ['p2'] }),
      ],
      createdBy: UID.christian,
      ...authorship({
        status: 'proposed',
        authorHandle: 'christian',
        authorName: 'Christian González',
        approvedByUid: null,
        approvedByName: '',
        approvedAt: null,
      }),
    });

  it('un estudiante propone un proceso y nace pendiente', () => {
    const dto = toCourseResource(proposal());
    expect(dto.status).toBe('proposed');
    expect(dto.author?.handle).toBe('christian');
    expect(dto.approvedBy).toBeNull();
    expect(dto.workflowSteps).toHaveLength(3);
  });

  it('al aprobarlo se conserva quién lo aportó', () => {
    const approved = toCourseResource({
      ...proposal(),
      ...authorship({
        status: 'approved',
        authorHandle: 'christian',
        authorName: 'Christian González',
      }),
    });

    expect(approved.status).toBe('approved');
    expect(approved.author?.displayName).toBe('Christian González');
    expect(approved.approvedBy?.displayName).toBe('Luz Adriana Márquez');
  });

  it('el proceso aprobado se puede clonar como cualquier otra plantilla', () => {
    const cloned = cloneWorkflowSteps(proposal().workflowSteps, counter('n'));
    expect(cloned.map((s) => s.id)).toEqual(['n1', 'n2', 'n3']);
    expect(cloned[1]?.dependsOnStepIds).toEqual(['n1']);
  });

  it('el DTO de una propuesta no filtra el UID de quien la escribió', () => {
    expect(JSON.stringify(toCourseResource(proposal()))).not.toContain(UID.christian);
  });
});
