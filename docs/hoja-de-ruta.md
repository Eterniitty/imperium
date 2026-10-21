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
- **Escala**: planetas y estrellas a escala de las naves (hecho: nave de 45 m, planetas de kilómetros, estrellas de cientos de km, motor de pulso).
- **Combate**: disparar a otras naves, con **escudos, misiles y cañones según la clase de nave**; la nave del Emperador es una nave más de su flota.

## Fase 5 — Flotas y exploración

- **5a. Tiempo de juego, cola de eventos y flotas.** ✔ Escala de tiempo única (`TIME_SCALE`): 1 = ritmo del diseño (horas); más alta en el servidor de pruebas. Cola `scheduled_events` con trabajador (`FOR UPDATE SKIP LOCKED`, un evento que falla se aplaza). Flotas y naves; cada Emperador empieza con un explorador. Orden `fleet.move`; la llegada es un evento programado. Tema privado `me` en el WebSocket.
- **5b. Niebla de guerra.** ✔ El detalle de los sistemas (planetas, recursos, anomalías) se genera con una semilla secreta que solo tiene el servidor (`DETAIL_SEED`; una semilla por sistema derivada con HMAC-SHA256); las posiciones y clases de estrella siguen siendo públicas. Tabla `discoveries`: se descubre al crear el Emperador (su sistema y lo que cubren su nave y su flota inicial), al llegar una flota (escáner de su mejor nave) y al llegar el Emperador tras un salto (evento `emperor.arrive`). `GET /api/systems/:id` entrega el detalle solo si se ha descubierto; el tema `me` lleva la lista de descubiertos. El cliente pide el detalle al servidor y lo guarda en memoria; lo no descubierto sale «Sin explorar» y en la vista de sistema solo se ve la estrella.

## Fase 6 — Pilotar la nave del Emperador (estilo No Man's Sky)

- **6a. Pilotar la nave.** ✔ Modelo 3D de la nave insignia. Se empieza a los mandos, dentro del sistema; vuelo en tiempo real entre planetas (que giran según la hora del servidor), cámara en primera y tercera persona, salir volando del sistema lleva al espacio interestelar y J salta a la estrella elegida (la cámara sigue a la nave y al llegar se entra pilotando). Ajustes con teclas configurables.
- **6b. Vuelo compartido.** ✔ El servidor recibe y valida la posición de la nave dentro del sistema (velocidad máxima, borde) y los demás jugadores del mismo sistema la ven moverse. Las flotas pueden escoltar a la nave del Emperador.
- **6c. Combate en tiempo real.** ✔ (con piratas Carroñeros de la IA fuera del Núcleo Humano, como datos en `PIRATE_RAIDER`) Armas y defensas como datos por clase de nave (cañones, misiles, escudos, casco). Disparos validados en el servidor (alcance, cadencia, munición), daño a escudos y casco, naves destruidas. La nave del Emperador pasa a ser una nave de su flota (las flotas que la escoltan combaten con ella).

## Fase 7 — Humanos, planetas y economía

- **7a. Humanos.** ✔ Población como recurso: vive en colonias y crece (logística, hacia un tope según la habitabilidad); la nave del Emperador lleva hasta 500 y los genera sola (Ley II, 5 por hora); el colonizador lleva hasta 1000 (embarcan de la colonia al construirlo). Datos en `packages/content/src/economy.ts`, reglas en `packages/sim/src/economy.ts`. Orden `colony.disembark`: el Emperador desembarca humanos en una colonia propia del sistema donde está (hasta el tope del planeta). Pendiente: tropas (Fase 9).
- **7b. Reclamar planetas.** ✔ Orden `colony.claim`: un planeta libre de un sistema descubierto se reclama desembarcando humanos de la nave del Emperador (presente y parada) o los colonos de un colonizador (que se consume). Los mundos hostiles piden más colonos (50 + 150 × (1 − habitabilidad)). Orden `colony.rename`. Dueño y nombre los ve quien ha descubierto el sistema (`GET /api/systems/:id/claims`); población y existencias, solo el dueño (tema `me`). El dueño extrae los recursos del planeta (y la mitad de los de sus lunas) y la energía de su estrella. La conquista de planetas ajenos es la Fase 9 (el dueño ya es cambiable).
- **7c. Economía.** ✔ Existencias por colonia (metal, volátiles, cristal, aleaciones) con resolución perezosa a trozos y topes de almacén; libro `resource_ledger` solo inserción (fundación, encargos, colonos que embarcan). Instalaciones como datos (mina, refinería de aleaciones, central de energía, astillero) con coste y horas; cola de construcción por colonia (se paga al encargar) que termina con el evento `colony.build`; el astillero construye las naves de `SHIP_CLASSES` y cada una aparece como flota nueva en el sistema. **Mantenimiento**: cada instalación consume volátiles de su colonia y la **capital** (la colonia más antigua) paga el de todas las naves; sin volátiles, se paga primero el mantenimiento, la refinería se para y la colonia queda «desabastecida». **Cancelar encargos** (`colony.cancel`: todo si no había empezado, la mitad si sí). Los planetas llevan **rótulo en la vista 3D** con su nombre (dorado si son tuyos).

## Fase 8 — Logística

- ✔ **Transporte**: cada flota tiene bodega (suma de la carga de sus naves; todos los recursos juntos) y plazas de pasajeros (carguero: 200). Orden `fleet.transfer` para cargar y descargar a mano en una colonia propia del sistema; la colonia conserva siempre sus colonos mínimos. Todo pasa por el libro de recursos.
- ✔ **Rutas automáticas** (`fleet.route` / `fleet.routeStop`): en el origen carga lo indicado hasta llenar, en el destino lo descarga todo y vuelve, sola, en cada llegada (evento `fleet.arrive`). Se acaba si una colonia deja de ser tuya.
- ✔ Interceptar convoyes en ruta (Fase 9a). Pendiente: red de suministro (instalaciones aisladas que se debilitan).

## Economía de la humanidad y mercado global ✔ (21-10-2026)

- ✔ Créditos (₢) generados por la población de las colonias; aporte fijo al **tesoro del Núcleo Humano**; agregados de toda la humanidad visibles para todos (panel «Humanidad»).
- ✔ **Proyectos comunes** (Defensas del Núcleo, Investigación, Subvenciones a colonias, Red de transporte): los Emperadores aportan recursos (que viajan al Núcleo) y el tesoro paga los créditos; efectos globales al completar cada nivel.
- ✔ **Mercado global** (panel «Mercado»): libro de órdenes por recurso, precios por oferta y demanda, historial, comisión para el tesoro y entrega con envíos según la distancia.
- Pendiente: la IA en el mercado (Nómadas del Vacío, Emperadores IA; Fase 11), recoger compras con flotas propias, cancelar órdenes de colonias conquistadas (9b), reponer combustible y munición de la nave en colonias propias (punto de enganche: `ColonyService.adjustStock`).

## Fase 9 — Guerra

- **9a. Combate de flotas** ✔ resuelto en el servidor por rondas (evento `battle.round`, reglas en `packages/sim/src/battle.ts`); huir con una orden de viaje; los convoyes esperan al combate; contactos (`GET /api/contacts`) e interceptar flotas en tránsito (`fleet.intercept`). Panel «Batallas» en el cliente. Pendiente: mostrar la batalla en 3D.
- **9b. Conquista de planetas ajenos.** Asedio con progreso y presencia sostenida; desembarco de tropas (humanos) para tomar el planeta o la instalación; captura en vez de destrucción.
- **9c. Combate a gran escala**: por encima de ~5 naves por bando, el combate en tiempo real (6c) pasa a rondas.

## Fase 10 — Muerte y linaje

- La nave del Emperador puede caer. Cunas de linaje con gestación que crece con las muertes seguidas. Sin Cunas, reaparece en el Núcleo Humano. Herederos que gobiernan colonias y en los que el jugador puede encarnarse.

## Fase 11 — Masividad e inteligencia artificial

- ✔ (21-10-2026) **Especies alienígenas del lore** como datos (territorio, flotas, naves propias, IA) y **territorios** en una capa determinista y secreta (no cambia `GENERATOR_VERSION`), visibles en el mapa respetando la niebla de guerra.
- ✔ **IA de facciones** con la misma tubería de órdenes que los jugadores (flotas, combate por rondas, mercado), sin bucles por tick: regiones que despiertan con humanos cerca (evento `ai.region`), guarnición, patrullas, expansión lenta, respuesta a intrusos según su agresividad, rencor y tributos, Nómadas del Vacío en el mercado. El Núcleo Humano es seguro y hay gracia para los Emperadores nuevos.
- ✔ **Emperadores IA humanos** (versión básica, evento `ai.emperor`): colonizan, construyen, exploran y comercian. Pendiente: que guerreen, acepten compañeros y gobiernen colonias de jugadores ausentes.
- Pendiente: proceso aparte `apps/ai` cuando haga falta escalar (hoy es un servicio dentro del servidor que usa la cola de eventos); ataques alienígenas a colonias y Cunas (con la 9b); pactos de los Grises y Custodios protectores; modelos 3D de las naves alienígenas y combate pilotado contra ellas (tras fusionar el pilotaje).
- Zonas de interés por sector en el WebSocket (cada jugador recibe solo lo cercano) para aguantar cientos de jugadores.

## Fase 12 — Organizaciones y comunidad

- Organizaciones y miembros. Descubrimientos compartidos y publicables.
- Traducción comunitaria: personal > organización > pública (votación y moderación) > base.

## Antes de abrir al público (obligatorio, en paralelo)

Lista de `docs/despliegue.md`: estáticos desde Cloudflare, 80/443 solo desde Cloudflare, límites por IP y cuenta, vigilante de tráfico saliente con corte automático. Además: dominio propio, HTTPS, correo real (SMTP con SPF/DKIM/DMARC) y `APP_ENV=production`.
