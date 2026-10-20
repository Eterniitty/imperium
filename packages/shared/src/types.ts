import type { SectorCoord, WorldPosition } from "./coords";

export type StarClass =
  | "O"
  | "B"
  | "A"
  | "F"
  | "G"
  | "K"
  | "M"
  | "RG" // gigante roja
  | "WD" // enana blanca
  | "NS" // estrella de neutrones
  | "BH"; // agujero negro

export type PlanetType =
  | "lava"
  | "barren"
  | "rocky"
  | "desert"
  | "ocean"
  | "toxic"
  | "ice"
  | "gas_giant"
  | "ice_giant";

export type ResourceId = "metal" | "volatiles" | "crystal";

/** Riqueza de un recurso en un cuerpo: 0 (nada) a 3 (abundante). */
export type Richness = 0 | 1 | 2 | 3;

export type ResourceDeposits = Record<ResourceId, Richness>;

export type AnomalyType = "ruins" | "derelict" | "rift" | "nebula";

/**
 * Datos mínimos de un sistema estelar, suficientes para dibujarlo en el mapa.
 * Se generan para todos los sistemas de un sector.
 */
export interface StarSystemSummary {
  id: string;
  sector: SectorCoord;
  index: number;
  name: string;
  /** Posición absoluta en años luz. */
  position: WorldPosition;
  starClass: StarClass;
}

export interface Moon {
  type: PlanetType;
  deposits: ResourceDeposits;
}

export interface Planet {
  index: number;
  name: string;
  type: PlanetType;
  /** Distancia orbital en unidades astronómicas. */
  orbitAu: number;
  /** Radio relativo a la Tierra. */
  radius: number;
  /** 0 a 1. Lo cerca que está de ser un mundo habitable. */
  habitability: number;
  deposits: ResourceDeposits;
  moons: Moon[];
  /** Ángulo orbital inicial en radianes, solo para la representación. */
  phase: number;
}

export interface AsteroidBelt {
  orbitAu: number;
  deposits: ResourceDeposits;
}

/**
 * Detalle completo de un sistema. Se genera bajo demanda (al inspeccionarlo),
 * a partir de su resumen, y siempre produce el mismo resultado.
 */
export interface StarSystemDetail {
  summary: StarSystemSummary;
  /** Luminosidad relativa al Sol. */
  luminosity: number;
  /** Energía estelar aprovechable, 0 a 5. La energía no es transportable. */
  energy: number;
  planets: Planet[];
  belts: AsteroidBelt[];
  anomaly: AnomalyType | null;
}

export interface SectorData {
  coord: SectorCoord;
  generatorVersion: number;
  /** Densidad relativa de la región, 0 a 1 (vacíos, brazos, cúmulos). */
  density: number;
  systems: StarSystemSummary[];
}
