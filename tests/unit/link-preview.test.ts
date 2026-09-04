import { describe, expect, it } from 'vitest';
import { EMBED_SANDBOX, describeLink } from '../../src/lib/link-preview';

/**
 * Universal Link (Prioridad 4).
 *
 * Lo primero que se prueba es lo que NO se hace: este módulo no sale a la red.
 * Todo sale del texto de la URL, así que no hay SSRF que endurecer, ni
 * timeouts, ni bloqueo de IP privadas. Es la razón de haber elegido la
 * allowlist de proveedores frente a un servicio de metadatos.
 */

describe('protocolos', () => {
  it('acepta http y https', () => {
    expect(describeLink('https://miro.com/app/board/abc').ok).toBe(true);
    expect(describeLink('http://example.com').ok).toBe(true);
  });

  it('rechaza javascript:', () => {
    const result = describeLink('javascript:alert(1)');
    expect(result.ok).toBe(false);
    expect(result.embedUrl).toBeNull();
  });

  it('rechaza data:', () => {
    expect(describeLink('data:text/html,<script>alert(1)</script>').ok).toBe(false);
  });

  it('rechaza file: y otros esquemas', () => {
    expect(describeLink('file:///etc/passwd').ok).toBe(false);
    expect(describeLink('ftp://example.com').ok).toBe(false);
  });

  it('rechaza texto que no es una URL', () => {
    expect(describeLink('napkin punto ai').ok).toBe(false);
    expect(describeLink('').ok).toBe(false);
  });
});

describe('proveedor desconocido: el caso normal', () => {
  it('una herramienta que UINexus no conoce sigue siendo válida', () => {
    // Es lo que hace que la plataforma sobreviva a la velocidad a la que salen
    // herramientas nuevas: no reconocerla no es un error.
    const result = describeLink('https://some-new-ai-tool.example/board/1');
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('some-new-ai-tool.example');
    expect(result.level).toBe(1);
    expect(result.embedUrl).toBeNull();
  });

  it('quita el www del dominio', () => {
    expect(describeLink('https://www.ejemplo.com/x').domain).toBe('ejemplo.com');
  });
});

describe('proveedores reconocidos', () => {
  it('identifica el proveedor por dominio', () => {
    expect(describeLink('https://www.perplexity.ai/search/abc').provider).toBe('Perplexity');
    expect(describeLink('https://notebooklm.google.com/notebook/1').provider).toBe('NotebookLM');
    expect(describeLink('https://www.napkin.ai/').provider).toBe('Napkin');
    expect(describeLink('https://gamma.app/docs/x').provider).toBe('Gamma');
  });

  it('reconoce subdominios', () => {
    expect(describeLink('https://gist.github.com/alguien/1').provider).toBe('GitHub');
  });

  it('un proveedor conocido SIN embed se queda en nivel 1', () => {
    // Canva y GitHub se reconocen, pero no se incrustan: la tarjeta es la
    // respuesta correcta, no un fallo.
    const canva = describeLink('https://www.canva.com/design/abc/view');
    expect(canva.provider).toBe('Canva');
    expect(canva.level).toBe(1);
    expect(canva.embedUrl).toBeNull();
  });
});

describe('embed: sólo donde está documentado (§15)', () => {
  it('YouTube produce una URL de incrustación sin cookies', () => {
    const result = describeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.level).toBe(2);
    expect(result.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('youtu.be también', () => {
    expect(describeLink('https://youtu.be/dQw4w9WgXcQ').embedUrl).toContain(
      '/embed/dQw4w9WgXcQ'
    );
  });

  it('una URL de YouTube sin id de vídeo NO se incrusta', () => {
    // Construir el `src` de un iframe a partir de texto sin comprobar sería
    // meter en la página lo que escriba un tercero.
    expect(describeLink('https://www.youtube.com/').embedUrl).toBeNull();
    expect(describeLink('https://www.youtube.com/watch?v=../../evil').embedUrl).toBeNull();
  });

  it('Figma incrusta un archivo y no un perfil', () => {
    expect(describeLink('https://www.figma.com/file/abc/Proyecto').embedUrl).toContain(
      'figma.com/embed'
    );
    expect(describeLink('https://www.figma.com/@alguien').embedUrl).toBeNull();
  });

  it('Miro incrusta un tablero', () => {
    const result = describeLink('https://miro.com/app/board/uXjVK123=/');
    expect(result.embedUrl).toBe('https://miro.com/app/live-embed/uXjVK123=/');
  });

  it('Vimeo y Loom sólo con un identificador con la forma correcta', () => {
    expect(describeLink('https://vimeo.com/123456789').embedUrl).toContain('player.vimeo.com');
    expect(describeLink('https://vimeo.com/canal/algo').embedUrl).toBeNull();
    expect(describeLink('https://www.loom.com/share/abcdef0123456789').embedUrl).toContain(
      'loom.com/embed'
    );
  });

  it('la URL de embed siempre es https', () => {
    for (const raw of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.figma.com/file/abc/X',
      'https://miro.com/app/board/uXjVK1/',
      'https://vimeo.com/123456789',
    ]) {
      const { embedUrl } = describeLink(raw);
      expect(embedUrl?.startsWith('https://')).toBe(true);
    }
  });
});

describe('el sandbox del iframe', () => {
  it('no concede navegación de la página ni diálogos', () => {
    // Sin `allow-top-navigation`, el contenido de un tercero no puede sacar a
    // nadie de UINexus; sin `allow-modals`, no puede abrir diálogos que
    // parezcan de la plataforma.
    expect(EMBED_SANDBOX).not.toContain('allow-top-navigation');
    expect(EMBED_SANDBOX).not.toContain('allow-modals');
    expect(EMBED_SANDBOX).not.toContain('allow-downloads');
  });

  it('concede lo mínimo para que el embed funcione', () => {
    expect(EMBED_SANDBOX).toContain('allow-scripts');
    expect(EMBED_SANDBOX).toContain('allow-same-origin');
  });
});

describe('la descripción es pura', () => {
  it('el mismo enlace da siempre el mismo resultado', () => {
    const a = describeLink('https://miro.com/app/board/abc/');
    const b = describeLink('https://miro.com/app/board/abc/');
    expect(a).toEqual(b);
  });

  it('no depende de nada del entorno', () => {
    // Si esto necesitara red, `fetch` no existiría en el entorno de pruebas de
    // Node sin configurar y la llamada fallaría. Pasa porque no hay red.
    expect(() => describeLink('https://cualquier-cosa.example')).not.toThrow();
  });
});
