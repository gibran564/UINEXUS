/**
 * Una representación del workspace, dibujada con el propio sistema de diseño.
 *
 * NO es una captura de pantalla, y esa distinción importa: una captura envejece
 * en cuanto cambia un botón, y una captura retocada promete cosas que el
 * producto no hace. Esto es HTML con los mismos tokens que la aplicación real,
 * enseñando exactamente las piezas que existen —editor, consola, estado de
 * guardado, ejecutar, entregar— y ninguna que no.
 *
 * Es estático a propósito. Meter Monaco de verdad en la portada serían 3 MB
 * para alguien que todavía no ha decidido si le interesa el producto.
 */
export function WorkspacePreview() {
  return (
    <div
      role="img"
      aria-label="Vista del espacio de trabajo: editor de código a la izquierda, instrucciones a la derecha y consola con la salida del programa debajo."
      className="overflow-hidden rounded-sm border border-line-strong bg-surface"
    >
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-3 py-2">
        <span className="text-sm font-medium">Método simplex · Investigación de Operaciones</span>
        <span className="font-mono text-label text-muted">Python</span>
      </div>

      <div className="grid md:grid-cols-[1.5fr_1fr]">
        {/* Editor */}
        <div className="border-b border-line p-3 md:border-b-0 md:border-r">
          <pre className="overflow-x-auto font-mono text-sm leading-relaxed">
            <code>
              <span className="text-subtle">1 </span>
              <span className="text-muted"># Maximizar 3x + 5y</span>
              {'\n'}
              <span className="text-subtle">2 </span>
              <span>costos = [</span>
              <span className="text-accent">3</span>
              <span>, </span>
              <span className="text-accent">5</span>
              <span>]</span>
              {'\n'}
              <span className="text-subtle">3 </span>
              {'\n'}
              <span className="text-subtle">4 </span>
              <span>total = </span>
              <span className="text-accent">sum</span>
              <span>(costos)</span>
              {'\n'}
              <span className="text-subtle">5 </span>
              <span className="text-accent">print</span>
              <span>(total)</span>
            </code>
          </pre>
        </div>

        {/* Instrucciones */}
        <div className="p-3">
          <p className="meta">Instrucciones</p>
          <p className="mt-1.5 text-sm text-muted">
            Modela el problema del ejercicio 4 y calcula el valor óptimo.
          </p>
          <p className="meta mt-4">Recursos</p>
          <p className="mt-1.5 text-sm text-muted">Apuntes de la unidad 2 · Plantilla del reporte</p>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 border-y border-line px-3 py-2">
        <span className="btn btn-primary btn-sm" aria-hidden="true">
          ▶ Ejecutar
        </span>
        <span className="text-label text-success">Guardado</span>
        <span className="ml-auto btn btn-secondary btn-sm" aria-hidden="true">
          Entregar
        </span>
      </div>

      {/* Consola */}
      <div className="px-3 py-3">
        <p className="meta">Consola</p>
        <pre className="mt-1.5 font-mono text-sm">
          <span className="text-subtle">&gt; </span>8
        </pre>
        <p className="mt-1 text-label text-subtle">Finalizado · 42 ms</p>
      </div>
    </div>
  );
}
