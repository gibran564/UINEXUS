/**
 * Generador de prompts.
 *
 * Compone un prompt a partir de lo que la actividad YA dice: su objetivo, el
 * paso que se está editando, la herramienta que pide y lo que hay que entregar.
 * No llama a ningún servicio de IA ni manda nada fuera —eso está explícitamente
 * fuera de alcance—, y no hace falta: lo que cuesta escribir un prompt no es la
 * redacción, es acordarse de decir rol, tarea, contexto, formato y límites.
 *
 * Es un módulo PURO para poder probar la composición sin montar la pantalla.
 */

export interface PromptDraft {
  /** Quién debe ser la IA. */
  role: string;
  /** Qué tiene que hacer. Es la única parte imprescindible. */
  task: string;
  /** Sobre qué. Suele venir del objetivo de la actividad. */
  context: string;
  /** Cómo debe responder. */
  format: PromptFormat;
  /** Límites y advertencias. Opcional. */
  constraints: string;
}

export type PromptFormat = 'list' | 'table' | 'prose' | 'steps';

export const PROMPT_FORMATS: { value: PromptFormat; label: string; instruction: string }[] = [
  {
    value: 'list',
    label: 'Lista numerada',
    instruction: 'Responde con una lista numerada. Cada punto, breve y concreto.',
  },
  {
    value: 'table',
    label: 'Tabla comparativa',
    instruction: 'Responde con una tabla en Markdown, una fila por elemento.',
  },
  {
    value: 'prose',
    label: 'Texto explicativo',
    instruction: 'Responde en prosa clara, sin viñetas, en un máximo de tres párrafos.',
  },
  {
    value: 'steps',
    label: 'Pasos a seguir',
    instruction: 'Responde con los pasos a seguir, en orden y numerados.',
  },
];

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  role: '',
  task: '',
  context: '',
  format: 'list',
  constraints: '',
};

/** El contexto que el editor ya tiene a mano cuando se abre el generador. */
export interface PromptContext {
  assignmentTitle: string;
  assignmentDescription: string;
  stepTitle: string;
  stepInstructions: string;
  toolNames: readonly string[];
  deliverableLabel: string;
}

/**
 * Prefill a partir de la actividad.
 *
 * Se rellena con lo que la docente YA escribió en vez de con marcadores de
 * posición: un generador que arranca vacío obliga a repetir a mano lo que ya
 * está dos campos más arriba.
 */
export function suggestPromptDraft(context: PromptContext): PromptDraft {
  const objective = context.assignmentDescription.trim() || context.assignmentTitle.trim();

  return {
    ...EMPTY_PROMPT_DRAFT,
    task: context.stepInstructions.trim() || context.stepTitle.trim(),
    context: objective,
    constraints: '',
  };
}

/**
 * El prompt final.
 *
 * Sólo se escriben las secciones que tienen contenido: un prompt con apartados
 * vacíos enseña a la IA —y a quien lo lee— que los apartados no importan.
 */
export function buildPrompt(draft: PromptDraft): string {
  const blocks: string[] = [];

  const role = draft.role.trim();
  const task = draft.task.trim();
  const context = draft.context.trim();
  const constraints = draft.constraints.trim();

  if (role) blocks.push(`Actúa como ${role}.`);
  if (context) blocks.push(`Contexto: ${context}`);
  if (task) blocks.push(task.endsWith('.') ? task : `${task}.`);

  const format = PROMPT_FORMATS.find((option) => option.value === draft.format);
  if (format) blocks.push(format.instruction);

  if (constraints) blocks.push(`Ten en cuenta: ${constraints}`);

  return blocks.join('\n\n');
}
