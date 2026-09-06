import { publicationInputSchema } from '@/lib/publications';
import { createPublication, listPublicationsFor, publicationCoursesFor, publicationOptionsFor } from '@/lib/server/publications';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';

/**
 * `?options=1` sirve al compositor y al botón de compartir, que sólo necesitan
 * saber qué se puede compartir y con quién. Recorrer además todo el muro para
 * pintar un desplegable es trabajo que nadie llega a mirar.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const courses = await publicationCoursesFor(actor);
    if (new URL(request.url).searchParams.get('options') === '1') {
      return Response.json({ publications: [], options: await publicationOptionsFor(actor), courses });
    }
    const [publications, options] = await Promise.all([listPublicationsFor(actor), publicationOptionsFor(actor)]);
    return Response.json({ publications, options, courses });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const publication = await createPublication(actor, await readJson(request, publicationInputSchema));
    return Response.json({ publication }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
