/// <reference lib="webworker" />

import { createREngine } from '@/lib/code-engines/r-engine';
import { WEBR_BASE_URL } from '@/lib/code-engines/runtime-assets';
import { serveCodeEngine } from '@/lib/code-engines/worker-bridge';

/**
 * El Worker que ejecuta R.
 *
 * Gemelo del de Python a propósito: mismo bucle, mismo protocolo, mismo trato.
 * La única diferencia real es que webR arranca a su vez otro Worker por dentro
 * (ver `code-engines/r-engine.ts`), y terminar éste se lleva a aquél por
 * delante. R y Python no tienen dos arquitecturas: tienen dos motores.
 */

serveCodeEngine(self as unknown as DedicatedWorkerGlobalScope, () =>
  createREngine({ baseUrl: new URL(WEBR_BASE_URL, self.location.origin).href })
);

export {};
