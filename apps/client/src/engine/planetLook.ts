import * as THREE from "three";
import { Rng, hashString } from "@imperium/procgen";
import type { PlanetType } from "@imperium/shared";
import type { Quality } from "../state/settings";

/**
 * Aspecto de un planeta (o luna) para el shader de superficie: colores, nivel
 * del mar, casquetes, nubes, bandas y atmósfera. Se calcula en la CPU con
 * `Rng` a partir del id del sistema y el índice del planeta, así que un mismo
 * planeta se ve igual en cada visita y en cada equipo. Es solo visual: no
 * afecta al juego.
 */
export interface PlanetLook {
  /** Desplazamiento del ruido: cada planeta muestrea una zona distinta. */
  seed: THREE.Vector3;
  /** Frecuencia base del ruido sobre la esfera unidad. */
  freq: number;
  /** Rampa de color por altura (5 paradas, colores lineales). */
  colors: THREE.Color[];
  stops: number[];
  /** Nivel del mar en la altura 0..1; negativo si no hay océano. */
  seaLevel: number;
  deepWater: THREE.Color;
  shallowWater: THREE.Color;
  /** Latitud (|y| de la dirección) donde empiezan los casquetes; > 1 sin casquetes. */
  capLatitude: number;
  /** Cobertura de nubes 0..1 (0: sin nubes) y su color. */
  clouds: number;
  cloudColor: THREE.Color;
  /** Relieve, como fracción del radio (solo para el sombreado, exagerado a propósito; la silueta es una esfera). */
  relief: number;
  /** Gigantes: bandas por latitud. */
  bands: boolean;
  bandFreq: number;
  /** Gran tormenta de un gigante: dirección (unitaria) y radio angular; radio 0 sin tormenta. */
  storm: THREE.Vector4;
  stormColor: THREE.Color;
  /** Brillo de las grietas de lava (0: sin lava). */
  lavaGlow: number;
  lavaColor: THREE.Color;
  /** Grietas oscuras en la superficie (hielo), 0..1, y su color. */
  cracks: number;
  crackColor: THREE.Color;
  /** Cráteres, 0..1. */
  craters: number;
  /** Atmósfera: color, grosor (fracción del radio) y densidad; null si no tiene. */
  atmosphere: { color: THREE.Color; thickness: number; density: number } | null;
}

type Rgb = [number, number, number];

interface TypeLook {
  ramp: Array<[number, Rgb]>;
  seaLevel?: number;
  capLatitude?: number;
  clouds?: number;
  cloudColor?: Rgb;
  relief: number;
  bands?: boolean;
  lava?: boolean;
  cracks?: number;
  craters?: number;
  atmosphere?: { color: Rgb; thickness: number; density: number };
}

/** Rampa y rasgos por tipo (colores en sRGB 0–255): estilizado, saturado, legible de lejos. */
const TYPES: Record<PlanetType, TypeLook> = {
  lava: {
    ramp: [[0, [22, 12, 10]], [0.4, [42, 22, 18]], [0.6, [70, 36, 26]], [0.8, [104, 60, 42]], [1, [150, 104, 78]]],
    relief: 0.04,
    lava: true,
  },
  barren: {
    ramp: [[0, [62, 60, 58]], [0.35, [98, 94, 90]], [0.55, [130, 125, 118]], [0.75, [158, 152, 144]], [1, [205, 200, 192]]],
    relief: 0.045,
    craters: 1,
  },
  rocky: {
    ramp: [[0, [78, 60, 46]], [0.38, [118, 96, 72]], [0.52, [88, 110, 70]], [0.72, [132, 118, 92]], [1, [196, 188, 172]]],
    capLatitude: 0.84,
    clouds: 0.35,
    relief: 0.035,
    atmosphere: { color: [140, 180, 255], thickness: 0.025, density: 1 },
  },
  desert: {
    ramp: [[0, [128, 80, 44]], [0.35, [176, 124, 72]], [0.55, [212, 166, 106]], [0.75, [232, 196, 140]], [1, [246, 224, 186]]],
    clouds: 0.08,
    relief: 0.03,
    craters: 0.2,
    atmosphere: { color: [255, 205, 150], thickness: 0.02, density: 0.8 },
  },
  ocean: {
    ramp: [[0, [196, 186, 140]], [0.12, [70, 128, 62]], [0.4, [42, 92, 46]], [0.7, [112, 100, 80]], [1, [210, 205, 200]]],
    seaLevel: 0.52,
    capLatitude: 0.86,
    clouds: 0.5,
    relief: 0.03,
    atmosphere: { color: [110, 165, 255], thickness: 0.03, density: 1.2 },
  },
  toxic: {
    ramp: [[0, [40, 52, 16]], [0.35, [92, 108, 26]], [0.55, [138, 150, 36]], [0.75, [176, 186, 70]], [1, [214, 220, 120]]],
    clouds: 0.6,
    cloudColor: [214, 220, 120],
    relief: 0.03,
    atmosphere: { color: [190, 215, 70], thickness: 0.035, density: 1.6 },
  },
  ice: {
    ramp: [[0, [70, 105, 150]], [0.35, [128, 164, 204]], [0.55, [182, 208, 234]], [0.75, [218, 230, 244]], [1, [248, 251, 255]]],
    relief: 0.025,
    cracks: 0.7,
    craters: 0.35,
  },
  gas_giant: {
    ramp: [[0, [120, 70, 40]], [0.3, [200, 140, 90]], [0.55, [236, 212, 172]], [0.8, [172, 102, 62]], [1, [242, 228, 204]]],
    relief: 0,
    bands: true,
    atmosphere: { color: [240, 205, 160], thickness: 0.05, density: 1.2 },
  },
  ice_giant: {
    ramp: [[0, [40, 92, 142]], [0.3, [70, 140, 190]], [0.55, [100, 176, 214]], [0.8, [150, 210, 236]], [1, [196, 236, 250]]],
    relief: 0,
    bands: true,
    atmosphere: { color: [160, 225, 255], thickness: 0.05, density: 1.2 },
  },
};

function srgb(c: Rgb): THREE.Color {
  return new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
}

/**
 * Aspecto determinista de un cuerpo. `key` identifica el cuerpo
 * (`<sistema>:<índice>` para planetas, `<sistema>:<índice>:m<luna>` para lunas).
 */
export function planetLook(type: PlanetType, key: string): PlanetLook {
  const rng = new Rng(hashString(`look:${type}:${key}`));
  const t = TYPES[type];
  const hue = rng.range(-0.025, 0.025);
  const light = rng.range(-0.04, 0.04);
  const tint = (c: Rgb) => srgb(c).offsetHSL(hue, 0, light);
  const seed = new THREE.Vector3(rng.range(-60, 60), rng.range(-60, 60), rng.range(-60, 60));
  const stormDir = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.5, 0.5), rng.range(-1, 1)).normalize();
  const hasStorm = !!t.bands && rng.chance(0.55);
  return {
    seed,
    freq: rng.range(1.6, 2.4),
    colors: t.ramp.map(([, c]) => tint(c)),
    stops: t.ramp.map(([s]) => s),
    seaLevel: t.seaLevel !== undefined ? t.seaLevel + rng.range(-0.05, 0.05) : -1,
    deepWater: tint([8, 26, 72]),
    shallowWater: tint([30, 96, 160]),
    capLatitude: t.capLatitude !== undefined ? t.capLatitude + rng.range(-0.06, 0.06) : 2,
    clouds: t.clouds !== undefined ? Math.max(0, Math.min(1, t.clouds + rng.range(-0.12, 0.12))) : 0,
    cloudColor: srgb(t.cloudColor ?? [245, 245, 250]),
    relief: t.relief,
    bands: !!t.bands,
    bandFreq: rng.range(7, 15),
    storm: new THREE.Vector4(stormDir.x, stormDir.y, stormDir.z, hasStorm ? rng.range(0.08, 0.16) : 0),
    stormColor: tint(type === "ice_giant" ? [30, 60, 120] : [190, 90, 50]),
    lavaGlow: t.lava ? rng.range(1.2, 1.8) : 0,
    lavaColor: srgb([255, 120, 30]),
    cracks: t.cracks ?? 0,
    crackColor: tint([40, 78, 130]),
    craters: t.craters ?? 0,
    atmosphere: t.atmosphere
      ? {
          color: srgb(t.atmosphere.color).offsetHSL(hue, 0, 0),
          thickness: t.atmosphere.thickness * rng.range(0.85, 1.15),
          density: t.atmosphere.density * rng.range(0.85, 1.15),
        }
      : null,
  };
}

/** Detalle de los cuerpos celestes según la calidad elegida en los ajustes. */
export interface BodyDetail {
  /** Máximo de octavas de ruido por fragmento (de cerca se usan todas). */
  maxOctaves: number;
  /** Segmentos de la esfera más fina (de cerca); de lejos se usan menos. */
  maxSegments: number;
}

export function bodyDetailFor(quality: Quality): BodyDetail {
  switch (quality) {
    case "high":
      return { maxOctaves: 11, maxSegments: 256 };
    case "auto":
      return { maxOctaves: 9, maxSegments: 256 };
    case "medium":
      return { maxOctaves: 8, maxSegments: 192 };
    case "low":
      return { maxOctaves: 6, maxSegments: 128 };
  }
}

/**
 * Segmentos de la esfera de un cuerpo visto a `distance` radios de su centro.
 * De lejos ocupa pocos píxeles y basta una esfera tosca; de cerca la silueta
 * necesita muchos segmentos para no verse poligonal.
 */
export function bodySegments(distance: number, detail: BodyDetail): number {
  if (distance > 80) return 32;
  if (distance > 20) return Math.min(64, detail.maxSegments);
  if (distance > 5) return Math.min(128, detail.maxSegments);
  return detail.maxSegments;
}
