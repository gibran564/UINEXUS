import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_SHELL_SANDBOX,
  ProjectShell,
  projectShareData,
} from '../../src/components/project/project-shell';
import { DEMO_PROJECTS } from '../../src/lib/data/demo';
import { getProjectByPath } from '../../src/lib/data/repository';
import { isPublicProjectAtPath } from '../../src/lib/project-access';
import { isProjectShellPath, parseHandleParam } from '../../src/lib/slug';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('URL pública canónica', () => {
  it('combina el origin configurable, el handle y el slug con slash final', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ORIGIN', 'https://producto.example/');
    vi.resetModules();
    const { publicProjectUrl } = await import('../../src/lib/urls');

    expect(publicProjectUrl({ handle: 'christian', slug: 'mi-proyecto' })).toBe(
      'https://producto.example/@christian/mi-proyecto/'
    );
  });

  it('no confunde la URL compartible con el origin técnico', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ORIGIN', 'https://uinex.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_PROJECTS_ORIGIN', 'https://origin.cloudfront.net');
    vi.resetModules();
    const { publicProjectUrl } = await import('../../src/lib/urls');
    const url = publicProjectUrl({ handle: 'ana', slug: 'prototipo' });

    expect(url).toBe('https://uinex.vercel.app/@ana/prototipo/');
    expect(projectShareData('Prototipo', url)).toEqual({ title: 'Prototipo', url });
    expect(JSON.stringify(projectShareData('Prototipo', url))).not.toContain('cloudfront');
  });
});

describe('acceso al Project Shell', () => {
  const published = DEMO_PROJECTS[0]!;

  it('acepta un proyecto público coherente y su ruta real', async () => {
    expect(isPublicProjectAtPath(published, published.ownerHandle, published.slug)).toBe(true);
    expect(await getProjectByPath(published.ownerHandle, published.slug)).not.toBeNull();
  });

  it('devuelve null para un slug inexistente', async () => {
    expect(await getProjectByPath(published.ownerHandle, 'no-existe')).toBeNull();
  });

  it.each([
    ['privado', { status: 'draft' as const }],
    ['moderado', { hiddenByAdmin: true }],
    ['sin versión publicada', { version: 0 }],
    ['sin archivo de entrada', { entryFile: '' }],
    ['propietario distinto', { ownerHandle: 'otra-persona' }],
    ['autor distinto', { author: { ...published.author, handle: 'otra-persona' } }],
  ])('rechaza un proyecto %s', (_name, changes) => {
    expect(
      isPublicProjectAtPath(
        { ...published, ...changes },
        published.ownerHandle,
        published.slug
      )
    ).toBe(false);
  });

  it('trata handles mal codificados como 404 y reconoce sólo la ruta exacta del shell', () => {
    expect(parseHandleParam('%')).toBeNull();
    expect(isProjectShellPath('/@christian/mi-proyecto/')).toBe(true);
    expect(isProjectShellPath('/@christian/mi-proyecto/preview')).toBe(false);
  });
});

describe('iframe aislado', () => {
  it('carga inmediatamente el origin correcto con un sandbox restrictivo', () => {
    const originUrl = 'https://origin.cloudfront.net/@christian/proyecto/';
    const html = renderToStaticMarkup(
      createElement(ProjectShell, {
        title: 'Proyecto',
        handle: 'christian',
        publicUrl: 'https://uinex.vercel.app/@christian/proyecto/',
        originUrl,
      })
    );

    expect(html).toContain(`src="${originUrl}"`);
    expect(html).toContain(`sandbox="${PROJECT_SHELL_SANDBOX}"`);
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('allow-top-navigation');
    expect(html).not.toContain('loading="lazy"');
  });
});
