import type { StagedFile } from './types';
import { extensionOf } from './files';

/**
 * Vista previa del borrador, antes de publicar.
 *
 * El problema: en el paso 3 los archivos todavía están en el navegador, no en
 * el origen aislado, así que no hay un sitio seguro donde ejecutarlos. Meter
 * el HTML del alumno en el DOM de UINexus con `allow-same-origin` le daría
 * acceso a la sesión de Firebase de esa misma persona: un archivo copiado de
 * cualquier plantilla podría robarle el token.
 *
 * La solución: se compone un documento autocontenido — CSS, imágenes y JS
 * locales incrustados — y se muestra en un marco con `sandbox` SIN
 * `allow-same-origin`. Esa ausencia es la que protege: el navegador le da al
 * documento un origen OPACO, así que no hay cookies, ni localStorage, ni acceso
 * al documento padre. Aunque el JavaScript se ejecute, no tiene nada de UINexus
 * que leer.
 *
 * Antes el sandbox era `""`, que además prohíbe los scripts. Más estricto, sí,
 * pero convertía la vista previa en un rectángulo blanco para cualquier página
 * que se dibuje con JavaScript — es decir, para casi todas. Una vista previa
 * que no enseña la página no es una vista previa. Y la restricción tampoco
 * compraba gran cosa frente al riesgo real: quien mira este borrador es quien
 * acaba de subir el archivo, y el caso peligroso —alguien viendo el proyecto
 * de otra persona— ocurre en el origen aislado, que ya ejecuta con
 * `allow-scripts`.
 *
 * Lo que el marco sigue sin poder hacer: navegar la ventana de arriba, abrir
 * ventanas, o leer un solo byte de la sesión de quien lo mira.
 */

/** Tope de lo que se incrusta: por encima, la vista previa se vuelve lenta. */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

export interface PreviewResult {
  html: string;
  /** Avisos honestos para mostrar junto a la vista previa. */
  notes: string[];
  /**
   * No hay contenido visible NI script alguno que pueda generarlo.
   *
   * Con los scripts ejecutándose ya no se puede saber de antemano lo que va a
   * pintar una página, así que esto sólo se afirma cuando es seguro: documento
   * vacío y sin una línea de JavaScript. Ahí el marco en blanco no es una
   * vista previa, es un archivo que no tiene nada dentro.
   */
  rendersEmpty: boolean;
}

/**
 * ¿Queda algo que ver? Se mira el documento ya procesado, no el original: lo
 * que importa es lo que va a pintar el marco, no lo que traía el archivo.
 */
function looksEmpty(html: string): boolean {
  if (typeof DOMParser === 'undefined') return false;
  try {
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    if (!body) return false;
    if (body.textContent?.trim()) return false;
    // Sin texto todavía puede haber algo que mirar: una imagen, un SVG, un
    // vídeo, o un lienzo con dimensiones propias.
    return body.querySelector('img, svg, video, canvas, iframe, picture, object') === null;
  } catch {
    return false;
  }
}

async function readAsText(file: StagedFile): Promise<string> {
  return file.blob.text();
}

async function readAsDataUrl(file: StagedFile): Promise<string> {
  const buffer = new Uint8Array(await file.blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < buffer.length; index += 1) {
    binary += String.fromCharCode(buffer[index] as number);
  }
  return `data:${file.contentType};base64,${btoa(binary)}`;
}

/** Resuelve "../img/a.png" relativo a "css/estilos.css" -> "img/a.png". */
function resolvePath(from: string, reference: string): string {
  const base = from.split('/').slice(0, -1);
  const parts = reference.split('/');
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

function isExternal(reference: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
    reference.startsWith('//') ||
    reference.startsWith('#')
  );
}

export async function buildPreviewDocument(
  files: readonly StagedFile[],
  entryFile: string
): Promise<PreviewResult> {
  const notes: string[] = [];
  const entry = files.find((file) => file.path === entryFile);

  if (!entry) {
    return {
      html: '<!doctype html><p>No encontramos el archivo de entrada.</p>',
      notes: ['Falta el archivo index.html.'],
      rendersEmpty: false,
    };
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const inlineBudget = totalBytes <= MAX_INLINE_BYTES;
  if (!inlineBudget) {
    notes.push(
      'El proyecto es grande, así que la vista previa muestra sólo la estructura sin las imágenes. Al publicar se verá completo.'
    );
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  const dataUrls = new Map<string, string>();

  /** JS local leído como texto. Va aparte de `dataUrls` porque no se referencia
   *  como recurso: se incrusta dentro de la propia etiqueta <script>. */
  const scripts = new Map<string, string>();

  for (const file of files) {
    const extension = extensionOf(file.path);
    if (extension === 'js' || extension === 'mjs') {
      scripts.set(file.path, await readAsText(file));
      continue;
    }
    if (!inlineBudget) continue;
    if (extension === 'html' || extension === 'htm' || extension === 'css') continue;
    dataUrls.set(file.path, await readAsDataUrl(file));
  }

  /** Reescribe las url() de una hoja de estilos a data: URI. */
  async function inlineCss(cssPath: string): Promise<string> {
    const file = byPath.get(cssPath);
    if (!file) return '';
    const source = await readAsText(file);
    return source.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _quote, reference) => {
      if (isExternal(reference)) return match;
      const resolved = resolvePath(cssPath, reference);
      const dataUrl = dataUrls.get(resolved);
      return dataUrl ? `url("${dataUrl}")` : match;
    });
  }

  let html = await readAsText(entry);

  // 1. Hojas de estilo enlazadas -> <style> incrustado.
  const linkPattern = /<link\b[^>]*>/gi;
  const links = html.match(linkPattern) ?? [];
  for (const tag of links) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || isExternal(href)) continue;
    const resolved = resolvePath(entryFile, href);
    if (!byPath.has(resolved)) continue;
    html = html.replace(tag, `<style>\n${await inlineCss(resolved)}\n</style>`);
  }

  // 2. Estilos incrustados que referencian assets.
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  html = html.replace(stylePattern, (match, css: string) => {
    const rewritten = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (inner, _q, reference) => {
      if (isExternal(reference)) return inner;
      const dataUrl = dataUrls.get(resolvePath(entryFile, reference));
      return dataUrl ? `url("${dataUrl}")` : inner;
    });
    return match.replace(css, rewritten);
  });

  // 3. src / poster / srcset de imágenes, vídeo y audio.
  html = html.replace(
    /\b(src|poster)\s*=\s*["']([^"']+)["']/gi,
    (match, attribute: string, reference: string) => {
      if (isExternal(reference)) return match;
      const dataUrl = dataUrls.get(resolvePath(entryFile, reference));
      return dataUrl ? `${attribute}="${dataUrl}"` : match;
    }
  );

  // 4. Scripts. Los de la red se dejan tal cual; los locales se incrustan,
  //    porque los archivos todavia no estan servidos en ninguna parte desde la
  //    que el marco pueda pedirlos.
  let missingScripts = 0;
  let hasAnyScript = false;

  /** Un `</script>` dentro del propio codigo cerraria la etiqueta antes de
   *  tiempo y partiria el documento en dos. */
  const escapeClosingTag = (code: string): string =>
    code.replace(/<\/(script)/gi, '<\/$1');

  /** Etiqueta ya resuelta, o null si hay que dejarla como estaba. */
  function inlineScript(attributes: string): string | null {
    hasAnyScript = true;
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    if (!src || isExternal(src)) return null;

    const code = scripts.get(resolvePath(entryFile, src));
    if (code === undefined) {
      missingScripts += 1;
      return '';
    }
    // Se conserva `type` (module, importmap...) y se quita `src`.
    const kept = attributes.replace(/\s*src\s*=\s*["'][^"']*["']/i, '');
    return `<script${kept}>\n${escapeClosingTag(code)}\n</script>`;
  }

  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attributes: string) => inlineScript(attributes) ?? match
  );

  html = html.replace(
    /<script\b([^>]*)\/>/gi,
    (match, attributes: string) => inlineScript(attributes) ?? match
  );

  if (missingScripts > 0) {
    notes.push(
      `${missingScripts} ${
        missingScripts === 1 ? 'script apunta' : 'scripts apuntan'
      } a un archivo que no subiste, así que aquí no se ejecutan.`
    );
  }

  if (hasAnyScript) {
    notes.push(
      'Tu JavaScript se ejecuta, pero en un marco aislado y sin acceso a cookies ni a tu sesión. Si algo depende de estar en su dominio definitivo, sólo se verá tras publicar.'
    );
  }

  // 5. Los enlaces internos no llevan a ninguna parte dentro del marco.
  html = html.replace(/<a\b([^>]*)>/gi, '<a$1 target="_blank" rel="noopener noreferrer">');

  return { html, notes, rendersEmpty: !hasAnyScript && looksEmpty(html) };
}
