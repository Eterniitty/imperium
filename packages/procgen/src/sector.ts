import {
  GENERATOR_VERSION,
  MAX_SYSTEMS_PER_SECTOR,
  MIN_SYSTEMS_PER_SECTOR,
  SECTOR_SIZE,
  sectorOrigin,
  systemId,
  type SectorCoord,
  type SectorData,
  type StarSystemSummary,
} from "@imperium/shared";
import { hashInts, hashString } from "./hash";
import { fbm3 } from "./noise";
import { Rng } from "./rng";
import { STAR_CLASS_WEIGHTS } from "./stars";
import { generateStarName } from "./names";

/** Convierte la semilla textual del universo en un entero de 32 bits. */
export function universeSeedFromString(seed: string): number {
  return hashString(seed);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Densidad de estrellas de un sector (0 a 1). Combina estructura a gran escala
 * (vacíos y filamentos) con variación local (cúmulos), de forma continua entre
 * sectores vecinos.
 */
export function sectorDensity(universeSeed: number, c: SectorCoord): number {
  const large = fbm3(universeSeed ^ 0x51ed27, c.x / 14, c.y / 14, c.z / 14, 2);
  const local = fbm3(universeSeed ^ 0x2f8a11, c.x / 4, c.y / 4, c.z / 4, 3);
  return clamp01((large - 0.32) * 1.6 + (local - 0.5) * 0.9 + 0.2);
}

/**
 * Genera el contenido estelar de un sector. Determinista: para la misma semilla,
 * coordenadas y versión del generador, el resultado es siempre idéntico.
 */
export function generateSector(
  universeSeed: number,
  coord: SectorCoord,
  generatorVersion: number = GENERATOR_VERSION,
): SectorData {
  const seed = hashInts(universeSeed, generatorVersion, coord.x, coord.y, coord.z);
  const rng = new Rng(seed);
  const density = sectorDensity(universeSeed, coord);

  const span = MAX_SYSTEMS_PER_SECTOR - MIN_SYSTEMS_PER_SECTOR;
  const count = Math.min(
    MAX_SYSTEMS_PER_SECTOR,
    MIN_SYSTEMS_PER_SECTOR + Math.floor(density * density * span + rng.next() * 5),
  );

  // Algunos sectores tienen cúmulos: parte de sus estrellas se agrupan.
  const clusterCount = rng.chance(0.35 + density * 0.4) ? rng.int(1, 2) : 0;
  const clusters: Array<{ x: number; y: number; z: number; r: number }> = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      x: rng.range(20, SECTOR_SIZE - 20),
      y: rng.range(20, SECTOR_SIZE - 20),
      z: rng.range(20, SECTOR_SIZE - 20),
      r: rng.range(8, 18),
    });
  }

  const origin = sectorOrigin(coord);
  const systems: StarSystemSummary[] = [];
  for (let i = 0; i < count; i++) {
    let lx: number;
    let ly: number;
    let lz: number;
    if (clusters.length > 0 && rng.chance(0.45)) {
      const cl = rng.pick(clusters);
      lx = cl.x + rng.bell() * cl.r;
      ly = cl.y + rng.bell() * cl.r;
      lz = cl.z + rng.bell() * cl.r;
    } else {
      lx = rng.range(0, SECTOR_SIZE);
      ly = rng.range(0, SECTOR_SIZE);
      lz = rng.range(0, SECTOR_SIZE);
    }
    // Mantener cada estrella dentro de su sector: la propiedad de un sistema
    // nunca es ambigua entre dos sectores.
    lx = Math.min(SECTOR_SIZE - 0.01, Math.max(0, lx));
    ly = Math.min(SECTOR_SIZE - 0.01, Math.max(0, ly));
    lz = Math.min(SECTOR_SIZE - 0.01, Math.max(0, lz));

    systems.push({
      id: systemId(coord, i),
      sector: { ...coord },
      index: i,
      name: generateStarName(rng),
      position: { x: origin.x + lx, y: origin.y + ly, z: origin.z + lz },
      starClass: rng.weighted(STAR_CLASS_WEIGHTS),
    });
  }

  return { coord: { ...coord }, generatorVersion, density, systems };
}
