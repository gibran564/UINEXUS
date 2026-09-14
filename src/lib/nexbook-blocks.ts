import type { NexBookBlockType } from './types';

/**
 * El catálogo de bloques: qué tipos hay, cómo se llaman y qué hace falta para
 * ofrecerlos.
 *
 * Existe porque la misma lista se pinta ya en tres sitios —la cabecera de cada
 * tarjeta, el menú «+ Bloque» de la barra y el insertador que aparece entre dos
 * bloques— y va a pintarse en más. Tres copias de «cómo se llama un bloque de
 * hoja de cálculo» se separan en cuanto alguien corrige una: el menú ofrecería
 * un nombre y la tarjeta mostraría otro para el MISMO bloque.
 *
 * No declara tipos que no existan. Es la misma regla que en `NexBookBlock`: un
 * menú que promete lo que no hay enseña a desconfiar del resto.
 *
 * Sin iconos, a propósito. Nextudio no tiene un juego de iconos para bloques y
 * dibujar cinco sólo para este menú añadiría cinco cosas que mantener y que
 * traducir a un nombre accesible. Cuando exista el juego, se añade aquí y lo
 * heredan todos los menús a la vez: ésa es justamente la razón de este archivo.
 */

/** Lo que el entorno tiene que saber hacer para que el bloque sirva de algo. */
export type NexBookBlockRequirement = 'assetUpload';

export interface NexBookBlockDefinition {
  type: NexBookBlockType;
  /** Cómo se LLAMA el bloque. Lo usa la cabecera de la tarjeta. */
  label: string;
  /**
   * Cómo se ofrece en un menú, cuando nombrarlo no basta.
   *
   * Sólo lo lleva `ai_worklog`: el bloque ES un «Registro de uso de IA», pero lo
   * que se elige en el menú es «Registrar uso de IA», porque lo que se va a
   * hacer es documentar lo que pasó en otra herramienta y no pedirle nada a
   * Nextudio. La distinción estaba y se conserva; lo que no se conserva es que
   * viviera en dos archivos distintos.
   */
  action?: string;
  /** Qué se obtiene al elegirlo. Se pinta junto a la etiqueta, en gris. */
  hint: string;
  /** Sin esta capacidad el bloque NO se ofrece. */
  requires?: NexBookBlockRequirement;
}

/**
 * La definición de cada tipo.
 *
 * Es un `Record` sobre la unión para que añadir un miembro a `NexBookBlock`
 * ROMPA la compilación aquí: un bloque sin nombre se pintaría en la interfaz
 * como `ai_worklog`.
 */
const DEFINITIONS: Record<NexBookBlockType, Omit<NexBookBlockDefinition, 'type'>> = {
  markdown: { label: 'Texto', hint: 'Markdown' },
  code: { label: 'Código', hint: 'Python, R…' },
  spreadsheet: { label: 'Hoja de cálculo', hint: 'Datos y fórmulas' },
  image: { label: 'Imagen', hint: 'PNG, JPEG, WebP', requires: 'assetUpload' },
  ai_worklog: {
    label: 'Registro de uso de IA',
    action: 'Registrar uso de IA',
    hint: 'NexIA',
  },
};

/**
 * El orden en que se ofrecen.
 *
 * Primero lo que se escribe —texto y código—, que es lo que más se inserta;
 * después los datos. `image` va penúltimo porque es el único que puede no estar:
 * un tipo que aparece y desaparece en mitad de la lista mueve los demás debajo
 * del cursor de quien ya sabía dónde estaba el que buscaba.
 */
const ORDER: readonly NexBookBlockType[] = [
  'markdown',
  'code',
  'spreadsheet',
  'image',
  'ai_worklog',
];

export const NEXBOOK_BLOCKS: readonly NexBookBlockDefinition[] = ORDER.map((type) => ({
  type,
  ...DEFINITIONS[type],
}));

/** Cómo se llama este bloque. */
export function nexBookBlockLabel(type: NexBookBlockType): string {
  return DEFINITIONS[type].label;
}

/** Cómo se OFRECE este bloque en un menú. */
export function nexBookBlockAction(definition: NexBookBlockDefinition): string {
  return definition.action ?? definition.label;
}

/** Lo que el entorno sabe hacer, para decidir qué bloques tienen sentido. */
export interface NexBookBlockCapabilities {
  /** Hay a dónde subir una imagen. */
  assetUpload: boolean;
}

/**
 * Los bloques que se pueden ofrecer AQUÍ.
 *
 * Un NexBook sin subida de assets —la vista de lectura, una plantilla sin
 * sesión— no ofrece «Imagen»: el bloque se crearía vacío y sin forma de
 * rellenarlo, que es peor que no ofrecerlo. La comprobación vive aquí y no en
 * cada menú para que ninguno se la pueda saltar.
 */
export function insertableNexBookBlocks(
  capabilities: NexBookBlockCapabilities
): NexBookBlockDefinition[] {
  return NEXBOOK_BLOCKS.filter(
    (definition) => definition.requires !== 'assetUpload' || capabilities.assetUpload
  );
}
