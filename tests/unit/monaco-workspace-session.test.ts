import { describe, expect, it, vi } from 'vitest';
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
import {
  MonacoWorkspaceSession,
  WORKSPACE_MARKER_OWNER,
  diagnosticToMarker,
  workspaceUri,
  type MonacoWorkspaceSessionOptions,
} from '@/components/aula/monaco-workspace-session';
import type { EditorDiagnostic } from '@/lib/editor-diagnostics';

class FakeUri {
  constructor(private readonly value: string) {}
  toString() { return this.value; }
}

class FakeModel {
  readonly listeners = new Set<() => void>();
  readonly markers = new Map<string, MonacoEditor.IMarkerData[]>();
  readonly undo: string[] = [];
  disposed = false;

  constructor(
    private value: string,
    private language: string,
    readonly uri: FakeUri
  ) {}

  getValue() { return this.value; }
  getLanguageId() { return this.language; }
  getLineCount() { return Math.max(1, this.value.split('\n').length); }
  setLanguage(language: string) { this.language = language; }
  setValue(value: string) { this.value = value; this.emit(); }
  edit(value: string) { this.undo.push(this.value); this.value = value; this.emit(); }
  undoEdit() { this.value = this.undo.pop() ?? this.value; this.emit(); }
  onDidChangeContent(listener: () => void): IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
  private emit() { for (const listener of this.listeners) listener(); }
}

class FakeEditor {
  model: FakeModel | null = null;
  state: MonacoEditor.ICodeEditorViewState | null = null;
  restored: MonacoEditor.ICodeEditorViewState | null = null;
  position: { lineNumber: number; column: number } | null = null;
  focused = false;

  getModel() { return this.model; }
  setModel(model: MonacoEditor.ITextModel | null) { this.model = model as unknown as FakeModel | null; }
  saveViewState() { return this.state; }
  restoreViewState(state: MonacoEditor.ICodeEditorViewState | null) { this.restored = state; }
  setPosition(position: { lineNumber: number; column: number }) { this.position = position; }
  revealPositionInCenter(position: { lineNumber: number; column: number }) { this.position = position; }
  focus() { this.focused = true; }
}

function harness(onDiagnosticsChange = vi.fn()) {
  const models: FakeModel[] = [];
  const markerListeners = new Set<() => void>();
  const editor = new FakeEditor();
  const onChange = vi.fn();
  const monaco = {
    Uri: { parse: (value: string) => new FakeUri(value) },
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
      createModel: (value: string, language: string, uri: FakeUri) => {
        const model = new FakeModel(value, language, uri);
        models.push(model);
        return model;
      },
      setModelLanguage: (model: FakeModel, language: string) => model.setLanguage(language),
      setModelMarkers: (model: FakeModel, owner: string, markers: MonacoEditor.IMarkerData[]) => {
        model.markers.set(owner, markers);
        for (const listener of markerListeners) listener();
      },
      getModelMarkers: ({ resource }: { resource: FakeUri }) => {
        const model = models.find((candidate) => candidate.uri.toString() === resource.toString());
        return [...(model?.markers.values() ?? [])].flat().map((marker) => ({
          ...marker,
          owner: WORKSPACE_MARKER_OWNER,
          resource,
          relatedInformation: [],
          tags: [],
        }));
      },
      onDidChangeMarkers: (listener: () => void) => {
        markerListeners.add(listener);
        return { dispose: () => markerListeners.delete(listener) };
      },
    },
  } as unknown as MonacoWorkspaceSessionOptions['monaco'];
  const session = new MonacoWorkspaceSession({
    editor: editor as unknown as MonacoEditor.IStandaloneCodeEditor,
    monaco,
    onChange,
    onDiagnosticsChange,
  });
  return { session, editor, models, monaco, onChange, onDiagnosticsChange };
}

const languages = (file: string) => file.endsWith('.py') ? 'python' : 'javascript';

describe('sesión Monaco por workspace', () => {
  it('crea models distintos, con URI aislada, usando un único editor visual', () => {
    const first = harness();
    const second = harness();
    first.session.reconcile({ 'main.py': 'print(1)', 'src/app.js': 'alert(1)' }, languages);
    second.session.reconcile({ 'main.py': 'print(2)' }, languages);

    expect(first.session.modelCount()).toBe(2);
    expect(first.session.modelFor('main.py')).not.toBe(first.session.modelFor('src/app.js'));
    expect(first.session.modelFor('main.py')!.uri.toString()).not.toBe(
      second.session.modelFor('main.py')!.uri.toString()
    );
    expect(workspaceUri('src/app.js')).toBe('nexcode:///src/app.js');
  });

  it('preserva contenido y undo de cada model al alternar archivos', () => {
    const { session, editor, onChange } = harness();
    session.reconcile({ 'a.py': 'a = 1', 'b.py': 'b = 1' }, languages);
    session.openFile('a.py');
    const a = session.modelFor('a.py') as unknown as FakeModel;
    a.edit('a = 2');
    session.openFile('b.py');
    const b = session.modelFor('b.py') as unknown as FakeModel;
    b.edit('b = 2');
    session.openFile('a.py');
    a.undoEdit();

    expect(editor.model).toBe(a);
    expect(a.getValue()).toBe('a = 1');
    expect(b.getValue()).toBe('b = 2');
    expect(onChange).toHaveBeenCalledWith('a.py', 'a = 2');
  });

  it('guarda y restaura view state por archivo', () => {
    const { session, editor } = harness();
    session.reconcile({ 'a.py': '', 'b.py': '' }, languages);
    session.openFile('a.py');
    const stateA = { scrollTop: 30 } as unknown as MonacoEditor.ICodeEditorViewState;
    editor.state = stateA;
    session.openFile('b.py');
    editor.state = { scrollTop: 4 } as unknown as MonacoEditor.ICodeEditorViewState;
    session.openFile('a.py');
    expect(editor.restored).toBe(stateA);
  });

  it('aísla markers y diagnostics por archivo', () => {
    const onDiagnostics = vi.fn();
    const { session } = harness(onDiagnostics);
    session.reconcile({ 'a.py': '', 'b.py': '' }, languages);
    session.setDiagnostics([problem('a.py', 3, 2)]);

    const a = session.modelFor('a.py') as unknown as FakeModel;
    const b = session.modelFor('b.py') as unknown as FakeModel;
    expect(a.markers.get(WORKSPACE_MARKER_OWNER)).toHaveLength(1);
    expect(b.markers.get(WORKSPACE_MARKER_OWNER)).toEqual([]);
    expect(onDiagnostics.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining(problem('a.py', 3, 2)),
    ]);
  });

  it('rename migra contenido, vista y markers y dispone la URI anterior', () => {
    const { session, editor } = harness();
    session.reconcile({ 'old.py': 'print(1)' }, languages);
    session.openFile('old.py');
    const old = session.modelFor('old.py') as unknown as FakeModel;
    editor.state = { scrollTop: 45 } as unknown as MonacoEditor.ICodeEditorViewState;
    session.setDiagnostics([problem('old.py', 1, 1)]);

    expect(session.renameFile('old.py', 'new.py', 'python')).toBe(true);
    const renamed = session.modelFor('new.py') as unknown as FakeModel;
    expect(renamed.getValue()).toBe('print(1)');
    expect(renamed.markers.get(WORKSPACE_MARKER_OWNER)).toHaveLength(1);
    expect(editor.restored).toEqual({ scrollTop: 45 });
    expect(old.disposed).toBe(true);
    expect(session.modelFor('old.py')).toBeUndefined();
  });

  it('delete dispone sólo su model y cerrar dispone todos los restantes', () => {
    const { session } = harness();
    session.reconcile({ 'a.py': '', 'b.py': '' }, languages);
    const a = session.modelFor('a.py') as unknown as FakeModel;
    const b = session.modelFor('b.py') as unknown as FakeModel;
    session.deleteFile('a.py');
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);
    session.dispose();
    expect(b.disposed).toBe(true);
    expect(session.modelCount()).toBe(0);
  });

  it('navega a archivo, línea y columna y enfoca el editor', () => {
    const { session, editor } = harness();
    session.reconcile({ 'a.py': 'uno\ndos\ntres' }, languages);
    session.openFile('a.py', { line: 2, column: 3 });
    expect(editor.position).toEqual({ lineNumber: 2, column: 3 });
    expect(editor.focused).toBe(true);
  });

  it('actualiza lenguaje por extensión sin recrear el model', () => {
    const { session } = harness();
    session.reconcile({ file: 'const x = 1' }, () => 'plaintext');
    const model = session.modelFor('file');
    session.reconcile({ file: 'const x = 1' }, () => 'javascript');
    expect(session.modelFor('file')).toBe(model);
    expect(model?.getLanguageId()).toBe('javascript');
  });
});

describe('adapter de diagnósticos', () => {
  it('traduce severidad y rangos sin acoplar el contrato a Monaco', () => {
    const { monaco } = harness();
    const marker = diagnosticToMarker(problem('a.py', 4, 5), monaco);
    expect(marker).toMatchObject({
      severity: 8,
      startLineNumber: 4,
      startColumn: 5,
      endLineNumber: 4,
      endColumn: 6,
      source: 'test',
    });
  });
});

function problem(file: string, startLine: number, startColumn: number): EditorDiagnostic {
  return {
    file,
    severity: 'error',
    message: 'Error de sintaxis',
    startLine,
    startColumn,
    source: 'test',
  };
}
