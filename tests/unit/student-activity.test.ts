import { describe, expect, it } from 'vitest';
import { makePart } from '@/lib/activity-builder';
import {
  ACTIVITY_STATE_LABEL,
  PART_STATUS_LABEL,
  REVIEWED_NOTE,
  activityProgress,
  activityState,
  blockedBy,
  canSubmit,
  humanizeSubmitError,
  isReviewedNote,
  missingToSubmit,
  partHasWork,
  partIsComplete,
  partStatus,
  type StudentWork,
} from '@/lib/student-activity';
import { missingRequiredSteps, normalizeEvidence, synthesizeLegacyStep } from '@/lib/workflow';
import type { StepEvidence, SubmissionData, WorkflowStep } from '@/lib/types';

/**
 * Lo que el estudiante ve de una actividad.
 *
 * La regla que sostiene todo el archivo: lo que aquí se llama «lista para
 * entregar» tiene que coincidir con lo que el servidor deja entregar. Si esta
 * capa fuera más permisiva, el botón se habilitaría para acabar en un 409; si
 * fuera más estricta, bloquearía una entrega que el servidor sí acepta. Por eso
 * hay pruebas que comparan las dos cuentas directamente.
 */

let counter = 0;
const nextId = (): string => `p${++counter}`;

function part(
  action: Parameters<typeof makePart>[0]['action'],
  overrides: Partial<WorkflowStep> = {}
): WorkflowStep {
  return { ...makePart({ action, id: nextId(), order: 0 }), ...overrides };
}

function evidence(stepId: string, data: Record<string, unknown>, note = ''): StepEvidence {
  return normalizeEvidence({ stepId, data: data as unknown as SubmissionData, note }, stepId);
}

const nothing: StudentWork = { evidence: {} };

// ---------------------------------------------------------------------------
// Estado de una Parte
// ---------------------------------------------------------------------------

describe('el estado de una Parte', () => {
  it('empieza sin empezar', () => {
    const uno = part('respond');
    expect(partStatus([uno], uno, nothing)).toBe('not_started');
  });

  it('está completada cuando hay algo escrito', () => {
    const uno = part('respond');
    const work = { evidence: { [uno.id]: evidence(uno.id, { text: 'Tres conclusiones.' }) } };
    expect(partStatus([uno], uno, work)).toBe('done');
  });

  it('un formulario en blanco NO cuenta como empezado', () => {
    // Un AI Worklog vacío llega con `provider` puesto por el esquema. Si eso
    // contara, abrir una parte la daría por hecha.
    const uno = part('ai');
    const work = { evidence: { [uno.id]: evidence(uno.id, { provider: 'Other' }) } };
    expect(partStatus([uno], uno, work)).toBe('not_started');
  });

  it('está bloqueada mientras su dependencia no esté completa', () => {
    const primera = part('respond');
    const segunda = part('respond', { dependsOnStepIds: [primera.id] });

    expect(partStatus([primera, segunda], segunda, nothing)).toBe('locked');
    expect(blockedBy([primera, segunda], segunda, nothing)).toEqual([primera]);
  });

  it('se desbloquea en cuanto la dependencia se completa', () => {
    const primera = part('respond');
    const segunda = part('respond', { dependsOnStepIds: [primera.id] });
    const work = { evidence: { [primera.id]: evidence(primera.id, { text: 'Ya está.' }) } };

    expect(partStatus([primera, segunda], segunda, work)).toBe('not_started');
    expect(blockedBy([primera, segunda], segunda, work)).toEqual([]);
  });

  it('una dependencia que apunta a una Parte que ya no existe no bloquea nada', () => {
    // Condenar una Parte para siempre por una referencia rota sería peor que
    // dejarla abierta: nadie podría saber qué le falta.
    const suelta = part('respond', { dependsOnStepIds: ['parte-borrada'] });
    expect(partStatus([suelta], suelta, nothing)).toBe('not_started');
  });

  it('con trabajo a medias ya no se bloquea, aunque la dependencia se reabra', () => {
    // Quitarle a alguien el acceso a lo que estaba escribiendo es peor que
    // dejarle terminar. Hace falta una Parte que pueda estar a medias: un
    // registro de IA con conclusión obligatoria y sin conclusión todavía.
    const primera = part('respond');
    const ia = part('ai', { dependsOnStepIds: [primera.id] });
    const segunda: WorkflowStep = {
      ...ia,
      deliverables: [{ ...ia.deliverables[0]!, conclusionMode: 'required' }],
    };
    const work = { evidence: { [segunda.id]: evidence(segunda.id, { objective: 'A medias.' }) } };

    expect(partStatus([primera, segunda], segunda, work)).toBe('in_progress');
  });

  it('un laboratorio con trabajo cuenta aunque la entrega no tenga copia', () => {
    // Es el caso de volver al día siguiente: el NexLab se guardó solo en su
    // propio documento y la entrega no tiene nada todavía. Quién entra en
    // `labs` lo decide el servidor, y sólo entra si se guardó algo dentro: ver
    // `hasWork` en `lib/server/student-labs.ts`.
    const lab = part('lab');
    expect(partStatus([lab], lab, nothing)).toBe('not_started');
    expect(partStatus([lab], lab, { evidence: {}, labs: new Set([lab.id]) })).toBe('done');
  });

  it('las cuatro etiquetas están escritas para leerse', () => {
    expect(Object.values(PART_STATUS_LABEL)).toEqual([
      'Bloqueada',
      'Sin empezar',
      'En progreso',
      'Completada',
    ]);
  });
});

describe('la conclusión obligatoria de un registro de IA', () => {
  const conConclusionObligatoria = (): WorkflowStep => {
    const ia = part('ai');
    return {
      ...ia,
      deliverables: [{ ...ia.deliverables[0]!, conclusionMode: 'required' }],
    };
  };

  it('deja la Parte en progreso mientras falte', () => {
    const ia = conConclusionObligatoria();
    const work = {
      evidence: { [ia.id]: evidence(ia.id, { objective: 'Comparar métodos.' }) },
    };

    expect(partHasWork(ia, work)).toBe(true);
    expect(partIsComplete(ia, work)).toBe(false);
    expect(partStatus([ia], ia, work)).toBe('in_progress');
  });

  it('la completa cuando la conclusión está escrita', () => {
    const ia = conConclusionObligatoria();
    const work = {
      evidence: {
        [ia.id]: evidence(ia.id, {
          objective: 'Comparar métodos.',
          studentAnalysis: 'Se equivocó en el segundo caso.',
        }),
      },
    };

    expect(partIsComplete(ia, work)).toBe(true);
  });

  it('no exige nada cuando la conclusión es opcional', () => {
    const ia = part('ai');
    expect(ia.deliverables[0]?.conclusionMode).toBe('optional');
    const work = { evidence: { [ia.id]: evidence(ia.id, { objective: 'Probar.' }) } };
    expect(partIsComplete(ia, work)).toBe(true);
  });

  it('lo que falta se dice como una frase, no como un campo', () => {
    const ia = conConclusionObligatoria();
    const work = { evidence: { [ia.id]: evidence(ia.id, { objective: 'Probar.' }) } };

    expect(missingToSubmit([ia], work)).toEqual([
      {
        partId: ia.id,
        title: 'Registrar uso de IA — NexIA',
        message: 'Falta tu conclusión sobre el uso de IA. Esta actividad la pide.',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Progreso
// ---------------------------------------------------------------------------

describe('el progreso de la actividad', () => {
  it('se cuenta, no se porcentúa', () => {
    const partes = [part('respond'), part('respond'), part('evidence'), part('instruction')];
    const work = {
      evidence: {
        [partes[0]!.id]: evidence(partes[0]!.id, { text: 'Hecho.' }),
        [partes[1]!.id]: evidence(partes[1]!.id, { text: 'Hecho.' }),
      },
    };

    expect(activityProgress(partes, work)).toMatchObject({
      total: 4,
      done: 2,
      label: '2 de 4 partes completadas',
    });
  });

  it('con una sola Parte no cuenta: dice si está o no', () => {
    const una = part('respond');
    expect(activityProgress([una], nothing).label).toBe('Sin completar');
    expect(
      activityProgress([una], { evidence: { [una.id]: evidence(una.id, { text: 'Va.' }) } }).label
    ).toBe('Completada');
  });
});

// ---------------------------------------------------------------------------
// Qué falta para entregar
// ---------------------------------------------------------------------------

describe('lo que falta para entregar', () => {
  it('nombra cada Parte y dice qué pide, sin palabras del modelo', () => {
    const partes = [part('lab'), part('code'), part('evidence'), part('respond')];
    const faltan = missingToSubmit(partes, nothing);

    expect(faltan.map((item) => item.message)).toEqual([
      'Abre tu laboratorio y trabaja en él.',
      'Escribe tu programa o adjunta el archivo.',
      'Falta el archivo.',
      'Falta tu respuesta.',
    ]);

    const texto = JSON.stringify(faltan);
    for (const palabra of ['workflow', 'deliverable', 'actionType', 'nexbook', 'stepId']) {
      expect(texto.toLowerCase()).not.toContain(palabra.toLowerCase());
    }
  });

  it('una Parte opcional sin hacer no impide entregar', () => {
    const obligatoria = part('respond');
    const opcional = part('respond', { required: false });
    const work = {
      evidence: { [obligatoria.id]: evidence(obligatoria.id, { text: 'Listo.' }) },
    };

    expect(missingToSubmit([obligatoria, opcional], work)).toEqual([]);
    expect(canSubmit([obligatoria, opcional], work)).toBe(true);
  });

  it('una Parte sin entrega se completa marcándola, no inventando una entrega', () => {
    const instruccion = part('instruction');
    expect(missingToSubmit([instruccion], nothing)[0]?.message).toBe(
      'Márcala como revisada cuando la hayas hecho.'
    );

    const marcada = { evidence: { [instruccion.id]: evidence(instruccion.id, {}, REVIEWED_NOTE) } };
    expect(partIsComplete(instruccion, marcada)).toBe(true);
    expect(isReviewedNote(REVIEWED_NOTE)).toBe(true);
    expect(isReviewedNote('Lo leí con calma.')).toBe(false);
  });

  it('una nota escrita a mano también la completa', () => {
    // La marca automática no es un campo aparte: es una nota más. Cualquier
    // nota del estudiante vale como constancia de que hizo la Parte.
    const instruccion = part('instruction');
    const conNota = {
      evidence: { [instruccion.id]: evidence(instruccion.id, {}, 'Leí el caso entero.') },
    };
    expect(partIsComplete(instruccion, conNota)).toBe(true);
  });

  it('borrar la nota devuelve la Parte a «Sin empezar», y eso es lo documentado', () => {
    /**
     * La consecuencia de guardar la marca en `note` y no en un campo nuevo.
     * Se fija aquí para que sea una decisión y no una sorpresa: ver
     * `docs/LIMITATIONS.md` §13.
     */
    const instruccion = part('instruction');
    const vacia = { evidence: { [instruccion.id]: evidence(instruccion.id, {}, '') } };
    expect(partIsComplete(instruccion, vacia)).toBe(false);
    expect(partStatus([instruccion], instruccion, vacia)).toBe('not_started');
  });

  it('sigue el orden de la actividad', () => {
    const partes = [part('respond'), part('lab'), part('code')];
    expect(missingToSubmit(partes, nothing).map((item) => item.partId)).toEqual(
      partes.map((item) => item.id)
    );
  });
});

describe('la cuenta del navegador y la del servidor', () => {
  /**
   * La comprobación que evita el peor fallo de esta pantalla: un botón
   * habilitado que acaba en un 409, o uno deshabilitado sobre una entrega que
   * el servidor sí aceptaba.
   */
  it('coinciden en qué Partes obligatorias faltan', () => {
    const partes = [part('respond'), part('evidence'), part('respond', { required: false })];
    const work = {
      evidence: { [partes[0]!.id]: evidence(partes[0]!.id, { text: 'Hecho.' }) },
    };

    const aquí = missingToSubmit(partes, work).map((item) => item.partId);
    const enElServidor = missingRequiredSteps(partes, work.evidence, 'uid-cualquiera').map(
      (step) => step.id
    );

    expect(aquí).toEqual(enElServidor);
  });

  it('coinciden también cuando ya no falta nada', () => {
    const partes = [part('respond'), part('evidence')];
    const work = {
      evidence: {
        [partes[0]!.id]: evidence(partes[0]!.id, { text: 'Hecho.' }),
        [partes[1]!.id]: evidence(partes[1]!.id, { fileName: 'informe.pdf', storageKey: 'k' }),
      },
    };

    expect(canSubmit(partes, work)).toBe(true);
    expect(missingRequiredSteps(partes, work.evidence, 'uid-cualquiera')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// El estado de la actividad
// ---------------------------------------------------------------------------

describe('el estado de la actividad', () => {
  const partes = [part('respond'), part('respond')];
  const base = { status: null, submittedAt: null, dueAt: null, parts: partes };

  it('sin empezar, en progreso y lista para entregar se derivan del trabajo', () => {
    expect(activityState({ ...base, work: nothing })).toBe('not_started');

    const aMedias = { evidence: { [partes[0]!.id]: evidence(partes[0]!.id, { text: 'Una.' }) } };
    expect(activityState({ ...base, work: aMedias })).toBe('in_progress');

    const entera = {
      evidence: {
        [partes[0]!.id]: evidence(partes[0]!.id, { text: 'Una.' }),
        [partes[1]!.id]: evidence(partes[1]!.id, { text: 'Dos.' }),
      },
    };
    expect(activityState({ ...base, work: entera })).toBe('ready');
  });

  it('los estados de la entrega mandan sobre el avance del borrador', () => {
    expect(
      activityState({ ...base, status: 'submitted', work: nothing })
    ).toBe('submitted');
    expect(activityState({ ...base, status: 'reviewed', work: nothing })).toBe('reviewed');
    expect(activityState({ ...base, status: 'needs_changes', work: nothing })).toBe(
      'needs_changes'
    );
  });

  it('«entregada tarde» se calcula, no se guarda', () => {
    const tarde = activityState({
      ...base,
      status: 'submitted',
      submittedAt: '2026-09-12T10:00:00.000Z',
      dueAt: '2026-09-11T23:59:00.000Z',
      work: nothing,
    });
    expect(tarde).toBe('submitted_late');

    const aTiempo = activityState({
      ...base,
      status: 'submitted',
      submittedAt: '2026-09-10T10:00:00.000Z',
      dueAt: '2026-09-11T23:59:00.000Z',
      work: nothing,
    });
    expect(aTiempo).toBe('submitted');
  });

  it('sin fecha límite nada llega tarde', () => {
    expect(
      activityState({
        ...base,
        status: 'submitted',
        submittedAt: '2030-01-01T00:00:00.000Z',
        dueAt: null,
        work: nothing,
      })
    ).toBe('submitted');
  });

  it('las etiquetas no usan vocabulario interno', () => {
    const texto = Object.values(ACTIVITY_STATE_LABEL).join(' ').toLowerCase();
    for (const palabra of ['draft', 'submitted', 'workflow', 'step']) {
      expect(texto).not.toContain(palabra);
    }
  });
});

// ---------------------------------------------------------------------------
// Compatibilidad
// ---------------------------------------------------------------------------

describe('una actividad del formato anterior', () => {
  /**
   * Se lee como una Parte sintetizada con el id `main`. Todo lo de este módulo
   * tiene que funcionar sobre ella sin saber que es antigua: es lo que permite
   * que la pantalla del estudiante sea una sola.
   */
  const legacy = synthesizeLegacyStep({
    type: 'freeform',
    title: 'Tres conclusiones',
    description: '',
    instructions: '',
    researchQuestions: [],
    resources: [],
  });

  it('tiene estado, progreso y lista de lo que falta como cualquier otra', () => {
    expect(partStatus([legacy], legacy, nothing)).toBe('not_started');
    expect(activityProgress([legacy], nothing).label).toBe('Sin completar');
    expect(missingToSubmit([legacy], nothing)).toHaveLength(1);

    const hecha = { evidence: { main: evidence('main', { text: 'Ya.' }) } };
    expect(partStatus([legacy], legacy, hecha)).toBe('done');
    expect(canSubmit([legacy], hecha)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

describe('los errores, dichos para quien los va a leer', () => {
  it('un conflicto de versiones explica qué pasó y qué hacer', () => {
    const dicho = humanizeSubmitError(
      'Alguien guardó este NexBook desde otro sitio. Recarga para ver la versión actual.'
    );
    expect(dicho).toContain('otra pestaña');
    expect(dicho).toContain('Recarga');
  });

  it('un fallo de red no se confunde con un error de la actividad', () => {
    expect(humanizeSubmitError('Failed to fetch')).toContain('No hay conexión');
    expect(humanizeSubmitError('Failed to fetch')).toContain('sigue en pantalla');
  });

  it('una ruta del modelo no se le enseña a nadie', () => {
    const dicho = humanizeSubmitError('workflow.2.deliverables.0.type');
    expect(dicho).not.toContain('workflow');
    expect(dicho).not.toContain('deliverables');
  });

  it('las reglas académicas del servidor se dejan tal cual', () => {
    // Ya están escritas en claro. Reescribirlas aquí las duplicaría en dos
    // sitios que acabarían diciendo cosas distintas.
    const original = 'Todavía te falta: Preparar los datos.';
    expect(humanizeSubmitError(original)).toBe(original);

    const fecha = 'La fecha límite de esta actividad ya terminó (11 de septiembre).';
    expect(humanizeSubmitError(fecha)).toBe(fecha);
  });

  it('un mensaje vacío no deja a nadie sin explicación', () => {
    expect(humanizeSubmitError('   ')).toBe('No se pudo guardar. Inténtalo otra vez.');
  });
});
