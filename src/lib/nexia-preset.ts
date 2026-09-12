import { emptyAIWorklog } from './ai-worklog';
import { emptyDocument } from './nexbook-document';
import type { NexBookDocument } from './types';

/**
 * El preset NexIA.
 *
 * ## No existe una entidad NexIA
 *
 * Lo que esto produce es un **NexBook normal**: mismo tipo, misma tabla, misma
 * ruta, mismo `kind: 'nexbook'`, mismo `.nexbook` al exportarlo. No hay
 * `kind: 'nexia'`, ni `NexIADocument`, ni tabla nueva. NexIA es un punto de
 * partida —un documento sembrado con las dos piezas que hacen falta— y no un
 * producto aparte. Ver `docs/NEXTUDIO-ROADMAP.md` §D3.
 *
 * La consecuencia práctica importa: a los cinco minutos de crearlo, el
 * documento puede tener además una hoja de cálculo y tres celdas de Python, y
 * nada se rompe. Un tipo propio habría tenido que prohibirlo o duplicar el
 * editor.
 *
 * ## Por qué dos bloques y no uno
 *
 * El de texto dice qué es esto y qué NO es —que Nextudio no ejecuta la IA—
 * antes de que nadie empiece a escribir. Un documento que abriera directamente
 * en un formulario de once campos no explicaría para qué sirve rellenarlo.
 *
 * El texto es EDITABLE: es un documento personal y su autor manda. Bloquearlo
 * con `editableByStudent: false` sólo tiene sentido cuando lo reparte otra
 * persona, que es el caso de una plantilla docente.
 */

/** El título con el que nace. Se puede renombrar como cualquier otro NexBook. */
export const NEXIA_DEFAULT_TITLE = 'Registro de uso de IA';

const INTRO = [
  '# Registro de uso de IA',
  '',
  'Deja constancia de cómo usaste una herramienta de IA en este trabajo: qué le',
  'pediste, qué te contestó, qué aprovechaste, qué cambiaste y qué descartaste.',
  '',
  'Nextudio no ejecuta ninguna IA ni guarda tus claves: lo que hay aquí es tu',
  'registro de lo que hiciste fuera, escrito para que se pueda seguir.',
  '',
  'Puedes añadir más registros, código, datos o imágenes: esto es un NexBook',
  'como cualquier otro.',
].join('\n');

/** Los bloques con los que nace un NexIA. Un NexBook corriente, sembrado. */
export function nexiaPresetDocument(): NexBookDocument {
  return emptyDocument([
    { id: 'intro', type: 'markdown', source: INTRO },
    {
      id: 'registro',
      type: 'ai_worklog',
      worklog: emptyAIWorklog(),
      /**
       * `optional`: el campo de reflexión se pinta y no bloquea nada. En un
       * registro personal no hay nadie a quien entregar, así que `required` no
       * tendría dónde aplicarse y sólo pintaría una advertencia falsa.
       */
      conclusionMode: 'optional',
    },
  ]);
}
