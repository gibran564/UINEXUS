import type { BrowserRichOutput, BrowserTableCell } from '../browser-code-runner-protocol';

/**
 * La salida de una ejecución, EN EL ORDEN EN QUE OCURRIÓ.
 *
 * ## Qué cambió respecto a la iteración 8
 *
 * Antes el motor acumulaba dos cadenas —stdout por un lado, stderr por otro— y
 * quien las pintaba las concatenaba: primero todo lo impreso, luego todo lo que
 * falló. Un programa que imprime, avisa y vuelve a imprimir salía contado al
 * revés de como pasó, y eso se documentó como una limitación pendiente de
 * «rediseñar los runtimes».
 *
 * No hacía falta rediseñar nada: la información YA estaba ahí y se tiraba.
 * Pyodide llama a `stdout` y `stderr` según el programa escribe, y `captureR`
 * devuelve un array ya ordenado. Lo único que faltaba era un acumulador que
 * respetara la secuencia en vez de separarla en dos montones.
 *
 * ## Sigue habiendo stdout y stderr
 *
 * `toRun()` devuelve TAMBIÉN las dos cadenas concatenadas, porque el ejecutor
 * aislado de las actividades (`CodeRunner`) trabaja con ellas y no tiene por qué
 * cambiar: un paso de actividad enseña una consola, no un documento. Las dos
 * vistas salen del mismo registro, así que no pueden contradecirse.
 *
 * ## El tope es de la EJECUCIÓN, no de cada trozo
 *
 * `while True: print("x")` no puede llenar la memoria de nadie. El límite se
 * aplica al total y, cuando se alcanza, se marca `truncated`: mentir por omisión
 * sería peor que truncar.
 */

/** Un trozo de salida, con su orden. */
export type RecordedOutput = BrowserRichOutput;

export class OutputRecorder {
  private readonly items: RecordedOutput[] = [];
  private used = 0;
  private seq = 0;

  stdout = '';
  stderr = '';
  truncated = false;

  constructor(private readonly limit: number) {}

  /** Texto tal cual, sin añadir salto de línea. */
  append(stream: 'stdout' | 'stderr' | 'error', chunk: string): void {
    if (!chunk) return;

    const remaining = Math.max(0, this.limit - this.used);
    if (chunk.length > remaining) this.truncated = true;
    if (remaining === 0) return;

    const text = chunk.slice(0, remaining);
    this.used += text.length;

    // Las dos cadenas planas conservan el comportamiento del ejecutor aislado.
    // `error` cuenta como stderr ahí: para una consola son lo mismo.
    if (stream === 'stdout') this.stdout += text;
    else this.stderr += text;

    /**
     * Trozos consecutivos del MISMO flujo se funden.
     *
     * Pyodide llama una vez por línea. Sin esto, un bucle de cien `print`
     * produciría cien entradas con su `seq`, su objeto y su clave en el JSON,
     * que es mucho JSON para decir lo mismo. El orden se conserva igual: sólo se
     * fusiona lo que ya era contiguo.
     */
    const last = this.items.at(-1);
    if (last && last.stream === stream) {
      last.text += text;
      return;
    }

    this.items.push({ seq: this.seq++, stream, text });
  }

  line(stream: 'stdout' | 'stderr' | 'error', chunk: string): void {
    this.append(stream, `${chunk}\n`);
  }

  /**
   * Una tabla, en el punto de la secuencia donde se produjo.
   *
   * No cuenta contra el tope de caracteres de texto: una tabla ya trae sus
   * propios límites de filas y columnas, y descontarla del presupuesto de la
   * consola haría que imprimir un `df` se comiera la salida del resto del
   * programa.
   */
  table(columns: string[], rows: BrowserTableCell[][], totalRows: number): void {
    this.items.push({
      seq: this.seq++,
      stream: 'table',
      columns,
      rows,
      totalRows,
      ...(totalRows > rows.length ? { truncated: true } : {}),
    });
  }

  /** Una imagen, con sus bytes todavía en Base64: el asset se crea más arriba. */
  image(base64: string, mimeType: 'image/png', width?: number, height?: number): void {
    this.items.push({
      seq: this.seq++,
      stream: 'image',
      base64,
      mimeType,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }

  /** Los trozos, en orden. */
  outputs(): RecordedOutput[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}
