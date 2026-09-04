import { reportSchema } from '@/lib/schemas';
import { errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { createReport } from '@/lib/server/writes';

/**
 * Reportes de moderación.
 *
 * Cualquiera con sesión puede reportar; sólo el profesorado puede leerlos, y
 * eso vive en la ruta de staff, no aquí. El estado nace siempre `open`: quien
 * reporta no decide el resultado de su propio reporte.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const input = await readJson(request, reportSchema);
    await createReport(actor, input);
    return Response.json({ ok: true }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
