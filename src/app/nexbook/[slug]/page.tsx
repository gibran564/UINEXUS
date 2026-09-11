import type { Metadata } from 'next';
import { PublishedNexBook } from '@/components/studio/published-nexbook';

export const metadata: Metadata = {
  /**
   * No se indexa, y conviene decir por qué.
   *
   * Una publicación con visibilidad `link` o `class` no debe acabar en un
   * buscador, y esta misma ruta sirve las tres visibilidades. Distinguirlas aquí
   * exigiría leer la publicación en el servidor para generar los metadatos, y
   * ese es justo el trabajo que la página evita hacer dos veces. Cuando exista
   * una galería de publicaciones públicas será ella quien se indexe.
   */
  robots: { index: false, follow: false },
  title: 'NexBook publicado',
};

/**
 * Un NexBook publicado, en lectura.
 *
 * La página no carga ningún runtime: ver `NexBookReader`. Abrir un enlace no
 * puede costar sesenta megas de WebAssembly.
 */
export default async function PublishedNexBookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PublishedNexBook slug={slug} />
    </div>
  );
}
