import * as React from 'react';
import type * as AulaClient from '@/lib/aula-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptEditor } from '@/components/aula/resources-panel';
import { CourseResourceEditor } from '@/components/aula/general-resources';
import { SkillEditor } from '@/components/aula/skill-editor';
import { PublicationComposer } from '@/components/home/publication-composer';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(), push: vi.fn(),
  state: null as null | { values: unknown[]; cursor: number },
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof React>();
  return {
    ...actual,
    useEffect: (...args: Parameters<typeof React.useEffect>) => {
      if (!mocks.state) actual.useEffect(...args);
    },
    useState: (initial: unknown) => {
      if (!mocks.state) return actual.useState(initial);
      const state = mocks.state;
      const index = state.cursor++;
      if (!(index in state.values)) {
        state.values[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [state.values[index], (next: unknown) => {
        state.values[index] = typeof next === 'function' ? next(state.values[index]) : next;
      }];
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/components/auth/auth-provider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/aula-client', async (original) => ({
  ...await original<typeof AulaClient>(),
  useApi: () => ({ data: null, state: 'ready', reload: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.state = null;
  mocks.apiFetch.mockResolvedValue({});
});

describe('editores reales dentro del muro', () => {
  it('renderiza todos los campos del Prompt y permite etiquetar la publicación', () => {
    const html = renderToStaticMarkup(React.createElement(PromptEditor, {
      courseId: 'a', template: null, onDone: vi.fn(), onCancel: vi.fn(),
      onSubmit: vi.fn(), submitLabel: 'Publicar',
    }));
    for (const label of ['Título', 'Descripción', 'Prompt', 'Proveedor recomendado', 'Modelo recomendado']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('>Publicar</button>');
    expect(html).toContain('>Cancelar</button>');
    expect(html).not.toContain('href=');
  });

  it('conserva el formulario completo de Skill sin navegación de página al incrustarlo', () => {
    const html = renderToStaticMarkup(React.createElement(SkillEditor, {
      courseId: 'a', embedded: true, onSaved: vi.fn(), onCancel: vi.fn(),
      onSubmit: vi.fn(), submitLabel: 'Enviar para aprobación',
    }));
    for (const label of ['Nombre', 'Descripción', 'Repositorio', 'Sitio oficial', 'Compatible con', 'Cómo se instala', 'Añadir método de instalación', 'Cómo usarla']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('>Enviar para aprobación</button>');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('href=');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('reutiliza tipos y campos completos de recursos para propuestas de estudiantes', () => {
    const html = renderToStaticMarkup(React.createElement(CourseResourceEditor, {
      courseId: 'a', isTeacher: false, onDone: vi.fn(), onCancel: vi.fn(),
      onSubmit: vi.fn(), submitLabel: 'Enviar para aprobación',
    }));
    for (const label of ['Tipo', 'Categoría', 'Nombre', 'Enlace', 'Para qué sirve', 'Cómo se usa']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="workflow"');
    expect(html).toContain('value="announcement"');
    expect(html).toContain('>Enviar para aprobación</button>');
  });
});

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
function textOf(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return typeof node === 'string' ? node : '';
}

// This harness exercises React element callbacks and local state transitions;
// it does not pretend to test browser layout, focus, or scroll behavior.
function composer() {
  mocks.state = { values: [], cursor: 0 };
  const onPublished = vi.fn();
  const courses = [
    { id: 'a', name: 'Grupo A', role: 'teacher' as const, code: null },
    { id: 'b', name: 'Grupo B', role: 'teacher' as const, code: null },
    { id: 'c', name: 'Grupo ajeno a docencia', role: 'student' as const, code: null },
  ];
  const render = () => {
    mocks.state!.cursor = 0;
    return PublicationComposer({ courses, onPublished });
  };
  const button = (label: string) => {
    const found = elements(render()).find((element) => element.type === 'button' && textOf(element.props.children as React.ReactNode) === label);
    expect(found, label).toBeDefined();
    (found!.props.onClick as () => void)();
  };
  button('Comparte algo con tu grupo…');
  const group = elements(render()).find((element) => element.type === 'label' && textOf(element) === 'Grupo A');
  const checkbox = elements(group).find((element) => element.type === 'input');
  (checkbox!.props.onChange as () => void)();
  button('Prompt');
  return { render, button, onPublished };
}

describe('compositor sin abandonar Inicio', () => {
  it('monta el editor real y cancelar cierra sólo el compositor', () => {
    const harness = composer();
    const editor = elements(harness.render()).find((element) => element.type === PromptEditor);
    expect(editor).toBeDefined();
    expect(editor!.props.courseId).toBe('a');
    (editor!.props.onCancel as () => void)();
    expect(textOf(harness.render())).toContain('Comparte algo con tu grupo…');
    expect(elements(harness.render()).some((element) => element.type === PromptEditor)).toBe(false);
    expect(harness.onPublished).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('publica los datos completos del editor con audiencia independiente y refresca mediante callback', async () => {
    const harness = composer();
    const editor = elements(harness.render()).find((element) => element.type === PromptEditor)!;
    const data = { title: 'Análisis heurístico', description: 'Para prototipos', prompt: 'Evalúa la navegación', recommendedProvider: 'OpenAI', recommendedModel: 'Modelo elegido' };
    await (editor.props.onSubmit as (body: unknown) => Promise<void>)(data);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/publications', {
      method: 'POST', body: { newContent: { kind: 'prompt', data }, audienceCourseIds: ['a'], allTeacherGroups: false },
    });
    (editor.props.onDone as () => void)();
    expect(harness.onPublished).toHaveBeenCalledOnce();
    expect(textOf(harness.render())).toContain('Publicación compartida con la audiencia elegida.');
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
