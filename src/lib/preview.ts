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
 * La solución: se compone un documento autocontenido — CSS e imágenes
 * incrustados como data: URI — y se muestra con `sandbox=""`, es decir, origen
 * opaco y SIN scripts. Se ve exactamente cómo quedó el diseño, y no se ejecuta
 * una sola línea de JavaScript no confiable.
 *
 * Los scripts se activan al publicar, ya en el origen aislado. La interfaz lo
 * dice explícitamente para que nadie crea que su JS está roto.
 */

/** Tope de lo que se incrusta: por encima, la vista previa se vuelve lenta. */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

export interface PreviewResult {
  html: string;
  /** Avisos honestos para mostrar junto a la vista previa. */
  notes: string[];
  /**
   * El documento, ya sin scripts, no pinta nada visible.
   *
   * Es lo que le pasa a cualquier página que construye su contenido con
   * JavaScript. Sin esta señal, la vista previa era un rectángulo blanco de
   * 26rem y la explicación quedaba debajo, en gris pequeño: quien lo veía
   * concluía —razonablemente— que la plataforma estaba rota.
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

  if (inlineBudget) {
    for (const file of files) {
      const extension = extensionOf(file.path);
      if (extension === 'html' || extension === 'htm' || extension === 'css') continue;
      if (extension === 'js' || extension === 'mjs') continue; // no se ejecutan
      dataUrls.set(file.path, await readAsDataUrl(file));
    }
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
  let removedScripts = 0;

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

  // 4. Scripts fuera: en el borrador no se ejecuta código no confiable.
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, () => {
    removedScripts += 1;
    return '';
  });
  html = html.replace(/<script\b[^>]*\/>/gi, () => {
    removedScripts += 1;
    return '';
  });

  if (removedScripts > 0) {
    notes.push(
      `Esta vista previa no ejecuta JavaScript (${removedScripts} ${
        removedScripts === 1 ? 'script omitido' : 'scripts omitidos'
      }). Al publicar, tu proyecto se ejecuta completo en su propio dominio.`
    );
  }

  // 5. Los enlaces internos no llevan a ninguna parte dentro del marco.
  html = html.replace(/<a\b([^>]*)>/gi, '<a$1 target="_blank" rel="noopener noreferrer">');

  return { html, notes, rendersEmpty: looksEmpty(html) };
}
