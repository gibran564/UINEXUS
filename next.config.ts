import type { NextConfig } from 'next';

/**
 * Cabeceras de seguridad de la plataforma.
 * OJO: el contenido subido por alumnos NO se sirve desde este origen.
 * Ver functions/src/index.ts (origen aislado) y docs/SECURITY.md.
 *
 * ## Sobre la CSP de la plataforma (auditado en el sprint de ejecución R/Python)
 *
 * Este origen NO envía `Content-Security-Policy`, y este sprint no la ha
 * introducido. La conclusión de la auditoría, entera, está en docs/SECURITY.md;
 * lo que importa aquí es lo que se comprobó:
 *
 *  · Monaco se carga desde el paquete instalado, no desde jsdelivr, así que no
 *    hay ningún `script-src` de terceros que autorizar.
 *  · Pyodide y webR se sirven desde `/runtime/`, en este mismo origen, así que
 *    tampoco hay `connect-src` de terceros que abrir.
 *  · Los Workers salen de `new URL(..., import.meta.url)`: son del propio
 *    origen.
 *
 * Es decir: ejecutar R y Python NO exige relajar nada. El día que se active una
 * CSP aquí, las directivas que este código necesita están listadas en
 * docs/SECURITY.md; la única no obvia es `'wasm-unsafe-eval'` en `script-src`,
 * sin la cual no arranca ningún WebAssembly.
 *
 * Escribir esa CSP entera —cubriendo Firebase Auth, S3 y las imágenes— es un
 * cambio con su propio riesgo y su propia validación, y no es este sprint.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  /**
   * Dónde compila Next, configurable SÓLO por entorno.
   *
   * `next dev`, `next build` y `next start` comparten `.next` y se pisan: un
   * build lanzado con el servidor de desarrollo vivo puede reventar a mitad, y
   * diagnosticarlo cuesta porque el error habla de un chunk y no de la causa.
   * Costó un build fallido en la Fase 4.
   *
   * El sandbox de producción local (`npm run prod:local`) compila en su propio
   * directorio y deja `.next` para el desarrollo. La variable NO se define en
   * producción, así que allí sigue siendo `.next` exactamente como antes: esto
   * separa entornos locales, no diverge del despliegue.
   */
  distDir: process.env.UINEXUS_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        /**
         * Los runtimes de Python y R.
         *
         * `same-origin` impide que otro sitio se los lleve como recurso: son
         * 60 MB de WebAssembly servidos desde la infraestructura de Nextudio y
         * no hay ninguna razón para que los cargue nadie más.
         *
         * A propósito SIN `Cache-Control` propio. Las rutas no llevan hash de
         * versión, así que un `immutable` largo dejaría a alguien con un
         * `pyodide.asm.wasm` nuevo y un `python_stdlib.zip` viejo tras una
         * actualización. La revalidación por ETag que hace Next devuelve 304 y
         * evita la descarga sin ese riesgo.
         */
        source: '/runtime/:path*',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }],
      },
    ];
  },
};

export default nextConfig;
