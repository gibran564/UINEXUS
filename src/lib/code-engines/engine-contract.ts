import type { BrowserExecutionOptions, BrowserRuntimeLanguage } from '../browser-code-runner-protocol';
import { OutputRecorder, type RecordedOutput } from './output-recorder';

/**
 * El motor de un lenguaje, sin nada del navegador alrededor.
 *
 * Existe separado del Worker por una razón muy concreta: un Worker no se puede
 * probar en Node, y «Python imprime 4» sí tiene que poder probarse. El Worker
 * queda reducido a traducir mensajes; toda la lógica que merece una prueba vive
 * aquí y se ejecuta igual en Node que dentro del navegador.
 *
 * El motor NO conoce tiempos límite. Un motor que se cuelga no puede
 * interrumpirse a sí mismo —ése es justo el caso que hay que sobrevivir—, así
 * que el reloj lo lleva quien controla el Worker y la salida de un motor colgado
 * es terminarlo. Ver `lib/browser-code-runner.ts`.
 */

export interface CodeEngineRun {
  status: 'ok' | 'failed';
  stdout: string;
  stderr: string;
  truncated: boolean;
  /**
   * La misma salida, ORDENADA y con los tipos ricos.
   *
   * No duplica `stdout`/`stderr`: las tres salen del MISMO registro (ver
   * `output-recorder.ts`), así que no pueden contradecirse. Las dos cadenas
   * siguen existiendo porque el ejecutor aislado de las actividades enseña una
   * consola y no necesita nada más; un NexBook lee esto.
   */
  outputs: RecordedOutput[];
}

/**
 * Cómo se ejecuta una fuente: aislada o dentro de una sesión.
 *
 * `isolated` es lo de siempre y sigue siendo el valor por defecto: cada
 * ejecución empieza con el estado limpio, así que un `resultado = 42` de hace
 * tres intentos no puede hacer pasar por bueno un programa que ya no lo calcula.
 * Es lo correcto para un paso de actividad, donde lo que se entrega es UN
 * programa que tiene que funcionar por sí solo.
 *
 * `session` conserva el estado entre llamadas, que es lo que hace que un
 * NexBook sea un NexBook: definir `x = 10` en una celda y usarlo en la
 * siguiente. Es una propiedad de la EJECUCIÓN, no un motor distinto —por eso
 * entra aquí y no en un `NotebookEngine` paralelo—.
 */
export type CodeExecutionMode = 'isolated' | 'session';

export interface CodeEngine {
  readonly language: BrowserRuntimeLanguage;
  /** Arranca el runtime. Idempotente: la segunda llamada reutiliza la primera. */
  prepare(): Promise<void>;
  run(
    source: string,
    options: BrowserExecutionOptions,
    mode?: CodeExecutionMode
  ): Promise<CodeEngineRun>;
  /**
   * Vacía el estado de la sesión SIN tirar el runtime.
   *
   * Es la diferencia entre «reiniciar el kernel» y «volver a descargar trece
   * megas de WebAssembly». Reiniciar un kernel en mitad de una clase tiene que
   * costar milisegundos.
   */
  resetSession(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Un acumulador de salida con tope duro, que además conserva el ORDEN.
 *
 * `while True: print("x")` no puede llenar la memoria de nadie. Se corta en el
 * límite y se marca `truncated`, que es lo que la consola enseña como «la
 * salida se truncó»: mentir por omisión sería peor que truncar.
 *
 * Desde la iteración 9 es un `OutputRecorder`: las dos cadenas planas siguen
 * estando —el ejecutor aislado de las actividades trabaja con ellas— y encima
 * queda la secuencia real de trozos, que es lo que lee un NexBook. El nombre se
 * conserva porque describe bien lo que hace: acumular con un límite.
 */
export class LimitedOutput extends OutputRecorder {
  toRun(status: 'ok' | 'failed'): CodeEngineRun {
    return {
      status,
      stdout: this.stdout,
      stderr: this.stderr,
      truncated: this.truncated,
      outputs: this.outputs(),
    };
  }
}

export { OutputRecorder };
export type { RecordedOutput };
