import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_TABLE_PREFIX,
  NotLocalError,
  isLoopbackEndpoint,
  requireLocalFirebase,
  requireLocalSandbox,
} from '../../scripts/lib/local-guard.mjs';
import { tableDefinitions, tablePrimaryKeys } from '../../scripts/lib/table-definitions.mjs';
import { INDEXES, TABLES } from '../../src/lib/aws/config';

/**
 * El sandbox local, y por qué no puede tocar producción.
 *
 * Estas pruebas existen por una razón muy concreta: el `.env.local` de una
 * máquina de desarrollo apunta a Firebase y AWS REALES, y los comandos del
 * sandbox CREAN y BORRAN tablas. La diferencia entre hacerlo en DynamoDB Local y
 * hacerlo en la cuenta de la institución es una variable de entorno mal puesta.
 *
 * Se prueba además que las definiciones de tabla son UNA sola y que coinciden
 * con `infra/uinexus.cfn.yaml`, que es lo que cierra R12 de verdad: no por
 * vigilancia, sino porque ya no hay copias que sincronizar.
 */

/** Todos los archivos de código de un árbol. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const LOCAL_ENV = {
  UINEXUS_DYNAMODB_ENDPOINT: 'http://127.0.0.1:8100',
  UINEXUS_TABLE_PREFIX: 'uinexus-local',
  UINEXUS_AWS_ACCESS_KEY_ID: 'localaccesskey',
  UINEXUS_AWS_REGION: 'us-east-1',
};

const LOCAL_FIREBASE = {
  NEXT_PUBLIC_FIREBASE_USE_EMULATORS: 'true',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-uinexus',
};

describe('el guardián del sandbox', () => {
  it('acepta un DynamoDB del propio equipo con el prefijo reservado', () => {
    expect(requireLocalSandbox(LOCAL_ENV)).toEqual({
      endpoint: 'http://127.0.0.1:8100',
      prefix: 'uinexus-local',
      region: 'us-east-1',
    });
  });

  it('SIN endpoint se niega: el SDK hablaría con DynamoDB de AWS', () => {
    // Es el caso más peligroso y el más fácil de provocar: basta con olvidar
    // una variable para que el destino pase a ser la cuenta real.
    const { UINEXUS_DYNAMODB_ENDPOINT: _omitted, ...withoutEndpoint } = LOCAL_ENV;
    expect(() => requireLocalSandbox(withoutEndpoint)).toThrow(NotLocalError);
  });

  it('rechaza cualquier destino que no sea el bucle local', () => {
    const hostiles = [
      'https://dynamodb.us-east-1.amazonaws.com',
      'http://dynamodb.us-east-1.amazonaws.com',
      'https://127.0.0.1:8100',
      'http://192.168.1.50:8100',
      'http://evil.example.com:8100',
      // El clásico: un host que CONTIENE «localhost» pero no lo es.
      'http://localhost.evil.com:8100',
      'no-es-una-url',
      '',
    ];

    for (const endpoint of hostiles) {
      expect(isLoopbackEndpoint(endpoint), endpoint).toBe(false);
      expect(
        () => requireLocalSandbox({ ...LOCAL_ENV, UINEXUS_DYNAMODB_ENDPOINT: endpoint }),
        endpoint
      ).toThrow(NotLocalError);
    }
  });

  it('rechaza un prefijo de tablas que no sea el del sandbox', () => {
    for (const prefix of ['uinexus', 'uinexus-prod', '', 'produccion']) {
      expect(
        () => requireLocalSandbox({ ...LOCAL_ENV, UINEXUS_TABLE_PREFIX: prefix }),
        prefix
      ).toThrow(NotLocalError);
    }
    // Y el del runner de integración tampoco es éste: cada uno con el suyo.
    expect(() =>
      requireLocalSandbox({ ...LOCAL_ENV, UINEXUS_TABLE_PREFIX: 'uinexus-integration-1' })
    ).toThrow(NotLocalError);
  });

  it('rechaza credenciales de AWS reales en el entorno', () => {
    /**
     * DynamoDB Local acepta cualquier credencial, así que su presencia no
     * rompería nada por sí sola. Lo que significa es que este proceso heredó la
     * configuración de producción, que es el estado en el que un endpoint mal
     * escrito acaba escribiendo en la cuenta real.
     */
    expect(() =>
      requireLocalSandbox({ ...LOCAL_ENV, UINEXUS_AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE' })
    ).toThrow(NotLocalError);
  });

  it('el prefijo reservado es el que usan los scripts', () => {
    expect(LOCAL_TABLE_PREFIX).toBe('uinexus-local');
  });
});

describe('el guardián de Firebase', () => {
  it('acepta el proyecto del emulador con el interruptor puesto', () => {
    expect(requireLocalFirebase(LOCAL_FIREBASE)).toEqual({ projectId: 'demo-uinexus' });
  });

  it('rechaza el proyecto REAL aunque el interruptor esté puesto', () => {
    expect(() =>
      requireLocalFirebase({ ...LOCAL_FIREBASE, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'uinexus-f379f' })
    ).toThrow(NotLocalError);
  });

  it('rechaza si el interruptor de emuladores no está', () => {
    expect(() =>
      requireLocalFirebase({ ...LOCAL_FIREBASE, NEXT_PUBLIC_FIREBASE_USE_EMULATORS: 'false' })
    ).toThrow(NotLocalError);
  });

  it('rechaza si hay una cuenta de servicio en el entorno', () => {
    // El sandbox nunca la necesita: el emulador no verifica firmas de Google.
    expect(() =>
      requireLocalFirebase({ ...LOCAL_FIREBASE, FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' })
    ).toThrow(NotLocalError);
  });
});

describe('el endpoint local NO se puede activar en producción', () => {
  const CONFIG = readFileSync(
    fileURLToPath(new URL('../../src/lib/aws/config.ts', import.meta.url)),
    'utf8'
  );

  it('las dos puertas exigen un NODE_ENV que no es `production`', () => {
    /**
     * La garantía se lee en el código porque el módulo evalúa su guarda al
     * importarse: no se puede reimportar con otro `NODE_ENV` dentro de la misma
     * suite sin trucos que probarían el truco y no la guarda.
     *
     * Lo que se fija es que no exista ninguna combinación de variables que abra
     * el endpoint en un despliegue: una puerta pide `test` y la otra
     * `development`, y las dos exigen además su propio interruptor.
     */
    expect(CONFIG).toContain("process.env.NODE_ENV === 'test'");
    expect(CONFIG).toContain("process.env.UINEXUS_INTEGRATION_TESTS === 'true'");
    expect(CONFIG).toContain("process.env.NODE_ENV === 'development'");
    expect(CONFIG).toContain("process.env.UINEXUS_LOCAL_SANDBOX === 'true'");
    expect(CONFIG).toContain('!integrationRuntime && !localSandboxRuntime');

    // Y ninguna de las dos admite `production`.
    expect(CONFIG).not.toMatch(/NODE_ENV === 'production'[^\n]*DYNAMODB/);
  });

  it('el interruptor del sandbox gobierna UNA sola cosa', () => {
    /**
     * Si `UINEXUS_LOCAL_SANDBOX` decidiera algo más, dejaría de ser la llave del
     * endpoint y pasaría a ser un MODO de la aplicación: un sitio donde el
     * comportamiento de producción y el local divergen sin que nadie lo vea.
     *
     * Se cuentan las LECTURAS de la variable, no sus menciones: el comentario que
     * la explica la nombra, y eso es deseable.
     */
    expect((CONFIG.match(/process\.env\.UINEXUS_LOCAL_SANDBOX/g) ?? []).length).toBe(1);
  });

  it('y ningún otro archivo de `src/` la lee', () => {
    const sources = sourceFiles(fileURLToPath(new URL('../../src', import.meta.url)));
    const others = sources.filter(
      (file) =>
        !file.endsWith(`${sep}config.ts`) &&
        readFileSync(file, 'utf8').includes('UINEXUS_LOCAL_SANDBOX')
    );

    expect(others).toEqual([]);
  });
});

describe('R12: las definiciones de tabla son UNA sola', () => {
  const definitions = tableDefinitions(TABLES, INDEXES);
  const CFN = readFileSync(
    fileURLToPath(new URL('../../infra/uinexus.cfn.yaml', import.meta.url)),
    'utf8'
  );

  it('declara las once tablas del proyecto', () => {
    expect(definitions.map((definition) => definition.TableName).sort()).toEqual(
      Object.values(TABLES).sort()
    );
  });

  it('cada tabla de la plantilla de CloudFormation está aquí', () => {
    /**
     * Ésta es la prueba que cierra R12. Hasta ahora las definiciones vivían en
     * tres sitios y la única defensa era acordarse; costó dos fallos
     * —`projects.byOwner` y `projects.byPath`— que sólo aparecieron cuando una
     * ruta nueva consultó una tabla que la suite no tocaba.
     */
    const cfnTables = [...CFN.matchAll(/TableName:\s*!Sub\s*'\$\{Prefix\}-([a-z]+)'/g)].map(
      (match) => match[1]
    );

    expect(cfnTables.length).toBeGreaterThan(0);
    for (const table of cfnTables) {
      expect(
        definitions.some((definition) => definition.TableName?.endsWith(`-${table}`)),
        table
      ).toBe(true);
    }
  });

  it('cada índice de la plantilla existe en su tabla', () => {
    const byTable = new Map(
      definitions.map((definition) => [
        definition.TableName?.replace(/^.*?-/, '') ?? '',
        (definition.GlobalSecondaryIndexes ?? []).map((index) => index.IndexName),
      ])
    );

    // Se comprueban los que costaron los dos fallos, más los de uso diario.
    expect(byTable.get('projects')).toEqual(['byOwner', 'byPath', 'byStatus']);
    expect(byTable.get('users')).toEqual(['byHandle']);
    expect(byTable.get('submissions')).toEqual(['byAssignment', 'byStudent']);
    expect(byTable.get('workspaces')).toEqual(['byOwner']);
    // `handles`, `courses` y `reports` no tienen GSI en la plantilla.
    expect(byTable.get('handles')).toEqual([]);
    expect(byTable.get('courses')).toEqual([]);
    expect(byTable.get('reports')).toEqual([]);
  });

  it('todo índice declarado se corresponde con un atributo de la tabla', () => {
    // Un GSI cuya clave no está en `AttributeDefinitions` hace fallar la
    // creación de la tabla, y el mensaje de DynamoDB no dice cuál falta.
    for (const definition of definitions) {
      const attributes = new Set(
        (definition.AttributeDefinitions ?? []).map((attribute) => attribute.AttributeName)
      );
      for (const index of definition.GlobalSecondaryIndexes ?? []) {
        for (const key of index.KeySchema ?? []) {
          expect(attributes.has(key.AttributeName), `${definition.TableName}/${key.AttributeName}`).toBe(
            true
          );
        }
      }
    }
  });

  it('cada tabla sabe cuál es su clave primaria, para poder vaciarla', () => {
    const keys = tablePrimaryKeys(TABLES);
    for (const definition of definitions) {
      const hash = (definition.KeySchema ?? []).find((key) => key.KeyType === 'HASH');
      expect(keys.get(definition.TableName ?? ''), definition.TableName).toBe(hash?.AttributeName);
    }
  });
});

describe('R13: `coursesBySlug` se retiró', () => {
  it('ya no existe la constante que nombraba un índice inexistente', () => {
    // `CoursesTable` del CFN no declara ningún GSI. La constante no rompía nada
    // porque nadie la usaba, pero quien la viera la habría usado —y habría
    // fallado en producción—. Ver la nota en `lib/aws/config.ts`.
    expect('coursesBySlug' in INDEXES).toBe(false);
  });

  it('y el índice NO se creó para justificarla', () => {
    const CFN = readFileSync(
      fileURLToPath(new URL('../../infra/uinexus.cfn.yaml', import.meta.url)),
      'utf8'
    );
    const courses = /CoursesTable:[\s\S]*?(?=\n  [A-Z]\w+:)/.exec(CFN)?.[0] ?? '';

    expect(courses).toContain('-courses');
    expect(courses).not.toContain('GlobalSecondaryIndexes');
  });
});
