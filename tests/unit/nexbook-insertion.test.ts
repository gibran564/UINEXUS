import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import {
  NEXBOOK_BLOCKS,
  insertableNexBookBlocks,
  nexBookBlockAction,
} from '@/lib/nexbook-blocks';
import { insertBlocksAt } from '@/lib/nexbook-document';
import type { NexBookBlock, NexBookDocument } from '@/lib/types';
import { NexBookBlockInserter } from '@/components/studio/nexbook-block-inserter';
import { focusNexBookBlock, NexBookStudio } from '@/components/studio/nexbook-studio';

const hooks = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  values: [] as unknown[],
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof React>();
  const next = () => hooks.cursor++;
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!hooks.active) return actual.useState(initial);
      const index = next();
      if (!(index in hooks.values)) {
        hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      return [hooks.values[index], (value: unknown) => {
        hooks.values[index] =
          typeof value === 'function'
            ? (value as (current: unknown) => unknown)(hooks.values[index])
            : value;
      }];
    },
    useRef: (initial: unknown) => {
      if (!hooks.active) return actual.useRef(initial);
      const index = next();
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index];
    },
    useCallback: (callback: unknown) => {
      if (!hooks.active) return callback;
      next();
      return callback;
    },
    useMemo: (factory: () => unknown) => {
      if (!hooks.active) return factory();
      next();
      return factory();
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (!hooks.active) return actual.useEffect(effect);
      next();
      hooks.effects.push(effect);
    },
  };
});

vi.mock('@/lib/notebook-kernel', () => ({
  createNotebookKernel: () => ({
    activeLanguages: () => [],
    dispose: vi.fn(),
    executeCell: vi.fn(),
    interrupt: vi.fn(),
    restart: vi.fn(),
    restartAll: vi.fn(),
  }),
}));

type Element = React.ReactElement<Record<string, unknown>>;

function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

function textOf(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return typeof node === 'string' ? node : '';
}

function markdown(id: string, source = id): NexBookBlock {
  return { id, type: 'markdown', source };
}

function documentWith(...blocks: NexBookBlock[]): NexBookDocument {
  return { formatVersion: 1, blocks, results: {} };
}

function startHooks(): void {
  hooks.active = true;
  hooks.cursor = 0;
  hooks.values = [];
  hooks.effects = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  startHooks();
});

afterEach(() => vi.unstubAllGlobals());

describe('inserción posicional del documento', () => {
  it('produce A / nuevo / B sin mutar ni perder bloques o resultados', () => {
    const a = markdown('a');
    const b = markdown('b');
    const nuevo = markdown('nuevo');
    const results = { a: { status: 'ok' as const, outputs: [], durationMs: 4 } };
    const original: NexBookDocument = { ...documentWith(a, b), results };

    const inserted = insertBlocksAt(original, 1, [nuevo]);

    expect(inserted.blocks).toEqual([a, nuevo, b]);
    expect(inserted.blocks).not.toBe(original.blocks);
    expect(original.blocks).toEqual([a, b]);
    expect(inserted.results).toBe(results);
  });

  it('inserta en un documento vacío y recorta ambos extremos', () => {
    const nuevo = markdown('nuevo');
    expect(insertBlocksAt(documentWith(), 9, [nuevo]).blocks).toEqual([nuevo]);
    expect(insertBlocksAt(documentWith(markdown('a')), -3, [nuevo]).blocks.map((b) => b.id)).toEqual([
      'nuevo',
      'a',
    ]);
    expect(insertBlocksAt(documentWith(markdown('a')), 99, [nuevo]).blocks.map((b) => b.id)).toEqual([
      'a',
      'nuevo',
    ]);
  });
});

describe('catálogo compartido de bloques', () => {
  it('ofrece todos los tipos reales en el orden común', () => {
    expect(insertableNexBookBlocks({ assetUpload: true }).map((item) => item.type)).toEqual([
      'markdown',
      'code',
      'spreadsheet',
      'image',
      'ai_worklog',
    ]);
    expect(NEXBOOK_BLOCKS.map(nexBookBlockAction)).toEqual([
      'Texto',
      'Código',
      'Hoja de cálculo',
      'Imagen',
      'Registrar uso de IA',
    ]);
  });

  it('oculta Imagen cuando no existe uploadAsset', () => {
    expect(insertableNexBookBlocks({ assetUpload: false }).map((item) => item.type)).toEqual([
      'markdown',
      'code',
      'spreadsheet',
      'ai_worklog',
    ]);
  });
});

function inserter(canUploadAssets = false) {
  const onInsert = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return NexBookBlockInserter({
      variant: 'between',
      label: 'Añadir después de A',
      canUploadAssets,
      onInsert,
    });
  };
  const trigger = () =>
    elements(render()).find(
      (element) => element.type === 'button' && element.props['data-inserter-trigger'] === true
    )!;
  return { render, trigger, onInsert };
}

describe('interacción accesible del insertador', () => {
  it('abre desde un botón nativo y el menú contiene el catálogo disponible', () => {
    const harness = inserter();
    expect(harness.trigger().props.type).toBe('button');
    expect(harness.trigger().props['aria-haspopup']).toBe('menu');
    (harness.trigger().props.onClick as () => void)();

    const items = elements(harness.render()).filter((element) => element.props.role === 'menuitem');
    expect(items.map((item) => textOf(item))).toEqual([
      'TextoMarkdown',
      'CódigoPython, R…',
      'Hoja de cálculoDatos y fórmulas',
      'Registrar uso de IANexIA',
    ]);

    (items[1]!.props.onClick as () => void)();
    expect(harness.onInsert).toHaveBeenCalledWith('code');
    expect(elements(harness.render()).some((element) => element.props.role === 'menu')).toBe(false);
  });

  it('Escape cierra el menú y devuelve el foco al disparador', () => {
    const harness = inserter(true);
    (harness.trigger().props.onClick as () => void)();
    const root = harness.render();
    const focus = vi.fn();
    const stopPropagation = vi.fn();

    (root.props.onKeyDown as (event: unknown) => void)({
      key: 'Escape',
      stopPropagation,
      currentTarget: { querySelector: () => ({ focus }) },
    });

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(elements(harness.render()).some((element) => element.props.role === 'menu')).toBe(false);
  });

  it('las flechas recorren las opciones y Tab queda en la semántica nativa', () => {
    const harness = inserter();
    (harness.trigger().props.onClick as () => void)();
    const root = harness.render();
    const first = { focus: vi.fn() };
    const second = { focus: vi.fn() };
    vi.stubGlobal('document', { activeElement: first });
    const preventDefault = vi.fn();
    const currentTarget = { querySelectorAll: () => [first, second] };

    (root.props.onKeyDown as (event: unknown) => void)({
      key: 'ArrowDown',
      preventDefault,
      currentTarget,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(second.focus).toHaveBeenCalledOnce();

    (root.props.onKeyDown as (event: unknown) => void)({ key: 'Tab', currentTarget });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

function studio(initial: NexBookDocument, editable = true) {
  let current = initial;
  const changed = vi.fn((next: NexBookDocument) => {
    current = next;
  });
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    return NexBookStudio({ document: current, editable, onChange: changed });
  };
  return { render, changed, current: () => current };
}

describe('flujo de inserción de NexBookStudio', () => {
  it('el insertador entre A y B produce exactamente A / nuevo / B', () => {
    const harness = studio(documentWith(markdown('a'), markdown('b')));
    const afterA = elements(harness.render()).find(
      (element) =>
        element.type === NexBookBlockInserter &&
        element.props.label === 'Añadir un bloque después del bloque 1'
    )!;

    (afterA.props.onInsert as (type: string) => void)('markdown');

    expect(harness.current().blocks.map((block) => block.id)).toEqual([
      'a',
      expect.stringMatching(/^b[a-z0-9]{8}$/),
      'b',
    ]);
    expect(harness.current().blocks[0]).toEqual(markdown('a'));
    expect(harness.current().blocks[2]).toEqual(markdown('b'));
  });

  it('el menú global inserta en el documento vacío y después del último bloque', () => {
    const empty = studio(documentWith());
    const global = elements(empty.render()).find(
      (element) => element.type === NexBookBlockInserter && element.props.variant === 'toolbar'
    )!;
    (global.props.onInsert as (type: string) => void)('code');
    expect(empty.current().blocks.map((block) => block.type)).toEqual(['code']);

    const populated = studio(documentWith(markdown('a')));
    const footerCode = elements(populated.render()).find(
      (element) => element.type === 'button' && textOf(element) === '+ Código'
    )!;
    (footerCode.props.onClick as () => void)();
    expect(populated.current().blocks.map((block) => block.type)).toEqual(['markdown', 'code']);
  });

  it('read-only no muestra ninguna acción de inserción', () => {
    const tree = studio(documentWith(markdown('a')), false).render();
    expect(elements(tree).some((element) => element.type === NexBookBlockInserter)).toBe(false);
    expect(textOf(tree)).not.toContain('+ Texto');
    expect(textOf(tree)).not.toContain('+ Código');
  });

  it('deshabilita todos los caminos al alcanzar maxBlocks y conserva el documento', () => {
    const full = documentWith(
      ...Array.from({ length: NEXBOOK_LIMITS.maxBlocks }, (_, index) => markdown(`b${index}`))
    );
    const harness = studio(full);
    const tree = harness.render();
    const insertions = elements(tree).filter((element) => element.type === NexBookBlockInserter);
    expect(insertions.length).toBeGreaterThan(1);
    expect(insertions.every((element) => element.props.disabled === true)).toBe(true);
    expect(
      elements(tree)
        .filter((element) => element.type === 'button' && ['+ Texto', '+ Código'].includes(textOf(element)))
        .every((element) => element.props.disabled === true)
    ).toBe(true);

    (insertions[0]!.props.onInsert as (type: string) => void)('markdown');
    expect(harness.changed).not.toHaveBeenCalled();
    expect(harness.current()).toBe(full);
  });
});

describe('foco del bloque nuevo', () => {
  it('enfoca el primer control marcado y acepta ids antiguos con sintaxis CSS', () => {
    const focus = vi.fn();
    const target = {
      dataset: { block: 'viejo"] bloque' },
      querySelector: vi.fn(() => ({ focus })),
    };
    const other = { dataset: { block: 'otro' }, querySelector: vi.fn() };
    const container = { querySelectorAll: () => [other, target] } as unknown as HTMLElement;

    focusNexBookBlock(container, 'viejo"] bloque');

    expect(target.querySelector).toHaveBeenCalledWith(
      'textarea, input, select, .monaco-editor textarea, [data-block-focus]'
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(other.querySelector).not.toHaveBeenCalled();
  });
});
