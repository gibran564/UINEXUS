import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireLocalSandbox } from './local-guard.mjs';
import { tableDefinitions } from './table-definitions.mjs';
import { LOCAL_ACCOUNTS, LOCAL_COURSE_ID } from './local-env.mjs';

/**
 * Los datos del sandbox local.
 *
 * ## Todo pasa por el guardián
 *
 * Cada función pública empieza llamando a `requireLocalSandbox()`. No es
 * ceremonia: estas funciones CREAN y BORRAN tablas, y la diferencia entre
 * hacerlo en DynamoDB Local y hacerlo en la cuenta de producción es una variable
 * de entorno. Comprobarlo una vez al arrancar el proceso no basta, porque estas
 * funciones se exportan y alguien podría llamarlas desde otro sitio.
 *
 * ## Qué se siembra, y por qué eso y no más
 *
 * Lo mínimo para poder recorrer el producto de punta a punta:
 *
 *   una materia · con el docente de dueño y el estudiante inscrito
 *   una actividad publicada · con una parte de NexLab
 *   una actividad del formato ANTERIOR · para comprobar compatibilidad
 *   una actividad sencilla · una sola cosa que hacer
 *   una actividad de tres partes · con dependencia y conclusión obligatoria
 *   una actividad de una parte · un programa en un lenguaje sin ejecución
 *
 * Nada de datos de relleno. Treinta actividades de mentira no hacen el recorrido
 * más real; hacen más difícil encontrar la que se está probando.
 *
 * Los PERFILES sí se siembran, aunque `ensureProfile()` los crearía solo al
 * primer acceso. La razón es que el handle y el rol tienen que ser
 * DETERMINISTAS: si los generase `ensureProfile`, el handle dependería del
 * nombre y el orden de las altas, y una prueba de Playwright que navegue a
 * `/@docente-sandbox` fallaría según el día.
 */

const TABLE_NAMES = (prefix) => ({
  users: `${prefix}-users`,
  handles: `${prefix}-handles`,
  projects: `${prefix}-projects`,
  courses: `${prefix}-courses`,
  reports: `${prefix}-reports`,
  assignments: `${prefix}-assignments`,
  submissions: `${prefix}-submissions`,
  prompts: `${prefix}-prompts`,
  skills: `${prefix}-skills`,
  resources: `${prefix}-resources`,
  workspaces: `${prefix}-workspaces`,
});

/** Los mismos nombres de índice que `lib/aws/config.ts`. */
const INDEX_NAMES = {
  usersByHandle: 'byHandle',
  projectsByOwner: 'byOwner',
  projectsByPath: 'byPath',
  projectsByStatus: 'byStatus',
  assignmentsByCourse: 'byCourse',
  submissionsByAssignment: 'byAssignment',
  submissionsByStudent: 'byStudent',
  promptsByCourse: 'byCourse',
  skillsByCourse: 'byCourse',
  resourcesByCourse: 'byCourse',
  workspacesByOwner: 'byOwner',
};

function clients(env) {
  const local = requireLocalSandbox(env);
  const raw = new DynamoDBClient({
    endpoint: local.endpoint,
    region: local.region,
    credentials: { accessKeyId: 'localaccesskey', secretAccessKey: 'localsecretkey' },
  });
  return {
    raw,
    doc: DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }),
    tables: TABLE_NAMES(local.prefix),
    prefix: local.prefix,
  };
}

/** Crea las tablas que falten. Idempotente: una que ya existe no se toca. */
export async function ensureLocalTables(env = process.env, log = console.log) {
  const { raw, tables } = clients(env);
  let created = 0;

  for (const definition of tableDefinitions(tables, INDEX_NAMES)) {
    try {
      await raw.send(new CreateTableCommand(definition));
      await waitUntilTableExists(
        { client: raw, maxWaitTime: 30, minDelay: 1, maxDelay: 1 },
        { TableName: definition.TableName }
      );
      created += 1;
    } catch (error) {
      if (error?.name !== 'ResourceInUseException') throw error;
    }
  }

  log(`Tablas del sandbox listas (${created} creadas en esta ejecución).`);
  raw.destroy();
}

/**
 * Borra las tablas del sandbox.
 *
 * Sólo puede tocar tablas cuyo nombre empieza por el prefijo reservado, porque
 * los nombres se DERIVAN del prefijo que el guardián ya validó. No hay ninguna
 * ruta por la que este código pueda recibir el nombre de una tabla de
 * producción.
 */
export async function dropLocalTables(env = process.env, log = console.log) {
  const { raw, tables, prefix } = clients(env);

  for (const definition of tableDefinitions(tables, INDEX_NAMES)) {
    try {
      await raw.send(new DeleteTableCommand({ TableName: definition.TableName }));
    } catch (error) {
      if (error?.name !== 'ResourceNotFoundException') throw error;
    }
  }

  log(`Tablas del sandbox borradas (prefijo ${prefix}).`);
  raw.destroy();
}

const NOW = '2026-09-11T08:00:00.000Z';

function profileItem(account) {
  return {
    uid: account.uid,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: null,
    bio: null,
    program: null,
    role: account.role,
    projectCount: 0,
    suspended: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const member = (account) => ({
  uid: account.uid,
  handle: account.handle,
  displayName: account.displayName,
  avatarUrl: null,
});

/**
 * La actividad del sandbox.
 *
 * Un solo paso, con entregable `nexbook`: es el recorrido que la Fase 3.5
 * necesita comprobar de verdad —la docente prepara una plantilla de NexLab, el
 * alumnado trabaja en su copia y entrega—. Publicada, porque una actividad en
 * borrador es invisible para el alumnado y el recorrido se quedaría a medias.
 */
function assignmentItem() {
  return {
    id: 'local-assignment-ventas',
    courseId: LOCAL_COURSE_ID,
    title: 'Análisis de ventas en NexLab',
    description:
      'Importa los datos de ventas en la hoja, analízalos con Python o R, e interpreta el resultado.',
    type: 'workflow',
    status: 'published',
    dueAt: null,
    createdBy: LOCAL_ACCOUNTS.teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
    assignedTo: null,
    assignedToAll: true,
    groupAssignments: [],
    materials: [],
    resources: [],
    questions: [],
    collaborative: false,
    contributionsVisible: true,
    workflow: [
      {
        id: 'laboratorio',
        title: 'Tu laboratorio',
        description: 'Trabaja en el NexLab de la actividad y entrégalo cuando esté listo.',
        required: true,
        actionType: 'code',
        dependsOnStepIds: [],
        assignedTo: null,
        deliverables: [{ type: 'nexbook', required: true, hint: '', questions: [] }],
        tool: { mode: 'free', toolIds: [] },
        prompt: null,
      },
    ],
  };
}

/**
 * Una actividad guardada con la forma ANTERIOR al rediseño del constructor.
 *
 * Existe para poder comprobar —a mano y en Playwright— que abrir y volver a
 * guardar una actividad antigua no la convierte en otra cosa. Es deliberadamente
 * del tipo `research` con sus campos en la tarea y sin `workflow`: es la forma
 * que tenía todo lo creado antes de que existieran los procesos.
 */
function legacyAssignmentItem() {
  return {
    id: 'local-assignment-legacy',
    courseId: LOCAL_COURSE_ID,
    title: 'Glosario de conceptos (formato anterior)',
    description: 'Actividad creada con el constructor anterior.',
    instructions: 'Rellena los tres campos de cada concepto.',
    type: 'research',
    status: 'published',
    dueDate: null,
    dueAt: null,
    createdBy: LOCAL_ACCOUNTS.teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
    assignedTo: null,
    assignedToAll: true,
    groupAssignments: [],
    materials: [],
    resources: [],
    resourceLinks: [],
    researchQuestions: [
      {
        id: 'q-definicion',
        group: 'Método símplex',
        groupId: 'g-simplex',
        prompt: 'Definición',
        type: 'long_text',
        required: true,
      },
      {
        id: 'q-fuente',
        group: 'Método símplex',
        groupId: 'g-simplex',
        prompt: 'Fuente',
        type: 'url',
        required: false,
      },
    ],
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    workflow: [],
  };
}

/**
 * La actividad más sencilla que existe.
 *
 * Una sola cosa que hacer y ninguna decisión que tomar. Está sembrada porque es
 * el caso que más importa no estropear: si «escribe tres conclusiones» se
 * siente como un proceso de varias fases, el rediseño habrá empeorado
 * exactamente lo que venía a mejorar.
 */
function simpleAssignmentItem() {
  return {
    id: 'local-assignment-simple',
    courseId: LOCAL_COURSE_ID,
    title: 'Tres conclusiones sobre el método símplex',
    description: 'Lee el material y escribe tres conclusiones con tus palabras.',
    instructions: 'Una conclusión por párrafo. No hace falta más de media página.',
    type: 'freeform',
    status: 'published',
    dueDate: null,
    dueAt: null,
    createdBy: LOCAL_ACCOUNTS.teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
    assignedTo: null,
    assignedToAll: true,
    groupAssignments: [],
    materials: [],
    resources: [],
    resourceLinks: [],
    researchQuestions: [],
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    workflow: [],
  };
}

/**
 * Una actividad de varias partes, con dependencia y con conclusión obligatoria.
 *
 * Las tres cosas caben en una sola actividad y conviene que quepan: probarlas
 * por separado necesitaría tres fixtures que decir lo mismo, y aquí la
 * combinación es justo lo que hay que ver funcionando —la Parte 2 arranca
 * bloqueada, se abre al completar la 1, y su registro de IA no deja entregar
 * sin conclusión—.
 */
function processAssignmentItem() {
  return {
    id: 'local-assignment-proceso',
    courseId: LOCAL_COURSE_ID,
    title: 'Comparar dos métodos de solución',
    description: 'Prepara los datos, documenta cómo usaste una IA y saca tu conclusión.',
    instructions: 'Las partes se hacen en orden: la segunda necesita la primera.',
    type: 'workflow',
    status: 'published',
    dueDate: null,
    dueAt: null,
    createdBy: LOCAL_ACCOUNTS.teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
    assignedTo: null,
    assignedToAll: true,
    groupAssignments: [],
    materials: [],
    resources: [],
    resourceLinks: [],
    researchQuestions: [],
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    workflow: [
      {
        id: 'preparar',
        order: 0,
        title: 'Preparar los datos',
        description: '',
        instructions: 'Escribe qué dos métodos vas a comparar y con qué caso.',
        required: true,
        actionType: 'text_response',
        dependsOnStepIds: [],
        assignedTo: null,
        deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
        tool: { mode: 'none', toolIds: [], toolNames: [] },
        prompt: null,
      },
      {
        id: 'registro-ia',
        order: 1,
        title: 'Registrar uso de IA',
        description: '',
        instructions: 'Documenta cómo usaste la IA para comparar los dos métodos.',
        required: true,
        actionType: 'ai_interaction',
        // La que hace que la Parte 2 empiece bloqueada.
        dependsOnStepIds: ['preparar'],
        assignedTo: null,
        deliverables: [
          {
            type: 'ai_worklog',
            required: true,
            hint: '',
            questions: [],
            // La que impide entregar sin escribir la conclusión.
            conclusionMode: 'required',
          },
        ],
        tool: { mode: 'free', toolIds: [], toolNames: [] },
        prompt: null,
      },
      {
        id: 'conclusion',
        order: 2,
        title: 'Escribir tu conclusión',
        description: '',
        instructions: 'Con qué método te quedas y por qué.',
        required: true,
        actionType: 'text_response',
        dependsOnStepIds: [],
        assignedTo: null,
        deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
        tool: { mode: 'none', toolIds: [], toolNames: [] },
        prompt: null,
      },
    ],
  };
}

/**
 * Una actividad de UNA sola parte que pide un programa.
 *
 * Dos cosas se comprueban con ella y no con otra. La primera es el caso que la
 * fase anterior rompió: una actividad por partes con una sola parte, que no
 * cabe en ninguna forma antigua y por eso se guarda como proceso. La segunda es
 * un lenguaje que Nextudio SABE ESCRIBIR PERO NO EJECUTAR —Java— con la
 * ejecución pedida por la docente: la pantalla tiene que decir que no se puede
 * ejecutar aquí, en vez de enseñar un botón muerto.
 */
function codeAssignmentItem() {
  return {
    id: 'local-assignment-codigo',
    courseId: LOCAL_COURSE_ID,
    title: 'Implementar el algoritmo en Java',
    description: 'Escribe el método y explica su complejidad.',
    instructions: 'Puedes escribirlo aquí y entregarlo sin salir de Nextudio.',
    type: 'workflow',
    status: 'published',
    dueDate: null,
    dueAt: null,
    createdBy: LOCAL_ACCOUNTS.teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
    assignedTo: null,
    assignedToAll: true,
    groupAssignments: [],
    materials: [],
    resources: [],
    resourceLinks: [],
    researchQuestions: [],
    collaborationMode: 'individual',
    contributionVisibility: 'group',
    workflow: [
      {
        id: 'programa',
        order: 0,
        title: 'Tu programa',
        description: '',
        instructions: 'Implementa el método `resolver` y explica su complejidad.',
        required: true,
        actionType: 'code',
        dependsOnStepIds: [],
        assignedTo: null,
        deliverables: [
          {
            type: 'code',
            required: true,
            hint: '',
            questions: [],
            language: 'java',
            codeMode: 'editor',
            starterCode: 'public class Solucion {\n  static int resolver(int[] datos) {\n    return 0;\n  }\n}\n',
            executionEnabled: true,
          },
        ],
        tool: { mode: 'none', toolIds: [], toolNames: [] },
        prompt: null,
      },
    ],
  };
}

/**
 * Las actividades cuyas entregas se borran al sembrar.
 *
 * ## Por qué se borran, si el sandbox conserva todo lo demás
 *
 * Porque estas dos son FIXTURES de recorridos, y sus recorridos dependen del
 * punto de partida: uno comprueba que la Parte 2 empieza bloqueada hasta
 * completar la 1, y otro que una actividad sencilla se entrega desde cero. Una
 * entrega dejada por la ejecución anterior convertiría las dos pruebas en un
 * caso distinto del que dicen probar, y —peor— en uno que pasa o falla según
 * cuántas veces se hayan ejecutado antes.
 *
 * El resto del sandbox NO se toca: lo que alguien cree explorando a mano sigue
 * ahí entre arranques, y `--reset` sigue siendo la forma explícita de empezar
 * de cero. `local-assignment-ventas` tampoco está en esta lista, justamente
 * porque es la que se usa para explorar a mano.
 */
const RESETTABLE_ASSIGNMENTS = ['local-assignment-simple', 'local-assignment-proceso'];

async function clearSubmissionsOf(doc, tables, assignmentId) {
  const { Items = [] } = await doc.send(
    new QueryCommand({
      TableName: tables.submissions,
      IndexName: INDEX_NAMES.submissionsByAssignment,
      KeyConditionExpression: 'assignmentId = :assignmentId',
      ExpressionAttributeValues: { ':assignmentId': assignmentId },
    })
  );

  for (const item of Items) {
    await doc.send(new DeleteCommand({ TableName: tables.submissions, Key: { id: item.id } }));
  }

  return Items.length;
}

/** Siembra perfiles, handles, materia y actividades. Idempotente. */
export async function seedLocalData(env = process.env, log = console.log) {
  const { raw, doc, tables } = clients(env);
  const { teacher, student } = LOCAL_ACCOUNTS;

  const put = (TableName, Item) => doc.send(new PutCommand({ TableName, Item }));

  await put(tables.users, profileItem(teacher));
  await put(tables.users, profileItem(student));
  await put(tables.handles, { handle: teacher.handle, uid: teacher.uid, createdAt: NOW });
  await put(tables.handles, { handle: student.handle, uid: student.uid, createdAt: NOW });

  await put(tables.courses, {
    id: LOCAL_COURSE_ID,
    slug: 'investigacion-de-operaciones-sandbox',
    name: 'Investigación de Operaciones — Sandbox',
    institution: 'Instituto Tecnológico de Durango',
    term: 'Ago–Dic 2026',
    academicPeriod: 'Ago–Dic 2026',
    description: 'Materia del entorno local. No existe fuera de esta máquina.',
    teacherName: teacher.displayName,
    studentCount: 1,
    projectCount: 0,
    activities: [],
    code: 'LOC123',
    teachers: [member(teacher)],
    students: [member(student)],
    visibility: 'private',
    createdBy: teacher.uid,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await put(tables.assignments, assignmentItem());
  await put(tables.assignments, legacyAssignmentItem());
  await put(tables.assignments, simpleAssignmentItem());
  await put(tables.assignments, processAssignmentItem());
  await put(tables.assignments, codeAssignmentItem());

  let cleared = 0;
  for (const assignmentId of RESETTABLE_ASSIGNMENTS) {
    cleared += await clearSubmissionsOf(doc, tables, assignmentId);
  }

  log('Datos del sandbox sembrados:');
  if (cleared > 0) {
    log(`  Entregas de las actividades de prueba borradas (${cleared}).`);
  }
  log(`  Materia    Investigación de Operaciones — Sandbox (${LOCAL_COURSE_ID})`);
  log(`  Docente    ${teacher.email}`);
  log(`  Estudiante ${student.email}`);
  raw.destroy();
}

/**
 * Las dos cuentas, dentro del EMULADOR de Firebase.
 *
 * `firebase-admin` habla con el emulador en cuanto ve `FIREBASE_AUTH_EMULATOR_HOST`,
 * y el proyecto `demo-uinexus` no existe en Google: el SDK se niega a salir a la
 * red con un proyecto `demo-*`. Los `uid` se fijan a mano para que sean
 * deterministas y coincidan con los perfiles ya sembrados.
 */
export async function seedLocalAccounts(env = process.env, log = console.log) {
  const { requireLocalFirebase } = await import('./local-guard.mjs');
  const { projectId } = requireLocalFirebase(env);

  const { initializeApp, getApps, deleteApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');

  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.FIREBASE_AUTH_EMULATOR_HOST;
  const app = getApps()[0] ?? initializeApp({ projectId }, 'local-sandbox-seed');
  const auth = getAuth(app);

  for (const account of Object.values(LOCAL_ACCOUNTS)) {
    const record = {
      uid: account.uid,
      email: account.email,
      password: account.password,
      displayName: account.displayName,
      emailVerified: true,
    };
    try {
      await auth.createUser(record);
      log(`  + ${account.email} (${account.role})`);
    } catch (error) {
      if (error?.errorInfo?.code !== 'auth/uid-already-exists') throw error;
      // Ya existía de un arranque anterior: se actualiza para que la contraseña
      // siga siendo la documentada aunque alguien la cambiara probando.
      await auth.updateUser(account.uid, {
        email: account.email,
        password: account.password,
        displayName: account.displayName,
        emailVerified: true,
      });
      log(`  · ${account.email} ya existía (${account.role})`);
    }
  }

  await deleteApp(app);
}
