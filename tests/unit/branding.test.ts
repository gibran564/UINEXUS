import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE } from '../../src/lib/constants';
import { INDEXES, TABLES } from '../../src/lib/aws/config';
import { NEXBOOK_ARCHIVE_FORMAT } from '../../src/lib/nexbook-archive';
import { isReservedHandle } from '../../src/lib/slug';

/**
 * La marca, y la frontera con la infraestructura.
 *
 * Esta suite existe por un riesgo muy concreto del rebranding: un reemplazo
 * global sobre `uinexus` renombraría tablas de DynamoDB, prefijos de S3,
 * variables de entorno y el formato de los archivos `.nexbook` ya exportados,
 * y nada de eso daría error de compilación. Fallaría en producción, contra
 * datos reales, y tarde.
 *
 * Así que se fija lo que NO puede moverse y se comprueba lo que SÍ tenía que
 * cambiar. Ver `docs/NEXTUDIO-ROADMAP.md` §D2.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(full);
  }
  return found;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));

describe('la identidad del producto', () => {
  it('se llama Nextudio, y el nombre sale de un solo sitio', () => {
    expect(SITE.name).toBe('Nextudio');
    expect(SITE.tagline).toBe('Aprende construyendo.');
    expect(SITE.description).toContain('laboratorios');
  });

  /**
   * Una sola escritura.
   *
   * `NeXtudio` es un dibujo del wordmark, no una ortografía: la `x` se enfatiza
   * con peso y color, nunca con una mayúscula. Si alguien escribe la variante en
   * una cadena, acaba en un `<title>`, en un correo o en un lector de pantalla.
   */
  it('no admite variantes de capitalización', () => {
    const prohibidas = ['NEXTUDIO', 'NeXtudio', 'NexTudio', 'NextUdio'];
    const culpables: string[] = [];

    for (const file of FILES) {
      // `NEXTUDIO-ROADMAP.md` es el nombre de un archivo citado en comentarios,
      // no una forma de escribir la marca. Se descuenta antes de mirar.
      const text = file.text.split('NEXTUDIO-ROADMAP').join('');
      for (const variante of prohibidas) {
        if (text.includes(variante)) culpables.push(`${file.path}: ${variante}`);
      }
    }

    expect(culpables).toEqual([]);
  });

  it('ninguna fuente escribe ya la marca anterior', () => {
    const culpables = FILES.filter((file) => file.text.includes('UINexus')).map(
      (file) => file.path
    );
    expect(culpables).toEqual([]);
  });
});

describe('la infraestructura NO se renombró', () => {
  /**
   * Los nombres de tabla son datos, no texto.
   *
   * Se fijan uno a uno y no con un bucle sobre el prefijo: un bucle seguiría
   * pasando si alguien cambiara el prefijo por defecto, que es exactamente el
   * error que esta prueba viene a impedir.
   */
  it('conserva las tablas de DynamoDB', () => {
    expect(TABLES).toEqual({
      users: 'uinexus-users',
      handles: 'uinexus-handles',
      projects: 'uinexus-projects',
      courses: 'uinexus-courses',
      reports: 'uinexus-reports',
      assignments: 'uinexus-assignments',
      submissions: 'uinexus-submissions',
      prompts: 'uinexus-prompts',
      skills: 'uinexus-skills',
      resources: 'uinexus-resources',
      workspaces: 'uinexus-workspaces',
    });
  });

  it('conserva los índices', () => {
    expect(INDEXES.projectsByOwner).toBe('byOwner');
    expect(INDEXES.workspacesByOwner).toBe('byOwner');
    expect(INDEXES.submissionsByStudent).toBe('byStudent');
  });

  /**
   * El formato del contenedor `.nexbook` es un dato PERSISTIDO: viaja dentro de
   * cada archivo exportado y el importador lo compara. Cambiarlo convertiría en
   * ilegible todo lo que alguien haya exportado hasta hoy.
   */
  it('conserva el formato de los archivos .nexbook ya exportados', () => {
    expect(NEXBOOK_ARCHIVE_FORMAT).toBe('uinexus-nexbook');
  });

  it('conserva las variables de entorno y los prefijos de S3', () => {
    const config = FILES.find((file) => file.path.endsWith(join('aws', 'config.ts')))!;
    for (const nombre of [
      'UINEXUS_AWS_REGION',
      'UINEXUS_TABLE_PREFIX',
      'UINEXUS_PROJECTS_BUCKET',
      'UINEXUS_PUBLIC_BUCKET',
      'UINEXUS_AWS_ACCESS_KEY_ID',
    ]) {
      expect(config.text, nombre).toContain(nombre);
    }

    const s3 = FILES.find((file) => file.path.endsWith(join('aws', 's3.ts')))!;
    for (const prefijo of ['projects/', 'academic/', 'nexbook/']) {
      expect(s3.text, prefijo).toContain(prefijo);
    }
  });
});

describe('los handles reservados', () => {
  it('reservan el nombre nuevo sin liberar el anterior', () => {
    expect(isReservedHandle('nextudio')).toBe(true);
    expect(isReservedHandle('nexlab')).toBe(true);
    expect(isReservedHandle('nexcode')).toBe(true);
    // Liberarlo permitiría a cualquiera hacerse pasar por la plataforma anterior.
    expect(isReservedHandle('uinexus')).toBe(true);
  });

  it('no reserva de más', () => {
    expect(isReservedHandle('ana')).toBe(false);
    expect(isReservedHandle('nexo')).toBe(false);
  });
});
