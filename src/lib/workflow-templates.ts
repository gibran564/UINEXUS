import { cloneWorkflowSteps, normalizeStep, type IdFactory } from './workflow';
import type {
  DeliverableType,
  ProgrammingLanguage,
  StepActionType,
  ToolChoiceMode,
  WorkflowStepRecord,
} from './types';

/**
 * Plantillas de proceso que vienen con UINexus.
 *
 * ## Son DATOS, no un motor nuevo
 *
 * Una plantilla es una lista de pasos que se convierte en `WorkflowStep[]`
 * normales y pasa por el mismo `cloneWorkflowSteps` que las plantillas que crea
 * el profesorado. Nada en el runner, en el constructor ni en la API sabe qué es
 * «Investigación de Operaciones»: para todos ellos una tarea creada desde aquí
 * es una tarea de varios pasos como cualquier otra. Ésa es la única forma de que
 * añadir teoría de colas, inventarios o simulación mañana sea escribir una
 * entrada más en este archivo y nada más.
 *
 * ## Un punto de partida, no una camisa de fuerza
 *
 * Los pasos se clonan al aplicarlos y a partir de ahí son de la tarea: se
 * editan, se reordenan, se borran, se vuelven opcionales y se les cambia el
 * entregable. La plantilla no se toca y no queda ningún vínculo con ella; dos
 * tareas creadas desde la misma plantilla no comparten absolutamente nada.
 *
 * ## Por qué los identificadores TIENEN que cambiar al aplicarla
 *
 * `Submission.stepEvidence` se indexa por `stepId`. Si dos tareas conservaran
 * los ids de la plantilla, lo que alguien escribiera en el paso «Restricciones»
 * de una aparecería como escrito en el paso «Restricciones» de la otra. Por eso
 * `instantiateWorkflowTemplate` clona SIEMPRE, y por eso los ids de aquí llevan
 * el prefijo de la plantilla: si alguno sobreviviera a un clon, se vería.
 */

export interface WorkflowTemplateStep {
  /** Identificador dentro de la plantilla. Se usa para encadenar dependencias. */
  key: string;
  title: string;
  instructions: string;
  deliverable: DeliverableType;
  actionType?: StepActionType;
  hint?: string;
  /** Por omisión, obligatorio. */
  required?: boolean;
  toolMode?: ToolChoiceMode;
  /** Sólo con `deliverable: 'code'`. */
  language?: ProgrammingLanguage;
  /**
   * Pasos previos de los que depende. Si no se dice nada, depende del anterior
   * OBLIGATORIO; ver `chainDependencies` para el porqué.
   */
  dependsOn?: readonly string[];
}

export interface WorkflowTemplate {
  id: string;
  /** Materia a la que pertenece. Agrupa la galería del constructor. */
  subject: string;
  name: string;
  summary: string;
  steps: readonly WorkflowTemplateStep[];
}

/** La materia de esta iteración. Añadir otra es añadir plantillas con su nombre. */
export const OPERATIONS_RESEARCH = 'Investigación de Operaciones';

const TEXT_HINT = 'Escríbelo con tus palabras. No hace falta que sea largo, sí que sea preciso.';

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'io-modelado-matematico',
    subject: OPERATIONS_RESEARCH,
    name: 'Modelado matemático',
    summary:
      'De un problema en palabras a un modelo formal: variables, objetivo, restricciones e interpretación.',
    steps: [
      {
        key: 'comprender',
        title: 'Comprender el problema',
        instructions:
          '¿Qué se quiere optimizar y en qué sentido: maximizar o minimizar?\n' +
          '¿Qué datos tienes y qué condiciones hay que respetar?',
        deliverable: 'text',
        hint: TEXT_HINT,
      },
      {
        key: 'variables',
        title: 'Variables de decisión',
        instructions:
          'Define cada variable y di QUÉ SIGNIFICA y en qué unidades. «x1 = kilos de mezcla A por semana» es una definición; «x1» no lo es.',
        deliverable: 'text',
      },
      {
        key: 'objetivo',
        title: 'Función objetivo',
        instructions:
          'Escribe la función y di si se maximiza o se minimiza. Explica de dónde sale cada coeficiente.',
        deliverable: 'text',
      },
      {
        key: 'restricciones',
        title: 'Restricciones',
        instructions:
          'Formula todas las restricciones del problema. Añade las de no negatividad y, si el problema lo pide, las de integralidad o las binarias.',
        deliverable: 'text',
      },
      {
        key: 'modelo',
        title: 'Modelo matemático completo',
        instructions:
          'Presenta el modelo consolidado: objetivo, restricciones y dominio de las variables, todo junto y en orden.',
        deliverable: 'text',
      },
      {
        key: 'archivo',
        title: 'Archivo del modelo',
        instructions:
          'Opcional. Si lo resolviste en papel o en una hoja de cálculo, sube aquí el documento o la foto.',
        deliverable: 'file',
        required: false,
        hint: 'PDF, Word, Excel o una foto legible de tu hoja.',
      },
      {
        key: 'interpretacion',
        title: 'Interpretación',
        instructions:
          'Explica qué significa el modelo en el contexto original: qué decide, qué limita y qué respuesta daría a quien planteó el problema.',
        deliverable: 'text',
        dependsOn: ['modelo'],
      },
    ],
  },
  {
    id: 'io-programacion-lineal',
    subject: OPERATIONS_RESEARCH,
    name: 'Programación lineal / Método Simplex',
    summary:
      'Del planteamiento a la solución óptima, con las iteraciones como evidencia y la comprobación al final.',
    steps: [
      {
        key: 'planteamiento',
        title: 'Planteamiento del problema',
        instructions:
          'Describe la situación, qué se busca optimizar y qué recursos hay disponibles.',
        deliverable: 'text',
        hint: TEXT_HINT,
      },
      {
        key: 'modelo',
        title: 'Modelo matemático',
        instructions:
          'Variables de decisión, función objetivo y restricciones, con las de no negatividad.',
        deliverable: 'text',
      },
      {
        key: 'metodo',
        title: 'Selección del método',
        instructions:
          '¿Método gráfico, Simplex, Simplex de dos fases, dual? Di cuál usas y POR QUÉ ése y no otro.',
        deliverable: 'text',
      },
      {
        key: 'desarrollo',
        title: 'Desarrollo / iteraciones',
        instructions:
          'Sube el desarrollo completo. Vale un documento, una hoja de cálculo, la foto de tus tablas o el archivo del software que hayas usado.',
        deliverable: 'file',
        actionType: 'upload',
        hint: 'PDF, Word, Excel, foto de la hoja o archivo de código.',
      },
      {
        key: 'solucion',
        title: 'Solución óptima',
        instructions:
          'Valor de cada variable y valor de la función objetivo en el óptimo.',
        deliverable: 'text',
      },
      {
        key: 'comprobacion',
        title: 'Comprobación',
        instructions:
          'Sustituye la solución en las restricciones y comprueba que se cumplen todas.',
        deliverable: 'text',
        required: false,
      },
      {
        key: 'interpretacion',
        title: 'Interpretación de resultados',
        instructions:
          '¿Qué significa esa solución para el problema real? ¿Qué recomendarías hacer?',
        deliverable: 'text',
        dependsOn: ['solucion'],
      },
    ],
  },
  {
    id: 'io-transporte-asignacion',
    subject: OPERATIONS_RESEARCH,
    name: 'Transporte / Asignación',
    summary:
      'Oferta, demanda y matriz; solución inicial, optimización y el costo o beneficio total interpretado.',
    steps: [
      {
        key: 'datos',
        title: 'Oferta, demanda, recursos o agentes',
        instructions:
          'Identifica los orígenes y los destinos —o los agentes y las tareas— con sus cantidades. Di si el problema está balanceado y, si no, cómo lo vas a balancear.',
        deliverable: 'text',
        hint: TEXT_HINT,
      },
      {
        key: 'matriz',
        title: 'Construcción de la matriz',
        instructions:
          'Sube la matriz de costos o beneficios con sus filas y columnas rotuladas.',
        deliverable: 'file',
        actionType: 'upload',
        hint: 'Una hoja de cálculo, un documento o la foto de tu tabla.',
      },
      {
        key: 'inicial',
        title: 'Solución inicial',
        instructions:
          'Esquina noroeste, costo mínimo, Vogel, húngaro… Di qué método usaste y muestra la asignación inicial.',
        deliverable: 'text',
      },
      {
        key: 'optimizacion',
        title: 'Optimización',
        instructions:
          'Sube las iteraciones hasta llegar al óptimo, con el criterio que usaste para mejorar en cada paso.',
        deliverable: 'file',
        actionType: 'upload',
      },
      {
        key: 'resultado',
        title: 'Resultado final',
        instructions: 'La asignación óptima: qué se envía, desde dónde y hasta dónde.',
        deliverable: 'text',
      },
      {
        key: 'total',
        title: 'Costo o beneficio total',
        instructions: 'El total de la solución óptima, con la operación que lo produce.',
        deliverable: 'text',
      },
      {
        key: 'interpretacion',
        title: 'Interpretación',
        instructions:
          'Qué significa el resultado para la empresa o el sistema del enunciado, y qué decisión sugiere.',
        deliverable: 'text',
        dependsOn: ['resultado'],
      },
    ],
  },
  {
    id: 'io-redes-pert-cpm',
    subject: OPERATIONS_RESEARCH,
    name: 'Redes / PERT-CPM',
    summary:
      'Actividades y precedencias, el diagrama como evidencia, y la ruta crítica con sus holguras.',
    steps: [
      {
        key: 'actividades',
        title: 'Actividades y nodos',
        instructions:
          'Lista las actividades con su duración —o el flujo de cada arco, según el problema—.',
        deliverable: 'text',
        hint: TEXT_HINT,
      },
      {
        key: 'precedencias',
        title: 'Precedencias o conexiones',
        instructions:
          'Di qué actividad depende de cuál. Una tabla de precedencias es suficiente.',
        deliverable: 'text',
      },
      {
        key: 'red',
        title: 'Representación de la red',
        instructions:
          'Sube el diagrama. Vale una foto del dibujo, una captura de la herramienta que uses o un documento.',
        deliverable: 'file',
        actionType: 'upload',
        hint: 'Que se lean los nodos, las flechas y las duraciones.',
      },
      {
        key: 'calculos',
        title: 'Cálculos',
        instructions:
          'Tiempos de inicio y fin, tempranos y tardíos. Sube la tabla o el desarrollo.',
        deliverable: 'file',
        actionType: 'upload',
      },
      {
        key: 'critica',
        title: 'Ruta crítica o resultado',
        instructions:
          'La ruta crítica y su duración —o el camino óptimo, el flujo máximo o el resultado que pida el problema—.',
        deliverable: 'text',
      },
      {
        key: 'holguras',
        title: 'Holguras y tiempos',
        instructions:
          'Holgura de cada actividad y cuáles no la tienen. Sáltalo si el problema no las usa.',
        deliverable: 'text',
        required: false,
      },
      {
        key: 'conclusion',
        title: 'Interpretación y conclusión',
        instructions:
          'Qué actividades no se pueden retrasar, dónde hay margen y qué recomendarías a quien dirige el proyecto.',
        deliverable: 'text',
        dependsOn: ['critica'],
      },
    ],
  },
  {
    id: 'io-caso-practico-software',
    subject: OPERATIONS_RESEARCH,
    name: 'Caso práctico con software',
    summary:
      'La más flexible: del problema al modelo, resuelto con la herramienta o el lenguaje que elijas.',
    steps: [
      {
        key: 'problema',
        title: 'Descripción del problema',
        instructions: 'El caso, en tus palabras: qué se decide, qué se busca y qué limita.',
        deliverable: 'text',
        hint: TEXT_HINT,
      },
      {
        key: 'datos',
        title: 'Datos',
        instructions:
          'Sube los datos que usaste: la hoja de cálculo, el CSV o el documento del enunciado.',
        deliverable: 'file',
        actionType: 'upload',
        required: false,
      },
      {
        key: 'modelo',
        title: 'Modelo matemático',
        instructions: 'Variables, función objetivo y restricciones.',
        deliverable: 'text',
        dependsOn: ['problema'],
      },
      {
        key: 'herramienta',
        title: 'Herramienta o lenguaje utilizado',
        instructions:
          'Di con qué lo resolviste y por qué: R, Solver de Excel, LINGO, Python, la que sea.',
        deliverable: 'text',
        actionType: 'external_tool',
        toolMode: 'free',
      },
      {
        key: 'desarrollo',
        title: 'Desarrollo',
        instructions:
          'Cómo lo montaste: qué representaste, qué supuestos hiciste y qué te costó más.',
        deliverable: 'text',
      },
      {
        key: 'codigo',
        title: 'Código o modelo utilizado',
        instructions:
          'Pega el código y, si quieres, adjunta el archivo. Si usaste una herramienta sin código, sube su archivo en el paso anterior y explica aquí la configuración.',
        deliverable: 'code',
        actionType: 'code',
        language: 'r',
      },
      {
        key: 'evidencia',
        title: 'Evidencia de ejecución',
        instructions:
          'La salida del programa o la captura de la herramienta con el resultado a la vista.',
        deliverable: 'file',
        actionType: 'upload',
      },
      {
        key: 'resultados',
        title: 'Resultados',
        instructions: 'Los valores obtenidos: solución óptima y valor del objetivo.',
        deliverable: 'text',
      },
      {
        key: 'interpretacion',
        title: 'Interpretación',
        instructions: 'Qué significan esos números en el caso que describiste al principio.',
        deliverable: 'text',
      },
      {
        key: 'conclusiones',
        title: 'Conclusiones',
        instructions:
          'Qué aprendiste del caso, qué harías distinto y qué límites tiene tu solución.',
        deliverable: 'text',
      },
    ],
  },
];

export function getWorkflowTemplate(templateId: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

/** Las plantillas agrupadas por materia, en el orden en que están declaradas. */
export function workflowTemplatesBySubject(): { subject: string; templates: WorkflowTemplate[] }[] {
  const groups = new Map<string, WorkflowTemplate[]>();
  for (const template of WORKFLOW_TEMPLATES) {
    const list = groups.get(template.subject) ?? [];
    list.push(template);
    groups.set(template.subject, list);
  }
  return [...groups.entries()].map(([subject, templates]) => ({ subject, templates }));
}

/**
 * Encadena cada paso con el anterior OBLIGATORIO.
 *
 * Encadenar con el anterior a secas parece más simple y es un error: un paso
 * opcional sin rellenar dejaría bloqueado todo lo que viene detrás
 * (`stepState` marca `locked` mientras una dependencia no tenga contenido). Es
 * decir, saltarse lo opcional —que es exactamente para lo que existe— dejaría la
 * actividad imposible de terminar.
 */
function chainDependencies(steps: readonly WorkflowTemplateStep[]): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();
  let previousRequired: string | null = null;

  for (const step of steps) {
    dependencies.set(
      step.key,
      step.dependsOn ? [...step.dependsOn] : previousRequired ? [previousRequired] : []
    );
    if (step.required !== false) previousRequired = step.key;
  }

  return dependencies;
}

/** El id que un paso tiene DENTRO de la plantilla. Nunca sobrevive a un clon. */
export function templateStepId(templateId: string, key: string): string {
  return `${templateId}:${key}`;
}

/**
 * Los pasos de una plantilla, ya como registros del workflow.
 *
 * Pasan por `normalizeStep`, el mismo que normaliza los pasos guardados: si un
 * día se añade un campo al modelo, estas plantillas lo reciben sin tocarlas.
 */
export function templateWorkflowSteps(template: WorkflowTemplate): WorkflowStepRecord[] {
  const dependencies = chainDependencies(template.steps);

  return template.steps.map((step, index) =>
    normalizeStep(
      {
        id: templateStepId(template.id, step.key),
        order: index,
        title: step.title,
        description: '',
        instructions: step.instructions,
        actionType: step.actionType ?? defaultActionFor(step.deliverable),
        tool: {
          mode: step.toolMode ?? 'none',
          toolIds: [],
          toolNames: [],
        },
        resources: [],
        prompt: { mode: 'none', title: '', text: '', resourceId: null },
        deliverables: [
          {
            type: step.deliverable,
            required: step.required !== false,
            hint: step.hint ?? '',
            questions: [],
            language: step.deliverable === 'code' ? (step.language ?? 'r') : null,
          },
        ],
        required: step.required !== false,
        assignedTo: null,
        dependsOnStepIds: (dependencies.get(step.key) ?? []).map((key) =>
          templateStepId(template.id, key)
        ),
      },
      index
    )
  );
}

/** Qué clase de paso es, cuando la plantilla no lo dice. */
function defaultActionFor(deliverable: DeliverableType): StepActionType {
  switch (deliverable) {
    case 'file':
    case 'image':
    case 'video':
      return 'upload';
    case 'code':
      return 'code';
    case 'none':
      return 'instruction';
    default:
      return 'text_response';
  }
}

/**
 * Los pasos listos para una tarea nueva: clonados, con identificadores propios.
 *
 * Es el ÚNICO camino por el que una plantilla entra en una tarea. Pasa por
 * `cloneWorkflowSteps` —el mismo mecanismo que usan las plantillas guardadas en
 * la biblioteca—, así que hereda sus garantías: ids nuevos, dependencias
 * remapeadas, responsables limpios y copia en profundidad de todo lo que el
 * editor va a mutar.
 */
export function instantiateWorkflowTemplate(
  templateId: string,
  newId?: IdFactory
): WorkflowStepRecord[] {
  const template = getWorkflowTemplate(templateId);
  if (!template) return [];
  return cloneWorkflowSteps(templateWorkflowSteps(template), newId);
}
