/**
 * Protocolo del WebSocket (`/ws`). Mensajes JSON con el campo `t` (tipo); ver
 * docs/arquitectura.md §8. Los esquemas Zod de lo que envía el cliente están en
 * `schemas.ts`.
 */
import type { Battle, Cargo, Colony, Emperor, EmperorHumans, FlagshipStatus, Fleet, FleetRoute, FleetTactic, Probe, HeirDoctrineId, LineageStatus, OrderSide, Siege, Stock, StockId, Wallet } from "./api";
import type { DeepRegionView } from "./deepspace";

/** Sube si cambia el protocolo de forma incompatible; el servidor rechaza versiones distintas. */
// 13: espacio profundo y minería (rama `espacio-profundo`; `emperor.drop`, `flagship.*`, `mine`, `field`, `hold`…).
// 14: fusión con `vuelo-y-salto` (`rift`, `shipGone.reason: "jump"`).
// 15: salto junto a un compañero (`emperor.move.near`; rama `salto-autonomo`).
export const PROTOCOL_VERSION = 15;

/** Causa de muerte (`destroyed.by`, `LineageDeath.by`) cuando la nave se estrella contra un cuerpo y no la derriba nadie. */
export const IMPACT_CAUSE = "@impact";
/** Causa de muerte por el calor de una estrella. */
export const HEAT_CAUSE = "@heat";
/** Causa de muerte al cruzar el horizonte de sucesos de un agujero negro. */
export const HORIZON_CAUSE = "@horizon";
/** Causa de muerte: iba acoplado en una nave nodriza que cayó en batalla. */
export const MOTHERSHIP_CAUSE = "@mothership";

/** Tamaño máximo de un mensaje del cliente, en bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;

/**
 * Temas de suscripción:
 * - emperors: todos los Emperadores (público).
 * - me: lo privado del jugador (sus flotas, los sistemas que ha descubierto, sus colonias, sus humanos y sus batallas).
 */
export type Topic = "emperors" | "me";

/** Contenido de la instantánea de cada tema. */
export interface TopicData {
  emperors: { emperors: EmperorView[] };
  /** `discovered`: ids de los sistemas descubiertos (niebla de guerra); solo de ellos se puede pedir el detalle. */
  /** `battles`: las batallas en curso y las acabadas hace poco. */
  /** `wallet`: la cartera de créditos (economía de la humanidad). */
  /** `sieges`: asedios propios y a colonias propias (Fase 9b), en curso y acabados hace poco. */
  /** `lineage`: muerte, gestación, Cunas y Herederos (Fase 10). */
  me: { fleets: Fleet[]; discovered: string[]; colonies: Colony[]; humans: EmperorHumans; battles: Battle[]; wallet: Wallet; flagship: FlagshipStatus | null; sieges: Siege[]; lineage: LineageStatus | null; probes: Probe[] };
}

/** Emperador visto por los demás jugadores: añade si está conectado. */
export interface EmperorView extends Emperor {
  online: boolean;
}

/** Órdenes que el cliente puede dar. */
export interface CommandArgs {
  /**
   * Mercado global: orden de compra o venta de `quantity` unidades a `price`
   * créditos cada una. Una venta retiene los recursos de `colonyId`; una compra,
   * los créditos, y lo comprado se envía a `colonyId`.
   */
  "market.order": { resource: StockId; side: OrderSide; price: number; quantity: number; colonyId: string };
  /** Cancela una orden propia: se devuelve lo retenido que quede. */
  "market.cancel": { orderId: string };
  /**
   * Aporta a un proyecto común de la humanidad: recursos que salen de
   * `colonyId` hacia el Núcleo y/o créditos de la cartera al tesoro.
   */
  "humanity.contribute": { projectId: string; colonyId?: string; amounts?: Partial<Stock>; credits?: number };
  /** `near`: Emperador compañero junto al que se quiere llegar (su posición actual o la última conocida en el destino). */
  "emperor.move": { systemId: string; near?: string };
  /**
   * Sale del túnel cuántico a mitad de viaje: la nave queda en la región de
   * espacio profundo de su posición (se gasta solo el combustible recorrido).
   */
  "emperor.drop": Record<string, never>;
  /** Descarga la bodega de la nave en una colonia propia del sistema donde está (lo que quepa). */
  "flagship.unload": { colonyId: string };
  /** Enciende o apaga la refinería de a bordo (volátiles de la bodega → combustible, despacio). */
  "flagship.refine": { on: boolean };
  /** Tira por la borda todo un recurso de la bodega (para hacer sitio). */
  "flagship.jettison": { resource: StockId };
  "fleet.move": { fleetId: string; systemId: string };
  /** Llena los depósitos de las naves con volátiles de una colonia propia del sistema. */
  "fleet.refuel": { fleetId: string };
  /**
   * Reclama un planeta libre de un sistema descubierto. Sin `fleetId`, desembarca
   * `humans` de la nave del Emperador, que tiene que estar allí (no de viaje);
   * con `fleetId`, desembarcan los colonos de un colonizador de esa flota (que
   * se consume).
   */
  "colony.claim": { systemId: string; planetIndex: number; humans?: number; fleetId?: string };
  /** Renombra un planeta propio. */
  "colony.rename": { colonyId: string; name: string };
  /** Encarga una instalación o una nave (en el astillero); se paga al encargarla. */
  "colony.build": { colonyId: string; kind: "installation" | "ship" | "design" | "craft"; itemId: string };
  /** Cancela un encargo: se devuelve todo si aún no había empezado, la mitad si estaba en construcción. */
  "colony.cancel": { colonyId: string; buildId: string };
  /** Derriba una instalación de una colonia propia (la más reciente de ese tipo): devuelve `ECONOMY.demolishRefund` de su coste. */
  "colony.demolish": { colonyId: string; installationId: string };
  /** Desembarca humanos de la nave del Emperador (presente en el sistema) en una colonia propia. */
  "colony.disembark": { colonyId: string; humans: number };
  /** Embarca humanos de una colonia propia en la nave del Emperador (presente en el sistema), sin pasar de su capacidad y dejando `HUMANS.colonyKeep`. */
  "colony.embark": { colonyId: string; humans: number };
  /** Carga o descarga recursos y pasajeros entre una flota y una colonia propia del mismo sistema. */
  "fleet.transfer": { fleetId: string; colonyId: string; direction: "load" | "unload"; amounts: Partial<Cargo> };
  /** Cargar o descargar componentes fabricados (`COMPONENT_IDS` → unidades). */
  "fleet.items": { fleetId: string; colonyId: string; direction: "load" | "unload"; items: Record<string, number> };
  /** Pone a una flota en una ruta de transporte automática entre dos colonias propias. */
  "fleet.route": FleetRoute & { fleetId: string };
  /** Quita la ruta automática de una flota (se queda donde esté). */
  "fleet.routeStop": { fleetId: string };
  /**
   * Orden a las escoltas de la nave del Emperador que se pilota: seguir (y
   * defender), atacar el blanco fijado, mantener la posición o replegarse sin combatir.
   */
  "escort.order": { order: EscortOrder; targetId?: string };
  /** Escolta en crucero: las escoltas acompañan con el pulso (true) o esperan (false). */
  "escort.cruise": { on: boolean };
  /** Acopla la nave del Emperador (pilotada, cerca) en la nave nodriza de una flota propia parada en el mismo sistema. */
  "flagship.dock": { fleetId: string };
  /** Desacopla la nave del Emperador de su nave nodriza. */
  "flagship.undock": Record<string, never>;
  /** Pide ayuda mientras pilota (`HELP_CALL`): avisa a los compañeros conectados y, cerca del Núcleo, acude la milicia. */
  "help.call": Record<string, never>;
  /** Activa o desactiva el fuego amigo propio: desactivado (por defecto), tus disparos y choques no dañan a tus compañeros. */
  "emperor.friendlyFire": { on: boolean };
  /** Activa o desactiva la autogestión de las colonias propias por la IA (instalaciones, nunca naves; no en las que gobierna un Heredero). */
  "colony.autoGovern": { on: boolean };
  /** Lanza una sonda de exploración a un sistema sin descubrir (`PROBE`: cuesta créditos y tiene alcance). */
  "probe.launch": { systemId: string };
  /** Contrata mercenarios (`MERCENARIES`): aparecen como flota propia donde está la nave del Emperador, hasta que acaba el contrato. */
  "mercenary.hire": { offerId: string };
  /** Pilota a distancia una nave de una flota propia parada (ni viajando ni en batalla); `leave` deja de pilotarla. */
  "fleet.pilot": { fleetId: string; shipId: string };
  /** Cambia la táctica de una flota propia en las batallas por rondas (desde cualquier sitio; en plena batalla vale desde la ronda siguiente). */
  "fleet.tactic": { fleetId: string; tactic: FleetTactic };
  /** Renombrar una flota propia (vacío: vuelve a «Flota N»). */
  "fleet.rename": { fleetId: string; name: string };
  /**
   * Intercepta una flota enemiga visible en tránsito: la flota propia viaja al
   * destino de la otra y combaten allí al coincidir.
   */
  "fleet.intercept": { fleetId: string; targetFleetId: string };
  /** Fase 11: tributo a una facción alienígena para borrar su rencor (diplomacia básica). */
  "alien.tribute": { factionId: string; credits: number };
  /**
   * Fase 9b: asedia una colonia ajena del sistema donde hay una flota armada
   * propia parada (y ningún defensor armado).
   */
  "siege.start": { colonyId: string };
  /** Levanta un asedio propio (las flotas se quedan donde están). */
  "siege.lift": { siegeId: string };
  /**
   * Desembarca tropas en un planeta con el asedio completo. Con `fleetId`,
   * los humanos de esa flota (pasajeros y colonos); sin ella, los de la nave
   * del Emperador, que tiene que estar en el sistema. `troops` limita cuántos
   * (por defecto, todos).
   */
  "siege.assault": { siegeId: string; fleetId?: string; troops?: number };
  /** Bombardeo orbital: con el asedio listo, destruye una instalación de la colonia sin tomarla (`SIEGE.razeProgressAfter`). */
  "siege.raze": { siegeId: string; installationId: string };
  /** Fase 10: Cuna preferida para renacer (una colonia propia con Cuna), o null para la más cercana. */
  "lineage.prefer": { colonyId: string | null };
  /** Fase 10: gesta un Heredero en la Cuna de una colonia propia (sin otro Heredero), con su doctrina. */
  "heir.gestate": { colonyId: string; doctrine: HeirDoctrineId };
  /** Cambia la doctrina de un Heredero y si su gobernador encarga instalaciones. */
  "heir.doctrine": { heirId: string; doctrine: HeirDoctrineId; builds: boolean };
  /** Lleva a un Heredero nacido a gobernar otra colonia propia (sin Heredero). */
  "heir.assign": { heirId: string; colonyId: string };
  /**
   * El Emperador se encarna en un Heredero nacido: despierta en su colonia (con
   * su nave) y el Heredero se consume. Estando muerto, en vez de esperar la gestación.
   */
  "heir.incarnate": { heirId: string };
  /** Comandante: el Heredero manda una flota propia (null: deja de mandarla). */
  "heir.command": { heirId: string; fleetId: string | null };
}
export type CommandOp = keyof CommandArgs;

/** Órdenes a las escoltas (Fase 9d, `docs/ia-naves.md` §5). */
export type EscortOrder = "follow" | "attack" | "hold" | "recall";

// --- Espacio local: naves volando dentro de un sistema (tiempo real) ---

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Posición (unidades de sistema), orientación y velocidad (u/s) de una nave. */
export interface ShipPose {
  p: Vec3;
  q: Quat;
  v: Vec3;
}

/**
 * Nave visible en el sistema. Dentro de un mismo sistema los sensores detectan
 * a todos los presentes, sea cual sea su visibilidad en el mapa galáctico.
 */
export interface ShipState extends ShipPose {
  /** Id del Emperador (o de la nave de la IA). */
  id: string;
  /** Nave de un Emperador, pirata de la IA o nave de una flota pilotada a distancia (su nombre se traduce en el cliente). */
  kind: "emperor" | "pirate" | "fleet";
  /**
   * Clase de nave de `@imperium/content` (las de la IA: p. ej. `scav_raider`),
   * para dibujar su modelo y su nombre. Sin ella, la nave de un Emperador.
   */
  classId?: string;
  name: string;
  /** Compañero del jugador que la recibe (se dibuja distinto; con fuego amigo, también se le puede dañar). */
  ally: boolean;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
}

export type ClientMessage =
  | { [Op in CommandOp]: { t: "cmd"; cmdId: string; op: Op; args: CommandArgs[Op] } }[CommandOp]
  | { t: "sub"; topic: Topic }
  /** Pilotando dentro de `systemId`: posición actual (unas 8 veces por segundo). */
  | ({ t: "pose"; systemId: string; /** Motores encendidos (se guarda al aparcar la nave). */ e?: boolean } & ShipPose)
  /** Deja de pilotar en el sistema (vuelve al mapa o sale al espacio interestelar). */
  | { t: "leave" }
  /**
   * Disparo. Cañón: en la dirección `dir` (vector unitario), dentro del cono de
   * los montajes alrededor del morro (`AIM_ASSIST.cannonGimbalDeg`; la puntería
   * automática apunta al punto de adelanto del blanco fijado). Misil: hacia la
   * nave `target` (fijada; cualquiera salvo la propia: hay fuego amigo), que
   * tiene que estar a tiro y delante.
   */
  | { t: "fire"; weapon: WeaponKind; dir: Vec3; target?: string }
  /**
   * Láser de minería (espacio profundo): mientras se mantiene, unas dos veces por
   * segundo con el asteroide apuntado; `null` al soltarlo.
   */
  | { t: "mine"; asteroid: number | null }
  /**
   * Grieta del salto cuántico (solo visual; la ven los demás del sistema): se
   * abre al cargar el motor (`charge`), se cierra si se cancela (`cancel`) y se
   * abre otra al llegar al destino (`arrive`). `at`: centro de la grieta (cerca
   * de la nave); `q`: su orientación (la de la nave, mirando al destino).
   */
  | { t: "rift"; phase: RiftPhase; at: Vec3; q: Quat };

/** Fases de la grieta del salto que anuncia el piloto. */
export type RiftPhase = "charge" | "cancel" | "arrive";

/** Tipos de arma (los mismos que en `@imperium/content`). */
export type WeaponKind = "cannon" | "missile";

/** Motivos por los que se rechaza una orden; el cliente los traduce con `error.*`. */
export type CommandError =
  | "invalid_command"
  | "insufficient_credits"
  | "unknown_design"
  | "no_fuel_fleet"
  | "insufficient_components"
  | "research_busy"
  | "max_level"
  | "tech_locked"
  | "no_colony_here"
  | "design_not_buildable"
  | "invalid_order"
  | "too_many_orders"
  | "no_order"
  | "unknown_project"
  | "project_complete"
  | "exceeds_need"
  | "unknown_system"
  | "in_transit"
  | "already_there"
  | "no_emperor"
  | "no_fleet"
  | "not_discovered"
  | "unknown_planet"
  | "planet_owned"
  | "not_present"
  /** No está de viaje (salir del túnel). */
  | "not_travelling"
  /** La bodega de la nave está vacía (nada que descargar). */
  | "hold_empty"
  /** En el espacio profundo no hay colonias (descargar, reponer). */
  | "in_deep_space"
  | "not_enough_humans"
  | "no_colonizer"
  | "no_colony"
  | "invalid_name"
  | "unknown_item"
  | "insufficient_resources"
  | "needs_shipyard"
  /** Falta otra instalación que pide la nave o la instalación (refinería, dique orbital…). */
  | "needs_installation"
  | "limit_reached"
  | "queue_full"
  | "no_build"
  | "colony_full"
  /** La nave del Emperador no tiene sitio para tantos humanos. */
  | "flagship_full"
  /** Embarcar dejaría la colonia por debajo de la población mínima (`HUMANS.colonyKeep`). */
  | "colony_keep"
  | "cargo_full"
  | "storage_full"
  | "nothing_to_transfer"
  | "invalid_route"
  | "in_battle"
  /** La nave no tiene armas (no se puede pilotar a distancia). */
  | "ship_unarmed"
  /** Sonda: el destino está demasiado lejos de la nave y de todas las colonias. */
  | "out_of_range"
  /** Sonda: el sistema ya está descubierto. */
  | "already_discovered"
  /** Acople: la flota no tiene nave nodriza. */
  | "no_mothership"
  /** Acople: la nave está demasiado lejos de la flota (o no se está pilotando). */
  | "too_far"
  | "no_target"
  | "unknown_faction"
  | "no_diplomacy"
  | "insufficient_fuel"
  | "own_colony"
  | "protected"
  | "already_besieged"
  | "defended"
  | "no_armed_fleet"
  | "no_siege"
  | "siege_not_ready"
  | "no_troops"
  | "dead"
  | "no_cradle"
  | "heir_limit"
  | "colony_has_heir"
  | "no_heir"
  | "heir_not_ready"
  | "cooldown"
  | "in_combat"
  | "rate_limited"
  | "internal";

/** Cambio sobre un tema: `v` es el nuevo valor, o null si desaparece. */
export type DeltaOp =
  | { path: `emperors.${string}`; v: EmperorView | null }
  | { path: `fleets.${string}`; v: Fleet | null }
  /** Sistema recién descubierto (nunca se olvida, así que siempre es `true`). */
  | { path: `discovered.${string}`; v: true }
  /** Colonia propia: nueva, cambiada o perdida (null). */
  | { path: `colonies.${string}`; v: Colony | null }
  /** Humanos de la nave del Emperador (el id es el del Emperador propio). */
  | { path: `humans.${string}`; v: EmperorHumans }
  /** Cartera de créditos del Emperador propio (el id es el suyo). */
  | { path: `wallet.${string}`; v: Wallet }
  /** Batalla propia: empieza, avanza una ronda o termina (null si deja de mostrarse). */
  | { path: `battles.${string}`; v: Battle | null }
  /** La nave del Emperador propio: dónde está aparcada (y, más adelante, sus recursos). */
  | { path: `flagship.${string}`; v: FlagshipStatus }

  /** Asedio propio o a una colonia propia: empieza, avanza o termina (null si deja de mostrarse). */
  | { path: `sieges.${string}`; v: Siege | null }
  /** Linaje del Emperador propio (Fase 10): muerte y gestación, Cunas, Herederos (el id es el suyo). */
  | { path: `lineage.${string}`; v: LineageStatus }
  | { path: `probes.${string}`; v: Probe | null };

export type ServerMessage =
  /**
   * Primer mensaje tras conectar: quién eres, la hora del servidor (para corregir
   * el reloj local) y la escala de tiempo del juego (para estimar duraciones).
   */
  | { t: "hello"; protocol: number; emperorId: string; serverTime: number; timeScale: number }
  /** Estado completo de un tema. `seq` numera los mensajes del tema. */
  | { [K in Topic]: { t: "snap"; topic: K; seq: number; serverTime: number; data: TopicData[K] } }[Topic]
  /** Cambios incrementales. Si `seq` no es el siguiente al último recibido, se perdió algo: pide otra `snap`. */
  | { t: "delta"; topic: Topic; seq: number; serverTime: number; ops: DeltaOp[] }
  /** Al entrar pilotando en un sistema: las demás naves presentes. */
  | { t: "space"; systemId: string; serverTime: number; ships: ShipState[] }
  /** Posiciones recientes de las naves del sistema (unas 10 veces por segundo). */
  | { t: "poses"; serverTime: number; ships: Array<{ id: string } & ShipPose> }
  /** Una nave entra en el sistema o cambia su estado (casco, escudo). */
  | { t: "ship"; ship: ShipState }
  /** Una nave deja el sistema. */
  /** `jump`: entró en la grieta de su salto cuántico (el cliente la dibuja entrando). */
  | { t: "shipGone"; id: string; reason: "left" | "destroyed" | "jump" }
  /** Grieta del salto cuántico de otra nave del sistema (ver el mensaje `rift` del cliente). */
  | { t: "rift"; id: string; phase: RiftPhase; at: Vec3; q: Quat; serverTime: number }
  /**
   * Alguien disparó (para dibujarlo). `hitAt` es la hora del servidor del impacto,
   * si lo hay; el daño llega aparte, con el nuevo estado de la nave (`ship`).
   */
  | { t: "shot"; id: string; weapon: WeaponKind; from: Vec3; muzzle: number; dir: Vec3; target: string | null; speed: number; range: number; serverTime: number; hitAt: number | null }
  /**
   * Tu nave ha sido destruida y tu Emperador ha caído (Fase 10): su cuerpo nuevo se
   * gesta hasta `rebornAt` (hora del servidor) en `systemId` (una Cuna o el Núcleo Humano).
   */
  | { t: "destroyed"; by: string; systemId: string; rebornAt: number }
  /** Se acabó el pilotaje a distancia de una nave de flota (`fleet.pilot`): la destruyeron o ya no se puede pilotar. */
  | { t: "remoteEnded"; reason: "destroyed" | "left" }
  /** La nave del Emperador se ha desacoplado sola de su nave nodriza (la flota se fue o la nave se alejó). */
  | { t: "undocked" }
  /** Un compañero pide ayuda (`help.call`) en un sistema: se puede saltar junto a él (`emperor.move` con `near`). */
  | { t: "helpCall"; from: string; name: string; systemId: string; serverTime: number }
  /** Llegó de un viaje acoplado: sigue en el hangar de la nodriza de esta flota. */
  | { t: "docked"; fleetId: string }
  /** Estado de tus armas: munición restante y cuándo vuelven a estar listas (hora del servidor). */
  | { t: "weapons"; weapons: Array<{ kind: WeaponKind; ammo: number | null; ammoMax: number | null; readyAt: number }> }
  /**
   * Energía y combustible de tu nave mientras la pilotas (unas dos veces por segundo
   * si cambian). `resupplying`: junto a una colonia propia, reponiendo.
   */
  | { t: "supplies"; energy: number; energyMax: number; fuel: number; fuelMax: number; resupplying: boolean }
  /** El servidor rechaza una posición imposible (demasiado rápida, fuera del sistema): la nave vuelve aquí. */
  | ({ t: "poseRejected" } & ShipPose)
  /** Espacio profundo: contenido de la región donde se pilota (al subir a bordo). */
  | { t: "field"; region: DeepRegionView }
  /** Un asteroide de la región cambió (lo están minando): unidades que le quedan. */
  | { t: "asteroid"; i: number; left: number }
  /** Láser de minería de una nave de la región (para dibujarlo): el asteroide, o null si se apaga. */
  | { t: "beam"; id: string; asteroid: number | null }
  /** Tu bodega y tu refinería de a bordo (al minar, refinar o descargar). */
  | { t: "hold"; hold: Partial<Record<StockId, number>>; capacity: number; refining: boolean }
  /** Pulso de minería rechazado: fuera de alcance, asteroide agotado, bodega llena o sin energía. */
  | { t: "mineFail"; reason: "range" | "empty" | "full" | "energy" | "none" }
  | { t: "ack"; cmdId: string; ok: true }
  | { t: "ack"; cmdId: string; ok: false; error: CommandError };

/** Códigos de cierre propios del WebSocket (rango 4000-4999). */
export const WS_CLOSE = {
  /** Mensaje mal formado o versión incompatible: no reconectar sin recargar. */
  protocol: 4400,
  /** La sesión ya no es válida: hay que volver a identificarse. */
  unauthorized: 4401,
  /** Demasiados mensajes o conexiones. */
  rateLimited: 4429,
} as const;
