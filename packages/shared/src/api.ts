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
export const LEGAL_VERSION = "2026-10-21";

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
}

/** Una nave de una flota. `classId` es una clase de `@imperium/content` (SHIP_CLASSES). */
export interface FleetShip {
  id: string;
  classId: string;
  hull: number;
  /** Humanos a bordo (colonos del colonizador). */
  humans: number;
}

/**
 * Flota propia. Es información privada: solo la recibe su dueño. Viaja a la
 * velocidad de su nave más lenta. Mientras viaja, `location` es el origen.
 */
export interface Fleet {
  id: string;
  /** Número de la flota dentro del imperio (Flota 1, Flota 2…). */
  number: number;
  location: SystemLocation;
  travel: Travel | null;
  ships: FleetShip[];
  /** Lo que lleva en la bodega: recursos y pasajeros. */
  cargo: Cargo;
  /** Capacidad: bodega (todos los recursos juntos) y plazas de pasajeros. */
  capacity: { resources: number; humans: number };
  /** Ruta de transporte automática, si la tiene. */
  route: FleetRoute | null;
  /** Batalla en la que combate (Fase 9a), o null. No puede cargar ni descargar mientras tanto. */
  battleId: string | null;
}

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
  | "internal";

/** Respuesta de `GET /api/systems/:systemId`: detalle de un sistema descubierto (niebla de guerra). */
export interface SystemDetailResponse {
  detail: StarSystemDetail;
}

// --- Fase 7: humanos, colonias y economía ---

/** Longitud mínima y máxima del nombre (personalizado) de un planeta. */
export const PLANET_NAME_MIN = 2;
export const PLANET_NAME_MAX = 32;

/** Recursos almacenables de una colonia (la energía no se almacena ni se transporta). */
export type StockId = "metal" | "volatiles" | "crystal" | "alloys";
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

/** Construcción en la cola de una colonia: una instalación o una nave (del astillero). */
export interface ColonyBuild {
  id: string;
  kind: "installation" | "ship";
  /** Id de la instalación (`INSTALLATIONS`) o de la clase de nave (`SHIP_CLASSES`). */
  itemId: string;
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
  /** Instalaciones construidas, por id. */
  installations: Record<string, number>;
  builds: ColonyBuild[];
  at: number;
  foundedAt: number;
}

/**
 * Dueño y nombre de un planeta reclamado. Es territorio, no posición: lo ve
 * cualquiera que haya descubierto el sistema.
 */
export interface PlanetClaim {
  planetIndex: number;
  /** Nombre personalizado; null = la designación del planeta. */
  name: string | null;
  /** Dueño; null = colonia independiente (su Emperador borró la cuenta). */
  ownerId: string | null;
  ownerName: string | null;
  /** Si el dueño es una facción alienígena (Fase 11), su id (`FACTIONS`); el cliente muestra su nombre traducido. */
  ownerFactionId?: string | null;
}

/** Respuesta de `GET /api/systems/:systemId/claims`: planetas con dueño de un sistema descubierto. */
export interface SystemClaimsResponse {
  claims: PlanetClaim[];
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
