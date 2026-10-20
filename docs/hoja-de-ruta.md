# Aeonarch — Hoja de ruta

Orden de construcción de lo que pide [diseno.md](diseno.md). Cada fase se divide en pasos que se pueden probar y desplegar por separado. Al terminar un paso: tests, typecheck, build, `pnpm e2e` si cambia la interfaz, commit, despliegue y marcarlo aquí.

## Hecho

- **Fases 1–3**: diseño, arquitectura y prototipo local (universo procedural y mapa 3D).
- **Fase 4**: servidor autoritativo, cuentas por enlace de correo, Emperador persistente y mundo compartido por WebSocket.

## Peticiones del usuario (20-10-2026) que guían el orden

- El Emperador **va en su nave**: viaja con ella, y con ella se pilota.
- **Humanos como recurso**: una flota conquistadora tiene que **transportar humanos**; cuántos lleve decide lo que puede colonizar o conquistar.
- **Guerra espacial** contra la IA y contra otros jugadores.
- **Conquistar planetas** (sin entrar en ellos por ahora): **renombrarlos** y **obtener sus recursos y los de su estrella**.
- **Navegar como en No Man's Sky**: no solo desde el mapa, sino pilotando por la galaxia, sin pantallas intermedias entre el espacio y los sistemas.
- **Más masividad** y pensar bien la **escala** (distancias y tiempos).
- **Escala decidida**: saltar entre estrellas cercanas lleva **minutos**; dentro del sistema se vuela en tiempo real.
- **Ajustes con teclas configurables** y cámara en **primera y tercera persona** (sin entrar en la nave a pie).
- **Tiempo real**: el juego corre a la hora real; los saltos entre estrellas son hiperespaciales (más rápidos que la luz).
- **Ajustes** con idioma, calidad de imagen, tamaño de la interfaz y música; la ayuda de controles va en el menú, no en pantalla. La interfaz se adapta a la **resolución** de la ventana.
- **Privacidad**: nadie necesita saber dónde estás. Cada jugador elige quién ve su posición (todos, solo compañeros, nadie); por defecto, solo compañeros. Hecho: compañeros por nombre (mutuos) y filtrado en el servidor.
- **Música**: solo generada por código (se compone en el navegador), sin archivos ni derechos de autor.
- **Combate**: disparar a otras naves, con **escudos, misiles y cañones según la clase de nave**; la nave del Emperador es una nave más de su flota.

## Fase 5 — Flotas y exploración

- **5a. Tiempo de juego, cola de eventos y flotas.** ✔ Escala de tiempo única (`TIME_SCALE`): 1 = ritmo del diseño (horas); más alta en el servidor de pruebas. Cola `scheduled_events` con trabajador (`FOR UPDATE SKIP LOCKED`, un evento que falla se aplaza). Flotas y naves; cada Emperador empieza con un explorador. Orden `fleet.move`; la llegada es un evento programado. Tema privado `me` en el WebSocket.
- **5b. Niebla de guerra.** El detalle de los sistemas (planetas, recursos, anomalías) se genera con una semilla secreta que solo tiene el servidor; las posiciones y clases de estrella siguen siendo públicas. Tabla `discoveries`: al llegar a un sistema, la flota descubre lo que cubre su escáner. El cliente pide el detalle al servidor y solo lo recibe si lo ha descubierto.

## Fase 6 — Pilotar la nave del Emperador (estilo No Man's Sky)

- **6a. Pilotar la nave.** ✔ Modelo 3D de la nave insignia. Se empieza a los mandos, dentro del sistema; vuelo en tiempo real entre planetas (que giran según la hora del servidor), cámara en primera y tercera persona, salir volando del sistema lleva al espacio interestelar y J salta a la estrella elegida (la cámara sigue a la nave y al llegar se entra pilotando). Ajustes con teclas configurables.
- **6b. Vuelo compartido.** El servidor recibe y valida la posición de la nave dentro del sistema (velocidad máxima, borde) y los demás jugadores del mismo sistema la ven moverse. Las flotas pueden escoltar a la nave del Emperador.
- **6c. Combate en tiempo real.** Armas y defensas como datos por clase de nave (cañones, misiles, escudos, casco). Disparos validados en el servidor (alcance, cadencia, munición), daño a escudos y casco, naves destruidas. La nave del Emperador pasa a ser una nave de su flota (las flotas que la escoltan combaten con ella).

## Fase 7 — Humanos, planetas y economía

- **7a. Humanos.** Población como recurso: vive en colonias y crece; las naves la transportan (colonos y tropas) según su capacidad.
- **7b. Reclamar y conquistar planetas.** Planeta libre: se reclama desembarcando humanos (el colonizador se consume). Se puede **renombrar**. El dueño extrae los **recursos del planeta** y la **energía de su estrella**.
- **7c. Economía.** Inventarios locales con resolución perezosa (`valor + tasa × Δt`, topes) y libro de recursos solo inserción. Instalaciones (minas, refinería de aleaciones, central de energía, astillero), construcción de naves e instalaciones, mantenimiento.

## Fase 8 — Logística

- Cargueros que transportan recursos y humanos entre colonias por rutas reales (interceptables). Red de suministro.

## Fase 9 — Guerra

- **9a. Combate de flotas** resuelto en el servidor por rondas y mostrado en 3D; interceptar flotas en tránsito.
- **9b. Conquista de planetas ajenos.** Asedio con progreso y presencia sostenida; desembarco de tropas (humanos) para tomar el planeta o la instalación; captura en vez de destrucción.
- **9c. Combate a gran escala**: por encima de ~5 naves por bando, el combate en tiempo real (6c) pasa a rondas.

## Fase 10 — Muerte y linaje

- La nave del Emperador puede caer. Cunas de linaje con gestación que crece con las muertes seguidas. Sin Cunas, reaparece en el Núcleo Humano. Herederos que gobiernan colonias y en los que el jugador puede encarnarse.

## Fase 11 — Masividad e inteligencia artificial

- Proceso `apps/ai` con la misma tubería de órdenes que los jugadores.
- Facciones alienígenas del MVP (Hordas y Máquinas) que ocupan sistemas y atacan.
- Emperadores IA humanos para que el universo se sienta vivo; gobernadores de jugadores ausentes.
- Zonas de interés por sector en el WebSocket (cada jugador recibe solo lo cercano) para aguantar cientos de jugadores.

## Fase 12 — Organizaciones y comunidad

- Organizaciones y miembros. Descubrimientos compartidos y publicables.
- Traducción comunitaria: personal > organización > pública (votación y moderación) > base.

## Antes de abrir al público (obligatorio, en paralelo)

Lista de `docs/despliegue.md`: estáticos desde Cloudflare, 80/443 solo desde Cloudflare, límites por IP y cuenta, vigilante de tráfico saliente con corte automático. Además: dominio propio, HTTPS, correo real (SMTP con SPF/DKIM/DMARC) y `APP_ENV=production`.
