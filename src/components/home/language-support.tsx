import { PROGRAMMING_LANGUAGES } from '@/lib/constants';

/**
 * Qué lenguajes admite Nextudio, y para qué.
 *
 * Esta tabla se GENERA desde `PROGRAMMING_LANGUAGES`. No es una decisión
 * estética: una lista escrita a mano en la portada es una promesa que envejece
 * sola, y el día que alguien apague la ejecución de R el landing seguiría
 * anunciándola. Aquí no puede pasar —si el catálogo cambia, la portada cambia—.
 *
 * Por eso también hay tres estados y no dos. «Ejecutable» y «no ejecutable»
 * habría obligado a meter Java, HTML y SQL en el mismo cajón, y no son lo
 * mismo: Java espera un compilador, HTML se ve al publicarlo, y SQL no tiene
 * dónde ejecutarse porque no hay base de datos que consultar.
 */

type SupportLevel = 'run' | 'publish' | 'edit';

const LEVEL_LABEL: Record<SupportLevel, string> = {
  run: 'Ejecutable aquí',
  publish: 'Se publica',
  edit: 'Sólo edición',
};

const LEVEL_TONE: Record<SupportLevel, string> = {
  run: 'text-success',
  publish: 'text-accent',
  edit: 'text-subtle',
};

function levelFor(capabilities: (typeof PROGRAMMING_LANGUAGES)[number]['capabilities']): SupportLevel {
  if (capabilities.browserExecution) return 'run';
  if (capabilities.projects) return 'publish';
  return 'edit';
}

export function LanguageSupport() {
  return (
    <section aria-labelledby="lenguajes" className="container-page pt-16">
      <h2 id="lenguajes" className="section-mark font-display text-h2">
        Lenguajes
      </h2>
      <p className="mt-1 max-w-2xl text-muted">
        Todos se escriben en el mismo editor, en NexCode o dentro de un NexLab. Lo que cambia es
        dónde puede correr cada uno, y Nextudio lo dice antes de que empieces.
      </p>

      <ul className="mt-7 divide-y divide-line border-y border-line">
        {PROGRAMMING_LANGUAGES.map((language) => {
          const level = levelFor(language.capabilities);

          return (
            <li
              key={language.value}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5"
            >
              <span className="w-28 shrink-0 font-display text-h3">{language.label}</span>
              <span className="font-mono text-label text-subtle">.{language.extension}</span>
              <span className="min-w-0 flex-1 text-sm text-muted">
                {language.executionNote ?? 'Se ejecuta dentro de tu navegador, sin instalar nada.'}
              </span>
              <span className={`text-label ${LEVEL_TONE[level]}`}>{LEVEL_LABEL[level]}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 max-w-2xl text-sm text-subtle">
        Python y R se ejecutan en tu propio navegador: tu código no se envía a ningún servidor.
        Java y C se escriben y se entregan; compilarlos necesita infraestructura que Nextudio
        todavía no tiene, y preferimos decirlo a fingirlo.
      </p>
    </section>
  );
}
