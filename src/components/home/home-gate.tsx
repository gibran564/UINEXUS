'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { rememberSession } from './session-hint';
import { AcademicHome } from './academic-home';

/**
 * Quién ve la portada y quién ve su Inicio.
 *
 * Tres estados y ninguna pantalla intermedia:
 *
 *  · **autenticado** → su Inicio. No hay que pulsar «Aula» para entrar.
 *  · **anónimo** → la portada pública, tal cual, servida desde el servidor.
 *  · **resolviendo** → la portada, salvo que este navegador recuerde una sesión
 *    iniciada; en ese caso `SessionScript` ya la ocultó antes de la primera
 *    pintura y aquí sólo se ve un marcador de carga.
 *
 * ## El destello, y por qué se resuelve con CSS
 *
 * El servidor no sabe quién pide (la sesión es un token en memoria), así que
 * renderiza la portada siempre. Si el reparto se hiciera sólo en React, alguien
 * con sesión vería el escaparate durante el instante que tarda Firebase en
 * responder. La pista de sesión —una marca en `localStorage` que se escribe al
 * entrar y se borra al salir— permite ocultarla ANTES de pintar, con la misma
 * técnica que ya usa el tema para no dar un fogonazo blanco.
 *
 * La pista dice «la última vez había sesión», no «hay sesión»: no concede nada
 * y no se usa para autorizar. Quien la falsee sólo consigue ver un marcador de
 * carga y, un instante después, la portada.
 */
/**
 * Qué se enseña para cada estado de la sesión.
 *
 * Se separa del componente porque es LA decisión de esta pantalla y se puede
 * comprobar sin montar React: visitante ve la portada, quien tiene sesión ve su
 * Inicio, y mientras se resuelve no se promete ninguna de las dos.
 */
export type HomeView = 'home' | 'landing' | 'pending';

export function homeViewFor(status: 'loading' | 'anonymous' | 'authenticated'): HomeView {
  if (status === 'authenticated') return 'home';
  if (status === 'anonymous') return 'landing';
  return 'pending';
}

export function HomeGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const view = homeViewFor(status);

  // La pista se sincroniza con la sesión real en cuanto se conoce, así que un
  // cierre de sesión en otra pestaña deja de ocultar la portada aquí.
  useEffect(() => {
    if (status === 'loading') return;
    rememberSession(status === 'authenticated');
  }, [status]);

  if (view === 'home') return <AcademicHome />;

  if (view === 'pending') {
    return (
      <>
        <div data-home-gate="landing">{children}</div>
        <p
          data-home-gate="pending"
          className="container-page py-24 text-center text-muted"
          aria-live="polite"
        >
          Abriendo tu inicio…
        </p>
      </>
    );
  }

  return <>{children}</>;
}
