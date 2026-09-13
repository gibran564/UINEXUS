# J0 — CheerpJ en Web Worker

Spike de factibilidad estrictamente aislado para N6.1. **No integra Java en producción, no modifica el contrato actual y no cambia `browserExecution: false`.**

## Recomendación

## GO WITH CHANGES

CheerpJ 4.3 permite demostrar en Chromium, con código ejecutable, los seis objetivos de J0: cargar el runtime en un Web Worker, compilar Java real en el navegador, ejecutar `main(String[])`, recuperar `stdout`/`stderr` en el orden global correcto, terminar código infinito con `Worker.terminate()` y bloquear acceso a una API privada.

No es un `GO` directo porque la solución probada no cabe sin cambios en la arquitectura actual: CheerpJ necesita un Worker clásico y recursos CDN tardíos, el compilador viable es ECJ sobre Java 8, la captura correcta necesita un wrapper Java dentro de la misma invocación y la entrada dinámica de fuentes requiere un diseño de VFS distinto al endpoint auxiliar de este spike.

## Resultado verificable

Última ejecución completa: `report.json`.

| Prueba | Resultado | Evidencia principal |
| --- | --- | --- |
| G1 — CheerpJ en Worker | PASS | `cheerpjInit({ version: 8 })`; API pública disponible; arranque observado de 0.9 s con caché caliente en la última corrida (3.8 s en la corrida anterior). |
| G2a — `javac` | PASS del sondeo | `com.sun.tools.javac.Main` no existe; salida `ClassNotFound` y exit code 1. Confirma que hace falta otro compilador. |
| G2 — compilación real | PASS | ECJ 3.13.102 ejecutado por CheerpJ; compila `Hello.java` y `CaptureHarness.java` desde `/app` hacia `/files`; exit code 0. |
| G3 — `main` + streams | PASS | `Hello.main(String[])` recibe `a1`, `b2`; wrapper Java devuelve eventos etiquetados con secuencia global `1, 15, 33, 47, 60`; separación y orden pasan. |
| G4 — timeout | PASS | `Endless.main` no responde; el host llama `Worker.terminate()` a los 15,007 ms; un Worker nuevo arranca correctamente. |
| G5 — firewall | PASS | Sin parche: 1 hit privado y `NET_GOT_HTTP_200`. Con parche: 0 hits adicionales y `NET_BLOCKED java.io.IOException: Network Error`. |

El ejecutor termina con:

```text
J0 PASS — todos los objetivos tienen evidencia ejecutable.
```

## Cómo reproducir

Requisitos:

- Node y dependencias del repositorio instaladas.
- Chromium de Playwright disponible.
- Acceso de red a Maven Central sólo para descargar ECJ cuando falte.
- Acceso del navegador a `https://cjrtnc.leaningtech.com/4.3/` durante la prueba.

Desde la raíz del repositorio:

```powershell
node spikes/j0-cheerpj/fetch-ecj.mjs
node spikes/j0-cheerpj/run-spike.mjs
```

`fetch-ecj.mjs` fija ECJ `3.13.102`. El JAR probado tiene SHA-256 completo:

```text
e6b938338b7bb12388ca32ba8dfe91c6ab1c56bf5bd8dab6d6e6265fec3b9be3
```

`run-spike.mjs`:

1. elimina `assets/gen/` de una corrida anterior;
2. levanta un servidor aislado en `127.0.0.1:8787` con soporte HTTP Range;
3. materializa únicamente las fuentes constantes de prueba;
4. ejecuta Chromium headless;
5. escribe `report.json` y sale con código distinto de cero si falta o falla un objetivo.

## Qué se demostró

### 1. CheerpJ carga dentro de un Web Worker

La distribución 4.3 se carga desde:

```js
self.importScripts('https://cjrtnc.leaningtech.com/4.3/loader.js');
await self.cheerpjInit({ version: 8 });
```

La prueba usa un **Worker clásico**. Chromium rechaza `importScripts()` dentro de un Worker `{ type: 'module' }`, mientras que `loader.js` es un script clásico que después carga el runtime de CheerpJ.

No debe definirse `self.cj3LoaderPath` antes de importar `loader.js`: la versión inspeccionada envuelve su inicialización en `if (!self.cj3LoaderPath)` y, por tanto, predefinirla anula el loader.

### 2. Java real se compila dentro del navegador

El JRE no incluye `com.sun.tools.javac.Main`. La ruta que funciona es:

- CheerpJ Java 8;
- ECJ 3.13.102;
- `-source 8 -target 8`;
- `-bootclasspath /lt/8/jre/lib/rt.jar`;
- fuente servida en `/app/assets/gen/<id>/`;
- clases generadas en `/files/j0/<id>/classes`.

La llamada relevante es:

```js
await cheerpjRunMain(
  'org.eclipse.jdt.internal.compiler.batch.Main',
  '/app/assets/ecj.jar',
  '-proc:none',
  '-nowarn',
  '-source', '8',
  '-target', '8',
  '-encoding', 'UTF-8',
  '-bootclasspath', '/lt/8/jre/lib/rt.jar',
  '-d', outputDir,
  ...sourcePaths
);
```

ECJ 3.33.0 con Java 17 no funcionó: intenta construir un `JrtFileSystem` desde una imagen modular completa y CheerpJ no expone el layout JDK que espera. La ruta Java 8 + `rt.jar` sí compila y ejecuta.

### 3. `main(String[])` y argumentos funcionan

`Hello.main` recibe `['a1', 'b2']`, finaliza con exit code 0 y produce:

```text
stdout  hello-from-j0
stderr  j0-warn-on-stderr
stdout  argv=[a1, b2]
stderr  j0-error-two
stdout  j0-done
```

### 4. Captura correcta de stdout/stderr y orden total

CheerpJ entrega tanto `System.out` como `System.err` por `console.log`. Parchear `console.log`/`console.error` conserva el orden observado, pero **no** la identidad del stream. Tampoco funcionó cambiar `java.lang.System` desde un contexto creado con `cheerpjRunLibrary()` y luego lanzar otro contexto con `cheerpjRunMain()`.

La solución demostrada compila junto al programa un `CaptureHarness` Java que:

1. guarda los `PrintStream` originales;
2. instala dos `PrintStream` etiquetados;
3. comparte un recorder sincronizado y una única secuencia byte a byte;
4. invoca el `main` objetivo por reflexión dentro de la misma ejecución JVM;
5. restaura los streams;
6. emite al stream original un ledger codificado con canal, byte y secuencia.

El Worker decodifica ese ledger como eventos `{ seq, channel, text }`. La última corrida recuperó:

```json
[
  { "seq": 1,  "channel": "stdout", "text": "hello-from-j0\n" },
  { "seq": 15, "channel": "stderr", "text": "j0-warn-on-stderr\n" },
  { "seq": 33, "channel": "stdout", "text": "argv=[a1, b2]\n" },
  { "seq": 47, "channel": "stderr", "text": "j0-error-two\n" },
  { "seq": 60, "channel": "stdout", "text": "j0-done\n" }
]
```

Esto satisface stream identity y orden global para escrituras que atraviesan `System.out`/`System.err`. La unidad de orden probada es el byte UTF-8; segmentos contiguos del mismo canal se agrupan al decodificar.

### 5. `Worker.terminate()` detiene código descontrolado

`Endless` ejecuta un bucle infinito. Tras 15 segundos el host termina el Worker; no llega respuesta Java. A continuación crea otro Worker y CheerpJ vuelve a inicializarse. Es el mismo mecanismo conceptual que usa `BrowserCodeRunner.destroyWorker()` para un timeout.

La terminación es abrupta: no ejecuta `finally`, no entrega salida que permanezca bufferizada y descarta todo el runtime del Worker. El siguiente run debe usar un Worker limpio.

### 6. La red Java se puede bloquear en el límite JS del Worker

El control sin firewall alcanzó `/api/private/hit`: el contador aumentó en 1 y Java observó HTTP 200. Con el parche aplicado después de `cheerpjInit()`, el contador no aumentó y Java recibió `java.io.IOException: Network Error`.

La prueba intercepta:

- `fetch`;
- `XMLHttpRequest`;
- `WebSocket`;
- `EventSource`;
- llamadas tardías a `importScripts`.

Esto demuestra que `HttpURLConnection` de mismo origen atraviesa una superficie de red del navegador que puede cerrarse desde el Worker.

## Blockers y cambios obligatorios antes de producción

### B1 — Worker clásico en lugar del contrato ESM actual

**Bloquea integración directa.** `BrowserCodeRunner` crea siempre Workers `{ type: 'module' }` y el build actual produce ESM. CheerpJ 4.3 requiere el loader clásico en el enfoque probado.

Cambio necesario: crear una factoría/bundle clásico (por ejemplo IIFE) exclusivamente para Java o conseguir de Leaning Technologies una ruta ESM oficialmente soportada. No relajar el requisito de Workers módulo para Python/R ni reemplazar sus factories.

### B2 — Allowlist de recursos CheerpJ tardíos

**Bloquea reutilizar el firewall actual sin cambios.** La política de producción sólo permite mismo origen bajo `/runtime/`. Después de preparar CheerpJ, Java solicita recursos tardíos desde el CDN. La corrida observó que la réplica del firewall bloqueó al menos:

- `https://cjrtnc.leaningtech.com/4.3/etc/localtime`;
- `https://cjrtnc.leaningtech.com/4.3/8/lib/ext/index.list`;
- `https://cjrtnc.leaningtech.com/4.3/8/jre/lib/rt.jar`.

La ejecución simple siguió adelante por caché/estado ya cargado, pero no es una base robusta.

Cambio necesario: una allowlist versionada y mínima para los recursos runtime exactos de CheerpJ, diferenciada de las URLs que abre el programa Java. Debe seguir denegando todo same-origin fuera de runtime, incluida `/api/*`, y toda red arbitraria. También debe cubrir APIs de transporte alternativas y revisarse contra Tailscale/WebSocket de CheerpJ.

### B3 — Licencia y hosting

**Bloquea una decisión de producción, no la factibilidad técnica.** La documentación de CheerpJ indica que Community Edition se sirve desde `cjrtnc.leaningtech.com`; autoalojar el runtime requiere licencia comercial. El uso empresarial también requiere revisar la licencia aplicable. Nextudio no puede asumir sin validación legal el mismo modelo self-hosted de Pyodide/webR.

Cambio necesario: decidir y documentar una de estas rutas antes de N6.1:

- licencia comercial y runtime autoalojado/versionado; o
- CDN oficial con términos aprobados, CSP/connect-src explícito y disponibilidad externa aceptada.

### B4 — Compilador/lenguaje probado: Java 8

**Limita alcance.** La ruta reproducible es ECJ 3.13.102 + Java 8. Java 17 + ECJ moderno falló por el layout modular/JRT. ECJ además emitió mensajes `JIT failure - please report a bug` en `Parser.consumeRule(I)V`, aunque terminó con 0 y produjo clases válidas.

Cambio necesario: si N6.1 exige Java posterior a 8, abrir una investigación separada con una combinación compilador/JRE soportada o escalar la incompatibilidad a Leaning Technologies. Para un primer MVP, declarar explícitamente Java 8 y medir compilaciones más grandes antes de comprometer soporte.

### B5 — Ingreso dinámico de archivos

**El endpoint de J0 no es diseño de producción.** `/__j0_materialize` escribe la fuente en el servidor para que CheerpJ la lea desde `/app`; sólo existe como scaffolding aislado. La documentación actual ofrece `/str/` y `cheerpOSAddStringFile`, pero esa función no apareció como global en el `loader.js` exacto inspeccionado durante la prueba.

Cambio necesario: verificar con el proveedor la API disponible para 4.3, fijar una versión que exponga una entrada JS→VFS soportada, o implementar otra transferencia enteramente local. Nunca enviar código del usuario a un endpoint privado para fingir ejecución browser-only.

### B6 — Wrapper de captura como parte confiable del runtime

**Cambio necesario.** La captura correcta no sale de una opción pública de `cheerpjInit`; depende del `CaptureHarness` dentro de la misma invocación.

Antes de producción:

- compilar o empaquetar el harness como recurso runtime confiable, no como archivo editable del proyecto del usuario;
- evitar colisiones de nombre/classpath;
- definir cómo propagar excepción/exit code sin perder el ledger;
- soportar output binario/UTF-8 inválido y escrituras concurrentes;
- imponer el límite de salida mientras se registra, no sólo al final;
- probar `System.setOut`, procesos/hilos tardíos y programas que retienen referencias a los streams;
- impedir que código no confiable falsifique el prefijo de control o acceda al recorder.

### B7 — Coste y persistencia

El JAR de ECJ ronda 2.7 MB, además del runtime CheerpJ y recursos Java bajo demanda. `/files` es persistente, por lo que cada proyecto/run necesita namespace y limpieza explícita. La última corrida observó aproximadamente 4–5.3 s para compilaciones pequeñas; el arranque varió entre frío y caché.

Cambio necesario: presupuestos de descarga/boot/compile, limpieza de VFS, cuotas, aislamiento entre runs y telemetría antes de marcar capacidad browser.

### B8 — Matriz de seguridad y navegadores incompleta

J0 usa Chromium headless en loopback. No prueba Firefox, Safari, CSP desplegada, COOP/COEP, service workers, redirects, DNS rebinding, Tailscale, sockets, applets, Swing/AWT, multihilo intensivo ni evasiones adversariales del wrapper/firewall.

Cambio necesario: threat model y pruebas negativas en navegadores soportados antes de producción. La seguridad no debe depender sólo de CORS o del código Java cooperativo.

## Hallazgos de arquitectura del repositorio

Sin modificar producción, la auditoría encontró cuatro puntos de integración futuros:

1. `src/lib/browser-code-runner.ts` — lifecycle y timeout ya encajan conceptualmente, pero su factory ESM no.
2. `src/lib/code-engines/worker-bridge.ts` — aplicar firewall tras `prepare()` es correcto, pero su allowlist actual no admite el CDN/runtime tardío.
3. `src/lib/code-engines/engine-contract.ts` — el flujo batch `prepare/run/reset/dispose` alcanza para este caso CLI; GUI/interactive requeriría otro contrato.
4. `src/lib/browser-code-runner-protocol.ts` y `src/lib/code-runner-contract.ts` — Java debe permanecer fuera de `BrowserRuntimeLanguage`/`BROWSER_RUNTIME_LANGUAGES` hasta resolver B1–B8 y añadir pruebas de frontera.

También deben actualizarse, sólo en una fase posterior aprobada, el bundling de Workers, CSP/CloudFront y las pruebas que hoy exigen Workers módulo y bloquean runtimes CDN no listados.

## Criterio para pasar de J0 a N6.1

Autorizar diseño/implementación de N6.1 únicamente si se aceptan estos guardrails:

- Java 8 como alcance inicial o un spike separado para una versión superior;
- decisión de licencia/hosting cerrada;
- Worker clásico aislado sólo para Java;
- allowlist CheerpJ exacta más denegación de APIs privadas;
- transferencia de fuentes completamente browser-local;
- capture harness endurecido, con output cap y errores definidos;
- matriz de seguridad y compatibilidad adicional;
- Java sigue en `browserExecution: false` hasta que todo lo anterior tenga pruebas automatizadas.

## Referencias oficiales

- [Getting started / carga de CheerpJ 4.3](https://cheerpj.com/docs/getting-started/Java-app)
- [`cheerpjInit`](https://cheerpj.com/docs/reference/cheerpjInit)
- [`cheerpjRunMain`](https://cheerpj.com/docs/reference/cheerpjRunMain)
- [`cjFileBlob`](https://cheerpj.com/docs/reference/cjFileBlob)
- [`cheerpOSAddStringFile`](https://cheerpj.com/docs/reference/cheerpOSAddStringFile)
- [Filesystem](https://cheerpj.com/docs/guides/filesystem)
- [Networking](https://cheerpj.com/docs/guides/Networking)
- [Licensing](https://cheerpj.com/docs/licensing)
