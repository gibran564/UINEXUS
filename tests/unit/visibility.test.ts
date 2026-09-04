import { describe, expect, it } from 'vitest';
import { pathKey, visibilityAttributes } from '@/lib/aws/dynamo';
import { sanitizeRelativePath, isAllowedExtension, contentTypeFor } from '@/lib/files';
import type { ProjectRecord } from '@/lib/types';

/**
 * Visibilidad y saneado de rutas.
 *
 * `visibilityAttributes` es lo que sustituye a la regla `allow list` de
 * Firestore. Antes, que un `unlisted` no apareciera en la galería dependía de
 * que cada consulta filtrase bien. Ahora depende de que estos atributos NO
 * existan en el elemento: si existen, el proyecto está en el índice de la
 * galería, y ninguna consulta puede sacarlo de ahí.
 */

const base: Pick<ProjectRecord, 'status' | 'hiddenByAdmin' | 'publishedAt'> = {
  status: 'published',
  hiddenByAdmin: false,
  publishedAt: '2026-03-01T10:00:00.000Z',
};

describe('visibilityAttributes', () => {
  it('indexa un proyecto publicado', () => {
    const attributes = visibilityAttributes(base);
    expect(attributes.statusKey).toBe('published');
    expect(attributes.listedAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('NO indexa un unlisted: no puede enumerarse', () => {
    expect(visibilityAttributes({ ...base, status: 'unlisted' })).toEqual({});
  });

  it('NO indexa un borrador', () => {
    expect(visibilityAttributes({ ...base, status: 'draft', publishedAt: null })).toEqual({});
  });

  it('NO indexa un archivado', () => {
    expect(visibilityAttributes({ ...base, status: 'archived' })).toEqual({});
  });

  it('NO indexa lo ocultado por moderación, aunque esté publicado', () => {
    expect(visibilityAttributes({ ...base, hiddenByAdmin: true })).toEqual({});
  });

  it('devuelve un objeto vacío, no claves a null', () => {
    // Una clave presente con valor null seguiría metiendo el elemento en el
    // índice, y una clave de ordenación de DynamoDB no admite null.
    const attributes = visibilityAttributes({ ...base, status: 'draft' });
    expect(Object.keys(attributes)).toHaveLength(0);
    expect('statusKey' in attributes).toBe(false);
  });
});

describe('pathKey', () => {
  it('construye la ruta pública', () => {
    expect(pathKey('alice', 'mi-proyecto')).toBe('alice/mi-proyecto');
  });

  it('distingue proyectos con el mismo slug de personas distintas', () => {
    expect(pathKey('alice', 'tarea-1')).not.toBe(pathKey('bob', 'tarea-1'));
  });
});

describe('saneado de rutas de subida', () => {
  it('acepta rutas relativas normales', () => {
    expect(sanitizeRelativePath('assets/app.js')).toBe('assets/app.js');
  });

  it('rechaza el traversal', () => {
    expect(sanitizeRelativePath('../fuera.html')).toBeNull();
    expect(sanitizeRelativePath('a/../../b')).toBeNull();
  });

  it('vuelve relativa una ruta absoluta en vez de rechazarla', () => {
    // No es un descuido: el resultado queda dentro del prefijo del proyecto,
    // así que `/etc/passwd` acaba siendo un archivo del alumno llamado así.
    // Rechazarlo sólo rompería subidas legítimas de quien arrastra una carpeta.
    expect(sanitizeRelativePath('/etc/passwd')).toBe('etc/passwd');
  });

  it('aplica la lista blanca de extensiones', () => {
    expect(isAllowedExtension('index.html')).toBe(true);
    expect(isAllowedExtension('estilos.css')).toBe(true);
    expect(isAllowedExtension('shell.php')).toBe(false);
    expect(isAllowedExtension('binario.exe')).toBe(false);
    expect(isAllowedExtension('sin-extension')).toBe(false);
  });

  it('deriva el Content-Type de la extensión, no de lo que diga el cliente', () => {
    expect(contentTypeFor('index.html')).toBe('text/html');
    expect(contentTypeFor('app.js')).toBe('text/javascript');
  });
});
