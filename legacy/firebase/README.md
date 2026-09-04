# Restos de la etapa Firebase

Estos archivos **ya no gobiernan nada**. Se conservan aquí, y no borrados,
porque el proyecto no está bajo control de versiones y perderlos sería
irreversible. En cuanto haya un repositorio git, se pueden eliminar.

| Archivo | Qué hacía | Qué lo sustituye |
|---|---|---|
| `firestore.rules` | Única autoridad sobre las escrituras de metadata | `src/lib/server/session.ts` y `src/lib/server/writes.ts` |
| `storage.rules` | Propiedad, extensión, tamaño y rutas de las subidas | `src/lib/aws/s3.ts` al firmar el POST, y la condición `content-length-range` que aplica S3 |
| `firestore.indexes.json` | Índices compuestos de Firestore | Los GSI de `infra/uinexus.cfn.yaml` |
| `apphosting.yaml` | Despliegue en Firebase App Hosting | AWS Amplify Hosting (ver `docs/DEPLOY.md`) |
| `firebase.json.orig` | Config con Firestore, Storage, Functions y Hosting | `firebase.json` en la raíz, reducido al emulador de Auth |
| `functions/` | La Cloud Function `serveProject` | `infra/serve-project/` (Lambda con respuesta en streaming) |

## Advertencia

No vuelvas a poner `firestore.rules` ni `storage.rules` en la raíz. Dejar ahí
un archivo de reglas sugiere una protección que ya no existe: hoy nada las lee,
y quien las viera podría creer que las escrituras están cubiertas cuando la
autoridad real está en el servidor de Next.js.

## Pendiente

`functions/` sigue en la raíz del proyecto: no se pudo mover porque
`functions/node_modules` estaba en uso. Bórrala a mano cuando quieras:

```bash
rm -rf functions
```

Su código fuente está a salvo en `legacy/firebase/functions/` si la copia llegó
a completarse; si no, el original sigue siendo el de la raíz.
