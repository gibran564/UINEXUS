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
 * Primero decía «Diseña. Publica. Comparte.» y explicaba cómo subir un
 * `index.html`. Después decía «programa y entrega». Las dos fueron
 * descripciones honestas de lo que el producto hacía entonces, y las dos se
 * quedaron cortas: hoy además se construyen laboratorios reproducibles —texto,
 * datos, código, tablas y gráficas en un mismo documento— y se registra de
 * forma trazable cómo se usó una IA.
 *
 * Esta versión cuenta el producto por sus FORMAS DE TRABAJAR y no por su lista
 * de funciones: NexCode para programar, NexLab para construir un documento
 * reproducible. Publicar sigue estando, y sigue siendo el último paso de una
 * historia más larga, no la identidad entera.
 *
 * ## La regla de esta página
 *
 * **No se anuncia nada que no exista.** La tabla de lenguajes se genera del
 * catálogo (`LanguageSupport`) y la vista del espacio de trabajo dibuja piezas
 * reales (`WorkspacePreview`). NexIA dejó de estar «en camino» en la Fase 3 y
 * el copy dejó de decirlo el mismo día: una promesa que ya se cumplió y se
 * sigue anunciando como futura envejece igual de mal que una que no se cumple.
 *
 * ## Por qué esto no es una cuadrícula de tarjetas
 *
 * La tentación con una portada así es resolverlo todo con seis tarjetas
 * iguales. Una tarjeta separa cosas que compiten entre sí; aquí las secciones
 * se leen en orden y cuentan una secuencia, así que lo que corresponde es
 * jerarquía tipográfica y divisores. Las tarjetas se reservan para lo que de
 * verdad es una cuadrícula: los proyectos, y las dos formas de trabajar.
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
              Nextudio es un espacio académico para programar, construir laboratorios
              reproducibles, desarrollar proyectos y entregar el proceso completo de tu trabajo.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Explorar Nextudio
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

      {/* ---------- Las formas de trabajar ---------- */}
      <section aria-labelledby="espacios" className="container-page pt-14">
        <h2 id="espacios" className="section-mark font-display text-h2">
          Un espacio para cada forma de trabajar
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          No es lo mismo probar veinte líneas de Python que explicar un análisis con sus datos,
          sus tablas y sus gráficas. Nextudio no obliga a convertir lo primero en lo segundo.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="panel p-5">
            <p className="meta">NexCode</p>
            <h3 className="mt-2 font-display text-h3">Quiero programar</h3>
            <p className="mt-2 text-sm text-muted">
              Un archivo, un lenguaje y el editor. Para un ejercicio, un algoritmo o una prueba
              rápida. Python y R se ejecutan ahí mismo, en tu navegador.
            </p>
          </article>

          <article className="panel p-5">
            <p className="meta">NexLab</p>
            <h3 className="mt-2 font-display text-h3">Quiero construir un laboratorio</h3>
            <p className="mt-2 text-sm text-muted">
              Un documento por bloques: explicación, código, hojas de cálculo e imágenes, con las
              tablas y las gráficas que devuelve tu propio programa. Se guarda como NexBook y se
              puede exportar.
            </p>
          </article>
        </div>

        {/*
          NexIA ya existe, así que el copy deja de decir «más adelante».

          Se describe por lo que HACE —registrar— y nunca por lo que no hace:
          Nextudio no ejecuta ninguna IA, no guarda claves y no genera texto, y
          esta página es el primer sitio donde eso se puede entender mal.
        */}
        <p className="mt-4 max-w-2xl text-sm text-subtle">
          Y con <strong className="font-medium text-fg">NexIA</strong> queda registrado de forma
          trazable cómo se usó una IA: qué herramienta, qué prompt, qué respondió, qué se
          aprovechó y qué decidió quien la usó. Nextudio no ejecuta la IA: guarda el registro de
          lo que se hizo con ella, dentro de una actividad o en un espacio propio.
        </p>
      </section>

      {/* ---------- La clase, y lo que hace falta para hacerla ---------- */}
      <section aria-labelledby="clase" className="container-page pt-16">
        <h2 id="clase" className="section-mark font-display text-h2">
          La clase más allá del aula
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Una actividad no tiene por qué terminar en «entrega un archivo». En Nextudio la
          instrucción y la herramienta para resolverla viven en el mismo sitio: se lee lo que hay
          que hacer y se hace ahí mismo.
        </p>

        <ol className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: '01',
              title: 'La docente plantea',
              text: 'Escribe la actividad, decide qué se entrega y deja materiales y un código inicial si hace falta.',
            },
            {
              n: '02',
              title: 'El estudiante construye',
              text: 'Abre la parte que le toca en NexCode o en NexLab, y ejecuta para ver si funciona.',
            },
            {
              n: '03',
              title: 'Se entrega',
              text: 'El trabajo se guarda solo y se entrega desde la misma pantalla, congelado tal y como estaba.',
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
              Programa dentro de Nextudio
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

      {/* ---------- Trabajo reproducible ---------- */}
      <section aria-labelledby="reproducible" className="container-page pt-16">
        <h2 id="reproducible" className="section-mark font-display text-h2">
          Trabajo reproducible
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Un NexLab guarda junto lo que casi siempre acaba separado: el razonamiento, los datos,
          el programa que los procesa y lo que devolvió al ejecutarlo. Quien lo revisa ve de
          dónde salió cada número.
        </p>

        <ul className="mt-7 divide-y divide-line border-y border-line">
          {[
            ['Explicación', 'Markdown con títulos, listas y tablas. Sin HTML de nadie ejecutándose en tu sesión.'],
            ['Código', 'Bloques en el lenguaje que elijas, con estado compartido entre celdas.'],
            ['Datos', 'Hojas de cálculo con fórmulas dentro del propio documento.'],
            ['Resultados', 'Texto, tablas, gráficas y errores, guardados en el orden real en que salieron.'],
          ].map(([title, text]) => (
            <li key={title} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5">
              <span className="w-28 shrink-0 font-display text-h3">{title}</span>
              <span className="min-w-0 flex-1 text-sm text-muted">{text}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 max-w-2xl text-sm text-subtle">
          Un resultado no es un bloque: lo que escribiste y lo que contestó la máquina se
          distinguen siempre, que es lo único que hace revisable un documento con código dentro.
        </p>
      </section>

      {/* ---------- El recorrido de un trabajo ---------- */}
      <section aria-labelledby="recorrido" className="container-page pt-16">
        <h2 id="recorrido" className="section-mark font-display text-h2">
          Del aula al portafolio
        </h2>
        <p className="mt-3 max-w-2xl text-lead text-muted">
          Casi nada nace terminado. Un ejercicio suelto puede crecer hasta ser la evidencia de
          una materia, y de ahí a algo que se enseña fuera de clase.
        </p>

        <ol className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {['Actividad', 'NexCode / NexLab', 'Evidencia', 'Entrega', 'Publicación'].map(
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

        <p className="mt-5 max-w-2xl text-sm text-muted">
          <strong className="font-medium text-fg">Entregar y publicar no son lo mismo.</strong>{' '}
          Lo que entregas queda congelado para quien lo califica. Si además quieres enseñarlo
          fuera, sacas una copia tuya, la limpias y la publicas: son dos decisiones distintas y
          se toman por separado.
        </p>
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
                'Programa en NexCode o construye un laboratorio en NexLab.',
                'Ejecuta y comprueba la salida antes de entregar.',
                'Retoma el trabajo donde lo dejaste, en otro día y otro equipo.',
                'Guarda tus propios espacios, sin que cuenten como entrega.',
                'Publica lo que quieras enseñar fuera de clase.',
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
                'Diseña actividades de varias partes, con o sin código.',
                'Reparte materiales, plantillas y datasets con la actividad.',
                'Elige el lenguaje y decide si se puede ejecutar.',
                'Prepara un laboratorio de partida y deja bloques bloqueados.',
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
              Nextudio es donde las clases se convierten en trabajo: empiezan como una
              instrucción, se escriben como código y terminan siendo algo tuyo.
            </p>
          </div>
          <Link href="/login" className="btn btn-primary btn-lg shrink-0">
            Entrar a Nextudio
          </Link>
        </div>
      </section>
    </>
  );
}
