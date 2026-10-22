import type { ComponentAmounts } from "./manufacturing";
import type { ShipClassId } from "./types";

/**
 * Editor de naves (fase E1, `docs/editor-naves.md`): cascos con anclajes y
 * piezas que se encajan en ellos, como un Lego. Son **datos**: las reglas
 * (validez y estadísticas) están en `@imperium/sim` (shipDesign.ts).
 */

/** Tamaño de un anclaje y de una pieza: una pieza solo cabe en un anclaje de su tamaño o mayor. */
export type SlotSize = "S" | "M" | "L";
export const SLOT_SIZES: readonly SlotSize[] = ["S", "M", "L"];

/** Clase de casco: limita algunas piezas (el motor cuántico pesado, por ejemplo). */
export type HullClass = "S" | "M" | "L" | "XL";
export const HULL_CLASSES: readonly HullClass[] = ["S", "M", "L", "XL"];

export type PartKind = "bridge" | "reactor" | "thruster" | "quantum" | "tank" | "shield" | "weapon" | "life" | "cargo" | "hangar" | "sensor" | "armor";
export const PART_KINDS: readonly PartKind[] = ["bridge", "reactor", "thruster", "quantum", "tank", "shield", "weapon", "life", "cargo", "hangar", "sensor", "armor"];

/** Lo que cuesta una pieza o un casco: créditos y recursos. */
export interface PartCost {
  credits: number;
  metal?: number;
  crystal?: number;
  alloys?: number;
  rare_metals?: number;
  exotic?: number;
}

/** Un anclaje del casco: qué tipos de pieza admite y de qué tamaño. */
export interface HullSlot {
  id: string;
  kinds: readonly PartKind[];
  size: SlotSize;
}

export interface HullDef {
  id: string;
  nameKey: string;
  class: HullClass;
  /** Masa del casco vacío (toneladas). */
  massT: number;
  /** Casco (vida) base. */
  hull: number;
  /** Bodega base. */
  cargo: number;
  slots: readonly HullSlot[];
  cost: PartCost;
  /** Componentes fabricados que pide el casco. */
  components?: ComponentAmounts;
  /** Instalación de la colonia donde se construye. */
  builtAt: "shipyard" | "drydock";
  /**
   * Clase de serie más parecida: da el modelo 3D, el perfil de combate por
   * rondas y el escáner de las naves construidas con este casco (hasta que las
   * estadísticas del diseño manden en todo, fase E4).
   */
  baseClass: ShipClassId;
  /** Horas de construcción (de juego). */
  buildTimeHours: number;
}

/** Efectos de una pieza según su tipo (solo los que tiene). */
export interface PartStats {
  /** Reactor: energía que da (MW). */
  powerMW?: number;
  /** Propulsión: empuje (kN). */
  thrustKN?: number;
  /** Motor cuántico: velocidad en la grieta (a.l./h) para una nave de referencia, segundos de carga y consumo por a.l. y 1000 t. */
  riftLyPerHour?: number;
  chargeSec?: number;
  fuelPerLyPer1000T?: number;
  /** Depósito: combustible. */
  fuel?: number;
  /** Escudo: capacidad, recarga por segundo y retardo tras un impacto. */
  shield?: number;
  shieldRegen?: number;
  shieldDelaySec?: number;
  /** Arma: daño por segundo y alcance (m); `weapon` dice cuál. */
  weapon?: "cannon" | "laser" | "missile" | "flak" | "lance";
  dps?: number;
  rangeM?: number;
  /** Soporte vital: plazas de humanos. */
  humans?: number;
  /** Bodega y hangar. */
  cargo?: number;
  fighters?: number;
  /** Sensores: alcance del escáner (a.l.). */
  scanLy?: number;
  /** Blindaje: casco extra. */
  hull?: number;
  /** Puente: tripulación mínima para pilotarla. */
  crew?: number;
}

export interface PartDef {
  id: string;
  nameKey: string;
  kind: PartKind;
  size: SlotSize;
  massT: number;
  /** Energía que gasta (MW); el reactor la da en `stats.powerMW`. */
  drawMW: number;
  stats: PartStats;
  cost: PartCost;
  /** Requisitos: clase de casco mínima. */
  minHull?: HullClass;
  /** Componentes fabricados que pide (de la Fábrica de la colonia donde se construye). */
  components?: ComponentAmounts;
}

const slot = (id: string, size: SlotSize, ...kinds: PartKind[]): HullSlot => ({ id, size, kinds });
const CORE: PartKind[] = ["reactor"];
const DRIVE: PartKind[] = ["thruster"];
const SYSTEMS: PartKind[] = ["quantum", "tank", "shield", "life", "sensor"];
const HARDPOINT: PartKind[] = ["weapon"];
const BAY: PartKind[] = ["cargo", "hangar", "armor", "tank", "life"];

/** Cascos: de la lancha de un solo motor al armazón de capital. */
export const HULLS: readonly HullDef[] = [
  {
    id: "hull_skiff",
    nameKey: "part.hull_skiff",
    class: "S",
    massT: 60,
    hull: 120,
    cargo: 20,
    slots: [slot("bridge", "S", "bridge"), slot("core", "S", ...CORE), slot("drive", "S", ...DRIVE), slot("sys1", "S", ...SYSTEMS), slot("sys2", "S", ...SYSTEMS), slot("gun1", "S", ...HARDPOINT)],
    cost: { credits: 300, metal: 150 },
    builtAt: "shipyard",
    baseClass: "corvette",
    buildTimeHours: 3,
  },
  {
    id: "hull_frigate",
    nameKey: "part.hull_frigate",
    class: "M",
    massT: 220,
    hull: 320,
    cargo: 60,
    slots: [
      slot("bridge", "M", "bridge"),
      slot("core", "M", ...CORE),
      slot("drive1", "M", ...DRIVE),
      slot("drive2", "S", ...DRIVE),
      slot("sys1", "M", ...SYSTEMS),
      slot("sys2", "M", ...SYSTEMS),
      slot("sys3", "S", ...SYSTEMS),
      slot("gun1", "M", ...HARDPOINT),
      slot("gun2", "S", ...HARDPOINT),
      slot("bay1", "M", ...BAY),
    ],
    cost: { credits: 900, metal: 420, crystal: 20 },
    builtAt: "shipyard",
    baseClass: "frigate",
    buildTimeHours: 8,
  },
  {
    id: "hull_cruiser",
    nameKey: "part.hull_cruiser",
    class: "L",
    massT: 900,
    hull: 900,
    cargo: 200,
    slots: [
      slot("bridge", "L", "bridge"),
      slot("core", "L", ...CORE),
      slot("core2", "M", ...CORE),
      slot("drive1", "L", ...DRIVE),
      slot("drive2", "M", ...DRIVE),
      slot("drive3", "M", ...DRIVE),
      slot("sys1", "L", ...SYSTEMS),
      slot("sys2", "M", ...SYSTEMS),
      slot("sys3", "M", ...SYSTEMS),
      slot("sys4", "S", ...SYSTEMS),
      slot("gun1", "L", ...HARDPOINT),
      slot("gun2", "M", ...HARDPOINT),
      slot("gun3", "M", ...HARDPOINT),
      slot("bay1", "L", ...BAY),
      slot("bay2", "M", ...BAY),
    ],
    cost: { credits: 2600, metal: 1100, crystal: 60, alloys: 120 },
    components: { hull_plates: 20 },
    builtAt: "drydock",
    baseClass: "cruiser",
    buildTimeHours: 20,
  },
  {
    id: "hull_capital",
    nameKey: "part.hull_capital",
    class: "XL",
    massT: 3200,
    hull: 2400,
    cargo: 800,
    slots: [
      slot("bridge", "L", "bridge"),
      slot("core", "L", ...CORE),
      slot("core2", "L", ...CORE),
      slot("drive1", "L", ...DRIVE),
      slot("drive2", "L", ...DRIVE),
      slot("drive3", "M", ...DRIVE),
      slot("drive4", "M", ...DRIVE),
      slot("sys1", "L", ...SYSTEMS),
      slot("sys2", "L", ...SYSTEMS),
      slot("sys3", "M", ...SYSTEMS),
      slot("sys4", "M", ...SYSTEMS),
      slot("gun1", "L", ...HARDPOINT),
      slot("gun2", "L", ...HARDPOINT),
      slot("gun3", "M", ...HARDPOINT),
      slot("gun4", "M", ...HARDPOINT),
      slot("bay1", "L", ...BAY),
      slot("bay2", "L", ...BAY),
      slot("bay3", "M", ...BAY),
    ],
    cost: { credits: 7000, metal: 2800, crystal: 160, alloys: 400, rare_metals: 80 },
    components: { hull_plates: 60, circuits: 10 },
    builtAt: "drydock",
    baseClass: "carrier",
    buildTimeHours: 40,
  },
];

/** Piezas del catálogo. */
export const PARTS: readonly PartDef[] = [
  // Puente: sin él no se pilota.
  { id: "bridge_s", nameKey: "part.bridge_s", kind: "bridge", size: "S", massT: 8, drawMW: 1, stats: { crew: 2 }, cost: { credits: 80, metal: 30 } },
  { id: "bridge_m", nameKey: "part.bridge_m", kind: "bridge", size: "M", massT: 25, drawMW: 2, stats: { crew: 8, scanLy: 2 }, cost: { credits: 220, metal: 80, crystal: 5 } },
  { id: "bridge_l", nameKey: "part.bridge_l", kind: "bridge", size: "L", massT: 70, drawMW: 4, stats: { crew: 30, scanLy: 5 }, cost: { credits: 600, metal: 200, crystal: 20 } },
  // Reactores: sin energía no funciona nada.
  { id: "reactor_fission_s", nameKey: "part.reactor_fission_s", kind: "reactor", size: "S", massT: 20, drawMW: 0, stats: { powerMW: 12 }, cost: { credits: 150, metal: 60 } },
  { id: "reactor_fusion_m", nameKey: "part.reactor_fusion_m", kind: "reactor", size: "M", massT: 50, drawMW: 0, stats: { powerMW: 40 }, cost: { credits: 600, metal: 160, crystal: 15 }, components: { power_cells: 4, circuits: 2 } },
  { id: "reactor_fusion_l", nameKey: "part.reactor_fusion_l", kind: "reactor", size: "L", massT: 140, drawMW: 0, stats: { powerMW: 120 }, cost: { credits: 1800, metal: 420, crystal: 40, alloys: 40 }, components: { power_cells: 10, superconductors: 4 } },
  { id: "reactor_antimatter_l", nameKey: "part.reactor_antimatter_l", kind: "reactor", size: "L", massT: 90, drawMW: 0, stats: { powerMW: 220 }, cost: { credits: 5200, alloys: 120, rare_metals: 40, exotic: 6 }, minHull: "L", components: { exotic_cores: 2, superconductors: 6 } },
  // Propulsión: empuje y consumo distintos.
  { id: "thruster_chemical_s", nameKey: "part.thruster_chemical_s", kind: "thruster", size: "S", massT: 10, drawMW: 1, stats: { thrustKN: 1200 }, cost: { credits: 90, metal: 40 } },
  { id: "thruster_ion_s", nameKey: "part.thruster_ion_s", kind: "thruster", size: "S", massT: 8, drawMW: 4, stats: { thrustKN: 900 }, cost: { credits: 160, metal: 30, crystal: 5 } },
  { id: "thruster_fusion_m", nameKey: "part.thruster_fusion_m", kind: "thruster", size: "M", massT: 35, drawMW: 8, stats: { thrustKN: 6000 }, cost: { credits: 520, metal: 140, crystal: 10 } },
  { id: "thruster_plasma_l", nameKey: "part.thruster_plasma_l", kind: "thruster", size: "L", massT: 110, drawMW: 24, stats: { thrustKN: 26000 }, cost: { credits: 1700, metal: 380, alloys: 60 }, components: { superconductors: 2, power_cells: 4 } },
  // Motores cuánticos: velocidad en la grieta, carga y consumo.
  { id: "quantum_a", nameKey: "part.quantum_a", kind: "quantum", size: "S", massT: 15, drawMW: 4, stats: { riftLyPerHour: 160, chargeSec: 20, fuelPerLyPer1000T: 14 }, cost: { credits: 300, metal: 60, crystal: 15 } },
  { id: "quantum_b", nameKey: "part.quantum_b", kind: "quantum", size: "M", massT: 40, drawMW: 10, stats: { riftLyPerHour: 240, chargeSec: 16, fuelPerLyPer1000T: 11 }, cost: { credits: 900, metal: 140, crystal: 40 }, components: { circuits: 4, superconductors: 1 } },
  { id: "quantum_c", nameKey: "part.quantum_c", kind: "quantum", size: "L", massT: 100, drawMW: 26, stats: { riftLyPerHour: 340, chargeSec: 14, fuelPerLyPer1000T: 8 }, cost: { credits: 2600, crystal: 90, alloys: 80, rare_metals: 20 }, minHull: "L", components: { circuits: 6, superconductors: 4 } },
  { id: "quantum_d", nameKey: "part.quantum_d", kind: "quantum", size: "L", massT: 160, drawMW: 50, stats: { riftLyPerHour: 480, chargeSec: 12, fuelPerLyPer1000T: 6 }, cost: { credits: 6400, alloys: 160, rare_metals: 60, exotic: 10 }, minHull: "XL", components: { exotic_cores: 2, superconductors: 6 } },
  // Depósitos.
  { id: "tank_s", nameKey: "part.tank_s", kind: "tank", size: "S", massT: 6, drawMW: 0, stats: { fuel: 300 }, cost: { credits: 60, metal: 30 } },
  { id: "tank_m", nameKey: "part.tank_m", kind: "tank", size: "M", massT: 18, drawMW: 0, stats: { fuel: 1000 }, cost: { credits: 180, metal: 80 } },
  { id: "tank_l", nameKey: "part.tank_l", kind: "tank", size: "L", massT: 50, drawMW: 0, stats: { fuel: 3200 }, cost: { credits: 480, metal: 200 } },
  // Escudos.
  { id: "shield_light", nameKey: "part.shield_light", kind: "shield", size: "S", massT: 10, drawMW: 4, stats: { shield: 150, shieldRegen: 10, shieldDelaySec: 3 }, cost: { credits: 200, metal: 40, crystal: 10 } },
  { id: "shield_fleet", nameKey: "part.shield_fleet", kind: "shield", size: "M", massT: 30, drawMW: 12, stats: { shield: 600, shieldRegen: 25, shieldDelaySec: 4 }, cost: { credits: 700, metal: 100, crystal: 40 }, components: { circuits: 3, power_cells: 2 } },
  { id: "shield_siege", nameKey: "part.shield_siege", kind: "shield", size: "L", massT: 90, drawMW: 36, stats: { shield: 2000, shieldRegen: 45, shieldDelaySec: 6 }, cost: { credits: 2400, crystal: 120, alloys: 80 }, minHull: "L", components: { superconductors: 4, power_cells: 6 } },
  // Armas.
  { id: "cannon_s", nameKey: "part.cannon_s", kind: "weapon", size: "S", massT: 6, drawMW: 2, stats: { weapon: "cannon", dps: 30, rangeM: 2000 }, cost: { credits: 140, metal: 50 } },
  { id: "laser_m", nameKey: "part.laser_m", kind: "weapon", size: "M", massT: 18, drawMW: 10, stats: { weapon: "laser", dps: 70, rangeM: 2600 }, cost: { credits: 520, metal: 80, crystal: 30 }, components: { optics: 2, circuits: 1 } },
  { id: "missile_m", nameKey: "part.missile_m", kind: "weapon", size: "M", massT: 22, drawMW: 3, stats: { weapon: "missile", dps: 55, rangeM: 6000 }, cost: { credits: 480, metal: 120, alloys: 10 }, components: { circuits: 2 } },
  { id: "flak_m", nameKey: "part.flak_m", kind: "weapon", size: "M", massT: 20, drawMW: 5, stats: { weapon: "flak", dps: 45, rangeM: 1500 }, cost: { credits: 360, metal: 110 } },
  { id: "lance_l", nameKey: "part.lance_l", kind: "weapon", size: "L", massT: 80, drawMW: 40, stats: { weapon: "lance", dps: 260, rangeM: 4000 }, cost: { credits: 3200, alloys: 120, rare_metals: 30 }, minHull: "L", components: { optics: 6, superconductors: 4 } },
  // Soporte vital, bodega, hangar, sensores y blindaje.
  { id: "life_s", nameKey: "part.life_s", kind: "life", size: "S", massT: 8, drawMW: 2, stats: { humans: 20 }, cost: { credits: 120, metal: 40 } },
  { id: "life_m", nameKey: "part.life_m", kind: "life", size: "M", massT: 25, drawMW: 5, stats: { humans: 80 }, cost: { credits: 380, metal: 120 } },
  { id: "cargo_m", nameKey: "part.cargo_m", kind: "cargo", size: "M", massT: 20, drawMW: 0, stats: { cargo: 400 }, cost: { credits: 160, metal: 100 } },
  { id: "cargo_l", nameKey: "part.cargo_l", kind: "cargo", size: "L", massT: 60, drawMW: 0, stats: { cargo: 1500 }, cost: { credits: 420, metal: 300 } },
  { id: "hangar_l", nameKey: "part.hangar_l", kind: "hangar", size: "L", massT: 120, drawMW: 10, stats: { fighters: 4 }, cost: { credits: 2200, metal: 500, alloys: 80 }, minHull: "L", components: { hull_plates: 10, circuits: 4 } },
  { id: "sensor_s", nameKey: "part.sensor_s", kind: "sensor", size: "S", massT: 4, drawMW: 2, stats: { scanLy: 6 }, cost: { credits: 180, crystal: 15 } },
  { id: "sensor_m", nameKey: "part.sensor_m", kind: "sensor", size: "M", massT: 12, drawMW: 5, stats: { scanLy: 15 }, cost: { credits: 520, crystal: 40 }, components: { optics: 3, circuits: 3 } },
  { id: "armor_m", nameKey: "part.armor_m", kind: "armor", size: "M", massT: 60, drawMW: 0, stats: { hull: 250 }, cost: { credits: 300, metal: 220 }, components: { hull_plates: 6 } },
  { id: "armor_l", nameKey: "part.armor_l", kind: "armor", size: "L", massT: 180, drawMW: 0, stats: { hull: 900 }, cost: { credits: 900, metal: 600, alloys: 60 }, components: { hull_plates: 16 } },
];

export function getHull(id: string): HullDef | undefined {
  return HULLS.find((h) => h.id === id);
}

export function getPart(id: string): PartDef | undefined {
  return PARTS.find((p) => p.id === id);
}

/** ¿Cabe una pieza de tamaño `part` en un anclaje de tamaño `slot`? (en uno igual o mayor). */
export function fitsSlot(part: SlotSize, slotSize: SlotSize): boolean {
  return SLOT_SIZES.indexOf(part) <= SLOT_SIZES.indexOf(slotSize);
}

/** ¿Alcanza la clase de casco el mínimo? */
export function hullAtLeast(hull: HullClass, min: HullClass): boolean {
  return HULL_CLASSES.indexOf(hull) >= HULL_CLASSES.indexOf(min);
}
