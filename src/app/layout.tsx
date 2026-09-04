import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth/auth-provider';
import { DemoBanner } from '@/components/app-shell/demo-banner';
import { Footer } from '@/components/app-shell/footer';
import { Navbar } from '@/components/app-shell/navbar';
import { ThemeScript } from '@/components/theme/theme-script';
import { SITE } from '@/lib/constants';
import { SITE_URL } from '@/lib/urls';

/**
 * Dos familias, ninguna más.
 *  · Fraunces (serif variable) para títulos: voz editorial, académica, con
 *    carácter propio; evita el look de plantilla.
 *  · Inter para interfaz y cuerpo: alta legibilidad a tamaños pequeños.
 * El mono es el del sistema: se usa sólo en metadatos y URLs, y no justifica
 * otros 40 KB de descarga.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.name} · ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: 'es_MX',
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f1ea' },
    { media: '(prefers-color-scheme: dark)', color: '#121316' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <AuthProvider>
          <DemoBanner />
          <Navbar />
          <main id="contenido" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
