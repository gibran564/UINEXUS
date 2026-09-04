# Pruebas de integración de rutas

La suite ejecuta handlers reales de Next contra un proceso efímero de
DynamoDB Local. No necesita ni debe usar credenciales o tablas de AWS.

## Ejecutar

Requisitos: Node.js, npm y Java 17 o posterior disponible en `PATH`.

```bash
npm run test:integration
```

El runner:

1. comprueba que hay Java 17+ **antes** de descargar nada;
2. obtiene un artefacto de DynamoDB Local **fijado por versión y por hash**;
3. reserva un puerto libre en `127.0.0.1`;
4. inicia DynamoDB Local **en memoria**;
5. asigna un prefijo de tablas único para el proceso;
6. ejecuta únicamente `tests/integration/**/*.test.ts`;
7. deshabilita la telemetría de DynamoDB Local;
8. elimina las tablas y detiene el proceso incluso si Vitest falla.

## El artefacto de DynamoDB Local

La suite **no** usa `dynamodb_local_latest.tar.gz`. Ese nombre es mutable: la
misma orden ejecutada hoy y dentro de seis meses puede traer binarios distintos,
y la suite dejaría de ser reproducible sin que nadie lo notara.

Lo que se usa está fijado en `scripts/lib/dynamodb-local.mjs`:

| | |
|---|---|
| Versión | `2024-11-06` (línea 2.x, la que necesita Java 17+) |
| URL | `https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_2024-11-06.tar.gz` |
| SHA-256 | `875cb27dc7843d0d24263f0e1521280f9bfdf0ebf0e69fbd1b4cb00e7c8658e0` |

> AWS publica dos artefactos con esa misma fecha y distinto contenido: el de
> `s3.us-west-2.amazonaws.com/dynamodb-local/` es la línea 1.x (Java 8) y el de
> este CloudFront `/v2.x/` es la 2.x. Cambiar de uno a otro sin darse cuenta
> rompería el requisito de Java.

### Primera ejecución

Requiere red. Descarga a un archivo temporal, **verifica el SHA-256**, y sólo
entonces lo renombra al caché y lo extrae. Si la descarga se corta o el hash no
cuadra, se borra el temporal y no se toca el caché que hubiera.

### Ejecuciones posteriores

Reutilizan el caché, pero **vuelven a comprobar el hash antes de usarlo**. «Si
ya está descargado, es seguro» es justo la suposición que convierte un caché en
un punto de entrada.

Con el caché presente y válido, `npm run test:integration` **no hace ninguna
petición de red**.

### Si el hash no coincide

El runner se detiene con:

```
DynamoDB Local checksum mismatch.
Expected: ...
Actual:   ...
Cached artifact will not be executed.
```

y **no llega a ejecutar Java**. El archivo no se borra: un artefacto que cambió
es información —corrupción de disco, o algo peor— y borrarlo la destruye antes
de que nadie la vea. Bórralo a mano si decides volver a descargarlo.

### Dónde vive el caché

Fuera del repositorio, siempre. Un binario de 54 MB no entra en Git.

| Sistema | Ruta |
|---|---|
| Windows | `%LOCALAPPDATA%\uinexus\dynamodb-local` |
| macOS | `~/Library/Caches/uinexus/dynamodb-local` |
| Linux | `$XDG_CACHE_HOME/uinexus/dynamodb-local` (o `~/.cache/…`) |

`UINEXUS_CACHE_DIR` lo redirige, para que CI apunte al suyo.

### Comprobar que el hash fijado sigue siendo el oficial

```bash
node scripts/verify-dynamodb-artifact.mjs
```

Compara la constante del repositorio con el `.sha256` que AWS publica junto al
artefacto. **No** se hace durante la suite: pedirle el hash al mismo servidor
que sirve el binario no verifica nada, porque quien pudiera alterar uno
alteraría el otro. Sirve para revisar a mano al subir de versión.

La suite sustituye sólo `firebase-admin#verifyIdToken`, porque comprobar la
firma requiere un proyecto o el Auth Emulator. El parseo del bearer token, la
lectura del perfil y rol desde DynamoDB, la autorización de materia y toda la
persistencia son código real. No existe ningún bypass de autenticación en
producción.

El helper de base de datos valida que el endpoint sea HTTP loopback y que el
prefijo empiece por `uinexus-integration-` antes de crear, vaciar, sembrar o
eliminar tablas. Si se ejecuta Vitest directamente o se apunta a otro host, la
suite falla antes de escribir.


## Seguridad

Esta suite **nunca toca AWS real**.

- El endpoint de DynamoDB es siempre HTTP de bucle local en un puerto libre.
- Las credenciales que recibe el proceso hijo son literales de prueba.
- El helper de base de datos rechaza cualquier endpoint que no sea loopback y
  cualquier prefijo que no empiece por `uinexus-integration-`.
- La base es **en memoria**: no queda ningún archivo entre ejecuciones.
- Nada se extrae ni se ejecuta antes de comprobar el SHA-256 del artefacto.

## Requisitos

- Node.js
- Java 17 o posterior en el `PATH`

Si falta Java, el runner lo dice antes de descargar nada:

```
Java 17+ is required to run DynamoDB Local integration tests.
```

No se instala Java automáticamente: eso es decisión de quien administra la
máquina.
