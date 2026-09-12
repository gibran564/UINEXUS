/**
 * Las tablas de DynamoDB, en UN solo sitio.
 *
 * ## Por qué existe este archivo
 *
 * Hasta la Fase 3 las definiciones vivían en tres sitios que había que acordarse
 * de sincronizar a mano: `infra/uinexus.cfn.yaml` (la fuente declarativa),
 * `tests/integration/helpers/dynamodb.ts` (el arnés) y
 * `scripts/ensure-academic-tables.mjs` (el atajo sin AWS CLI). El riesgo R12 del
 * roadmap describía exactamente lo que pasa cuando divergen: una tabla de
 * pruebas que no es la de producción prueba otra cosa, y el fallo aparece en
 * producción. Ya ocurrió dos veces —`projects.byOwner` y `projects.byPath`—.
 *
 * El entorno local de desarrollo habría sido el CUARTO sitio. En vez de añadirlo,
 * las definiciones salen aquí y las importan todos los consumidores locales. La
 * plantilla de CloudFormation sigue siendo la fuente declarativa de verdad para
 * la NUBE; este módulo es su reflejo ejecutable, y hay una prueba que comprueba
 * que los dos dicen lo mismo.
 *
 * ## Qué NO es
 *
 * No es un despliegue. Nada de aquí se ejecuta contra AWS real: lo usan
 * DynamoDB Local (integración y sandbox) y el script idempotente que crea las
 * tablas académicas que faltan. La comprobación de que el destino es local vive
 * en `scripts/lib/local-guard.mjs` y en el propio arnés.
 *
 * ## Forma
 *
 * Es JavaScript plano y sin dependencias del código de la aplicación: recibe los
 * nombres ya resueltos (`TABLES`, `INDEXES`) para no importar
 * `src/lib/aws/config.ts` desde un script de Node. Los tipos están en el
 * `.d.mts` de al lado.
 */

/**
 * Las once tablas, con sus índices, tal y como las declara
 * `infra/uinexus.cfn.yaml`.
 *
 * @param {Record<string, string>} tables  nombres ya prefijados
 * @param {Record<string, string>} indexes nombres de los índices
 */
export function tableDefinitions(tables, indexes) {
  return [
    {
      TableName: tables.users,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'uid', AttributeType: 'S' },
        { AttributeName: 'handle', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'uid', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.usersByHandle,
          KeySchema: [{ AttributeName: 'handle', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    /**
     * Reserva de handles. Sin GSI: la unicidad la da la clave primaria más la
     * condición `attribute_not_exists(handle)` de `lib/server/writes.ts`.
     */
    {
      TableName: tables.handles,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'handle', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'handle', KeyType: 'HASH' }],
    },
    /**
     * `byStatus` es DISPERSO a propósito: `statusKey` y `listedAt` sólo existen
     * en los proyectos publicados y listables, así que ninguna consulta puede
     * devolver un borrador. Es una garantía estructural, no un filtro que haya
     * que acordarse de escribir.
     */
    {
      TableName: tables.projects,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'ownerId', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'S' },
        { AttributeName: 'path', AttributeType: 'S' },
        { AttributeName: 'statusKey', AttributeType: 'S' },
        { AttributeName: 'listedAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.projectsByOwner,
          KeySchema: [
            { AttributeName: 'ownerId', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: indexes.projectsByPath,
          KeySchema: [{ AttributeName: 'path', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: indexes.projectsByStatus,
          KeySchema: [
            { AttributeName: 'statusKey', KeyType: 'HASH' },
            { AttributeName: 'listedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.courses,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    },
    {
      TableName: tables.reports,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    },
    {
      TableName: tables.assignments,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.assignmentsByCourse,
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.submissions,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'assignmentId', AttributeType: 'S' },
        { AttributeName: 'studentId', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.submissionsByAssignment,
          KeySchema: [
            { AttributeName: 'assignmentId', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: indexes.submissionsByStudent,
          KeySchema: [
            { AttributeName: 'studentId', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.prompts,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.promptsByCourse,
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.skills,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.skillsByCourse,
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.resources,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'courseId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.resourcesByCourse,
          KeySchema: [
            { AttributeName: 'courseId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    /**
     * Espacios personales: NexCode (`kind: 'code'`), NexLab (`kind: 'nexbook'`)
     * y las publicaciones (`kind: 'nexbook-publication'`). Ordena por
     * `updatedAt` porque la lista se lee «lo último que toqué primero».
     */
    {
      TableName: tables.workspaces,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'ownerUid', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: indexes.workspacesByOwner,
          KeySchema: [
            { AttributeName: 'ownerUid', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
  ];
}

/** La clave primaria de cada tabla, para poder vaciarla. */
export function tablePrimaryKeys(tables) {
  return new Map([
    [tables.users, 'uid'],
    [tables.handles, 'handle'],
    [tables.projects, 'id'],
    [tables.courses, 'id'],
    [tables.reports, 'id'],
    [tables.assignments, 'id'],
    [tables.submissions, 'id'],
    [tables.prompts, 'id'],
    [tables.skills, 'id'],
    [tables.resources, 'id'],
    [tables.workspaces, 'id'],
  ]);
}
