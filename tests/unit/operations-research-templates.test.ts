import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_RESEARCH,
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  instantiateWorkflowTemplate,
  templateStepId,
  templateWorkflowSteps,
  workflowTemplatesBySubject,
} from '../../src/lib/workflow-templates';
import { assertAcyclicWorkflow, stepState } from '../../src/lib/workflow';
import { workflowStepSchema } from '../../src/lib/academic-schemas';
import type { StepEvidence, WorkflowStepRecord } from '../../src/lib/types';

/**
 * Las plantillas de Investigación de Operaciones.
 *
 * Lo que se prueba no es que existan cinco cadenas de texto: es que se comportan
 * como cualquier otro workflow y que dos tareas creadas desde la misma plantilla
 * quedan COMPLETAMENTE separadas. Compartir un `stepId` entre dos tareas
 * significa compartir claves en `Submission.stepEvidence`, y eso es corrupción
 * silenciosa de trabajo académico.
 */

const IDS = [
  'io-modelado-matematico',
  'io-programacion-lineal',
  'io-transporte-asignacion',
  'io-redes-pert-cpm',
  'io-caso-practico-software',
];

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

describe('el catálogo', () => {
  it('trae las cinco plantillas de Investigación de Operaciones', () => {
    const operations = WORKFLOW_TEMPLATES.filter(
      (template) => template.subject === OPERATIONS_RESEARCH
    );
    expect(operations.map((template) => template.id)).toEqual(IDS);
  });

  it('cada una se puede pedir por su identificador', () => {
    for (const id of IDS) expect(getWorkflowTemplate(id)?.id).toBe(id);
    expect(getWorkflowTemplate('no-existe')).toBeNull();
  });

  it('se agrupan por materia para poder pintarlas juntas', () => {
    const groups = workflowTemplatesBySubject();
    expect(groups.map((group) => group.subject)).toContain(OPERATIONS_RESEARCH);
    expect(groups.find((group) => group.subject === OPERATIONS_RESEARCH)?.templates).toHaveLength(5);
  });

  it('todas dicen para qué sirven y con cuántos pasos', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(3);
      expect(template.summary.length).toBeGreaterThan(10);
      expect(template.steps.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('los pasos son workflows normales', () => {
  it('cada paso pasa el MISMO esquema que un paso escrito a mano', () => {
    // Si una plantilla produjera un paso que la API rechaza, la tarea sería
    // imposible de guardar y sólo se descubriría al pulsar Publicar.
    for (const template of WORKFLOW_TEMPLATES) {
      for (const step of templateWorkflowSteps(template)) {
        const parsed = workflowStepSchema.safeParse({ ...step, assignedHandles: null });
        expect(parsed.success, `${template.id} · ${step.title}`).toBe(true);
      }
    }
  });

  it('ninguna plantilla tiene dependencias cíclicas', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(() => assertAcyclicWorkflow(templateWorkflowSteps(template))).not.toThrow();
    }
  });

  it('toda dependencia apunta a un paso que existe y va ANTES', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const steps = templateWorkflowSteps(template);
      const position = new Map(steps.map((step, index) => [step.id, index]));

      steps.forEach((step, index) => {
        for (const dependency of step.dependsOnStepIds) {
          expect(position.has(dependency), `${template.id}: ${dependency}`).toBe(true);
          expect(position.get(dependency)!).toBeLessThan(index);
        }
      });
    }
  });

  it('los pasos se numeran de cero y sin huecos', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const steps = templateWorkflowSteps(template);
      expect(steps.map((step) => step.order)).toEqual(steps.map((_step, index) => index));
    }
  });

  it('un paso opcional no bloquea a los siguientes', () => {
    /**
     * Es la trampa del encadenado. Si el paso siguiente dependiera del anterior
     * a secas, saltarse uno opcional —que es para lo que existe— dejaría todo
     * lo que viene detrás en `locked` y la actividad imposible de terminar.
     */
    for (const template of WORKFLOW_TEMPLATES) {
      const steps = templateWorkflowSteps(template);
      const optional = steps.filter((step) => !step.required);
      if (optional.length === 0) continue;

      // Se completa TODO menos los pasos opcionales.
      const evidence: Record<string, StepEvidence> = {};
      for (const step of steps) {
        if (step.required) evidence[step.id] = filled(step.id);
      }

      for (const step of steps) {
        if (!step.required) continue;
        expect(stepState(step, evidence), `${template.id} · ${step.title}`).toBe('done');
      }
    }
  });
});

describe('clonar una plantilla de la materia', () => {
  it('los pasos que entran en la tarea NO conservan los ids de la plantilla', () => {
    for (const id of IDS) {
      const cloned = instantiateWorkflowTemplate(id, counter('c'));
      expect(cloned.some((step) => step.id.startsWith(id))).toBe(false);
      expect(cloned.every((step) => step.id.startsWith('c'))).toBe(true);
    }
  });

  it('ninguna dependencia queda apuntando a un id de la plantilla', () => {
    for (const id of IDS) {
      const dangling = instantiateWorkflowTemplate(id, counter('c'))
        .flatMap((step) => step.dependsOnStepIds)
        .filter((dependency) => dependency.startsWith(id));
      expect(dangling).toEqual([]);
    }
  });

  it('las dependencias se remapean a los ids nuevos', () => {
    const cloned = instantiateWorkflowTemplate('io-programacion-lineal', counter('c'));
    const ids = new Set(cloned.map((step) => step.id));

    for (const step of cloned) {
      for (const dependency of step.dependsOnStepIds) expect(ids.has(dependency)).toBe(true);
    }
  });

  it('dos tareas de la misma plantilla no comparten NI UN identificador', () => {
    // Ésta es la invariante que protege el trabajo entregado: con ids
    // compartidos, la evidencia de una tarea se leería como la de la otra.
    for (const id of IDS) {
      const first = instantiateWorkflowTemplate(id, counter('a'));
      const second = instantiateWorkflowTemplate(id, counter('b'));

      const ids = new Set(first.map((step) => step.id));
      expect(second.filter((step) => ids.has(step.id))).toEqual([]);
    }
  });

  it('editar una tarea no toca la plantilla ni la otra tarea', () => {
    const first = instantiateWorkflowTemplate('io-modelado-matematico', counter('a'));
    const second = instantiateWorkflowTemplate('io-modelado-matematico', counter('b'));

    first[0]!.title = 'Reescrito por la docente';
    first[0]!.deliverables[0]!.hint = 'cambiado';
    first[0]!.deliverables[0]!.required = false;

    expect(second[0]?.title).toBe('Comprender el problema');
    expect(second[0]?.deliverables[0]?.hint).not.toBe('cambiado');
    expect(getWorkflowTemplate('io-modelado-matematico')?.steps[0]?.title).toBe(
      'Comprender el problema'
    );
    // Y volver a instanciarla sigue dando la plantilla original.
    expect(instantiateWorkflowTemplate('io-modelado-matematico', counter('c'))[0]?.title).toBe(
      'Comprender el problema'
    );
  });

  it('el clon conserva el contenido y qué pasos eran opcionales', () => {
    const template = getWorkflowTemplate('io-redes-pert-cpm')!;
    const cloned = instantiateWorkflowTemplate(template.id, counter('c'));

    expect(cloned.map((step) => step.title)).toEqual(template.steps.map((step) => step.title));
    expect(cloned.map((step) => step.required)).toEqual(
      template.steps.map((step) => step.required !== false)
    );
  });

  it('una plantilla que no existe devuelve lista vacía en vez de romper', () => {
    expect(instantiateWorkflowTemplate('io-no-existe')).toEqual([]);
  });

  it('sin generador propio los ids siguen siendo distintos entre instancias', () => {
    // El generador determinista es para poder afirmar cosas concretas; el de
    // verdad tiene que producir ids nuevos por sí solo.
    const first = instantiateWorkflowTemplate('io-transporte-asignacion');
    const second = instantiateWorkflowTemplate('io-transporte-asignacion');
    const ids = new Set(first.map((step) => step.id));
    expect(second.filter((step) => ids.has(step.id))).toEqual([]);
  });
});

describe('lo que pide cada plantilla', () => {
  it('el modelado matemático termina en interpretación', () => {
    const steps = templateWorkflowSteps(getWorkflowTemplate('io-modelado-matematico')!);
    expect(steps.at(-1)?.title).toBe('Interpretación');
  });

  it('el Simplex admite subir las iteraciones como archivo', () => {
    const steps = templateWorkflowSteps(getWorkflowTemplate('io-programacion-lineal')!);
    const desarrollo = steps.find((step) => step.title.includes('Desarrollo'));
    expect(desarrollo?.deliverables[0]?.type).toBe('file');
  });

  it('transporte pide la matriz como archivo, sin editor matemático', () => {
    const steps = templateWorkflowSteps(getWorkflowTemplate('io-transporte-asignacion')!);
    const matriz = steps.find((step) => step.title.includes('matriz'));
    expect(matriz?.deliverables[0]?.type).toBe('file');
  });

  it('redes admite el diagrama como archivo o imagen', () => {
    const steps = templateWorkflowSteps(getWorkflowTemplate('io-redes-pert-cpm')!);
    const red = steps.find((step) => step.title.includes('red'));
    expect(red?.deliverables[0]?.type).toBe('file');
  });

  it('el caso práctico con software pide código en R y deja la herramienta libre', () => {
    const steps = templateWorkflowSteps(getWorkflowTemplate('io-caso-practico-software')!);

    const codigo = steps.find((step) => step.deliverables[0]?.type === 'code');
    expect(codigo?.deliverables[0]?.language).toBe('r');

    const herramienta = steps.find((step) => step.tool.mode === 'free');
    expect(herramienta?.title).toContain('Herramienta');
  });

  it('el identificador de un paso de plantilla lleva su prefijo', () => {
    expect(templateStepId('io-modelado-matematico', 'variables')).toBe(
      'io-modelado-matematico:variables'
    );
  });
});

/** Evidencia con contenido, para poder marcar un paso como hecho. */
function filled(stepId: string): StepEvidence {
  return {
    stepId,
    toolId: null,
    toolName: '',
    startedAt: null,
    completedAt: null,
    data: { text: 'respondido', links: [] },
    note: '',
  };
}

/** Ayuda al lector: los pasos de una plantilla son registros de workflow. */
export type _Steps = WorkflowStepRecord[];
