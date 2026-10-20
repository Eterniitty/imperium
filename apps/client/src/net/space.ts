import { createStore } from "zustand/vanilla";
import type { Quat, ShipPose, ShipState, Vec3 } from "@imperium/shared";

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
}

export const spaceStore = createStore<SpaceState>()(() => ({ systemId: null, ships: {}, correction: null }));

const MAX_SAMPLES = 8;

export function addSample(ship: RemoteShip, sample: PoseSample): void {
  ship.samples.push(sample);
  if (ship.samples.length > MAX_SAMPLES) ship.samples.shift();
}
