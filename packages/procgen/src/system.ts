import {
  GENERATOR_VERSION,
  type AnomalyType,
  type AsteroidBelt,
  type Moon,
  type Planet,
  type PlanetType,
  type ResourceDeposits,
  type Richness,
  type StarClass,
  type StarSystemDetail,
  type StarSystemSummary,
} from "@imperium/shared";
import { hashInts } from "./hash";
import { planetDesignation } from "./names";
import { Rng } from "./rng";
import { STAR_CLASSES } from "./stars";

const EXOTIC: ReadonlySet<StarClass> = new Set(["WD", "NS", "BH"]);

function richness(rng: Rng, min: number, max: number): Richness {
  return rng.int(min, max) as Richness;
}

/** Rangos [mín, máx] de riqueza de metal y volátiles por tipo de cuerpo. */
export const DEPOSIT_TABLE: Record<PlanetType, { metal: [number, number]; volatiles: [number, number] }> = {
  lava: { metal: [2, 3], volatiles: [0, 0] },
  barren: { metal: [1, 3], volatiles: [0, 0] },
  rocky: { metal: [1, 2], volatiles: [0, 1] },
  desert: { metal: [1, 2], volatiles: [0, 0] },
  ocean: { metal: [0, 1], volatiles: [1, 2] },
  toxic: { metal: [1, 1], volatiles: [1, 2] },
  ice: { metal: [0, 1], volatiles: [2, 3] },
  gas_giant: { metal: [0, 0], volatiles: [2, 3] },
  ice_giant: { metal: [0, 0], volatiles: [2, 3] },
};

function deposits(rng: Rng, type: PlanetType, crystalChance: number): ResourceDeposits {
  const row = DEPOSIT_TABLE[type];
  return {
    metal: richness(rng, row.metal[0], row.metal[1]),
    volatiles: richness(rng, row.volatiles[0], row.volatiles[1]),
    crystal: rng.chance(crystalChance) ? rng.weighted<Richness>([[1, 6], [2, 3], [3, 1]]) : 0,
  };
}

/**
 * Elige el tipo de planeta según su distancia relativa a la zona habitable
 * (ratio = órbita / centro de la zona habitable).
 */
function planetTypeFor(rng: Rng, ratio: number, exotic: boolean): PlanetType {
  if (exotic) {
    if (ratio < 1) return rng.weighted<PlanetType>([["lava", 2], ["barren", 3], ["toxic", 1]]);
    if (ratio < 4) return rng.weighted<PlanetType>([["barren", 3], ["ice", 2], ["gas_giant", 1]]);
    return rng.weighted<PlanetType>([["ice", 2], ["ice_giant", 2], ["gas_giant", 1]]);
  }
  if (ratio < 0.5) return rng.weighted<PlanetType>([["lava", 4], ["barren", 3], ["toxic", 1]]);
  if (ratio < 0.8) return rng.weighted<PlanetType>([["desert", 3], ["toxic", 3], ["rocky", 2], ["barren", 2]]);
  if (ratio < 1.4) return rng.weighted<PlanetType>([["ocean", 3], ["rocky", 4], ["desert", 2], ["toxic", 1]]);
  if (ratio < 3) return rng.weighted<PlanetType>([["rocky", 2], ["barren", 3], ["ice", 2], ["gas_giant", 2]]);
  return rng.weighted<PlanetType>([["gas_giant", 4], ["ice_giant", 3], ["ice", 2], ["barren", 1]]);
}

function radiusFor(rng: Rng, type: PlanetType): number {
  switch (type) {
    case "gas_giant":
      return rng.range(6, 12);
    case "ice_giant":
      return rng.range(3, 5);
    case "lava":
    case "barren":
      return rng.range(0.2, 1.2);
    default:
      return rng.range(0.4, 1.8);
  }
}

function habitabilityFor(rng: Rng, type: PlanetType, ratio: number, exotic: boolean): number {
  const inZone = ratio >= 0.8 && ratio < 1.4;
  let h: number;
  if (type === "ocean" && inZone) h = rng.range(0.6, 1);
  else if (type === "rocky" && inZone) h = rng.range(0.3, 0.7);
  else if (type === "desert") h = rng.range(0.15, 0.45);
  else if (type === "ocean" || type === "rocky") h = rng.range(0.1, 0.3);
  else h = rng.range(0, 0.08);
  if (exotic) h *= 0.2;
  return Math.round(h * 100) / 100;
}

function moonsFor(rng: Rng, type: PlanetType, crystalChance: number): Moon[] {
  let count = 0;
  if (type === "gas_giant") count = rng.int(1, 6);
  else if (type === "ice_giant") count = rng.int(0, 4);
  else if (rng.chance(0.35)) count = rng.int(1, 2);
  const moons: Moon[] = [];
  for (let i = 0; i < count; i++) {
    const mt = rng.weighted<PlanetType>([["barren", 4], ["ice", 3], ["rocky", 1]]);
    moons.push({ type: mt, deposits: deposits(rng, mt, crystalChance) });
  }
  return moons;
}

/**
 * Genera el detalle completo de un sistema (planetas, recursos, anomalía) a
 * partir de su resumen. Determinista para las mismas semillas.
 *
 * Niebla de guerra: además de la semilla pública del universo, depende de
 * `detailSeed`, una semilla secreta **propia de cada sistema** (entero de 32
 * bits) que solo conoce el servidor. Así, quien tenga el cliente y la semilla
 * pública no puede calcular el detalle de un sistema que no ha descubierto.
 * El servidor la deriva de su secreto `DETAIL_SEED` con una función resumen
 * criptográfica por sistema: descubrir la de un sistema no revela las demás.
 */
export function generateSystemDetail(
  universeSeed: number,
  summary: StarSystemSummary,
  detailSeed: number,
  generatorVersion: number = GENERATOR_VERSION,
): StarSystemDetail {
  const { sector, index, starClass } = summary;
  const rng = new Rng(hashInts(universeSeed, generatorVersion, sector.x, sector.y, sector.z, index, 0x5157, detailSeed));
  const info = STAR_CLASSES[starClass];
  const exotic = EXOTIC.has(starClass);

  const luminosity = rng.range(info.luminosity[0], info.luminosity[1]);
  // Centro de la zona habitable en UA (ley del inverso del cuadrado).
  const hz = Math.sqrt(Math.max(luminosity, 0.0004));
  const crystalChance = 0.03 + info.crystalBonus;

  const planetCount = rng.int(info.planets[0], info.planets[1]);
  const planets: Planet[] = [];
  const belts: AsteroidBelt[] = [];

  let orbit = Math.max(0.05, hz * rng.range(0.2, 0.5));
  let slot = 0;
  while (planets.length < planetCount) {
    if (belts.length < 2 && slot > 0 && rng.chance(0.14)) {
      belts.push({
        orbitAu: Math.round(orbit * 100) / 100,
        deposits: {
          metal: richness(rng, 2, 3),
          volatiles: richness(rng, 0, 1),
          crystal: rng.chance(crystalChance * 2) ? rng.weighted<Richness>([[1, 5], [2, 3], [3, 1]]) : 0,
        },
      });
    } else {
      const ratio = orbit / hz;
      const type = planetTypeFor(rng, ratio, exotic);
      const pIndex = planets.length;
      planets.push({
        index: pIndex,
        name: planetDesignation(summary.name, pIndex),
        type,
        orbitAu: Math.round(orbit * 100) / 100,
        radius: Math.round(radiusFor(rng, type) * 100) / 100,
        habitability: habitabilityFor(rng, type, ratio, exotic),
        deposits: deposits(rng, type, crystalChance),
        moons: moonsFor(rng, type, crystalChance),
        phase: rng.range(0, Math.PI * 2),
      });
    }
    orbit *= rng.range(1.4, 2.0);
    slot++;
  }

  const anomalyChance = starClass === "BH" ? 0.5 : starClass === "NS" ? 0.25 : 0.05;
  const anomaly: AnomalyType | null = rng.chance(anomalyChance)
    ? rng.weighted<AnomalyType>([["ruins", 2], ["derelict", 3], ["rift", starClass === "BH" ? 4 : 1], ["nebula", 2]])
    : null;

  const energy = Math.round(Math.min(5, Math.max(0, info.energy + rng.range(-0.5, 0.5))) * 10) / 10;

  return { summary, luminosity, energy, planets, belts, anomaly };
}
