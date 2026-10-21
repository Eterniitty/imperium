/**
 * Protocolo del WebSocket (`/ws`). Mensajes JSON con el campo `t` (tipo); ver
 * docs/arquitectura.md §8. Los esquemas Zod de lo que envía el cliente están en
 * `schemas.ts`.
 */
import type { Battle, Cargo, Colony, Emperor, EmperorHumans, FlagshipStatus, Fleet, FleetRoute, OrderSide, Siege, Stock, StockId, Wallet } from "./api";

/** Sube si cambia el protocolo de forma incompatible; el servidor rechaza versiones distintas. */
export const PROTOCOL_VERSION = 10;

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
  me: { fleets: Fleet[]; discovered: string[]; colonies: Colony[]; humans: EmperorHumans; battles: Battle[]; wallet: Wallet; flagship: FlagshipStatus | null; sieges: Siege[] };
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
  "emperor.move": { systemId: string };
  "fleet.move": { fleetId: string; systemId: string };
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
  "colony.build": { colonyId: string; kind: "installation" | "ship"; itemId: string };
  /** Cancela un encargo: se devuelve todo si aún no había empezado, la mitad si estaba en construcción. */
  "colony.cancel": { colonyId: string; buildId: string };
  /** Desembarca humanos de la nave del Emperador (presente en el sistema) en una colonia propia. */
  "colony.disembark": { colonyId: string; humans: number };
  /** Carga o descarga recursos y pasajeros entre una flota y una colonia propia del mismo sistema. */
  "fleet.transfer": { fleetId: string; colonyId: string; direction: "load" | "unload"; amounts: Partial<Cargo> };
  /** Pone a una flota en una ruta de transporte automática entre dos colonias propias. */
  "fleet.route": FleetRoute & { fleetId: string };
  /** Quita la ruta automática de una flota (se queda donde esté). */
  "fleet.routeStop": { fleetId: string };
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
}
export type CommandOp = keyof CommandArgs;

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
  /** Nave de un Emperador o pirata de la IA (su nombre se traduce en el cliente). */
  kind: "emperor" | "pirate";
  /**
   * Clase de nave de `@imperium/content` (las de la IA: p. ej. `scav_raider`),
   * para dibujar su modelo y su nombre. Sin ella, la nave de un Emperador.
   */
  classId?: string;
  name: string;
  /** Compañero del jugador que la recibe (no se le puede disparar). */
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
  | ({ t: "pose"; systemId: string } & ShipPose)
  /** Deja de pilotar en el sistema (vuelve al mapa o sale al espacio interestelar). */
  | { t: "leave" }
  /**
   * Disparo. Cañón: en la dirección `dir` (vector unitario). Misil: hacia la nave
   * `target` (fijada), que tiene que estar a tiro y delante.
   */
  | { t: "fire"; weapon: WeaponKind; dir: Vec3; target?: string };

/** Tipos de arma (los mismos que en `@imperium/content`). */
export type WeaponKind = "cannon" | "missile";

/** Motivos por los que se rechaza una orden; el cliente los traduce con `error.*`. */
export type CommandError =
  | "invalid_command"
  | "insufficient_credits"
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
  | "cargo_full"
  | "storage_full"
  | "nothing_to_transfer"
  | "invalid_route"
  | "in_battle"
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
  | { path: `sieges.${string}`; v: Siege | null };

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
  | { t: "shipGone"; id: string; reason: "left" | "destroyed" }
  /**
   * Alguien disparó (para dibujarlo). `hitAt` es la hora del servidor del impacto,
   * si lo hay; el daño llega aparte, con el nuevo estado de la nave (`ship`).
   */
  | { t: "shot"; id: string; weapon: WeaponKind; from: Vec3; muzzle: number; dir: Vec3; target: string | null; speed: number; range: number; serverTime: number; hitAt: number | null }
  /** Tu nave ha sido destruida: renaces en `systemId` (Núcleo Humano). */
  | { t: "destroyed"; by: string; systemId: string }
  /** Estado de tus armas: munición restante y cuándo vuelven a estar listas (hora del servidor). */
  | { t: "weapons"; weapons: Array<{ kind: WeaponKind; ammo: number | null; ammoMax: number | null; readyAt: number }> }
  /**
   * Energía y combustible de tu nave mientras la pilotas (unas dos veces por segundo
   * si cambian). `resupplying`: junto a una colonia propia, reponiendo.
   */
  | { t: "supplies"; energy: number; energyMax: number; fuel: number; fuelMax: number; resupplying: boolean }
  /** El servidor rechaza una posición imposible (demasiado rápida, fuera del sistema): la nave vuelve aquí. */
  | ({ t: "poseRejected" } & ShipPose)
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
