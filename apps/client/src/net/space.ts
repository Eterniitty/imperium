import { createStore } from "zustand/vanilla";
import { contentDictionaries } from "@imperium/content";
import { translate, type DeepRegionView, type Locale, type Quat, type RiftPhase, type ServerMessage, type ShipPose, type ShipState, type StockId, type Vec3, type WeaponKind } from "@imperium/shared";

/**
 * Grieta del salto cuántico de otra nave, pendiente de dibujar. `jump`: la nave
 * entró en su grieta (la deja el servidor al saltar); lleva su última posición.
 */
export interface RiftEvent {
  id: string;
  phase: RiftPhase | "jump";
  at: Vec3;
  q: Quat;
}

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
  /**
   * Blanco de armas fijado (asistencia de puntería: cañón con adelanto y
   * misiles). Distinto de cualquier objetivo de navegación.
   */
  targetId: string | null;
  /** Arma seleccionada (clic izquierdo, rueda del ratón o 1/2/3). */
  weapon: SelectedWeapon;
  /** Disparos recibidos pendientes de dibujar (la vista los recoge y vacía la lista). */
  shots: Array<Extract<ServerMessage, { t: "shot" }>>;
  /** Naves destruidas pendientes de dibujar su explosión. */
  explosions: Vec3[];
  /** Grietas de salto de otras naves pendientes de dibujar (la vista las recoge y vacía la lista). */
  rifts: RiftEvent[];
  /** La nave propia fue destruida: dónde renace y quién la derribó. */
  /** Tu nave cayó (Fase 10): quién la derribó, dónde renacerás y cuándo; `at` es la hora local del aviso. */
  destroyed: { by: string; systemId: string; rebornAt: number; at: number } | null;
  /** Espacio profundo: la región donde se pilota (asteroides y lo que les queda), o null en un sistema. */
  field: DeepRegionView | null;
  /** Láseres de minería encendidos de las demás naves: id de la nave → asteroide. */
  beams: Record<string, number>;
  /** Bodega y refinería de a bordo según el servidor (mientras se pilota). */
  hold: { hold: Partial<Record<StockId, number>>; capacity: number; refining: boolean } | null;
  /** Último pulso de minería rechazado (motivo y hora local), para avisar en el HUD. */
  mineFail: { reason: Extract<ServerMessage, { t: "mineFail" }>["reason"]; at: number } | null;
  /** Asteroide al que apunta el morro (a tiro o no) y su distancia a la superficie (m). */
  aim: { index: number; distance: number } | null;
  /** El láser de minería propio está encendido. */
  mining: boolean;
  /** Nave de una flota propia que se pilota a distancia (`fleet.pilot`); null: la del Emperador. */
  remote: { shipId: string; fleetId: string; classId: string; systemId: string } | null;
  /** El servidor terminó el pilotaje a distancia (la nave cayó o la flota se fue), pendiente de atender. */
  remoteEnded: "destroyed" | "left" | null;
}

/** Id en el espacio de una nave de flota pilotada a distancia (el mismo que usa el servidor). */
export const fleetShipId = (shipId: string) => `ship:${shipId}`;

/** Armas que se pueden seleccionar: cañón, misiles y láser de minería (solo en el espacio profundo). */
export type SelectedWeapon = "cannon" | "missile" | "laser";

const EMPTY: SpaceState = { systemId: null, ships: {}, correction: null, self: null, weapons: [], supplies: null, targetId: null, weapon: "cannon", shots: [], explosions: [], rifts: [], destroyed: null, field: null, beams: {}, hold: null, mineFail: null, aim: null, mining: false, remote: null, remoteEnded: null };

export const spaceStore = createStore<SpaceState>()(() => ({ ...EMPTY }));

/** Vacía el espacio local (al dejar de pilotar). Conserva un aviso de destrucción pendiente. */
export function resetSpace(): void {
  const { destroyed, remote, remoteEnded } = spaceStore.getState();
  spaceStore.setState({ ...EMPTY, destroyed, remote, remoteEnded });
}

const MAX_SAMPLES = 8;

/** Nombre visible de una nave: el del Emperador, o el de su tipo si es de la IA. */
export function shipName(state: Pick<ShipState, "kind" | "name" | "classId">, locale: Locale): string {
  // Nave de flota pilotada a distancia: «Emperador · Fragata».
  if (state.kind === "fleet") {
    const cls = state.classId ? contentDictionaries[locale][`ship.${state.classId}.name`] : undefined;
    return cls ? `${state.name} · ${cls}` : state.name;
  }
  if (state.kind !== "pirate") return state.name;
  // «Carroñero · Arponero»: el pueblo y su clase de nave.
  const cls = state.classId ? contentDictionaries[locale][`ship.${state.classId}.name`] : undefined;
  return cls ? `${translate(locale, "npc.pirate")} · ${cls}` : translate(locale, "npc.pirate");
}

export function addSample(ship: RemoteShip, sample: PoseSample): void {
  ship.samples.push(sample);
  if (ship.samples.length > MAX_SAMPLES) ship.samples.shift();
}
