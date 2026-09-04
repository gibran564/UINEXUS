import { describe, expect, it } from 'vitest';
import { getRoleFromInstitutionalEmail, isInstitutionalEmail } from '../../src/lib/firebase/auth';

describe('validación de correo institucional ITD', () => {
  it('acepta correos válidos de @itdurango.edu.mx', () => {
    expect(isInstitutionalEmail('alumno@itdurango.edu.mx')).toBe(true);
    expect(isInstitutionalEmail('l21040123@itdurango.edu.mx')).toBe(true);
    expect(isInstitutionalEmail('docente.apellido@itdurango.edu.mx')).toBe(true);
    expect(isInstitutionalEmail('ALUMNO@ITDURANGO.EDU.MX')).toBe(true);
    expect(isInstitutionalEmail('  estudiante@itdurango.edu.mx  ')).toBe(true);
  });

  it('rechaza correos de otros dominios o vacíos', () => {
    expect(isInstitutionalEmail('usuario@gmail.com')).toBe(false);
    expect(isInstitutionalEmail('usuario@hotmail.com')).toBe(false);
    expect(isInstitutionalEmail('usuario@itdurango.mx')).toBe(false);
    expect(isInstitutionalEmail('usuario@itdurango.edu')).toBe(false);
    expect(isInstitutionalEmail('itdurango.edu.mx')).toBe(false);
    expect(isInstitutionalEmail('')).toBe(false);
    expect(isInstitutionalEmail(null)).toBe(false);
    expect(isInstitutionalEmail(undefined)).toBe(false);
  });
});

describe('clasificación automática de rol (estudiante vs docente)', () => {
  it('asigna rol "student" a correos con número de control', () => {
    expect(getRoleFromInstitutionalEmail('20041243@itdurango.edu.mx')).toBe('student');
    expect(getRoleFromInstitutionalEmail('l21040123@itdurango.edu.mx')).toBe('student');
    expect(getRoleFromInstitutionalEmail('c19040001@itdurango.edu.mx')).toBe('student');
    expect(getRoleFromInstitutionalEmail('18040500@itdurango.edu.mx')).toBe('student');
  });

  it('asigna rol "teacher" a correos de docentes sin números y correos autorizados', () => {
    expect(getRoleFromInstitutionalEmail('docente@itdurango.edu.mx')).toBe('teacher');
    expect(getRoleFromInstitutionalEmail('juan.perez@itdurango.edu.mx')).toBe('teacher');
    expect(getRoleFromInstitutionalEmail('maria.gonzalez.soto@itdurango.edu.mx')).toBe('teacher');
    expect(getRoleFromInstitutionalEmail('profesor@itdurango.edu.mx')).toBe('teacher');
    expect(getRoleFromInstitutionalEmail('cegibran@gmail.com')).toBe('teacher');
    expect(isInstitutionalEmail('cegibran@gmail.com')).toBe(true);
  });
});

