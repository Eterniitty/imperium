# Aeonarch — Hoja de ruta

Orden de construcción de lo que pide [diseno.md](diseno.md). Cada fase se divide en pasos que se pueden probar y desplegar por separado. Al terminar un paso: tests, typecheck, build, `pnpm e2e` si cambia la interfaz, commit, despliegue y marcarlo aquí.

## Hecho

- **Fases 1–3**: diseño, arquitectura y prototipo local (universo procedural y mapa 3D).
- **Fase 4**: servidor autoritativo, cuentas por enlace de correo, Emperador persistente y mundo compartido por WebSocket.

## Fase 5 — Flotas y exploración

- **5a. Tiempo de juego, cola de eventos y flotas.** Una sola escala de tiempo (`TIME_SCALE`) para viajes, construcción y producción: 1 en producción (ritmo en horas, como pide el diseño), más alta en pruebas. Tabla `scheduled_events` con trabajador (`FOR UPDATE SKIP LOCKED`). Flotas y naves (`fleets`, `ships`); cada Emperador empieza con un explorador. Orden `fleet.move`; la llegada es un evento programado.
- **5b. Niebla de guerra.** El detalle de los sistemas (planetas, recursos, anomalías) se genera con una semilla secreta que solo tiene el servidor; las posiciones y clases de estrella siguen siendo públicas. Tabla `discoveries`: al llegar a un sistema, la flota descubre lo que cubre su escáner. El cliente pide el detalle al servidor y solo lo recibe si lo ha descubierto.

## Fase 6 — Colonias y economía

- **6a. Colonias e inventarios.** Colonia inicial en el Núcleo Humano. Inventarios locales con resolución perezosa (`valor + tasa × Δt`, topes) y libro de recursos solo inserción (`resource_ledger`). Energía local, no transportable.
- **6b. Instalaciones y construcción.** Minas, refinería de aleaciones, central de energía y astillero. Construcción de instalaciones y naves con coste y tiempo (eventos programados). Mantenimiento continuo de naves e instalaciones.
- **6c. Colonización.** El colonizador se consume al fundar una colonia en un planeta apto.

## Fase 7 — Logística

- Cargueros: cargar y descargar en colonias, rutas entre colonias. Red de suministro: qué instalaciones están conectadas.

## Fase 8 — Combate y conquista

- **8a. Combate de flotas por rondas** resuelto en el servidor y mostrado en 3D a los participantes. Ataque a flotas en tránsito (rutas interceptables).
- **8b. Conquista por instalación.** Asedios con progreso y presencia sostenida; captura en vez de destrucción; las instalaciones aisladas de su red de suministro se debilitan.

## Fase 9 — Muerte y linaje

- La nave del Emperador puede caer. Cunas de linaje (instalación) con gestación que crece con las muertes seguidas y se relaja con el tiempo. Sin Cunas, reaparece en el Núcleo Humano.
- Herederos: se gestan en las Cunas (tiempo y recursos), gobiernan colonias con la doctrina elegida y el jugador puede encarnarse en ellos.

## Fase 10 — Inteligencia artificial

- Proceso `apps/ai` que usa la misma tubería de órdenes que los jugadores.
- Facciones alienígenas del MVP (Hordas y Máquinas) según su ficha en `packages/content`.
- Emperadores IA humanos y gobernadores de jugadores ausentes.

## Fase 11 — Organizaciones y comunidad

- Organizaciones y miembros. Descubrimientos compartidos con la organización y publicables para todos.
- Traducción comunitaria: personal > organización > pública (votación y moderación) > base.

## Fase 12 — Combate en tiempo real

- Nave del Emperador pilotada con escolta de hasta ~5 naves por bando (simulación N0 a 10–20 Hz). Por encima de ese tamaño, el combate pasa a rondas (Fase 8).

## Antes de abrir al público (obligatorio, en paralelo)

Lista de `docs/despliegue.md`: estáticos desde Cloudflare, 80/443 solo desde Cloudflare, límites por IP y cuenta, vigilante de tráfico saliente con corte automático. Además: dominio propio, HTTPS, correo real (SMTP con SPF/DKIM/DMARC) y `APP_ENV=production`.
