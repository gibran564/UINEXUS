import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_FILE_LIMITS,
  DEFAULT_PROGRAMMING_LANGUAGE,
  DELIVERABLE_LABEL,
  ENABLED_PROGRAMMING_LANGUAGES,
  EXECUTABLE_PROGRAMMING_LANGUAGES,
  FILE_CLASS_BY_DELIVERABLE,
  LEGACY_CODE_LANGUAGE,
  PROGRAMMING_LANGUAGES,
  languageCapabilities,
  languageExecutionNote,
  programmingLanguageLabel,
} from '../../src/lib/constants';
import { resolveAcademicUpload } from '../../src/lib/academic-files';
import {
  codeDataSchema,
  deliverableSchemaFor,
  workflowStepSchema,
} from '../../src/lib/academic-schemas';
import { hasContent, normalizeDeliverable, primaryDeliverable } from '../../src/lib/workflow';
import { isCodeRunnerConfigured } from '../../src/lib/code-runner';
import { step, stepEvidence } from './academic-fixtures';
import type { CodeData } from '../../src/lib/types';

/**
 * Tareas de programación, empezando por R.
 *
 * Lo que se prueba aquí es lo que hace que la funcionalidad NO dependa de que
 * exista un ejecutor: la tarea se declara, se entrega y se revisa exactamente
 * igual haya o no un sandbox conectado. La ejecución nunca es requisito para
 * entregar, y estas pruebas lo fijan.
 */

const codeStep = (language = 'r') =>
  step({
    id: 'desarrollo',
    title: 'Desarrollo con código',
    actionType: 'code',
    deliverables: [{ type: 'code', required: true, hint: '', questions: [], language }],
  });

describe('el catálogo de lenguajes', () => {
  it('se puede escribir en todos los del catálogo', () => {
    // Editar y ejecutar son cosas distintas: Java se escribe aquí aunque no se
    // compile aquí. Ver `LanguageCapabilities`.
    expect(ENABLED_PROGRAMMING_LANGUAGES.map((option) => option.value)).toEqual(
      PROGRAMMING_LANGUAGES.map((option) => option.value)
    );
  });

  it('sólo R y Python se ejecutan, y sólo en el navegador', () => {
    expect(EXECUTABLE_PROGRAMMING_LANGUAGES.map((option) => option.value)).toEqual([
      'python',
      'r',
    ]);
  });

  it('un paso nuevo nace en Python, pero uno guardado sin lenguaje sigue siendo R', () => {
    // Cambiar el valor por defecto NO puede reinterpretar lo ya guardado: esos
    // pasos se crearon cuando R era el único lenguaje ofrecido.
    expect(DEFAULT_PROGRAMMING_LANGUAGE).toBe('python');
    expect(LEGACY_CODE_LANGUAGE).toBe('r');
  });

  it('el catálogo cubre los lenguajes que pide el plan de estudios', () => {
    const values = PROGRAMMING_LANGUAGES.map((option) => option.value);
    for (const language of ['python', 'r', 'java', 'c', 'javascript', 'html', 'css']) {
      expect(values, language).toContain(language);
    }
  });

  it('Java y C se editan pero declaran que necesitan un sandbox remoto', () => {
    for (const language of ['java', 'c', 'cpp']) {
      expect(languageCapabilities(language), language).toMatchObject({
        editor: true,
        execution: false,
        browserExecution: false,
        remoteExecution: true,
      });
      // Y dicen POR QUÉ: un «no disponible» mudo parece una avería.
      expect(languageExecutionNote(language), language).toBeTruthy();
    }
  });

  it('un lenguaje desconocido se lee como editable y NO ejecutable', () => {
    // Lo prudente ante una tarea guardada por una versión futura: escribir no
    // rompe nada, ejecutar sí.
    expect(languageCapabilities('rust')).toMatchObject({
      editor: true,
      execution: false,
      browserExecution: false,
    });
  });

  it('cada lenguaje tiene etiqueta legible', () => {
    expect(programmingLanguageLabel('r')).toBe('R');
    expect(programmingLanguageLabel('python')).toBe('Python');
    // Uno desconocido no rompe la pantalla: se muestra tal cual.
    expect(programmingLanguageLabel('rust')).toBe('rust');
    expect(programmingLanguageLabel(null)).toBe('Sin lenguaje');
  });

  it('el catálogo centraliza extensión y lenguaje de Monaco', () => {
    expect(PROGRAMMING_LANGUAGES.find((option) => option.value === 'r')).toMatchObject({
      extension: 'r',
      monacoLanguage: 'r',
    });
    expect(PROGRAMMING_LANGUAGES.find((option) => option.value === 'python')).toMatchObject({
      extension: 'py',
      monacoLanguage: 'python',
    });
  });

  it('el entregable de código tiene su etiqueta', () => {
    expect(DELIVERABLE_LABEL.code).toBe('Código');
  });
});

describe('una tarea puede declarar que se resuelve en R', () => {
  it('el paso se valida con el mismo esquema que cualquier otro', () => {
    const parsed = workflowStepSchema.safeParse({
      id: 'desarrollo',
      title: 'Resuélvelo en R',
      deliverables: [{ type: 'code', language: 'r' }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.deliverables[0]?.language).toBe('r');
  });

  it('el lenguaje se lee del paso, no de la entrega', () => {
    expect(primaryDeliverable(codeStep()).language).toBe('r');
  });

  it('un paso de código sin lenguaje se lee como R en vez de quedarse mudo', () => {
    expect(normalizeDeliverable({ type: 'code' }).language).toBe('r');
  });

  it('un paso legacy sin modalidad conserva editor y archivo', () => {
    expect(normalizeDeliverable({ type: 'code' })).toMatchObject({
      codeMode: 'either',
      starterCode: '',
      executionEnabled: false,
    });
  });

  it('un input nuevo nace en editor y conserva el código inicial sin trim', () => {
    const starterCode = '  data = [10, 20, 30]\n\n';
    const parsed = workflowStepSchema.safeParse({
      id: 'python',
      title: 'Resuélvelo en Python',
      deliverables: [{ type: 'code', language: 'python', starterCode }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deliverables[0]).toMatchObject({
        codeMode: 'editor',
        starterCode,
        executionEnabled: false,
      });
    }
  });

  it('acepta configuración explícita de modalidad y ejecución', () => {
    const parsed = workflowStepSchema.safeParse({
      id: 'r',
      title: 'Modelo en R',
      deliverables: [
        {
          type: 'code',
          language: 'r',
          codeMode: 'upload',
          executionEnabled: true,
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deliverables[0]).toMatchObject({
        codeMode: 'upload',
        starterCode: '',
        executionEnabled: true,
      });
    }
  });

  it('rechaza una modalidad desconocida y un starter demasiado grande', () => {
    expect(
      workflowStepSchema.safeParse({
        id: 'modo',
        title: 'Modo inválido',
        deliverables: [{ type: 'code', codeMode: 'terminal' }],
      }).success
    ).toBe(false);
    expect(
      workflowStepSchema.safeParse({
        id: 'starter',
        title: 'Starter inválido',
        deliverables: [{ type: 'code', starterCode: 'x'.repeat(60_001) }],
      }).success
    ).toBe(false);
  });

  it('un paso que NO es de código no arrastra ningún lenguaje', () => {
    expect(
      normalizeDeliverable({
        type: 'text',
        language: 'python',
        codeMode: 'editor',
        starterCode: 'print(1)',
        executionEnabled: true,
      })
    ).toMatchObject({ language: null, codeMode: null, starterCode: '', executionEnabled: false });
  });

  it('admite un lenguaje que todavía no se ofrece en la interfaz', () => {
    // El esquema es abierto a propósito: una tarea guardada mañana con Python
    // tiene que poder leerse sin desplegar antes el validador.
    const parsed = workflowStepSchema.safeParse({
      id: 's1',
      title: 'Resuélvelo',
      deliverables: [{ type: 'code', language: 'python' }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('la entrega de código', () => {
  it('acepta código pegado', () => {
    const parsed = codeDataSchema.safeParse({
      language: 'r',
      code: 'library(lpSolve)\nlp("max", c(3, 5), ...)',
      explanation: 'Resuelve el modelo del ejercicio 4.',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toContain('lpSolve');
  });

  it('conserva la sangría: es parte del programa', () => {
    const source = 'f <- function(x) {\n    x * 2\n}\n';
    const parsed = codeDataSchema.safeParse({ code: source });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe(source);
  });

  it('acepta la clave de un archivo adjunto del espacio académico', () => {
    const parsed = codeDataSchema.safeParse({
      code: '',
      storageKey: 'academic/course-dcu/uid-christian/a1/desarrollo/abc-123.r',
      fileName: 'modelo.R',
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza una clave de otro prefijo del bucket', () => {
    expect(
      codeDataSchema.safeParse({ storageKey: 'projects/otro/uid/v1/index.html' }).success
    ).toBe(false);
  });

  it('acota el tamaño del fuente', () => {
    expect(codeDataSchema.safeParse({ code: 'x'.repeat(2_000_000) }).success).toBe(false);
  });

  it('el validador lo elige el ENTREGABLE del paso, no el cuerpo', () => {
    expect(deliverableSchemaFor('code')).toBe(codeDataSchema);
  });
});

describe('un archivo .R se procesa según la política de archivos', () => {
  it('el paso de código tiene su propia clase de límite', () => {
    expect(FILE_CLASS_BY_DELIVERABLE.code).toBe('code');
    expect(ACADEMIC_FILE_LIMITS.code).toBeLessThan(ACADEMIC_FILE_LIMITS.document);
  });

  it('se admite aunque el navegador no sepa qué tipo es', () => {
    // Es el caso real: para un `.R` el navegador manda el tipo vacío o
    // `application/octet-stream`. Si decidiera el tipo declarado, no habría
    // forma de admitirlo sin admitir cualquier binario.
    for (const contentType of ['', 'application/octet-stream', 'text/plain', 'text/x-r']) {
      expect(
        resolveAcademicUpload('code', { fileName: 'modelo.R', contentType }),
        contentType
      ).toEqual({ extension: 'r', contentType: 'text/plain' });
    }
  });

  it('se guarda y se sirve como texto plano: nunca como algo ejecutable', () => {
    expect(resolveAcademicUpload('code', { fileName: 'modelo.r' })?.contentType).toBe('text/plain');
  });

  it('un paso de código NO admite un binario ni un script de shell', () => {
    // `.js` salió de esta lista al entrar el ecosistema web en el catálogo: es
    // un fuente académico como `.py`. Lo que sigue fuera es lo que el sistema
    // operativo sabría arrancar por sí solo.
    for (const fileName of ['modelo.exe', 'modelo.sh', 'modelo.bat', 'modelo.dll', 'modelo.jar']) {
      expect(resolveAcademicUpload('code', { fileName }), fileName).toBeNull();
    }
  });

  it('todo fuente admitido se guarda como texto plano, sea cual sea', () => {
    // Es la garantía que hace irrelevante que la lista crezca: un `.html` o un
    // `.js` entregados son texto que se muestra, nunca algo que se sirva para
    // ejecutarse. Publicar un proyecto es otro prefijo y otro dominio.
    for (const fileName of [
      'a.py', 'a.r', 'a.java', 'a.c', 'a.cpp', 'a.js', 'a.html', 'a.css', 'a.sql',
    ]) {
      expect(resolveAcademicUpload('code', { fileName })?.contentType, fileName).toBe('text/plain');
    }
  });

  it('un `.R` también vale como documento entregado', () => {
    expect(resolveAcademicUpload('document', { fileName: 'modelo.R' })).toEqual({
      extension: 'r',
      contentType: 'text/plain',
    });
  });
});

describe('un archivo .py usa la misma política cerrada', () => {
  it('se decide por la extensión aunque el navegador mande un tipo genérico', () => {
    for (const contentType of ['', 'application/octet-stream', 'text/plain', 'text/x-python']) {
      expect(resolveAcademicUpload('code', { fileName: 'solucion.py', contentType })).toEqual({
        extension: 'py',
        contentType: 'text/plain',
      });
    }
  });

  it('sin nombre, un MIME específico de Python conserva la extensión correcta', () => {
    expect(resolveAcademicUpload('code', { contentType: 'text/x-python' })).toEqual({
      extension: 'py',
      contentType: 'text/x-python',
    });
  });
});

describe('un paso de código vacío no cuenta como hecho', () => {
  it('el lenguaje por defecto NO hace que parezca relleno', () => {
    // Sin esto, el formulario marcaría el paso como completado por el simple
    // hecho de haberse abierto, y se podría entregar sin una línea escrita.
    const empty = stepEvidence({
      stepId: 'desarrollo',
      data: { language: 'r', code: '', explanation: '', storageKey: '', fileName: '' } as CodeData,
    });
    expect(hasContent(empty)).toBe(false);
  });

  it('con código pegado sí cuenta', () => {
    const filled = stepEvidence({
      stepId: 'desarrollo',
      data: { language: 'r', code: 'print(1)', explanation: '', storageKey: '', fileName: '' } as CodeData,
    });
    expect(hasContent(filled)).toBe(true);
  });

  it('sólo con el archivo adjunto también cuenta', () => {
    const attached = stepEvidence({
      stepId: 'desarrollo',
      data: {
        language: 'r',
        code: '',
        explanation: '',
        storageKey: 'academic/course-dcu/uid-christian/a1/desarrollo/abc.r',
        fileName: 'modelo.R',
      } as CodeData,
    });
    expect(hasContent(attached)).toBe(true);
  });
});

describe('sin ejecutor configurado', () => {
  it('no hay ninguno, y eso es el estado normal', () => {
    // `null` no es un error: es que este despliegue no mantiene un sandbox. La
    // interfaz simplemente no ofrece ejecutar.
    expect(isCodeRunnerConfigured()).toBe(false);
  });

  it('la tarea sigue siendo entregable igual', () => {
    // La entrega no depende del ejecutor por ninguna parte: se valida con el
    // esquema del entregable y ya.
    const parsed = deliverableSchemaFor('code').safeParse({
      language: 'r',
      code: 'x <- 1',
      explanation: 'Uno.',
    });
    expect(parsed.success).toBe(true);
  });
});
