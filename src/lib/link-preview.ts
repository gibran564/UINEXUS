/**
 * Reconocimiento de enlaces sin salir a la red.
 *
 * ## La decisión que gobierna este archivo
 *
 * UINexus **no visita** las URL que pega la gente. Ni para sacar el título, ni
 * el favicon, ni nada. Pedir metadatos a una dirección arbitraria convierte al
 * servidor en un cliente de peticiones que elige un tercero, que es un problema
 * de seguridad con nombre propio: SSRF. Con eso se alcanzan servicios internos,
 * metadatos de la nube (`169.254.169.254`) y cualquier cosa que viva en la red
 * privada del despliegue.
 *
 * El encargo ofrecía tres caminos: allowlist de proveedores, servicio de
 * metadatos endurecido, o metadatos escritos por la persona. Aquí se toma el
 * **primero**, porque es el único que cuesta cero riesgo: todo lo que hace este
 * módulo es mirar el texto de la URL. Sin `fetch`, sin DNS, sin timeouts que
 * ajustar, sin nada que endurecer.
 *
 * ## Los niveles (§39)
 *
 *   0 · enlace     se abre en otra pestaña.
 *   1 · tarjeta    dominio, proveedor y descripción escrita por quien lo pegó.
 *   2 · embed      sólo para proveedores con URL de incrustación documentada.
 *   3 · API        NO implementado, y no por olvido.
 *
 * ## Por qué el embed es la excepción y no la regla (§15)
 *
 * La mayoría de las páginas bloquean el iframe con `X-Frame-Options` o
 * `frame-ancestors`. Un embed genérico fallaría casi siempre y dejaría un
 * recuadro en blanco donde debería haber contenido: el caso normal parecería un
 * error. Por eso sólo se incrusta lo que se sabe que se puede incrustar, y todo
 * lo demás cae en la tarjeta, que **es parte normal del producto** y no un
 * fallo.
 */

export type LinkLevel = 0 | 1 | 2;

export interface LinkDescription {
  /** `false` cuando la URL no es utilizable. Ver `reason`. */
  ok: boolean;
  reason: string;
  /** Dominio sin `www.`. Vacío si la URL no se pudo leer. */
  domain: string;
  /** Nombre del proveedor reconocido, o el dominio si no se reconoce. */
  provider: string;
  /** URL de incrustación, sólo si el proveedor la admite. */
  embedUrl: string | null;
  level: LinkLevel;
}

interface ProviderAdapter {
  name: string;
  /** A qué dominios se aplica. Se comparan como sufijo de host. */
  hosts: string[];
  /**
   * Construye la URL de incrustación, o `null` si esta URL concreta del
   * proveedor no se puede incrustar. Devolver `null` es una respuesta normal:
   * un enlace a un perfil de Figma no es un archivo de Figma.
   */
  embed?: (url: URL) => string | null;
}

/**
 * Adaptadores por proveedor.
 *
 * Son ADAPTADORES, no tipos de paso (§«Proveedores conocidos»): en ningún sitio
 * existe un `YouTubeStep` ni un `MiroStep`. Un paso es genérico y esto sólo
 * decide cómo se pinta un enlace. Añadir un proveedor es añadir una entrada
 * aquí; no añadirlo no impide usar la herramienta, sólo se queda en nivel 1.
 */
const PROVIDERS: readonly ProviderAdapter[] = [
  {
    name: 'YouTube',
    hosts: ['youtube.com', 'youtu.be'],
    embed: (url) => {
      const id =
        url.hostname.endsWith('youtu.be')
          ? url.pathname.slice(1)
          : (url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).pop() ?? '');
      // Sólo caracteres de un id de vídeo. Cualquier otra cosa no se incrusta:
      // construir la URL de embed a partir de texto sin comprobar sería meter
      // en un `src` lo que escriba un tercero.
      return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    },
  },
  {
    name: 'Vimeo',
    hosts: ['vimeo.com'],
    embed: (url) => {
      const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
      return /^\d{6,12}$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    },
  },
  {
    name: 'Loom',
    hosts: ['loom.com'],
    embed: (url) => {
      const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
      return /^[a-f0-9]{16,40}$/i.test(id) ? `https://www.loom.com/embed/${id}` : null;
    },
  },
  {
    name: 'Figma',
    hosts: ['figma.com'],
    // Figma documenta un visor que acepta la URL del archivo como parámetro.
    embed: (url) =>
      /^\/(file|design|proto|board)\//.test(url.pathname)
        ? `https://www.figma.com/embed?embed_host=uinexus&url=${encodeURIComponent(url.toString())}`
        : null,
  },
  {
    name: 'Miro',
    hosts: ['miro.com'],
    embed: (url) => {
      const match = /\/app\/board\/([^/?#]+)/.exec(url.pathname);
      return match ? `https://miro.com/app/live-embed/${match[1]}/` : null;
    },
  },
  { name: 'Canva', hosts: ['canva.com'] },
  { name: 'GitHub', hosts: ['github.com', 'github.io'] },
  { name: 'Google Drive', hosts: ['drive.google.com', 'docs.google.com'] },
  { name: 'NotebookLM', hosts: ['notebooklm.google.com'] },
  { name: 'Perplexity', hosts: ['perplexity.ai'] },
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'openai.com'] },
  { name: 'Claude', hosts: ['claude.ai'] },
  { name: 'Gemini', hosts: ['gemini.google.com'] },
  { name: 'Napkin', hosts: ['napkin.ai'] },
  { name: 'HeyGen', hosts: ['heygen.com'] },
  { name: 'Gamma', hosts: ['gamma.app'] },
];

const UNUSABLE: LinkDescription = {
  ok: false,
  reason: 'Ese enlace no es válido. Tiene que empezar por http:// o https://',
  domain: '',
  provider: '',
  embedUrl: null,
  level: 0,
};

function matches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/**
 * Describe un enlace a partir de su texto.
 *
 * Función PURA: no toca red, no lee nada del entorno, y da el mismo resultado
 * en el servidor y en el navegador. Eso permite probarla entera y usarla en los
 * dos lados sin pensarlo.
 */
export function describeLink(raw: string): LinkDescription {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return UNUSABLE;
  }

  // Sólo http y https. `javascript:` y `data:` no son enlaces que se abren:
  // son código que se ejecuta en el contexto de quien pulsa.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ...UNUSABLE, reason: 'Sólo se admiten enlaces http:// y https://' };
  }

  const domain = url.hostname.replace(/^www\./, '');
  const provider = PROVIDERS.find((candidate) =>
    candidate.hosts.some((host) => matches(url.hostname, host))
  );

  if (!provider) {
    // Un proveedor desconocido NO es un problema: es el caso que hace que
    // UINexus sobreviva a la velocidad a la que salen herramientas nuevas.
    return { ok: true, reason: '', domain, provider: domain, embedUrl: null, level: 1 };
  }

  const embedUrl = provider.embed?.(url) ?? null;

  return {
    ok: true,
    reason: '',
    domain,
    provider: provider.name,
    embedUrl,
    level: embedUrl ? 2 : 1,
  };
}

/**
 * Atributos del iframe de un embed.
 *
 * `sandbox` sin `allow-top-navigation` ni `allow-modals`: el contenido puede
 * ejecutarse y reproducirse, pero no puede sacar a nadie de UINexus ni abrir
 * diálogos que parezcan de la plataforma.
 *
 * `allow-same-origin` es necesario y no es un agujero aquí: el iframe es
 * CROSS-origin, así que conserva el suyo propio —el de YouTube o el de Figma— y
 * no obtiene ningún acceso al de UINexus.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';
