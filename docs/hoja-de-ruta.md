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
- **6d. Pilotaje a fondo** ✔ (petición del usuario, 21-10-2026; guía en `docs/ayuda-pilotaje.md`): pulso tipo supercrucero (velocidad según la distancia a los cuerpos, cruzar el sistema en 1–2 min), nave detallada con disparos desde sus bocas de fuego, misiles y explosiones mejores, nave aparcada que orbita la estrella (el servidor la conoce), cabina 3D e instrumentos tipo avión, recursos reales de la nave (energía, combustible, munición; se reponen junto a una colonia propia) y viaje cuántico entre sistemas desde los mandos (alinear, cargar, túnel; alcance según combustible).
- **6c. Combate en tiempo real.** ✔ (con piratas Carroñeros de la IA fuera del Núcleo Humano, como datos en `PIRATE_RAIDER`) Armas y defensas como datos por clase de nave (cañones, misiles, escudos, casco). Disparos validados en el servidor (alcance, cadencia, munición), daño a escudos y casco, naves destruidas. La nave del Emperador pasa a ser una nave de su flota (las flotas que la escoltan combaten con ella).

## Fase 7 — Humanos, planetas y economía

- **7a. Humanos.** ✔ Población como recurso: vive en colonias y crece (logística, hacia un tope según la habitabilidad); la nave del Emperador lleva hasta 500 y los genera sola (Ley II, 5 por hora); el colonizador lleva hasta 1000 (embarcan de la colonia al construirlo). Datos en `packages/content/src/economy.ts`, reglas en `packages/sim/src/economy.ts`. Orden `colony.disembark`: el Emperador desembarca humanos en una colonia propia del sistema donde está (hasta el tope del planeta); y `colony.embark`, la inversa: recupera humanos de la colonia a la nave (hasta su capacidad, dejando 50). Pendiente: tropas (Fase 9).
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
- Pendiente: la IA en el mercado (Nómadas del Vacío, Emperadores IA; Fase 11), recoger compras con flotas propias, reponer combustible y munición de la nave en colonias propias (punto de enganche: `ColonyService.adjustStock`).

## Fase 9 — Guerra

- **9a. Combate de flotas** ✔ resuelto en el servidor por rondas (evento `battle.round`, reglas en `packages/sim/src/battle.ts`); huir con una orden de viaje; los convoyes esperan al combate; contactos (`GET /api/contacts`) e interceptar flotas en tránsito (`fleet.intercept`). Panel «Batallas» en el cliente. Pendiente: mostrar la batalla en 3D.
- **9b. Conquista de planetas ajenos** ✔ (21-10-2026). Asedio con progreso y presencia sostenida de naves armadas (`siege.start`, evento `siege.tick`; disputado si hay naves armadas del defensor, roto si el atacante se queda sin ellas), plataformas defensivas que frenan el asedio, dañan a los asediadores y aportan guarnición, desembarco de tropas (humanos de cargueros, colonizadores o la nave del Emperador; `siege.assault`) y captura con pérdidas (población, existencias, instalaciones; obras perdidas, órdenes del mercado y rutas canceladas). Colonias independientes conquistables. IA: facciones alienígenas que asedian y ocupan colonias de su territorio según agresividad y rencor; Emperadores IA que defienden y, los militaristas, conquistan. Protecciones: compañeros, gracia de 24 h y Núcleo Humano para la IA. Pendiente: conquista instalación a instalación, red de suministro y asedios en 3D.
- **9c. Combate a gran escala**: por encima de ~5 naves por bando, el combate en tiempo real (6c) pasa a rondas.

## Fase 10 — Muerte y linaje ✔ (21-10-2026)

- ✔ La nave del Emperador puede caer (combate pilotado y batallas por rondas, en las que ahora también combate; el casco se guarda y se repara). Cunas de linaje (instalación) con gestación que crece con las muertes seguidas y se olvida con el tiempo. Sin Cunas, reaparece en el Núcleo Humano. Se pierden los humanos de a bordo, el combustible y la munición. Herederos que gobiernan colonias con una doctrina (extracción, defensa, obras) y en los que el jugador puede encarnarse (vivo o muerto). Los Emperadores de la IA también lo usan. Pantalla de muerte con la gestación y panel «Linaje»; Wiki «Muerte y linaje». Migración `0017`, `PROTOCOL_VERSION` 11.
- ✔ Los Erradicadores (`CRADLE_HUNTERS`) asedian primero las colonias con Cuna de su territorio.
- Pendiente: conquista instalación a instalación (la Cuna como objetivo propio, 9b) y gobernadores que también recluten y defiendan.

## Fase 11 — Masividad e inteligencia artificial

- ✔ (21-10-2026) **Especies alienígenas del lore** como datos (territorio, flotas, naves propias, IA) y **territorios** en una capa determinista y secreta (no cambia `GENERATOR_VERSION`), visibles en el mapa respetando la niebla de guerra.
- ✔ **IA de facciones** con la misma tubería de órdenes que los jugadores (flotas, combate por rondas, mercado), sin bucles por tick: regiones que despiertan con humanos cerca (evento `ai.region`), guarnición, patrullas, expansión lenta, respuesta a intrusos según su agresividad, rencor y tributos, Nómadas del Vacío en el mercado. El Núcleo Humano es seguro y hay gracia para los Emperadores nuevos.
- ✔ **Emperadores IA humanos** (versión básica, evento `ai.emperor`): colonizan, construyen, exploran y comercian. Pendiente: que guerreen, acepten compañeros y gobiernen colonias de jugadores ausentes.
- Pendiente: proceso aparte `apps/ai` cuando haga falta escalar (hoy es un servicio dentro del servidor que usa la cola de eventos); pactos de los Grises y Custodios protectores; modelos 3D de las naves alienígenas y combate pilotado contra ellas (tras fusionar el pilotaje).
- Zonas de interés por sector en el WebSocket (cada jugador recibe solo lo cercano) para aguantar cientos de jugadores.

## Fase 12 — Organizaciones y comunidad

- Organizaciones y miembros. Descubrimientos compartidos y publicables.
- Traducción comunitaria: personal > organización > pública (votación y moderación) > base.

## Cola autónoma (21-10-2026, tarde)

El usuario delegó el orden: se sigue esta cola sin pedir permiso, un solo agente, copia de seguridad antes de cada punto, `pnpm typecheck` y `pnpm build`, commit, fusionar en `main`, desplegar y marcar. Lo hecho hoy por la tarde (grieta y túnel, insignia de 320 m, espacio profundo y minería, alta con compañero, salto autónomo, crucero, puntería y choques nave-nave) ya está en `main` y desplegado; **nada de eso se ha probado jugando**.

1. [x] **Choques contra cuerpos con daño**: planetas, lunas y asteroides dañan según la velocidad de impacto (umbral para aterrizar o rozar despacio sin daño), autoritativo en el servidor como `SHIP_COLLISION`.
2. [x] **Calor de las estrellas**: zona de calor según la clase (escudos y luego casco, cada vez más rápido), aviso en el HUD, el pulso se apaga antes de la zona mortal, agujero negro = destrucción al cruzar el horizonte; cálculo en el servidor (muerte y linaje de la Fase 10).
3. [x] **Limitador de destellos** (fotosensibilidad): tope global de destellos por segundo, sin rojo saturado parpadeante, saltos de brillo suavizados en explosiones, impactos, grieta y túnel.
4. [x] **Qué hacer mientras viajas**, en orden: ✔ puente de mando en el túnel; ✔ órdenes tácticas en batallas a distancia (`fleet.tactic`); ✔ pilotar otras naves de tus flotas a distancia (`fleet.pilot`); ✔ gestión más profunda de colonias (ventana de gestión, `colony.demolish`); ✔ sondas de exploración a distancia (`probe.launch`, migración 0024).
5. [x] **Nave nodriza** (clase `mothership`, 1600 m): la nave del Emperador se acopla en su hangar (Enter, `flagship.dock`) y se repone de la bodega de la flota (`FLAGSHIP_DOCK`). Pendiente: viajar acoplada con la flota.
6. [x] **9d. IA de naves** (`docs/ia-naves.md`): ✔ piloto de los Carroñeros (`packages/sim` ai/pirate.ts: manada con presa común, huir y reagruparse, esquivar, no chocar con cuerpos ni entrar en el calor, disciplina de fuego); ✔ escoltas: las naves armadas de las flotas paradas salen a escoltar al Emperador en 3D y atacan a los Carroñeros (`ESCORT`, `packages/sim` ai/escort.ts); ✔ órdenes a las escoltas (`escort.order`: seguir, atacar blanco, mantener, replegar); ✔ tenaza de la manada (`flankOffset`); pendiente: más planes de grupo (cebo, emboscadas, oleadas), ✔ milicia del Núcleo (`CORE_MILITIA`: persigue a quien ataque a otro humano en el Núcleo). ✔ Combate pilotado contra alienígenas: las naves de sus flotas paradas salen al espacio local (`ALIEN_LOCAL`), atacan según la hostilidad de su facción o si se les dispara (rencor `grudge.attack`).
7. [ ] **9c. Combate a gran escala**: por encima de ~5 naves por bando, el combate en tiempo real pasa a rondas. *Aplazado*: hoy el tiempo real está acotado por topes (`ESCORT.maxShips`, `ALIEN_LOCAL.maxShips`, piratas por sistema); hacerlo cuando haya jugadores suficientes para que haga falta.
8. [x] ✔ **Conquista instalación a instalación** (bombardeo orbital `siege.raze`) y ✔ **red de suministro** (colonias a más de `ECONOMY.supplyRangeLy` de la red desde la capital extraen `isolatedExtraction`).
9. [x] **Emperadores IA completos**: ✔ guerra (9b), ✔ aceptan compañeros según su personalidad (`AI_COMPANIONS`), ✔ autogestión de las colonias de un jugador ausente (`colony.autoGovern`, evento `colony.govern`).
10. [x] **Zonas de interés** en el WebSocket (`INTEREST.rangeLy`: el tema `emperors` solo lleva los Emperadores públicos cercanos; compañeros siempre; al moverse, lista nueva).

## Plan de juego (21-10-2026): conquistar el universo y sobrevivir

Informe completo en Claude Docs («Aeonarch — Plan de juego»). Cinco fases, cada una cerrada con una prueba del usuario jugando:

1. [ ] **Nave nodriza completa**: ✔ viaje acoplado con su flota (se llega acoplado), ✔ taller que repara la flota (`MOTHERSHIP_WORKSHOP`), ✔ hangar con ala de cazas que escoltan (`MOTHERSHIP_HANGAR`), ✔ puente de mando a bordo, ✔ si cae en batalla con el Emperador acoplado, cae con ella (decisión del usuario, `MOTHERSHIP_CAUSE`); los módulos pasan a la fase 4.
2. [x] **La galaxia contraataca** (21-10-2026, sin probar jugando): nivel de amenaza por facción («Te persigue» en Batallas), flotas de castigo (`ALIEN_AI.punish`), emboscadas en las salidas de salto (`PIRATE_AMBUSH`), incursiones a las rutas (`ROUTE_RAID`, evento `ai.raidEnd`), guaridas de Carroñeros (`SCAVENGER_LAIR`) y jefes Carroñeros (líderes de las flotas profundas).
3. [ ] **Aliados de verdad**: petición de ayuda, pactos con Emperadores de la IA, refuerzos de la milicia, mercenarios, reputación.
4. [ ] **Guerra que evoluciona**: tecnología por niveles, módulos de nave, armas nuevas, formaciones, comandantes, batallas de flotas en 3D.
5. [ ] **Metas**: prestigio y clasificación, objetivos de era, crisis galácticas, victoria y derrota con legado.

## Rediseño de la interfaz y editor de naves (petición del 21-10-2026)

- [ ] **Interfaz profesional** (`docs/rediseno-interfaz.md`): ✔ U1 teclas solo para lo constante y barra de acciones; ✔ U2 sistema de diseño; ✔ U3 menú de ajustes nuevo; ✔ U4 (fundidos del HUD; falta reordenar el HUD por zonas); U5 mapa y paneles.
- [ ] **Editor de naves por piezas** (`docs/editor-naves.md`): ✔ E1 piezas y reglas (`packages/content` shipParts.ts, `packages/sim` shipDesign.ts, con pruebas); ✔ E2 servidor (guardar diseños y construirlos en colonias); ✔ E3 editor (panel «Astillero»); E4 las estadísticas mandan (✔ combate por rondas; falta vuelo, salto y combate pilotado); E5 modelos 3D de las piezas.
- [x] ✔ **La galaxia** (22-10-2026, `GENERATOR_VERSION` 2, mundo reiniciado): disco espiral de 30 000 a.l. con cuatro brazos y Ónfalo, el agujero negro supermasivo, en el centro (`GALAXY`, `packages/procgen` galaxy.ts); el Núcleo Humano en un brazo a ~9000 a.l. del centro. Pendiente: que Ónfalo sea un sistema especial (tamaño, peligro, objetivo final).
- [x] ✔ **Escolta en crucero** (petición del usuario, 22-10-2026; orden `escort.cruise`): opción de que las naves propias viajen en crucero (y con el pulso) junto al Emperador, en formación, en vez de reunirse de un salto.
- [x] ✔ **Cada nave reposta** (petición del usuario; `FLEET_FUEL`, `ships.fuel`, `fleet.refuel`, repostaje al llegar a colonia propia; la nodriza aún no reposta a su flota): combustible (y munición) por nave de flota, no solo la del Emperador; hay que vigilarlo y reponerlo en colonias, nodrizas o con cargueros.
- [ ] **Materiales y fabricación** (petición del usuario): ✔ F1 Fábrica, seis componentes con recetas y cadenas (`RECIPES`, `colonies.items`, encargo `craft`), las piezas avanzadas del Astillero los piden; falta transportarlos en bodegas y venderlos en el mercado.
- [x] **Libros en la Wiki** (grupo «Libros», firma del autor; solo administradores).

## Antes de abrir al público (obligatorio, en paralelo)

Lista de `docs/despliegue.md`: estáticos desde Cloudflare, 80/443 solo desde Cloudflare, límites por IP y cuenta, vigilante de tráfico saliente con corte automático. Además: dominio propio, HTTPS, correo real (SMTP con SPF/DKIM/DMARC) y `APP_ENV=production`.
