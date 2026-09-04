import { z } from 'zod';
import { joinCodeSchema } from '@/lib/academic-schemas';
import { findCourseByCode } from '@/lib/data/academic';
import { toCourseDetail } from '@/lib/data/academic-mappers';
import { HttpError, errorResponse, readJson, requireWriter } from '@/lib/server/session';
import { joinCourse } from '@/lib/server/academic-writes';

/**
 * Autoinscripción con el código de la materia.
 *
 * Existe porque la alternativa —que el profesorado escriba 31 nombres de
 * usuario— es exactamente el trabajo manual que esta iteración viene a quitar.
 * El código se dicta en clase una vez y cada persona se inscribe sola.
 *
 * Quien se inscribe entra SIEMPRE como estudiante. No hay forma de pedir el rol
 * en el cuerpo: ser docente de una materia sólo lo concede otro docente de esa
 * materia desde `/api/courses/[courseId]/students`.
 */

const bodySchema = z.object({ code: joinCodeSchema });

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireWriter(request);
    const { code } = await readJson(request, bodySchema);

    const course = await findCourseByCode(code);
    // Mismo mensaje para «no existe» que para cualquier otro fallo de código:
    // distinguirlos permitiría descubrir códigos válidos a fuerza de probar.
    if (!course) throw new HttpError(404, 'No encontramos ninguna materia con ese código.');

    const joined = await joinCourse(actor, course);
    return Response.json({ course: toCourseDetail(joined, 'student') });
  } catch (caught) {
    return errorResponse(caught);
  }
}
