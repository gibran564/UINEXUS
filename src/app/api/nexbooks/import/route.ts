import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { nexBookDocumentSchema, nexBookTitleSchema } from '@/lib/academic-schemas';
import { NEXBOOK_LIMITS } from '@/lib/constants';
import { createNexBook, toNexBook } from '@/lib/data/nexbooks';
import { pruneOrphanResults } from '@/lib/nexbook-document';
import {
  ArchiveRejected,
  assertArchiveWithinLimits,
  fromArchiveReferences,
  isSafeArchivePath,
  parseManifest,
  sniffImageType,
  type ArchiveEntry,
} from '@/lib/nexbook-archive';
import { nexBookAssetKey, nexBookImageExtension, putNexBookAsset } from '@/lib/aws/s3';
import { HttpError, errorResponse, requireWriter } from '@/lib/server/session';

/**
 * Importar un archivo `.nexbook`.
 *
 * ## El dueño es SIEMPRE quien importa
 *
 * El archivo no lleva `ownerUid` —el exportador no lo escribe— y aunque lo
 * llevara no se leería: el dueño sale del token, igual que en cualquier otra
 * escritura de Nextudio. Un formato de intercambio donde el archivo pudiera
 * declarar a quién pertenece sería un formato donde se puede escribir en la
 * cuenta de otro.
 *
 * Lo mismo con el contexto: un `.nexbook` importado nace `personal` y `private`.
 * No se puede importar un documento «dentro» de la actividad de nadie.
 *
 * ## El orden de las comprobaciones importa
 *
 * ```
 * tamaño del envío  →  entradas y rutas  →  manifiesto y versión
 *                   →  bytes de cada imagen  →  esquema del documento
 * ```
 *
 * De lo más barato a lo más caro, y de lo más estructural a lo más semántico.
 * Comprobar el esquema antes que el tamaño significaría parsear megas de JSON de
 * un archivo que se va a rechazar de todas formas.
 *
 * Las amenazas concretas que esto para —zip slip, ZIP bomb, imágenes que no lo
 * son, versiones futuras— están documentadas en `lib/nexbook-archive.ts` y en
 * docs/SECURITY.md.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) throw new HttpError(400, 'Falta el archivo .nexbook.');

    /**
     * El tamaño COMPRIMIDO, antes de descomprimir nada.
     *
     * Es la primera barrera contra un ZIP bomb: sin ella, la defensa llegaría
     * cuando la memoria ya está reservada.
     */
    if (file.size > NEXBOOK_LIMITS.maxArchiveBytes) {
      throw new HttpError(413, 'Ese archivo es demasiado grande.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = extractEntries(bytes);
    assertArchiveWithinLimits(entries);

    const manifest = parseManifest(readJsonEntry(entries, 'manifest.json'));
    const rawDocument = readJsonEntry(entries, 'document.json');
    if (!rawDocument) throw new ArchiveRejected('Ese .nexbook no contiene ningún documento.');

    /**
     * Las imágenes se suben ANTES de validar el documento.
     *
     * Hace falta el id nuevo de cada una para poder reescribir las referencias, y
     * el documento con rutas de archivo (`assets/1.png`) no pasaría el esquema,
     * que exige un UUID. El coste es que un documento inválido puede dejar
     * imágenes subidas sin dueño lógico; son bytes en un prefijo propio que
     * ningún documento referencia, y por tanto que nadie puede leer.
     */
    const assetIdByPath = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.path.startsWith('assets/')) continue;

      /**
       * El tipo se decide por el CONTENIDO, no por lo que diga el manifiesto.
       *
       * Un HTML con `<script>` renombrado a `.png` y declarado `image/png`
       * acabaría guardado y servido desde el propio origen. Los números mágicos
       * son lo que de verdad mira un navegador al decidir cómo tratar un
       * archivo, así que es lo que se mira aquí.
       */
      const mimeType = sniffImageType(entry.bytes);
      if (!mimeType) {
        throw new ArchiveRejected(
          `El archivo ${entry.path} no es una imagen PNG, JPEG o WebP válida.`
        );
      }
      if (entry.bytes.byteLength > NEXBOOK_LIMITS.maxAssetBytes) {
        throw new ArchiveRejected(`La imagen ${entry.path} pesa demasiado.`);
      }
      if (assetIdByPath.size >= NEXBOOK_LIMITS.maxAssetsPerNexBook) {
        throw new ArchiveRejected(
          `Un NexBook admite hasta ${NEXBOOK_LIMITS.maxAssetsPerNexBook} imágenes.`
        );
      }

      const assetId = randomUUID();
      const extension = nexBookImageExtension(mimeType);
      if (!extension) continue;

      await putNexBookAsset({
        key: nexBookAssetKey({ ownerUid: actor.uid, assetId, extension }),
        bytes: entry.bytes,
        contentType: mimeType,
      });
      assetIdByPath.set(entry.path, assetId);
    }

    const remapped = fromArchiveReferences(
      rawDocument as Parameters<typeof fromArchiveReferences>[0],
      assetIdByPath
    );

    const parsed = nexBookDocumentSchema.safeParse(remapped);
    if (!parsed.success) {
      throw new ArchiveRejected(
        parsed.error.issues[0]?.message ?? 'El documento de ese .nexbook no es válido.'
      );
    }

    const title = nexBookTitleSchema.safeParse(manifest.title);
    const record = await createNexBook({
      id: randomUUID(),
      ownerUid: actor.uid,
      title: title.success ? title.data : 'NexBook importado',
      // Personal y privado, siempre. Ver la cabecera.
      context: { type: 'personal' },
      visibility: 'private',
      document: pruneOrphanResults(parsed.data),
    });
    if (!record) throw new Error('No se pudo crear el NexBook.');

    return Response.json({ nexbook: toNexBook(record) }, { status: 201 });
  } catch (caught) {
    if (caught instanceof ArchiveRejected) {
      return errorResponse(new HttpError(400, caught.message));
    }
    return errorResponse(caught);
  }
}

/**
 * Descomprime, filtrando ANTES de gastar memoria.
 *
 * El `filter` de fflate se consulta con la cabecera de cada entrada, así que
 * decide sin haber descomprimido nada. Se usa para dos cosas:
 *
 *  · Rechazar rutas que el formato no admite —`../`, absolutas, barras
 *    invertidas— que es la defensa contra el zip slip en el punto más temprano
 *    posible.
 *  · Sumar los tamaños DECLARADOS y parar si pasan del presupuesto, que es la
 *    defensa contra un ZIP que se anuncia pequeño y ocupa gigas.
 *
 * Un archivo que MIENTA declarando poco tampoco funciona: fflate reserva la
 * salida con el tamaño declarado y falla si el flujo produce más. Las dos
 * mentiras posibles quedan cubiertas.
 */
function extractEntries(bytes: Uint8Array): ArchiveEntry[] {
  let declared = 0;
  let count = 0;

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        if (!isSafeArchivePath(file.name)) return false;
        count += 1;
        declared += file.originalSize ?? 0;
        if (count > NEXBOOK_LIMITS.maxArchiveEntries) return false;
        return declared <= NEXBOOK_LIMITS.maxArchiveBytes;
      },
    });
  } catch {
    throw new ArchiveRejected('Ese archivo no se pudo abrir: ¿es un .nexbook válido?');
  }

  return Object.entries(unzipped).map(([path, content]) => ({ path, bytes: content }));
}

function readJsonEntry(entries: ArchiveEntry[], path: string): unknown {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) return null;

  try {
    return JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown;
  } catch {
    throw new ArchiveRejected(`El archivo ${path} del .nexbook no es JSON válido.`);
  }
}
