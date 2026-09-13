import type { BrowserCodeRunner } from '../browser-code-runner';
import { PROGRAMMING_LANGUAGES } from '../constants';
import type { ExecutionProvider } from './provider-contract';

/**
 * Adaptador del ejecutor que ya posee la UI.
 *
 * N6.0 no conecta todavía `CodeEditor`: el editor conserva la creación, el
 * cambio de lenguaje y la destrucción del runner que ya funcionan. Este módulo
 * no toma ese ciclo de vida; sólo lo presenta como proveedor para que N6.1
 * pueda conectarlo sin duplicar Workers, motores, relojes ni estados.
 */
export function createBrowserExecutionProvider(runner: BrowserCodeRunner): ExecutionProvider {
  return {
    id: 'browser',
    async capabilities() {
      return {
        provider: 'browser',
        available: true,
        runtimes: PROGRAMMING_LANGUAGES.filter(
          (language) => language.capabilities.browserExecution
        ).map((language) => ({
          language: language.value,
          multiFile: true,
          gui: false,
          interactive: false,
        })),
      };
    },
    run(request) {
      return runner.run(request);
    },
  };
}
