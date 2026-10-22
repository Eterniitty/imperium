import {
  GALAXY,
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
import { GALAXY_CENTER_SECTOR, galaxyDensity } from "./galaxy";

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
  const raw = Math.min(MAX_SYSTEMS_PER_SECTOR, MIN_SYSTEMS_PER_SECTOR + Math.floor(density * density * span + rng.next() * 5));
  // Desde la versión 2, la forma de la galaxia (disco, brazos, bulbo): fuera de ella, nada.
  const shape = generatorVersion >= 2 ? galaxyDensity(coord) : 1;
  const isCenter = generatorVersion >= 2 && coord.x === GALAXY_CENTER_SECTOR.x && coord.y === GALAXY_CENTER_SECTOR.y && coord.z === GALAXY_CENTER_SECTOR.z;
  // Desde la 3, solo una fracción (≈ 30 000 estrellas), salvo en el Núcleo Humano.
  const ring = Math.max(Math.abs(coord.x), Math.abs(coord.y), Math.abs(coord.z));
  const keep = generatorVersion < 3 ? 1 : ring <= GALAXY.coreRings ? GALAXY.coreStarFraction : GALAXY.starFraction;
  const count = generatorVersion >= 2 ? Math.max(isCenter ? 1 : 0, Math.floor(raw * shape * keep + rng.next())) : raw;

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

    const name = generateStarName(rng);
    const starClass = rng.weighted(STAR_CLASS_WEIGHTS);
    // El agujero negro supermasivo del centro de la galaxia.
    if (isCenter && i === 0) {
      systems.push({ id: systemId(coord, 0), sector: { ...coord }, index: 0, name: GALAXY.centerName, position: { ...GALAXY.center }, starClass: "BH" });
      continue;
    }
    systems.push({
      id: systemId(coord, i),
      sector: { ...coord },
      index: i,
      name,
      position: { x: origin.x + lx, y: origin.y + ly, z: origin.z + lz },
      starClass,
    });
  }

  return { coord: { ...coord }, generatorVersion, density, systems };
}
