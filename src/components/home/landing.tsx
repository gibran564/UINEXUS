import Link from 'next/link';
import { ProjectCard } from '@/components/project/project-card';
import { ProjectGrid } from '@/components/project/project-grid';
import { SearchField } from '@/components/explore/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import { PRIMARY_CATEGORIES } from '@/lib/constants';
import type { Course, Project } from '@/lib/types';
import { coursePath, exploreHref } from '@/lib/urls';
import { LanguageSupport } from './language-support';
import { WorkspacePreview } from './workspace-preview';

/**
 * La portada pública.
 *
 * ## Qué cambió, y por qué
 *
 * Durante mucho tiempo esta página decía «Diseña. Publica. Comparte.» y
 * explicaba cómo subir un `index.html`. Era una descripción honesta de lo que
 * UINexus hacía entonces y hoy ya no lo es: se puede programar, ejecutar,
 * guardar y entregar aquí dentro. Alguien que llegaba de fuera se iba pensando
 * que esto era un hosting.
 *
 * Publicar sigue estando —es lo que cierra el ciclo, y sigue siendo lo que hace
 * que el trabajo sobreviva a la calificación—, pero pasa de ser la identidad
 * entera a ser el último paso de una historia más larga: una actividad empieza
 * como instrucción, se convierte en código, crece como proyecto y se publica.
 *
 * ## Por qué esto no es una cuadrícula de tarjetas
 *
 * La tentación con una portada así es resolverlo todo con seis tarjetas
 * iguales. Una tarjeta separa cosas que compiten entre sí; aquí las secciones
 * se leen en orden y cuentan una secuencia, así que lo que corresponde es
 * jerarquía tipográfica y divisores. Las tarjetas se reservan para lo que de
 * verdad es una cuadrícula: los proyectos.
 *
 * Los datos se siguen cargando en el servidor y entran por props: para quien
 * llega de un buscador esto es HTML completo.
 */
export function Landing({
  featured,
  latest,
  courses,
}: {
  featured: Project[];
  latest: Project[];
  courses: Course[];
}) {
  const [lead, ...rest] = featured;

  return (
    <>
      {/* ---------- Entrada ---------- */}
      <section className="border-b border-line bg-surface">
        <div className="container-page grid gap-10 py-12 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-16">
          <div>
            <p className="meta">Instituto Tecnológico de Durango</p>
            <h1 className="mt-3 font-display text-display">Aprende construyendo.</h1>
            <p className="mt-4 max-w-xl text-lead text-muted">
              Código, proyectos y clases en un solo espacio. Desarrolla, programa, practica,
              entrega y comparte tu trabajo sin salir de UINexus.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Explorar UINexus
              </Link>
              <Link href="/login" className="btn btn-secondary btn-lg">
                Iniciar sesión
              </Link>
            </div>
            <p className="mt-4 text-sm text-subtle">
              Explorar no requiere cuenta. Programar y entregar sí, con tu correo institucional.
            </p>
          </div>

          <WorkspacePreview />
        </div>
      </section>

      {/* ---------- La clase, y lo que hace falta para hacerla ---------- */}
      <section aria-labelledby="clase" className="container-page pt-14">
        <h2 id="clase" className="section-mark font-display text-h2">
          La clase más allá del aula
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Una actividad no tiene por qué terminar en «entrega un archivo». En UINexus la
          instrucción y la herramienta para resolverla viven en el mismo sitio: se lee lo que
          hay que hacer y se hace ahí mismo.
        </p>

        <ol className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: '01',
              title: 'La docente plantea',
              text: 'Escribe la actividad, elige el lenguaje y deja un código inicial si hace falta.',
            },
            {
              n: '02',
              title: 'El estudiante construye',
              text: 'Abre el paso, programa en el editor y ejecuta para ver si funciona.',
            },
            {
              n: '03',
              title: 'Se entrega',
              text: 'El trabajo se guarda solo y se entrega desde la misma pantalla.',
            },
            {
              n: '04',
              title: 'Queda',
              text: 'La evidencia no desaparece con la calificación: sigue siendo trabajo suyo.',
            },
          ].map((step) => (
            <li key={step.n}>
              <span className="meta tabular-nums">{step.n}</span>
              <h3 className="mt-1.5 font-display text-h3">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- El editor ---------- */}
      <section aria-labelledby="programa" className="container-page pt-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 id="programa" className="section-mark font-display text-h2">
              Programa dentro de UINexus
            </h2>
            <p className="mt-3 text-lead text-muted">
              Un editor de verdad, no un cuadro de texto. Sin instalar nada, sin configurar un
              entorno y sin perder la primera clase del semestre en que a alguien le funcione.
            </p>

            <ul className="mt-6 divide-y divide-line border-y border-line">
              {[
                ['Editor Monaco', 'El mismo motor que usa VS Code: resaltado, búsqueda, deshacer.'],
                ['Guardado automático', 'Se guarda mientras escribes. Cerrar la pestaña no cuesta trabajo.'],
                ['Ejecución y consola', 'Ejecuta con Ctrl + Enter y lee la salida y los errores debajo.'],
                ['Entrega en el mismo sitio', 'Lo que ejecutas es exactamente lo que entregas.'],
              ].map(([title, text]) => (
                <li key={title} className="py-3">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-0.5 text-sm text-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-sm border border-line bg-sunken p-4">
            <p className="meta">Python y R se ejecutan en tu navegador</p>
            <p className="mt-2 text-sm text-muted">
              El intérprete se descarga a tu equipo la primera vez que pulsas Ejecutar. Tu
              código no viaja a ningún servidor, no tiene acceso a internet y un programa que
              se quede colgado se detiene solo a los diez segundos.
            </p>
            <p className="mt-4 text-sm text-muted">
              Java y C se escriben y se entregan con el mismo editor. Compilarlos necesita
              infraestructura que todavía no tenemos, así que la interfaz lo dice en lugar de
              simularlo.
            </p>
          </div>
        </div>
      </section>

      <LanguageSupport />

      {/* ---------- El recorrido de un trabajo ---------- */}
      <section aria-labelledby="recorrido" className="container-page pt-16">
        <h2 id="recorrido" className="section-mark font-display text-h2">
          De práctica a proyecto
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Casi nada nace terminado. Un ejercicio suelto puede crecer hasta ser la evidencia de
          una materia, y de ahí a algo que se enseña fuera de clase.
        </p>

        <ol className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {['Práctica', 'Actividad', 'Proyecto', 'Evidencia', 'Publicación'].map(
            (stage, index) => (
              <li key={stage} className="flex items-center gap-3">
                {index > 0 && (
                  <span aria-hidden="true" className="text-subtle">
                    →
                  </span>
                )}
                <span className="chip">{stage}</span>
              </li>
            )
          )}
        </ol>
      </section>

      {/* ---------- Los dos actores ---------- */}
      <section aria-labelledby="actores" className="container-page pt-16">
        <h2 id="actores" className="sr-only">
          Qué puedes hacer según quién eres
        </h2>

        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h3 id="estudiantes" className="section-mark font-display text-h2">
              Para estudiantes
            </h3>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {[
                'Entra a tus materias y consulta lo que te toca.',
                'Programa en el editor, con guardado automático.',
                'Ejecuta y comprueba la salida antes de entregar.',
                'Retoma el trabajo donde lo dejaste, en otro día y otro equipo.',
                'Publica los proyectos que tu docente permita.',
              ].map((item) => (
                <li key={item} className="py-2.5 text-sm text-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 id="docentes" className="section-mark font-display text-h2">
              Para docentes
            </h3>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {[
                'Crea actividades de varios pasos, con o sin código.',
                'Elige el lenguaje y decide si se puede ejecutar.',
                'Deja un código inicial para que nadie empiece en blanco.',
                'Lee las entregas en el mismo editor, sin descargar nada.',
                'Ejecuta el código del estudiante sin modificar su entrega.',
              ].map((item) => (
                <li key={item} className="py-2.5 text-sm text-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- Publicar: el final del recorrido, no la identidad ---------- */}
      <section aria-labelledby="publicar" className="container-page pt-16">
        <h2 id="publicar" className="section-mark font-display text-h2">
          Publica lo que construyes
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Construye primero. Publica cuando esté listo. Un proyecto terminado obtiene su propia
          dirección y se comparte con un enlace, sin Git, sin npm y sin comprar un dominio.
        </p>

        {lead && (
          <div className="mt-9 grid gap-x-6 gap-y-9 lg:grid-cols-[1.6fr_1fr]">
            <div className="lg:row-span-2">
              <ProjectCard project={lead} priority />
            </div>
            {rest.map((project) => (
              <ProjectCard key={project.id} project={project} priority />
            ))}
          </div>
        )}
      </section>

      {/* ---------- Explorar ---------- */}
      <section aria-labelledby="explorar" className="container-page pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="explorar" className="section-mark font-display text-h2">
              Lo que está construyendo la comunidad
            </h2>
            <p className="mt-1 text-muted">Proyectos publicados de todas las materias.</p>
          </div>
          <Link href="/explore" className="text-sm text-accent underline underline-offset-2">
            Ver todos los proyectos
          </Link>
        </div>

        <div className="mt-6 max-w-2xl">
          <SearchField size="lg" />
        </div>

        <nav aria-label="Categorías" className="mt-4 flex flex-wrap gap-2">
          {PRIMARY_CATEGORIES.map((category) => (
            <Link key={category} href={exploreHref({ tag: category })} className="chip">
              {category}
            </Link>
          ))}
        </nav>

        <div className="mt-9">
          {latest.length > 0 ? (
            <ProjectGrid projects={latest} label="Proyectos recientes" />
          ) : (
            <EmptyState
              title="Todavía no hay proyectos publicados"
              description="En cuanto alguien publique el primero, aparecerá aquí."
              action={{ href: '/publish', label: 'Publicar el primero' }}
            />
          )}
        </div>
      </section>

      {/* ---------- Cursos ---------- */}
      {courses.length > 0 && (
        <section aria-labelledby="cursos" className="container-page pt-16">
          <h2 id="cursos" className="section-mark font-display text-h2">
            Materias
          </h2>
          <p className="mt-1 text-muted">Cada materia reúne sus actividades y su trabajo.</p>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={coursePath(course.slug)}
                  className="panel block h-full p-5 no-underline transition-colors hover:border-line-strong"
                >
                  <p className="meta">{course.term}</p>
                  <h3 className="mt-2 font-display text-h3">{course.name}</h3>
                  <p className="mt-1 text-sm text-muted">{course.institution}</p>
                  <p className="mt-4 text-sm text-subtle tabular-nums">
                    {course.projectCount} proyectos · {course.studentCount} estudiantes
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- Llamada final ---------- */}
      <section className="container-page pt-16">
        <div className="panel flex flex-col items-start gap-6 bg-sunken p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-h2">Construye. Aprende. Comparte.</h2>
            <p className="mt-2 max-w-xl text-muted">
              UINexus es donde las clases se convierten en proyectos: empiezan como una
              instrucción, se escriben como código y terminan siendo trabajo tuyo.
            </p>
          </div>
          <Link href="/login" className="btn btn-primary btn-lg shrink-0">
            Entrar a UINexus
          </Link>
        </div>
      </section>
    </>
  );
}
