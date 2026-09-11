/**
 * El lado PYTHON de las salidas ricas.
 *
 * ## Por qué esto es Python y no JavaScript
 *
 * La alternativa era inspeccionar el valor desde JS a través de un `PyProxy`,
 * preguntando por `columns`, por `iloc`, por `__len__`… Eso significa razonar
 * sobre la representación interna de objetos de pandas a través de dos capas de
 * traducción, y romperse en silencio cada vez que pandas cambie un detalle. En
 * Python, «¿esto se parece a una tabla?» es una pregunta de una línea.
 *
 * Lo que cruza la frontera es una CADENA JSON. No viaja ningún objeto vivo, así
 * que no hay `PyProxy` que liberar ni ciclo de vida que coordinar, y el
 * contrato entre los dos lados es un formato de datos y no una API.
 *
 * ## Nada de HTML
 *
 * pandas sabe producir su propio HTML y aquí se ignora a propósito. Renderizar
 * marcado generado por el código del alumnado es exactamente lo que
 * `MarkdownContent` lleva todo el proyecto evitando; se extraen columnas y filas,
 * y quien las pinta es UINexus.
 *
 * ## Vive en su propio módulo
 *
 * Se instala como `_uinexus_display` en `sys.modules`, NO en `__main__`. El
 * aislamiento vacía `__main__` alrededor de cada ejecución aislada, así que un
 * ayudante que viviera ahí desaparecería en cuanto se usara. Que el código del
 * alumnado pueda importarlo y estropearlo es cierto y no importa: sólo afectaría
 * a cómo se muestran SUS propios resultados.
 */

/** Límites que el lado Python aplica antes de serializar nada. */
export interface PythonDisplayLimits {
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
}

/**
 * El módulo de ayuda, como fuente de Python.
 *
 * `describe(value)` devuelve JSON con una tabla cuando el valor se parece a una,
 * y `None` cuando no. `capture_figures()` devuelve las figuras pendientes de
 * matplotlib como PNG en Base64.
 */
export function pythonDisplayModule(limits: PythonDisplayLimits): string {
  return `
import base64
import io
import json
import sys

MAX_ROWS = ${limits.maxRows}
MAX_COLUMNS = ${limits.maxColumns}
MAX_CELL = ${limits.maxCellChars}


def _cell(value):
    """Un valor de celda, reducido a un primitivo JSON.

    Los números se dejan como números para que la tabla pueda alinearlos a la
    derecha; todo lo demás se convierte a texto, porque una celda no es un sitio
    donde anidar un documento.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        # Fuera del rango seguro de JavaScript, un entero grande perdería
        # precisión al convertirse en double. Se manda como texto, que es
        # exacto, en vez de como un número que miente.
        return value if abs(value) <= 9007199254740991 else str(value)
    if isinstance(value, float):
        # NaN e infinitos no existen en JSON. Se dicen con palabras.
        if value != value:
            return "NaN"
        if value in (float("inf"), float("-inf")):
            return str(value)
        return value
    text = str(value)
    return text if len(text) <= MAX_CELL else text[:MAX_CELL] + "…"


def _table(columns, rows, total):
    return {
        "kind": "table",
        "columns": [str(c)[:MAX_CELL] for c in columns[:MAX_COLUMNS]],
        "rows": [[_cell(v) for v in row[:MAX_COLUMNS]] for row in rows],
        "totalRows": int(total),
    }


def _from_dataframe(value):
    """pandas y polars, por PATO y no por isinstance.

    Importar pandas para comprobar si algo es un DataFrame obligaría a cargar
    ocho megas de rueda para descubrir que no lo era. Se comprueba la forma.
    """
    columns = getattr(value, "columns", None)
    if columns is None or not hasattr(value, "__len__"):
        return None
    if not hasattr(value, "iloc") and not hasattr(value, "row"):
        return None

    try:
        total = len(value)
        head = value.head(MAX_ROWS) if hasattr(value, "head") else value
        names = [str(c) for c in list(columns)]

        if hasattr(head, "itertuples"):
            rows = [list(row)[1:] for row in head.itertuples()]
        elif hasattr(head, "rows"):
            rows = [list(r) for r in head.rows()]
        else:
            return None

        return _table(names, rows, total)
    except Exception:
        return None


def _from_series(value):
    """Una Series: dos columnas, índice y valor."""
    if not hasattr(value, "index") or hasattr(value, "columns"):
        return None
    if not hasattr(value, "__len__") or not hasattr(value, "iloc"):
        return None
    try:
        total = len(value)
        head = value.head(MAX_ROWS) if hasattr(value, "head") else value
        name = str(getattr(value, "name", None) or "valor")
        rows = [[i, v] for i, v in zip(list(head.index), list(head))]
        return _table(["índice", name], rows, total)
    except Exception:
        return None


def _from_records(value):
    """Una lista de diccionarios: lo que devuelve un csv.DictReader.

    Es el caso que funciona SIN instalar nada, y por eso importa: una tabla rica
    no debería exigir pandas para existir.
    """
    if not isinstance(value, (list, tuple)) or not value:
        return None
    if not all(isinstance(item, dict) for item in value):
        return None

    columns = []
    for item in value:
        for key in item:
            if key not in columns:
                columns.append(key)
    rows = [[item.get(c) for c in columns[:MAX_COLUMNS]] for item in value[:MAX_ROWS]]
    return _table([str(c) for c in columns], rows, len(value))


def _from_matrix(value):
    """Una lista de listas o de tuplas."""
    if not isinstance(value, (list, tuple)) or not value:
        return None
    if not all(isinstance(item, (list, tuple)) for item in value):
        return None
    if any(isinstance(item, (dict, str, bytes)) for item in value):
        return None

    width = max(len(item) for item in value)
    if width == 0:
        return None
    columns = ["c%d" % (i + 1) for i in range(min(width, MAX_COLUMNS))]
    rows = [list(item) + [None] * (width - len(item)) for item in value[:MAX_ROWS]]
    return _table(columns, rows, len(value))


def _from_columns(value):
    """Un diccionario de listas: {"a": [1, 2], "b": [3, 4]}."""
    if not isinstance(value, dict) or not value:
        return None
    if not all(isinstance(v, (list, tuple)) for v in value.values()):
        return None

    lengths = {len(v) for v in value.values()}
    if len(lengths) != 1:
        return None

    total = lengths.pop()
    names = list(value)[:MAX_COLUMNS]
    rows = [[value[c][i] for c in names] for i in range(min(total, MAX_ROWS))]
    return _table([str(c) for c in names], rows, total)


def describe(value):
    """El valor de la última expresión, como salida rica.

    Devuelve una cadena JSON, o None si el valor no tiene una representación
    mejor que la que ya dio \`print\`.
    """
    if value is None:
        return None

    for reader in (_from_dataframe, _from_series, _from_records, _from_matrix, _from_columns):
        try:
            found = reader(value)
        except Exception:
            found = None
        if found is not None:
            try:
                return json.dumps(found, ensure_ascii=False, default=str)
            except Exception:
                return None
    return None


def capture_figures():
    """Las figuras de matplotlib que queden abiertas, como PNG.

    Se leen de \`sys.modules\` y NO se importa matplotlib: si el programa no lo
    usó, esto no puede cargar ocho megas de rueda por si acaso.

    Las figuras se CIERRAN después de leerlas. Sin eso, en una sesión
    persistente la celda siguiente volvería a emitir las mismas gráficas, y
    quien ejecutara cinco celdas acabaría con quince imágenes.
    """
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return "[]"

    figures = []
    try:
        numbers = list(pyplot.get_fignums())
    except Exception:
        return "[]"

    for number in numbers:
        try:
            figure = pyplot.figure(number)
            # Una figura sin ejes ni artistas es una que nadie dibujó: emitirla
            # sería añadir un rectángulo en blanco debajo de la celda.
            if not figure.get_axes():
                pyplot.close(figure)
                continue

            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", dpi=100, bbox_inches="tight")
            width, height = figure.get_size_inches()
            figures.append(
                {
                    "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
                    "width": int(width * 100),
                    "height": int(height * 100),
                }
            )
        except Exception:
            pass
        finally:
            try:
                pyplot.close(number)
            except Exception:
                pass

    try:
        return json.dumps(figures)
    except Exception:
        return "[]"
`;
}
