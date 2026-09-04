import { describe, expect, it } from 'vitest';
import {
  composeDueAt,
  formatDueLabel,
  isPastDue,
  resolveDueInstant,
  splitDueAt,
} from '@/lib/due-date';

/**
 * La fecha límite como instante.
 *
 * Ninguna prueba depende del reloj real: `isPastDue` recibe el «ahora» que se
 * le quiera dar, que es justo para lo que existe ese parámetro.
 */

describe('composeDueAt', () => {
  it('compone el instante con la fecha y la hora LOCALES', () => {
    const iso = composeDueAt('2026-09-11', '23:59');
    expect(iso).not.toBeNull();

    const parsed = new Date(iso!);
    // Se comprueba en local a propósito: el fallo que esto vigila es
    // «selecciono 23:59 y el servidor lo entiende como UTC».
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(11);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
  });

  it('sin hora asume el final del día local', () => {
    const parsed = new Date(composeDueAt('2026-09-11', '')!);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
  });

  it('sin fecha no hay límite', () => {
    expect(composeDueAt('', '23:59')).toBeNull();
    expect(composeDueAt('no es una fecha', '10:00')).toBeNull();
  });

  it('va y vuelve por el formulario sin perder la hora', () => {
    const dueAt = composeDueAt('2026-09-11', '18:30');
    expect(splitDueAt({ dueDate: '2026-09-11', dueAt })).toEqual({
      date: '2026-09-11',
      time: '18:30',
    });
  });

  it('una tarea antigua vuelve con su fecha y sin hora inventada', () => {
    expect(splitDueAt({ dueDate: '2026-09-11', dueAt: null })).toEqual({
      date: '2026-09-11',
      time: '',
    });
  });
});

describe('isPastDue', () => {
  const dueAt = '2026-09-12T05:59:00.000Z';

  it('acepta antes del instante', () => {
    expect(isPastDue({ dueDate: '2026-09-11', dueAt }, new Date('2026-09-12T05:58:59.000Z'))).toBe(
      false
    );
  });

  it('rechaza después del instante', () => {
    expect(isPastDue({ dueDate: '2026-09-11', dueAt }, new Date('2026-09-12T05:59:01.000Z'))).toBe(
      true
    );
  });

  it('el instante exacto todavía admite entrega', () => {
    expect(isPastDue({ dueDate: '2026-09-11', dueAt }, new Date(dueAt))).toBe(false);
  });

  it('sin fecha límite nunca se cierra', () => {
    expect(isPastDue({ dueDate: null, dueAt: null }, new Date('2099-01-01T00:00:00.000Z'))).toBe(
      false
    );
  });

  it('una tarea antigua sin hora se cierra de la forma más permisiva', () => {
    const legacy = { dueDate: '2026-09-11', dueAt: null };

    // Fin del día en cualquier zona horaria del planeta: todavía se admite.
    expect(isPastDue(legacy, new Date('2026-09-12T11:59:00.000Z'))).toBe(false);
    // Pasado eso, ya no queda ninguna zona donde siga siendo el día 11.
    expect(isPastDue(legacy, new Date('2026-09-13T00:00:00.000Z'))).toBe(true);
  });

  it('un instante corrupto no cierra la actividad por sorpresa', () => {
    expect(resolveDueInstant({ dueDate: null, dueAt: 'no es una hora' })).toBeNull();
    expect(isPastDue({ dueDate: null, dueAt: 'no es una hora' }, new Date())).toBe(false);
  });
});

describe('formatDueLabel', () => {
  it('nunca muestra el instante crudo en UTC', () => {
    const label = formatDueLabel({ dueDate: '2026-09-11', dueAt: composeDueAt('2026-09-11', '23:59') });

    expect(label).not.toContain('T');
    expect(label).not.toContain('Z');
    expect(label).toContain('2026');
    expect(label).toContain('23:59');
  });

  it('una tarea antigua se muestra sin hora, no a medianoche', () => {
    const label = formatDueLabel({ dueDate: '2026-09-11', dueAt: null });

    expect(label).toContain('2026');
    expect(label).not.toContain(':');
  });

  it('sin fecha límite no hay etiqueta', () => {
    expect(formatDueLabel({ dueDate: null, dueAt: null })).toBe('');
  });
});
