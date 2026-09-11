# NexBook

El formato de documento computacional de UINexus. Combina explicación, código
ejecutable y resultados en un documento que sirve como laboratorio, práctica,
entrega académica o —más adelante— publicación.

Se edita en **UINexus Studio**.

---

## Qué es, y qué no

**Es** una entidad de primera clase con contexto, permisos y versión. Un solo
tipo, `NexBook`, no cuatro incompatibles: no existen `PersonalNexBook`,
`TeacherNexBook` ni `SubmittedNexBook`. Lo que cambia entre casos es su
`context`, su `visibility` y de quién es.

**No es** un Jupyter Notebook con otro nombre. Tres diferencias que están en el
modelo, no en el discurso:

1. **Un output no es un bloque.** Una gráfica que produce el código del
   alumnado no se convierte en un bloque editable. Los bloques son lo que
   alguien escribió; los outputs son lo que la máquina contestó. Confundirlos
   hace imposible saber, al revisar, qué escribió el estudiante.
2. **Una entrega es inmutable.** Entregar no apunta al documento vivo: crea una
   copia congelada. Seguir trabajando después no cambia lo que se califica.
3. **Una plantilla y una copia son distintas.** La docente edita una plantilla;
   cada estudiante recibe su propia copia.

**No sustituye a Workflow.** Son cosas diferentes:

```
Workflow   qué debe hacer el estudiante
NexBook    dónde puede construir una solución compleja
```

Una actividad que sólo pide veinte líneas de Python sigue usando el entregable
`code`. NexBook es una opción más, no el nuevo camino único.

---

## Bloques

Hay cuatro, y sólo se declaran los que alguna pantalla sabe pintar:

| Bloque | Qué hace | Desde |
| --- | --- | --- |
| `markdown` | Explicación. Se alterna entre editar y ver renderizado. | V1 |
| `code` | Código en cualquier lenguaje del catálogo. | V1 |
| `image` | Una imagen del documento, con alt y pie. Los bytes van a S3. | it. 9 |
| `spreadsheet` | Una hoja con datos y fórmulas. | it. 9 |

El **lenguaje es una propiedad del bloque**, no un tipo de bloque: no hay
`PythonBlock` ni `RBlock`, por la misma razón que no hay `REditor`. Un documento
puede mezclar lenguajes y cada bloque elige el suyo.

`ChartBlock` y `AIBlock` **siguen sin estar declarados**. Añadir un miembro a una
unión discriminada por `type` no rompe los existentes, así que declararlos antes
de que alguna pantalla sepa pintarlos sólo serviría para producir documentos que
nadie puede abrir. `image` y `spreadsheet` entraron en la iteración 9 *con* su
renderizador, su persistencia y su exportación, que es la condición.

### Markdown y seguridad

Se renderiza con `MarkdownContent`, que **no interpreta HTML crudo** (`skipHtml`,
sin `rehype-raw`) y pasa las URLs por una lista blanca HTTP(S). Un documento que
una docente reparte a treinta personas no puede ejecutar el JavaScript de quien
lo escribió. No se usa `dangerouslySetInnerHTML` en ninguna parte.

### Bloques bloqueados

`editableByStudent: false` viene de una plantilla docente. El bloque **se ve y
se puede ejecutar, pero no editar**. Es el caso que justifica que el campo
exista: «# Instrucciones» sí se bloquea, «# Escribe tu conclusión» no.

Ausente significa `true`: los bloques de un laboratorio personal son todos
suyos.

---

## Outputs

```ts
type NexBookOutput =
  | { seq; stream: 'stdout' | 'stderr' | 'error'; text; truncated? }
  | { seq; stream: 'table';  columns; rows; totalRows; truncated? }
  | { seq; stream: 'image';  assetId; mimeType; width?; height?; alt? }
  | { seq; stream: 'json';   value; truncated? }
```

Viven en `document.results`, **indexados por `blockId` y fuera de los bloques**.
Eso permite borrar la salida sin tocar el código, evita que un output enorme
infle el bloque, y deja que la copia de una entrega lleve el código con o sin
resultados.

Los tipos ricos llegaron como **valores nuevos de `stream`**, que es exactamente
lo que V1 anticipó. La consecuencia práctica importa: un documento de la
iteración 8 —sólo `stdout`, `stderr` y `error`— sigue validando sin tocar un
byte, así que **`NEXBOOK_FORMAT_VERSION` sigue siendo 1** y no hay migración. Un
discriminante nuevo habría obligado a reescribir cada `results` almacenado, cada
snapshot de entrega y cada exportación a cambio de un nombre más bonito.

### Orden: resuelto en la iteración 9

Hasta la 8 el motor devolvía dos cadenas y el orden entre ellas se reconstruía al
pintarlas: primero todo stdout, luego stderr. Se documentó como pendiente de
«rediseñar los runtimes».

No hacía falta rediseñar nada. La información ya estaba ahí y se tiraba:

- **Pyodide** llama a `stdout` y `stderr` según el programa escribe.
- **`captureR`** devuelve un array YA ordenado.

Lo único que faltaba era un acumulador que respetara la secuencia en vez de
separarla en dos montones (`code-engines/output-recorder.ts`). Las dos cadenas
planas siguen existiendo —el ejecutor aislado de las actividades trabaja con
ellas— y salen del mismo registro, así que no pueden contradecirse.

Comprobado en el navegador: `print("primero")`, `sys.stderr.write("aviso")`,
`print("tercero")` se leen **en ese orden**.

### Limpiar salidas

Cada celda tiene «Limpiar salida» y la barra tiene «Limpiar salidas». Borrar una
salida **nunca** toca el código. Es además la herramienta contra el presupuesto
de 300 KB: en la verificación, limpiar las salidas de un documento con una tabla
y dos gráficas lo dejó en 1 289 bytes desde 3 455.

### Se persisten, acotados

Los outputs **se guardan** con el documento: reabrirlo y no ver lo que dio la
última ejecución obligaría a volver a ejecutarlo todo, y con un kernel que
arranca en segundos eso es una espera gratuita. El precio es espacio, y por eso
hay un tope por celda (`maxOutputChars`) además del presupuesto del documento.

---

## Kernels: `CodeRunner` frente a `NotebookKernel`

```
CodeRunner       una ejecución AISLADA. Cada run empieza con el estado limpio.
                 Es lo correcto para un paso de actividad: lo que se entrega
                 tiene que funcionar por sí solo.

NotebookKernel   una SESIÓN. `x = 10` en una celda se ve en la siguiente.
                 Es lo que hace que un NexBook sea un documento y no una lista
                 de programas sueltos.
```

**No son dos motores.** `NotebookKernel` envuelve al mismo `BrowserCodeRunner`,
que habla con el mismo Worker, que sirve al mismo Pyodide. Lo único que cambia es
el `mode` del mensaje (`isolated` / `session`). Duplicar el runner habría
significado dos Pyodide en memoria para la misma pestaña.

```
NexBookStudio
   └── NotebookKernel            un kernel POR LENGUAJE, perezoso
         └── BrowserCodeRunner   mode: 'session'
               └── Worker (módulo ESM)
                     └── worker-bridge → python-engine | r-engine
```

### Cómo conserva el estado

**Python.** Se ejecuta siempre contra `__main__`, el espacio de nombres real, y
el modo aislado lo **vacía antes y después** de cada ejecución. La alternativa
—pasar un diccionario propio como `globals`— deja el aislamiento en manos de un
detalle interno de Pyodide que este proyecto no puede comprobar; vaciar el
espacio es observable desde Python (`globals()` se puede listar) y queda
simétrico con R.

**R.** Es el caso contrario: `captureR` ya evalúa en el entorno global, así que
el estado persiste por sí solo. Lo que hace falta es lo inverso, y el modo
aislado hace `rm(list = ls(all.names = TRUE))` antes de ejecutar. Con
`all.names` porque sin él quedarían vivos los objetos que empiezan por punto,
que `ls()` esconde.

El estado vive **dentro del Worker**, no en un `useState`: una sesión que se
perdiera al re-renderizar un componente no sería una sesión.

### Un kernel por lenguaje, y perezoso

Un documento con celdas de Python y de R **no arranca los dos runtimes al
abrirse**. Arranca el que haga falta cuando se ejecuta la primera celda de ese
lenguaje. Son 13 MB y 46 MB de WebAssembly; cargarlos «por si acaso» no es
aceptable en la red de un aula. Al salir del documento se liberan los dos.

### Reiniciar, interrumpir y el tiempo límite

| Acción | Qué hace | Coste |
| --- | --- | --- |
| Reiniciar | Vacía el espacio de nombres | milisegundos |
| Interrumpir | Termina el Worker | el siguiente run rearranca el runtime |
| Tiempo excedido (10 s) | Termina el Worker | igual, **y la sesión se pierde** |

Un notebook persistente **no** significa `while True` sin límites. Los límites
de ejecución son los mismos de siempre.

Lo importante: **tras un tiempo excedido la sesión está muerta y se dice**. El
kernel pasa a `lost` y la interfaz avisa de que las variables anteriores se
perdieron. Fingir que la sesión sobrevivió haría que la celda siguiente fallara
con un `NameError` que nadie sabría explicar.

### Lenguajes que no se ejecutan

Java, C, C++, HTML, CSS y SQL se **editan** en un CodeBlock, con su resaltado. El
bloque no pinta un botón de ejecutar: muestra «Ejecución no disponible». Misma
política que en el editor de actividades.

---

## Persistencia

### Una tabla, dos formas

Los NexBooks comparten `uinexus-workspaces` con las prácticas de un solo archivo,
discriminados por `kind`. El argumento **no** es evitar una migración: la
pantalla de Prácticas tiene que enseñar los dos en una sola lista ordenada por
fecha. Con una tabla eso es una `Query`; con dos son dos consultas que hay que
fusionar y reordenar en memoria, y entonces la paginación deja de ser correcta.

Los patrones de acceso son idénticos y el ciclo de vida también.

### Un item, y por qué

El documento entero va en **un item de DynamoDB**, porque es lo que permite
exigir «guarda sólo si la revisión sigue siendo la que yo creía» con una
escritura condicional. Si los bloques vivieran en S3 haría falta inventar un
segundo mecanismo de bloqueo.

El límite duro de un item es 400 KB. De ahí los topes:

| Límite | Valor |
| --- | --- |
| Bloques por documento | 100 |
| Código por bloque | 60 000 caracteres |
| Markdown por bloque | 40 000 caracteres |
| Salida guardada por celda | 8 000 caracteres |
| **Documento completo** | **300 000 bytes** |

El último es el que de verdad protege el item: cien bloques de 40 KB pasan cada
uno su límite individual y suman cuatro megas. Se mide sobre el **JSON ya
serializado en UTF-8**, que es lo único que se corresponde con lo que DynamoDB va
a medir; sumar longitudes de campos daría un número parecido y equivocado.

Todos viven en `NEXBOOK_LIMITS`.

### Concurrencia optimista

Cada guardado manda la `revision` que el cliente cree tener, y la escritura lleva
`ConditionExpression: ownerUid = :owner AND revision = :expected`.

- Coincide → se escribe y `revision` avanza.
- No coincide y el documento existe → **409** con el documento que ganó dentro,
  para que la interfaz pueda decir qué pasó.
- No existe o no es tuyo → **404**.

Tras un conflicto el editor **deja de guardar**. No se intenta fusionar:
combinar dos versiones por bloques exige decidir qué hacer con un mismo bloque
editado en los dos sitios, y cualquier respuesta automática pierde trabajo de
alguien.

### Autoguardado

800 ms tras la última pulsación, igual que el resto de UINexus. Estados:
`Guardando…`, `Guardado`, `Error al guardar`, `Guardado detenido`. **Un error de
guardado nunca se oculta.**

---

## Ciclo de vida dentro de Workflow

```
Docente abre el paso          →  se crea la PLANTILLA (id determinista por paso)
Docente edita la plantilla    →  Markdown, CodeBlocks, bloques bloqueados

Estudiante abre el paso       →  se crea SU COPIA a partir de la plantilla
                                 (id determinista por actividad+paso+uid)
Estudiante trabaja            →  autoguardado en su copia
Estudiante entrega            →  SNAPSHOT congelado en la evidencia del paso

Docente abre la entrega       →  ve el snapshot, en sólo lectura, ejecutable
```

`GET /api/assignments/:id/steps/:stepId/nexbook` devuelve **la plantilla o la
copia según el rol**. Misma URL porque la pregunta es la misma —«¿en qué
documento trabajo yo?»— y la respuesta la decide el rol, que el servidor ya
conoce.

### Instanciación perezosa

La copia se crea la **primera vez** que alguien abre el paso, no al publicar.
Publicar para trescientas personas no puede costar trescientas escrituras de un
documento que quizá nadie abra.

Los ids son deterministas (hash de `actividad:paso[:uid]`), así que «una copia
por persona y paso» es aritmética y no una consulta previa más una escritura, que
es donde se cuelan los duplicados. La creación usa
`attribute_not_exists(id)`: si dos pestañas abren el paso a la vez, la segunda
lee la que ganó en lugar de sobrescribirla con un documento vacío.

El id es un **hash y no una concatenación** porque viaja en la URL: pegar el UID
de Firebase ahí sería la fuga que el resto del proyecto evita.

### Qué hereda la copia

Los **bloques**, incluida su marca de bloqueado. **No los resultados**: una
salida de la docente en la copia de alguien haría parecer ejecutado un código que
esa persona no ha ejecutado.

### Snapshots

```ts
interface NexBookSubmissionData {
  nexbookId: string;   // de dónde salió, no qué leer
  revision: number;    // de qué versión
  title: string;       // el de entonces
  snapshot: NexBookDocument;  // la COPIA
  submittedAt: string;
}
```

`nexbookId` se conserva para poder decir «esto salió de aquel documento», no para
leerlo: en cuanto se toca el original, esa revisión ya no existe allí.

**La docente no puede abrir el documento vivo del estudiante** —es privado, y da
404—. Lee el snapshot, que es exactamente lo que se entregó.

### Reentrega

El modelo la admite: cada entrega escribe su propio snapshot con su `revision` y
su `submittedAt`. Hoy la evidencia del paso guarda **la última**; conservar el
historial completo es añadir una lista, no cambiar el esquema. No se construyó la
interfaz de historial en V1.

---

## Visibilidad y publicación

```
private   el documento vivo. Siempre, y para todos.
class     publicado; hace falta identidad institucional
link      publicado; quien tenga la direccion
public    publicado; cualquiera
```

### Publicar CONGELA

Publicar no es cambiar un interruptor sobre el documento vivo: crea un registro
aparte con una **copia** del documento.

```
NexBook vivo  --Publicar-->  NexBookPublication (inmutable)
     |                                   ^
     +--------Actualizar publicacion-----+
```

Con un interruptor, cada pulsación de teclado se habría publicado: un
experimento a medias o una nota personal quedan expuestos sin que nadie lo
decida. Así el autor sigue trabajando y lo publicado no se mueve hasta que lo
diga; la interfaz avisa de que «hay cambios sin publicar» en vez de publicarlos
sola.

Retirar la publicación **no borra** el documento.

### `link` no es «más privado» que `public`

Los dos se sirven igual. Lo que los distingue es si la dirección se anuncia, no
quién puede leer: el slug es un hash de 24 caracteres, no adivinable. Decir que
`link` protege más sería prometer algo que no existe, y esa promesa es la que
lleva a poner ahí lo que no debería estar.

### Una entrega no se publica

El servidor lo rechaza: sólo se publica un NexBook de contexto `personal`. El
documento de un paso puede llevar las instrucciones internas de la materia, los
datos que repartió el profesorado o la retroalimentación recibida.

El camino que sí existe es **«Copiar a mis prácticas»**, en la barra del NexBook
de la actividad:

```
NexBook de la actividad --copia--> NexBook personal --publicar--> publico
```

La entrega no se toca. Es la separación entre **evidencia académica** y
**portafolio**. Las imágenes no se duplican: sus bytes cuelgan de la persona, no
del documento.

### La vista pública no arranca runtimes

`/nexbook/:slug` usa `NexBookReader`, que **no** es Studio con `editable: false`:
no importa el kernel ni Monaco. Abrir un enlace no puede costar 13 MB de Pyodide
ni 46 MB de webR. En el build son 167 kB frente a los 232 kB de Studio.

Se enseñan los resultados que el autor guardó, con su duración. No hay botón de
ejecutar, y no es un olvido.

---

## El formato `.nexbook`

**Implementado en la iteración 9.** La descripción completa —estructura,
reescritura de referencias, lista blanca de exportación y defensas de la
importación— está más abajo, en la sección de la iteración 9.

`formatVersion` existe **desde V1** y viaja en cada documento guardado
(`NEXBOOK_FORMAT_VERSION`). Nunca se confía en que el formato no cambiará.

Un `.nexbook` **nunca** debe contener API keys, cookies, tokens, credenciales de
AWS o Firebase, credenciales de IA, URLs firmadas ni identificadores privados.
Esa garantía ya no es una intención: la aplica `publishableDocument`, que
reconstruye el documento campo a campo, y está probada.

---

## Extensiones futuras, y cómo encajan

| Pieza | Estado | Cómo entró, o cómo entrará |
| --- | --- | --- |
| `ImageBlock` | **Hecho** (it. 9) | Un miembro más de la unión. Sigue siendo **distinto** de `ImageOutput`: una imagen insertada a mano y una generada por código no son lo mismo, y una salida NO se convierte sola en bloque. |
| Outputs ricos | **Hecho** (it. 9) | Valores nuevos de `stream`, sin subir la versión del formato. |
| `SpreadsheetBlock` | **Hecho** (it. 9) | Un miembro más, con `SpreadsheetBridge` en medio para no acoplar los kernels a la implementación de la hoja. |
| `ChartBlock` | Previsto | Una gráfica generada por código se persiste hoy como `ImageOutput`. Un `ChartBlock` sobre datos estructurados es otra cosa y necesita su propio editor. |
| `AIBlock` | Previsto | Un miembro más. La credencial vive **fuera** del documento, siempre. |
| Project Workspace | Previsto | Otro `kind` de workspace. NexBook **no** debe convertirse en un IDE multiarchivo. |

---

## Lo que NO hace (tras la iteración 9)

- **Sin `AIBlock`.** Diseñado, no declarado. Ver más abajo.
- **Sin `ChartBlock`.** Una gráfica generada por código se guarda como imagen.
- **Sin entrada estándar.** `input()` y `readline()` no tienen de dónde leer.
- **Sin `.ipynb`, `.qmd` ni PDF.** `.nexbook` sí está implementado.
- **Sin historial de reentregas en la interfaz.** El esquema lo admite.
- **Sin colaboración en tiempo real.** Un 409 avisa; no se fusiona.
- **Sin arrastrar y soltar bloques**: se mueven con botones, que además funcionan
  con el teclado. Duplicar sí se añadió.
- **Sin puente hoja ↔ Python/R.** La abstracción existe; la conexión no.
- **Sin recolección de assets huérfanos.** Ver docs/LIMITATIONS.md.

---

# Iteración 9 — documento computacional modular

Lo que cambió: un NexBook ya no es sólo Markdown y código. Produce tablas y
gráficas, contiene imágenes y hojas de cálculo, se publica y se intercambia.

---

## Salidas ricas: el recorrido completo

```
Worker                     Kernel                    Studio
──────                     ──────                    ──────
motor emite en orden  ──▶  traduce al modelo   ──▶   pinta por tipo
  texto / tabla / PNG        del documento            <pre> / <table> / <img>
                                  │
                                  └─ imágenes aparte ─▶ sube a S3, guarda assetId
```

El kernel **no habla con la red**. Es el ejecutor de un documento, no su capa de
persistencia, y no sabe a qué NexBook pertenece la celda. Por eso los bytes de
una gráfica salen en `KernelCellRun.images`, separados del resultado, y es Studio
quien los convierte en assets.

Ese reparto tiene una consecuencia visible: la gráfica **aparece en cuanto
termina de ejecutarse**, pintada con los bytes que están en memoria, y el
`assetId` se rellena cuando la subida acaba. Esperar a la red para pintar habría
hecho que «ejecutar una celda» durara lo que durara la conexión del aula.

### Python

| Qué | Cómo |
| --- | --- |
| Tablas | Se inspecciona el valor de la última expresión **desde Python**, no desde JS |
| Gráficas | `matplotlib` con backend `AGG`; las figuras se guardan como PNG y se cierran |
| Paquetes | `numpy`, `pandas`, `matplotlib`, por lista blanca |

La detección de tablas es **por pato**: DataFrame de pandas o polars, Series,
lista de diccionarios, lista de listas, diccionario de listas. Lo importante es
que **una tabla rica no exige pandas**: `[{"ciudad": "Durango", "hab": 654876}]`
—lo que devuelve un `csv.DictReader`— ya produce una tabla.

No se usa el HTML que sabe generar pandas. Renderizar marcado producido por el
código del alumnado es justo lo que `MarkdownContent` lleva todo el proyecto
evitando; se extraen columnas y filas, y quien las pinta es UINexus.

Las figuras **se cierran** tras leerlas. Sin eso, en una sesión persistente cada
celda volvería a emitir las figuras abiertas y cinco celdas darían quince
imágenes.

### Los paquetes de Python no son `pip install`

La lista está en `python-packages.ts`, en el código. `micropip` sigue sin
instalarse y `pip` sigue sin existir dentro del intérprete.

Y **no es acceso a la red**: las ruedas se sirven desde `/runtime/pyodide/`, el
propio origen. Las publica `scripts/vendor-python-packages.mjs`, que las descarga
**una vez, al preparar el despliegue** y verifica cada una contra el `sha256` del
`pyodide-lock.json` instalado. Lo que se confía es el lockfile del repositorio,
no la CDN: si devolviera un archivo distinto, el hash no cuadra y el script para
en seco.

```bash
npm run runtimes:python   # 13 ruedas, ~16.6 MB, verificadas
```

Es **opcional a propósito**: `npm run build` sin red tiene que seguir
funcionando. Sin ruedas, UINexus funciona igual y `import pandas` falla con un
error explicado en vez de a medias.

El `pyodide-lock.json` que se publica va **recortado** a las ruedas presentes. Si
se copiara el original, `loadPackage` aceptaría cualquiera de sus 356 paquetes y
fallaría con un 404 confuso: es la misma lista blanca dicha en el idioma del
runtime.

### El endurecimiento del Worker tuvo que cambiar

Hasta la iteración 8, tras arrancar el runtime se sustituía `fetch` por una
función que siempre lanzaba. Era correcto mientras no quedara ninguna descarga
legítima pendiente, y dejó de serlo con los paquetes: `loadPackage` trae la rueda
**durante** una ejecución, porque cuál hace falta depende del código de la celda.

Se vio en el navegador —y **sólo** ahí, porque las pruebas del motor no pasan por
el endurecimiento—: «El acceso de red está deshabilitado» en mitad de un
`import matplotlib`.

La regla pasó de «este Worker no puede pedir nada» a «este Worker sólo puede
pedir SUS PROPIOS assets»:

```
✓  /runtime/pyodide/pandas-3.0.2-….whl    mismo origen, prefijo del runtime
✗  https://ejemplo.mx/robar               otro origen
✗  /api/nexbooks/abc                      mismo origen, fuera del prefijo
```

`XMLHttpRequest`, `WebSocket`, `EventSource` e `importScripts` siguen
desapareciendo enteros. La garantía que importa se conserva: no hay forma de
sacar datos ni de alcanzar la API.

### R

`webR` trae su propio dispositivo gráfico de canvas: `plot()` no necesita ningún
paquete extra. Estaba apagado (`captureGraphics: false`) porque hasta la
iteración 8 la salida era una consola de texto y una figura no tenía dónde ir.

El `ImageBitmap` que devuelve webR se convierte a PNG con `OffscreenCanvas`, que
es la forma de hacerlo **dentro de un Worker**, donde no hay `document`. Es la
misma familia de APIs que este motor ya exigía (Workers anidados, Safari 16.4),
así que no baja el mínimo de navegador.

Un `data.frame` se reconoce por su atributo `row.names` —una matriz usa `dim`— y
se convierte con `toD3()`. **No se re-evalúa el fuente**: el valor es el que
devolvió `captureR`, así que un `write.csv(...)` no ocurre dos veces.

---

## Assets

Los binarios **no viven dentro del documento**. Una gráfica de 30 KB en Base64
son 40 KB de los 300 KB del item: tres gráficas y el documento deja de poder
guardarse.

```
nexbook/<ownerUid>/<assetId>.<ext>      bucket PRIVADO
```

### Por qué la clave no lleva el id del NexBook

Porque un asset sobrevive a copias. El documento se duplica al menos en tres
sitios —publicar, entregar, «copiar a mis prácticas»— y si la clave llevara el id
del documento, cada copia apuntaría a un objeto inexistente bajo su propio
prefijo. Habría que duplicar los bytes, y publicar un documento con diez imágenes
serían cuarenta megas copiados en S3.

Colgar de la **persona** conserva lo que importa: la clave la construye el
servidor con el uid del token, así que la propiedad sigue siendo estructural.

### Quién puede leer: lo decide el DOCUMENTO

Un asset se lee si el documento que lo menciona se puede leer.

```
/api/nexbooks/:id/assets/:assetId              el dueño
/api/nexbooks/published/:slug/assets/:assetId  quien pueda ver la publicación
```

La segunda ruta es donde esa idea trabaja: quien pide la imagen **no** es su
dueño, así que no hay propiedad que consultar. Se comprueba que la publicación
sea visible y que el **documento publicado** referencie ese asset. Eso impide que
una publicación sirva de llave para leer cualquier imagen de su autor.

Un asset huérfano —su bloque se borró— deja de poder leerse por cualquiera de las
dos rutas.

### No hay tabla de assets

No hace falta: todo lo que identifica uno cabe en su clave de S3, y una tabla
nueva es un recurso de AWS nuevo. Es el mismo patrón de los archivos académicos.

### La URL es estable, el permiso es temporal

La página pinta `/api/nexbooks/:id/assets/:assetId` y la ruta redirige a una URL
firmada de cinco minutos. La referencia del documento sirve dentro de un año; el
permiso se decide en cada petición. Guardar la URL firmada dentro del documento
habría convertido un permiso de cinco minutos en uno permanente, y además habría
viajado dentro de cada exportación.

### Límites de subida

| Qué | Cuánto |
| --- | --- |
| Por imagen | 4 MB, aplicado por S3 con `content-length-range` |
| Por NexBook | 100 imágenes |
| Tipos | `image/png`, `image/jpeg`, `image/webp` |

**SVG no se acepta.** Es XML que puede llevar `<script>`, `<foreignObject>` y
manejadores `on*`; servirlo desde el mismo origen y pintarlo sería ejecutar
código de quien subió el archivo en la sesión de quien lo mira —y una publicación
la abre cualquiera—. Aceptarlo exige un saneador de SVG que este proyecto no
tiene.

---

## `SpreadsheetBlock`

### Univer se evaluó y se descartó para V1

La opción de partida era Univer. Los hallazgos, medidos:

| Criterio | Resultado |
| --- | --- |
| Licencia | Apache-2.0 en `preset-sheets-core`; los presets de colaboración son comerciales |
| Tamaño | `@univerjs/preset-sheets-core` solo: **9.9 MB** desempaquetado, y arrastra 14 paquetes más |
| El meta-paquete | `@univerjs/presets` depende de **22** presets, incluidos los de documentos y `node-core` |
| Red | El árbol incluye `@univerjs/network`, una capa HTTP dentro de un componente que no debe salir a Internet |
| Render | Canvas propio |

El que decide es el **render**: un canvas no tiene celdas que un lector de
pantalla pueda anunciar. En un documento académico —que alguien va a revisar y
calificar— eso no es un extra.

Lo implementado es una `<table>` real con `<th scope>`, campos de edición y un
motor de fórmulas propio. Al moverse se oye «Ventas, fila 3, columna B».

Lo que se pierde es lo que hace falta a partir de las diez mil filas:
virtualización, congelar paneles, formato enriquecido. Una hoja dentro de un
NexBook tiene decenas de filas; el límite (200 × 40) está donde esta
implementación sigue siendo cómoda.

### El motor de fórmulas no es `eval`

Las fórmulas las escribe el alumnado y se guardan en un documento que otra
persona abre. Convertirlas en JavaScript y evaluarlas sería ejecutar texto de
terceros en la sesión de quien lo lee.

Es un intérprete de descenso recursivo que sólo sabe hacer aritmética y llamar a
funciones de una lista cerrada: no hay acceso a variables, ni a objetos del
navegador, ni forma de escribir una llamada que no esté en la lista. Probado con
`=globalThis`, `=constructor`, `=fetch(...)`, `=require("fs")` y
`=[].constructor.constructor("return 1")()`: todos dan error de fórmula.

Hace: números, texto, referencias, rangos, `+ - * / ^ % &`, paréntesis,
comparaciones y una veintena de funciones con nombre en español **y** en inglés
—`SUMA`/`SUM`, `PROMEDIO`/`AVERAGE`, `SI`/`IF`…—. Las referencias circulares se
cortan con `#CICLO!` en vez de agotar la pila.

### Se guarda lo ESCRITO

`=SUMA(A1:A3)`, no `6`. Guardar el resultado como si fuera el dato convierte la
fórmula en un número suelto la primera vez que alguien reabre el documento, y la
hoja deja de recalcular. Las celdas se guardan **dispersas** (`"fila:columna"`):
una hoja de 50 × 20 con seis datos no ocupa mil huecos vacíos.

### El puente hacia los kernels

`SpreadsheetBridge` existe para que el día que Python y R lean una hoja no tengan
que saber nada de cómo está implementada:

```
Python / R  ──▶  SpreadsheetBridge  ──▶  implementación de la hoja
```

Hoy lo usan la exportación, la vista pública y la interfaz, que es lo que evita
tres formas distintas de calcular «el valor de B2». **No está conectado a los
kernels**: `sheet("Ventas")` no existe en Python ni en R, y no se anuncia en
ninguna parte de la interfaz.

---

## El formato `.nexbook`

**Implementado.** Exportar e importar funcionan.

```
archivo.nexbook            (contenedor ZIP)
├── manifest.json          formato, versión, título, con qué se creó
├── document.json          el documento, según NEXBOOK_FORMAT_VERSION
└── assets/
    ├── 1.png
    └── 2.webp
```

Un contenedor y no un solo JSON porque un NexBook tiene binarios: meterlos como
Base64 los infla un 33 % y obliga a leer el archivo entero para sacar una imagen.

### Las referencias se REESCRIBEN

Dentro del archivo, un bloque de imagen apunta a `assets/1.png` y no a un asset
de la plataforma. Es lo que hace que un `.nexbook` se pueda abrir en otra cuenta,
en otra instalación o dentro de un año.

### Lo que sale pasa por una lista BLANCA

`publishableDocument` reconstruye el documento **campo a campo** en vez de copiar
el objeto y borrar lo que no debe salir. La diferencia está en el futuro: con una
lista negra, el día que alguien añada un `lastEditorUid` al modelo, ese campo sale
publicado y exportado sin que nadie haga nada. Con una lista blanca no sale hasta
que alguien lo añada ahí, y añadirlo es el momento de preguntarse si debería.

Lo usan **publicar y exportar**, por el mismo motivo: los dos sacan el documento
fuera de su contexto.

Nunca salen: `ownerUid`, el id del NexBook, `context` —que lleva la actividad y
el paso—, `revision`, fechas internas, claves de S3, URLs firmadas, tokens,
cookies, identificadores de AWS ni comentarios de la revisión docente.

### Importar: el dueño es quien importa

Siempre. El archivo no lleva `ownerUid` y, aunque lo llevara, no se leería: un
formato donde el archivo pueda declarar a quién pertenece es un formato donde se
puede escribir en la cuenta de otro. Lo importado nace `personal` y `private`.

El orden de las comprobaciones va de lo más barato a lo más estructural:

```
tamaño del envío → entradas y rutas → manifiesto y versión
                 → bytes de cada imagen → esquema del documento
```

| Amenaza | Defensa |
| --- | --- |
| Zip slip | Lista blanca de rutas; se filtra antes de descomprimir |
| ZIP bomb | Tope al envío, al número de entradas y a los tamaños **declarados** |
| ZIP que miente sobre su tamaño | fflate reserva la salida con el tamaño declarado y falla si el flujo produce más |
| Imagen que no lo es | Número mágico de los bytes, no el tipo del manifiesto |
| Versión del futuro | Se rechaza antes de mirar el contenido |

Lo del número mágico importa: un HTML con `<script>` renombrado a `.png` y
declarado `image/png` acabaría guardado y servido como imagen desde el propio
origen.

### Otros formatos

NexBook es el modelo **canónico**. `.ipynb`, `.qmd`, `.md` y PDF serán
importadores y exportadores alrededor, nunca la forma del modelo. No se
implementa ninguno todavía.

---

## `AIBlock`: diseñado, NO implementado

No está en el union type, y esa es la regla: no se declara un bloque sin
renderizador, persistencia y modelo de permisos.

Cuando llegue, la separación innegociable es ésta:

```
AIBlock            referencia a proveedor, modelo y contexto
Credential Vault   entidad COMPLETAMENTE independiente
```

Nunca `AIBlock.apiKey`. Una credencial dentro del documento viajaría en cada
exportación, en cada publicación y en cada snapshot de entrega —y este mismo
archivo documenta tres caminos por los que un documento sale de la plataforma—.

### Política docente de IA

Un Workflow podrá declarar qué se permite:

```
AI: not_allowed | allowed | restricted
```

No hay enforcement en esta fase, y decirlo importa: un campo que se guarda pero
que nadie aplica es peor que no tenerlo, porque hace creer que la regla está
puesta.

---

## Rendimiento

| Pantalla | First Load JS | Qué arrastra |
| --- | --- | --- |
| `/nexbook/:slug` (lectura) | 167 kB | Ni kernel ni Monaco |
| `/practicas/nexbook/:id` (Studio) | 232 kB | Monaco; el kernel es perezoso |

Nada de esto descarga un runtime al abrirse. Pyodide (13 MB) y webR (46 MB) se
piden cuando se ejecuta la primera celda de ese lenguaje; las ruedas de Python
(16.6 MB), cuando una celda las importa. Un NexBook de sólo Markdown no descarga
nada.

La hoja de cálculo no añade dependencias: el motor de fórmulas y la rejilla son
código propio, y por eso no hay nada que cargar perezosamente.
