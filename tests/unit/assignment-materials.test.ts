import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_FILE_EXTENSIONS,
  ACADEMIC_FILE_LIMITS,
  ACADEMIC_FILE_TYPES,
  ACADEMIC_LIMITS,
} from '../../src/lib/constants';
import {
  allowedExtensionsFor,
  fileExtensionOf,
  isWithinAcademicLimit,
  resolveAcademicUpload,
} from '../../src/lib/academic-files';
import {
  assignmentMaterialKey,
  assignmentMaterialPrefix,
  isAcademicFileKeyFor,
  isAssignmentMaterialKeyFor,
} from '../../src/lib/aws/s3';
import { materialConfirmSchema, materialUploadRequestSchema } from '../../src/lib/academic-schemas';
import { toAssignment } from '../../src/lib/data/academic-mappers';
import { assignment, course, material, UID } from './academic-fixtures';

/**
 * Materiales de la tarea: los archivos que reparte el profesorado.
 *
 * Son un concepto DISTINTO de las entregas, y la mitad de lo que se prueba aquí
 * es justamente que no se puedan confundir: una clave de material no puede
 * pasar por una clave de entrega ni al revés, porque si pudieran, el permiso de
 * lectura de una serviría para la otra.
 */

const OWNER = { courseId: 'course-dcu', assignmentId: 'a1' };

describe('la clave de un material la construye el servidor', () => {
  it('vive en su propio espacio, separado del de las entregas', () => {
    expect(assignmentMaterialPrefix(OWNER)).toBe('academic/materials/course-dcu/a1/');
  });

  it('sigue bajo `academic/`, que es lo único que se puede firmar para leer', () => {
    expect(assignmentMaterialKey({ ...OWNER, extension: 'docx' })).toMatch(/^academic\//);
  });

  it('el nombre del archivo NO entra en la ruta', () => {
    const key = assignmentMaterialKey({ ...OWNER, extension: 'xlsx' });
    expect(key).toMatch(/^academic\/materials\/course-dcu\/a1\/[\w-]+\.xlsx$/);
    expect(key).not.toContain('..');
  });

  it('limpia identificadores con travesía', () => {
    const key = assignmentMaterialKey({
      courseId: '../../otro',
      assignmentId: 'a/../b',
      extension: 'pdf',
    });
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(5);
  });

  it('dos subidas del mismo archivo no colisionan', () => {
    const args = { ...OWNER, extension: 'pdf' };
    expect(assignmentMaterialKey(args)).not.toBe(assignmentMaterialKey(args));
  });

  it('vincula la clave con LA tarea: la de otra no cuela', () => {
    const key = assignmentMaterialKey({ ...OWNER, extension: 'pdf' });

    expect(isAssignmentMaterialKeyFor(OWNER, key)).toBe(true);
    expect(isAssignmentMaterialKeyFor({ ...OWNER, assignmentId: 'a2' }, key)).toBe(false);
    expect(isAssignmentMaterialKeyFor({ ...OWNER, courseId: 'otra' }, key)).toBe(false);
  });

  it('una clave de material NUNCA pasa por una clave de entrega', () => {
    // Es la separación que impide que el permiso de lectura de una sirva para
    // la otra: las dos formas de ruta no pueden confundirse.
    const materialKey = assignmentMaterialKey({ ...OWNER, extension: 'pdf' });

    expect(
      isAcademicFileKeyFor(
        { courseId: 'course-dcu', uid: UID.christian, assignmentId: 'a1', stepId: 's1' },
        materialKey
      )
    ).toBe(false);
  });

  it('una clave de entrega NUNCA pasa por una clave de material', () => {
    const submissionKey = 'academic/course-dcu/uid-christian/a1/s1/abc.pdf';
    expect(isAssignmentMaterialKeyFor(OWNER, submissionKey)).toBe(false);
  });
});

describe('qué archivos admite un material', () => {
  it('admite los formatos académicos comunes', () => {
    for (const extension of ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv']) {
      expect(ACADEMIC_FILE_EXTENSIONS.material[extension]).toBeTruthy();
    }
  });

  it('admite un ejemplo en R', () => {
    expect(resolveAcademicUpload('material', { fileName: 'ejemplo.R', contentType: '' })).toEqual({
      extension: 'r',
      contentType: 'text/plain',
    });
  });

  it('NO admite ejecutables ni contenido activo', () => {
    for (const fileName of ['virus.exe', 'script.sh', 'macro.bat', 'pagina.html', 'logo.svg']) {
      expect(resolveAcademicUpload('material', { fileName, contentType: '' })).toBeNull();
    }
  });

  it('un ejecutable disfrazado de PDF por su tipo declarado se rechaza', () => {
    expect(
      resolveAcademicUpload('material', {
        fileName: 'informe.pdf',
        contentType: 'application/x-msdownload',
      })
    ).toBeNull();
  });

  it('el límite de un material es el de un documento, no el de un video', () => {
    expect(ACADEMIC_FILE_LIMITS.material).toBe(ACADEMIC_FILE_LIMITS.document);
    expect(isWithinAcademicLimit('material', ACADEMIC_FILE_LIMITS.material)).toBe(true);
    expect(isWithinAcademicLimit('material', ACADEMIC_FILE_LIMITS.material + 1)).toBe(false);
  });

  it('la lista de extensiones se puede decir en un mensaje', () => {
    expect(allowedExtensionsFor('material')).toContain('.docx');
    expect(allowedExtensionsFor('material')).toContain('.r');
  });
});

describe('el cuerpo de las peticiones', () => {
  it('pedir subida exige nombre y tamaño', () => {
    expect(
      materialUploadRequestSchema.safeParse({
        fileName: 'Datos.xlsx',
        contentType: '',
        sizeBytes: 2048,
      }).success
    ).toBe(true);

    expect(materialUploadRequestSchema.safeParse({ fileName: '', sizeBytes: 10 }).success).toBe(
      false
    );
    expect(
      materialUploadRequestSchema.safeParse({ fileName: 'a.pdf', sizeBytes: 0 }).success
    ).toBe(false);
  });

  it('registrar exige una clave del espacio de materiales', () => {
    const ok = materialConfirmSchema.safeParse({
      storageKey: 'academic/materials/course-dcu/a1/abc-123.docx',
      fileName: 'Plantilla.docx',
      kind: 'template',
      sizeBytes: 1024,
    });
    expect(ok.success).toBe(true);
  });

  it('rechaza cualquier clave que no sea de materiales', () => {
    // Sin esto, conocer una ruta bastaría para colgar en la tarea el archivo de
    // otra persona y conseguir que el servidor firmara su lectura para el grupo.
    for (const storageKey of [
      'academic/course-dcu/uid-ana/a1/s1/entrega.pdf',
      'projects/otro/uid/v1/index.html',
      '../../secreto',
      '',
    ]) {
      expect(
        materialConfirmSchema.safeParse({ storageKey, fileName: 'x.pdf' }).success,
        storageKey
      ).toBe(false);
    }
  });

  it('la clase por defecto es «material», no «plantilla»', () => {
    const parsed = materialConfirmSchema.safeParse({
      storageKey: 'academic/materials/course-dcu/a1/abc-123.pdf',
      fileName: 'Caso.pdf',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('resource');
  });

  it('una tarea admite un número acotado de archivos', () => {
    expect(ACADEMIC_LIMITS.maxMaterialsPerAssignment).toBeGreaterThan(0);
    expect(ACADEMIC_LIMITS.maxMaterialsPerAssignment).toBeLessThanOrEqual(50);
  });
});

describe('lo que llega al navegador', () => {
  it('el DTO conserva el material y NO el UID de quien lo subió', () => {
    const dto = toAssignment(assignment({ materials: [material()] }), {
      viewerRole: 'student',
      roster: course().students,
    });

    expect(dto.materials).toHaveLength(1);
    expect(dto.materials[0]).toMatchObject({
      kind: 'template',
      displayName: 'Plantilla del reporte',
      fileName: 'plantilla-reporte.docx',
    });
    expect(JSON.stringify(dto.materials)).not.toContain(UID.luz);
  });

  it('el alumnado ve los materiales: repartirlos es justamente su función', () => {
    const dto = toAssignment(assignment({ materials: [material(), material({ id: 'm2' })] }), {
      viewerRole: 'student',
    });
    expect(dto.materials).toHaveLength(2);
  });

  it('conserva el nombre de quien lo subió, que no es dato de terceros', () => {
    const dto = toAssignment(assignment({ materials: [material()] }), { viewerRole: 'teacher' });
    expect(dto.materials[0]?.uploadedByName).toBe('Luz Adriana Márquez');
  });

  it('una tarea SIN materiales sigue funcionando', () => {
    // Compatibilidad hacia atrás: lo que era una tarea antes de esta iteración
    // es exactamente una tarea con la lista vacía.
    const dto = toAssignment(assignment(), { viewerRole: 'student' });
    expect(dto.materials).toEqual([]);
  });
});

describe('utilidades del nombre de archivo', () => {
  it('lee la extensión en minúsculas', () => {
    expect(fileExtensionOf('Plantilla Reporte.DOCX')).toBe('docx');
    expect(fileExtensionOf('modelo.R')).toBe('r');
  });

  it('un nombre sin extensión no da ninguna', () => {
    expect(fileExtensionOf('sin-extension')).toBe('');
    expect(fileExtensionOf('.gitignore')).toBe('');
    expect(fileExtensionOf('acaba.en.punto.')).toBe('');
  });

  it('una ruta con carpetas se queda con el nombre final', () => {
    expect(fileExtensionOf('C:\\Users\\ana\\datos.xlsx')).toBe('xlsx');
    expect(fileExtensionOf('../../../etc/passwd.pdf')).toBe('pdf');
  });

  it('la lista blanca de MIME no admite octet-stream por sí solo', () => {
    expect(ACADEMIC_FILE_TYPES.material['application/octet-stream']).toBeUndefined();
    expect(
      resolveAcademicUpload('material', {
        fileName: 'cualquiera',
        contentType: 'application/octet-stream',
      })
    ).toBeNull();
  });
});
