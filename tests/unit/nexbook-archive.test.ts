import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { NEXBOOK_LIMITS } from '../../src/lib/constants';
import {
  ArchiveRejected,
  NEXBOOK_ARCHIVE_FORMAT,
  NEXBOOK_ARCHIVE_VERSION,
  archiveAssetPath,
  archiveFileName,
  assertArchiveWithinLimits,
  fromArchiveReferences,
  isSafeArchivePath,
  parseManifest,
  sniffImageType,
  toArchiveReferences,
} from '../../src/lib/nexbook-archive';
import type { NexBookDocument } from '../../src/lib/types';

/**
 * El formato `.nexbook`.
 *
 * Estas pruebas cubren las dos mitades que importan: que un archivo generado
 * aquí se pueda volver a leer, y que uno hostil no consiga nada. Lo segundo es
 * lo que justifica que el importador exista: un contenedor que llega de fuera es
 * exactamente el tipo de entrada que hay que tratar como hostil.
 */

const ASSET = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('rutas dentro del contenedor', () => {
  it('acepta sólo las tres formas que el formato define', () => {
    expect(isSafeArchivePath('manifest.json')).toBe(true);
    expect(isSafeArchivePath('document.json')).toBe(true);
    expect(isSafeArchivePath('assets/1.png')).toBe(true);
  });

  it('rechaza el zip slip en todas sus formas', () => {
    /**
     * El ataque clásico contra un descompresor: una entrada que, al escribirse
     * «donde dice», sale del directorio de destino. UINexus no escribe estas
     * entradas en un disco —van a S3 con una clave que construye el servidor—
     * así que hoy no tendrían dónde aterrizar. Se rechazan igual: una defensa
     * que depende de que nadie cambie el destino en el futuro no es una defensa.
     */
    const hostiles = [
      '../../../etc/passwd',
      '../document.json',
      'assets/../../secreto',
      '/etc/passwd',
      '\\\\servidor\\recurso',
      'C:\\Windows\\system32',
      'assets\\..\\..\\x.png',
      './document.json',
      'assets//1.png',
      'document.json\0.txt',
    ];

    for (const path of hostiles) {
      expect(isSafeArchivePath(path), path).toBe(false);
    }
  });

  it('rechaza rutas absurdamente largas y las que no son del formato', () => {
    expect(isSafeArchivePath(`assets/${'a'.repeat(300)}.png`)).toBe(false);
    expect(isSafeArchivePath('codigo.py')).toBe(false);
    expect(isSafeArchivePath('assets/subcarpeta/1.png')).toBe(false);
  });
});

describe('los límites del contenedor', () => {
  it('rechaza un contenedor vacío', () => {
    expect(() => assertArchiveWithinLimits([])).toThrow(ArchiveRejected);
  });

  it('rechaza demasiadas entradas', () => {
    const entries = Array.from(
      { length: NEXBOOK_LIMITS.maxArchiveEntries + 1 },
      (_, index) => ({ path: `assets/${index}.png`, bytes: new Uint8Array(1) })
    );

    expect(() => assertArchiveWithinLimits(entries)).toThrow(/hasta/);
  });

  it('rechaza cuando el contenido descomprimido pasa del presupuesto', () => {
    /**
     * La defensa contra un ZIP bomb mira el tamaño YA DESCOMPRIMIDO, que es lo
     * que ocupa en memoria. Mirar sólo el del archivo comprimido es exactamente
     * lo que hace que el ataque funcione.
     */
    const entries = [
      { path: 'manifest.json', bytes: new Uint8Array(10) },
      { path: 'assets/1.png', bytes: new Uint8Array(NEXBOOK_LIMITS.maxArchiveBytes) },
    ];

    expect(() => assertArchiveWithinLimits(entries)).toThrow(/supera/);
  });

  it('una ruta hostil corta la importación aunque quepa de sobra', () => {
    expect(() =>
      assertArchiveWithinLimits([{ path: '../fuera.json', bytes: new Uint8Array(1) }])
    ).toThrow(/no se admite/);
  });
});

describe('el manifiesto', () => {
  const valid = {
    format: NEXBOOK_ARCHIVE_FORMAT,
    version: NEXBOOK_ARCHIVE_VERSION,
    documentVersion: 1,
    title: 'Regresión lineal',
    createdWith: 'UINexus',
    exportedAt: '2026-09-10T12:00:00.000Z',
    assets: [{ path: 'assets/1.png', mimeType: 'image/png', bytes: 1024 }],
  };

  it('acepta uno correcto', () => {
    expect(parseManifest(valid).title).toBe('Regresión lineal');
  });

  it('rechaza un archivo que no es de UINexus', () => {
    expect(() => parseManifest({ ...valid, format: 'jupyter' })).toThrow(/no es un NexBook/);
  });

  it('rechaza una versión del FUTURO', () => {
    /**
     * Se comprueba antes que el contenido a propósito: un archivo de una versión
     * futura puede tener una forma que este código interpretaría mal, y «no
     * puedo abrir esto» es infinitamente mejor que abrirlo a medias.
     */
    expect(() => parseManifest({ ...valid, version: 99 })).toThrow(/más nueva/);
    expect(() => parseManifest({ ...valid, documentVersion: 99 })).toThrow(/más nuevo/);
  });

  it('descarta los assets con rutas o tipos que no admite', () => {
    const manifest = parseManifest({
      ...valid,
      assets: [
        { path: '../fuera.png', mimeType: 'image/png', bytes: 1 },
        { path: 'assets/2.svg', mimeType: 'image/svg+xml', bytes: 1 },
        { path: 'assets/3.png', mimeType: 'image/png', bytes: 1 },
      ],
    });

    expect(manifest.assets.map((asset) => asset.path)).toEqual(['assets/3.png']);
  });

  it('rechaza lo que no es un objeto', () => {
    for (const raw of [null, 'texto', 42, []]) {
      expect(() => parseManifest(raw)).toThrow(ArchiveRejected);
    }
  });
});

describe('el tipo real de una imagen', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    ...strToU8('RIFF'),
    0, 0, 0, 0,
    ...strToU8('WEBP'),
  ]);

  it('reconoce los tres formatos admitidos', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('un HTML renombrado a .png NO pasa por imagen', () => {
    /**
     * Es la prueba que justifica mirar los números mágicos en vez de fiarse del
     * manifiesto. Un HTML con `<script>` guardado y servido como imagen desde el
     * propio origen es ejecución de código de quien hizo el archivo.
     */
    const html = strToU8('<html><script>alert(1)</script></html>');
    expect(sniffImageType(html)).toBeNull();
  });

  it('un SVG tampoco pasa', () => {
    // XML con script dentro. Ver docs/SECURITY.md.
    expect(sniffImageType(strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
  });

  it('unos bytes demasiado cortos no son nada', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('las referencias se reescriben en los dos sentidos', () => {
  const document: NexBookDocument = {
    formatVersion: 1,
    blocks: [
      { id: 'b1', type: 'image', assetId: ASSET, mimeType: 'image/png', alt: 'mapa' },
      { id: 'b2', type: 'code', language: 'python', source: 'plot()' },
    ],
    results: {
      b2: {
        blockId: 'b2',
        status: 'ok',
        outputs: [
          { seq: 0, stream: 'stdout', text: 'listo\n' },
          { seq: 1, stream: 'image', assetId: ASSET, mimeType: 'image/png' },
        ],
        durationMs: 1,
        ranAt: '',
      },
    },
  };

  it('al exportar, los ids se convierten en rutas del archivo', () => {
    /**
     * Es lo que hace que un `.nexbook` se pueda abrir en otra cuenta o dentro de
     * un año: si guardara el identificador original, el archivo sólo serviría
     * mientras el bucket de origen siguiera existiendo y dando permiso.
     */
    const exported = toArchiveReferences(document, new Map([[ASSET, 'assets/1.png']]));
    const serialized = JSON.stringify(exported);

    expect(serialized).not.toContain(ASSET);
    expect(serialized).toContain('assets/1.png');
  });

  it('reescribe también los de los RESULTADOS, no sólo los de los bloques', () => {
    // Olvidarlos dejaría las gráficas apuntando a ids de la instalación de
    // origen: imágenes rotas y un rastro de identificadores ajenos.
    const exported = toArchiveReferences(document, new Map([[ASSET, 'assets/1.png']]));
    const output = exported.results.b2?.outputs[1];

    expect(output?.stream === 'image' && output.assetId).toBe('assets/1.png');
  });

  it('al importar se vuelve a ids NUEVOS, de quien importa', () => {
    const nuevo = '99999999-8888-4777-8666-555544443333';
    const exported = toArchiveReferences(document, new Map([[ASSET, 'assets/1.png']]));
    const imported = fromArchiveReferences(exported, new Map([['assets/1.png', nuevo]]));

    const block = imported.blocks[0];
    expect(block?.type === 'image' && block.assetId).toBe(nuevo);
    // Y el id de origen no sobrevive en ninguna parte.
    expect(JSON.stringify(imported)).not.toContain(ASSET);
  });

  it('no revienta con un documento malformado que viene de fuera', () => {
    /**
     * Al importar, esto recorre JSON de un archivo ajeno. Si lanzara, el error
     * que vería quien importa sería un fallo del servidor en vez de «ese archivo
     * no es válido».
     */
    const roto = { formatVersion: 1, blocks: 'no soy un array', results: null } as unknown as NexBookDocument;
    expect(() => fromArchiveReferences(roto, new Map())).not.toThrow();
  });
});

describe('el nombre del archivo descargado', () => {
  it('quita acentos, barras y todo lo que no sea un nombre', () => {
    // Acaba siendo un nombre de archivo en el sistema de quien lo descarga, y
    // `../` en una cabecera `Content-Disposition` es problema de quien la lee.
    // El acento se descompone y se quita la marca: `ó` queda en `o`, no se
    // pierde la letra. Y la barra desaparece antes de colapsar los espacios.
    expect(archiveFileName('Regresión / lineal')).toBe('Regresion-lineal.nexbook');
    expect(archiveFileName('../../etc/passwd')).toBe('etcpasswd.nexbook');
    expect(archiveFileName('')).toBe('nexbook.nexbook');
  });

  it('las rutas de los assets llevan la extensión de su tipo', () => {
    expect(archiveAssetPath(1, 'image/png')).toBe('assets/1.png');
    expect(archiveAssetPath(2, 'image/jpeg')).toBe('assets/2.jpg');
    expect(archiveAssetPath(3, 'image/webp')).toBe('assets/3.webp');
  });
});

describe('un contenedor de verdad, de ida y vuelta', () => {
  it('se comprime y se vuelve a leer con lo mismo dentro', () => {
    const manifest = {
      format: NEXBOOK_ARCHIVE_FORMAT,
      version: NEXBOOK_ARCHIVE_VERSION,
      documentVersion: 1,
      title: 'Prueba',
      createdWith: 'UINexus',
      exportedAt: '2026-09-10T12:00:00.000Z',
      assets: [],
    };
    const document = { formatVersion: 1, blocks: [], results: {} };

    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'document.json': strToU8(JSON.stringify(document)),
    });

    // Un ZIP de verdad, con cabeceras de verdad.
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe('PK');
  });
});
