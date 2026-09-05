import { publicationInputSchema } from '@/lib/publications';
import { createPublication, listPublicationsFor, publicationOptionsFor } from '@/lib/server/publications';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const [publications, options] = await Promise.all([listPublicationsFor(actor), publicationOptionsFor(actor)]);
    return Response.json({ publications, options });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const publication = await createPublication(actor, await readJson(request, publicationInputSchema));
    return Response.json({ publication }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
