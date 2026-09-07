import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth/auth-provider';
import { DemoBanner } from '@/components/app-shell/demo-banner';
import { Footer } from '@/components/app-shell/footer';
import { Navbar } from '@/components/app-shell/navbar';
import { AppFrame } from '@/components/app-shell/app-frame';
import { ThemeScript } from '@/components/theme/theme-script';
import { SessionScript } from '@/components/home/session-hint';
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

/**
 * `modal` es la ranura donde aterriza `/muro/[id]` cuando se abre desde el muro:
 * la ruta se intercepta y se presenta como diálogo sobre lo que ya había, sin
 * perder la lista ni el desplazamiento. Con el enlace abierto en frío la ranura
 * está vacía y manda la pantalla completa.
 */
export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        <ThemeScript />
        <SessionScript />
      </head>
      <body>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <AuthProvider>
          <AppFrame banner={<DemoBanner />} navigation={<Navbar />} footer={<Footer />}>
            {children}
            {modal}
          </AppFrame>
        </AuthProvider>
      </body>
    </html>
  );
}
