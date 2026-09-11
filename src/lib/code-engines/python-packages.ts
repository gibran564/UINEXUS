/**
 * Qué paquetes de Python puede cargar una ejecución.
 *
 * ## Esto NO es `pip install`
 *
 * La lista está AQUÍ, en el código, y no en lo que escriba quien resuelve una
 * tarea. `micropip` sigue sin instalarse y `pip` sigue sin existir dentro del
 * intérprete: lo único que puede pasar es que un `import pandas` encuentre una
 * rueda que este proyecto decidió publicar.
 *
 * ## Y tampoco es acceso a la red
 *
 * Las ruedas se sirven desde `indexURL`, que es `/runtime/pyodide/` del PROPIO
 * origen (las copia `scripts/vendor-python-packages.mjs`, verificadas contra el
 * `sha256` del `pyodide-lock.json` instalado). El Worker sigue con `fetch`
 * inutilizado tras el arranque y la CSP sigue en `'self'`. Si las ruedas no se
 * han publicado, `loadPackage` falla contra el propio origen —un 404— y el
 * programa recibe un `ImportError` explicado, no una petición a Internet.
 *
 * ## Por qué estos y no más
 *
 * Son los que convierten a NexBook en un documento donde se puede analizar algo:
 * datos tabulares y una gráfica. Cada nombre añadido aquí son megas que alguien
 * descarga en la red de un aula, así que la lista crece cuando hay una razón
 * concreta, no por si acaso.
 */

/**
 * Los módulos que se pueden importar, y el paquete que los trae.
 *
 * Se indexa por el nombre del MÓDULO porque eso es lo que aparece en un
 * `import`, y no siempre coincide con el del paquete —`sklearn` viene de
 * `scikit-learn`—. Las dependencias las resuelve Pyodide con su propio lock.
 */
export const PYTHON_PACKAGE_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  numpy: 'numpy',
  pandas: 'pandas',
  matplotlib: 'matplotlib',
  // `pyplot` casi siempre se importa como `matplotlib.pyplot`, que ya queda
  // cubierto por el nombre de primer nivel. Se deja explícito para que un
  // `from matplotlib.pyplot import plot` también se detecte.
  'matplotlib.pyplot': 'matplotlib',
});

/**
 * Qué paquetes hacen falta para ESTE fuente.
 *
 * Se lee el texto en vez de usar `loadPackagesFromImports` de Pyodide a
 * propósito: esa función carga CUALQUIER cosa que reconozca del lock —356
 * paquetes— y aquí sólo puede cargarse lo que esté en la lista. La diferencia es
 * la que hay entre una lista blanca y un catálogo abierto.
 *
 * El análisis es deliberadamente simple —expresiones regulares sobre las líneas
 * de import— y por eso puede EQUIVOCARSE POR DEFECTO: un `importlib.import_module("pandas")`
 * no se detecta y el import fallará con un error claro. No puede equivocarse por
 * exceso, que es lo que importaría: sólo devuelve nombres de la lista.
 */
export function requiredPythonPackages(source: string): string[] {
  const found = new Set<string>();

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const names = match[1] ?? match[2] ?? '';
    for (const raw of names.split(',')) {
      const imported = raw.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
      if (!imported) continue;

      const packageName =
        PYTHON_PACKAGE_ALLOWLIST[imported] ??
        PYTHON_PACKAGE_ALLOWLIST[imported.split('.')[0] ?? ''];
      if (packageName) found.add(packageName);
    }
  }

  return [...found];
}

/**
 * `import a.b, c` y `from a.b import c`.
 *
 * Anclado al principio de línea (con `m`) para no confundirse con la palabra
 * «import» dentro de una cadena o de un comentario al final de una línea de
 * código. Un falso negativo aquí sólo significa que el import fallará con su
 * mensaje normal.
 */
const IMPORT_PATTERN = /^[ \t]*(?:import[ \t]+([^\n#]+)|from[ \t]+([A-Za-z0-9_.]+)[ \t]+import)/gm;
