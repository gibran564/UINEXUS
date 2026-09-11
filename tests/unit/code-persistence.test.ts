import { describe, expect, it } from 'vitest';
import {
  cloneWorkflowSteps,
  normalizeDeliverable,
  normalizeStepEvidence,
  primaryDeliverable,
} from '../../src/lib/workflow';
import { workflowStepSchema } from '../../src/lib/academic-schemas';
import { DEFAULT_CODE_MODE, LEGACY_CODE_MODE } from '../../src/lib/constants';
import { step, stepEvidence } from './academic-fixtures';
import type { CodeData, WorkflowStepRecord } from '../../src/lib/types';

/**
 * Que el código del alumnado no se pierda ni se pise.
 *
 * Todo lo de aquí es una promesa concreta que la interfaz hace: recargar
 * conserva lo escrito, dos pasos de código no se mezclan, y cambiar la
 * plantilla no borra el trabajo de quien ya empezó.
 */

const codeStep = (id: string, overrides: Record<string, unknown> = {}): WorkflowStepRecord =>
  step({
    id,
    title: `Paso ${id}`,
    actionType: 'code',
    deliverables: [
      {
        type: 'code',
        required: true,
        hint: '',
        questions: [],
        language: 'python',
        codeMode: 'editor',
        starterCode: '',
        executionEnabled: true,
        ...overrides,
      },
    ],
  });

describe('el fuente vive en la evidencia DE SU paso', () => {
  it('dos pasos de código guardan programas distintos sin mezclarse', () => {
    // Es el caso que rompería una implementación que guardara «el código» de la
    // entrega en vez del de cada paso: modelar en el paso 2 borraría el
    // ejercicio del paso 1.
    const evidence = normalizeStepEvidence({
      stepEvidence: {
        modelo: stepEvidence({
          stepId: 'modelo',
          data: { language: 'python', code: 'print("modelo")' } as CodeData,
        }),
        validacion: stepEvidence({
          stepId: 'validacion',
          data: { language: 'python', code: 'print("validacion")' } as CodeData,
        }),
      },
    });

    expect((evidence.modelo!.data as CodeData).code).toBe('print("modelo")');
    expect((evidence.validacion!.data as CodeData).code).toBe('print("validacion")');
  });

  it('recargar devuelve exactamente lo que se guardó, sangría incluida', () => {
    // El borrador se rehidrata desde aquí: si esto recortara espacios, un
    // programa de Python volvería roto tras un F5.
    const source = 'def resolver(x):\n    if x > 0:\n        return x\n    return 0\n';
    const evidence = normalizeStepEvidence({
      stepEvidence: {
        codigo: stepEvidence({ stepId: 'codigo', data: { code: source } as CodeData }),
      },
    });

    expect((evidence.codigo!.data as CodeData).code).toBe(source);
  });

  it('una entrega antigua sin `stepEvidence` sigue leyéndose', () => {
    const evidence = normalizeStepEvidence({
      data: { language: 'r', code: 'cat(1)' } as CodeData,
      submittedAt: '2026-09-01T10:00:00.000Z',
    });

    expect(Object.keys(evidence)).toHaveLength(1);
    expect((Object.values(evidence)[0]!.data as CodeData).code).toBe('cat(1)');
  });
});

describe('el código inicial de la docente', () => {
  it('viaja en el PASO, no en la entrega', () => {
    // Por eso cambiar la plantilla no puede pisar lo que alguien lleva escrito:
    // son dos sitios distintos. La copia del alumnado está en su evidencia.
    const starter = 'datos = [10, 20, 30]\n';
    const deliverable = primaryDeliverable(codeStep('codigo', { starterCode: starter }));

    expect(deliverable.starterCode).toBe(starter);
  });

  it('se conserva sin recortar: la sangría es parte del programa', () => {
    const starter = '  # empieza aquí\n\n';
    const parsed = workflowStepSchema.safeParse({
      id: 'codigo',
      title: 'Modelo',
      deliverables: [{ type: 'code', language: 'python', starterCode: starter }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.deliverables[0]?.starterCode).toBe(starter);
  });

  it('un paso sin código inicial no impone ninguno', () => {
    expect(primaryDeliverable(codeStep('codigo')).starterCode).toBe('');
  });
});

describe('las modalidades', () => {
  it('un paso nuevo nace en el editor', () => {
    const parsed = workflowStepSchema.safeParse({
      id: 'nuevo',
      title: 'Nuevo',
      deliverables: [{ type: 'code', language: 'python' }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.deliverables[0]?.codeMode).toBe(DEFAULT_CODE_MODE);
    expect(DEFAULT_CODE_MODE).toBe('editor');
  });

  it('un paso guardado ANTES de las modalidades conserva lo que ofrecía', () => {
    // `either` es fuente pegado más archivo opcional: exactamente el
    // comportamiento anterior. Nadie pierde una forma de entregar por una
    // actualización.
    expect(normalizeDeliverable({ type: 'code' }).codeMode).toBe(LEGACY_CODE_MODE);
    expect(LEGACY_CODE_MODE).toBe('either');
  });

  it('el modo `upload` sigue admitiendo el archivo de siempre', () => {
    const deliverable = primaryDeliverable(codeStep('codigo', { codeMode: 'upload' }));
    expect(deliverable.codeMode).toBe('upload');
  });

  it('la ejecución está apagada mientras nadie la encienda', () => {
    expect(normalizeDeliverable({ type: 'code' }).executionEnabled).toBe(false);
  });
});

describe('clonar una actividad de programación', () => {
  it('se lleva lenguaje, modalidad, código inicial y ejecución', () => {
    const [cloned] = cloneWorkflowSteps(
      [
        codeStep('codigo', {
          language: 'r',
          codeMode: 'either',
          starterCode: 'library(lpSolve)\n',
          executionEnabled: true,
        }),
      ],
      () => 'nuevo'
    );

    expect(cloned?.deliverables[0]).toMatchObject({
      language: 'r',
      codeMode: 'either',
      starterCode: 'library(lpSolve)\n',
      executionEnabled: true,
    });
  });

  it('editar la copia NO toca el original', () => {
    // La clonación tiene que ser profunda en las partes que el editor muta. Si
    // compartieran el mismo objeto, retocar la actividad nueva cambiaría la
    // plantilla de la que salió —y la de todo el mundo—.
    const original = codeStep('codigo', { starterCode: 'inicial\n' });
    const [cloned] = cloneWorkflowSteps([original], () => 'nuevo');

    cloned!.deliverables[0]!.starterCode = 'modificado\n';
    cloned!.deliverables[0]!.executionEnabled = false;
    cloned!.deliverables[0]!.questions.push({
      id: 'q1',
      group: null,
      groupId: 'g1',
      prompt: '¿?',
      type: 'short_text',
      required: false,
    });

    expect(original.deliverables[0]!.starterCode).toBe('inicial\n');
    expect(original.deliverables[0]!.executionEnabled).toBe(true);
    expect(original.deliverables[0]!.questions).toHaveLength(0);
    expect(cloned!.deliverables[0]).not.toBe(original.deliverables[0]);
  });

  it('la clonación no arrastra a quién estaba asignado', () => {
    const [cloned] = cloneWorkflowSteps([codeStep('codigo')], () => 'nuevo');
    expect(cloned?.assignedTo).toBeNull();
  });
});
