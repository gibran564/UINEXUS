# Checkpoint

- [x] F0.1 · Redirect post-login → `/` — ÉXITO
- [x] F0.2 · Miniaturas compactas — ÉXITO
- [x] F0.3 · Overflow móvil de pestañas — ÉXITO
- [x] F1.1 · Separar layout — ÉXITO
- [x] F1.2 · Separar feed — ÉXITO
- [x] F1.3 · Separar tarjeta — ÉXITO
- [x] F1.4 · Separar atención/filtros — ÉXITO
- [x] F1.5 · Validar refactor sin regresiones — ÉXITO
- [x] F2.1 · FeedCard compacta definitiva — ÉXITO
- [x] F2.2 · Metadata y jerarquía — ÉXITO
- [x] F2.3 · Acciones/navegación coherentes — ÉXITO
- [x] F3.1 · Layout desktop — ÉXITO
- [x] F3.2 · Carril de contexto — ÉXITO
- [x] F3.3 · Tablet — ÉXITO
- [x] F3.4 · Móvil — ÉXITO
- [x] F3.5 · Carril derecho sólo si se justifica — ÉXITO
- [x] F4.1 · Unificar feed — ÉXITO
- [x] F4.2 · Filtros por materia — ÉXITO
- [x] F4.3 · Estado de filtros en URL — ÉXITO
- [x] F4.4 · Separador última visita — ÉXITO
- [x] F4.5 · Final/cargar más — ÉXITO
- [x] F5.1 · URL de publicación — ÉXITO
- [x] F5.2 · Navegación/modal — ÉXITO
- [x] F5.3 · Autorización y privacidad — ÉXITO
- [x] F5.4 · Deep links — ÉXITO
- [x] F6.1 · Loading — ÉXITO
- [x] F6.2 · Empty — ÉXITO
- [x] F6.3 · Error — ÉXITO
- [ ] F6.4 · Responsive QA — NO COMPLETADA
- [ ] F6.5 · Tema claro/oscuro — NO COMPLETADA
- [x] F6.6 · Tests finales — ÉXITO
- [x] F6.7 · Build final — ÉXITO

## Iteración — Identidad, materiales y proceso de materia (2026-09-09)

- [x] P0.1 · Sesión restaurada valida el correo institucional antes del perfil — ÉXITO
- [x] P0.2 · `requireIdentity` aplica la política en TODAS las rutas — ÉXITO
- [x] P0.3 · Aviso de cuenta no autorizada en `/login`, sin bucle — ÉXITO
- [x] P0.4 · Acceso por teléfono retirado — ÉXITO
- [x] P0.5 · `AssignmentMaterial`: modelo, ruta propia y prefijo propio en S3 — ÉXITO
- [x] P0.6 · Subida en dos tiempos (firmar → subir → registrar) — ÉXITO
- [x] P0.7 · Materiales visibles y descargables por el alumnado — ÉXITO
- [x] P0.8 · Entrega de documento con arrastre, aviso previo y archivo visible — ÉXITO
- [x] P1.1 · Cinco plantillas de Investigación de Operaciones — ÉXITO
- [x] P1.2 · Galería de plantillas en el constructor, con vista previa — ÉXITO
- [x] P1.3 · Estado vacío del profesorado sin grupos propios — ÉXITO
- [x] P2.1 · Entregable de código con lenguaje (R habilitado) — ÉXITO
- [x] P2.2 · Revisión del código sin descargar — ÉXITO
- [x] P2.3 · Interfaz de ejecutor externo documentada — ÉXITO (sin conectar, a propósito)
- [x] V.1 · typecheck · lint · 467 unitarias · 92 de integración · build — ÉXITO
- [ ] V.2 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — Monaco Editor + ejecución de R y Python (2026-09-10)

- [x] E1 · `CodeEditor` único por lenguaje, con respaldo accesible a textarea — ÉXITO
- [x] E2 · Monaco desde el paquete instalado, sin CDN — ÉXITO
- [x] E3 · `browser-code-runner`: reloj, terminación y estados — ÉXITO
- [x] E4 · Python con Pyodide en Web Worker — ÉXITO (probado ejecutando de verdad)
- [x] E5 · R con webR en Web Worker — ÉXITO (verificado en navegador)
- [x] E6 · Tiempo límite, Detener y reejecución tras un corte — ÉXITO
- [x] E7 · Autoguardado por paso, y guardado antes de ejecutar/entregar — ÉXITO
- [x] E8 · Modalidades editor / upload / either, legacy intacto — ÉXITO
- [x] E9 · Código inicial de la docente y «Restablecer» — ÉXITO
- [x] E10 · Configuración del paso de código en el constructor — ÉXITO
- [x] E11 · Vista docente readOnly y ejecutable, sin mutar la entrega — ÉXITO
- [x] E12 · Red y paquetes bloqueados en los dos runtimes — ÉXITO
- [x] E13 · Publicación de runtimes y Workers fuera de git — ÉXITO
- [x] E14 · 83 pruebas nuevas (79 unitarias + 4 de integración) — ÉXITO
- [x] V.1 · typecheck · lint · 550 unitarias · 98 de integración · build — ÉXITO
- [ ] V.2 · CSP de la plataforma — NO COMPLETADA (auditada: la ejecución no exige
      relajar nada; escribirla entera excede este sprint. Ver docs/SECURITY.md)
- [ ] V.3 · Ejecución real de R en la suite — NO COMPLETADA (webR no arranca bajo
      Node en Windows; necesita Playwright. Ver docs/LIMITATIONS.md)
- [ ] V.4 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita
      Firebase y AWS)

## Iteración — Reposicionamiento y workspace académico (2026-09-10)

- [x] R1 · `LanguageCapabilities`: editar y ejecutar dejan de ser un booleano — ÉXITO
- [x] R2 · Java, C, C++, HTML y CSS editables con resaltado propio — ÉXITO
- [x] R3 · «Ejecución no disponible» con motivo y sin botón fantasma — ÉXITO
- [x] R4 · `LEGACY_CODE_LANGUAGE`: el default nuevo no reinterpreta lo guardado — ÉXITO
- [x] R5 · Landing reposicionado, tabla de lenguajes generada del catálogo — ÉXITO
- [x] R6 · README, `SITE`, `/about` y navegación — ÉXITO
- [x] R7 · Modelo `Workspace` con `files` opcional — ÉXITO
- [x] R8 · Tabla `uinexus-workspaces`, índice `byOwner`, CFN y script — ÉXITO
- [x] R9 · API de prácticas, privacidad en tres capas — ÉXITO
- [x] R10 · `/practicas` y `/practicas/:id` con autoguardado — ÉXITO
- [x] R11 · 37 pruebas nuevas — ÉXITO
- [x] V.1 · typecheck · lint · 575 unitarias · 114 de integración · build — ÉXITO
- [ ] V.2 · `RemoteRunner` para Java, C y frameworks — NO COMPLETADA (contrato listo,
      proveedor sin decidir. Ver docs/ARCHITECTURE.md §14)
- [ ] V.3 · Multi-archivo en el editor — NO COMPLETADA (modelo listo, UI no)
- [ ] V.4 · CSP de la plataforma — NO COMPLETADA (sin cambios respecto a la anterior)
- [ ] V.5 · Recorridos manuales con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — NexBook y UINexus Studio (2026-09-10)

- [x] N1 · Modelo `NexBook`: bloques, outputs, contexto, visibilidad, revisión — ÉXITO
- [x] N2 · Límites en `NEXBOOK_LIMITS`, presupuesto medido sobre el JSON real — ÉXITO
- [x] N3 · CRUD con ownership en tres capas y 404 indistinguible — ÉXITO
- [x] N4 · Concurrencia optimista con 409 que devuelve el documento actual — ÉXITO
- [x] N5 · UINexus Studio: bloques, orden, añadir/eliminar, foco tras insertar — ÉXITO
- [x] N6 · MarkdownBlock con el renderer sanitizado existente — ÉXITO
- [x] N7 · CodeBlock sobre Monaco, lenguaje por bloque — ÉXITO
- [x] N8 · `NotebookKernel`: sesión, restart, interrupt, estado por lenguaje — ÉXITO
- [x] N9 · Python conserva estado entre celdas — ÉXITO (verificado en navegador)
- [x] N10 · R con sesión y aislamiento simétrico — ÉXITO
- [x] N11 · Autoguardado con estados que nunca ocultan un error — ÉXITO
- [x] N12 · Laboratorios personales en `/practicas`, lista unificada — ÉXITO
- [x] N13 · Entregable `nexbook` en Workflow, `CodeData` intacto — ÉXITO
- [x] N14 · Plantilla docente e instancia perezosa por estudiante — ÉXITO
- [x] N15 · Snapshot de entrega y vista docente de sólo lectura — ÉXITO
- [x] N16 · 50 pruebas nuevas (32 unitarias + 18 de integración) — ÉXITO
- [x] N17 · `docs/NEXBOOK.md` — ÉXITO
- [x] V.1 · typecheck · lint · 616 unitarias · 132 de integración · build — ÉXITO
- [ ] V.2 · Import/export `.nexbook` — NO COMPLETADA (formato diseñado y versionado)
- [ ] V.3 · Publicación de NexBooks — NO COMPLETADA (sólo `private` implementado)
- [ ] V.4 · Outputs ricos y orden real de stdout/stderr — NO COMPLETADA
- [ ] V.5 · Historial de reentregas en la interfaz — NO COMPLETADA (esquema listo)
- [ ] V.6 · Project Workspace — NO COMPLETADA (previsto, no empezado)
- [ ] V.7 · `RemoteRunner` para Java y C — NO COMPLETADA (sin cambios)
- [ ] V.8 · CSP de la plataforma — NO COMPLETADA (sin cambios)
- [ ] V.9 · Recorridos con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)

## Iteración — NexBook modular (2026-09-10)

- [x] M1 · Salidas ricas: `text`, `table`, `image`, `json` como valores de `stream` — ÉXITO
- [x] M2 · Orden REAL de stdout y stderr, sin rediseñar runtimes — ÉXITO (navegador)
- [x] M3 · Limpiar salida por celda y global — ÉXITO
- [x] M4 · Python: tablas por pato, sin exigir pandas — ÉXITO
- [x] M5 · Python: `pandas` y `matplotlib` desde el propio origen — ÉXITO (navegador)
- [x] M6 · Ruedas verificadas contra el `sha256` del lockfile — ÉXITO
- [x] M7 · R: `plot()` capturado como PNG vía `OffscreenCanvas` — ÉXITO (navegador)
- [x] M8 · R: `data.frame` como tabla estructurada — ÉXITO (navegador)
- [x] M9 · Assets en S3, clave por persona, sin tabla nueva — ÉXITO
- [x] M10 · `ImageBlock` con alt, pie, arrastrar, pegar y reemplazar — ÉXITO
- [x] M11 · `SpreadsheetBlock` con motor de fórmulas propio — ÉXITO
- [x] M12 · `SpreadsheetBridge` desacoplado de los kernels — ÉXITO (sin conectar)
- [x] M13 · Publicar como SNAPSHOT, con actualización explícita — ÉXITO
- [x] M14 · Vista pública sin runtimes (167 kB frente a 232 kB) — ÉXITO
- [x] M15 · Exportar `.nexbook` con assets y referencias reescritas — ÉXITO
- [x] M16 · Importar `.nexbook` con defensas contra zip slip y bomb — ÉXITO
- [x] M17 · Lista BLANCA de exportación, con pruebas de secretos — ÉXITO
- [x] M18 · «Copiar a mis prácticas» separa evidencia de portafolio — ÉXITO
- [x] M19 · Barra de Studio: + Bloque, Ejecutar todo, Reiniciar kernels — ÉXITO
- [x] M20 · Aviso de tamaño al 80 % del presupuesto — ÉXITO
- [x] M21 · 112 pruebas nuevas (82 unitarias + 30 de integración) — ÉXITO
- [x] V.1 · typecheck · lint · 698 unitarias · 162 de integración · build — ÉXITO
- [ ] V.2 · `AIBlock` — NO COMPLETADA (diseñado y documentado, no declarado)
- [ ] V.3 · `ChartBlock` — NO COMPLETADA (una gráfica se guarda como imagen)
- [ ] V.4 · Puente hoja ↔ Python/R — NO COMPLETADA (abstracción lista, sin conectar)
- [ ] V.5 · Playwright — NO COMPLETADA (sin entorno de autenticación controlado)
- [ ] V.6 · Recolección de assets huérfanos — NO COMPLETADA
- [ ] V.7 · Historial de publicaciones — NO COMPLETADA (actualizar sobrescribe)
- [ ] V.8 · Import/export `.ipynb`, `.qmd`, PDF — NO COMPLETADA
- [ ] V.9 · Project Workspace — NO COMPLETADA (previsto, no empezado)
- [ ] V.10 · `RemoteRunner` para Java y C — NO COMPLETADA (sin cambios)
- [ ] V.11 · CSP de la plataforma — NO COMPLETADA (sin cambios)
- [ ] V.12 · Recorridos con cuentas reales — NO COMPLETADA (necesita Firebase y AWS)
