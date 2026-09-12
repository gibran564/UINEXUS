# Entorno local de Nextudio

Cómo levantar Nextudio **entero** en tu máquina, con dos cuentas —docente y
estudiante— y sin tocar nada de producción.

Existe desde la **Fase 3.5**, y resuelve una deuda que arrastraban todas las
iteraciones anteriores: hasta ahora ninguna comprobación de navegador podía
pasar de la pantalla de acceso, así que todo lo que hay detrás de la sesión
—Aula, Espacios, NexLab, entregas— sólo estaba cubierto por pruebas.

```bash
npm run dev:local
```

Eso es todo. El resto de este documento explica qué hace, cómo se comprueba que
no estás conectado a producción y cómo empezar de cero.

---

## Qué levanta

```
DynamoDB Local   127.0.0.1:8100   datos, en disco, borrables
Auth Emulator    127.0.0.1:9099   identidad, proyecto demo-uinexus
Next.js          localhost:3000   la aplicación
```

Y antes de arrancar nada: compila los Workers de Python y R, crea las tablas que
falten y siembra la materia y las cuentas. Es idempotente: ejecutarlo diez veces
seguidas deja el mismo estado.

### Requisitos

| | |
|---|---|
| **Java 17+** | Lo necesitan DynamoDB Local y el emulador de Firebase. `java -version` |
| **npm install** | `firebase-tools` ya es una dependencia de desarrollo; no hay que instalar nada aparte |
| Red, la primera vez | Para bajar DynamoDB Local (54 MB, verificado por SHA-256 y cacheado fuera del repositorio). Después no hace falta |

---

## Las dos cuentas

```
Docente     docente.sandbox@itdurango.edu.mx   sandbox-local
Estudiante  20250001@itdurango.edu.mx          sandbox-local
```

Para cambiar de una a otra: cerrar sesión y entrar con la otra. No hay un
selector de rol, y es deliberado —ver «Lo que este entorno NO es»—.

### Por qué el dominio es `@itdurango.edu.mx` y no algo tipo `@local`

Porque `isInstitutionalEmail()` es una regla de **producción**. Relajarla para
poder probar habría convertido el tooling en un agujero: la comprobación que
decide quién entra dejaría de estar ejercida justo en el entorno donde se
prueba.

Estas cuentas existen **sólo** dentro del emulador de Firebase —proyecto
`demo-uinexus`, que Google ni siquiera conoce— y dentro de DynamoDB Local. No
hay ninguna cuenta real detrás de ellas.

El **rol** tampoco se escribe a mano: sale de la misma función que en
producción (`getRoleFromInstitutionalEmail`), que mira si la parte local del
correo lleva dígitos —el número de control del ITD—. Por eso el estudiante es
`20250001` y la docente `docente.sandbox`.

---

## Los datos que trae

```
Materia     Investigación de Operaciones — Sandbox   (local-course-io)
Docente     docente.sandbox   (propietaria)
Estudiante  20250001          (inscrito)
Actividad   «Análisis de ventas en NexLab», publicada, con una parte de NexLab
Actividad   «Glosario de conceptos (formato anterior)», con la forma ANTERIOR
            al rediseño del creador: tipo `research`, sin `workflow` y con sus
            campos en la tarea. Existe para poder comprobar —a mano y en
            Playwright— que abrirla y volver a guardarla no la convierte en
            otra cosa
Actividad   «Tres conclusiones sobre el método símplex»: la más sencilla que
            existe, para comprobar que sigue sintiéndose sencilla
Actividad   «Comparar dos métodos de solución»: tres partes, con una
            dependencia y una conclusión de IA obligatoria
Actividad   «Implementar el algoritmo en Java»: una sola parte de NexCode, en
            un lenguaje que se puede escribir pero no ejecutar aquí
```

Las entregas de las dos últimas **se borran en cada arranque**. Sus recorridos
dependen del punto de partida —una parte bloqueada, una actividad sin empezar—
y una entrega de la ejecución anterior los convertiría en otro caso. El resto
del sandbox no se toca: lo que crees explorando a mano sigue ahí, y `--reset`
sigue siendo la forma explícita de empezar de cero. Ver
`RESETTABLE_ASSIGNMENTS` en `scripts/lib/local-seed.mjs`.

Lo mínimo para recorrer el producto de punta a punta. Nada de relleno: treinta
actividades de mentira no hacen el recorrido más real, sólo hacen más difícil
encontrar la que estás probando.

### El recorrido que habilita

```
Docente                      Estudiante                  Docente
  ↓                            ↓                           ↓
abrir Aula                   abrir la materia            abrir la entrega
abrir la materia             abrir la actividad          revisar el snapshot
abrir la actividad           trabajar en NexLab
preparar la plantilla        guardar
                             entregar
```

---

## Pruebas de extremo a extremo

```bash
npm run test:e2e
```

Levanta el sandbox si no está levantado (`webServer` de Playwright ejecuta
`npm run dev:local`) y recorre seis caminos con sesión real:

| Recorrido | Qué comprueba |
|---|---|
| Docente · actividad sencilla | Crear, previsualizar y publicar sin que aparezca la palabra «workflow» |
| Docente · varias partes | Añadir tres partes y reordenarlas **con el teclado** |
| Docente · NexLab | «Preparar NexLab» antes de publicar, importar un CSV, volver y publicar |
| Compatibilidad | Una actividad del formato anterior abre, se edita y se guarda igual |
| Estudiante · ver | Abre la actividad y su NexLab; no ve la plantilla ni controles docentes |
| Estudiante · permisos | El constructor por URL directa no le carga nada |
| Estudiante · actividad sencilla | Responder, guardar, entregar y ver la confirmación |
| Estudiante · laboratorio | Una sola parte de NexLab: trabajar, **recargar**, entregar |
| Docente · lo entregado | Abre la entrega y sigue viendo la copia congelada, no el trabajo vivo |
| Estudiante · NexCode | Una sola parte de programa, en un lenguaje que no se ejecuta aquí |
| Estudiante · varias partes | Una parte bloqueada que se desbloquea, y una conclusión que se exige |

Tres cosas que conviene saber:

- **Sólo apunta a loopback.** `playwright.config.ts` comprueba el destino con la
  misma función que el seed (`isLoopbackEndpoint`) y se niega a arrancar contra
  cualquier otra cosa. No se confía en el nombre del script.
- **Van en serie.** Comparten la materia sembrada y la misma cuenta docente; en
  paralelo se pisarían.
- **Los datos se acumulan.** El sandbox guarda en disco, así que cada ejecución
  deja sus actividades. Es a propósito —`--reset` es la forma explícita de
  empezar de cero— y por eso las pruebas abren lo que necesitan **por su id** en
  vez de buscarlo en «Tareas recientes».

Los tiempos son holgados porque detrás hay un `next dev` que compila bajo
demanda; `tests/e2e/global-setup.ts` calienta las rutas antes de empezar.

---

## Cómo saber que NO estás en producción

Cuatro señales, de la más visible a la más estructural:

1. **La consola lo dice al arrancar**, con los puertos y las cuentas.
2. **El emulador tiene su propia interfaz** en <http://127.0.0.1:4000>. Ahí se
   ven las cuentas locales; si abres eso y aparecen, no hay Firebase real de por
   medio.
3. **El proyecto de Firebase es `demo-uinexus`.** El prefijo `demo-` es la
   convención de Firebase para «este proyecto no existe en la nube»: el SDK se
   niega a salir a internet con uno.
4. **Las tablas se llaman `uinexus-local-*`.** Las de producción se llaman
   `uinexus-*`. Ningún comando del sandbox puede tocar un nombre que no empiece
   por el prefijo reservado.

### Y por qué eso no depende de que te acuerdes

`scripts/lib/local-guard.mjs` comprueba el **destino** antes de cada operación
destructiva, no el nombre del script ni `NODE_ENV`:

```
endpoint de DynamoDB   tiene que existir, ser http: y apuntar al bucle local
prefijo de tablas      tiene que empezar por «uinexus-local»
credenciales de AWS    no puede haber credenciales reales en el entorno
```

Las tres son AND, y falla cerrado. Además, `src/lib/aws/config.ts` sólo admite
un endpoint alternativo de DynamoDB en dos runtimes, y **ninguno de los dos
puede ser producción**:

```
integración   NODE_ENV=test        + UINEXUS_INTEGRATION_TESTS=true
sandbox       NODE_ENV=development + UINEXUS_LOCAL_SANDBOX=true
```

En un despliegue no existe ninguna combinación de variables que abra esa puerta.
Lo fija `tests/unit/local-sandbox.test.ts`.

### `.env.local` no se toca

Ese archivo apunta a Firebase y AWS **reales**, porque hace falta para trabajar
contra producción. El sandbox no lo reescribe: le **gana** por precedencia.

`@next/env` conserva el valor que ya esté en `process.env` al cargar
`.env.local`, así que `childEnv()` (en `scripts/lib/local-env.mjs`) define todas
las variables relevantes —**incluidas las que valen cadena vacía**, como
`FIREBASE_SERVICE_ACCOUNT_JSON`—. Una variable que se dejara sin definir sería
una variable que `.env.local` rellenaría con el valor de producción.

---

## Empezar de cero

```bash
npm run local:reset     # borra los datos locales
npm run dev:local       # vuelve a crearlos y sembrarlos
```

o, en un solo paso:

```bash
npm run dev:local -- --reset
```

Los datos viven en `.local-sandbox/` (fuera de git). Las cuentas del emulador
viven en memoria y desaparecen al pararlo; se vuelven a crear al arrancar.

### Otros comandos

```bash
npm run local:prepare   # prepara todo y sale, sin servir. Para CI y Playwright
npm run prod:local      # la compilación de producción, servida en local
```

### `prod:local`: lo compilado, sin base de datos

`next dev` no es el producto: compila bajo demanda, no minifica y sirve React en
modo desarrollo. `npm run prod:local` hace `next build` + `next start` sobre
`.next-local/`, así que lo que se abre en el navegador son los bundles de
verdad.

**Ahí no hay base de datos**, y no es un olvido. `lib/aws/config.ts` sólo admite
un endpoint de DynamoDB que no sea el de AWS cuando `NODE_ENV` no es
`production`; y `NODE_ENV` en Next es una constante de COMPILACIÓN: webpack la
sustituye dentro del bundle, de modo que en un build de producción la rama que
permitiría el endpoint local ya no existe en el código. Arrancar el servidor con
otro `NODE_ENV` no cambia nada —comprobado: el servidor arranca y toda ruta que
toca datos responde 500 con ese mismo error—.

Eso hace la garantía más fuerte, no más débil, así que no se toca. `prod:local`
arranca entonces en el modo sin base de datos que la aplicación ya soporta, y
sirve para lo que no depende de datos: que el build arranca, que las pantallas
públicas se pintan, que no hay errores de consola, que el responsive y el tema
oscuro se comportan. **Para el aula, `dev:local`.**

---

## Lo que este entorno NO es

- **No es un segundo sistema de autenticación.** No hay «entrar como docente»
  por parámetro de URL, no hay un `role` que el navegador pueda mandar y los
  contratos públicos no cambiaron. Lo que hay es el emulador oficial de Firebase
  con dos cuentas creadas de antemano: la aplicación no distingue entre eso y
  Firebase real, que es exactamente lo que lo hace útil para probar.
- **No hay S3 local.** Firebase tiene emulador de Auth; AWS no tiene equivalente
  aquí. Consecuencia práctica: **subir imágenes a un NexBook falla** en el
  sandbox, y con ellas `nex.image(...)` desde el código. Todo lo que no toca S3
  —hojas, código, outputs, entregas, publicaciones, `.nexbook` sin imágenes—
  funciona. La interoperabilidad de imágenes está cubierta por pruebas que
  ejecutan Pyodide de verdad (`tests/unit/lab-runtime.test.ts`).
- **No es un entorno de rendimiento.** `next dev` recompila al vuelo; la primera
  carga de una página puede tardar bastante y eso no dice nada del despliegue.

---

## Problemas conocidos

**`Java ... is required`** — DynamoDB Local y el emulador necesitan Java 17+.
No se instala solo: es decisión de quien administra la máquina.

**El puerto 8100, 9099 o 3000 está ocupado** — otra ejecución del sandbox sigue
viva. Ciérrala; los puertos están fijados a propósito para que dos sandboxes no
convivan sin que nadie se entere.

**Una celda de código falla con `NameError: name 'nex' is not defined`** — los
Workers de `public/runtime/workers/` son anteriores a un cambio del código de
ejecución. `npm run dev:local` los recompila al arrancar; si arrancaste con
`next dev` a secas, ejecuta `npm run runtimes`.

**webR no arranca** — webR usa Workers anidados y no todos los navegadores
embebidos los admiten. En un Chrome o Firefox normal funciona. Ver
`docs/LIMITATIONS.md`.

**`prod:local` dice que el puerto 3000 está ocupado** — `dev:local` sigue vivo.
Los dos sirven Nextudio en el mismo puerto a propósito: dos sandboxes a la vez
serían dos verdades distintas sobre el mismo producto.

---

## Dónde vive cada pieza

| Archivo | Qué hace |
|---|---|
| `scripts/dev-local.mjs` | El orquestador. Compila Workers, levanta servicios, siembra y sirve |
| `scripts/local-reset.mjs` | Borra los datos locales |
| `scripts/lib/local-env.mjs` | Puertos, cuentas y el entorno que gana a `.env.local` |
| `scripts/lib/local-guard.mjs` | Las comprobaciones de «esto es local» |
| `scripts/lib/local-seed.mjs` | Tablas, materia, actividad y cuentas del emulador |
| `scripts/lib/table-definitions.mjs` | Las tablas de DynamoDB, en UN solo sitio (ver R12) |
| `firebase.json` | Puertos del emulador. Ya existía |
| `scripts/lib/local-services.mjs` | Los servicios del sandbox, compartidos por `dev:local` y `prod:local` |
| `scripts/prod-local.mjs` | La compilación de producción, servida en local |
| `scripts/e2e-prod.mjs` | Lanza Playwright en modo compilado |
| `playwright.config.ts` | La suite E2E. Sólo acepta destinos loopback |
| `tests/e2e/` | Los recorridos, el responsive, la accesibilidad y el build compilado |
