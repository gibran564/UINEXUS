import type { CodeProject } from '../code-runner-contract';
import { isReservedJavaPackage } from './java-toolchain';

/**
 * Qué clase hay que ejecutar, deducida del fuente.
 *
 * ## Por qué no vale una expresión regular
 *
 * `Main` es una suposición, no un dato. El archivo de entrada de un proyecto
 * real declara un paquete, puede tener varias clases, puede tener clases
 * anidadas y puede hablar de `public class` dentro de un comentario o de una
 * cadena. Una regla como `/public class (\w+)/` acierta en el ejemplo del primer
 * día y falla con:
 *
 * ```java
 * // public class Wrong {}
 * package app;
 * public class Main {
 *   static class Helper {}                 // anidada: no es un punto de entrada
 *   public static void main(String[] a) {
 *     System.out.println("public class X"); // una cadena, no una declaración
 *   }
 * }
 * ```
 *
 * Lo que sí hace falta es poco: saltarse comentarios y literales, contar llaves
 * para saber qué es de PRIMER NIVEL, y reconocer `static … void main(String[])`.
 * Eso es un escáner léxico de doscientas líneas, no un analizador de Java, y es
 * lo que hay aquí. No construye un árbol, no resuelve tipos y no pretende
 * hacerlo: si el fuente no compila, el compilador lo dirá mejor que esto.
 *
 * ## Por qué vive en TypeScript y no en el harness
 *
 * Porque así se puede probar en Node, sin navegador y sin CheerpJ. El harness
 * recibe el nombre ya resuelto y se limita a cargarlo.
 */

export interface JavaTypeDeclaration {
  name: string;
  isPublic: boolean;
  /** Declara `public static void main(String[])` como miembro directo. */
  hasMain: boolean;
}

export interface JavaSourceOutline {
  packageName: string;
  /** Sólo los tipos de PRIMER NIVEL, en el orden en que aparecen. */
  types: JavaTypeDeclaration[];
}

export type JavaEntrypoint =
  | { ok: true; className: string; packageName: string }
  | { ok: false; reason: string };

/**
 * El fuente sin comentarios ni literales, conservando las posiciones.
 *
 * Se sustituye cada carácter eliminado por un espacio en vez de borrarlo: así
 * los índices siguen valiendo y, sobre todo, `"class A {"` deja de aportar una
 * llave que descuadraría el recuento de niveles.
 */
export function stripJavaComments(source: string): string {
  const out: string[] = [];
  let index = 0;

  const blank = (count: number): void => {
    for (let n = 0; n < count; n += 1) out.push(' ');
  };

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let n = index; n < stop; n += 1) out.push(source[n] === '\n' ? '\n' : ' ');
      index = stop;
      continue;
    }

    if (char === '/' && next === '/') {
      let stop = source.indexOf('\n', index);
      if (stop === -1) stop = source.length;
      blank(stop - index);
      index = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      out.push(' ');
      index += 1;
      while (index < source.length) {
        const inner = source[index] as string;
        if (inner === '\\') {
          // Una barra invertida se come el siguiente carácter: sin esto, `"\""`
          // cerraría la cadena donde no toca y el resto del archivo se leería
          // como si estuviera dentro de un literal.
          blank(Math.min(2, source.length - index));
          index += 2;
          continue;
        }
        if (inner === char) {
          out.push(' ');
          index += 1;
          break;
        }
        out.push(inner === '\n' ? '\n' : ' ');
        index += 1;
      }
      continue;
    }

    out.push(char);
    index += 1;
  }

  return out.join('');
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Los identificadores y los signos que importan, con su posición. */
interface Token {
  text: string;
  start: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      IDENTIFIER.lastIndex = index;
      const match = IDENTIFIER.exec(source);
      if (match && match.index === index) {
        tokens.push({ text: match[0], start: index });
        index += match[0].length;
        continue;
      }
    }

    if (/[0-9]/.test(char)) {
      // Los números no participan en ninguna de las formas que se buscan, pero
      // hay que consumirlos enteros para no partir `1_000` en trozos raros.
      let stop = index;
      while (stop < source.length && /[0-9A-Za-z_.]/.test(source[stop] as string)) stop += 1;
      index = stop;
      continue;
    }

    tokens.push({ text: char, start: index });
    index += 1;
  }

  return tokens;
}

const TYPE_KEYWORDS = new Set(['class', 'interface', 'enum']);

/**
 * Los tipos de primer nivel del archivo, con su paquete y quién tiene `main`.
 *
 * El recuento de llaves es lo único que distingue una clase anidada de una de
 * primer nivel, y es también lo que permite mirar los miembros DIRECTOS de cada
 * tipo sin confundirlos con los de una clase interna.
 */
export function outlineJavaSource(rawSource: string): JavaSourceOutline {
  const source = stripJavaComments(rawSource);
  const tokens = tokenize(source);

  let packageName = '';
  const types: JavaTypeDeclaration[] = [];

  let depth = 0;
  /** El tipo cuyo cuerpo se está recorriendo, si es de primer nivel. */
  let current: JavaTypeDeclaration | null = null;
  /** A qué profundidad empezó el cuerpo del tipo de primer nivel actual. */
  let currentBodyDepth = -1;
  /** Modificadores acumulados desde el último `;`, `{` o `}`. */
  let modifiers: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    const text = token.text;

    if (text === '{') {
      depth += 1;
      modifiers = [];
      continue;
    }
    if (text === '}') {
      depth -= 1;
      if (current && depth < currentBodyDepth) {
        current = null;
        currentBodyDepth = -1;
      }
      modifiers = [];
      continue;
    }
    if (text === ';') {
      modifiers = [];
      continue;
    }

    if (text === 'package' && depth === 0 && packageName === '') {
      const parts: string[] = [];
      let cursor = index + 1;
      while (cursor < tokens.length && (tokens[cursor] as Token).text !== ';') {
        const piece = (tokens[cursor] as Token).text;
        if (piece !== '.') parts.push(piece);
        cursor += 1;
      }
      packageName = parts.join('.');
      index = cursor;
      continue;
    }

    if (TYPE_KEYWORDS.has(text)) {
      const nameToken = tokens[index + 1];
      // `enum` y `record` también se usan como identificadores válidos en
      // contextos donde no declaran nada; sin un nombre detrás no hay tipo.
      if (!nameToken || !/^[A-Za-z_$]/.test(nameToken.text)) {
        modifiers = [];
        continue;
      }
      if (depth === 0) {
        const declared: JavaTypeDeclaration = {
          name: nameToken.text,
          isPublic: modifiers.includes('public'),
          hasMain: false,
        };
        types.push(declared);
        current = declared;
        currentBodyDepth = 1;
      }
      modifiers = [];
      index += 1;
      continue;
    }

    /**
     * `main` se reconoce como MIEMBRO DIRECTO del tipo de primer nivel.
     *
     * `depth === currentBodyDepth` es lo que descarta el `main` de una clase
     * anidada, que sería un punto de entrada distinto y no el del archivo.
     */
    if (
      text === 'main' &&
      current !== null &&
      depth === currentBodyDepth &&
      modifiers.includes('static') &&
      modifiers.includes('void') &&
      (tokens[index + 1] as Token | undefined)?.text === '('
    ) {
      if (acceptsStringArray(tokens, index + 1)) current.hasMain = true;
      modifiers = [];
      continue;
    }

    modifiers.push(text);
  }

  return { packageName, types };
}

/**
 * ¿La lista de parámetros que empieza en `open` es un único `String[]`?
 *
 * Acepta las tres formas que Java permite —`String[] args`, `String args[]` y
 * `String... args`— y rechaza cualquier otra firma: un `main(int)` no arranca
 * nada y confundirlo con el punto de entrada haría fallar la ejecución con un
 * `NoSuchMethodException` en vez de con «no encontré un main».
 */
function acceptsStringArray(tokens: Token[], open: number): boolean {
  let depth = 0;
  const inside: string[] = [];

  for (let index = open; index < tokens.length; index += 1) {
    const text = (tokens[index] as Token).text;
    if (text === '(') {
      depth += 1;
      continue;
    }
    if (text === ')') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    inside.push(text);
  }

  const names = inside.filter((piece) => /^[A-Za-z_$]/.test(piece));
  // `[` cubre `String[] args` y `String args[]`; `.` cubre el `String...` de los
  // varargs y también un `java.lang.String[]` escrito con el nombre completo.
  return names.includes('String') && (inside.includes('[') || inside.includes('.'));
}

/**
 * La clase que hay que ejecutar, a partir del proyecto y su archivo de entrada.
 *
 * El orden de preferencia no es arbitrario:
 *
 *  1. el tipo de primer nivel que declara `main`, porque eso es LITERALMENTE lo
 *     que se va a ejecutar;
 *  2. si ninguno lo declara, el tipo público —el que da nombre al archivo—,
 *     porque entonces el error que hay que enseñar es «esta clase no tiene
 *     main», y para eso hay que nombrarla;
 *  3. si tampoco hay público, el primer tipo declarado.
 *
 * Y si no hay ningún tipo, no se inventa uno: se dice que no se encontró.
 */
export function resolveJavaEntrypoint(project: CodeProject): JavaEntrypoint {
  const source = project.files[project.entryFile];
  if (source === undefined) {
    return { ok: false, reason: 'El archivo principal no existe en el proyecto.' };
  }
  if (!project.entryFile.endsWith('.java')) {
    return {
      ok: false,
      reason: 'El archivo principal de un proyecto de Java tiene que ser un archivo .java.',
    };
  }

  const outline = outlineJavaSource(source);

  if (isReservedJavaPackage(outline.packageName)) {
    return {
      ok: false,
      reason: `El paquete ${outline.packageName} está reservado para el runtime de Nextudio.`,
    };
  }

  const withMain = outline.types.filter((type) => type.hasMain);
  const chosen =
    withMain.find((type) => type.isPublic) ??
    withMain[0] ??
    outline.types.find((type) => type.isPublic) ??
    outline.types[0];

  if (!chosen) {
    return {
      ok: false,
      reason: `${project.entryFile} no declara ninguna clase.`,
    };
  }
  if (!chosen.hasMain) {
    return {
      ok: false,
      reason: `La clase ${chosen.name} no declara public static void main(String[] args).`,
    };
  }

  return {
    ok: true,
    packageName: outline.packageName,
    className: outline.packageName ? `${outline.packageName}.${chosen.name}` : chosen.name,
  };
}

/**
 * El paquete que declara cada archivo del proyecto, para vigilar el reservado.
 *
 * Se mira TODOS los archivos, no sólo el de entrada: una clase colada en
 * `io.nextudio.runtime.internal` no sería el punto de entrada y aun así
 * terminaría compilada junto a las demás.
 */
export function findReservedPackageViolation(project: CodeProject): string | null {
  for (const [path, source] of Object.entries(project.files)) {
    if (!path.endsWith('.java')) continue;
    const { packageName } = outlineJavaSource(source);
    if (isReservedJavaPackage(packageName)) return path;
  }
  return null;
}
