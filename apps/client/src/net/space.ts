import { createStore } from "zustand/vanilla";
import { contentDictionaries } from "@imperium/content";
import { translate, type Locale, type Quat, type ServerMessage, type ShipPose, type ShipState, type Vec3, type WeaponKind } from "@imperium/shared";

/** Muestra de posición de otra nave, con la hora del servidor en que se envió. */
export interface PoseSample {
  t: number;
  p: Vec3;
  q: Quat;
  /** Velocidad (m/s): para seguir moviendo la nave entre muestras espaciadas (naves aparcadas). */
  v?: Vec3;
}

export interface RemoteShip {
  state: ShipState;
  /** Últimas posiciones recibidas, de más antigua a más reciente (para interpolar). */
  samples: PoseSample[];
}

/**
 * Espacio local: las demás naves que vuelan en el sistema donde pilota el
 * jugador. Se rellena con los mensajes `space`, `poses`, `ship` y `shipGone`.
 */
export interface SpaceState {
  systemId: string | null;
  ships: Record<string, RemoteShip>;
  /** Corrección del servidor pendiente de aplicar a la nave propia. */
  correction: ShipPose | null;
  /** Estado de la nave propia (casco y escudo) según el servidor. */
  self: ShipState | null;
  /** Armas propias: munición y cuándo vuelven a estar listas. */
  weapons: Array<{ kind: WeaponKind; ammo: number | null; ammoMax: number | null; readyAt: number }>;
  /** Energía y combustible de la nave propia según el servidor (mientras se pilota). */
  supplies: { energy: number; energyMax: number; fuel: number; fuelMax: number; resupplying: boolean } | null;
  /** Nave enemiga fijada para los misiles. */
  targetId: string | null;
  /** Disparos recibidos pendientes de dibujar (la vista los recoge y vacía la lista). */
  shots: Array<Extract<ServerMessage, { t: "shot" }>>;
  /** Naves destruidas pendientes de dibujar su explosión. */
  explosions: Vec3[];
  /** La nave propia fue destruida: dónde renace y quién la derribó. */
  /** Tu nave cayó (Fase 10): quién la derribó, dónde renacerás y cuándo; `at` es la hora local del aviso. */
  destroyed: { by: string; systemId: string; rebornAt: number; at: number } | null;
}

const EMPTY = { systemId: null, ships: {}, correction: null, self: null, weapons: [], supplies: null, targetId: null, shots: [], explosions: [], destroyed: null };

export const spaceStore = createStore<SpaceState>()(() => ({ ...EMPTY }));

/** Vacía el espacio local (al dejar de pilotar). Conserva un aviso de destrucción pendiente. */
export function resetSpace(): void {
  spaceStore.setState({ ...EMPTY, destroyed: spaceStore.getState().destroyed });
}

const MAX_SAMPLES = 8;

/** Nombre visible de una nave: el del Emperador, o el de su tipo si es de la IA. */
export function shipName(state: Pick<ShipState, "kind" | "name" | "classId">, locale: Locale): string {
  if (state.kind !== "pirate") return state.name;
  // «Carroñero · Arponero»: el pueblo y su clase de nave.
  const cls = state.classId ? contentDictionaries[locale][`ship.${state.classId}.name`] : undefined;
  return cls ? `${translate(locale, "npc.pirate")} · ${cls}` : translate(locale, "npc.pirate");
}

export function addSample(ship: RemoteShip, sample: PoseSample): void {
  ship.samples.push(sample);
  if (ship.samples.length > MAX_SAMPLES) ship.samples.shift();
}
