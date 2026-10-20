import type { StarClass } from "@imperium/shared";

export interface StarClassInfo {
  /** Peso relativo de aparición. Ajustado para el juego, no para la astronomía real. */
  weight: number;
  /** Color de representación (hex RGB). */
  color: number;
  /** Tamaño relativo del punto en el mapa estelar. */
  mapSize: number;
  /** Luminosidad relativa al Sol (mínimo y máximo). */
  luminosity: [number, number];
  /** Número de planetas (mínimo y máximo). */
  planets: [number, number];
  /** Energía estelar base, 0 a 5. */
  energy: number;
  /** Probabilidad extra de cristal raro en sus cuerpos. */
  crystalBonus: number;
}

export const STAR_CLASSES: Record<StarClass, StarClassInfo> = {
  O: { weight: 0.8, color: 0x9bb0ff, mapSize: 3.2, luminosity: [30000, 90000], planets: [0, 4], energy: 5, crystalBonus: 0.08 },
  B: { weight: 3, color: 0xaabfff, mapSize: 2.6, luminosity: [500, 20000], planets: [1, 6], energy: 4.5, crystalBonus: 0.05 },
  A: { weight: 6, color: 0xcad7ff, mapSize: 2.1, luminosity: [8, 40], planets: [2, 8], energy: 4, crystalBonus: 0.02 },
  F: { weight: 9, color: 0xf8f7ff, mapSize: 1.8, luminosity: [1.6, 5], planets: [2, 9], energy: 3.5, crystalBonus: 0.01 },
  G: { weight: 13, color: 0xfff1c4, mapSize: 1.6, luminosity: [0.6, 1.5], planets: [2, 9], energy: 3, crystalBonus: 0.01 },
  K: { weight: 20, color: 0xffcf8a, mapSize: 1.35, luminosity: [0.1, 0.6], planets: [1, 8], energy: 2.5, crystalBonus: 0.01 },
  M: { weight: 36, color: 0xff9a68, mapSize: 1.1, luminosity: [0.001, 0.08], planets: [0, 6], energy: 1.5, crystalBonus: 0 },
  RG: { weight: 3, color: 0xff6a45, mapSize: 2.8, luminosity: [100, 1000], planets: [0, 5], energy: 3.5, crystalBonus: 0.03 },
  WD: { weight: 4, color: 0xe8f0ff, mapSize: 0.9, luminosity: [0.001, 0.05], planets: [0, 3], energy: 1, crystalBonus: 0.06 },
  NS: { weight: 1.2, color: 0x7fe9ff, mapSize: 1.2, luminosity: [0.0001, 0.01], planets: [0, 3], energy: 2, crystalBonus: 0.2 },
  BH: { weight: 0.35, color: 0xb57bff, mapSize: 1.9, luminosity: [0, 0], planets: [0, 4], energy: 0, crystalBonus: 0.35 },
};

export const STAR_CLASS_LIST = Object.keys(STAR_CLASSES) as StarClass[];

export const STAR_CLASS_WEIGHTS: ReadonlyArray<readonly [StarClass, number]> = STAR_CLASS_LIST.map(
  (c) => [c, STAR_CLASSES[c].weight] as const,
);
