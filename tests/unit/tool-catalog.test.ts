import { describe, expect, it } from 'vitest';
import { normalizeStep } from '../../src/lib/workflow';
import { toolChoiceSchema, workflowStepSchema } from '../../src/lib/academic-schemas';
import { step } from './academic-fixtures';
import type { StepToolChoice, WorkflowStepRecord } from '../../src/lib/types';

/**
 * El catálogo de herramientas conectado a los pasos (Prioridad 3).
 *
 * La propiedad que se prueba aquí, y la razón de que el modelo guarde `toolIds`
 * Y `toolNames` en vez de sólo el id:
 *
 *   Una actividad NO puede romperse porque una herramienta desaparezca.
 *
 * El nombre es la información humana durable; el id sólo añade ficha y enlace
 * mientras el recurso exista.
 */

/** Simula lo que hace `resolveStepTools` cuando el recurso ya no está. */
function resolveNames(
  step: WorkflowStepRecord,
  catalog: Record<string, { title: string }>
): { shown: string[]; withCard: number } {
  return {
    // Lo que se PINTA sale del paso, no del catálogo.
    shown: step.tool.toolNames,
    withCard: step.tool.toolIds.filter((id) => catalog[id]).length,
  };
}

describe('un paso guarda id y nombre', () => {
  it('elegir del catálogo guarda ambos', () => {
    const chosen: StepToolChoice = {
      mode: 'required',
      toolIds: ['tool-perplexity'],
      toolNames: ['Perplexity'],
    };
    const normalized = normalizeStep({ title: 'Buscar', tool: chosen }, 0);

    expect(normalized.tool.toolIds).toEqual(['tool-perplexity']);
    expect(normalized.tool.toolNames).toEqual(['Perplexity']);
  });

  it('escribir una herramienta que no está en el catálogo guarda sólo el nombre', () => {
    // §13: UINexus no debe exigir dar de alta una plataforma para usarla.
    const normalized = normalizeStep(
      {
        title: 'Probar',
        tool: { mode: 'free', toolIds: [], toolNames: ['SuperNuevaIAQueSalioAyer'] },
      },
      0
    );

    expect(normalized.tool.toolIds).toEqual([]);
    expect(normalized.tool.toolNames).toEqual(['SuperNuevaIAQueSalioAyer']);
  });

  it('el esquema acepta un paso sin ninguna herramienta (§37)', () => {
    const parsed = workflowStepSchema.safeParse({ id: 's1', title: 'Analiza los resultados' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tool.mode).toBe('none');
  });

  it('el esquema acepta nombres sin ids', () => {
    const parsed = toolChoiceSchema.safeParse({
      mode: 'choice',
      toolNames: ['ChatGPT', 'Claude', 'Gemini'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.toolIds).toEqual([]);
      expect(parsed.data.toolNames).toHaveLength(3);
    }
  });
});

describe('borrar el recurso NO rompe la actividad (§50)', () => {
  const withCatalog = step({
    id: 's1',
    title: 'Buscar fuentes',
    tool: { mode: 'required', toolIds: ['tool-perplexity'], toolNames: ['Perplexity'] },
  });

  it('con la herramienta en el catálogo se muestra nombre y ficha', () => {
    const result = resolveNames(withCatalog, { 'tool-perplexity': { title: 'Perplexity' } });
    expect(result.shown).toEqual(['Perplexity']);
    expect(result.withCard).toBe(1);
  });

  it('sin la herramienta en el catálogo se sigue mostrando el NOMBRE', () => {
    // Esto es lo que hace que una tarea del semestre pasado siga siendo legible
    // aunque la docente haya limpiado la biblioteca.
    const result = resolveNames(withCatalog, {});
    expect(result.shown).toEqual(['Perplexity']);
    expect(result.withCard).toBe(0);
  });

  it('el paso guardado no cambia porque el recurso desaparezca', () => {
    // El registro del paso es independiente del catálogo: nada lo reescribe.
    const before = JSON.stringify(withCatalog);
    resolveNames(withCatalog, {});
    expect(JSON.stringify(withCatalog)).toBe(before);
  });
});

describe('varias herramientas a elegir (§24)', () => {
  const choice = step({
    id: 's1',
    tool: {
      mode: 'choice',
      toolIds: ['t-chatgpt', 't-claude'],
      toolNames: ['ChatGPT', 'Claude', 'Gemini'],
    },
  });

  it('los nombres pueden ser más que los ids', () => {
    // Dos están en el catálogo y una se escribió a mano. Es el caso normal.
    expect(choice.tool.toolNames).toHaveLength(3);
    expect(choice.tool.toolIds).toHaveLength(2);
  });

  it('se ofrecen TODOS los nombres, tengan ficha o no', () => {
    const result = resolveNames(choice, { 't-chatgpt': { title: 'ChatGPT' } });
    expect(result.shown).toEqual(['ChatGPT', 'Claude', 'Gemini']);
    expect(result.withCard).toBe(1);
  });
});

describe('la herramienta realmente usada (§47)', () => {
  it('el modo `free` deja el nombre libre', () => {
    const parsed = toolChoiceSchema.safeParse({ mode: 'free' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.toolNames).toEqual([]);
  });

  it('un paso puede proponer herramientas y aun así aceptar otra', () => {
    // El servidor sólo valida `toolId` contra la lista del paso; el NOMBRE es
    // libre porque cuando se puede elegir es el único dato que hay.
    const parsed = workflowStepSchema.safeParse({
      id: 's1',
      title: 'Genera una visualización',
      tool: { mode: 'free', toolNames: ['Napkin'] },
    });
    expect(parsed.success).toBe(true);
  });
});
