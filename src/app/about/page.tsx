import type { Metadata } from 'next';
import { APP_HOST, PROJECTS_ORIGIN } from '@/lib/urls';
import Link from 'next/link';

/**
 * El host del origen aislado, leído de la configuración y NO escrito a mano.
 *
 * Antes esta página nombraba un dominio literal, que es la clase de dato que se
 * queda desfasado sin que nadie se entere: el origen real depende del
 * despliegue. Si mañana cambia, esta página cambia con él.
 */
const projectsHost = new URL(PROJECTS_ORIGIN).host;

export const metadata: Metadata = {
  title: 'Acerca de Nextudio',
  description:
    'Qué es Nextudio, cómo se ejecuta el código del alumnado, cómo se protege lo que publica y ' +
    'qué datos se hacen públicos.',
};

export default function AboutPage() {
  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-h1">Acerca de Nextudio</h1>

        <p className="mt-5 text-lead text-muted">
          Nextudio es el lugar donde una actividad de clase deja de vivir en una carpeta
          compartida. Se plantea aquí, se programa aquí, se ejecuta aquí y se entrega aquí; y
          cuando el trabajo está listo, obtiene una dirección propia que cualquiera puede abrir
          sin cuenta, sin instalar nada y sin pedir permiso.
        </p>

        <p className="mt-4 text-muted">
          El nombre junta dos ideas: <strong className="font-medium text-fg">nex</strong>, el
          punto donde se cruzan las cosas, y{' '}
          <strong className="font-medium text-fg">estudio</strong>, el taller donde se
          construyen. De ahí la retícula que aparece en el fondo de todas estas páginas: es el
          plano donde se colocan los trabajos, y su cruce es el aspa de la{' '}
          <strong className="font-medium text-fg">x</strong>.
        </p>

        <p className="mt-4 text-muted">
          Dentro hay dos formas de trabajar, y no hacen lo mismo:{' '}
          <strong className="font-medium text-fg">NexCode</strong> es un archivo y un editor,
          para programar; <strong className="font-medium text-fg">NexLab</strong> es un
          documento por bloques donde conviven la explicación, los datos, el código y lo que
          devolvió al ejecutarse. Un ejercicio de veinte líneas no necesita lo segundo, y un
          análisis completo no cabe en lo primero.
        </p>

        <section aria-labelledby="para-quien" className="mt-12">
          <h2 id="para-quien" className="section-mark font-display text-h2">
            Para quién
          </h2>
          <dl className="mt-5 space-y-5">
            <div>
              <dt className="font-medium">Para quien visita</dt>
              <dd className="mt-1 text-muted">
                Explorar, buscar y abrir cualquier proyecto publicado. Sin cuenta, sin registro,
                sin muros.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Para quien estudia</dt>
              <dd className="mt-1 text-muted">
                Programar en NexCode, construir laboratorios reproducibles en NexLab, ejecutar
                Python y R sin instalar nada, guardar espacios propios que no cuentan como
                entrega, entregar actividades, y publicar trabajo que se actualiza sin perder el
                enlace. Un portafolio que crece con las clases.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Para quien da clase</dt>
              <dd className="mt-1 text-muted">
                Actividades de varios pasos, con lenguaje y código inicial cuando piden
                programar, revisión del código en el mismo editor y una galería oficial por
                materia. Nextudio no pretende sustituir a Moodle, Classroom ni Canvas: se ocupa
                de lo que se construye.
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="seguridad" id="seguridad" className="mt-12 scroll-mt-24">
          <h2 id="seguridad" className="section-mark font-display text-h2">
            Cómo protegemos los proyectos
          </h2>

          <p className="mt-4 text-muted">
            Las páginas que suben los alumnos contienen HTML y JavaScript que la plataforma no
            controla. Si se ejecutaran dentro de <span className="font-mono">{APP_HOST}</span>,
            un script podría leer la sesión de quien está mirando y suplantar la interfaz. Por eso:
          </p>

          <ul className="mt-5 space-y-4">
            <Point title="Los proyectos viven en otro dominio">
              El contenido publicado se sirve desde{' '}
              <span className="font-mono">{projectsHost}</span>, un origen distinto del de la
              plataforma. La política de mismo origen del navegador hace el resto: desde ahí no
              se puede tocar nada de Nextudio. Lo que protege es que sea OTRO origen, no cómo se
              llame.
            </Point>
            <Point title="Las vistas previas van en una caja cerrada">
              Cuando ves un proyecto embebido, el marco no tiene acceso a cookies ni a
              almacenamiento, y en los borradores ni siquiera se ejecuta JavaScript.
            </Point>
            <Point title="El tipo de cada archivo lo decide el servidor">
              No se confía en lo que diga el archivo subido. Un{' '}
              <span className="font-mono">.txt</span> se sirve como texto aunque contenga
              etiquetas HTML.
            </Point>
            <Point title="Sólo sitios estáticos">
              HTML, CSS, JavaScript de navegador, imágenes y tipografías. Nextudio no ejecuta
              servidores de Node.js subidos por terceros: sería abrir la puerta a ejecución
              remota de código, minería y lectura de secretos.
            </Point>
            <Point title="El servidor manda, no el formulario">
              La validación que ves al subir sirve para darte buenos mensajes. Quien realmente
              decide qué se guarda es el servidor, que comprueba tu identidad y construye él
              mismo la ruta de cada archivo: el navegador no tiene credenciales para escribir
              nada por su cuenta.
            </Point>
          </ul>
        </section>

        <section aria-labelledby="privacidad" id="privacidad" className="mt-12 scroll-mt-24">
          <h2 id="privacidad" className="section-mark font-display text-h2">
            Privacidad
          </h2>
          <p className="mt-4 text-muted">
            En una página pública sólo aparece lo que la persona escribió en su perfil: su
            nombre, su descripción y, si quiere, su carrera o grupo. El correo electrónico y el
            identificador interno de la cuenta no se publican nunca, ni siquiera en el código de
            la página.
          </p>
          <p className="mt-3 text-muted">
            Un proyecto marcado como “sólo con enlace” no aparece en la galería, ni en las
            búsquedas, ni en el mapa del sitio para buscadores.
          </p>
        </section>

        <section aria-labelledby="limites" className="mt-12">
          <h2 id="limites" className="section-mark font-display text-h2">
            Límites
          </h2>
          <ul className="mt-4 space-y-2 text-muted">
            <li>· 10 MB por archivo y 50 MB por proyecto.</li>
            <li>· Hasta 300 archivos por proyecto.</li>
            <li>· Extensiones permitidas: las de un sitio web estático.</li>
            <li>· Cualquiera puede reportar un proyecto; el profesorado del curso lo revisa.</li>
          </ul>
        </section>

        <div className="mt-14 flex flex-wrap gap-3 border-t border-line pt-8">
          <Link href="/explore" className="btn btn-primary">
            Explorar proyectos
          </Link>
          <Link href="/publish" className="btn btn-secondary">
            Publicar el tuyo
          </Link>
        </div>
      </div>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-l-2 border-accent-line pl-4">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-muted">{children}</p>
    </li>
  );
}
