import { searchPeople } from '@/lib/data/academic';
import { errorResponse, requireStaff } from '@/lib/server/session';

/**
 * Búsqueda de personas para inscribir en una materia.
 *
 * Sólo profesorado y administración, y sólo devuelve lo que ya es público en un
 * perfil: handle, nombre y avatar. Ni correo, ni UID, ni rol, ni materias. Con
 * eso basta para inscribir a alguien y no vale para construir un directorio.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff(request);

    const query = new URL(request.url).searchParams.get('q') ?? '';
    const people = await searchPeople(query, 20);

    return Response.json({
      people: people.map((person) => ({
        handle: person.handle,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
      })),
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
