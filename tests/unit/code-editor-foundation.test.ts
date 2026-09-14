import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FallbackCodeEditor,
  ProblemsPanel,
  activateEditorProblem,
  buildCodeRunRequest,
  monacoWorkerKind,
} from '@/components/aula/code-editor';
import type { EditorDiagnostic } from '@/lib/editor-diagnostics';

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

describe('fallback funcional del editor', () => {
  it('muestra y propaga el archivo activo', () => {
    const onChange = vi.fn();
    const textarea = FallbackCodeEditor({
      ariaLabel: 'Archivo utils.py',
      readOnly: false,
      value: 'print(1)',
      onChange,
      onExecute: vi.fn(),
      height: 460,
    });
    expect(textarea.type).toBe('textarea');
    expect(textarea.props.value).toBe('print(1)');
    textarea.props.onChange({ target: { value: 'print(2)' } });
    expect(onChange).toHaveBeenCalledWith('print(2)');
  });

  it('ejecuta Ctrl/Cmd+Enter sin depender de Monaco', () => {
    const onExecute = vi.fn();
    const textarea = FallbackCodeEditor({
      ariaLabel: 'Archivo main.R',
      readOnly: false,
      value: 'cat(1)',
      onExecute,
      height: 460,
    });
    const preventDefault = vi.fn();
    textarea.props.onKeyDown({ ctrlKey: true, metaKey: false, key: 'Enter', preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onExecute).toHaveBeenCalledOnce();
  });
});

describe('boundary de ejecución multiarchivo', () => {
  it.each([
    ['python' as const, 'main.py', 'print("principal")', { 'main.py': 'print("principal")', 'utils.py': 'x = 1' }],
    ['r' as const, 'main.R', 'source("utils.R")', { 'main.R': 'source("utils.R")', 'utils.R': 'x <- 1' }],
  ])('ejecuta el entryFile de %s aunque el archivo visible sea otro', (language, entryFile, source, files) => {
    const request = buildCodeRunRequest(language, source, files, entryFile);
    expect(request).toEqual({ language, source, files, entryFile });
    expect(request.source).toBe(files[entryFile as keyof typeof files]);
  });
});

describe('Problems', () => {
  it('selecciona el archivo antes de posicionar y enfocar su model', () => {
    const calls: string[] = [];
    const session = {
      openFile: vi.fn((file: string, position?: { line: number; column: number }) => {
        calls.push(`open:${file}:${position?.line}:${position?.column}`);
        return true;
      }),
    };
    activateEditorProblem(problem, session, (file) => calls.push(`select:${file}`));
    expect(calls).toEqual(['select:src/app.js', 'open:src/app.js:7:4']);
  });

  it('muestra el estado vacío y expone cada problema como botón de teclado', () => {
    const empty = ProblemsPanel({ problems: [], onOpen: vi.fn() });
    expect(textOf(empty)).toBe('Sin problemas detectados');

    const onOpen = vi.fn();
    const populated = ProblemsPanel({ problems: [problem], onOpen });
    const button = elements(populated).find((element) => element.type === 'button');
    expect(button).toBeDefined();
    expect(textOf(button)).toContain('src/app.js:7:4');
    (button!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledWith(problem);
  });
});

describe('workers de diagnostics nativos', () => {
  it('despacha HTML, CSS y JavaScript a sus servicios de lenguaje', () => {
    expect(monacoWorkerKind('html')).toBe('html');
    expect(monacoWorkerKind('css')).toBe('css');
    expect(monacoWorkerKind('javascript')).toBe('typescript');
    expect(monacoWorkerKind('python')).toBe('editor');
  });
});

const problem: EditorDiagnostic = {
  file: 'src/app.js',
  severity: 'error',
  message: 'Se esperaba una expresión',
  startLine: 7,
  startColumn: 4,
  source: 'javascript',
  code: '1109',
};

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

function textOf(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
