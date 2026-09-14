# El runtime de Java, en un navegador de verdad

```powershell
npm run runtimes     # compila los Workers y publica ECJ
npm run test:java    # ejecuta la suite en Chromium
```

Escribe `report.json` con el resultado de cada comprobación y sale con código
distinto de cero si alguna falla. `UINEXUS_JAVA_TEST_VERBOSE=1` muestra la consola
del navegador mientras corre.

## Por qué esta suite existe aparte

Porque lo que comprueba no se puede simular. CheerpJ es WebAssembly que se carga
con `importScripts` dentro de un Worker **clásico**, compila Java con ECJ y escribe
en un sistema de archivos respaldado por IndexedDB. Un doble en jsdom o en un
Worker de Node produciría una prueba verde que no ha ejecutado una sola línea de
Java, que es peor que no tenerla.

Así que aquí se usa el ejecutor **real** —el mismo Worker que se publica, el mismo
motor, el mismo CheerpJ del CDN—, movido por el Chromium de Playwright. Los dobles
siguen sirviendo para los contratos y viven en `tests/unit/java-runtime.test.ts`.

Y no entra en `tests/e2e/` porque `playwright.config.ts` levanta `dev:local`:
DynamoDB Local, el emulador de Firebase y la siembra del aula. Nada de eso hace
falta para saber si CheerpJ compila una clase. Lo que sí hace falta del servidor
son tres cosas, y las da un servidor de cincuenta líneas:

1. `public/runtime/` servido con soporte de rangos HTTP —CheerpJ lee el JAR de ECJ
   por trozos—;
2. una página y un Worker en el **mismo** origen;
3. un endpoint privado que cuente visitas, para poder demostrar que Java no llega
   a él.

El aislamiento es además una ventaja: si esta suite falla, el fallo es de Java y
no del aula sembrada.

## Qué comprueba

| Comprobación | Qué demuestra |
|---|---|
| `hello-world` | compila y ejecuta Java real en el navegador |
| `argv-empty-not-null` | `main` recibe un arreglo vacío, nunca `null` |
| `multi-file-package` | varios archivos con `package`, compilados juntos |
| `entrypoint-resolution` | ejecuta `app.Programa`, no `Main` ni una clase anidada |
| `compile-error` | un error de sintaxis da `failed` con diagnósticos |
| `runtime-exception` | una excepción da `failed` conservando lo ya impreso |
| `interleaving` | `A` stdout, `B` stderr, `C` stdout vuelven en ese orden |
| `reserved-namespace` | un proyecto en `io.nextudio.runtime.*` se rechaza |
| `path-traversal-rejected` | una ruta que escapa invalida el proyecto entero |
| `stale-class-isolation` | una clase de otra ejecución **no** se resuelve |
| `huge-stdout-truncated` | salida infinita truncada sin agotar memoria |
| `timeout` | `while (true)` termina el Worker |
| `run-after-timeout` | la ejecución siguiente funciona igual |
| `interrupt` | detener da `stopped` y descarta el runtime |
| `run-after-dispose` | `dispose()` deja el ejecutor reutilizable |
| `private-api-blocked` | cuatro vías de `java.net.URL` no alcanzan `/api/*` |
| `raw-socket-reaches-nothing` | un socket crudo tampoco mueve un byte |
| `allowed-runtime-resources` | la lista blanca no cierra de más |
| `unexpected-fields-ignored` | campos que el protocolo no declara no cruzan |
| `lazy-boot-no-cdn-before-first-run` | construir el ejecutor no descarga CheerpJ |
| `cheerpj-cdn-actually-used` | …y ejecutar sí, o lo anterior no valdría nada |
| `no-unexpected-origins` | ningún origen fuera de la lista blanca |

Las tres últimas las decide el ejecutor de la suite y no el guion:
`performance.getEntriesByType('resource')` de la página **no ve** lo que pide un
Worker, así que contar desde el navegador habría dado cero siempre y la prueba
habría pasado sin comprobar nada. Playwright sí ve esas peticiones; el guion marca
los hitos con `/__mark/<nombre>` y el ejecutor cruza las dos listas.

## Dos cosas que esta suite encontró

Se anotan porque las dos empezaron como pruebas que **pasaban en falso**.

**Un `fetch` bloqueado tiene que rechazar la promesa, no lanzar en síncrono.** La
capa de red de CheerpJ hace `fetch(url).then(…)`; con una excepción síncrona el
hilo de Java nunca recibía su `IOException` y el programa se colgaba hasta el
tiempo límite en lugar de ver su petición rechazada.

**Un marcador que es subcadena de otro no prueba nada.** La primera versión de la
prueba de red etiquetaba cada vía con su nombre, y `"URLConnection -> BLOQUEADO"`
es una subcadena de `"HttpURLConnection -> BLOQUEADO"`: una vía que **no** se
bloqueaba se daba por bloqueada. Ahora cada vía lleva su número, y la evidencia
que no se puede maquillar es el contador del servidor.
