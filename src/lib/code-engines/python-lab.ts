import type { LabDataset } from '../lab/dataset';

/**
 * El módulo `nex` de Python.
 *
 * ## Cómo entran los datos, y por qué así
 *
 * Como un literal JSON dentro del fuente del módulo, que se ejecuta con `exec`
 * en un módulo propio. NO a través de `jsglobals`: ese objeto es la única
 * ventana de Python hacia JavaScript y está vacío y congelado a propósito —es lo
 * que hace que `js.fetch`, `js.XMLHttpRequest` y `js.WebSocket` no existan para
 * el programa del alumnado, y es la barrera que está probada—. Abrirla para
 * pasar una hoja habría cambiado una garantía comprobable por una conveniencia.
 *
 * El coste es que los datos se serializan una vez por ejecución. Está acotado
 * por `maxLabRows` y por resolver sólo lo que la celda pide, que es justamente
 * lo que evita mandar el NexBook entero.
 *
 * ## Qué puede hacer este módulo, y qué no
 *
 * Puede: leer las hojas, imágenes y outputs que la celda referenció, y
 * convertirlos a `DataFrame` si pandas está cargado.
 *
 * No puede: hablar con la red —no hay con qué—, tocar el documento, escribir en
 * el NexBook, leer otro NexBook ni enterarse de quién ha iniciado sesión. Aquí
 * dentro sólo hay datos ya resueltos.
 */

/** El módulo se llama `_nexlab_data` y `nex` es la instancia que se expone. */
const MODULE = '_nexlab_data';

/**
 * El código del módulo.
 *
 * `to_dataframe()` importa pandas DENTRO de la función, no arriba: una celda que
 * sólo lee valores no tiene por qué pagar la carga de pandas, y el catálogo de
 * paquetes ya se decide mirando el fuente del alumnado.
 */
const SOURCE = String.raw`
import json as _json

class LabError(Exception):
    """Un problema al leer datos del NexBook. Dice qué pasó y qué hacer."""
    pass


class Sheet:
    """Una hoja del NexBook, ya calculada.

    Los valores son los RESULTADOS de las fórmulas, no su texto: una celda con
    =SUMA(A1:A3) llega como número. Es lo que hace que el código analice datos y
    no cadenas que empiezan por igual.
    """

    def __init__(self, payload):
        self.id = payload["id"]
        self.name = payload["name"]
        self.columns = list(payload["columns"])
        self.rows = [list(row) for row in payload["rows"]]

    def __repr__(self):
        return "<Sheet %r %d filas x %d columnas>" % (
            self.name or self.id, len(self.rows), len(self.columns)
        )

    def __len__(self):
        return len(self.rows)

    def __iter__(self):
        return iter(self.rows)

    def to_dicts(self):
        """Filas como diccionarios, usando los encabezados como claves."""
        return [dict(zip(self.columns, row)) for row in self.rows]

    def column(self, name):
        """Una columna por nombre. Error claro si no existe."""
        if name not in self.columns:
            raise LabError(
                'La hoja %r no tiene una columna llamada %r. Tiene: %s'
                % (self.name or self.id, name, ", ".join(repr(c) for c in self.columns))
            )
        index = self.columns.index(name)
        return [row[index] if index < len(row) else None for row in self.rows]

    def to_dataframe(self):
        """Un DataFrame de pandas.

        pandas se importa aquí y no arriba: una celda que sólo mira valores no
        tiene por qué cargarlo.
        """
        try:
            import pandas as _pd
        except ImportError:
            raise LabError(
                "pandas no está disponible en esta celda. Escribe import pandas en tu código "
                "para que Nextudio lo cargue antes de ejecutar."
            )
        return _pd.DataFrame(self.rows, columns=self.columns)


class Image:
    """Una imagen del NexBook, en BYTES.

    Nunca una URL ni una ruta: lo que llega aquí es el contenido, que el hilo
    principal descargó con la sesión de quien está trabajando.
    """

    def __init__(self, payload):
        import base64 as _b64
        self.id = payload["id"]
        self.name = payload["name"]
        self.mime_type = payload["mimeType"]
        self.bytes = _b64.b64decode(payload["base64"])

    def __repr__(self):
        return "<Image %r %s %d bytes>" % (self.name or self.id, self.mime_type, len(self.bytes))

    def __len__(self):
        return len(self.bytes)


class _Lab:
    def __init__(self, payload):
        self._catalog = payload["catalog"]
        self._problems = payload["problems"]
        self._sheets = {item["id"]: Sheet(item) for item in payload["sheets"]}
        self._outputs = {item["id"]: Sheet(item) for item in payload["outputs"]}
        self._images = {item["id"]: Image(item) for item in payload["images"]}

        self._sheets_by_name = {}
        for item in payload["sheets"]:
            self._sheets_by_name.setdefault(_key(item["name"]), self._sheets[item["id"]])
        self._outputs_by_name = {}
        for item in payload["outputs"]:
            self._outputs_by_name.setdefault(_key(item["name"]), self._outputs[item["id"]])
        self._images_by_name = {}
        for item in payload["images"]:
            self._images_by_name.setdefault(_key(item["name"]), self._images[item["id"]])

    def _fail(self, kind, reference):
        for problem in self._problems:
            if problem["kind"] == kind and problem["reference"] == reference:
                raise LabError(problem["message"])
        for problem in self._problems:
            if not problem["reference"]:
                raise LabError(problem["message"])
        raise LabError(
            'No se preparó ningún dato para %r. Las referencias tienen que ser texto literal, '
            'por ejemplo nex.sheet("Ventas").' % (reference,)
        )

    def _get(self, store, by_name, kind, reference):
        if reference in store:
            return store[reference]
        found = by_name.get(_key(reference))
        if found is not None:
            return found
        self._fail(kind, reference)

    # -- Hojas --------------------------------------------------------------

    def sheet(self, name):
        """La hoja con ese nombre (o identificador)."""
        return self._get(self._sheets, self._sheets_by_name, "sheet", name)

    def sheet_by_id(self, block_id):
        """La hoja con ese identificador de bloque. Nunca es ambiguo."""
        return self._get(self._sheets, {}, "sheet", block_id)

    def sheets(self):
        """Qué hojas tiene este NexBook. Nombres y tamaños, sin datos."""
        return [dict(item) for item in self._catalog["sheets"]]

    # -- Imágenes -----------------------------------------------------------

    def image(self, name):
        return self._get(self._images, self._images_by_name, "image", name)

    def image_by_id(self, block_id):
        return self._get(self._images, {}, "image", block_id)

    def images(self):
        return [dict(item) for item in self._catalog["images"]]

    # -- Outputs persistidos -------------------------------------------------

    def output(self, name):
        """La tabla que guardó otra celda.

        No es lo mismo que una variable del kernel: una variable se pierde al
        reiniciar y esto sobrevive, porque está guardado en el documento.
        """
        return self._get(self._outputs, self._outputs_by_name, "output", name)

    def output_by_id(self, block_id):
        return self._get(self._outputs, {}, "output", block_id)

    def outputs(self):
        return [dict(item) for item in self._catalog["outputs"]]


def _key(value):
    return (value or "").strip().lower()


def _build(raw):
    return _Lab(_json.loads(raw))
`;

/**
 * El módulo, listo para `runPythonAsync`.
 *
 * El JSON se pasa como literal de Python con `JSON.stringify` doble: el
 * resultado es una cadena JSON válida Y un literal de Python válido, así que no
 * hay ninguna concatenación donde un nombre de hoja con comillas pudiera
 * escaparse del literal.
 */
export function pythonLabModule(dataset: LabDataset): string {
  const payload = JSON.stringify(JSON.stringify(dataset));

  return `
import types as _types, sys as _sys
_nex_mod = _types.ModuleType(${JSON.stringify(MODULE)})
exec(${JSON.stringify(SOURCE)}, _nex_mod.__dict__)
_sys.modules[${JSON.stringify(MODULE)}] = _nex_mod
nex = _nex_mod._build(${payload})
LabError = _nex_mod.LabError
del _types, _sys, _nex_mod
`;
}

/** El nombre que el módulo deja en el espacio global. */
export const PYTHON_LAB_GLOBALS = ['nex', 'LabError'] as const;
