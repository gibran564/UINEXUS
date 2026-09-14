export type EditorDiagnosticSeverity = 'error' | 'warning' | 'info';

/** Diagnóstico neutral: ningún runtime necesita conocer Monaco para producirlo. */
export interface EditorDiagnostic {
  file: string;
  severity: EditorDiagnosticSeverity;
  message: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
  source: string;
  code?: string;
}
