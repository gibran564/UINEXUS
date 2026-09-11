import { describe, expect, it } from 'vitest';
import {
  workspaceInputSchema,
  workspacePatchSchema,
} from '../../src/lib/academic-schemas';
import { normalizeWorkspace, toWorkspace } from '../../src/lib/data/workspaces';
import { ACADEMIC_LIMITS, DEFAULT_PROGRAMMING_LANGUAGE } from '../../src/lib/constants';
import type { WorkspaceRecord } from '../../src/lib/types';

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
});

describe('la puerta a varios archivos', () => {
  it('hoy `files` NO se inventa: ausente y vacío no son lo mismo', () => {
    // El día que exista multi-archivo hará falta distinguir «nunca tuvo varios»
    // de «los tenía y los borró». Poner `{}` al leer perdería esa diferencia.
    const normalized = normalizeWorkspace(record());
    expect('files' in normalized).toBe(false);
  });

  it('si un registro ya trae `files`, se conserva tal cual', () => {
    const files = { 'main.py': 'import utils', 'utils.py': 'x = 1' };
    const normalized = normalizeWorkspace(record({ files }));

    expect(normalized.files).toEqual(files);
    // Y `code` sigue siendo el archivo de entrada: es lo que se ejecuta.
    expect(normalized.code).toBe('print(2 + 2)');
  });

  it('el esquema de entrada todavía no acepta `files`', () => {
    // Aceptarlo antes de que el editor sepa escribirlos crearía registros que
    // ninguna pantalla puede abrir.
    const parsed = workspaceInputSchema.safeParse({
      title: 'Multi',
      files: { 'a.py': 'x' },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect('files' in parsed.data).toBe(false);
  });
});
