import { createStore } from "zustand/vanilla";
import type { Quat, ServerMessage, ShipPose, ShipState, Vec3, WeaponKind } from "@imperium/shared";

/** Muestra de posición de otra nave, con la hora del servidor en que se envió. */
export interface PoseSample {
  t: number;
  p: Vec3;
  q: Quat;
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
  /** Nave enemiga fijada para los misiles. */
  targetId: string | null;
  /** Disparos recibidos pendientes de dibujar (la vista los recoge y vacía la lista). */
  shots: Array<Extract<ServerMessage, { t: "shot" }>>;
  /** Naves destruidas pendientes de dibujar su explosión. */
  explosions: Vec3[];
  /** La nave propia fue destruida: dónde renace y quién la derribó. */
  destroyed: { by: string; systemId: string } | null;
}

const EMPTY = { systemId: null, ships: {}, correction: null, self: null, weapons: [], targetId: null, shots: [], explosions: [], destroyed: null };

export const spaceStore = createStore<SpaceState>()(() => ({ ...EMPTY }));

/** Vacía el espacio local (al dejar de pilotar). Conserva un aviso de destrucción pendiente. */
export function resetSpace(): void {
  spaceStore.setState({ ...EMPTY, destroyed: spaceStore.getState().destroyed });
}

const MAX_SAMPLES = 8;

export function addSample(ship: RemoteShip, sample: PoseSample): void {
  ship.samples.push(sample);
  if (ship.samples.length > MAX_SAMPLES) ship.samples.shift();
}
