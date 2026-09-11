import { getPublication, toPublication } from '@/lib/data/nexbook-publications';
import { HttpError, errorResponse, requireIdentity } from '@/lib/server/session';

/**
 * Leer un NexBook publicado.
 *
 * ## Qué significa cada visibilidad
 *
 * ```
 * public   cualquiera, sin identificarse. Aparece como página abierta.
 * link     cualquiera que tenga la dirección. No se lista en ningún sitio.
 * class    hace falta una identidad institucional válida.
 * ```
 *
 * `link` y `public` se sirven igual porque lo que los distingue no es quién
 * puede leer sino si la dirección se anuncia: el slug es un hash de 24
 * caracteres, no adivinable. Decir que `link` es «más privado» que `public` a
 * nivel de permisos sería prometer una protección que no existe, y esa promesa
 * es la que lleva a poner ahí algo que no debería estar. Ver docs/SECURITY.md.
 *
 * ## Lo que NO se devuelve
 *
 * `ownerUid` y `sourceNexbookId`. El primero por la regla de siempre; el segundo
 * porque es la dirección del documento VIVO, y publicar no puede filtrar dónde
 * se sigue editando.
 */

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const { slug } = await params;

    const record = await getPublication(slug);
    // Una publicación que no existe y una que existe pero no se puede ver
    // responden IGUAL más abajo, por la misma razón de siempre.
    if (!record) throw new HttpError(404, 'Esa publicación no existe.');

    if (record.visibility === 'class') {
      try {
        await requireIdentity(request);
      } catch {
        throw new HttpError(404, 'Esa publicación no existe.');
      }
    }

    return Response.json({ publication: toPublication(record) });
  } catch (caught) {
    return errorResponse(caught);
  }
}
