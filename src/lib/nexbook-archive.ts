import { NEXBOOK_LIMITS } from './constants';
import { NEXBOOK_FORMAT_VERSION } from './types';
import type { NexBookDocument, NexBookImageMimeType } from './types';

/**
 * El formato `.nexbook`.
 *
 * ## Qué es
 *
 * Un ZIP con el documento, su manifiesto y los binarios que usa:
 *
 * ```
 * ejemplo.nexbook
 * ├── manifest.json      formato, versión, título, con qué se creó
 * ├── document.json      el documento, según NEXBOOK_FORMAT_VERSION
 * └── assets/            las imágenes, con nombres propios del archivo
 *     ├── 1.png
 *     └── 2.webp
 * ```
 *
 * ## Por qué un contenedor y no un solo JSON
 *
 * Porque un NexBook tiene binarios. Meterlos como Base64 dentro del JSON los
 * infla un 33 % y obliga a leer el archivo entero en memoria para sacar una
 * imagen. Y porque un contenedor deja sitio para lo que vendrá —datos, salidas
 * grandes— sin cambiar la versión del documento.
 *
 * ## Las referencias se REESCRIBEN
 *
 * Dentro del archivo, un bloque de imagen no apunta a un asset de la plataforma
 * sino a `assets/1.png`. Es lo que hace que un `.nexbook` se pueda abrir en otra
 * cuenta, en otra instalación o dentro de un año: si guardara el identificador
 * original, el archivo sólo serviría mientras el bucket de origen siguiera
 * existiendo y dando permiso.
 *
 * ## Qué NO lleva
 *
 * Ni `ownerUid`, ni el id del NexBook, ni su contexto académico, ni revisiones,
 * ni claves de S3, ni URLs firmadas, ni tokens. El documento pasa antes por
 * `publishableDocument`, que lo reconstruye campo a campo con lista blanca.
 */

export const NEXBOOK_ARCHIVE_FORMAT = 'uinexus-nexbook';
export const NEXBOOK_ARCHIVE_VERSION = 1;

export interface NexBookManifest {
  format: typeof NEXBOOK_ARCHIVE_FORMAT;
  version: number;
  /** La versión del DOCUMENTO, que evoluciona aparte de la del contenedor. */
  documentVersion: number;
  title: string;
  createdWith: string;
  exportedAt: string;
  assets: NexBookArchiveAsset[];
}

export interface NexBookArchiveAsset {
  /** La ruta dentro del ZIP: `assets/1.png`. */
  path: string;
  mimeType: NexBookImageMimeType;
  bytes: number;
}

/** Un archivo dentro del contenedor, ya en memoria. */
export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

const EXTENSIONS: Readonly<Record<NexBookImageMimeType, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

export function archiveAssetPath(index: number, mimeType: NexBookImageMimeType): string {
  return `assets/${index}.${EXTENSIONS[mimeType]}`;
}

/**
 * El nombre del archivo que se descarga.
 *
 * Sin acentos, sin barras y sin puntos de más: acaba siendo un nombre de archivo
 * en el sistema de quien lo descarga, y `../` en una cabecera
 * `Content-Disposition` es un problema de quien la lee.
 */
export function archiveFileName(title: string): string {
  const clean = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${clean || 'nexbook'}.nexbook`;
}

// ---------------------------------------------------------------------------
// Validación del contenedor al IMPORTAR
// ---------------------------------------------------------------------------

export class ArchiveRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveRejected';
  }
}

/**
 * ¿Esta ruta puede existir dentro del contenedor?
 *
 * ## Zip slip
 *
 * El ataque clásico contra un descompresor: una entrada llamada
 * `../../../etc/passwd` o `/etc/passwd` que, al escribirse «donde dice», sale
 * del directorio de destino. Nextudio no escribe estas entradas en un disco —van
 * a S3 con una clave que construye el servidor— así que el ataque no tendría
 * dónde aterrizar; se rechazan igual, porque una defensa que depende de que
 * nadie cambie el destino en el futuro no es una defensa.
 *
 * Se rechaza además todo lo que no sea exactamente lo que el formato define. Una
 * lista blanca de tres formas de ruta es mucho más fácil de razonar que una
 * lista de cosas prohibidas.
 */
export function isSafeArchivePath(path: string): boolean {
  if (!path || path.length > 200) return false;
  // Absolutas, tanto POSIX como Windows, y rutas con letra de unidad.
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return false;
  // `..` en cualquier segmento, y también las barras invertidas que algunos
  // compresores de Windows dejan como separador.
  if (path.includes('\\')) return false;
  if (path.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return false;
  }
  // Bytes nulos: cortan la cadena en cualquier API que hable con C.
  if (path.includes('\0')) return false;

  return path === 'manifest.json' || path === 'document.json' || /^assets\/[\w.-]{1,80}$/.test(path);
}

/**
 * Comprueba el contenedor antes de mirar lo que lleva dentro.
 *
 * ## ZIP bomb
 *
 * Un ZIP de 50 KB puede descomprimirse en varios gigas. La defensa es mirar el
 * tamaño YA DESCOMPRIMIDO —que es lo que ocupa en memoria— y el número de
 * entradas, y rechazar antes de seguir. Mirar sólo el tamaño del archivo
 * comprimido es exactamente lo que hace que el ataque funcione.
 */
export function assertArchiveWithinLimits(entries: ArchiveEntry[]): void {
  if (entries.length === 0) {
    throw new ArchiveRejected('Ese archivo no parece un .nexbook: está vacío.');
  }
  if (entries.length > NEXBOOK_LIMITS.maxArchiveEntries) {
    throw new ArchiveRejected(
      `Un .nexbook admite hasta ${NEXBOOK_LIMITS.maxArchiveEntries} archivos dentro.`
    );
  }

  let total = 0;
  for (const entry of entries) {
    if (!isSafeArchivePath(entry.path)) {
      throw new ArchiveRejected(`Ese .nexbook contiene una ruta que no se admite: ${entry.path}`);
    }
    total += entry.bytes.byteLength;
    if (total > NEXBOOK_LIMITS.maxArchiveBytes) {
      throw new ArchiveRejected(
        `El contenido del .nexbook supera ${Math.round(NEXBOOK_LIMITS.maxArchiveBytes / (1024 * 1024))} MB.`
      );
    }
  }
}

/**
 * El manifiesto, comprobado.
 *
 * La versión se comprueba ANTES que el contenido: un archivo de una versión
 * futura puede tener una forma que este código interpretaría mal, y «no puedo
 * abrir esto» es infinitamente mejor que abrirlo a medias.
 */
export function parseManifest(raw: unknown): NexBookManifest {
  if (!raw || typeof raw !== 'object') {
    throw new ArchiveRejected('Ese archivo no lleva un manifiesto válido.');
  }

  const manifest = raw as Partial<NexBookManifest>;
  if (manifest.format !== NEXBOOK_ARCHIVE_FORMAT) {
    throw new ArchiveRejected('Ese archivo no es un NexBook de Nextudio.');
  }
  if (typeof manifest.version !== 'number' || manifest.version > NEXBOOK_ARCHIVE_VERSION) {
    throw new ArchiveRejected(
      'Ese .nexbook se creó con una versión más nueva de Nextudio. Actualiza para abrirlo.'
    );
  }
  if (
    typeof manifest.documentVersion !== 'number' ||
    manifest.documentVersion > NEXBOOK_FORMAT_VERSION
  ) {
    throw new ArchiveRejected('El documento de ese .nexbook usa un formato más nuevo.');
  }

  return {
    format: NEXBOOK_ARCHIVE_FORMAT,
    version: manifest.version,
    documentVersion: manifest.documentVersion,
    title: typeof manifest.title === 'string' ? manifest.title.slice(0, NEXBOOK_LIMITS.maxTitleChars) : '',
    createdWith: typeof manifest.createdWith === 'string' ? manifest.createdWith.slice(0, 80) : '',
    exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt.slice(0, 40) : '',
    assets: Array.isArray(manifest.assets)
      ? manifest.assets.flatMap((asset) => {
          const candidate = asset as Partial<NexBookArchiveAsset>;
          if (typeof candidate.path !== 'string' || !isSafeArchivePath(candidate.path)) return [];
          if (!candidate.mimeType || !(candidate.mimeType in EXTENSIONS)) return [];
          return [
            {
              path: candidate.path,
              mimeType: candidate.mimeType,
              bytes: typeof candidate.bytes === 'number' ? candidate.bytes : 0,
            },
          ];
        })
      : [],
  };
}

/**
 * Los bytes de una imagen, comprobados contra su NÚMERO MÁGICO.
 *
 * El tipo declarado en el manifiesto es lo que dice quien hizo el archivo, y no
 * tiene por qué ser verdad. Se comprueban los primeros bytes, que es lo que un
 * navegador usa de verdad para decidir cómo tratar un archivo: así un HTML con
 * `<script>` renombrado a `.png` y declarado como `image/png` no acaba guardado
 * y servido como imagen desde el propio origen.
 */
export function sniffImageType(bytes: Uint8Array): NexBookImageMimeType | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => bytes[index] === byte)) return 'image/png';

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // WebP: "RIFF" ... "WEBP"
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';

  return null;
}

/** Reescribe las referencias del documento a rutas del contenedor. */
export function toArchiveReferences(
  document: NexBookDocument,
  pathByAssetId: Map<string, string>
): NexBookDocument {
  return remapAssets(document, (assetId) => pathByAssetId.get(assetId) ?? '');
}

/** Y al revés: de rutas del contenedor a assets de la plataforma. */
export function fromArchiveReferences(
  document: NexBookDocument,
  assetIdByPath: Map<string, string>
): NexBookDocument {
  return remapAssets(document, (path) => assetIdByPath.get(path) ?? '');
}

/**
 * Cambia todos los identificadores de asset del documento.
 *
 * En bloques —de imagen Y de registro de IA— y en resultados. Olvidar
 * cualquiera de los tres dejaría esas imágenes apuntando a ids de la
 * instalación de origen: imágenes rotas en cada importación, y un rastro de
 * identificadores ajenos dentro del archivo.
 *
 * La lista de sitios donde vive un `assetId` es la misma que recorre
 * `collectAssetIds`, y tiene que seguir siéndolo: si una función conoce un sitio
 * que la otra no, el que sobra se exporta sin bytes o los bytes se exportan sin
 * referencia. Hay una prueba que compara las dos.
 */
function remapAssets(
  document: NexBookDocument,
  translate: (reference: string) => string
): NexBookDocument {
  /**
   * Al importar, esto recorre JSON que viene de un archivo de fuera.
   *
   * Si `blocks` no es un array, recorrerlo lanza y el error que ve quien importa
   * es un fallo del servidor en vez de «ese archivo no es válido». Se devuelve
   * tal cual y que sea el esquema —que da mensajes escritos para personas— quien
   * lo rechace.
   */
  if (!Array.isArray(document?.blocks) || !document.results || typeof document.results !== 'object') {
    return document;
  }

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type === 'image') return { ...block, assetId: translate(block.assetId) };
      if (block.type === 'ai_worklog' && Array.isArray(block.responseImages)) {
        return {
          ...block,
          responseImages: block.responseImages.map((image) => ({
            ...image,
            assetId: translate(image.assetId),
          })),
        };
      }
      return block;
    }),
    results: Object.fromEntries(
      Object.entries(document.results).map(([blockId, result]) => [
        blockId,
        {
          ...result,
          outputs: Array.isArray(result?.outputs)
            ? result.outputs.map((output) =>
                output?.stream === 'image' ? { ...output, assetId: translate(output.assetId) } : output
              )
            : [],
        },
      ])
    ),
  };
}
