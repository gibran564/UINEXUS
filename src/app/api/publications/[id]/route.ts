import { publicationModerationSchema } from '@/lib/publications';
import { getPublicationFor, moderatePublication } from '@/lib/server/publications';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    return Response.json(await getPublicationFor(actor, (await context.params).id));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { status } = await readJson(request, publicationModerationSchema);
    return Response.json({ publication: await moderatePublication(actor, (await context.params).id, status) });
  } catch (error) { return errorResponse(error); }
}
