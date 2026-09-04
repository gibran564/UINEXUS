import { describe, expect, it } from 'vitest';
import { workflowStepSchema } from '@/lib/academic-schemas';
import { cloneWorkflowSteps, normalizeStepPrompt, stepPromptRefs } from '@/lib/workflow';
import { buildPrompt, suggestPromptDraft } from '@/lib/prompt-generator';
import { step } from './academic-fixtures';

/**
 * El prompt de un paso.
 *
 * Lo que se prueba aquí es la invariante que arregla el fallo: un prompt
 * ESCRITO no necesita ningún recurso de biblioteca para ser válido, y cambiar
 * de forma de trabajar no borra lo que ya había.
 */

const base = {
  id: 's1',
  title: 'Analizar la interfaz',
  deliverables: [{ type: 'text' as const }],
};

describe('un prompt escrito dentro de la actividad', () => {
  it('es válido sin recurso de biblioteca', () => {
    const parsed = workflowStepSchema.parse({
      ...base,
      prompt: {
        mode: 'inline',
        text: 'Analiza esta interfaz utilizando las heurísticas de Nielsen.',
      },
    });

    expect(parsed.prompt.mode).toBe('inline');
    expect(parsed.prompt.resourceId).toBeNull();
    expect(parsed.prompt.text).toContain('Nielsen');
  });

  it('conserva la sangría y los saltos, que son parte del prompt', () => {
    const text = 'Analiza esto:\n\n  - primero\n  - después\n';
    const parsed = workflowStepSchema.parse({ ...base, prompt: { mode: 'inline', text } });
    expect(parsed.prompt.text).toBe(text);
  });

  it('un paso sin prompt sigue siendo válido', () => {
    const parsed = workflowStepSchema.parse(base);
    expect(parsed.prompt.mode).toBe('none');
  });
});

describe('un prompt elegido de la biblioteca', () => {
  it('guarda la referencia y no una copia', () => {
    const parsed = workflowStepSchema.parse({
      ...base,
      prompt: { mode: 'library', title: 'Evaluación heurística', resourceId: 'prompt-1' },
    });

    expect(parsed.prompt.mode).toBe('library');
    expect(parsed.prompt.resourceId).toBe('prompt-1');
    expect(parsed.prompt.text).toBe('');
  });

  it('se recoge para que el servidor lo resuelva al pintar la tarea', () => {
    const steps = [
      step({ id: 'a', prompt: { mode: 'library', title: '', text: '', resourceId: 'prompt-1' } }),
      step({ id: 'b', prompt: { mode: 'inline', title: '', text: 'escrito aquí', resourceId: null } }),
      step({ id: 'c' }),
    ];

    expect(stepPromptRefs(steps)).toEqual([{ kind: 'prompt', id: 'prompt-1' }]);
  });

  it('un modo «library» sin recurso no es un prompt', () => {
    const parsed = workflowStepSchema.parse({
      ...base,
      prompt: { mode: 'library', resourceId: '' },
    });
    expect(parsed.prompt.mode).toBe('none');
  });
});

describe('cambiar de forma de trabajar', () => {
  /**
   * El caso real: se escribe un prompt, se mira la biblioteca, se elige uno y
   * después se vuelve al escrito. Nada de eso puede borrar el texto: el paso
   * lleva las dos cosas y sólo cambia cuál está en uso.
   */
  it('no pierde el texto escrito al pasar por la biblioteca', () => {
    const written = normalizeStepPrompt({
      mode: 'inline',
      title: '',
      text: 'Mi prompt de esta actividad',
      resourceId: null,
    });

    const fromLibrary = normalizeStepPrompt({
      ...written,
      mode: 'library',
      resourceId: 'prompt-1',
      title: 'Evaluación heurística',
    });
    expect(fromLibrary.mode).toBe('library');
    expect(fromLibrary.text).toBe('Mi prompt de esta actividad');

    const back = normalizeStepPrompt({ ...fromLibrary, mode: 'inline' });
    expect(back.mode).toBe('inline');
    expect(back.text).toBe('Mi prompt de esta actividad');
    // Y el recurso sigue ahí por si se quiere volver a él.
    expect(back.resourceId).toBe('prompt-1');
  });

  it('un paso anterior a esta iteración se lee sin prompt y sin romperse', () => {
    expect(normalizeStepPrompt(undefined)).toEqual({
      mode: 'none',
      title: '',
      text: '',
      resourceId: null,
    });
  });

  it('clonar una plantilla se lleva el prompt del paso', () => {
    const [clone] = cloneWorkflowSteps(
      [step({ prompt: { mode: 'inline', title: 'X', text: 'Un prompt', resourceId: null } })],
      () => 'nuevo'
    );

    expect(clone!.prompt.text).toBe('Un prompt');
    expect(clone!.id).toBe('nuevo');
  });
});

describe('el generador', () => {
  const context = {
    assignmentTitle: 'Arquitectura de información',
    assignmentDescription: 'Analizar la organización actual del sitio FlyExpress.',
    stepTitle: 'Evaluar la interfaz',
    stepInstructions: 'Identifica tres problemas de usabilidad',
    toolNames: ['Claude'],
    deliverableLabel: 'Texto',
  };

  it('arranca con lo que la actividad ya dice', () => {
    const draft = suggestPromptDraft(context);
    expect(draft.task).toBe('Identifica tres problemas de usabilidad');
    expect(draft.context).toContain('FlyExpress');
  });

  it('compone un prompt usable', () => {
    const text = buildPrompt({
      ...suggestPromptDraft(context),
      role: 'especialista en experiencia de usuario',
      format: 'list',
    });

    expect(text).toContain('Actúa como especialista en experiencia de usuario.');
    expect(text).toContain('Identifica tres problemas de usabilidad.');
    expect(text).toContain('lista numerada');
  });

  it('no escribe apartados vacíos', () => {
    const text = buildPrompt({
      role: '',
      task: 'Resume el texto',
      context: '',
      format: 'prose',
      constraints: '',
    });

    expect(text).not.toContain('Contexto:');
    expect(text).not.toContain('Ten en cuenta:');
    expect(text.startsWith('Resume el texto.')).toBe(true);
  });

  /** El resultado sale del generador ESCRITO, sin pasar por la biblioteca. */
  it('lo generado es un prompt inline válido', () => {
    const parsed = workflowStepSchema.parse({
      ...base,
      prompt: { mode: 'inline', text: buildPrompt(suggestPromptDraft(context)) },
    });

    expect(parsed.prompt.mode).toBe('inline');
    expect(parsed.prompt.resourceId).toBeNull();
  });
});
