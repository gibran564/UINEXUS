import { describe, expect, it } from 'vitest';
import { normalizeAssetPath } from './origin-helpers';
import { contentTypeFor, pickEntryFile, sanitizeRelativePath } from '../../src/lib/files';

describe('rutas de publicación', () => {
  it('conserva rutas relativas seguras', () => {
    expect(sanitizeRelativePath('assets/css/app.css')).toBe('assets/css/app.css');
    expect(normalizeAssetPath('assets/css/app.css')).toBe('assets/css/app.css');
  });

  it('rechaza traversal, rutas ocultas y doble encoding', () => {
    expect(sanitizeRelativePath('../.env')).toBeNull();
    expect(sanitizeRelativePath('.git/config')).toBeNull();
    expect(normalizeAssetPath('%252e%252e/secret.txt')).toBeNull();
    expect(normalizeAssetPath('assets\\secret.txt')).toBeNull();
  });

  it('elige el index más cercano a la raíz y MIME autoritativo', () => {
    expect(pickEntryFile(['docs/index.html', 'index.html'])).toBe('index.html');
    expect(contentTypeFor('scripts/app.js')).toBe('text/javascript');
    expect(contentTypeFor('archivo.php')).toBe('application/octet-stream');
  });
});
