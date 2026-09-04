/**
 * Aplica el tema antes de la primera pintura.
 *
 * Sin esto, alguien con el sistema en oscuro vería un destello blanco en cada
 * navegación. El script es diminuto y se ejecuta síncrono en <head>.
 */
const script = `(function(){
  try {
    var stored = localStorage.getItem('uinexus-theme');
    var preference = stored === 'light' || stored === 'dark' ? stored : null;
    var system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = preference || system;
    document.documentElement.dataset.themePreference = stored || 'system';
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
