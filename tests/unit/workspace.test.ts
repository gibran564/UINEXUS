import { describe, expect, it } from 'vitest';
import {
  workspaceFilesSchema,
  workspaceInputSchema,
  workspacePathSchema,
  workspacePatchSchema,
} from '../../src/lib/academic-schemas';
import { normalizeWorkspace, toWorkspace } from '../../src/lib/data/workspaces';
import {
  ACADEMIC_LIMITS,
  DEFAULT_PROGRAMMING_LANGUAGE,
  WORKSPACE_LIMITS,
} from '../../src/lib/constants';
import type { WorkspaceRecord } from '../../src/lib/types';
import {
  buildWorkspaceFileTree,
  createWorkspaceFile,
  deleteWorkspaceFile,
  detectLanguageFromPath,
  renameWorkspaceFile,
  validateWorkspaceFilesConsistency,
} from '../../src/lib/workspace-files';

/**
 * Prácticas de programación.
 *
 * Dos cosas se prueban aquí y las dos son promesas del producto: que una
 * práctica es de quien la escribió y de nadie más, y que el modelo puede crecer
 * a varios archivos sin romper las que ya existen.
 */

const record = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id: 'ws-1',
  ownerUid: 'uid-christian',
  kind: 'code',
  context: 'personal',
  title: 'Método simplex',
  language: 'python',
  code: 'print(2 + 2)',
  courseId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T11:00:00.000Z',
  ...overrides,
});

describe('crear una práctica', () => {
  it('pide un nombre y nace en Python', () => {
    const parsed = workspaceInputSchema.safeParse({ title: 'Two Sum' });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        title: 'Two Sum',
        language: DEFAULT_PROGRAMMING_LANGUAGE,
        code: '',
        courseId: null,
      });
    }
  });

  it('rechaza una práctica sin nombre', () => {
    for (const title of ['', '   ']) {
      expect(workspaceInputSchema.safeParse({ title }).success, JSON.stringify(title)).toBe(false);
    }
  });

  it('el cuerpo NO puede decir de quién es, ni qué id tiene, ni su contexto', () => {
    /**
     * Ésta es la prueba de seguridad del modelo.
     *
     * El dueño sale del token verificado y el id lo genera el servidor. Si
     * cualquiera de los dos viajara en el cuerpo, «guardar la práctica de otro»
     * sería algo que se puede expresar; el esquema los descarta, así que no.
     */
    const parsed = workspaceInputSchema.safeParse({
      title: 'Intento',
      ownerUid: 'uid-ajeno',
      id: 'ws-robado',
      context: 'activity',
      createdAt: '1999-01-01T00:00:00.000Z',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual(['code', 'courseId', 'language', 'title']);
    }
  });

  it('acota el código al mismo tope que una entrega', () => {
    // Poder escribir en una práctica algo que no cabe en una entrega convertiría
    // «pásalo a la actividad» en una pérdida silenciosa.
    expect(
      workspaceInputSchema.safeParse({ title: 'Largo', code: 'x'.repeat(ACADEMIC_LIMITS.codeMax) })
        .success
    ).toBe(true);
    expect(
      workspaceInputSchema.safeParse({
        title: 'Demasiado largo',
        code: 'x'.repeat(ACADEMIC_LIMITS.codeMax + 1),
      }).success
    ).toBe(false);
  });

  it('conserva la sangría del código: es parte del programa', () => {
    const source = 'def f(x):\n    if x:\n        return 1\n';
    const parsed = workspaceInputSchema.safeParse({ title: 'Sangría', code: source });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe(source);
  });
});

describe('el guardado parcial que usa el autoguardado', () => {
  it('acepta sólo el código, sin reenviar el resto', () => {
    const parsed = workspacePatchSchema.safeParse({ code: 'print(1)' });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Nada de `language: undefined`: escribirlo borraría el lenguaje.
      expect(Object.keys(parsed.data)).toEqual(['code']);
    }
  });

  it('acepta sólo el título', () => {
    expect(workspacePatchSchema.safeParse({ title: 'Otro nombre' }).success).toBe(true);
  });

  it('rechaza un cuerpo que no cambia nada', () => {
    expect(workspacePatchSchema.safeParse({}).success).toBe(false);
  });

  it('rechaza un título vacío en lugar de borrarlo', () => {
    expect(workspacePatchSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

describe('el DTO que llega al navegador', () => {
  it('no lleva el uid del dueño', () => {
    // Misma convención que en proyectos y entregas: la identidad pública de una
    // persona es su handle, y aquí no hace falta ni eso.
    const dto = toWorkspace(record());

    expect('ownerUid' in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('uid-christian');
  });

  it('conserva todo lo que el editor necesita para reabrirse', () => {
    expect(toWorkspace(record())).toMatchObject({
      id: 'ws-1',
      title: 'Método simplex',
      language: 'python',
      code: 'print(2 + 2)',
    });
  });
});

describe('leer un registro guardado', () => {
  it('un registro incompleto no rompe la pantalla', () => {
    // Misma estrategia que en el resto del proyecto: normalizar al leer, no
    // migrar. Un registro escrito por una versión anterior sigue abriéndose.
    expect(normalizeWorkspace({ id: 'ws-2', ownerUid: 'uid-ana' })).toMatchObject({
      context: 'personal',
      code: '',
      courseId: null,
      language: DEFAULT_PROGRAMMING_LANGUAGE,
    });
  });

  it('un registro sin título se lee con uno, no con un hueco', () => {
    expect(normalizeWorkspace({ id: 'ws-3' }).title).toBeTruthy();
  });

  it('un workspace legacy conserva exactamente su código sin inventar archivos', () => {
    const normalized = normalizeWorkspace(record());

    expect(normalized.code).toBe('print(2 + 2)');
    expect('entryFile' in normalized).toBe(false);
    expect('files' in normalized).toBe(false);
  });
});

describe('la puerta a varios archivos', () => {
  it('hoy `files` NO se inventa: ausente y vacío no son lo mismo', () => {
    // El día que exista multi-archivo hará falta distinguir «nunca tuvo varios»
    // de «los tenía y los borró». Poner `{}` al leer perdería esa diferencia.
    const normalized = normalizeWorkspace(record());
    expect('files' in normalized).toBe(false);
  });

  it('si un registro ya trae `files` y `entryFile`, se conservan tal cual', () => {
    const files = { 'main.py': 'import utils', 'utils.py': 'x = 1' };
    const normalized = normalizeWorkspace(record({ entryFile: 'main.py', files }));

    expect(normalized.files).toEqual(files);
    expect(normalized.entryFile).toBe('main.py');
    // Y `code` sigue siendo el archivo de entrada: es lo que se ejecuta.
    expect(normalized.code).toBe('print(2 + 2)');
  });

  it('acepta varios archivos y normaliza sus separadores', () => {
    const parsed = workspaceInputSchema.safeParse({
      title: 'Multi',
      entryFile: 'src\\main.py',
      files: { 'src\\main.py': 'print(1)', 'src/utils.py': 'x = 1' },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entryFile).toBe('src/main.py');
      expect(parsed.data.files).toEqual({
        'src/main.py': 'print(1)',
        'src/utils.py': 'x = 1',
      });
    }
  });

  it('valida la consistencia entre files y entryFile sin depender del esquema', () => {
    expect(validateWorkspaceFilesConsistency(undefined, undefined).valid).toBe(true);
    expect(validateWorkspaceFilesConsistency({ 'main.ts': 'x' }, undefined).valid).toBe(true);
    expect(validateWorkspaceFilesConsistency(undefined, 'main.ts').valid).toBe(true);
    expect(validateWorkspaceFilesConsistency({ 'main.ts': '' }, 'main.ts').valid).toBe(true);
    expect(validateWorkspaceFilesConsistency({ 'other.ts': 'x' }, 'main.ts')).toEqual({
      valid: false,
      error: 'El archivo de entrada debe existir en files.',
    });

    const inheritedFiles = Object.create({ 'main.ts': 'x' }) as Record<string, string>;
    expect(validateWorkspaceFilesConsistency(inheritedFiles, 'main.ts').valid).toBe(false);
  });

  it.each([
    '',
    '../secret.ts',
    'src/../secret.ts',
    '/etc/passwd',
    'C:\\secret.ts',
    '\\\\server\\secret.ts',
    '.env',
    'src/.git/config',
    'src//main.ts',
    'src/a?.ts',
    `src/${'a'.repeat(101)}.ts`,
    'a'.repeat(WORKSPACE_LIMITS.maxFilePathLength + 1),
    'src/nu\0ll.ts',
  ])('rechaza la ruta insegura %j', (path) => {
    expect(workspacePathSchema.safeParse(path).success).toBe(false);
  });

  it('rechaza rutas duplicadas después de normalizar', () => {
    expect(
      workspaceFilesSchema.safeParse({ 'src/main.ts': 'a', 'src\\main.ts': 'b' }).success
    ).toBe(false);
  });

  it('aplica el límite de cantidad de archivos', () => {
    const files = Object.fromEntries(
      Array.from({ length: WORKSPACE_LIMITS.maxFiles }, (_, index) => [`file-${index}.ts`, 'x'])
    );

    expect(workspaceFilesSchema.safeParse(files).success).toBe(true);
    expect(workspaceFilesSchema.safeParse({ ...files, 'one-more.ts': 'x' }).success).toBe(false);
  });

  it('aplica los límites por archivo y del contenido total', () => {
    expect(
      workspaceFilesSchema.safeParse({ 'main.ts': 'x'.repeat(WORKSPACE_LIMITS.maxFileSize) }).success
    ).toBe(true);
    expect(
      workspaceFilesSchema.safeParse({ 'main.ts': 'x'.repeat(WORKSPACE_LIMITS.maxFileSize + 1) })
        .success
    ).toBe(false);

    const atTotalLimit = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `file-${index}.ts`,
        'x'.repeat(WORKSPACE_LIMITS.maxFileSize),
      ])
    );
    expect(workspaceFilesSchema.safeParse(atTotalLimit).success).toBe(true);
    expect(
      workspaceFilesSchema.safeParse({ ...atTotalLimit, 'extra.ts': 'x' }).success
    ).toBe(false);
  });

  it('exige que el archivo de entrada exista cuando también vienen los archivos', () => {
    expect(
      workspaceInputSchema.safeParse({
        title: 'Vacío pero válido',
        entryFile: 'main.ts',
        files: { 'main.ts': '' },
      }).success
    ).toBe(true);
    expect(
      workspaceInputSchema.safeParse({
        title: 'Falta la entrada',
        entryFile: 'main.ts',
        files: { 'other.ts': '' },
      }).success
    ).toBe(false);
  });

  it('permite guardar parcialmente files y entryFile', () => {
    expect(workspacePatchSchema.safeParse({ files: { 'main.ts': 'x' } }).success).toBe(true);
    expect(workspacePatchSchema.safeParse({ entryFile: 'main.ts' }).success).toBe(true);
    expect(
      workspacePatchSchema.safeParse({
        files: { 'main.ts': 'x' },
        entryFile: 'main.ts',
      }).success
    ).toBe(true);
    expect(
      workspacePatchSchema.safeParse({
        files: { 'other.ts': 'x' },
        entryFile: 'main.ts',
      }).success
    ).toBe(false);
  });
});

describe('navegar un proyecto multiarchivo', () => {
  it.each([
    ['main.py', 'python'],
    ['analysis.R', 'r'],
    ['app.js', 'javascript'],
    ['index.html', 'html'],
    ['theme.css', 'css'],
    ['Main.java', 'java'],
    ['program.c', 'c'],
    ['engine.cpp', 'cpp'],
    ['query.SQL', 'sql'],
  ] as const)('deduce %s como %s', (path, expected) => {
    expect(detectLanguageFromPath(path, 'python')).toBe(expected);
  });

  it('conserva el lenguaje del proyecto para extensiones desconocidas', () => {
    expect(detectLanguageFromPath('README', 'r')).toBe('r');
    expect(detectLanguageFromPath('src/model.ts', 'javascript')).toBe('javascript');
  });

  it('construye un árbol alfabético con carpetas antes que archivos', () => {
    const files = {
      'zeta.py': '',
      'src/z.py': '',
      'alpha.py': '',
      'src/lib/b.py': '',
      'src/lib/a.py': '',
    };

    expect(buildWorkspaceFileTree(files)).toEqual([
      {
        type: 'folder',
        name: 'src',
        path: 'src',
        children: [
          {
            type: 'folder',
            name: 'lib',
            path: 'src/lib',
            children: [
              { type: 'file', name: 'a.py', path: 'src/lib/a.py' },
              { type: 'file', name: 'b.py', path: 'src/lib/b.py' },
            ],
          },
          { type: 'file', name: 'z.py', path: 'src/z.py' },
        ],
      },
      { type: 'file', name: 'alpha.py', path: 'alpha.py' },
      { type: 'file', name: 'zeta.py', path: 'zeta.py' },
    ]);
  });

  it('crea un archivo normalizado y lo activa sin cambiar la entrada', () => {
    expect(
      createWorkspaceFile(
        { files: { 'main.py': 'print(1)' }, entryFile: 'main.py', activeFile: 'main.py' },
        'src\\utils.py'
      )
    ).toEqual({
      files: { 'main.py': 'print(1)', 'src/utils.py': '' },
      entryFile: 'main.py',
      activeFile: 'src/utils.py',
    });
  });

  it('rechaza rutas inseguras, duplicados y un archivo 51', () => {
    const state = { files: { 'main.py': '' }, entryFile: 'main.py', activeFile: 'main.py' };
    expect(() => createWorkspaceFile(state, '../secret.py')).toThrow('ruta relativa');
    expect(() => createWorkspaceFile(state, 'main.py')).toThrow('Ya existe');

    const fullState = {
      files: Object.fromEntries(
        Array.from({ length: WORKSPACE_LIMITS.maxFiles }, (_, index) => [`file-${index}.py`, ''])
      ),
      entryFile: 'file-0.py',
      activeFile: 'file-0.py',
    };
    expect(() => createWorkspaceFile(fullState, 'one-more.py')).toThrow('máximo');
  });

  it('renombra sin perder contenido y actualiza entrada y archivo activo', () => {
    expect(
      renameWorkspaceFile(
        {
          files: { 'src/main.py': 'print(42)', 'src/utils.py': 'answer = 42' },
          entryFile: 'src/main.py',
          activeFile: 'src/main.py',
        },
        'src/main.py',
        'app.py'
      )
    ).toEqual({
      files: { 'app.py': 'print(42)', 'src/utils.py': 'answer = 42' },
      entryFile: 'app.py',
      activeFile: 'app.py',
    });
  });

  it('no sobrescribe otro archivo al renombrar', () => {
    const state = {
      files: { 'main.py': 'main', 'utils.py': 'utils' },
      entryFile: 'main.py',
      activeFile: 'utils.py',
    };
    expect(() => renameWorkspaceFile(state, 'utils.py', 'main.py')).toThrow('Ya existe');
    expect(state.files).toEqual({ 'main.py': 'main', 'utils.py': 'utils' });
  });

  it('elimina la entrada y elige el primer archivo restante de forma determinista', () => {
    expect(
      deleteWorkspaceFile(
        {
          files: { 'main.py': 'main', 'z.py': 'z', 'a.py': 'a' },
          entryFile: 'main.py',
          activeFile: 'main.py',
        },
        'main.py'
      )
    ).toEqual({
      files: { 'z.py': 'z', 'a.py': 'a' },
      entryFile: 'a.py',
      activeFile: 'a.py',
    });
  });

  it('impide dejar el proyecto vacío', () => {
    expect(() =>
      deleteWorkspaceFile(
        { files: { 'main.py': '' }, entryFile: 'main.py', activeFile: 'main.py' },
        'main.py'
      )
    ).toThrow('al menos un archivo');
  });
});
