import type { Course, ProjectRecord, PublicUser } from '../types';

/**
 * Datos de ejemplo del MODO DEMO.
 *
 * No son "datos de prueba" desechables: son el contenido que ve cualquiera que
 * clone el repositorio sin configurar Firebase, así que están redactados como
 * lo estarían proyectos reales de la materia. Sirven además para revisar
 * densidad tipográfica, longitudes de título y estados de la galería.
 */

const now = Date.UTC(2026, 7, 1);
const day = 86_400_000;
const iso = (daysAgo: number): string => new Date(now - daysAgo * day).toISOString();

export const DEMO_USERS: PublicUser[] = [
  {
    handle: 'christian',
    displayName: 'Christian González',
    avatarUrl: null,
    bio: 'Me interesa cómo se sienten los sistemas escolares cuando por fin funcionan.',
    program: 'Ing. en Sistemas Computacionales · 7.º semestre',
    role: 'student',
    projectCount: 3,
    createdAt: iso(320),
  },
  {
    handle: 'ana',
    displayName: 'Ana Lucía Reyes',
    avatarUrl: null,
    bio: 'Investigación con usuarios y prototipos que se pueden tocar.',
    program: 'Lic. en Diseño Gráfico · 5.º semestre',
    role: 'student',
    projectCount: 2,
    createdAt: iso(280),
  },
  {
    handle: 'mateo',
    displayName: 'Mateo Fierro',
    avatarUrl: null,
    bio: 'Accesibilidad, contraste y todo lo que se lee con lector de pantalla.',
    program: 'Ing. en Sistemas Computacionales · 7.º semestre',
    role: 'student',
    projectCount: 2,
    createdAt: iso(240),
  },
  {
    handle: 'renata',
    displayName: 'Renata Ochoa',
    avatarUrl: null,
    bio: null,
    program: 'Lic. en Diseño Gráfico · 5.º semestre',
    role: 'student',
    projectCount: 1,
    createdAt: iso(150),
  },
  {
    handle: 'profesora-luz',
    displayName: 'Luz Adriana Márquez',
    avatarUrl: null,
    bio: 'Docente de Diseño Centrado en el Usuario.',
    program: 'Departamento de Sistemas y Computación',
    role: 'teacher',
    projectCount: 0,
    createdAt: iso(600),
  },
];

export const DEMO_COURSES: Course[] = [
  {
    id: 'dcu-2026',
    slug: 'diseno-centrado-usuario-2026',
    name: 'Diseño Centrado en el Usuario',
    institution: 'Instituto Tecnológico de Durango',
    term: 'Ago–Dic 2026',
    description:
      'Métodos de investigación, prototipado y evaluación de interfaces con personas reales.',
    teacherName: 'Luz Adriana Márquez',
    studentCount: 32,
    projectCount: 6,
    activities: [
      {
        id: 'a1',
        title: 'Actividad 1 · Evaluación heurística',
        description: 'Elige un sitio institucional y documenta diez problemas de usabilidad.',
        dueDate: '2026-09-12',
      },
      {
        id: 'a3',
        title: 'Actividad 3 · Rediseño de una interfaz existente',
        description:
          'Rediseña una pantalla que uses cada semana. Publica el prototipo navegable y explica cada decisión.',
        dueDate: '2026-10-24',
      },
      {
        id: 'af',
        title: 'Proyecto final',
        description: 'Producto completo con investigación, prototipo y pruebas con usuarios.',
        dueDate: '2026-12-05',
      },
    ],
  },
  {
    id: 'ia-2026',
    slug: 'interfaces-accesibles-2026',
    name: 'Interfaces Accesibles',
    institution: 'Instituto Tecnológico de Durango',
    term: 'Ago–Dic 2026',
    description: 'WCAG 2.2, tecnologías de asistencia y diseño inclusivo aplicado a la web.',
    teacherName: 'Luz Adriana Márquez',
    studentCount: 18,
    projectCount: 2,
    activities: [
      {
        id: 'b1',
        title: 'Actividad 1 · Auditoría con lector de pantalla',
        description: 'Recorre un flujo completo usando solamente NVDA o VoiceOver.',
        dueDate: '2026-09-26',
      },
    ],
  },
];

interface DemoSeed {
  slug: string;
  title: string;
  description: string;
  handle: string;
  tags: string[];
  courseId: string;
  group: string;
  type: ProjectRecord['projectType'];
  status: ProjectRecord['status'];
  featured?: boolean;
  views: number;
  daysAgo: number;
  brief?: ProjectRecord['brief'];
}

const SEEDS: DemoSeed[] = [
  {
    slug: 'redisenio-siit',
    title: 'Rediseño del sistema escolar SIIT',
    description:
      'Reconstrucción de la inscripción en línea: de once pantallas y dos manuales en PDF a un flujo de tres pasos que se entiende sin ayuda.',
    handle: 'christian',
    tags: ['UX', 'Rediseños', 'Accesibilidad'],
    courseId: 'dcu-2026',
    group: '7A',
    type: 'build',
    status: 'published',
    featured: true,
    views: 412,
    daysAgo: 6,
    brief: {
      problem:
        'Cada semestre, la inscripción concentra el mayor número de tickets de soporte del instituto. El sistema pide datos que ya tiene y usa vocabulario administrativo que nadie fuera de Servicios Escolares reconoce.',
      goal:
        'Que un estudiante de primer semestre complete su inscripción sin abrir el manual y sin llamar por teléfono.',
      process:
        'Observé a seis estudiantes inscribiéndose en tiempo real, registré dónde se detenían y reconstruí el mapa de la tarea. El prototipo pasó por dos rondas de prueba con cinco personas cada una.',
      tools: 'Figma, HTML/CSS, Vite',
      reflection:
        'El problema nunca fue la estética. Era el orden de las preguntas: pedir el horario antes de confirmar las materias obligaba a retroceder.',
    },
  },
  {
    slug: 'prototipo-biblioteca',
    title: 'Prototipo de préstamo bibliotecario',
    description:
      'Buscar, apartar y renovar un libro desde el celular, con avisos claros de cuándo hay que devolverlo.',
    handle: 'ana',
    tags: ['Prototipos', 'UI', 'Mobile'],
    courseId: 'dcu-2026',
    group: '5B',
    type: 'site',
    status: 'published',
    featured: true,
    views: 268,
    daysAgo: 11,
    brief: {
      problem:
        'El catálogo actual sólo existe en las computadoras de la biblioteca y no dice si un libro está disponible.',
      goal: 'Convertir la consulta del catálogo en algo que se resuelve de pie, en el pasillo.',
      tools: 'Figma, HTML, CSS',
    },
  },
  {
    slug: 'auditoria-contraste',
    title: 'Auditoría de contraste del portal institucional',
    description:
      'Documentación visual de 34 fallos de contraste WCAG 2.2 AA y la paleta corregida que los resuelve sin cambiar la identidad.',
    handle: 'mateo',
    tags: ['Accesibilidad', 'Investigación', 'UX'],
    courseId: 'ia-2026',
    group: '7A',
    type: 'html',
    status: 'published',
    views: 190,
    daysAgo: 15,
    brief: {
      problem:
        'El azul institucional sobre gris claro alcanza 2.8:1. Se reprueba el mínimo de 4.5:1 en textos que aparecen en todas las páginas.',
      goal: 'Proponer correcciones que respeten la identidad gráfica aprobada.',
      reflection:
        'Bajar la luminosidad del azul un 12 % resolvió 29 de los 34 casos sin tocar el manual de marca.',
    },
  },
  {
    slug: 'mapa-campus',
    title: 'Mapa del campus para estudiantes de nuevo ingreso',
    description:
      'Un mapa que responde la única pregunta real de la primera semana: cómo llego a mi salón desde donde estoy parado.',
    handle: 'renata',
    tags: ['UX', 'Prototipos', 'Web'],
    courseId: 'dcu-2026',
    group: '5B',
    type: 'site',
    status: 'published',
    views: 143,
    daysAgo: 21,
  },
  {
    slug: 'sistema-de-diseno-itd',
    title: 'Sistema de diseño para trámites escolares',
    description:
      'Tokens, componentes y reglas de escritura para que los doce trámites del instituto se sientan como uno solo.',
    handle: 'christian',
    tags: ['Design system', 'UI', 'Accesibilidad'],
    courseId: 'dcu-2026',
    group: '7A',
    type: 'build',
    status: 'published',
    views: 97,
    daysAgo: 28,
  },
  {
    slug: 'entrevistas-cafeteria',
    title: 'Diez entrevistas en la cafetería',
    description:
      'Síntesis de entrevistas breves sobre cómo se organiza el día un estudiante foráneo, con las citas textuales completas.',
    handle: 'ana',
    tags: ['Investigación', 'UX'],
    courseId: 'dcu-2026',
    group: '5B',
    type: 'html',
    status: 'published',
    views: 76,
    daysAgo: 34,
  },
  {
    slug: 'lector-pantalla-formularios',
    title: 'Formularios que se escuchan bien',
    description:
      'Ocho patrones de formulario comparados con NVDA: qué anuncia cada uno y cuál conviene usar.',
    handle: 'mateo',
    tags: ['Accesibilidad', 'UI'],
    courseId: 'ia-2026',
    group: '7A',
    type: 'html',
    status: 'published',
    views: 61,
    daysAgo: 42,
  },
  {
    slug: 'tipografia-en-pantalla',
    title: 'Experimento: tipografía a 200 % de zoom',
    description:
      'Qué se rompe cuando alguien con baja visión amplía la página. Ocho casos y sus arreglos.',
    handle: 'christian',
    tags: ['Experimentos', 'Tipografía', 'Accesibilidad'],
    courseId: 'ia-2026',
    group: '7A',
    type: 'html',
    status: 'unlisted',
    views: 12,
    daysAgo: 3,
  },
];

export const DEMO_PROJECTS: ProjectRecord[] = SEEDS.map((seed, index) => {
  const author = DEMO_USERS.find((user) => user.handle === seed.handle);
  const course = DEMO_COURSES.find((item) => item.id === seed.courseId);
  return {
    id: `demo-${index + 1}`,
    slug: seed.slug,
    title: seed.title,
    description: seed.description,
    author: {
      handle: seed.handle,
      displayName: author?.displayName ?? seed.handle,
      avatarUrl: null,
    },
    ownerId: `demo-uid-${seed.handle}`,
    ownerHandle: seed.handle,
    courseId: seed.courseId,
    courseName: course?.name ?? null,
    term: course?.term ?? null,
    group: seed.group,
    tags: seed.tags,
    cover: null,
    projectType: seed.type,
    status: seed.status,
    brief: seed.brief ?? {},
    version: 1,
    fileCount: seed.type === 'html' ? 3 : 24,
    totalBytes: seed.type === 'html' ? 48_000 : 1_240_000,
    entryFile: 'index.html',
    hiddenByAdmin: false,
    reportCount: 0,
    createdAt: iso(seed.daysAgo + 4),
    updatedAt: iso(seed.daysAgo),
    publishedAt: seed.status === 'draft' ? null : iso(seed.daysAgo),
    views: seed.views,
    featured: seed.featured ?? false,
  };
});
