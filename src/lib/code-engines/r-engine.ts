import type { WebR as WebRType } from 'webr';
import {
  LimitedOutput,
  type CodeEngine,
  type CodeEngineRun,
  type CodeExecutionMode,
} from './engine-contract';
import { NEXBOOK_LIMITS } from '../constants';
import type { BrowserExecutionOptions, BrowserTableCell } from '../browser-code-runner-protocol';

/**
 * Lo mínimo que este motor necesita saber del valor que devuelve `captureR`.
 *
 * Se declara aquí, acotado, en vez de arrastrar los tipos internos de webR: sus
 * proxies están tipados con genéricos que dependen de su implementación del
 * Worker, y atarse a ellos convertiría cualquier actualización de webR en un
 * error de compilación en un archivo que no tiene nada que ver.
 */
interface CapturedValue {
  type(): Promise<string>;
  names(): Promise<string[] | null>;
  attrs(): Promise<{ names(): Promise<string[] | null> } | null>;
  toD3(): Promise<Record<string, unknown>[]>;
}

/**
 * R dentro del navegador, con webR.
 *
 * ## Un detalle de forma que conviene no olvidar
 *
 * webR NO es una biblioteca que se ejecute donde se la llama: la clase `WebR`
 * es un proxy, y R corre en un Worker propio que webR arranca por su cuenta.
 * Este motor se instancia dentro de `workers/r-runner.worker.ts`, así que hay
 * un Worker anidado. Es a propósito: cuando UINexus termina SU Worker por
 * tiempo excedido, el algoritmo de terminación del estándar arrastra a los
 * Workers hijos, y con ellos al R que se quedó dando vueltas. Un `webR.close()`
 * cooperativo no sirve para eso: si R está en un bucle infinito no hay nadie
 * escuchando al otro lado.
 *
 * El precio es Safari 16.4 como suelo (Workers anidados). Está anotado en
 * docs/LIMITATIONS.md.
 *
 * ## Canal
 *
 * `PostMessage` explícito y no `Automatic`. El canal automático prefiere
 * `SharedArrayBuffer`, que exige que la página esté aislada por origen
 * (COOP/COEP), y si no lo está cae a un canal que necesita un Service Worker
 * registrado. Ninguna de las dos cosas es cierta en UINexus, y descubrirlo en
 * tiempo de ejecución sería descubrirlo en la clase de alguien.
 *
 * ## Paquetes y red
 *
 * `webr::install()`, `install.packages()`, `download.file()` y `url()` se
 * enmascaran antes de que corra una sola línea del alumnado. Eso es claridad
 * —el error dice POR QUÉ y no «no se pudo conectar»—, no la barrera: la barrera
 * es que el repositorio de paquetes de webR está fuera de `connect-src` en la
 * CSP de la plataforma. Ver docs/SECURITY.md.
 */

type WebRConstructor = typeof WebRType;
type WebRInstance = InstanceType<WebRConstructor>;

/** Canal `PostMessage` de webR. Ver `ChannelType` en `webr`. */
const POST_MESSAGE_CHANNEL = 3;

/**
 * Lo que R ejecuta antes que nada.
 *
 * ## Por qué recorre TODA la ruta de búsqueda
 *
 * La primera versión enmascaraba sólo en `package:base` y parecía correcta.
 * No lo era: `install.packages` y `download.file` viven en `package:utils`, así
 * que se quedaban intactas. Se vio en el navegador —`download.file` llegó a
 * imprimir «trying URL 'https://example.com'», es decir, INTENTÓ salir a la
 * red— y por eso ahora se recorre la ruta de búsqueda entera y los espacios de
 * nombres donde de verdad están.
 *
 * Enmascararlas en el entorno global no habría servido: ahí están a un `rm()`
 * de distancia del código del alumnado.
 *
 * Esto es claridad, no la barrera. El error dice POR QUÉ en vez de un «no se
 * pudo conectar». La barrera es que el repositorio de webR queda fuera de
 * `connect-src`. Ver docs/SECURITY.md.
 */
const R_PROLOGUE = `
local({
  blocked <- function(what) {
    force(what)
    function(...) stop(
      paste0(what, "() no está disponible: esta ejecución no tiene acceso a la red."),
      call. = FALSE
    )
  }

  mask <- function(name, env) {
    try({
      if (exists(name, envir = env, inherits = FALSE) &&
          is.function(get(name, envir = env, inherits = FALSE))) {
        unlockBinding(name, env)
        assign(name, blocked(name), envir = env)
        lockBinding(name, env)
      }
    }, silent = TRUE)
  }

  envs <- lapply(search(), as.environment)
  for (pkg in c("utils", "webr")) {
    try({
      if (pkg %in% loadedNamespaces()) envs <- c(envs, asNamespace(pkg))
    }, silent = TRUE)
  }

  for (name in c("install.packages", "download.file", "url")) {
    for (env in envs) mask(name, env)
  }

  # \`webr::install\` se lee del espacio de nombres, no de la ruta de búsqueda:
  # hay que enmascararla justo ahí o el \`::\` la encuentra igual.
  try({
    if ("webr" %in% loadedNamespaces()) mask("install", asNamespace("webr"))
  }, silent = TRUE)
})
`;

export interface REngineOptions {
  /** Dónde están los assets del runtime de webR. */
  baseUrl: string;
  /**
   * La clase `WebR`, inyectable.
   *
   * Igual que con Pyodide: en el navegador se carga desde `baseUrl` y no desde
   * el paquete empaquetado, para que el `webr.mjs` y el `R.wasm` que se
   * ejecutan sean de la misma copia publicada. Ver `python-engine.ts`.
   */
  WebRClass?: WebRConstructor;
}

/**
 * Carga el módulo publicado en `baseUrl`, fuera del grafo del empaquetador.
 *
 * `webr.js` y no `webr.mjs`: son dos compilaciones distintas del mismo paquete
 * y sólo la primera es la del navegador. La otra —la que webR declara para
 * Node— conserva un `import("path")` y un `require` de `"module"` que el
 * navegador no sabe resolver, y falla con un «Failed to resolve module
 * specifier "module"» que no se parece en nada a su causa.
 */
async function importWebR(baseUrl: string): Promise<WebRConstructor> {
  const runtime = (await import(/* webpackIgnore: true */ `${baseUrl}webr.js`)) as {
    WebR: WebRConstructor;
  };
  return runtime.WebR;
}

export function createREngine(options: REngineOptions): CodeEngine {
  let booting: Promise<WebRInstance> | null = null;
  let instance: WebRInstance | null = null;

  async function boot(): Promise<WebRInstance> {
    if (booting) return booting;

    booting = (async () => {
      const WebRClass = options.WebRClass ?? (await importWebR(options.baseUrl));
      const webR = new WebRClass({
        baseUrl: options.baseUrl,
        channelType: POST_MESSAGE_CHANNEL,
        // R no lee de un terminal aquí. En modo interactivo, un `readline()`
        // dejaría la ejecución esperando una entrada que nadie va a escribir.
        interactive: false,
      });
      await webR.init();
      await webR.evalRVoid(R_PROLOGUE);
      instance = webR;
      return webR;
    })();

    try {
      return await booting;
    } catch (caught) {
      booting = null;
      instance = null;
      throw caught;
    }
  }

  return {
    language: 'r',

    async prepare(): Promise<void> {
      await boot();
    },

    async run(
      source: string,
      runOptions: BrowserExecutionOptions,
      mode: CodeExecutionMode = 'isolated'
    ): Promise<CodeEngineRun> {
      const webR = await boot();
      const output = new LimitedOutput(runOptions.maxOutputChars);

      /**
       * R es al revés que Python: aquí lo difícil es NO conservar el estado.
       *
       * `captureR` evalúa en el entorno global de R, así que un `x <- 10` ya
       * sobrevive de una llamada a la siguiente. Para una celda de NexBook eso
       * es exactamente lo que se quiere; para un paso de actividad no, porque
       * un objeto de hace tres intentos haría pasar por bueno un programa que
       * ya no lo calcula.
       *
       * Por eso el modo aislado limpia el entorno global ANTES de ejecutar, en
       * vez de intentar evaluar en un entorno nuevo: muchas expresiones de R
       * —`<<-`, `assign()`, cargar un paquete— buscan el global de todas formas,
       * así que un entorno de mentira daría una falsa sensación de aislamiento.
       */
      if (mode === 'isolated') await clearGlobalEnv(webR);

      // El refugio libera de golpe todo lo que R reservó durante ESTA
      // ejecución. Sin él, veinte ejecuciones seguidas van dejando objetos
      // vivos hasta que el runtime se queda sin memoria.
      const shelter = await new webR.Shelter();
      try {
        const captured = await shelter.captureR(source, {
          withAutoprint: true,
          captureStreams: true,
          /**
           * Con `false`, un `print(no_existe)` acababa en la consola como
           * «Finalizado» con un error escondido en stderr. Con `true`, webR
           * detecta la condición de error y LANZA, que es lo que convierte la
           * ejecución en un fallo de verdad. Se comprobó en el navegador antes
           * de dejarlo así.
           */
          captureConditions: true,
          /**
           * Las gráficas SÍ se capturan desde la iteración 9.
           *
           * webR trae su propio dispositivo gráfico de canvas: `plot()` no
           * necesita ningún paquete extra ni ninguna descarga, sólo que se
           * encienda el dispositivo. Estaba apagado porque hasta ahora la salida
           * era una consola de texto y una figura no tenía dónde ir.
           *
           * El tamaño se fija aquí y no se deja al defecto para que una gráfica
           * tenga la misma forma en todos los navegadores; el fondo es blanco
           * porque una figura transparente sobre el tema oscuro deja los ejes
           * negros invisibles.
           */
          captureGraphics: { width: 720, height: 460, bg: 'white', capture: true },
        });

        /**
         * `captured.output` YA VIENE ORDENADO.
         *
         * Ésta es la mitad de R de la corrección del orden real: webR devuelve
         * un array con los trozos en la secuencia en que se produjeron, y hasta
         * la iteración 8 se recorría para volcarlo en dos cadenas separadas. El
         * recorrido es el mismo; lo que cambia es que ahora el registro conserva
         * la posición de cada trozo.
         */
        for (const line of captured.output) {
          if (line.type === 'stdout') output.line('stdout', String(line.data));
          else if (line.type === 'stderr') output.line('stderr', String(line.data));
          // Con las condiciones capturadas, avisos y mensajes ya no pasan por
          // stderr. Perderlos dejaría a alguien sin ver «NaNs produced».
          else if (line.type === 'warning' || line.type === 'message') {
            output.line('stderr', conditionMessage(line.data, line.type));
          }
        }

        await emitRImages(captured.images, output);
        await emitRTable(captured.result as unknown as CapturedValue | undefined, output);
        return output.toRun('ok');
      } catch (caught) {
        output.append('error', describeRError(caught));
        return output.toRun('failed');
      } finally {
        await shelter.purge();
      }
    },

    async resetSession(): Promise<void> {
      // Vaciar el entorno global, no cerrar webR: reiniciar un kernel en mitad
      // de una clase no puede costar otra descarga de cuarenta y seis megas.
      if (instance) await clearGlobalEnv(instance);
    },

    async dispose(): Promise<void> {
      const current = instance;
      booting = null;
      instance = null;
      try {
        current?.close();
      } catch {
        // Ya estaba cerrado, o su Worker ya no existe. Da igual: el objetivo
        // era que no quedara vivo.
      }
    },
  };
}

/** El texto de un aviso o mensaje capturado como condición de R. */
function conditionMessage(data: unknown, type: string): string {
  const message =
    data && typeof data === 'object' && 'message' in data
      ? String((data as { message: unknown }).message)
      : String(data);
  const clean = message.replace(/\n+$/, '');
  return type === 'warning' ? `Warning: ${clean}` : clean;
}

/**
 * El error de R, sin el andamiaje de webR por delante.
 *
 * webR enmarca la excepción con la llamada donde ocurrió, y cuando el código
 * viene de `captureR` esa llamada es siempre su propio `eval(ei, envir)` o un
 * «unknown source». Ninguna de las dos le dice nada a quien programa, y las dos
 * empujan el mensaje útil fuera de la primera línea. Un `Error in miFuncion(x)`
 * de verdad sí se conserva: ahí la llamada es del alumnado.
 */
function describeRError(caught: unknown): string {
  const text = caught instanceof Error ? caught.message : String(caught);
  const cleaned = text
    .replace(/^Error in webR:\s*/i, '')
    .replace(/^Error in `?eval\(ei, envir\)`?:\s*/, 'Error: ')
    .replace(/^Error in unknown source:\s*/, 'Error: ')
    .trim();
  return cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
}

// ---------------------------------------------------------------------------
// Salidas ricas (iteración 9)
// ---------------------------------------------------------------------------

/**
 * Las gráficas de R, convertidas a PNG.
 *
 * webR entrega `ImageBitmap`, que es un objeto vivo del navegador y no algo que
 * pueda guardarse en un documento. `OffscreenCanvas` es la forma de convertirlo
 * a bytes DENTRO de un Worker, donde no hay `document` del que colgar un canvas
 * normal. Es la misma familia de APIs que ya exige este motor —Workers anidados,
 * Safari 16.4 como suelo—, así que no baja el mínimo de navegador.
 *
 * Nunca lanza: una gráfica que no se pudo convertir no puede tumbar una
 * ejecución que por lo demás funcionó.
 */
async function emitRImages(images: ImageBitmap[] | undefined, output: LimitedOutput): Promise<void> {
  if (!images?.length) return;

  for (const image of images) {
    try {
      const base64 = await imageBitmapToPngBase64(image);
      if (base64) output.image(base64, 'image/png', image.width, image.height);
    } catch {
      // Sin canvas fuera de pantalla, o sin soporte de PNG. La celda se queda
      // con su texto.
    } finally {
      // El bitmap reserva memoria del navegador que no libera el recolector.
      try {
        image.close();
      } catch {
        // Ya cerrado.
      }
    }
  }
}

async function imageBitmapToPngBase64(image: ImageBitmap): Promise<string | null> {
  const OffscreenCanvasCtor = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas })
    .OffscreenCanvas;
  if (!OffscreenCanvasCtor) return null;

  const canvas = new OffscreenCanvasCtor(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = new Uint8Array(await blob.arrayBuffer());

  // En trozos: `String.fromCharCode(...buffer)` con una gráfica de 200 KB pasa
  // doscientos mil argumentos de golpe y revienta la pila de llamadas.
  let binary = '';
  const CHUNK = 8192;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/**
 * Un `data.frame` como tabla ESTRUCTURADA.
 *
 * ## Cómo se reconoce
 *
 * Por el atributo `row.names`, que en R sólo llevan los data.frame —una matriz
 * usa `dim` y `dimnames`—. Preguntar por la clase habría obligado a evaluar R
 * con el valor ya enlazado a un nombre, y enlazarlo significa tocar el entorno
 * del alumnado justo después de ejecutar su código.
 *
 * ## Qué NO hace
 *
 * No re-evalúa el fuente. El valor es el que devolvió `captureR`, así que un
 * `write.csv(...)` o un `Sys.time()` no ocurren dos veces. Eso descarta de
 * entrada la idea más obvia —volver a evaluar la última expresión para
 * inspeccionarla— que habría duplicado todos los efectos secundarios.
 */
async function emitRTable(result: CapturedValue | undefined, output: LimitedOutput): Promise<void> {
  if (!result) return;

  try {
    if ((await result.type()) !== 'list') return;

    const attributes = await result.attrs();
    const attributeNames = attributes ? await attributes.names() : null;
    if (!attributeNames?.includes('row.names')) return;

    const columns = (await result.names()) ?? [];
    if (columns.length === 0) return;

    const records = await result.toD3();
    const shown = records.slice(0, NEXBOOK_LIMITS.maxTableRows);
    const names = columns.slice(0, NEXBOOK_LIMITS.maxTableColumns);

    output.table(
      names,
      shown.map((record) => names.map((name) => toTableCell(record[name]))),
      records.length
    );
  } catch {
    // No era un data.frame reconocible, o webR no supo convertirlo. La celda ya
    // tiene el texto que R imprimió, que sigue siendo correcto.
  }
}

/** Lo que `toD3` devuelve por celda, reducido a un primitivo JSON. */
function toTableCell(value: unknown): BrowserTableCell {
  // webR envuelve cada valor en un vector de longitud 1. Se desenvuelve antes
  // de mirar el tipo, o toda la tabla saldría como `[object Object]`.
  const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value;

  if (unwrapped === null || unwrapped === undefined) return null;
  if (typeof unwrapped === 'number' || typeof unwrapped === 'boolean') return unwrapped;
  if (typeof unwrapped === 'string') {
    return unwrapped.length <= NEXBOOK_LIMITS.maxTableCellChars
      ? unwrapped
      : `${unwrapped.slice(0, NEXBOOK_LIMITS.maxTableCellChars)}…`;
  }
  return String(unwrapped);
}

/**
 * Deja el entorno global de R como recién arrancado.
 *
 * `rm(list = ls(all.names = TRUE))` incluye los nombres que empiezan por punto,
 * que `ls()` esconde por defecto: sin `all.names` quedarían objetos vivos que
 * nadie ve y que sí afectan a la ejecución siguiente.
 */
async function clearGlobalEnv(webR: WebRInstance): Promise<void> {
  await webR.evalRVoid('rm(list = ls(envir = globalenv(), all.names = TRUE), envir = globalenv())');
}
