/**
 * Contrato de la API HTTP compartido entre cliente y servidor. Los esquemas Zod
 * de lo que entra en el servidor están en `schemas.ts`, aparte, para que el
 * cliente no cargue Zod.
 */
import type { WorldPosition } from "./coords";
import type { Locale } from "./i18n";
import type { StarSystemDetail } from "./types";

/** Respuesta de `GET /api/health`. */
export interface HealthResponse {
  ok: true;
  /** Versión del servidor: versión del paquete + commit, o "dev". */
  version: string;
  /** Versión del generador procedural con la que trabaja el servidor. */
  generatorVersion: number;
  uptimeSeconds: number;
}

/** Validez del enlace de acceso, en minutos. */
export const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Parámetro del fragmento de la URL del cliente (`/#login=...`) que lleva el
 * token del enlace de acceso. Va en el fragmento para que no llegue a ningún
 * servidor ni quede en sus registros.
 */
export const LOGIN_TOKEN_PARAM = "login";

/**
 * Versión de los términos de uso y la política de privacidad (fecha de las
 * páginas de `apps/client/public/legal/`). Al pedir un enlace hay que aceptarla;
 * la cuenta guarda cuál aceptó y cuándo. Súbela al cambiar esos textos.
 */
export const LEGAL_VERSION = "2026-10-22";

/** Páginas legales estáticas (servidas junto al cliente, sin iniciar sesión). */
export const LEGAL_PAGES = {
  es: { imprint: "/legal/aviso-legal.html", privacy: "/legal/privacidad.html", terms: "/legal/terminos.html" },
  en: { imprint: "/legal/imprint.html", privacy: "/legal/privacy.html", terms: "/legal/terms.html" },
} as const;

/** Cuenta tal y como la ve su propietario. */
export interface AuthAccount {
  id: string;
  email: string;
  locale: Locale;
}

/** Respuesta de `GET /api/auth/me` y `POST /api/auth/verify`. */
export interface AuthMeResponse {
  account: AuthAccount;
}

/** Respuesta de `POST /api/auth/peek`: a qué cuenta lleva un enlace, sin gastarlo. */
export interface AuthPeekResponse {
  /** Correo enmascarado, p. ej. "an***@ejemplo.com". */
  email: string;
}

/** Longitud mínima y máxima del nombre de un Emperador. */
export const EMPEROR_NAME_MIN = 3;
export const EMPEROR_NAME_MAX = 24;

/** Dónde está algo (un Emperador, una flota): el sistema estelar y su posición absoluta. */
export interface SystemLocation {
  systemId: string;
  systemName: string;
  position: WorldPosition;
}

/**
 * Viaje en curso. El origen es la `location` de quien viaja; las horas son
 * milisegundos desde 1970 según el reloj del servidor.
 */
export interface Travel {
  to: SystemLocation;
  departAt: number;
  arriveAt: number;
}

/**
 * Emperador. Es información pública: lo ven todos los jugadores (no lleva nada
 * de la cuenta). Mientras viaja, `location` es el sistema de origen.
 */
export interface Emperor {
  id: string;
  name: string;
  location: SystemLocation;
  travel: Travel | null;
  /** Emperador humano de la IA (Fase 11); ausente en los jugadores. */
  ai?: true;
  /** Fase 10: ha caído y su cuerpo nuevo se está gestando (su nave no está en ningún sitio). */
  gestating?: true;
  /** La IA gestiona sus colonias (orden `colony.autoGovern`). */
  autoGovern?: true;
  /** Fuego amigo activado: sus disparos también dañan a sus compañeros (orden `emperor.friendlyFire`). */
  friendlyFire?: true;
  /** Cuenta de pruebas: combustible infinito. */
  infiniteFuel?: true;
}

/** Una nave de una flota. `classId` es una clase de `@imperium/content` (SHIP_CLASSES). */
export interface FleetShip {
  id: string;
  classId: string;
  /** Nombre propio de la nave, si se le ha puesto. */
  name?: string;
  hull: number;
  /** Humanos a bordo (colonos del colonizador). */
  humans: number;
  /** Nave construida con un diseño del Astillero: su foto (nombre, casco y piezas). `classId` es la clase base de su casco. */
  design?: ShipDesignSnapshot;
  /** Combustible y depósito lleno, en años luz de alcance (`FLEET_FUEL`). */
  fuel: number;
  fuelMax: number;
}

/**
 * Flota propia. Es información privada: solo la recibe su dueño. Viaja a la
 * velocidad de su nave más lenta. Mientras viaja, `location` es el origen.
 */
export interface Fleet {
  id: string;
  /** Número de la flota dentro del imperio (Flota 1, Flota 2…). */
  number: number;
  /** Nombre que le ha puesto su dueño; sin él, «Flota N». */
  name?: string | null;
  /** Dónde está dentro de su sistema (m); null: en el punto de reunión. */
  localP?: [number, number, number] | null;
  location: SystemLocation;
  travel: Travel | null;
  ships: FleetShip[];
  /** Lo que lleva en la bodega: recursos y pasajeros. */
  cargo: Cargo;
  /** Componentes fabricados en la bodega. */
  items: Record<string, number>;
  /** Capacidad: bodega (todos los recursos juntos) y plazas de pasajeros. */
  capacity: { resources: number; humans: number };
  /** Ruta de transporte automática, si la tiene. */
  route: FleetRoute | null;
  /** Batalla en la que combate (Fase 9a), o null. No puede cargar ni descargar mientras tanto. */
  battleId: string | null;
  /** Táctica en las batallas por rondas (se puede cambiar a distancia, también en plena batalla). */
  tactic: FleetTactic;
  /** Flota de mercenarios: cuándo acaba el contrato y se marcha (ms del servidor); null si es propia. */
  mercenaryUntil: number | null;
}

/** Sonda de exploración en vuelo (privada): a qué sistema va, desde dónde y cuándo llega. */
export interface Probe {
  id: string;
  systemId: string;
  systemName: string;
  from: WorldPosition;
  to: WorldPosition;
  launchedAt: number;
  arriveAt: number;
}

/** Tipo de contrato (`CONTRACTS` de `@imperium/content`). */
export type ContractKind = "hunt" | "explore" | "mine" | "rescue" | "deliver";

/** Oferta del tablero de contratos (se renueva cada día). */
export interface ContractOffer {
  id: string;
  kind: ContractKind;
  target: number;
  credits: number;
  reputation: number;
  hours: number;
}

/** Contrato aceptado. */
export interface Contract {
  id: string;
  offerId: string;
  kind: ContractKind;
  /** Rescate: sistema de los restos y su punto (m, respecto a la estrella). */
  systemId?: string;
  systemName?: string;
  point?: [number, number, number];
  target: number;
  progress: number;
  credits: number;
  reputation: number;
  status: "active" | "done" | "expired" | "abandoned";
  acceptedAt: number;
  expiresAt: number;
  doneAt: number | null;
}

/** Tablero de contratos de un Emperador (tema `me`, `contracts.all`). */
export interface ContractsView {
  offers: ContractOffer[];
  list: Contract[];
  maxActive: number;
  /** Cuándo llegan las ofertas nuevas (ms). */
  refreshAt: number;
}

/** Petición de una colonia propia (`COLONY_REQUESTS`). */
export interface ColonyRequest {
  id: string;
  colonyId: string;
  colonyName: string;
  systemId: string;
  planetIndex: number;
  kind: "shortage" | "unrest";
  /** Escasez: el recurso que falta. */
  resource?: "metal" | "volatiles" | "crystal" | "alloys";
  /** Escasez: unidades; malestar: créditos. */
  amount: number;
  progress: number;
  status: "active" | "done" | "failed";
  expiresAt: number;
}

/** Objetivo del día o de la semana (`GOALS` de `@imperium/content`). */
export interface Goal {
  id: string;
  kind: "hunt" | "explore" | "mine" | "contract";
  target: number;
  progress: number;
  done: boolean;
  /** Recompensa (la experiencia ya con la racha). */
  xp: number;
  credits: number;
}

/** Objetivos del Emperador (tema `me`, `goals`). */
export interface GoalsView {
  daily: Goal[];
  weekly: Goal | null;
  /** Días seguidos con los tres objetivos del día cumplidos. */
  streak: number;
  /** Cuándo cambian los del día y los de la semana (ms). */
  dayEndsAt: number;
  weekEndsAt: number;
}

/** Rango del Emperador (tema `me`, `rank`): su experiencia; el rango y las mejoras salen de `RANKS` (`@imperium/content`). */
export interface RankView {
  xp: number;
  /** Récord personal del reto de caza (derribos). */
  best?: number;
}

/** Táctica de una flota en las batallas por rondas (efectos en `FLEET_TACTICS` de `@imperium/content`). */
export type FleetTactic = "balanced" | "aggressive" | "defensive" | "focus";

/** Contenido de una bodega. */
export type Cargo = Record<"metal" | "volatiles" | "crystal" | "alloys" | "humans", number>;

/** Ruta automática: carga en el origen lo indicado, lo descarga todo en el destino y vuelve. */
export interface FleetRoute {
  fromColonyId: string;
  toColonyId: string;
  /** Recursos a cargar en el origen, en orden de prioridad. */
  carry: Array<"metal" | "volatiles" | "crystal" | "alloys">;
  /** Si también lleva pasajeros del origen al destino. */
  humans: boolean;
}

/** Respuesta de `GET /api/emperor`, `POST /api/emperor` y `POST /api/emperor/move`. */
export interface EmperorResponse {
  emperor: Emperor;
}

/**
 * Quién puede ver dónde está tu Emperador: todos, solo tus compañeros (aliados
 * mutuos) o nadie. El servidor no envía su posición a quien no debe verla.
 */
export type Visibility = "public" | "allies" | "hidden";
export const VISIBILITIES: readonly Visibility[] = ["public", "allies", "hidden"];

/** Otro Emperador en la lista de compañeros. */
export interface AllyEntry {
  id: string;
  name: string;
}

/** Respuesta de `GET /api/social` y de sus cambios. */
export interface SocialResponse {
  visibility: Visibility;
  /** Compañeros: os habéis añadido los dos. */
  allies: AllyEntry[];
  /** Los has añadido tú, pero ellos a ti todavía no. */
  pending: AllyEntry[];
  /** Te han añadido ellos; añádelos tú para ser compañeros. */
  requests: AllyEntry[];
}

/** Dónde está o estuvo un compañero, para saltar junto a él (memoria de posición). */
export interface CompanionTrail {
  id: string;
  name: string;
  /** Sistema donde está ahora (o al que viaja); null si está en el espacio profundo o caído. */
  at: string | null;
  /** Sistemas donde se recuerda su última posición. */
  systems: string[];
}

/** Respuesta de `GET /api/social/trail`: compañeros que no se ocultan, con dónde están y dónde estuvieron. */
export interface CompanionTrailResponse {
  companions: CompanionTrail[];
}

/**
 * Alta con compañero: horas que una solicitud sin respuesta sigue viva. Pasado
 * ese tiempo, el compañero deja de verla y quien la envió puede empezar solo.
 */
export const COMPANION_REQUEST_TTL_HOURS = 24;

/** Estado de una solicitud de alta con compañero («expired»: sin respuesta a tiempo). */
export type CompanionRequestStatus = "pending" | "accepted" | "rejected" | "expired";

/** Respuesta de `GET /api/emperor/companion` (cuenta aún sin Emperador) y de `POST`. */
export interface CompanionRequestResponse {
  request: {
    /** Nombre del Emperador cerca del que quiere aparecer. */
    companion: string;
    /** Nombre que quiere para su Emperador. */
    name: string;
    status: CompanionRequestStatus;
    createdAt: number;
  } | null;
}

/** Solicitud de alta recibida por un Emperador: alguien quiere empezar cerca de él. */
export interface CompanionInboxEntry {
  id: string;
  /** Nombre que quiere para su Emperador. */
  name: string;
  createdAt: number;
}

/** Respuesta de `GET /api/companion-requests` y de `POST /api/companion-requests/respond`. */
export interface CompanionInboxResponse {
  requests: CompanionInboxEntry[];
}

/** Códigos de error de la API; el cliente los traduce con claves `error.*`. */
export type ApiErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "invalid_or_expired"
  | "rate_limited"
  | "no_emperor"
  | "emperor_exists"
  | "name_taken"
  | "unknown_system"
  | "unknown_emperor"
  | "cannot_ally_self"
  | "not_discovered"
  | "forbidden"
  | "conflict"
  | "slug_taken"
  | "unknown_article"
  | "unknown_design"
  | "limit_reached"
  | "research_busy"
  | "max_level"
  | "internal";

// --- Editor de naves (`docs/editor-naves.md`) ---

/** Diseños guardados por Emperador, como mucho. */
export const SHIP_DESIGNS_MAX = 30;
export const SHIP_DESIGN_NAME_MAX = 40;

// --- Crisis galácticas ---

/** Respuesta de `GET /api/crisis`. */
export interface CrisisStatus {
  active: { id: string; endsAt: number } | null;
}

// --- Tecnología por niveles ---

/** Respuesta de `GET /api/research`: niveles por rama y la investigación en marcha. */
export interface ResearchStatus {
  levels: Record<string, number>;
  current: { tree: string; level: number; finishAt: number } | null;
}

// --- Metas: prestigio, clasificación y objetivos de la era ---

export interface RankingEntry {
  rank: number;
  /** Null si el Emperador no es visible para quien pregunta (oculto, o solo para sus compañeros). */
  name: string | null;
  ai: boolean;
  prestige: number;
  /** Ha llegado a Ónfalo. */
  core: boolean;
}

/** Una leyenda de la era: quién logró primero una hazaña. */
export interface LegendEntry {
  id: string;
  name: string;
  at: number;
}

/** Respuesta de `GET /api/ranking`. */
export interface RankingResponse {
  legends: LegendEntry[];
  top: RankingEntry[];
  me: (RankingEntry & { stats: Record<"colonies" | "population" | "discoveries" | "ships" | "core", number>; reputation: number }) | null;
  total: number;
}

/** Foto de un diseño (lo que se construye y lo que lleva la nave). */
export interface ShipDesignSnapshot {
  name: string;
  hullId: string;
  parts: Record<string, string>;
}

/** Un diseño de nave guardado: casco y pieza de cada anclaje (`slotId → partId`). */
export interface ShipDesignRecord {
  id: string;
  name: string;
  hullId: string;
  parts: Record<string, string>;
  updatedAt: number;
}

/** Respuesta de `GET /api/designs` y de guardar o borrar uno. */
export interface ShipDesignsResponse {
  designs: ShipDesignRecord[];
  /** El diseño recién guardado, si se guardó uno. */
  saved?: ShipDesignRecord;
}

/** Respuesta de `GET /api/systems/:systemId`: detalle de un sistema descubierto (niebla de guerra). */
export interface SystemDetailResponse {
  detail: StarSystemDetail;
}

// --- Fase 7: humanos, colonias y economía ---

/** Longitud mínima y máxima del nombre (personalizado) de un planeta. */
export const PLANET_NAME_MIN = 2;
export const PLANET_NAME_MAX = 32;

/** Recursos almacenables de una colonia (la energía no se almacena ni se transporta). */
/** Los dos últimos solo se minan en el espacio profundo (o se compran en el mercado). */
export type StockId = "metal" | "volatiles" | "crystal" | "alloys" | "rare_metals" | "exotic";
export type Stock = Record<StockId, number>;

/**
 * Humanos de la nave del Emperador (privado). La nave los genera sola hasta su
 * capacidad: el valor actual es `count + perHour × horas desde at`, con tope.
 */
export interface EmperorHumans {
  /** Humanos a la hora `at` (puede tener decimales; se muestran enteros). */
  count: number;
  capacity: number;
  /** Humanos generados por hora real (ya con la escala de tiempo). */
  perHour: number;
  /** Hora del servidor de `count`. */
  at: number;
}

/**
 * La nave del Emperador vista por su dueño (tema `me`): dónde está aparcada en
 * su sistema. Desde `park.p` (metros) a la hora `park.at` orbita la estrella o,
 * con `anchor`, acompaña al planeta o luna junto al que se dejó (`parkedPosition`
 * de `@imperium/sim`); al pilotar se sale de ahí, con la orientación `q` y los
 * motores como se dejaron.
 */
export interface FlagshipStatus {
  systemId: string;
  park: {
    p: [number, number, number];
    at: number;
    anchor?: { planet: number; moon?: number };
    q?: [number, number, number, number];
    engines?: boolean;
    /** Crucero sin piloto: de `from` hasta su sitio junto al cuerpo anclado, adonde llega a la hora `until`. */
    travel?: { from: [number, number, number]; until: number };
    /** En órbita sin piloto: giro (rad/s) alrededor del eje vertical del cuerpo anclado. */
    spin?: number;
    /** Acoplada en el hangar de una nodriza de esta flota (o llegando así). */
    dock?: { fleetId: string; slot: number; colonyPlanet: number | null; at?: [number, number, number] | null };
  };
  /**
   * Combustible y munición guardados (lo que se gasta al pilotar llega aparte, en
   * tiempo real). El combustible es el de la hora `fuelAt`: por debajo de la
   * reserva de emergencia se regenera solo (`regenFuel` de `@imperium/sim`).
   */
  supplies: { fuel: number; fuelMax: number; fuelAt: number; cannon: number; cannonMax: number; missiles: number; missilesMax: number; hull: number; hullMax: number };
  /** Bodega (lo minado en el espacio profundo) y su capacidad (todos los recursos juntos). */
  hold: Partial<Record<StockId, number>>;
  holdCapacity: number;
}

/** Construcción en la cola de una colonia: una instalación o una nave (del astillero). */
export interface ColonyBuild {
  id: string;
  kind: "installation" | "ship" | "design" | "craft";
  /** Id de la instalación (`INSTALLATIONS`), de la clase de nave (`SHIP_CLASSES`) o del diseño del Astillero. */
  itemId: string;
  /** Diseño del Astillero: su foto al encargarlo (si luego se cambia o se borra, se construye este). */
  design?: ShipDesignSnapshot;
  /** Solo la primera de la cola está en marcha: horas del servidor de inicio y fin. */
  startedAt: number | null;
  finishAt: number | null;
}

/**
 * Colonia propia (privada: solo la recibe su dueño). Los valores son los de la
 * hora `at`; el cliente los hace avanzar con las tasas (por hora real) hasta
 * el siguiente cambio, que manda el servidor.
 */
export interface Colony {
  id: string;
  systemId: string;
  systemName: string;
  planetIndex: number;
  /** Designación del planeta (p. ej. «Velor III»). */
  planetName: string;
  /** Nombre puesto por el dueño; null = la designación del planeta. */
  name: string | null;
  population: number;
  populationCap: number;
  /** Crecimiento de la población por hora real en `at`. */
  populationPerHour: number;
  stock: Stock;
  storage: Stock;
  /** Producción neta por hora real en `at` (negativa si se consume). */
  ratesPerHour: Stock;
  /** Energía producida y consumida (local; no se almacena). */
  energy: { produced: number; consumed: number };
  /** Mantenimiento en volátiles por hora real: el de sus instalaciones y, si es la capital, el de las flotas. */
  upkeepPerHour: number;
  /** Capital del Emperador (su colonia más antigua): paga el mantenimiento de las flotas. */
  capital: boolean;
  /** Le faltan volátiles para el mantenimiento: la refinería está parada. */
  shortage: boolean;
  /** Fuera de la red de suministro (lejos de la capital y de las demás colonias): extrae menos (`ECONOMY.isolatedExtraction`). */
  isolated: boolean;
  /** Instalaciones construidas, por id. */
  installations: Record<string, number>;
  /** Componentes fabricados en su inventario (Fábrica). */
  items: Record<string, number>;
  builds: ColonyBuild[];
  at: number;
  foundedAt: number;
}

/**
 * Dueño y nombre de un planeta reclamado. Es territorio, no posición: lo ve
 * cualquiera que haya descubierto el sistema.
 */
export interface PlanetClaim {
  /** Id de la colonia (para asediarla, Fase 9b). */
  colonyId: string;
  planetIndex: number;
  /** Nombre personalizado; null = la designación del planeta. */
  name: string | null;
  /** Dueño; null = colonia independiente (su Emperador borró la cuenta). */
  ownerId: string | null;
  ownerName: string | null;
  /** Si el dueño es una facción alienígena (Fase 11), su id (`FACTIONS`); el cliente muestra su nombre traducido. */
  ownerFactionId?: string | null;
  /** Fase 9b: la colonia está bajo asedio (de quien sea). */
  besieged?: boolean;
}

/** Respuesta de `GET /api/systems/:systemId/claims`: planetas con dueño de un sistema descubierto. */
export interface SystemClaimsResponse {
  claims: PlanetClaim[];
}

// --- Fase 9b: conquista de planetas ---

/**
 * Estado de un asedio en curso: avanza (el atacante tiene naves armadas en el
 * sistema y nadie se lo impide), disputado (hay naves armadas del defensor),
 * en batalla (las flotas del atacante combaten allí) o listo para desembarcar.
 */
export type SiegeState = "advancing" | "contested" | "battle" | "ready";
/** Resultado: en curso, planeta tomado, asedio roto (el atacante perdió su presencia), levantado por el atacante o anulado (la colonia cambió de manos por otra vía). */
export type SiegeOutcome = "ongoing" | "captured" | "broken" | "lifted" | "void";

/** Último desembarco de tropas en un asedio. */
export interface SiegeAssaultReport {
  at: number;
  troops: number;
  defenders: number;
  captured: boolean;
  attackerLosses: number;
  populationLosses: number;
}

/**
 * Asedio visto por el atacante o por el defensor (tema `me`). El progreso es
 * el de la hora `at`; el cliente lo hace avanzar con `ratePerHour` (por hora
 * real) mientras el estado sea `advancing`.
 */
export interface Siege {
  id: string;
  colonyId: string;
  systemId: string;
  systemName: string;
  planetIndex: number;
  /** Designación del planeta. */
  planetName: string;
  /** Nombre puesto por su dueño (null = la designación). */
  colonyName: string | null;
  role: "attacker" | "defender";
  attackerName: string;
  /** Si asedia una facción alienígena, su id (el cliente muestra su nombre traducido). */
  attackerFactionId: string | null;
  /** Dueño de la colonia al empezar (null = independiente). */
  defenderName: string | null;
  defenderFactionId: string | null;
  progress: number;
  /** Progreso por hora real en `at` (0 si no avanza). */
  ratePerHour: number;
  state: SiegeState;
  outcome: SiegeOutcome;
  /** Fuerza de asedio del atacante y defensa de la colonia en la última resolución. */
  attack: number;
  defense: number;
  /** Defensores contra un desembarco (milicia y guarnición): hacen falta más tropas que esto. */
  defenders: number;
  startedAt: number;
  endedAt: number | null;
  nextTickAt: number | null;
  lastAssault: SiegeAssaultReport | null;
  at: number;
}

// --- Fase 9a: combate de flotas ---

/** Resultado de una batalla para un bando: en curso, ganada, perdida, huida o en tablas. */
export type BattleOutcome = "ongoing" | "won" | "lost" | "fled" | "draw";

/** Naves por clase: { frigate: 2, explorer: 1 }. */
export type ShipCounts = Record<string, number>;

/** Informe de una ronda, visto por uno de los bandos. */
export interface BattleRoundReport {
  round: number;
  /** Hora del servidor en que se resolvió. */
  at: number;
  /** Daño al casco hecho y recibido. */
  dealt: number;
  taken: number;
  /** Naves propias perdidas y enemigas destruidas, por clase. */
  lost: ShipCounts;
  killed: ShipCounts;
}

/**
 * Batalla de flotas (privada: la recibe cada bando, desde su punto de vista).
 * Se resuelve en el servidor por rondas; huye quien da una orden de viaje.
 */
export interface Battle {
  id: string;
  systemId: string;
  systemName: string;
  startedAt: number;
  endedAt: number | null;
  /** Rondas resueltas. */
  round: number;
  /** Hora del servidor de la siguiente ronda (null si ha terminado). */
  nextRoundAt: number | null;
  outcome: BattleOutcome;
  /** Nombre del Emperador enemigo. */
  enemyName: string;
  /** Si el enemigo es una facción alienígena (Fase 11), su id; el cliente muestra su nombre traducido. */
  enemyFactionId?: string | null;
  /** Naves de cada bando que siguen en la batalla. */
  own: ShipCounts;
  foe: ShipCounts;
  /** Últimas rondas, de la más antigua a la más reciente. */
  rounds: BattleRoundReport[];
}

/**
 * Flota enemiga en tránsito detectada por tus sensores (flotas paradas y
 * colonias): se puede interceptar en su destino.
 */
export interface FleetContact {
  fleetId: string;
  emperorName: string;
  /** Flota de una facción alienígena (Fase 11): su id. Interceptarla aumenta su rencor. */
  factionId?: string | null;
  ships: number;
  from: SystemLocation;
  to: SystemLocation;
  departAt: number;
  arriveAt: number;
}

/** Respuesta de `GET /api/contacts`. */
export interface ContactsResponse {
  contacts: FleetContact[];
  /** Flotas alienígenas paradas al alcance de tus sensores (Fase 11). */
  sightings?: AlienSighting[];
}

// --- Fase 11: especies alienígenas, territorios e IA ---

/** Dueño alienígena de un sistema (capa de territorio más la expansión). */
export interface AlienTerritory {
  factionId: string;
  speciesId: string;
}

/** Flota alienígena parada que ven tus sensores. */
export interface AlienSighting {
  fleetId: string;
  factionId: string;
  speciesId: string;
  systemId: string;
  systemName: string;
  ships: ShipCounts;
  inBattle: boolean;
}

/** Relación de una facción alienígena con tu Emperador (diplomacia básica). */
export interface AlienStanding {
  factionId: string;
  speciesId: string;
  /** Rencor actual (con `hostileAt` o más, hostil aunque la facción sea neutral). */
  grudge: number;
  /** ¿Te ataca? (facción hostil por naturaleza o por rencor). */
  hostile: boolean;
  /** ¿Acepta tributos para olvidar el rencor? */
  acceptsTribute: boolean;
}

/**
 * Respuesta de `GET /api/aliens`: territorio alienígena de los sistemas que has
 * descubierto (la niebla de guerra también lo oculta), ruinas precursoras y tu
 * relación con las facciones que conoces.
 */
export interface AliensResponse {
  territory: Array<AlienTerritory & { systemId: string }>;
  relics: string[];
  standings: AlienStanding[];
  /** Rencor a partir del cual una facción neutral es hostil. */
  hostileAt: number;
}

/** Respuesta de `GET /api/systems/:systemId/aliens`: presencia alienígena en un sistema descubierto. */
export interface SystemAliensResponse {
  territory: AlienTerritory | null;
  relic: boolean;
  /** Flotas alienígenas paradas allí (solo si tus sensores lo cubren ahora). */
  fleets: AlienSighting[];
  /** ¿Tus sensores cubren el sistema? (si no, las flotas no se ven). */
  sensed: boolean;
}

/** Respuesta de `POST /api/ws/ticket`: ticket de un solo uso para abrir el WebSocket. */
export interface WsTicketResponse {
  ticket: string;
}

export interface ApiError {
  error: ApiErrorCode;
}

// --- Economía de la humanidad y mercado global ---

/**
 * Cartera de créditos del Emperador propio (tema `me`). El saldo actual es
 * `credits + incomePerHour × (ahora − at)` en horas reales: el cliente lo
 * hace avanzar solo, como las existencias de las colonias.
 */
export interface Wallet {
  credits: number;
  /** Renta neta por hora real (tras el aporte al Núcleo). */
  incomePerHour: number;
  /** Aporte al tesoro del Núcleo por hora real. */
  taxPerHour: number;
  at: number;
}

export type HumanityProjectStatus = "collecting" | "awaiting_funds" | "complete";

/** Proyecto común de la humanidad, tal y como lo ve cualquier jugador. */
export interface HumanityProject {
  id: string;
  level: number;
  maxLevel: number;
  status: HumanityProjectStatus;
  /** Coste del siguiente nivel (null si ya está completo). */
  cost: (Stock & { credits: number }) | null;
  /** Recursos ya aportados para el siguiente nivel. */
  progress: Stock;
  /** Recursos de camino al Núcleo para este proyecto. */
  inTransit: Stock;
  /** Efecto actual (fracción: 0,08 = +8 %) y el de cada nivel. */
  effect: number;
  effectPerLevel: number;
  /** Mayores contribuyentes (nombre null: cuenta borrada), con lo aportado en unidades (recursos + créditos). */
  top: Array<{ name: string | null; total: number }>;
}

/** `GET /api/humanity`: la economía de toda la humanidad (pública para cualquier jugador). */
export interface HumanityResponse {
  /** Emperadores con colonias y número de colonias (incluidas las independientes). */
  emperors: number;
  colonies: number;
  population: number;
  /** Existencias de todas las colonias y producción neta por hora real. */
  stock: Stock;
  ratesPerHour: Stock;
  /** Créditos en las carteras de todos los Emperadores. */
  credits: number;
  treasury: { credits: number; incomePerHour: number; taxRate: number; at: number };
  projects: HumanityProject[];
  at: number;
}

export type OrderSide = "buy" | "sell";

/** Resumen de un recurso en el mercado: mejores precios, libro e historial. */
export interface MarketResource {
  resource: StockId;
  bestBid: number | null;
  bestAsk: number | null;
  last: number | null;
  /** Unidades casadas en las últimas 24 horas reales. */
  volume24h: number;
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
  /** Por horas (inicio de la hora en ms): precio medio ponderado y unidades. */
  history: Array<{ t: number; avg: number; volume: number }>;
}

/** `GET /api/market`. */
export interface MarketResponse {
  resources: MarketResource[];
  feeRate: number;
  at: number;
}

export interface MarketOrderView {
  id: string;
  resource: StockId;
  side: OrderSide;
  price: number;
  quantity: number;
  remaining: number;
  colonyId: string;
  colonyName: string;
  createdAt: number;
}

/** Envío por la red del Núcleo: compra que llega o aporte que va a un proyecto. */
export interface ShipmentView {
  id: string;
  kind: "trade" | "contribution";
  /** Compra: colonia de destino; aporte: proyecto. */
  to: string;
  amounts: Stock;
  departAt: number;
  arriveAt: number;
}

export interface MarketTradeView {
  resource: StockId;
  side: OrderSide;
  price: number;
  quantity: number;
  at: number;
}

/** `GET /api/market/mine`: órdenes, envíos y operaciones recientes propias. */
export interface MarketMineResponse {
  orders: MarketOrderView[];
  shipments: ShipmentView[];
  trades: MarketTradeView[];
  maxOpenOrders: number;
}

// --- Fase 10: muerte y linaje ---

/** Doctrina de gobierno de un Heredero (`HEIR_DOCTRINES` en `@imperium/content`). */
export type HeirDoctrineId = "prosperity" | "bastion" | "balanced";

/** Dónde renace (o renació) el Emperador. */
export interface RebirthPlace {
  /** En una Cuna de linaje, en el Núcleo Humano (sin Cunas) o encarnado en un Heredero. */
  kind: "cradle" | "core" | "heir";
  systemId: string;
  systemName: string;
  colonyId: string | null;
  /** Nombre de la colonia (el puesto por el dueño o la designación del planeta). */
  colonyName: string | null;
}

/** Una Cuna de linaje propia (instalación `lineage_cradle` de una colonia). */
export interface CradleView {
  colonyId: string;
  colonyName: string;
  systemId: string;
  systemName: string;
  /** Hay un Heredero gestándose o viviendo en esta colonia (uno por colonia). */
  heirId: string | null;
}

/** Un Heredero del linaje: se gesta en una Cuna y gobierna una colonia propia. */
export interface HeirView {
  id: string;
  name: string;
  colonyId: string;
  colonyName: string;
  systemId: string;
  systemName: string;
  doctrine: HeirDoctrineId;
  /** El gobernador encarga instalaciones según su doctrina cuando la cola está vacía. */
  builds: boolean;
  state: "gestating" | "active";
  /** Hora del servidor a la que nace (si se gesta). */
  readyAt: number | null;
  /** Flota que manda como comandante, o null. */
  fleetId: string | null;
}

/** Una muerte del Emperador (historial del linaje). */
export interface DeathRecord {
  id: string;
  systemId: string;
  systemName: string;
  /** En combate pilotado (tiempo real) o en una batalla de flotas por rondas. */
  cause: "combat" | "battle";
  /** Quién lo derribó (nombre de un Emperador, de una facción o vacío para piratas). */
  by: string | null;
  /** Muerte número tantos de su racha (cuantas más seguidas, más tarda la gestación). */
  streak: number;
  diedAt: number;
  rebornAt: number;
  /** Dónde renació (null mientras se gesta). */
  rebirthKind: RebirthPlace["kind"] | null;
}

/** Estado del linaje de un Emperador (privado: tema `me`). */
export interface LineageStatus {
  /** Generación: sube con cada cuerpo nuevo (renacer o encarnarse). */
  generation: number;
  /** Muerto y gestándose: desde cuándo, cuándo renace y dónde (se vuelve a decidir al renacer). */
  dead: { diedAt: number; rebornAt: number; place: RebirthPlace } | null;
  /** Racha de muertes seguidas a esta hora (se olvida con el tiempo). */
  streak: number;
  /** Gestación (ms reales) si muriese ahora: en su Cuna, o en el Núcleo si no tiene. */
  nextGestationMs: number;
  /** Cuna preferida para renacer (si sigue siendo suya); null = la más cercana. */
  preferredCradleId: string | null;
  cradles: CradleView[];
  heirs: HeirView[];
  deaths: DeathRecord[];
  /** Hora del servidor desde la que puede volver a encarnarse. */
  incarnateReadyAt: number;
}
