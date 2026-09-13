import { describe, expect, it } from 'vitest';
import { buildPreviewDocument } from '../../src/lib/preview';
import { workspaceFilesToStagedFiles } from '../../src/lib/workspace-files';

async function preview(files: Record<string, string>, entryFile = 'index.html') {
  return buildPreviewDocument(workspaceFilesToStagedFiles(files), entryFile);
}

describe('la vista previa real de un NexCode web', () => {
  it('incrusta una hoja CSS relativa', async () => {
    const result = await preview({
      'index.html': '<link rel="stylesheet" href="styles.css"><h1>Hola</h1>',
      'styles.css': 'h1 { color: rgb(12, 34, 56); }',
    });

    expect(result.html).toContain('<style>');
    expect(result.html).toContain('h1 { color: rgb(12, 34, 56); }');
    expect(result.html).not.toContain('href="styles.css"');
  });

  it('incrusta JavaScript relativo y elimina su src', async () => {
    const result = await preview({
      'index.html': '<main></main><script src="script.js"></script>',
      'script.js': 'document.querySelector("main").textContent = "Listo";',
    });

    expect(result.html).toContain('document.querySelector("main").textContent = "Listo";');
    expect(result.html).not.toContain('src="script.js"');
  });

  it('resuelve ../ desde un HTML en un subdirectorio', async () => {
    const result = await preview(
      {
        'pages/index.html': '<link rel="stylesheet" href="../assets/style.css">',
        'assets/style.css': 'body { background: tomato; }',
      },
      'pages/index.html'
    );

    expect(result.html).toContain('body { background: tomato; }');
  });

  it('resuelve ./script.js igual que script.js', async () => {
    const result = await preview({
      'index.html': '<script src="./script.js"></script>',
      'script.js': 'window.previewReady = true;',
    });

    expect(result.html).toContain('window.previewReady = true;');
    expect(result.html).not.toContain('src="./script.js"');
  });

  it('conserva intactas las referencias externas', async () => {
    const external = 'https://example.com/styles.css';
    const result = await preview({
      'index.html': `<link rel="stylesheet" href="${external}">`,
    });

    expect(result.html).toContain(`href="${external}"`);
  });

  it('tolera un script ausente y lo explica con una nota', async () => {
    const result = await preview({
      'index.html': '<h1>Hola</h1><script src="no-existe.js"></script>',
    });

    expect(result.html).toContain('<h1>Hola</h1>');
    expect(result.notes.some((note) => note.includes('no subiste'))).toBe(true);
  });

  it('nunca busca un recurso por basename', async () => {
    const result = await preview({
      'index.html': '<link rel="stylesheet" href="otro/styles.css">',
      'styles.css': 'body { color: fuchsia; }',
    });

    expect(result.html).toContain('href="otro/styles.css"');
    expect(result.html).not.toContain('body { color: fuchsia; }');
  });
});
