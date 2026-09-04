import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_FILE_LIMITS,
  ACADEMIC_FILE_TYPES,
  FILE_CLASS_BY_DELIVERABLE,
} from '../../src/lib/constants';
import {
  academicFileKey,
  academicFilePrefix,
  isAcademicFileKeyFor,
} from '../../src/lib/aws/s3';
import { mediaDataSchema } from '../../src/lib/academic-schemas';
import { canWorkOnStep, primaryDeliverable } from '../../src/lib/workflow';
import { step, UID } from './academic-fixtures';

/**
 * Archivos académicos (Prioridad 7).
 *
 * Lo que se prueba aquí es lo que decide el SERVIDOR: la ruta, el límite y el
 * tipo. Nada de eso puede venir del cliente, porque el cliente es exactamente
 * quien podría querer subir cinco gigas a la carpeta de otra persona.
 */

describe('la clave la construye el servidor', () => {
  it('sigue el prefijo académico con toda la jerarquía', () => {
    const key = academicFileKey({
      courseId: 'course-dcu',
      uid: UID.christian,
      assignmentId: 'a1',
      stepId: 's2',
      extension: 'mp4',
    });

    expect(key).toMatch(/^academic\/course-dcu\/uid-christian\/a1\/s2\/[\w-]+\.mp4$/);
  });

  it('el nombre del archivo del usuario NO entra en la ruta', () => {
    // Es la defensa contra `../`: el nombre se guarda como etiqueta aparte y la
    // ruta se compone sólo de datos que el servidor ya verificó.
    const key = academicFileKey({
      courseId: 'c',
      uid: 'u',
      assignmentId: 'a',
      stepId: 's',
      extension: 'pdf',
    });
    expect(key).not.toContain('..');
  });

  it('limpia cualquier carácter raro de los identificadores', () => {
    const key = academicFileKey({
      courseId: '../../otro',
      uid: 'u/../x',
      assignmentId: 'a',
      stepId: 's',
      extension: 'png',
    });

    // Los `..` y las barras de más desaparecen: la profundidad de la ruta es
    // siempre la misma.
    expect(key.split('/')).toHaveLength(6);
    expect(key).not.toContain('..');
  });

  it('dos subidas del mismo archivo no colisionan', () => {
    const args = {
      courseId: 'c',
      uid: 'u',
      assignmentId: 'a',
      stepId: 's',
      extension: 'png',
    };
    expect(academicFileKey(args)).not.toBe(academicFileKey(args));
  });

  it('deriva un prefijo canónico con la misma normalización que la clave', () => {
    expect(
      academicFilePrefix({
        courseId: '../../course-dcu',
        uid: UID.christian,
        assignmentId: 'a1',
        stepId: 's2',
      })
    ).toBe('academic/course-dcu/uid-christian/a1/s2/');
  });

  it('vincula la clave emitida con la persona y el paso exactos', () => {
    const owner = {
      courseId: 'course-dcu',
      uid: UID.christian,
      assignmentId: 'a1',
      stepId: 's2',
    };
    const key = academicFileKey({ ...owner, extension: 'pdf' });

    expect(isAcademicFileKeyFor(owner, key)).toBe(true);
    expect(isAcademicFileKeyFor({ ...owner, uid: UID.ana }, key)).toBe(false);
    expect(isAcademicFileKeyFor({ ...owner, stepId: 's3' }, key)).toBe(false);
  });
});

describe('límites por tipo', () => {
  it('cada clase tiene el suyo y son distintos', () => {
    // Reutilizar el límite de una portada (3 MB) para un video haría el
    // entregable inservible.
    expect(ACADEMIC_FILE_LIMITS.image).toBeLessThan(ACADEMIC_FILE_LIMITS.document);
    expect(ACADEMIC_FILE_LIMITS.document).toBeLessThan(ACADEMIC_FILE_LIMITS.video);
  });

  it('el video admite bastante más que una imagen', () => {
    expect(ACADEMIC_FILE_LIMITS.video).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });

  it('cada entregable de archivo tiene su clase de límite', () => {
    expect(FILE_CLASS_BY_DELIVERABLE.image).toBe('image');
    expect(FILE_CLASS_BY_DELIVERABLE.video).toBe('video');
    expect(FILE_CLASS_BY_DELIVERABLE.file).toBe('document');
  });
});

describe('tipos MIME: lista blanca', () => {
  it('lo que no está en la lista no entra', () => {
    expect(ACADEMIC_FILE_TYPES.image['application/x-msdownload']).toBeUndefined();
    expect(ACADEMIC_FILE_TYPES.document['text/html']).toBeUndefined();
    expect(ACADEMIC_FILE_TYPES.video['application/octet-stream']).toBeUndefined();
  });

  it('no se puede colar un ejecutable como imagen', () => {
    expect(ACADEMIC_FILE_TYPES.image['application/octet-stream']).toBeUndefined();
  });

  it('cada clase admite lo razonable y nada más', () => {
    expect(Object.keys(ACADEMIC_FILE_TYPES.image)).toContain('image/png');
    expect(Object.keys(ACADEMIC_FILE_TYPES.document)).toContain('application/pdf');
    expect(Object.keys(ACADEMIC_FILE_TYPES.video)).toContain('video/mp4');
  });

  it('la extensión sale del MIME, no del nombre del archivo', () => {
    // Un `.png` que en realidad es otra cosa se guarda con la extensión que
    // corresponde a su `Content-Type`, que es el que se fija en la condición
    // del POST firmado.
    expect(ACADEMIC_FILE_TYPES.image['image/webp']).toBe('webp');
    expect(ACADEMIC_FILE_TYPES.video['video/quicktime']).toBe('mov');
  });
});

describe('la clave guardada en la entrega', () => {
  it('acepta una clave del espacio académico', () => {
    const parsed = mediaDataSchema.safeParse({
      storageKey: 'academic/curso/uid/a1/s1/abc-123.mp4',
      kind: 'video',
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza una clave de otro prefijo del bucket', () => {
    // Sin esto, alguien podría citar el código de un proyecto ajeno y hacer que
    // el servidor le firmara la lectura.
    expect(
      mediaDataSchema.safeParse({ storageKey: 'projects/otro/uid/v1/index.html' }).success
    ).toBe(false);
    expect(mediaDataSchema.safeParse({ storageKey: '../../secreto' }).success).toBe(false);
  });

  it('la clave es opcional: un enlace externo sigue siendo válido (§19)', () => {
    const parsed = mediaDataSchema.safeParse({
      url: 'https://heygen.com/share/abc',
      kind: 'video',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.storageKey).toBe('');
  });

  it('rechaza un enlace javascript: en el campo de URL', () => {
    expect(mediaDataSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('autorización de la subida', () => {
  it('sólo se sube a un paso propio', () => {
    const mine = step({ id: 's1', assignedTo: [UID.christian] });
    expect(canWorkOnStep(mine, UID.christian)).toBe(true);
    expect(canWorkOnStep(mine, UID.ana)).toBe(false);
  });

  it('la clase de límite la dicta el ENTREGABLE, no lo que pida el cliente', () => {
    const imageStep = step({
      id: 's1',
      deliverables: [{ type: 'image', required: true, hint: '', questions: [] }],
    });
    const deliverable = primaryDeliverable(imageStep);

    // Pedir subir un video a un paso que pide una imagen no da el límite de
    // video: se resuelve por el tipo del paso.
    expect(FILE_CLASS_BY_DELIVERABLE[deliverable.type as 'image']).toBe('image');
    expect(ACADEMIC_FILE_LIMITS[FILE_CLASS_BY_DELIVERABLE[deliverable.type as 'image']]).toBe(
      ACADEMIC_FILE_LIMITS.image
    );
  });

  it('un paso que no pide archivo no tiene clase de límite', () => {
    const textStep = step({
      id: 's1',
      deliverables: [{ type: 'text', required: true, hint: '', questions: [] }],
    });
    const type = primaryDeliverable(textStep).type as 'file' | 'image' | 'video';
    expect(FILE_CLASS_BY_DELIVERABLE[type]).toBeUndefined();
  });
});
