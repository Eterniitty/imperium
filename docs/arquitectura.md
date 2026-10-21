# Aeonarch — Arquitectura

Arquitectura técnica prevista. El diseño de juego está en [diseno.md](diseno.md) y el despliegue en [despliegue.md](despliegue.md).

## 1. Pila tecnológica

| Capa | Tecnología | Motivo |
|---|---|---|
| Monorepo | **pnpm** workspaces, TypeScript estricto | Código compartido entre cliente, servidor e IA. |
| Cliente UI | **React** | Menús, paneles, HUD. |
| Cliente 3D | **Three.js** con **motor propio fuera de React** | El bucle de render no pasa por la reconciliación de React; React solo dibuja la interfaz. |
| Empaquetado | **Vite** | Arranque rápido y HMR. |
| Servidor HTTP | **Fastify** | Rápido, tipado, con buen ecosistema de plugins. |
| Tiempo real | **ws** con **protocolo propio** | Ver abajo. |
| Validación | **Zod** | Esquemas compartidos para órdenes y mensajes. |
| Base de datos | **PostgreSQL** + **Drizzle** | Transacciones, bloqueos de fila, SQL explícito. |
| Caché / pub-sub | **Redis** | Difusión entre procesos, límites de tasa, sesiones efímeras. |
| Correo | **SMTP** | Enlaces mágicos de acceso. |
| Infraestructura | **Docker Compose** + **Caddy** | Un solo servidor, HTTPS automático. |

### ¿Por qué ws y no Colyseus?
- El juego no es una sala cerrada: es un mundo persistente dividido en sectores, con suscripciones dinámicas por zona de interés. El modelo de "salas" de Colyseus encaja mal.
- La autoridad de la simulación está en la base de datos y en la cola de eventos, no en el estado en memoria de una sala.
- Un protocolo propio y pequeño (ver §8) da control total sobre deltas, suscripciones e idempotencia, sin capas de sincronización automática que habría que sortear.

## 2. Estructura de carpetas

```
apps/
  client/     Cliente web (React + motor Three.js)
  server/     API HTTP, WebSocket, simulación autoritativa
  ai/         Procesos de IA (gobernadores, alienígenas, Emperadores IA)
packages/
  shared/     Tipos, constantes, esquemas Zod, protocolo
  procgen/    Generación procedural determinista por semilla
  sim/        Reglas de simulación puras (economía, combate, movimiento)
  content/    Fichas de especies, facciones y naves como datos
docs/
```

## 3. Niveles de simulación

| Nivel | Qué cubre | Frecuencia |
|---|---|---|
| **N0** | Combate en tiempo real (nave del Emperador + escolta) | Ticks rápidos (~10–20 Hz) en memoria |
| **N1** | Movimiento y encuentros dentro de un sector activo | Segundos |
| **N2** | Economía, construcción, asedios, combates de flotas por rondas | Eventos programados (minutos/horas) |
| **N3** | Sectores sin actividad | Nada; se resuelven perezosamente al consultarse |

## 4. Resolución perezosa de la economía

No hay un tick global que recorra todas las colonias. Cada inventario guarda el **último instante resuelto** y sus **tasas** de producción/consumo. Al leerlo o modificarlo se calcula el estado actual como `valor + tasa × Δt` (con topes de almacenamiento y agotamiento). Solo se programa un evento cuando algo cambia de forma discreta (se llena un almacén, se agota un recurso, termina una construcción).

Un nivel por encima, la **economía de la humanidad** sigue la misma idea: cada cartera de créditos guarda su saldo y su renta, y el tesoro del Núcleo la suma de los aportes por hora; ver «Implementado: economía de la humanidad y mercado global» (§8).

## 5. Cola de eventos programados

- Tabla `scheduled_events` con `due_at`, tipo, carga útil y sector.
- Los trabajadores toman lotes con:

```sql
SELECT id, kind, payload
FROM scheduled_events
WHERE due_at <= now() AND sector_id = ANY($1)
ORDER BY due_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

- `SKIP LOCKED` permite varios trabajadores sin pisarse. Cada evento se procesa en su propia transacción y se marca como hecho en la misma.

## 6. Un único escritor por sector

- Cada sector activo tiene **un único proceso escritor**, obtenido mediante un **arrendamiento** (lease) con caducidad en la base de datos (`sector_leases`).
- El escritor renueva el arrendamiento periódicamente; si muere, otro lo toma al caducar.
- Esto evita condiciones de carrera entre procesos sin bloqueos distribuidos complejos.

## 7. Integridad de datos

- **Libro de recursos solo inserción** (`resource_ledger`): cada movimiento (producción, consumo, transferencia, saqueo) es un asiento inmutable. Los saldos se pueden reconstruir y auditar.
- **Idempotencia de órdenes**: cada orden lleva un `cmdId` generado por el cliente; el servidor guarda los ya procesados y responde lo mismo ante reintentos.

### Tubería de órdenes

Igual para jugadores y para las tres capas de IA:

1. **Recepción** (WS o interna).
2. **Validación de esquema** (Zod).
3. **Autorización**: ¿el actor controla esa entidad?
4. **Deduplicación** por `cmdId`.
5. **Validación de reglas** (`packages/sim`): recursos, alcance, estado.
6. **Aplicación** transaccional + asientos en el libro + eventos programados.
7. **Respuesta** (`ack`) y **difusión** de cambios (`delta`/`evt`) a los suscritos.

## 8. Protocolo WebSocket

Mensajes JSON con campo `t` (tipo). Ejemplos:

```jsonc
// Cliente → servidor: orden
{ "t": "cmd", "cmdId": "c-01J9...", "op": "fleet.move", "args": { "fleetId": "f-12", "to": [3, -1, 7] } }

// Servidor → cliente: confirmación
{ "t": "ack", "cmdId": "c-01J9...", "ok": true }
{ "t": "ack", "cmdId": "c-01J9...", "ok": false, "error": "insufficient_volatiles" }

// Cliente → servidor: suscripción a una zona de interés
{ "t": "sub", "topic": "sector:3:-1:7" }

// Servidor → cliente: instantánea inicial
{ "t": "snap", "topic": "sector:3:-1:7", "seq": 1042, "data": { "fleets": [], "installations": [] } }

// Servidor → cliente: cambios incrementales
{ "t": "delta", "topic": "sector:3:-1:7", "seq": 1043, "ops": [{ "path": "fleets.f-12.pos", "v": [3.1, -1, 7] }] }

// Servidor → cliente: evento discreto
{ "t": "evt", "kind": "siege.progress", "data": { "installationId": "i-7", "progress": 0.42 } }
```

- `seq` permite detectar huecos; ante uno, el cliente pide una nueva `snap`.

### Implementado (Fase 4)

- Conexión: `POST /api/ws/ticket` (con la cookie de sesión) devuelve un ticket de un solo uso válido 30 s; el cliente abre `/ws?v=<versión>&ticket=...`. El servidor rechaza antes de aceptar la conexión si el origen no es `PUBLIC_URL`, la versión del protocolo no coincide, el ticket no vale o hay demasiadas conexiones.
- Al conectar, el servidor envía `hello` (id del Emperador propio y hora del servidor, para corregir el reloj local). El cliente pide `{"t":"sub","topic":"emperors"}` y recibe la `snap` con todos los Emperadores; después, `delta` con cada cambio (viajes, altas, conexiones y desconexiones).
- Única orden por ahora: `emperor.move` (`args.systemId`). El viaje se guarda como destino y horas de salida y llegada; la posición se calcula al vuelo con `@imperium/sim` en el servidor y en el cliente, sin enviar posiciones.
- Tipos en `packages/shared/src/protocol.ts`; esquema Zod de los mensajes del cliente en `schemas.ts`. Mensaje mal formado → cierre 4400; exceso de mensajes → 4429.

### Implementado (paso 5b): niebla de guerra

- Las posiciones y clases de estrella (`generateSector`) son públicas. El detalle (`generateSystemDetail`) recibe además una semilla secreta **por sistema**: `HMAC-SHA256(DETAIL_SEED, systemId)` recortado a 32 bits (`apps/server/src/discovery/service.ts`). Averiguar la semilla de un sistema por fuerza bruta no revela las de los demás.
- Tabla `discoveries (emperor_id, system_id, discovered_at)`. Se descubre el sistema y todo lo que esté dentro del alcance del escáner (recorriendo los sectores que corta la esfera): al crear el Emperador, al procesar `fleet.arrive` (mejor escáner de la flota) y al procesar `emperor.arrive` (nave del Emperador), evento que se programa al ordenar el salto.
- Puesta al día: al arrancar, el servidor da su entorno a los Emperadores sin ningún descubrimiento (los creados antes del paso 5b); es idempotente.
- `GET /api/systems/:systemId` (cookie de sesión, 120 por minuto y cuenta): `{ detail }` si se ha descubierto; si no, 403 `not_discovered`.
- Tema `me`: la instantánea lleva `discovered` (ids) y cada descubrimiento llega como `{ path: "discovered.<id>", v: true }`. `PROTOCOL_VERSION` = 3.

### Implementado (Fase 7): humanos, colonias y economía

- **Datos** en `packages/content/src/economy.ts` (`HUMANS`, `SHIP_HUMAN_CAPACITY`, `POPULATION`, `INSTALLATIONS`, `ECONOMY`); **reglas puras** en `packages/sim/src/economy.ts` (generación de humanos, colonos mínimos, crecimiento logístico, energía, mano de obra, extracción, refinería, `advanceStock` lineal a trozos, `resolveColony` a pasos de una hora de juego). Las tasas son por hora de juego: horas = Δms × `TIME_SCALE` / 3,6e6; las construcciones duran `horas / TIME_SCALE`.
- **Modelo de datos** (migración `0006`):
  - `emperors.humans` + `humans_at`: humanos de la nave del Emperador resueltos a esa hora (crecen solos hasta 500).
  - `ships.humans`: colonos a bordo.
  - `colonies (id, emperor_id, system_id, planet_index, name, population, metal, volatiles, crystal, alloys, resolved_at, founded_at)`, único por `(system_id, planet_index)`. `emperor_id` es el dueño y puede cambiar (conquista, Fase 9). Población y existencias son las de `resolved_at`: toda escritura resuelve antes a la hora actual.
  - `installations (id, colony_id, kind, built_at)`: una fila por instalación.
  - `colony_builds (id, seq, colony_id, kind, item_id, started_at, finish_at)`: cola; solo la primera está en marcha y tiene un evento `colony.build` programado. Se paga al encargar; al terminar, la siguiente empieza a la hora de fin de la anterior.
  - `resource_ledger (id, emperor_id, colony_id, reason, ref, metal, volatiles, crystal, alloys, humans, created_at)`: solo inserción (un disparador impide `UPDATE` y `DELETE`); sin claves ajenas para sobrevivir a lo que describe. Motivos: `foundation`, `build`, `colonizer_boarding`. La producción continua no se asienta (es la resolución perezosa).
- **Órdenes** (WebSocket, `cmd`): `colony.claim { systemId, planetIndex, humans?, fleetId? }` (sistema descubierto, planeta libre; sin `fleetId` desembarcan `humans` de la nave del Emperador, que debe estar allí y parada; con `fleetId`, los colonos del colonizador de esa flota, que se consume y, si la flota se queda vacía, desaparece), `colony.rename { colonyId, name }` (solo el dueño; mismas reglas que el nombre de Emperador, 2–32 caracteres) y `colony.build { colonyId, kind: "installation" | "ship", itemId }` (naves solo con astillero). Errores nuevos en `CommandError`.
- **Quién ve qué**: el tema privado `me` lleva `colonies` (población, existencias, tasas por hora real, energía, instalaciones y cola) y `humans`; cambios `colonies.<id>` (null si se pierde) y `humans.<emperorId>`. Dueño y nombre de los planetas (territorio) se piden a `GET /api/systems/:id/claims`, solo para sistemas descubiertos. `PROTOCOL_VERSION` = 4.
- **Colonias independientes** (migración `0010`): al borrar una cuenta, sus colonias se quedan con `emperor_id` null (la clave ajena es `ON DELETE SET NULL`). `ColonyService.makeIndependent` las resuelve hasta ese momento, cancela sus encargos (reembolso habitual, asentado como `cancel`) y asienta `independence`. Quedan congeladas: nada las resuelve, así que ni producen ni gastan. En `claims` salen con `ownerId`/`ownerName` null («Independiente» en el cliente). La conquista (Fase 9b) debe poner `resolved_at` a la hora de la conquista para no cobrar el tiempo congelado.
- **Evento** `colony.build { buildId }`: resuelve la colonia hasta la hora de fin con lo que tenía, añade la instalación o crea una flota nueva con la nave (el colonizador embarca colonos de la colonia, dejando 50) y pone en marcha la siguiente.

### Implementado (Fase 9a): combate de flotas por rondas e intercepción

- **Datos** en `packages/content/src/ships.ts`: `attack` y `battleShield` por clase de nave, `FLEET_BATTLE` (30 s de juego por ronda, máximo 40 rondas, dispersión del daño ±20 %) y `CONTACT_SENSORS`. **Reglas puras** en `packages/sim/src/battle.ts` (`resolveBattleRound`: fuego simultáneo, objetivo al azar entre los enemigos en pie, el escudo absorbe primero; determinista con la semilla de la ronda, generador entero mulberry32).
- **Modelo de datos** (migración `0009`): `battles (id, system_id, seed, round, started_at, next_round_at, ended_at)`, `battle_sides (battle_id, side 0|1, emperor_id, outcome won|lost|fled|draw)` y `battle_rounds (battle_id, round, report jsonb)`; `fleets.battle_id` marca las flotas que combaten. Las batallas se conservan como historial.
- **Comienzo**: al procesar `fleet.arrive` (`WarService.onArrive`), si en el sistema hay flotas paradas de dos Emperadores que no son compañeros mutuos y alguno puede atacar, empieza una batalla con todas sus flotas (como mucho una en curso por sistema; las flotas del mismo Emperador que llegan después se unen a su bando, las de terceros esperan). Cada ronda es un evento `battle.round { battleId }`. Termina cuando un bando se queda sin naves (`lost`/`won`), huye (`fled`), tras 40 rondas o si nadie puede hacer daño (`draw`); al terminar se mira si quedan otros hostiles en el sistema.
- **Pérdidas**: las naves destruidas se borran; la carga que ya no cabe y los pasajeros sin plaza se pierden y se asientan en `resource_ledger` como `battle_loss`; la capital se resuelve antes (paga menos mantenimiento). Una flota sin naves desaparece.
- **Huir**: cualquier orden de viaje (`fleet.move`) saca a la flota de la batalla. En combate no se carga, descarga ni coloniza (error `in_battle`); los convoyes en ruta automática esperan y la reanudan si sobreviven.
- **Interceptar**: `GET /api/contacts` lista las flotas enemigas en tránsito que salen de o van a un sistema al alcance de los sensores del jugador (flotas paradas, su nave, colonias). Orden `fleet.intercept { fleetId, targetFleetId }`: la flota viaja al destino del contacto (error `no_target` si ya no se ve) y combaten allí al coincidir.
- **Quién ve qué**: el tema `me` lleva `battles` (en curso y acabadas en la última hora, vistas desde el bando del jugador: naves de cada lado, últimas rondas y resultado) y cambios `battles.<id>`. `PROTOCOL_VERSION` = 5. En el cliente, panel «Batallas» (`WarPanel`) con las batallas y los contactos; la batalla se ve en 3D en la vista del sistema (ver «Implementado: tipos de nave, Carroñeros por peligro y modelos procedurales»).

### Implementado (Fase 9b): conquista de planetas

- **Datos** en `packages/content/src/conquest.ts` (`SIEGE`, `INSTALLATION_DEFENSE`, `ALIEN_SIEGE`) y la instalación `defense_platform` en `INSTALLATIONS`; personalidades de la IA con `defends` y `war`. **Reglas puras** en `packages/sim/src/siege.ts`: `colonyDefense`, `siegePower`, `siegeProgressPerHour` (ataque / (ataque + defensa) / `baseHours`), `siegeAttrition` (un impacto por plataforma y resolución, con semilla), `resolveAssault` (tropas contra milicia + guarnición) y `captureLosses` (población, existencias e instalaciones, con semilla).
- **Modelo de datos** (migración `0015`): `sieges (id, colony_id, system_id, attacker_id, defender_id, seed, step, progress, resolved_at, state, attack, defense, defenders, last_assault, started_at, next_tick_at, ended_at, outcome)`, como mucho uno en curso por colonia (índice único parcial); `colonies.acquired_at` (la capital es la más antigua para su dueño: `coalesce(acquired_at, founded_at)`).
- **Órdenes**: `siege.start { colonyId }` (flota armada propia parada en el sistema, sin naves armadas del defensor; no a compañeros ni a Emperadores en su gracia de `SIEGE.noviceGraceHours`; la IA nunca en el Núcleo Humano), `siege.lift { siegeId }` y `siege.assault { siegeId, fleetId?, troops? }` (tropas de la bodega y colonos de una flota, o de la nave del Emperador). Errores nuevos: `own_colony`, `protected`, `already_besieged`, `defended`, `no_armed_fleet`, `no_siege`, `siege_not_ready`, `no_troops`.
- **Evento** `siege.tick { siegeId }` cada `SIEGE.tickGameMinutes` (`SiegeService`, `apps/server/src/war/siege.ts`): si la colonia cambió de manos, `void`; sin naves armadas del atacante (ni en combate), `broken`; con naves armadas del defensor, `contested`; con las del atacante en batalla, `battle`; si no, avanza hasta `ready`. Las plataformas dañan a las naves paradas del atacante (las destruidas pierden su carga con `WarService.loseCargo`). Si el atacante es un actor alienígena, al llegar a `ready` ocupa la colonia.
- **Captura** (`ColonyService.capture`, tras `MarketService.cancelForColony`): el antiguo dueño cobra su capital hasta ese momento; se resuelve la colonia (las independientes no: estaban congeladas y su `resolved_at` pasa a la hora de la conquista); cola de construcción perdida (`conquest_cancel`); rutas que la usan borradas; pérdidas de `captureLosses`; supervivientes como colonos; asientos `conquest_lost` y `conquest`. Las órdenes de venta devuelven lo retenido a la colonia antes del cambio de dueño; las de compra, los créditos a quien las puso; los envíos en camino se pierden al llegar (`shipment_lost`).
- **IA**: `AlienService.considerSieges` en cada `ai.region` (facciones que no ignoran intrusos, hostiles al dueño por postura o rencor, probabilidad `agresividad × ALIEN_SIEGE.chancePerTick`, gracia y Núcleo respetados; las flotas que asedian no patrullan ni responden). `AiEmperorService.war`: defensa de sus colonias asediadas y, con `war`, conquista de la colonia ajena más débil a su alcance fuera del Núcleo, desembarcando los colonos de un colonizador.
- **Quién ve qué**: el tema `me` lleva `sieges` (los propios y los contra colonias propias, en curso y acabados en las últimas `SIEGE.recentHours`), cambios `sieges.<id>`; `claims` lleva `colonyId` y `besieged`. `PROTOCOL_VERSION` = 9. Cliente: asedio en el panel del planeta (asediar, desembarcar, levantar), sección «Asedios» en «Batallas» y avisos al defensor y al atacante. Exportación de datos: `sieges` del Emperador (atacante o defensor); se borran en cascada con el atacante (el defensor queda a null).

### Implementado: economía de la humanidad y mercado global

- **Datos** en `packages/content/src/humanity.ts` (`CREDITS`, `HUMANITY`, `HUMANITY_PROJECTS`, `MARKET`); **reglas puras** en `packages/sim/src/humanity.ts` (renta, reparto con el tesoro, coste y efecto de los proyectos, `humanityBonuses`, duración de los envíos) y `packages/sim/src/market.ts` (`matchOrder`: prioridad precio-tiempo, precio del que estaba en el libro, sin casarse consigo mismo; validación de precio y cantidad; comisión; profundidad del libro).
- **Moneda: el crédito (₢)**. Origen: la población de las colonias (`CREDITS.perPopulationPerHour`); cada Emperador empieza con `CREDITS.starting`. Una parte fija (`HUMANITY.taxRate`, 10 %) va al **tesoro del Núcleo Humano**, que también cobra la comisión del mercado (2 %) y las donaciones. Los créditos no son materia (no viajan), pero todo movimiento se asienta en `resource_ledger` (columna nueva `credits`; los asientos del tesoro van sin Emperador ni colonia).
- **Resolución perezosa** (sin bucles por tick): `emperor_wallets` guarda saldo, renta bruta por hora de juego y `settled_at`; saldo actual = saldo + renta neta × horas. El tesoro (`humanity_treasury`, una fila) guarda su saldo y la **suma de los aportes por hora** de todas las carteras: cuando cambia la renta de un Emperador se resuelve el tesoro y se ajusta esa suma. La renta se recalcula (leyendo sus colonias resueltas) con el evento `economy.settle` (cada hora de juego por Emperador, mínimo 10 s reales) o al usar la cartera; ese recálculo guarda también los agregados del Emperador (`summary`), de los que salen los de toda la humanidad (más las colonias independientes, congeladas).
- **Proyectos comunes** (`humanity_projects`, `humanity_contributions`): los recursos se aportan desde una colonia propia y viajan al Núcleo (envío); los créditos los paga el tesoro cuando el nivel tiene todos los recursos (si no le llega, evento `humanity.fund` a la hora prevista; además se reintenta en cada `economy.settle`). Bonificaciones (en memoria, `HumanityService.bonuses()`): extracción de todas las colonias (`ColonySite.extractionMultiplier`), existencias de fundación, escudo de batalla en sistemas del Núcleo (`WarService.setShieldFactor`) y velocidad de los envíos. La de extracción se aplica desde el último cálculo de cada colonia (como mucho una hora atrás por `economy.settle`, que no escribe colonias: solo las lee).
- **Mercado** (`market_orders`, `market_trades`): orden `market.order { resource, side, price, quantity, colonyId }`; al crearla se retiene lo ofrecido (recursos de la colonia o créditos `escrow_credits`) y se casa en la misma transacción, con un candado consultivo único para todo el mercado (`pg_advisory_xact_lock`, sin bloqueos cruzados entre carteras). El vendedor cobra al momento (menos la comisión); el comprador recibe la diferencia si casa más barato; lo vendido viaja como **envío** (`shipments`, evento `shipment.arrive`) de la colonia del vendedor a la del comprador, con un tiempo según la distancia (`HUMANITY.shipmentSpeedLyPerHour`). Si al llegar la colonia ya no es del comprador, se pierde (`shipment_lost`). `market.cancel { orderId }` devuelve lo retenido. Límites: órdenes abiertas por Emperador, cantidad entera y acotada, precio con dos decimales; el resto de órdenes pasan por la tubería normal (Zod, `cmdId`, límite de mensajes). Preparado para la IA: un Emperador de la IA usará las mismas órdenes.
- **Punto de enganche para la nave** (combustible y munición que se reponen en colonias propias): `ColonyService.adjustStock(tx, emperorId, colonyId, delta, reason, ref, at)` resuelve la colonia, comprueba existencias, escribe y asienta en el libro.
- **API**: `GET /api/humanity` (agregados, tesoro y proyectos; caché de 10 s), `GET /api/market` (libro, precios e historial por horas; caché de 5 s), `GET /api/market/mine`. Tema `me`: `wallet` en la instantánea y cambios `wallet.<id>`. Orden `humanity.contribute { projectId, colonyId?, amounts?, credits? }`. `PROTOCOL_VERSION` = 6. Migración `0011`.
- **Borrado de cuenta**: se cancelan sus órdenes (lo retenido vuelve a sus colonias antes de independizarse) y su renta deja de aportar al tesoro; la cartera se borra en cascada; operaciones, aportes y envíos quedan con el Emperador a null. Todo ello va en la exportación de datos.
- **Pendiente**: recoger compras con flotas propias; la IA (Nómadas del Vacío, Emperadores IA) en el mercado.
### Implementado (6d): pilotaje, recursos de la nave y viaje cuántico

Guía para jugadores en [ayuda-pilotaje.md](ayuda-pilotaje.md).

- **Pulso (supercrucero)**: `packages/sim/src/flight.ts`. Límite de velocidad según la distancia a la superficie del cuerpo más cercano y el rumbo (`pulseSpeedLimit`, `pulseLimitAt`: distancia / 3 s, hasta ×7 al alejarse, entre 300 m/s y 150 km/s) y paso suave (`stepPulseSpeed`). El servidor valida cada posición con el límite más permisivo en los dos extremos del tramo (`SpaceService.maxSpeedAt`). Por encima de la velocidad de impulso (con margen) se cuenta como pulso y gasta combustible; sin él, la posición se rechaza.
- **Bocas de fuego** como datos (`FLAGSHIP_HARDPOINTS` en content; los piratas, escaladas): el servidor dispara desde la boca (alternando) y suma a la velocidad del proyectil la de la nave; `shot` lleva `muzzle`. El cliente dibuja el disparo propio al pulsar y lo empareja con la confirmación.
- **Nave aparcada** (`packages/sim/src/park.ts`): sin piloto, la nave orbita la estrella con la ley de los planetas (`orbitalPeriodS`) desde la posición y hora en que se aparcó (`emperors.park_x/y/z`, `park_at`, migración `0013`; sin ellas, sitio por defecto del sistema). `SpaceService` mantiene las aparcadas en los sistemas activos (visibles y atacables; los piratas no las persiguen) y repasa cada 5 s quién está (`FlagshipService.parkedIn`). Para tomar los mandos, la primera posición tiene que estar a menos de 5 km de la aparcada; si no, `poseRejected` con su posición. Al saltar, la nave aparece en el borde del destino del lado del origen (`arrivalPark`, a 0,97 del radio del sistema).
- **Recursos de la nave** (`FLAGSHIP_SUPPLIES` en content, reglas en `packages/sim/src/supplies.ts` y `Combatant` en `apps/server/src/space/combat.ts`): energía (en memoria; la gastan cañón, recarga del escudo y pulso), combustible (pulso y salto cuántico; reserva de emergencia que se regenera despacio), proyectiles y misiles (a bordo solo se fabrica una reserva, `ammoRegenMax`). Se guardan en `emperors` (`fuel`, `fuel_at`, `cannon_ammo`, `missiles`, `ammo_at`; migración `0014`) cada 15 s si cambian, al aparcar y al apagar. Junto a una colonia propia (150 km) se reponen cada 2 s con sus existencias (`FlagshipService.resupply`: volátiles, metal y aleaciones; asiento `flagship_resupply`). El piloto recibe `supplies` (energía, combustible, reponiendo) unas dos veces por segundo; el tema `me` lleva `flagship` (aparcamiento y recursos guardados) y cambios `flagship.<id>`.
- **Salto cuántico**: es la orden `emperor.move` de siempre (tiempo de viaje, evento `emperor.arrive`, descubrimiento), ahora con coste de combustible por año luz (`quantumFuelCost`; error `insufficient_fuel`), así que el depósito marca el alcance (unos 133 a.l., unos 40 min). Antes de la orden, el servidor guarda el combustible que la nave llevaba en memoria; después lo vuelve a leer. En el cliente: selector de destinos (J), alineación y carga (5 s, sonido generativo en `audio/quantumSfx.ts`) en `SystemView`, y vista del túnel (`TunnelView`) con el tiempo restante; M alterna túnel y mapa.
- `PROTOCOL_VERSION` = 8.

### Implementado: tipos de nave, Carroñeros por peligro y modelos procedurales (21-10-2026)

- **Datos** (`packages/content`): 12 clases humanas (`SHIP_CLASSES`: explorador, caza ligero, interceptor, corbeta, fragata, destructor, crucero, portanaves, carguero, carguero pesado, transporte de tropas, colonizador) con `cost.alloys`, `requires` (instalaciones de la colonia: astillero, refinería, `drydock`), `battleShots`, `battleProfile`, `combat` y `model` (`ShipModelHints`: eslora, forma del casco, motores, alas, torretas, contenedores, hangar, anillo, antena). Instalación nueva **`drydock`** (dique orbital; `InstallationDefinition.requires`, comprobado con `missingInstallations` de `packages/sim` economy.ts; error `needs_installation`). Carroñeros: seis naves (`scav_skiff`, `scav_raider`, `scav_harpoon`, `scav_bomber`, `scav_breaker`, `scav_mothership`) con `flight` (vuelo en tiempo real); `SCAVENGER_DANGER` (piratas del espacio local por anillo: probabilidad, número, naves, jefe y puntería) y `PIRATE_AI` (sustituyen a `PIRATE_RAIDER`); su doctrina de flota tiene `deepComposition` (`fleetComposition` interpola según la profundidad; la usa `AlienService.spawnFleet`).
- **Bocas de fuego como datos**: `shipHardpoints(model, weapons)` (`shipModels.ts`, con `HULL_PROPORTIONS`) las deriva del modelo y `withHardpoints` las pone en `combat.hardpoints` de cada clase humana y alienígena. El servidor dispara desde ellas; el cliente dibuja los cañones y lanzadores en el mismo sitio. `ShipState.classId` y el error `needs_installation`: `PROTOCOL_VERSION` = 10 (la 9b usó el 9).
- **Combate por rondas** (`packages/sim/src/battle.ts`): el ataque se reparte entre `battleShots` disparos y cada uno elige blanco con probabilidad proporcional a `battleProfileOf` (de la ficha o según la eslora). Con todos los perfiles iguales y un disparo, el resultado es el de antes (misma semilla). Equilibrio comprobado en `packages/sim/test/balance.test.ts`.
- **Piratas del espacio local** (`apps/server/src/space/pirates.ts`): `piratesOf(systemId)` elige clase y puntería por anillo (determinista); cada uno vuela según su clase (los bombarderos se alejan si se les acercan), dispara cañón y misiles, y tiene radio de impacto según su eslora. `ShipState.classId` dice al cliente qué modelo dibujar.
- **Cliente**: `engine/shipFactory.ts` (generador paramétrico: casco por forma, estilo por facción —humano o la silueta de la especie con sus colores—, motores con llama, alas, torretas, contenedores, hangar; piezas fusionadas por material y caché por clase; THREE.LOD a 30 y 160 esloras), usado en `RemoteShips` (piratas), `FleetScene` (flotas propias paradas en formación junto a la colonia y **batallas por rondas en 3D** con trazas desde las bocas de fuego y explosiones según las pérdidas; botón «Ver la batalla en 3D» del panel Batallas, `Engine.showBattle`) y miniaturas de la interfaz (`shipThumbnails.ts`, `ShipThumb`: construcción y flotas).

### Implementado (Fase 11): especies alienígenas, territorios e IA

- **Datos** (`packages/content`): cada especie (`species.ts`) lleva filosofía y actitud (claves i18n), `territory` (anillo mínimo, peso de región, parte de los sistemas, densidad preferida), `fleet` (estilo, composición, naves por flota y flotas por región, de cerca a lejos) y `ai` (patrulla, respuesta a intrusos `attack`/`guard`/`ignore`, flotas que responden, expansión por día, si comercia, rencor por colonia); cada facción, `regionShare`. Naves alienígenas en `aliens.ts` (`ALIEN_SHIP_CLASSES`, dos por especie más el centinela precursor; stats del combate por rondas, `combat` del tiempo real y `model` para el modelo procedural: eslora, forma del casco y motores; la silueta y los colores son los de `SpeciesDefinition.visual`). `getAnyShipClass`/`anyFleetSpeedLyPerHour` buscan naves humanas y alienígenas (los usan `battle.ts`, `FleetService` y los escáneres). Parámetros comunes en `ALIEN_AI`; Emperadores de la IA en `aiEmperors.ts`.
- **Territorio** (`packages/procgen/src/territory.ts`, capa nueva; **no cambia `GENERATOR_VERSION`** porque no altera estrellas, planetas ni anomalías): regiones cúbicas de `ALIEN_AI.regionSizeSectors` sectores, cada una de una especie o de nadie (pesos según el anillo —distancia de Chebyshev en sectores al origen— y la densidad de la región); dentro, cada sistema es de la especie con probabilidad `systemShare` (un tercio si la estrella no es de las preferidas). Nunca en los anillos 0–1 (Núcleo Humano). Ruinas precursoras aparte. El servidor usa una **semilla secreta** `HMAC-SHA256(DETAIL_SEED, "territory:v1")` (`ai/territory.ts`): el cliente no puede calcular el territorio. La expansión se guarda en `alien_claims` y manda sobre la capa base.
- **Actores**: cada facción tiene una fila en `emperors` con `kind = 'alien'`, `faction_id` y sin cuenta (`account_id` es nullable; restricción `emperors_kind`). Sus flotas son flotas normales (`fleets`/`ships`, más `alien_fleets` con su región), así que viajan con `FleetService.moveTx`, combaten con `WarService` y venden con `MarketService.place`. No salen en la lista de Emperadores, no descubren nada y no reciben avisos.
- **IA sin bucles por tick** (`ai/service.ts`, `AlienService`): una región **despierta** cuando una flota (evento `fleet.arrive`) o la nave de un Emperador (`emperor.arrive`) llega a un sistema suyo: se crea `alien_regions` con su guarnición (cerca del intruso) y un evento `ai.region` que decide cada `ALIEN_AI.tickGameMinutes`: refuerzos (una flota cada `reinforceHours` hasta la guarnición), patrullas dentro del territorio, expansión lenta (un sistema libre cercano de la región, sin colonias) y comercio (Nómadas). Tras `activeHours` sin humanos, se duerme (`ticking = false`). Si la facción es hostil al intruso y responde atacando, envía hasta `responders` flotas cercanas según su agresividad; **gracia** para Emperadores con menos de `noviceGraceHours`.
- **Hostilidad** (`WarService.setAlienHooks` → `AlienService.hostile`): entre Emperadores, como antes (salvo los de la IA en el Núcleo, que no pelean allí); entre facciones, nunca; facción contra Emperador: hostil si su relación es `hostile` o si el **rencor** (`alien_standings`, decae `decayPerDay`) llega a `hostileAt`; nunca en el Núcleo Humano. Interceptar una flota alienígena (`fleet.intercept`) y colonizar su territorio suman rencor; la orden `alien.tribute { factionId, credits }` lo borra pagando créditos (las que nunca pactan lo rechazan: `no_diplomacy`).
- **Comercio**: los Nómadas crean la primera vez un **hábitat** (colonia sin población en un planeta libre de su territorio) y una cartera (`traderStartingCredits`, sin renta ni aporte al tesoro); reponen existencias (`ai_production` en el libro) y ponen órdenes cerca del último precio. Sus carteras y su hábitat no cuentan en los agregados de la humanidad.
- **Emperadores humanos de la IA** (`ai/emperors.ts`, `AiEmperorService`): filas `kind = 'ai'` sin cuenta y públicas, creadas al arrancar (`AI_EMPERORS`, por defecto 3; 0 con `APP_ENV=test`) como un jugador nuevo en el Núcleo. Evento `ai.emperor` cada hora de juego; la decisión se ejecuta tras confirmar el evento con las órdenes de un jugador (`ColonyService.claim/build`, `FleetService.move`, `MarketService.place`), cada una en su transacción y solo con lo descubierto.
- **API**: `GET /api/aliens` (territorio de los sistemas descubiertos, ruinas, relaciones), `GET /api/systems/:id/aliens` (presencia en un sistema descubierto; flotas solo si los sensores lo cubren, `WarService.sensors`), `sightings` en `GET /api/contacts`, `factionId` en contactos, `enemyFactionId` en batallas, `ownerFactionId` en planetas y `ai` en los Emperadores. `PROTOCOL_VERSION` = 7. Migración `0012`. `alien_standings` va en la exportación de datos y se borra en cascada.
- **Pendiente**: combate pilotado contra las naves alienígenas (sus modelos 3D ya están), ataques alienígenas a Cunas (los ataques a colonias se hicieron con la 9b), pactos de los Grises y protección de los Custodios, guerra y compañeros de los Emperadores de la IA, gobernadores de jugadores ausentes, y separar la IA en el proceso `apps/ai` cuando haga falta escalar.

## 9. Autenticación por enlace mágico

- El usuario introduce su correo; se genera un **token aleatorio de 32 bytes**.
- En la base de datos **solo se guarda su hash SHA-256**.
- Validez de **15 minutos**, **uso único**.
- Al canjearlo se crea una sesión en **cookie `HttpOnly`, `Secure`, `SameSite=Lax`**.
- Para el WebSocket, el cliente pide por HTTP un **ticket corto** de un solo uso que presenta al conectar.
- `MAIL_TRANSPORT=console` imprime el enlace en el registro: **solo en desarrollo**; el servidor se niega a arrancar con ese valor en producción.
- `MAIL_TRANSPORT=smtp` envía el correo (texto + HTML, en el idioma del jugador) por el SMTP de un proveedor transaccional con nodemailer (`SmtpMailer` en `apps/server/src/mail.ts`): TLS obligatorio, tiempos de espera acotados y comprobación de la conexión al arrancar. Si el envío falla se registra (correo enmascarado) y la respuesta es la misma de siempre. `MAIL_LOG_LINKS=true` escribe además el enlace en el registro (solo fuera de producción). Ver «Correo real» en `docs/despliegue.md`.

## 10. Modelo de datos (tablas previstas)

- `accounts`, `sessions`, `magic_link_tokens`, `ws_tickets`
- `organizations`, `organization_members`
- `emperors`, `heirs`, `lineage_cradles`
- `sectors_touched` (solo sectores con cambios), `sector_leases`
- `colonies`, `installations`, `colony_builds` (hechas en la Fase 7; las existencias van en la propia colonia)
- `fleets`, `ships`
- `resource_ledger` (con `credits` desde la economía de la humanidad)
- `emperor_wallets`, `humanity_treasury`, `humanity_projects`, `humanity_contributions`, `market_orders`, `market_trades`, `shipments` (economía de la humanidad y mercado, hechas)
- `scheduled_events`
- `processed_commands`
- `battles`, `battle_sides`, `battle_rounds` (hechas en la Fase 9a); `sieges` (hecha en la 9b)
- `discoveries`, `discovery_shares`
- `emperors.kind`/`faction_id` (actores de la IA: facciones alienígenas y Emperadores IA), `alien_claims`, `alien_regions`, `alien_fleets`, `alien_standings` (hechas en la Fase 11); gobernadores, más adelante
- `translations`, `translation_votes`

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Carga del servidor con cientos de jugadores | Resolución perezosa, N3 sin coste, un escritor por sector. |
| Inconsistencias por concurrencia | `SKIP LOCKED`, arrendamientos, transacciones cortas, idempotencia. |
| Abuso de tráfico saliente | Estáticos en Cloudflare R2, límites de tasa, vigilante de tráfico (ver despliegue). |
| Trampas desde el cliente | Servidor autoritativo; el cliente solo envía órdenes. |
| Crecimiento de la base de datos | Solo se guarda lo que cambia; compactación del libro a largo plazo. |
| IA demasiado costosa | Procesos separados (`apps/ai`), decisiones espaciadas en el tiempo. |
| Correo marcado como spam | SPF, DKIM y dominio propio. |
