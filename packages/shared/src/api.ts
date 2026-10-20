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
  ownerId: string;
  ownerName: string;
}

/** Respuesta de `GET /api/systems/:systemId/claims`: planetas con dueño de un sistema descubierto. */
export interface SystemClaimsResponse {
  claims: PlanetClaim[];
}

/** Respuesta de `POST /api/ws/ticket`: ticket de un solo uso para abrir el WebSocket. */
export interface WsTicketResponse {
  ticket: string;
}

export interface ApiError {
  error: ApiErrorCode;
}
