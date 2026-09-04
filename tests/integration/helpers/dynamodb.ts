import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  waitUntilTableNotExists,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  type BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { INDEXES, TABLES } from '@/lib/aws/config';
import type { AssignmentRecord } from '@/lib/types';
import type { SubmissionRecord } from '@/lib/types';
import { COURSE_FIXTURES, USER_FIXTURES } from './fixtures';

const endpoint = process.env.UINEXUS_DYNAMODB_ENDPOINT ?? '';
const tablePrefix = process.env.UINEXUS_TABLE_PREFIX ?? '';

function assertLocalTestTarget(): void {
  const parsed = new URL(endpoint);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'http:' || !loopback || !tablePrefix.startsWith('uinexus-integration-')) {
    throw new Error('Las pruebas de integración sólo pueden escribir en DynamoDB Local con prefijo aislado.');
  }
}

assertLocalTestTarget();

const rawClient = new DynamoDBClient({
  endpoint,
  region: process.env.UINEXUS_AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'localaccesskey', secretAccessKey: 'localsecretkey' },
});

const documentClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const tableDefinitions: CreateTableCommandInput[] = [
  {
    TableName: TABLES.users,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'uid', AttributeType: 'S' },
      { AttributeName: 'handle', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'uid', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.usersByHandle,
        KeySchema: [{ AttributeName: 'handle', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.courses,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  },
  {
    TableName: TABLES.assignments,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'courseId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
    ],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: INDEXES.assignmentsByCourse,
        KeySchema: [
          { AttributeName: 'courseId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: TABLES.submissions,
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
        IndexName: INDEXES.submissionsByAssignment,
        KeySchema: [
          { AttributeName: 'assignmentId', KeyType: 'HASH' },
          { AttributeName: 'updatedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: INDEXES.submissionsByStudent,
        KeySchema: [
          { AttributeName: 'studentId', KeyType: 'HASH' },
          { AttributeName: 'updatedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

const tableKeys = new Map<string, string>([
  [TABLES.users, 'uid'],
  [TABLES.courses, 'id'],
  [TABLES.assignments, 'id'],
  [TABLES.submissions, 'id'],
]);

async function batchWrite(
  requestItems: NonNullable<BatchWriteCommandInput['RequestItems']>
): Promise<void> {
  let pending = requestItems;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await documentClient.send(new BatchWriteCommand({ RequestItems: pending }));
    pending = result.UnprocessedItems ?? {};
    if (Object.values(pending).every((items) => !items?.length)) return;
    await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error('DynamoDB Local no procesó por completo un lote de preparación.');
}

export async function createIntegrationTables(): Promise<void> {
  assertLocalTestTarget();
  for (const definition of tableDefinitions) {
    await rawClient.send(new CreateTableCommand(definition));
    await waitUntilTableExists(
      { client: rawClient, maxWaitTime: 20, minDelay: 1, maxDelay: 1 },
      { TableName: definition.TableName }
    );
  }
}

async function clearTable(tableName: string): Promise<void> {
  const keyName = tableKeys.get(tableName);
  if (!keyName) throw new Error(`Tabla de integración desconocida: ${tableName}`);

  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: '#key',
        ExpressionAttributeNames: { '#key': keyName },
        ExclusiveStartKey: startKey,
      })
    );
    const items = page.Items ?? [];
    for (let offset = 0; offset < items.length; offset += 25) {
      const chunk = items.slice(offset, offset + 25);
      await batchWrite({
        [tableName]: chunk.map((item) => ({
          DeleteRequest: { Key: { [keyName]: item[keyName] } },
        })),
      });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

export async function resetAndSeedIntegrationData(): Promise<void> {
  assertLocalTestTarget();
  for (const tableName of tableKeys.keys()) await clearTable(tableName);

  await batchWrite({
    [TABLES.users]: USER_FIXTURES.map((Item) => ({ PutRequest: { Item } })),
    [TABLES.courses]: COURSE_FIXTURES.map((Item) => ({ PutRequest: { Item } })),
  });
}

export async function deleteIntegrationTables(): Promise<void> {
  assertLocalTestTarget();
  for (const definition of [...tableDefinitions].reverse()) {
    try {
      await rawClient.send(new DeleteTableCommand({ TableName: definition.TableName }));
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'ResourceNotFoundException') throw caught;
      continue;
    }
    await waitUntilTableNotExists(
      { client: rawClient, maxWaitTime: 20, minDelay: 1, maxDelay: 1 },
      { TableName: definition.TableName }
    );
  }
  rawClient.destroy();
}

export async function getPersistedAssignment(id: string): Promise<AssignmentRecord | undefined> {
  const result = await documentClient.send(
    new GetCommand({ TableName: TABLES.assignments, Key: { id }, ConsistentRead: true })
  );
  return result.Item as AssignmentRecord | undefined;
}

export async function listPersistedAssignments(courseId: string): Promise<AssignmentRecord[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TABLES.assignments,
      IndexName: INDEXES.assignmentsByCourse,
      KeyConditionExpression: 'courseId = :courseId',
      ExpressionAttributeValues: { ':courseId': courseId },
    })
  );
  return (result.Items ?? []) as AssignmentRecord[];
}

export async function getPersistedSubmission(id: string): Promise<SubmissionRecord | undefined> {
  const result = await documentClient.send(
    new GetCommand({ TableName: TABLES.submissions, Key: { id }, ConsistentRead: true })
  );
  return result.Item as SubmissionRecord | undefined;
}

export async function listPersistedSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TABLES.submissions,
      IndexName: INDEXES.submissionsByAssignment,
      KeyConditionExpression: 'assignmentId = :assignmentId',
      ExpressionAttributeValues: { ':assignmentId': assignmentId },
    })
  );
  return (result.Items ?? []) as SubmissionRecord[];
}
