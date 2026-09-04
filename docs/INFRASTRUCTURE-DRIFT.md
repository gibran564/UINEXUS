# Divergencia entre CloudFormation y la cuenta

> Estado comprobado el 2026-09-04 contra la cuenta `705822375607`, región
> `us-east-1`.

## El hecho

`infra/uinexus.cfn.yaml` declara la infraestructura de UINexus, pero **ninguno
de los recursos que existen en la cuenta fue creado por esa pila**. Se
comprobó recurso a recurso: ninguna tabla lleva etiquetas
`aws:cloudformation:stack-name`, que es lo que CloudFormation pone
automáticamente a todo lo que gestiona.

La plantilla y la realidad describen la misma infraestructura, pero la pila no
la controla.

## Por qué importa

`npm run aws:deploy:infra` ejecuta `cloudformation deploy` sobre esa plantilla.
Con las tablas ya existentes y fuera de la pila, el despliegue **falla**:
CloudFormation intenta crear `uinexus-users`, encuentra que el nombre está
ocupado y aborta la operación entera.

El riesgo real no es ese fallo —que es ruidoso y reversible— sino lo que suele
hacerse a continuación: borrar las tablas «para que el deploy funcione». Varias
ya contienen datos de producción.

## Inventario

| Recurso | Existe | Declarado en CFN | En la pila | Datos | Riesgo de reemplazo |
|---|---|---|---|---|---|
| `uinexus-users` | Sí | Sí | **No** | **Sí** (perfiles) | **Alto** |
| `uinexus-handles` | Sí | Sí | **No** | **Sí** (reservas de @nombre) | **Alto** |
| `uinexus-projects` | Sí | Sí | **No** | **Sí** | **Alto** |
| `uinexus-courses` | Sí | Sí | **No** | **Sí** | **Alto** |
| `uinexus-reports` | Sí | Sí | **No** | No | Bajo |
| `uinexus-assignments` | Sí | Sí | **No** | No | Bajo |
| `uinexus-submissions` | Sí | Sí | **No** | No | Bajo · sube en cuanto se entregue algo |
| `uinexus-prompts` | Sí | Sí | **No** | No | Bajo |
| `uinexus-skills` | Sí | Sí | **No** | No | Bajo |
| `uinexus-resources` | Sí | Sí | **No** | No | Bajo |

«Datos» es el recuento aproximado de DynamoDB, que se actualiza cada pocas
horas: sirve para saber si una tabla está en uso, no como inventario exacto.

Los buckets de S3, la distribución de CloudFront y el KeyValueStore que declara
la plantilla **no se han inspeccionado** en esta sesión. Es razonable suponer
que están en la misma situación, pero no está comprobado y no debe darse por
hecho.

## Lo que NO se ha hecho, y por qué

No se ha reconciliado nada. Las dos formas de hacerlo son destructivas o
delicadas, y ninguna debe ejecutarse sin un plan explícito y una copia de
seguridad:

- **Borrar y recrear con la pila** destruiría los perfiles, las reservas de
  handle y los proyectos publicados. Descartado.
- **Importar recursos existentes** (`cloudformation create-change-set
  --change-set-type IMPORT`) es la vía correcta, pero exige que la plantilla
  describa cada recurso *exactamente* como está en la cuenta. Cualquier
  diferencia —una clave, un índice, un modo de facturación— provoca un
  reemplazo, que en DynamoDB significa perder la tabla.

## Estrategia recomendada, cuando se aborde

1. **Copia de seguridad primero.** Activar la recuperación a un punto en el
   tiempo en las cuatro tablas con datos, o exportarlas a S3. Sin esto, no
   empezar.
2. **Comparar declaración contra realidad, recurso a recurso.** Para cada
   tabla: clave de partición, clave de ordenación, definiciones de atributos,
   índices secundarios con sus claves y proyecciones, y modo de facturación.
   Ajustar la *plantilla* a la realidad, no al revés.
3. **Importar por lotes pequeños**, empezando por las tablas **sin datos**
   (`-assignments`, `-submissions`, `-prompts`, `-skills`, `-resources`,
   `-reports`). Si algo sale mal ahí, no se pierde trabajo académico.
4. **Comprobar con un change set de detección de drift** que la importación no
   propone reemplazos antes de aplicar nada.
5. **Sólo entonces** importar las cuatro con datos.

## Mientras tanto

`scripts/ensure-academic-tables.mjs` crea las tablas que falten de forma
idempotente y sin tocar las existentes. Es lo que se ha usado hasta ahora y
sigue siendo la vía segura para añadir una tabla nueva.

La plantilla se mantiene actualizada como **fuente declarativa de verdad**
—describe lo que debe existir— aunque hoy no sea quien lo gestione. Dejar de
actualizarla haría imposible la importación futura.

## Cómo volver a comprobarlo

```bash
node --input-type=module -e "
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand, ListTagsOfResourceCommand } from '@aws-sdk/client-dynamodb';
const c = new DynamoDBClient({ region: 'us-east-1' });
const { TableNames } = await c.send(new ListTablesCommand({}));
for (const t of TableNames.filter(n => n.startsWith('uinexus'))) {
  const d = await c.send(new DescribeTableCommand({ TableName: t }));
  const tags = await c.send(new ListTagsOfResourceCommand({ ResourceArn: d.Table.TableArn }));
  const cfn = (tags.Tags ?? []).some(x => x.Key.startsWith('aws:cloudformation'));
  console.log(t, '| items ~' + d.Table.ItemCount, '| CFN:', cfn ? 'SI' : 'NO');
}
"
```
