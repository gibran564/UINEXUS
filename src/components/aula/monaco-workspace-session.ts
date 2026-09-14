import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import type { EditorDiagnostic, EditorDiagnosticSeverity } from '@/lib/editor-diagnostics';

type MonacoApi = typeof Monaco;

export const WORKSPACE_MARKER_OWNER = 'nexus-workspace';

export interface WorkspaceEditorPosition {
  line: number;
  column: number;
}

export interface MonacoWorkspaceSessionOptions {
  editor: MonacoEditor.IStandaloneCodeEditor;
  monaco: MonacoApi;
  onChange: (file: string, value: string) => void;
  onDiagnosticsChange?: (diagnostics: EditorDiagnostic[]) => void;
}

/**
 * Posee todos los recursos Monaco de UN workspace.
 *
 * React conserva el proyecto persistible; esta sesión conserva lo que sólo
 * Monaco sabe representar: models, undo, selección, scroll y markers.
 */
export class MonacoWorkspaceSession {
  private readonly models = new Map<string, MonacoEditor.ITextModel>();
  private readonly paths = new Map<string, string>();
  private readonly views = new Map<string, MonacoEditor.ICodeEditorViewState>();
  private readonly modelDisposables = new Map<string, IDisposable>();
  private readonly disposables: IDisposable[] = [];
  private readonly externalDiagnostics = new Map<string, EditorDiagnostic[]>();
  private activeFile = '';
  private reconciling = false;
  private disposed = false;
  private readonly uriNamespace = `workspace-${++workspaceSessionSequence}`;

  constructor(private readonly options: MonacoWorkspaceSessionOptions) {
    this.disposables.push(
      options.monaco.editor.onDidChangeMarkers(() => this.publishDiagnostics())
    );
  }

  reconcile(
    files: Readonly<Record<string, string>>,
    languageFor: (file: string) => string
  ): void {
    if (this.disposed) return;

    for (const [file, value] of Object.entries(files)) {
      const model = this.models.get(file) ?? this.createModel(file, value, languageFor(file));
      if (model.getLanguageId() !== languageFor(file)) {
        this.options.monaco.editor.setModelLanguage(model, languageFor(file));
      }
      if (model.getValue() !== value) {
        this.reconciling = true;
        try {
          model.setValue(value);
        } finally {
          this.reconciling = false;
        }
      }
    }

    for (const file of [...this.models.keys()]) {
      if (!Object.prototype.hasOwnProperty.call(files, file)) this.deleteFile(file);
    }
  }

  openFile(file: string, position?: WorkspaceEditorPosition): boolean {
    const model = this.models.get(file);
    if (!model || this.disposed) return false;

    if (this.activeFile !== file || this.options.editor.getModel() !== model) {
      this.saveActiveView();
      this.options.editor.setModel(model);
      this.activeFile = file;
      const view = this.views.get(file);
      if (view) this.options.editor.restoreViewState(view);
    }

    if (position) {
      const safe = {
        lineNumber: Math.max(1, Math.min(position.line, model.getLineCount())),
        column: Math.max(1, position.column),
      };
      this.options.editor.setPosition(safe);
      this.options.editor.revealPositionInCenter(safe);
    }
    if (position) this.options.editor.focus();
    return true;
  }

  renameFile(oldFile: string, newFile: string, language: string): boolean {
    const oldModel = this.models.get(oldFile);
    if (!oldModel || this.models.has(newFile) || this.disposed) return false;

    if (this.activeFile === oldFile) this.saveActiveView();
    const oldView = this.views.get(oldFile);
    const diagnostics = this.externalDiagnostics.get(oldFile) ?? [];
    const wasActive = this.activeFile === oldFile;
    const value = oldModel.getValue();

    // La URI de ITextModel es inmutable. El model nuevo conserva contenido,
    // vista y diagnostics; Monaco no expone una API para trasladar su undo
    // stack privado a otra URI.
    this.createModel(newFile, value, language);
    if (oldView) this.views.set(newFile, oldView);
    if (diagnostics.length > 0) {
      this.setDiagnostics([
        ...this.allExternalDiagnostics().filter((item) => item.file !== oldFile),
        ...diagnostics.map((item) => ({ ...item, file: newFile })),
      ]);
    }
    if (wasActive) this.openFile(newFile);
    this.deleteFile(oldFile);
    return true;
  }

  deleteFile(file: string): boolean {
    const model = this.models.get(file);
    if (!model) return false;
    if (this.activeFile === file) {
      this.activeFile = '';
      if (this.options.editor.getModel() === model) this.options.editor.setModel(null);
    }
    this.modelDisposables.get(file)?.dispose();
    this.modelDisposables.delete(file);
    this.models.delete(file);
    this.paths.delete(model.uri.toString());
    this.views.delete(file);
    this.externalDiagnostics.delete(file);
    this.options.monaco.editor.setModelMarkers(model, WORKSPACE_MARKER_OWNER, []);
    model.dispose();
    this.publishDiagnostics();
    return true;
  }

  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
    const next = new Map<string, EditorDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const values = next.get(diagnostic.file) ?? [];
      values.push(diagnostic);
      next.set(diagnostic.file, values);
    }
    this.externalDiagnostics.clear();
    for (const [file, model] of this.models) {
      const values = next.get(file) ?? [];
      this.externalDiagnostics.set(file, values);
      this.options.monaco.editor.setModelMarkers(
        model,
        WORKSPACE_MARKER_OWNER,
        values.map((item) => diagnosticToMarker(item, this.options.monaco))
      );
    }
    this.publishDiagnostics();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.saveActiveView();
    this.options.editor.setModel(null);
    for (const disposable of this.modelDisposables.values()) disposable.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    for (const model of this.models.values()) model.dispose();
    this.modelDisposables.clear();
    this.models.clear();
    this.paths.clear();
    this.views.clear();
    this.externalDiagnostics.clear();
  }

  modelCount(): number {
    return this.models.size;
  }

  modelFor(file: string): MonacoEditor.ITextModel | undefined {
    return this.models.get(file);
  }

  private createModel(file: string, value: string, language: string): MonacoEditor.ITextModel {
    const uri = this.options.monaco.Uri.parse(workspaceUri(file, this.uriNamespace));
    const model = this.options.monaco.editor.createModel(value, language, uri);
    this.models.set(file, model);
    this.paths.set(uri.toString(), file);
    this.modelDisposables.set(
      file,
      model.onDidChangeContent(() => {
        if (!this.reconciling && !this.disposed) this.options.onChange(file, model.getValue());
      })
    );
    return model;
  }

  private saveActiveView(): void {
    if (!this.activeFile) return;
    const state = this.options.editor.saveViewState();
    if (state) this.views.set(this.activeFile, state);
  }

  private publishDiagnostics(): void {
    const callback = this.options.onDiagnosticsChange;
    if (!callback || this.disposed) return;
    const diagnostics: EditorDiagnostic[] = [];
    for (const model of this.models.values()) {
      const file = this.paths.get(model.uri.toString());
      if (!file) continue;
      for (const marker of this.options.monaco.editor.getModelMarkers({ resource: model.uri })) {
        diagnostics.push(markerToDiagnostic(file, marker, this.options.monaco));
      }
    }
    diagnostics.sort(compareDiagnostics);
    callback(diagnostics);
  }

  private allExternalDiagnostics(): EditorDiagnostic[] {
    return [...this.externalDiagnostics.values()].flat();
  }
}

export function workspaceUri(file: string, namespace = ''): string {
  const encodedPath = file.split('/').map(encodeURIComponent).join('/');
  return namespace ? `nexcode://${encodeURIComponent(namespace)}/${encodedPath}` : `nexcode:///${encodedPath}`;
}

export function diagnosticToMarker(
  diagnostic: EditorDiagnostic,
  monaco: MonacoApi
): MonacoEditor.IMarkerData {
  return {
    severity: severityToMarker(diagnostic.severity, monaco),
    message: diagnostic.message,
    startLineNumber: diagnostic.startLine,
    startColumn: diagnostic.startColumn,
    endLineNumber: diagnostic.endLine ?? diagnostic.startLine,
    endColumn: diagnostic.endColumn ?? diagnostic.startColumn + 1,
    source: diagnostic.source,
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
  };
}

function markerToDiagnostic(
  file: string,
  marker: MonacoEditor.IMarker,
  monaco: MonacoApi
): EditorDiagnostic {
  return {
    file,
    severity: markerSeverity(marker.severity, monaco),
    message: marker.message,
    startLine: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
    source: marker.source || marker.owner || 'Monaco',
    ...(marker.code !== undefined
      ? { code: typeof marker.code === 'string' ? marker.code : marker.code.value }
      : {}),
  };
}

function severityToMarker(severity: EditorDiagnosticSeverity, monaco: MonacoApi): number {
  if (severity === 'error') return monaco.MarkerSeverity.Error;
  if (severity === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

function markerSeverity(severity: number, monaco: MonacoApi): EditorDiagnosticSeverity {
  if (severity >= monaco.MarkerSeverity.Error) return 'error';
  if (severity >= monaco.MarkerSeverity.Warning) return 'warning';
  return 'info';
}

function compareDiagnostics(left: EditorDiagnostic, right: EditorDiagnostic): number {
  return (
    left.file.localeCompare(right.file) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn
  );
}

let workspaceSessionSequence = 0;
