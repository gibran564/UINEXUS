import 'server-only';

import {
  CODE_RUN_LIMITS,
  clampCodeRunResult,
  rejectedCodeRun,
  validateCodeRunRequest,
} from './code-runner-contract';
import type { CodeRunRequest, CodeRunResult, CodeRunner } from './code-runner-contract';
import type { ProgrammingLanguage } from './types';

export type { CodeRunRequest, CodeRunResult, CodeRunner } from './code-runner-contract';
export { CODE_RUN_LIMITS } from './code-runner-contract';

/**
 * Ejecución de código: la interfaz, y por qué hoy no hay nadie detrás.
 *
 * ## Lo que Nextudio NO hace, y no por falta de ganas
 *
 * No ejecuta el código del alumnado. Ni con `exec`, ni con `spawn`, ni con un
 * `Rscript` en el host de Next.js. Ejecutar código arbitrario en el mismo
 * proceso que firma las subidas a S3 y lee la base de datos no es un atajo: es
 * regalar la plataforma a quien entregue el `system()` correcto. Un entorno
 * académico es además el sitio donde más gente va a probar exactamente eso.
 *
 * ## Lo que sí hay
 *
 * Un ADAPTADOR. Si algún día se conecta un sandbox externo —un servicio propio,
 * un contenedor efímero, un proveedor de ejecución— cumplirá esta interfaz y el
 * resto de la aplicación no se enterará. Entretanto `getCodeRunner()` devuelve
 * `null`, la tarea sigue siendo perfectamente entregable y la interfaz
 * sencillamente no ofrece ningún botón de ejecutar: la ejecución nunca ha sido
 * requisito para entregar, y no debe llegar a serlo.
 *
 * ## Las condiciones que tendría que cumplir ese sandbox
 *
 * Están escritas aquí y no en un documento aparte porque son parte del
 * contrato, no de la documentación:
 *
 *  · Fuera del host de Next.js. Siempre.
 *  · Tiempo máximo estricto, aplicado por el sandbox y no sólo por el cliente.
 *  · Salida acotada: un bucle que imprime no puede llenar la memoria de nadie.
 *  · Tamaño de código acotado (`ACADEMIC_LIMITS.codeMax`).
 *  · Sin red por defecto.
 *  · Sin acceso a ninguna variable de entorno de Nextudio. El token del runner
 *    viaja en la cabecera de ESTA petición y nunca dentro del entorno de
 *    ejecución.
 *  · El cliente elige QUÉ código y en qué lenguaje, nunca QUÉ COMANDO: en esta
 *    interfaz no hay ningún hueco donde quepa un comando.
 */

const RUNNER_URL = process.env.UINEXUS_CODE_RUNNER_URL?.trim() ?? '';
const RUNNER_TOKEN = process.env.UINEXUS_CODE_RUNNER_TOKEN?.trim() ?? '';

/** ¿Hay un ejecutor configurado? Decide si la interfaz ofrece ejecutar. */
export function isCodeRunnerConfigured(): boolean {
  return Boolean(RUNNER_URL && RUNNER_TOKEN);
}

/**
 * El ejecutor configurado, o `null`.
 *
 * `null` NO es un error: es el estado normal de esta iteración y de cualquier
 * despliegue que no quiera mantener un sandbox. Quien llame debe tratarlo como
 * «esta función no está disponible», nunca como un fallo que haya que reportar.
 */
export function getCodeRunner(): CodeRunner | null {
  if (!isCodeRunnerConfigured()) return null;
  return new HttpCodeRunner(RUNNER_URL, RUNNER_TOKEN);
}

/**
 * Adaptador sobre un servicio HTTP de ejecución.
 *
 * El cuerpo lleva SÓLO lenguaje, fuente y entrada. No hay campo para un comando,
 * ni para argumentos, ni para una imagen de contenedor: si lo hubiera, el
 * cliente acabaría eligiéndolo tarde o temprano. Lo que el servicio remoto haga
 * con eso es su problema, y por eso tiene que estar aislado.
 */
class HttpCodeRunner implements CodeRunner {
  readonly name = 'http';

  constructor(
    private readonly endpoint: string,
    private readonly token: string
  ) {}

  supports(language: ProgrammingLanguage): boolean {
    // Hoy sólo R está habilitado en la interfaz; el adaptador no pretende saber
    // más que eso hasta que exista un servicio con el que comprobarlo.
    return language === 'r';
  }

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const started = Date.now();
    const invalid = validateCodeRunRequest(request, (language) => this.supports(language));
    if (invalid) return { ...invalid, durationMs: Date.now() - started };

    const abort = AbortSignal.timeout(CODE_RUN_LIMITS.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          language: request.language,
          source: request.source,
          stdin: request.stdin ?? '',
          timeoutMs: CODE_RUN_LIMITS.timeoutMs,
        }),
        signal: abort,
      });

      if (!response.ok) {
        return rejectedCodeRun('El servicio de ejecución no respondió.', Date.now() - started);
      }

      const body = (await response.json()) as Partial<CodeRunResult>;
      return clampCodeRunResult({
        status: body.status === 'ok' || body.status === 'failed' ? body.status : 'failed',
        stdout: body.stdout ?? '',
        stderr: body.stderr ?? '',
        exitCode: typeof body.exitCode === 'number' ? body.exitCode : null,
        durationMs: Date.now() - started,
        truncated: Boolean(body.truncated),
      });
    } catch (caught) {
      const timedOut = caught instanceof Error && caught.name === 'TimeoutError';
      return {
        status: timedOut ? 'timeout' : 'rejected',
        stdout: '',
        stderr: timedOut
          ? `La ejecución superó ${CODE_RUN_LIMITS.timeoutMs / 1000} segundos y se detuvo.`
          : 'No se pudo ejecutar el código ahora mismo.',
        exitCode: null,
        durationMs: Date.now() - started,
        truncated: false,
      };
    }
  }
}
