import { describe, expect, it } from 'vitest';
import { guardCollaborativeAnswers } from '../../src/lib/server/academic-writes';
import { toPromptTemplate, toSkillResource } from '../../src/lib/data/academic-mappers';
import {
  aiWorklogDataSchema,
  installStepSchema,
  promptTemplateInputSchema,
  skillInputSchema,
} from '../../src/lib/academic-schemas';
import { assignment, authorship, sharedAssignment, skill, UID } from './academic-fixtures';
import type { PromptTemplateRecord, ResearchData } from '../../src/lib/types';

/**
 * Seguridad de las aportaciones (§14) y biblioteca de IA (§45, §46).
 */

const answers = (pairs: [string, string][]): ResearchData => ({
  answers: pairs.map(([questionId, value]) => ({ questionId, value })),
});

describe('el servidor descarta respuestas a apartados ajenos (§14)', () => {
  it('conserva lo que sí le corresponde', () => {
    const guarded = guardCollaborativeAnswers(
      sharedAssignment(),
      UID.christian,
      answers([
        ['q1', 'Mi definición'],
        ['q2', 'https://fuente.example'],
      ])
    ) as ResearchData;

    expect(guarded.answers).toHaveLength(2);
  });

  it('tira la respuesta al concepto de otra persona', () => {
    // Christian tiene «arquitectura» (q1, q2). q3 es de Ana.
    const guarded = guardCollaborativeAnswers(
      sharedAssignment(),
      UID.christian,
      answers([
        ['q1', 'Lo mío'],
        ['q3', 'Esto no me toca'],
      ])
    ) as ResearchData;

    expect(guarded.answers.map((a) => a.questionId)).toEqual(['q1']);
    expect(JSON.stringify(guarded)).not.toContain('Esto no me toca');
  });

  it('un estudiante sin ningún concepto asignado no guarda nada', () => {
    const guarded = guardCollaborativeAnswers(
      sharedAssignment(),
      UID.pedro,
      answers([['q1', 'intento']])
    ) as ResearchData;

    expect(guarded.answers).toEqual([]);
  });

  it('no descarta nada en una actividad individual', () => {
    const guarded = guardCollaborativeAnswers(
      assignment({ collaborationMode: 'individual' }),
      UID.pedro,
      answers([
        ['q1', 'a'],
        ['q3', 'b'],
      ])
    ) as ResearchData;

    expect(guarded.answers).toHaveLength(2);
  });

  it('un apartado abierto lo puede responder cualquiera del grupo', () => {
    const guarded = guardCollaborativeAnswers(
      sharedAssignment({ groupAssignments: [{ groupId: 'arquitectura', assignedTo: [] }] }),
      UID.ana,
      answers([['q1', 'aporto yo']])
    ) as ResearchData;

    expect(guarded.answers).toHaveLength(1);
  });

  it('no toca las entregas que no son investigación', () => {
    const worklog = { provider: 'Claude', prompt: 'hola' };
    expect(
      guardCollaborativeAnswers(
        sharedAssignment({ type: 'ai_worklog' }),
        UID.pedro,
        worklog as never
      )
    ).toEqual(worklog);
  });
});

describe('biblioteca de prompts (§45)', () => {
  const record: PromptTemplateRecord = {
    id: 'p1',
    courseId: 'course-dcu',
    teacherId: UID.luz,
    title: 'Evaluación heurística',
    description: 'Para analizar una interfaz.',
    prompt: 'Actúa como especialista en UX…',
    recommendedProvider: 'Claude',
    recommendedModel: 'Claude Opus 4.5',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...authorship(),
  };

  it('el DTO no lleva el UID de quien lo creó', () => {
    const dto = toPromptTemplate(record);
    expect(JSON.stringify(dto)).not.toContain(UID.luz);
    expect(dto.title).toBe('Evaluación heurística');
  });

  it('exige título y contenido', () => {
    expect(promptTemplateInputSchema.safeParse({ title: 'ab', prompt: 'x' }).success).toBe(false);
    expect(promptTemplateInputSchema.safeParse({ title: 'Bueno', prompt: '' }).success).toBe(
      false
    );
    expect(
      promptTemplateInputSchema.safeParse({ title: 'Evaluación', prompt: 'Actúa como…' }).success
    ).toBe(true);
  });

  it('proveedor y modelo son opcionales', () => {
    const parsed = promptTemplateInputSchema.safeParse({ title: 'Suelto', prompt: 'texto' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recommendedProvider ?? null).toBeNull();
      expect(parsed.data.recommendedModel ?? null).toBeNull();
    }
  });
});

describe('AI Worklog y recursos (§21, §28)', () => {
  it('el prompt realmente usado se guarda aparte del recomendado', () => {
    // El modelo NO asume que sean iguales: la tarea recomienda por referencia y
    // el worklog guarda el texto que el estudiante escribió. Es lo que permite
    // observar en qué lo cambió.
    const parsed = aiWorklogDataSchema.safeParse({
      provider: 'Claude',
      prompt: 'Actúa como especialista en UX y además considera el contexto escolar…',
      resourcesUsed: [{ kind: 'prompt', id: 'p1' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prompt).toContain('contexto escolar');
      expect(parsed.data.resourcesUsed).toEqual([{ kind: 'prompt', id: 'p1' }]);
    }
  });

  it('registrar la Skill utilizada es opcional', () => {
    const parsed = aiWorklogDataSchema.safeParse({ provider: 'ChatGPT', prompt: 'algo' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.resourcesUsed).toEqual([]);
  });

  it('un worklog de la iteración 2 sigue siendo válido', () => {
    const legacy = {
      provider: 'Gemini',
      model: 'Gemini 2.5 Pro',
      objective: 'x',
      prompt: 'y',
      responseSummary: 'z',
      studentAnalysis: '',
      whatWasUsed: '',
      whatWasChanged: '',
      whatWasDiscarded: '',
    };
    expect(aiWorklogDataSchema.safeParse(legacy).success).toBe(true);
  });
});

describe('biblioteca de Skills (§46)', () => {
  it('el DTO no lleva el UID de quien la creó', () => {
    const dto = toSkillResource(skill());
    expect(JSON.stringify(dto)).not.toContain(UID.luz);
    expect(dto.title).toBe('UI UX Pro Max');
  });

  it('el repositorio es opcional: una Skill no tiene por qué venir de GitHub', () => {
    const parsed = skillInputSchema.safeParse({ title: 'Skill de la docente' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.repositoryUrl).toBe('');
      expect(parsed.data.homepageUrl).toBe('');
      expect(parsed.data.installMethods).toEqual([]);
    }
  });

  it('rechaza un enlace javascript: en el repositorio', () => {
    expect(
      skillInputSchema.safeParse({ title: 'Maliciosa', repositoryUrl: 'javascript:alert(1)' })
        .success
    ).toBe(false);
  });

  it('rechaza un enlace javascript: dentro de un paso de instalación', () => {
    expect(
      installStepSchema.safeParse({ type: 'link', label: 'Docs', url: 'javascript:alert(1)' })
        .success
    ).toBe(false);
    expect(
      installStepSchema.safeParse({ type: 'link', label: 'Docs', url: 'https://docs.example' })
        .success
    ).toBe(true);
  });

  it('acepta varias herramientas compatibles y varios métodos de instalación', () => {
    const parsed = skillInputSchema.safeParse({
      title: 'UI UX Pro Max',
      compatibleTools: ['Claude Code', 'Cursor', 'Codex', 'Gemini CLI'],
      installMethods: [
        {
          id: 'm1',
          tool: 'Claude Code',
          steps: [{ type: 'command', content: '/plugin marketplace add foo/bar' }],
        },
        {
          id: 'm2',
          tool: 'Codex',
          steps: [
            { type: 'text', content: 'Instala el CLI' },
            { type: 'command', content: 'npm install -g ui-ux-pro-max-cli' },
            { type: 'command', content: 'uipro init --ai codex' },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.compatibleTools).toHaveLength(4);
      expect(parsed.data.installMethods[1]?.steps).toHaveLength(3);
    }
  });

  it('un comando se guarda TAL CUAL, como texto', () => {
    /**
     * No se sanea ni se interpreta, y no hace falta: UINexus no ejecuta nada de
     * esto. «Limpiar» el comando sólo estropearía comandos legítimos y daría
     * una falsa sensación de defensa sobre algo que nunca corre.
     */
    const raw = 'npm i -g pkg && uipro init --ai codex; echo "listo"';
    const parsed = installStepSchema.safeParse({ type: 'command', content: raw });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'command') {
      expect(parsed.data.content).toBe(raw);
    }
  });

  it('un paso de enlace conserva su etiqueta y su dirección', () => {
    const parsed = installStepSchema.safeParse({
      type: 'link',
      label: 'Documentación oficial',
      url: 'https://example.com/docs',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'link') {
      expect(parsed.data.label).toBe('Documentación oficial');
    }
  });
});
