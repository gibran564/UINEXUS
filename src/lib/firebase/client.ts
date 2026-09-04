'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  appCheckDebugToken,
  appCheckSiteKey,
  EMULATOR_HOST,
  EMULATOR_PORTS,
  firebaseConfig,
  isFirebaseConfigured,
  useEmulators,
} from './config';

/**
 * SDK de cliente. Una sola inicialización, perezosa, para que el modo demo no
 * arrastre el bundle de Firebase ni falle al no haber credenciales.
 *
 * Cada servicio se conecta al emulador como mucho una vez: el SDK lanza si se
 * reconfigura un servicio ya usado, y estas funciones se llaman desde muchos
 * puntos de la aplicación.
 */

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let appCheckStarted = false;

function getClientApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (!app) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    startAppCheck(app);
  }
  return app;
}

/**
 * App Check verifica que las peticiones vienen de esta aplicación y no de un
 * script. Es opcional y aditivo: sin clave de sitio no se activa nada. Nunca
 * sustituye a las reglas de seguridad, que siguen siendo la autoridad.
 */
function startAppCheck(instance: FirebaseApp): void {
  if (appCheckStarted || !appCheckSiteKey || typeof window === 'undefined') return;
  appCheckStarted = true;

  void (async () => {
    try {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
        'firebase/app-check'
      );
      if (appCheckDebugToken) {
        (window as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).
          FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
      }
      initializeAppCheck(instance, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      // Un fallo de App Check no debe dejar sin servicio a los alumnos: las
      // reglas siguen protegiendo los datos.
      console.warn('[uinexus] App Check no pudo inicializarse.', error);
    }
  })();
}

export function getClientAuth(): Auth | null {
  const instance = getClientApp();
  if (!instance) return null;
  if (!authInstance) {
    authInstance = getAuth(instance);
    if (useEmulators) {
      connectAuthEmulator(authInstance, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
        disableWarnings: true,
      });
    }
  }
  return authInstance;
}




export { isFirebaseConfigured, useEmulators };
